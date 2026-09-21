// etlp-relay：etlp-mpc / etlp-mpv 协议的中继（Go 版，编成单个 exe）。
// 和 etlp-mpc-relay.ps1 行为一致：把浏览器里的 etlp-mpc:<编码后的直链>||<续播毫秒> 变成
// 「用 MPC-HC / mpv 打开这个 URL」。区别是装的时候不用 PowerShell、播放时没有 PowerShell 冷启动和黑框。
package main

import (
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const version = "2.2"

// JRiver MCWS 的默认值，跟用户脚本里的默认对齐（direct_module.js 的 dpKeys.jriver / dpKeys.jrkey）
const (
	jrDefaultURL = "http://127.0.0.1:52199"
	// 密钥不预填：装了 MC 认证的那台机器由用户自己填（中继只拿它测连通，真正生效的那份写在脚本设置里）
	jrDefaultKey = ""
)

var schemes = []string{"etlp-mpc", "etlp-mpv"}

var mpcNames = []string{"mpc-hc64.exe", "mpc-hc.exe"}
var mpvNames = []string{"mpv.exe"}

// MPC-HC 常见位置（K-Lite 自带的那份也算）
func mpcDirs() []string {
	return expandAll(
		`%ProgramFiles%\MPC-HC\mpc-hc64.exe`,
		`%ProgramFiles(x86)%\MPC-HC\mpc-hc64.exe`,
		`%LOCALAPPDATA%\Programs\MPC-HC\mpc-hc64.exe`,
		`%ProgramFiles%\MPC-HC\mpc-hc.exe`,
		`%ProgramFiles%\K-Lite Codec Pack\MPC-HC64\mpc-hc64.exe`,
		`%ProgramFiles(x86)%\K-Lite Codec Pack\MPC-HC64\mpc-hc64.exe`,
		`%ProgramFiles%\K-Lite Codec Pack\MPC-HC\mpc-hc.exe`,
	)
}

func mpvDirs() []string {
	return expandAll(
		`%ProgramFiles%\mpv\mpv.exe`,
		`%ProgramFiles(x86)%\mpv\mpv.exe`,
		`%LOCALAPPDATA%\Programs\mpv\mpv.exe`,
		`%USERPROFILE%\scoop\apps\mpv\current\mpv.exe`,
		`%ProgramData%\chocolatey\bin\mpv.exe`,
		`%USERPROFILE%\Downloads\mpv\mpv.exe`,
		`C:\mpv\mpv.exe`,
		`D:\mpv\mpv.exe`,
		`E:\mpv\mpv.exe`,
	)
}

func expandAll(paths ...string) []string {
	out := make([]string, 0, len(paths))
	for _, p := range paths {
		out = append(out, os.ExpandEnv(p))
	}
	return out
}

type relayReq struct {
	scheme string
	url    string
	ms     int64
}

// etlp-mpc:http%3A%2F%2Fhost%2Fa.mkv||90500 → {etlp-mpc, http://host/a.mkv, 90500}
func parseRelay(raw string) (relayReq, error) {
	i := strings.Index(raw, ":")
	if i < 0 {
		return relayReq{}, fmt.Errorf("不是协议链接：%s", raw)
	}
	scheme := strings.ToLower(raw[:i])
	ok := false
	for _, s := range schemes {
		if s == scheme {
			ok = true
		}
	}
	if !ok {
		return relayReq{}, fmt.Errorf("不认识的协议：%s", scheme)
	}
	body := raw[i+1:]
	// 先解码再切 ||：浏览器用 encodeURIComponent 编码，管道符过来是 %7C%7C，
	// 真机上就因为先切后解码，续播毫秒被粘在 URL 尾部喂给了播放器（mpv 直接 Failed to open）。
	u, err := url.PathUnescape(body)
	if err != nil {
		return relayReq{}, fmt.Errorf("URL 解码失败：%v", err)
	}
	var ms int64
	if j := strings.LastIndex(u, "||"); j >= 0 {
		if digits := onlyDigits(u[j+2:]); digits != "" {
			ms, _ = strconv.ParseInt(digits, 10, 64)
			u = u[:j]
		}
	}
	return relayReq{scheme: scheme, url: u, ms: ms}, nil
}

func onlyDigits(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// 毫秒 → mpv 的 --start 秒数，保留一位小数（和 ps1 版一致）
func startSecs(ms int64) string {
	return strconv.FormatFloat(math.Round(float64(ms)/100)/10, 'f', -1, 64)
}

// 给 mpv 的参数：够不着就自己带，别让用户 mpv.conf 里的设置把播放吃掉
//
//	--force-window=yes：force-window=no / 纯音频时也要有窗口（否则看起来像“在后台播”）
//	--no-pause：mpv.conf 里写了 pause=yes 时会开着窗口停在暂停，看起来像“弹了但不播”
//	--no-ytdl：mpv-lazy 这类配置包默认 ytdl=yes，会把 URL 先丢给 yt-dlp 解析（卡住/慢下载 = 窗口开着却不播）
//
// 有续播位置再带 --start
func mpvArgs(req relayReq) []string {
	args := []string{"--force-window=yes", "--no-pause", "--no-ytdl"}
	if req.ms >= 30000 {
		args = append(args, "--start="+startSecs(req.ms))
	}
	return args
}

// 给 MPC-HC 的参数：它没有「打开 URL」的接口，命令行直接丢 URL 就会播
func mpcArgs(_ relayReq) []string { return nil }

// 找播放器：传进来的路径（命令行/ini） → App Paths → PATH → 【deep 时多扫几层目录】→ 常见目录
func findExe(override string, names, dirs []string, deep bool) string {
	if override != "" && isFile(override) {
		return override
	}
	for _, p := range appPathsExe(names) {
		if isFile(p) {
			return p
		}
	}
	for _, n := range names {
		if p, err := exec.LookPath(n); err == nil && isFile(p) {
			return p
		}
	}
	if deep {
		for _, p := range deepFindExe(names) {
			if isFile(p) {
				return p
			}
		}
	}
	for _, p := range dirs {
		if isFile(p) {
			return p
		}
	}
	return ""
}

func isFile(p string) bool {
	st, err := os.Stat(p)
	return err == nil && !st.IsDir()
}

// 配置跟 exe 放一起：etlp-relay.ini（两行 mpc= / mpv=，可以手改）
func iniPath() string {
	self, err := os.Executable()
	if err != nil {
		return "etlp-relay.ini"
	}
	return filepath.Join(filepath.Dir(self), "etlp-relay.ini")
}

func readIni() map[string]string {
	out := map[string]string{}
	b, err := os.ReadFile(iniPath())
	if err != nil {
		return out
	}
	for _, line := range strings.Split(string(b), "\n") {
		if k, v, ok := strings.Cut(strings.TrimSpace(line), "="); ok {
			out[strings.ToLower(strings.TrimSpace(k))] = strings.Trim(strings.TrimSpace(v), `"`)
		}
	}
	return out
}

// 写 ini：跟已有的合并（只传 mpc/mpv 的调用不会把 jrurl/jrkey 抹掉）
func writeIni(vals map[string]string) error {
	cur := readIni()
	for k, v := range vals {
		cur[strings.ToLower(k)] = v
	}
	var b strings.Builder
	b.WriteString("# etlp-relay 配置。mpc/mpv = 播放器路径（留空自动找）；jrurl/jrkey = JRiver 地址和访问密钥（只用来测连接，播放时用的是脚本里那份）。\n")
	for _, k := range []string{"mpc", "mpv", "jrurl", "jrkey"} {
		b.WriteString(k + "=" + cur[k] + "\n")
	}
	return os.WriteFile(iniPath(), []byte(b.String()), 0644)
}

// JRiver 的连接测试。
var mcwsItemRE = regexp.MustCompile(`(?s)<Item Name="([^"]+)">([^<]*)</Item>`)

// 播放不用中继（脚本拿 MCWS 这个 HTTP 接口直接指挥常驻的 MC），这里只是替浏览器把「通不通」测出来：
// 浏览器从 Emby 页面直连 127.0.0.1:52199 会撞 CORS/混合内容，中继没这个限制。
func jriverAlive(base, key string) (string, error) {
	base = strings.TrimRight(strings.TrimSpace(base), "/")
	if base == "" {
		base = jrDefaultURL
	}
	if !strings.Contains(base, "/MCWS") {
		base += "/MCWS/v1"
	}
	q := url.Values{}
	if key != "" {
		q.Set("AccessKey", key)
		q.Set("token", key) // 新版 MC 也认 token=（脚本里两种都带，多余的参数 MC 会忽略）
	}
	c := &http.Client{Timeout: 6 * time.Second}
	resp, err := c.Get(base + "/Alive?" + q.Encode())
	if err != nil {
		return "", fmt.Errorf("连不上 %s\n%v\n（MC 开着吗？地址/端口对吗？）", base, err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 8192))
	items := mcwsItems(body)
	one := strings.Join(strings.Fields(string(body)), " ")
	if len(one) > 200 {
		one = one[:200] + "…"
	}

	// 先看 HTTP，再看 MC 自己说的 Status：401/403 基本都是密钥或认证没对
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("MC 回了 HTTP %d：%s\n（多半是密钥不对，或者 MC 的媒体网络/认证没开对）", resp.StatusCode, one)
	}
	if !strings.Contains(string(body), `Status="OK"`) {
		return "", fmt.Errorf("MC 回了 %s：%s", firstNonEmpty(items["Status"], "非 OK"), one)
	}

	// 只要 MC 回了 OK 就算通。版本项各家叫法不一（Version / ProgramVersion / LibraryVersion…），有就带上
	msg := "通了：MC 在跑"
	if v := firstNonEmpty(items["Version"], items["ProgramVersion"]); v != "" {
		msg = "通了：MC " + v
	}
	if lib := items["LibraryVersion"]; lib != "" {
		msg += fmt.Sprintf("（库版本 %s）", lib)
	}
	return msg + " —— " + base, nil
}

func mcwsItems(body []byte) map[string]string {
	items := map[string]string{}
	for _, m := range mcwsItemRE.FindAllSubmatch(body, -1) {
		items[string(m[1])] = string(m[2])
	}
	return items
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

// 播放这一路没有任何可见输出（控制台是藏起来的、错误只有弹窗，而 mpv 的报错只进它自己的控制台），
// 所以失败只能靠文件：etlp-relay.log 记我们发了什么，mpv.log 记 mpv 收到了什么。
func logPath(name string) string {
	self, err := os.Executable()
	if err != nil {
		return name
	}
	return filepath.Join(filepath.Dir(self), name)
}

func appendLog(path, line string) {
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return
	}
	defer f.Close()
	f.WriteString(line + "\n")
}

// 去掉复制粘贴常见的隐形字符，并把全角/长破折号当普通连字符
// （用户从聊天里复制 -SelfTest 时混进过零宽字符，flag 包直接报“not defined”）
func clean(s string) string {
	return strings.Map(func(r rune) rune {
		switch r {
		case '\u200b', '\u200c', '\u200d', '\u2060', '\ufeff', '\u00a0', '\u2028', '\u2029':
			return -1
		case '\uff0d', '\u2013', '\u2014', '\u2212':
			return '-'
		}
		return r
	}, strings.TrimSpace(s))
}

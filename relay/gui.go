package main

// 浏览器版设置页（-Web / 非 Windows 系统）：起一个只监听 127.0.0.1 的小服务，用浏览器当界面。
// Windows 上默认走 gui_windows.go 里的原生窗口（walk），这个网页版当备用。
//
// 安全：随机 token 放在 URL 里，每个接口都要带 —— 别人的网页拿不到 token，就没法盲调 /api/save。

import (
	"crypto/rand"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

//go:embed gui.html
var guiHTML string

// 抓 stdout 用：那几个 *Run 函数是给终端写的，这里把它们的输出截下来给网页看（省得改成 io.Writer）
var guiMu sync.Mutex

func randomToken() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%x", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}

func captureRun(run func() int) (string, int) {
	guiMu.Lock()
	defer guiMu.Unlock()
	old := os.Stdout
	r, w, err := os.Pipe()
	if err != nil {
		return "抓输出失败：" + err.Error(), 1
	}
	os.Stdout = w
	code := run() // 输出都很短（几 KB），不会被管道缓冲卡住
	_ = w.Close()
	os.Stdout = old
	b, _ := io.ReadAll(r)
	return string(b), code
}

func guiWebRun() int {
	token := randomToken()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		fmt.Println("本地服务起不来：", err)
		return 1
	}
	port := ln.Addr().(*net.TCPAddr).Port
	url := fmt.Sprintf("http://127.0.0.1:%d/?k=%s", port, token)

	auth := func(h http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Query().Get("k") != token {
				http.Error(w, "token 不对", http.StatusForbidden)
				return
			}
			h(w, r)
		}
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/", auth(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = io.WriteString(w, strings.ReplaceAll(guiHTML, "__TOKEN__", token))
	}))
	mux.HandleFunc("/api/status", auth(apiStatus))
	mux.HandleFunc("/api/save", auth(apiSave))
	mux.HandleFunc("/api/uninstall", auth(apiUninstall))
	mux.HandleFunc("/api/selftest", auth(apiSelfTest))
	mux.HandleFunc("/api/scan", auth(apiScan))
	mux.HandleFunc("/api/log", auth(apiLog))

	fmt.Println("etlp-relay", version, "网页版设置：", url)
	fmt.Println("（这个窗口就是服务本身，用完关掉窗口或按 Ctrl+C 就停）")
	if os.Getenv("ETLP_NO_BROWSER") == "" {
		if err := openURL(url); err != nil {
			fmt.Println("没自动打开浏览器，手动复制上面的地址：", err)
		}
	}
	if err := http.Serve(ln, mux); err != nil {
		fmt.Println("GUI 结束：", err)
		return 1
	}
	return 0
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(v)
}

type guiStatus struct {
	Version   string            `json:"version"`
	Exe       string            `json:"exe"`
	IniPath   string            `json:"iniPath"`
	Ini       map[string]string `json:"ini"`
	Mpc       string            `json:"mpc"`
	Mpv       string            `json:"mpv"`
	Protocols map[string]string `json:"protocols"`
}

func guiStatusNow() guiStatus {
	ini := readIni()
	self, _ := os.Executable()
	// 没写过的键补成空串，网页/窗口那边少写判断
	for _, k := range []string{"mpc", "mpv", "jrurl", "jrkey"} {
		if _, ok := ini[k]; !ok {
			ini[k] = ""
		}
	}
	protos := map[string]string{}
	for _, s := range schemes {
		cmd, err := registeredCommand(s)
		if err != nil {
			cmd = ""
		}
		protos[s] = cmd
	}
	return guiStatus{
		Version:   version,
		Exe:       self,
		IniPath:   iniPath(),
		Ini:       ini,
		Mpc:       findExe(ini["mpc"], mpcNames, mpcDirs(), false),
		Mpv:       findExe(ini["mpv"], mpvNames, mpvDirs(), false),
		Protocols: protos,
	}
}

func apiStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, guiStatusNow())
}

// 保存路径 + 注册协议：走的就是命令行那条路（installRun），网页不另写一份逻辑
func apiSave(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	log, code := captureRun(func() int { return installRun(q.Get("mpc"), q.Get("mpv"), q.Get("jrurl"), q.Get("jrkey")) })
	writeJSON(w, map[string]any{"ok": code == 0, "log": log})
}

func apiUninstall(w http.ResponseWriter, r *http.Request) {
	log, code := captureRun(uninstallRun)
	writeJSON(w, map[string]any{"ok": code == 0, "log": log})
}

func apiSelfTest(w http.ResponseWriter, r *http.Request) {
	log, code := captureRun(selfTestRun)
	writeJSON(w, map[string]any{"ok": code == 0, "log": log})
}

// 深度扫盘（慢）：只在用户点「找找看」时才跑，播放路径上绝不扫
func apiScan(w http.ResponseWriter, r *http.Request) {
	names := mpvNames
	if r.URL.Query().Get("who") == "mpc" {
		names = mpcNames
	}
	cands := deepFindExe(names)
	if cands == nil {
		cands = []string{} // 网页那边直接 cands.length，别发 null 过去
	}
	writeJSON(w, map[string]any{"candidates": cands})
}

func apiLog(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	name := "etlp-relay.log"
	if q.Get("which") == "mpv" {
		name = "mpv.log"
	}
	p := logPath(name)
	if q.Get("open") != "" {
		_ = openFolder(filepath.Dir(p))
		writeJSON(w, map[string]any{"ok": true})
		return
	}
	writeJSON(w, map[string]any{"path": p, "text": tailFile(p, 120)})
}

func tailFile(path string, lines int) string {
	b, err := os.ReadFile(path)
	if err != nil {
		return "（没有这个文件：" + path + "）"
	}
	all := strings.Split(strings.TrimRight(string(b), "\r\n"), "\n")
	if len(all) > lines {
		all = append([]string{fmt.Sprintf("…… 只显示最后 %d 行（共 %d 行）", lines, len(all))}, all[len(all)-lines:]...)
	}
	return strings.Join(all, "\n")
}

package main

import (
	"fmt"
	"os"
	"strings"
	"time"
)

type options struct {
	raw       string
	install   bool
	uninstall bool
	selfTest  bool
	status    bool
	version   bool
	gui       bool
	web       bool
	jrTest    bool
	help      bool
	mpc       string
	mpv       string
	jr        string
	jrkey     string
	unknown   []string
}

// 手工解析参数：故意不用标准库 flag。
// 原因：这份用法基本都是**从聊天/文档里复制**过去的，复制常带零宽字符或全角连字符，
// 而 flag 包对 `-SelfTest` 里混一个不可见字符就报 "flag provided but not defined"（用户实测撞到过）。
func parseArgs(argv []string) options {
	var o options
	for i := 1; i < len(argv); i++ {
		a := clean(argv[i])
		if a == "" {
			continue
		}
		if !strings.HasPrefix(a, "-") {
			if o.raw == "" {
				o.raw = a
			}
			continue
		}
		if key, val, hasVal := strings.Cut(a, "="); hasVal { // -Mpv=C:\x\mpv.exe（值保留原本大小写）
			switch strings.ToLower(strings.TrimLeft(key, "-")) {
			case "mpc":
				o.mpc = clean(val)
			case "mpv":
				o.mpv = clean(val)
			case "jr", "jrurl":
				o.jr = clean(val)
			case "jrkey":
				o.jrkey = clean(val)
			default:
				o.unknown = append(o.unknown, argv[i])
			}
			continue
		}
		name := strings.ToLower(strings.TrimLeft(a, "-"))
		switch name {
		case "install":
			o.install = true
		case "uninstall":
			o.uninstall = true
		case "selftest":
			o.selfTest = true
		case "status":
			o.status = true
		case "gui":
			o.gui = true
		case "web":
			o.web = true
		case "jrtest":
			o.jrTest = true
		case "version", "v":
			o.version = true
		case "help", "h", "?":
			o.help = true
		case "mpc", "mpv":
			v := ""
			if i+1 < len(argv) {
				i++
				v = clean(argv[i])
			}
			if name == "mpc" {
				o.mpc = v
			} else {
				o.mpv = v
			}
		default:
			o.unknown = append(o.unknown, argv[i])
		}
	}
	return o
}

func main() {
	consoleUTF8()
	o := parseArgs(os.Args)

	switch {
	case len(o.unknown) > 0:
		os.Exit(tellAndRun("参数不认识", func() int {
			fmt.Println("不认识的参数：" + strings.Join(o.unknown, " "))
			fmt.Println()
			usage()
			return 2
		}))
	case o.version:
		os.Exit(tellAndRun("版本", func() int { fmt.Println("etlp-relay " + version); return 0 }))
	case o.help:
		os.Exit(tellAndRun("用法", func() int { usage(); return 0 }))
	case o.selfTest:
		os.Exit(tellAndRun("自检", selfTestRun))
	case o.install:
		os.Exit(tellAndRun("保存并注册协议", func() int { return installRun(o.mpc, o.mpv, o.jr, o.jrkey) }))
	case o.uninstall:
		os.Exit(tellAndRun("卸载协议", uninstallRun))
	case o.status:
		os.Exit(tellAndRun("状态", statusRun))
	case o.jrTest:
		os.Exit(tellAndRun("JRiver 连接测试", jrTestRun))
	case o.gui:
		os.Exit(guiNativeRun())
	case o.web:
		os.Exit(guiWebRun())
	case o.raw == "":
		os.Exit(guiNativeRun()) // 直接双击：开设置窗口
	default:
		if err := play(o.raw); err != nil {
			showMessage("etlp 中继", err.Error())
			os.Exit(1)
		}
	}
}

// 这些命令的输出本来是给终端看的；但 exe 现在是窗口程序（-H windowsgui），
// 双击或从资源管理器跑都看不到 stdout，所以顺手把结果弹出来（内容很短，不会烦人）。
func tellAndRun(title string, run func() int) int {
	out, code := captureRun(run)
	if s := strings.TrimSpace(out); s != "" {
		showMessage("etlp 中继 · "+title, s)
	}
	return code
}

func usage() {
	self, _ := os.Executable()
	fmt.Printf("etlp-relay %s —— etlp-mpc / etlp-mpv 协议的中继。\n\n", version)
	fmt.Println("直接双击（或 -Gui）：开设置窗口（Windows 原生窗口，不是网页）。")
	fmt.Println("-Web：网页版设置（备用；其它系统上双击就是这个）。")
	fmt.Println()
	fmt.Println("安装（把两个协议注册到当前用户）：")
	fmt.Println("  " + self + " -Install")
	fmt.Println("  " + self + ` -Install -Mpc "C:\路径\mpc-hc64.exe" -Mpv "C:\路径\mpv.exe"    # 找不到播放器时补路径`)
	fmt.Println("JRiver（不用装协议，MC 自带 HTTP 接口；这几行只是测连通性）：")
	fmt.Println("  " + self + " -JrTest                                              用 ini 里的地址/密钥测")
	fmt.Println("  " + self + ` -Install -Jr "http://127.0.0.1:52199" -JrKey "六位密钥"        改地址/密钥（只影响测试）`)
	fmt.Println("自查：")
	fmt.Println("  " + self + " -SelfTest    协议解析自检（不用装任何东西）")
	fmt.Println("  " + self + " -Status      看注册的是什么、找到了哪个播放器")
	fmt.Println("  " + self + " -Version")
	fmt.Println("卸载：")
	fmt.Println("  " + self + " -Uninstall")
	fmt.Println()
	fmt.Println("参数大小写随意（-install / -Install / -SELFTEST 都认）。")
}

// 播放：浏览器通过协议把 etlp-mpc:... 丢过来
func play(raw string) error {
	hideConsole() // 别闪黑框（播放模式不需要输出）
	// 先落一行「我确实被调用了」：不然出问题时分不清是协议没打到这里、还是播放器没播
	appendLog(logPath("etlp-relay.log"), time.Now().Format("2006-01-02 15:04:05")+"  收到 "+raw)
	req, err := parseRelay(raw)
	if err != nil {
		return err
	}
	if !strings.HasPrefix(req.url, "http://") && !strings.HasPrefix(req.url, "https://") {
		return fmt.Errorf("中继拿到的东西不像 URL：%s", req.url)
	}
	ini := readIni()

	var exe, who, flagName string
	var args []string
	if req.scheme == "etlp-mpv" {
		who, flagName = "mpv", "-Mpv"
		exe = findExe(ini["mpv"], mpvNames, mpvDirs(), false)
		args = mpvArgs(req)
		mpvLog := logPath("mpv.log")
		_ = os.Remove(mpvLog) // 只留最后一次，看日志不用翻旧账
		args = append([]string{"--log-file=" + mpvLog}, args...)
	} else {
		who, flagName = "MPC-HC", "-Mpc"
		exe = findExe(ini["mpc"], mpcNames, mpcDirs(), false)
		args = mpcArgs(req)
	}
	if exe == "" {
		return fmt.Errorf("找不到 %s。\n\n两种办法（任选）：\n1) 用记事本打开 %s，把 %s= 后面填上完整路径；\n2) 命令行跑一次：\n   etlp-relay.exe -Install %s \"%s 的完整路径\"",
			who, iniPath(), strings.ToLower(who), flagName, who)
	}
	args = append(args, req.url)
	appendLog(logPath("etlp-relay.log"), fmt.Sprintf("           %s  exe=%s  url=%s  args=%v", who, orNone(exe), req.url, args))
	if err := startDetached(exe, args); err != nil {
		appendLog(logPath("etlp-relay.log"), "           启动失败："+err.Error())
		return fmt.Errorf("启动 %s 失败：%v\n路径：%s", who, err, exe)
	}
	return nil
}

func installRun(mpcFlag, mpvFlag, jrFlag, jrKeyFlag string) int {
	fmt.Printf("etlp-relay %s\n", version)
	ini := readIni()
	// 装的时候可以慢一点：找不到就多扫几层（播放时只走 ini / 已知路径，不扫盘）
	mpc := findExe(firstNonEmpty(mpcFlag, ini["mpc"]), mpcNames, mpcDirs(), true)
	mpv := findExe(firstNonEmpty(mpvFlag, ini["mpv"]), mpvNames, mpvDirs(), true)
	save := map[string]string{"mpc": mpc, "mpv": mpv}
	if jrFlag != "" {
		save["jrurl"] = strings.TrimSpace(jrFlag)
	}
	if jrKeyFlag != "" {
		save["jrkey"] = strings.TrimSpace(jrKeyFlag)
	}
	if err := writeIni(save); err != nil {
		fmt.Println("写配置失败（不影响注册）：", err)
	}

	self, err := os.Executable()
	if err != nil {
		fmt.Println("取不到自己的路径：", err)
		return 1
	}
	for _, s := range schemes {
		if err := registerScheme(s, self); err != nil {
			fmt.Printf("注册协议 %s 失败：%v\n", s, err)
			return 1
		}
		fmt.Printf("已注册协议 %s -> %s\n", s, self)
	}
	if mpc != "" {
		fmt.Println("找到 MPC-HC:", mpc)
	} else {
		fmt.Println("没找到 mpc-hc64.exe：MPC-HC 按钮会弹提示。补路径再跑一次：")
		fmt.Println(`  etlp-relay.exe -Install -Mpc "C:\完整\路径\mpc-hc64.exe"`)
	}
	if mpv != "" {
		fmt.Println("找到 mpv:", mpv)
	} else {
		fmt.Println("没找到 mpv.exe：MPV 按钮会弹提示（没装 mpv 就不用管这行）。补路径再跑一次：")
		fmt.Println(`  etlp-relay.exe -Install -Mpv "C:\完整\路径\mpv.exe"`)
	}
	fmt.Println("配置写在：" + iniPath())
	fmt.Println("JRiver 不用注册协议：脚本直接聊 MCWS（MC 自带的 HTTP 接口），这里只是能顺手测一下通不通（-JrTest）。")
	fmt.Println("记得重启浏览器（Chrome/Edge 启动时才读协议表）。")
	return 0
}

// -JrTest：替浏览器测一下 JRiver 的 MCWS 通不通。
// 播放本身不经过中继（MC 常驻，脚本直接用 HTTP 指挥它），所以这里只测连通 + 密钥对不对。
func jrTestRun() int {
	ini := readIni()
	msg, err := jriverAlive(firstNonEmpty(ini["jrurl"], jrDefaultURL), firstNonEmpty(ini["jrkey"], jrDefaultKey))
	if err != nil {
		fmt.Println("✗ " + err.Error())
		return 1
	}
	fmt.Println("✓ " + msg)
	return 0
}

func uninstallRun() int {
	for _, s := range schemes {
		if err := unregisterScheme(s); err != nil {
			fmt.Printf("删除 %s 失败：%v\n", s, err)
			return 1
		}
		fmt.Println("已删除协议", s)
	}
	fmt.Println("（配置文件 etlp-relay.ini 和这个 exe 自己留着，删不删随你）")
	return 0
}

func statusRun() int {
	self, _ := os.Executable()
	fmt.Printf("etlp-relay %s\n程序位置：%s\n配置：%s\n\n", version, self, iniPath())
	ini := readIni()
	for _, s := range schemes {
		cmd, err := registeredCommand(s)
		if err != nil {
			fmt.Printf("%s：未注册\n", s)
		} else {
			fmt.Printf("%s：%s\n", s, cmd)
		}
	}
	fmt.Println()
	fmt.Println("MPC-HC:", orNone(findExe(ini["mpc"], mpcNames, mpcDirs(), false)))
	fmt.Println("mpv:", orNone(findExe(ini["mpv"], mpvNames, mpvDirs(), false)))
	fmt.Println("（-Install 时会多扫几层目录找便携版；这里只查 ini / App Paths / PATH / 常见路径）")
	return 0
}

func orNone(s string) string {
	if s == "" {
		return "（没找到）"
	}
	return s
}

func selfTestRun() int {
	type tc struct {
		in     string
		ok     bool
		scheme string
		url    string
		ms     int64
	}
	cases := []tc{
		{"etlp-mpv:http%3A%2F%2Fh%2Fa.mkv%7C%7C90500", true, "etlp-mpv", "http://h/a.mkv", 90500}, // 浏览器就是这么编码 || 的
		{"etlp-mpc:http%3A%2F%2Fh%2Fa.mkv", true, "etlp-mpc", "http://h/a.mkv", 0},
		{"etlp-mpv:http%3A%2F%2Fh%2Fa%20b.mkv||90500", true, "etlp-mpv", "http://h/a b.mkv", 90500},
		{"etlp-mpv:http%3A%2F%2Fh%2Fa.mkv%3Fx%3D1%26y%3D2", true, "etlp-mpv", "http://h/a.mkv?x=1&y=2", 0},
		{"etlp-mpv:http%3A%2F%2Fh%2Fa%2Bb.mkv%7C%7Cabc", true, "etlp-mpv", "http://h/a+b.mkv||abc", 0}, // || 后面不是数字：不切，当成 URL 本身
		{"etlp-mpv:http%3A%2F%2Fh%2Fa.mkv||12345", true, "etlp-mpv", "http://h/a.mkv", 12345},          // <30s 不定位
		{"http://h/a.mkv", false, "", "", 0},
	}
	bad := 0
	for i, c := range cases {
		r, err := parseRelay(c.in)
		if !c.ok {
			if err == nil {
				fmt.Printf("用例 %d 失败：应该报错却通过了\n", i+1)
				bad++
			}
			continue
		}
		if err != nil || r.scheme != c.scheme || r.url != c.url || r.ms != c.ms {
			fmt.Printf("用例 %d 失败：得到 %+v err=%v\n", i+1, r, err)
			bad++
		}
	}
	if startSecs(90500) != "90.5" || startSecs(90000) != "90" || startSecs(90555) != "90.6" {
		fmt.Println("用例 startSecs 失败：", startSecs(90500), startSecs(90000), startSecs(90555))
		bad++
	}
	if a := mpvArgs(relayReq{ms: 29999}); len(a) != 3 || a[0] != "--force-window=yes" || a[2] != "--no-ytdl" {
		fmt.Println("用例 mpvArgs 失败：不到 30 秒不该带 --start，但三个保底参数必须有：", a)
		bad++
	}
	if a := mpvArgs(relayReq{ms: 90000}); len(a) != 4 || a[3] != "--start=90" {
		fmt.Println("用例 mpvArgs 失败：", a)
		bad++
	}
	// 参数解析（含复制粘贴的隐形字符）
	for _, c := range []struct {
		args string
		want func(options) bool
	}{
		{"-SelfTest", func(o options) bool { return o.selfTest }},
		{"-selftest", func(o options) bool { return o.selfTest }},
		{"\u200b-Self\u200bTest", func(o options) bool { return o.selfTest }}, // 零宽字符（从聊天里复制常带）
		{"-\u2013Status", func(o options) bool { return o.status && !o.selfTest }},
		{"-Install -Mpc C:\\a\\m.exe", func(o options) bool { return o.install && o.mpc == `C:\a\m.exe` }},
		{"-mpv=D:\\mpv.exe", func(o options) bool { return o.mpv == `D:\mpv.exe` }},
		{"-Install", func(o options) bool { return o.install && len(o.unknown) == 0 }},
	} {
		o := parseArgs(append([]string{"etlp-relay.exe"}, strings.Fields(c.args)...))
		if !c.want(o) {
			fmt.Printf("用例 参数 %q 失败：%+v\n", c.args, o)
			bad++
		}
	}
	if o := parseArgs([]string{"etlp-relay.exe", "-Bogus"}); len(o.unknown) != 1 {
		fmt.Println("用例 参数：不认识的参数没被识别出来")
		bad++
	}
	if bad > 0 {
		fmt.Printf("SelfTest 失败 %d 项\n", bad)
		return 1
	}
	fmt.Println("SelfTest OK（协议解析 + 参数解析都对）")
	return 0
}

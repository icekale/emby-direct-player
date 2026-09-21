//go:build windows

package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows/registry"
)

// 播放模式下把自己那个一闪而过的黑框藏掉（编出来的 exe 带控制台子系统，
// 好处是 -Install / -Status 在终端里能直接看到输出）
func hideConsole() {
	k := syscall.NewLazyDLL("kernel32.dll")
	hwnd, _, _ := k.NewProc("GetConsoleWindow").Call()
	if hwnd != 0 {
		syscall.NewLazyDLL("user32.dll").NewProc("ShowWindow").Call(hwnd, 0 /* SW_HIDE */)
	}
}

// 中文输出在 cmd 里默认是 GBK，会乱码 → 把控制台代码页切成 UTF-8
func consoleUTF8() {
	k := syscall.NewLazyDLL("kernel32.dll")
	k.NewProc("SetConsoleOutputCP").Call(65001)
	k.NewProc("SetConsoleCP").Call(65001)
}

func showMessage(title, text string) {
	u := syscall.NewLazyDLL("user32.dll")
	msgBox := u.NewProc("MessageBoxW")
	t, err1 := syscall.UTF16PtrFromString(text)
	c, err2 := syscall.UTF16PtrFromString(title)
	if err1 != nil || err2 != nil {
		return
	}
	msgBox.Call(0, uintptr(unsafe.Pointer(t)), uintptr(unsafe.Pointer(c)), 0x40 /* MB_OK|MB_ICONINFORMATION */)
}

func startDetached(exe string, args []string) error {
	// 注意：不要设 SysProcAttr.HideWindow —— 那是给控制台子进程用的，
	// 对 mpv / MPC-HC 这类 GUI 程序等于 STARTF_USESHOWWINDOW + SW_HIDE：
	// 声音在响、窗口永远看不见（实测踩过）。
	cmd := exec.Command(exe, args...)
	if err := cmd.Start(); err != nil {
		return err
	}
	// 允许这个子进程抢前台：否则浏览器按着前台，播放器窗口会开在浏览器后面（“后台播放”的另一种表现）
	syscall.NewLazyDLL("user32.dll").NewProc("AllowSetForegroundWindow").Call(uintptr(uint32(cmd.Process.Pid)))
	return cmd.Process.Release()
}

// 用默认浏览器打开地址（GUI 用）；rundll32 这条路不需要先解析默认浏览器是什么
func openURL(url string) error {
	return startDetached("rundll32.exe", []string{"url.dll,FileProtocolHandler", url})
}

// 在资源管理器里打开一个目录（GUI 的「打开所在文件夹」）
func openFolder(dir string) error {
	return startDetached("explorer.exe", []string{dir})
}

func registerScheme(scheme, exe string) error {
	base := `Software\Classes\` + scheme
	k, _, err := registry.CreateKey(registry.CURRENT_USER, base, registry.WRITE)
	if err != nil {
		return err
	}
	_ = k.SetStringValue("", "URL:"+scheme+" Protocol")
	_ = k.SetStringValue("URL Protocol", "")
	k.Close()

	ck, _, err := registry.CreateKey(registry.CURRENT_USER, base+`\shell\open\command`, registry.WRITE)
	if err != nil {
		return err
	}
	defer ck.Close()
	return ck.SetStringValue("", `"`+exe+`" "%1"`)
}

func unregisterScheme(scheme string) error {
	base := `Software\Classes\` + scheme
	for _, sub := range []string{`\shell\open\command`, `\shell\open`, `\shell`} {
		_ = registry.DeleteKey(registry.CURRENT_USER, base+sub)
	}
	return registry.DeleteKey(registry.CURRENT_USER, base)
}

func registeredCommand(scheme string) (string, error) {
	k, err := registry.OpenKey(registry.CURRENT_USER, `Software\Classes\`+scheme+`\shell\open\command`, registry.QUERY_VALUE)
	if err != nil {
		return "", err
	}
	defer k.Close()
	v, _, err := k.GetStringValue("")
	return v, err
}

// -Install 时的深度搜索：便携版 / 自定义目录也尽量自己找到（K-Lite 装在别处、绿色版丢 D 盘这种）。
// 扫 Program Files / (x86) / ProgramData / 用户程序目录三层，盘根两层；找不到就还是让用户 -Mpc 填路径。
func deepFindExe(names []string) []string {
	type job struct {
		root  string
		depth int
	}
	var jobs []job
	for _, p := range []string{
		os.Getenv("ProgramFiles"),
		os.Getenv("ProgramFiles(x86)"),
		os.Getenv("ProgramData"),
		filepath.Join(os.Getenv("LOCALAPPDATA"), "Programs"),
	} {
		if p != "" {
			jobs = append(jobs, job{p, 3})
		}
	}
	for _, d := range []string{`C:\`, `D:\`, `E:\`, `F:\`} {
		jobs = append(jobs, job{d, 2})
	}
	var out []string
	for _, j := range jobs {
		out = append(out, scanFor(j.root, j.depth, names)...)
	}
	return out
}

// 在 root 下最多 depth 层里找文件名等于 names 之一的文件
func scanFor(root string, depth int, names []string) []string {
	var out []string
	var walk func(dir string, d int)
	walk = func(dir string, d int) {
		ents, err := os.ReadDir(dir)
		if err != nil {
			return
		}
		for _, e := range ents {
			p := filepath.Join(dir, e.Name())
			if e.IsDir() {
				if d > 0 {
					walk(p, d-1)
				}
				continue
			}
			for _, n := range names {
				if strings.EqualFold(e.Name(), n) {
					out = append(out, p)
				}
			}
		}
	}
	walk(root, depth)
	return out
}

// App Paths 里登记的 exe（安装过的播放器一般都在）
func appPathsExe(names []string) []string {
	type root struct {
		hive registry.Key
		path string
	}
	roots := []root{
		{registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths`},
		{registry.CURRENT_USER, `SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths`},
	}
	var out []string
	for _, r := range roots {
		for _, n := range names {
			k, err := registry.OpenKey(r.hive, r.path+`\`+n, registry.QUERY_VALUE)
			if err != nil {
				continue
			}
			if v, _, err := k.GetStringValue(""); err == nil && v != "" {
				out = append(out, v)
			}
			k.Close()
		}
	}
	return out
}

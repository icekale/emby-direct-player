//go:build !windows

// 非 Windows 只用来在本机跑 go test / go vet（注册表、弹窗、启动进程这些没有意义）
package main

import (
	"fmt"
	"os/exec"
	"runtime"
)

func hideConsole() {}

func consoleUTF8() {}

func showMessage(title, text string) { fmt.Println(title+":", text) }

func startDetached(exe string, args []string) error {
	fmt.Println("(非 Windows 环境，不真的启动)", exe, args)
	return nil
}

// 本机（macOS / Linux）调试 GUI 用
func openURL(url string) error    { return startDetached(opener(), []string{url}) }
func openFolder(dir string) error { return startDetached(opener(), []string{dir}) }

func opener() string {
	if runtime.GOOS == "darwin" {
		return "open"
	}
	return "xdg-open"
}

func registerScheme(scheme, exe string) error {
	return fmt.Errorf("只在 Windows 下支持：注册 %s", scheme)
}

func unregisterScheme(scheme string) error {
	return fmt.Errorf("只在 Windows 下支持：删除 %s", scheme)
}

func registeredCommand(scheme string) (string, error) {
	return "", fmt.Errorf("只在 Windows 下支持")
}

func appPathsExe(names []string) []string {
	var out []string
	for _, n := range names {
		if p, err := exec.LookPath(n); err == nil {
			out = append(out, p)
		}
	}
	return out
}

// 非 Windows 不扫盘（扫了也没用）
func deepFindExe(names []string) []string { return nil }

//go:build !windows

package main

// 原生设置窗口只有 Windows 版（walk 是 Windows API 的封装）。
// 其它系统上双击 exe 仍然给网页版设置，方便调试；也可以显式 -Web。

func guiNativeRun() int {
	return guiWebRun()
}

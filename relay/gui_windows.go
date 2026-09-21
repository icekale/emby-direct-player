//go:build windows

package main

// Windows 原生设置窗口（github.com/lxn/walk，纯 Go、无需 cgo）。
// 双击 exe 或 -Gui 就是它：找播放器、改路径、注册协议、看日志，全部在这个窗口里。
// 逻辑仍然是 main.go / logic.go / gui.go 里那几套函数，这里只是壳。

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/lxn/walk"
	. "github.com/lxn/walk/declarative"
)

var (
	mw        *walk.MainWindow
	mpcEdit   *walk.LineEdit
	mpvEdit   *walk.LineEdit
	statEdit  *walk.TextEdit
	logEdit   *walk.TextEdit
	jrEdit    *walk.LineEdit
	jrKeyEdit *walk.LineEdit
	jrOut     *walk.LineEdit
)

func guiNativeRun() int {
	// 万一窗口真起不来（Common-Controls 缺失、权限、装不出 W 消息循环的机器），
	// 别让用户干瞪眼：说出来，然后退回网页版设置顶着。
	defer func() {
		if r := recover(); r != nil {
			showMessage("设置窗口起不来", fmt.Sprintf("%v\n\n先给你开网页版设置顶着。", r))
			os.Exit(guiWebRun())
		}
	}()
	st := guiStatusNow()
	mpcVal := firstNonEmpty(st.Ini["mpc"], st.Mpc)
	mpvVal := firstNonEmpty(st.Ini["mpv"], st.Mpv)
	// JRiver 的地址/密钥（窗口里只用来测连接；真正播放时用的是用户脚本里那份）
	jrVal := firstNonEmpty(st.Ini["jrurl"], jrDefaultURL)
	jrKeyVal := firstNonEmpty(st.Ini["jrkey"], jrDefaultKey)

	// 扫描很慢（几十秒），扫描期间把「找找看」按钮点不动
	var scanMpc, scanMpv *walk.PushButton
	scan := func(who string, edit *walk.LineEdit, btn *walk.PushButton) {
		if btn != nil {
			btn.SetEnabled(false)
		}
		statEdit.SetText("正在扫盘找播放器，可能要几十秒……\n（在 Program Files / C: D: / AppData 里按文件名找）")
		go func() {
			// 扫描是在后台跑的，万一里面出岔子（权限/怪路径）别把整个窗口弄挂，也别忘了把按钮放开
			defer func() {
				if r := recover(); r != nil {
					mw.Synchronize(func() {
						if btn != nil {
							btn.SetEnabled(true)
						}
						statEdit.SetText(fmt.Sprintf("扫描出错：%v", r))
					})
				}
			}()
			names := mpvNames
			if who == "mpc" {
				names = mpcNames
			}
			hits := deepFindExe(names)
			mw.Synchronize(func() {
				if btn != nil {
					btn.SetEnabled(true)
				}
				switch len(hits) {
				case 0:
					statEdit.SetText("没扫到。手动把 exe 路径填进去，或用「浏览…」。")
				case 1:
					edit.SetText(hits[0])
					statEdit.SetText("找到了，已填进路径框：\n" + hits[0] + "\n\n点「保存并注册协议」生效。")
				default:
					edit.SetText(hits[0])
					statEdit.SetText(fmt.Sprintf("找到 %d 个，已填第一个；要换就手动改路径：\n%s", len(hits), strings.Join(hits, "\n")))
				}
			})
		}()
	}

	refresh := func() {
		statEdit.SetText(statusText())
		logEdit.SetText(logText())
	}

	save := func() {
		out, code := captureRun(func() int {
			return installRun(mpcEdit.Text(), mpvEdit.Text(), jrEdit.Text(), jrKeyEdit.Text())
		})
		refresh()
		if code == 0 {
			showMessage("etlp 中继", "已保存并注册协议。\n刷新浏览器页面后，播放按钮就用这套设置了。")
		} else {
			showMessage("保存失败", out)
		}
	}

	// JRiver 只是测连通（MCWS 是 MC 自带的 HTTP 接口，播放不经中继）
	jrTest := func() {
		jrOut.SetText("测呢……")
		go func() {
			msg, err := jriverAlive(jrEdit.Text(), jrKeyEdit.Text())
			mw.Synchronize(func() {
				if err != nil {
					jrOut.SetText("✗ " + strings.ReplaceAll(err.Error(), "\n", "  "))
				} else {
					jrOut.SetText("✓ " + msg)
				}
			})
		}()
	}

	browse := func(edit *walk.LineEdit) {
		dlg := &walk.FileDialog{
			Title:  "选播放器 exe",
			Filter: "程序 (*.exe)|*.exe|所有文件 (*.*)|*.*",
		}
		if ok, err := dlg.ShowOpen(mw); err == nil && ok {
			edit.SetText(dlg.FilePath)
		}
	}

	if err := (MainWindow{
		AssignTo: &mw,
		Title:    "EmbyToLocalPlayer 直连版 · 中继设置",
		MinSize:  Size{Width: 800, Height: 620},
		Size:     Size{Width: 880, Height: 720},
		Layout:   VBox{},
		Children: []Widget{
			GroupBox{
				Title:  "播放器路径",
				Layout: Grid{Columns: 4, Spacing: 8},
				Children: []Widget{
					Label{Text: "MPC-HC", MinSize: Size{Width: 70}},
					LineEdit{AssignTo: &mpcEdit, Text: mpcVal, CueBanner: `D:\Program Files\MPC-HC\mpc-hc64.exe`},
					PushButton{Text: "浏览…", OnClicked: func() { browse(mpcEdit) }},
					PushButton{AssignTo: &scanMpc, Text: "找找看", OnClicked: func() { scan("mpc", mpcEdit, scanMpc) }},

					Label{Text: "mpv", MinSize: Size{Width: 70}},
					LineEdit{AssignTo: &mpvEdit, Text: mpvVal, CueBanner: `D:\mpv-lazy-full\mpv.exe`},
					PushButton{Text: "浏览…", OnClicked: func() { browse(mpvEdit) }},
					PushButton{AssignTo: &scanMpv, Text: "找找看", OnClicked: func() { scan("mpv", mpvEdit, scanMpv) }},

					PushButton{Text: "保存并注册协议", ColumnSpan: 2, OnClicked: save},
					Label{Text: ""},
					PushButton{Text: "卸载协议", OnClicked: func() {
						if walk.MsgBox(mw, "etlp 中继", "把 etlp-mpc / etlp-mpv 两个协议从注册表删掉？\n（播放器路径配置保留）", walk.MsgBoxYesNo|walk.MsgBoxIconQuestion) == walk.DlgCmdYes {
							out, _ := captureRun(uninstallRun)
							refresh()
							showMessage("已卸载", out)
						}
					}},
				},
			},
			GroupBox{
				Title:  "JRiver Media Center（MCWS；不用中继，MC 自己收）",
				Layout: Grid{Columns: 4, Spacing: 8},
				Children: []Widget{
					Label{Text: "地址", MinSize: Size{Width: 70}},
					LineEdit{AssignTo: &jrEdit, Text: jrVal, ColumnSpan: 2, CueBanner: jrDefaultURL},
					PushButton{Text: "测试连接", OnClicked: jrTest},

					Label{Text: "访问密钥", MinSize: Size{Width: 70}},
					LineEdit{AssignTo: &jrKeyEdit, Text: jrKeyVal, ColumnSpan: 2, CueBanner: "MC → 工具 → 选项 → 媒体网络 → 访问密钥"},
					Label{Text: ""},

					Label{Text: "结果", MinSize: Size{Width: 70}},
					LineEdit{AssignTo: &jrOut, ReadOnly: true, ColumnSpan: 3},
				},
			},
			GroupBox{
				Title:  "状态",
				Layout: VBox{},
				Children: []Widget{
					TextEdit{AssignTo: &statEdit, ReadOnly: true, VScroll: true, MinSize: Size{Height: 130}},
				},
			},
			GroupBox{
				Title:  "日志（etlp-relay.log 最后 200 行）",
				Layout: VBox{},
				Children: []Widget{
					TextEdit{AssignTo: &logEdit, ReadOnly: true, VScroll: true, HScroll: true, StretchFactor: 1},
					Composite{
						Layout: HBox{},
						Children: []Widget{
							PushButton{Text: "刷新日志", OnClicked: refresh},
							PushButton{Text: "打开日志文件夹", OnClicked: func() { _ = openFolder(logDir()) }},
							PushButton{Text: "自检", OnClicked: func() {
								out, code := captureRun(selfTestRun)
								statEdit.SetText(out)
								if code == 0 {
									showMessage("自检", "全部通过 ✓")
								} else {
									showMessage("自检有失败项", out)
								}
							}},
						},
					},
				},
			},
		},
	}).Create(); err != nil {
		showMessage("启动失败", "设置窗口起不来："+err.Error())
		return 1
	}
	// 任务栏/标题栏图标：rsrc 打进去的资源，manifest 是 1 号，图标组是 2 号
	if ic, err := walk.NewIconFromResourceId(2); err == nil {
		_ = mw.SetIcon(ic)
	}

	refresh()
	mw.Run()
	return 0
}

func statusText() string {
	st := guiStatusNow()
	var b strings.Builder
	fmt.Fprintf(&b, "版本 %s\n中继 exe：%s\n配置文件：%s\n", st.Version, st.Exe, st.IniPath)
	fmt.Fprintf(&b, "MPC-HC：%s\n", firstNonEmpty(st.Mpc, "没找到（点「找找看」或手动填）"))
	fmt.Fprintf(&b, "mpv：%s\n", firstNonEmpty(st.Mpv, "没找到（点「找找看」或手动填）"))
	fmt.Fprintf(&b, "JRiver：%s（密钥 %s；播放走 MCWS 直连，不经中继）\n",
		firstNonEmpty(st.Ini["jrurl"], jrDefaultURL), maskKey(firstNonEmpty(st.Ini["jrkey"], jrDefaultKey)))
	for _, s := range schemes {
		fmt.Fprintf(&b, "协议 %s → %s\n", s, firstNonEmpty(st.Protocols[s], "（没注册，点上面的「保存并注册协议」）"))
	}
	return b.String()
}

func maskKey(k string) string {
	if len(k) <= 2 {
		return "**"
	}
	return k[:1] + strings.Repeat("*", len(k)-1)
}

func logText() string {
	return tailFile(logPath("etlp-relay.log"), 200)
}

func logDir() string {
	return filepath.Dir(logPath("etlp-relay.log"))
}

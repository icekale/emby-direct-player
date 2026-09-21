package main

import "testing"

// 和 ps1 版 -SelfTest 同样的用例：协议解析 + 参数拼装
func TestParseRelay(t *testing.T) {
	cases := []struct {
		in     string
		scheme string
		url    string
		ms     int64
	}{
		// 真机原样：浏览器 encodeURIComponent 后管道符是 %7C%7C（这个用例就是 mpv 不播放的那个 bug）
		{
			"etlp-mpv:http%3A%2F%2F10.0.0.9%3A8096%2Femby%2FVideos%2F4405924%2Fstream.mkv%3FStatic%3Dtrue%26MediaSourceId%3Dmediasource_4405924%26api_key%3D0123456789abcdef%7C%7C106915",
			"etlp-mpv", "http://10.0.0.9:8096/emby/Videos/4405924/stream.mkv?Static=true&MediaSourceId=mediasource_4405924&api_key=0123456789abcdef", 106915,
		},
		{"etlp-mpc:http%3A%2F%2Fh%2Fa.mkv", "etlp-mpc", "http://h/a.mkv", 0},
		{"etlp-mpv:http%3A%2F%2Fh%2Fa%20b.mkv||90500", "etlp-mpv", "http://h/a b.mkv", 90500},
		{"etlp-mpv:http%3A%2F%2Fh%2Fa.mkv%3Fx%3D1%26y%3D2", "etlp-mpv", "http://h/a.mkv?x=1&y=2", 0},
		{"etlp-mpv:http%3A%2F%2Fh%2Fa%2Bb.mkv", "etlp-mpv", "http://h/a+b.mkv", 0}, // '+' 不能变成空格
		{"etlp-mpv:http%3A%2F%2Fh%2Fa.mkv||abc12345", "etlp-mpv", "http://h/a.mkv", 12345},
	}
	for _, c := range cases {
		r, err := parseRelay(c.in)
		if err != nil {
			t.Fatalf("%s: %v", c.in, err)
		}
		if r.scheme != c.scheme || r.url != c.url || r.ms != c.ms {
			t.Fatalf("%s: 得到 %+v", c.in, r)
		}
	}
	for _, bad := range []string{"http://h/a.mkv", "etlp-xxx:abc", ""} {
		if _, err := parseRelay(bad); err == nil {
			t.Fatalf("%q 应该报错", bad)
		}
	}
}

func TestArgs(t *testing.T) {
	if got := startSecs(90500); got != "90.5" {
		t.Fatal("startSecs:", got)
	}
	if got := startSecs(90000); got != "90" {
		t.Fatal("startSecs:", got)
	}
	if got := startSecs(90555); got != "90.6" {
		t.Fatal("startSecs:", got)
	}
	if a := mpvArgs(relayReq{ms: 29999}); len(a) != 3 || a[0] != "--force-window=yes" || a[2] != "--no-ytdl" {
		t.Fatal("不到 30 秒不该带 --start，但三个保底参数必须有:", a)
	}
	if a := mpvArgs(relayReq{ms: 30000}); len(a) != 4 || a[3] != "--start=30" {
		t.Fatal("mpvArgs:", a)
	}
	if a := mpcArgs(relayReq{}); len(a) != 0 {
		t.Fatal("MPC-HC 只接 URL，不该有别的参数")
	}
}

// 用户实测的坑：从聊天里复制过去的 -SelfTest 带着零宽字符，标准库 flag 直接报 not defined
func TestParseArgs(t *testing.T) {
	p := func(args ...string) options { return parseArgs(append([]string{"etlp-relay.exe"}, args...)) }

	if o := p("-SelfTest"); !o.selfTest {
		t.Fatal("-SelfTest 没认出来")
	}
	if o := p("-selftest"); !o.selfTest {
		t.Fatal("小写没认出来")
	}
	if o := p("-Self\u200bTest"); !o.selfTest {
		t.Fatal("带零宽字符没认出来")
	}
	if o := p("-\uff0dStatus"); !o.status {
		t.Fatal("全角连字符没认出来")
	}
	if o := p("-Install", "-Mpc", `C:\a\m.exe`, "-Mpv", `D:\p.exe`); !o.install || o.mpc != `C:\a\m.exe` || o.mpv != `D:\p.exe` {
		t.Fatalf("-Mpc/-Mpv 取值不对：%+v", o)
	}
	if o := p(`-mpv=D:\p.exe`); o.mpv != `D:\p.exe` {
		t.Fatalf("-mpv= 形式不对：%+v", o)
	}
	if o := p(`etlp-mpc:http%3A%2F%2Fh%2Fa.mkv||90500`); o.raw != `etlp-mpc:http%3A%2F%2Fh%2Fa.mkv||90500` || o.install {
		t.Fatalf("协议链接应该收进 raw：%+v", o)
	}
	if o := p("-Bogus"); len(o.unknown) != 1 {
		t.Fatalf("不认识的参数没报出来：%+v", o)
	}
}

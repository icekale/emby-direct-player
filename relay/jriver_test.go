package main

// JRiver MCWS 探活的单元测试（用一个假 MC 顶替真 MC）
import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestJriverAliveRealPayload(t *testing.T) {
	// 用户那台 MC（LibraryVersion 24）的真实应答：没有 Version 项，以前就卡在这儿报「读不懂」
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<Response Status="OK">
<Item Name="RuntimeGUID">{3F891A93-BE0F-4E79-9E99-8D8BEB8B9FC0}</Item>
<Item Name="LibraryVersion">24</Item>
</Response>`))
	}))
	defer srv.Close()

	msg, err := jriverAlive(srv.URL, "TESTKEY")
	if err != nil {
		t.Fatalf("回了 Status=OK 就该算通，却报错：%v", err)
	}
	if !strings.Contains(msg, "通了") || !strings.Contains(msg, "库版本 24") {
		t.Fatalf("该把可读的信息带出来，实际：%s", msg)
	}

	// 401（密钥/认证不对）得说清楚是 HTTP 的事，不能含糊成「读不懂」
	srv401 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(401)
		w.Write([]byte(`<Response Status="Error">Unauthorized</Response>`))
	}))
	defer srv401.Close()
	if _, err := jriverAlive(srv401.URL, "bad"); err == nil || !strings.Contains(err.Error(), "HTTP 401") {
		t.Fatalf("401 该报 HTTP 401，实际：%v", err)
	}
}

func TestJriverAlive(t *testing.T) {
	var asked string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		asked = r.URL.Path + "?" + r.URL.RawQuery
		if r.URL.Path != "/MCWS/v1/Alive" { // 不带 /MCWS 的地址应该被补成 /MCWS/v1/Alive
			w.WriteHeader(404)
			return
		}
		fmt.Fprint(w, `<?xml version="1.0"?><Response Status="OK"><Item Name="Version">31.0.85</Item></Response>`)
	}))
	defer srv.Close()

	msg, err := jriverAlive(srv.URL, "TESTKEY")
	if err != nil {
		t.Fatalf("应该能通，却报错：%v", err)
	}
	if !strings.Contains(msg, "31.0.85") {
		t.Fatalf("没从应答里读出 MC 版本：%s", msg)
	}
	if !strings.Contains(asked, "AccessKey=TESTKEY") || !strings.Contains(asked, "token=TESTKEY") {
		t.Fatalf("两种密钥写法都该带上，实际问的是：%s", asked)
	}

	if _, err := jriverAlive(srv.URL+"/nope", "k"); err == nil {
		t.Fatal("MC 回 404 时应该报错（密钥不对就得让人看出来）")
	}
	if _, err := jriverAlive("", "k"); err != nil && !strings.Contains(err.Error(), "127.0.0.1:52199") {
		t.Fatalf("地址留空该回落到默认地址，实际：%v", err)
	}
}

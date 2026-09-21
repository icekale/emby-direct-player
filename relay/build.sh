#!/usr/bin/env bash
# 打 Windows 版中继（在 macOS/Linux 上交叉编译：walk 是纯 Go，不需要 cgo）
#   ./build.sh            只编译
#   ./build.sh --deploy   编译 + 直推 NAS（Windows 那边双击就能用）
#
# 部署走 SSH 直写 NAS 磁盘，不再用 /Volumes/main 那个 WebDAV 挂载：
# macOS 的 webdavfs 会静默吞掉写入 —— 本地 ls 看着文件都在，NAS 上其实一个都没有
# （2026-09-21 就这么翻的车：共享目录空了，本地缓存里还好好的）。
# 推完逐个文件比 md5，落地了才算完；文件属主/权限对齐共享目录的习惯（nobody:users + 666）。
set -euo pipefail
cd "$(dirname "$0")"

# 部署目标（NAS 地址 + 共享目录）不入库：同目录放一个 .deploy.env（已 gitignore），里面写两行：
#   NAS="root@10.0.0.2"
#   NAS_SHARE="/mnt/user/xxx/webdav/main/emby-direct-player"
if [ -f .deploy.env ]; then . ./.deploy.env; fi

[ -f app.ico ] || python3 make_icon.py
if [ ! -f rsrc_windows_amd64.syso ]; then
  # 图标 + manifest 打进 exe（manifest 决定控件外观和 DPI 缩放，缺了窗口会很难看）
  go run github.com/akavel/rsrc@latest -manifest app.manifest -ico app.ico -o rsrc_windows_amd64.syso
fi

GOOS=windows GOARCH=amd64 CGO_ENABLED=0 \
  go build -trimpath -ldflags "-H=windowsgui -s -w" -o etlp-relay.exe .
echo "built etlp-relay.exe $(du -h etlp-relay.exe | cut -f1)"

if [ "${1:-}" = "--deploy" ]; then
  if [ -z "${NAS:-}" ] || [ -z "${NAS_SHARE:-}" ]; then
    echo "要 --deploy 就先在 relay/.deploy.env 里写好 NAS 和 NAS_SHARE"
    exit 1
  fi
  STAGE="$(mktemp -d)"
  TMP="$(mktemp -d)"
  trap 'rm -rf "$STAGE" "$TMP"' EXIT

  # 先把要交付的东西摆成一个和 NAS 上一模一样的目录树，推完拿它的清单核对
  cp etlp-relay.exe "$STAGE/"
  cp ../README.md ../embyToLocalPlayer.direct.user.js ../direct_module.js ../build.py \
    ../selftest.mjs ../upstream.js "$STAGE/"
  mkdir -p "$STAGE/relay"
  for f in *.go *.html *.sh *.py *.manifest *.ico go.mod go.sum; do
    [ -e "$f" ] && cp -f "$f" "$STAGE/relay/"
  done

  (cd "$STAGE" && find . -type f | LC_ALL=C sort) >"$TMP/files"
  (cd "$STAGE" && while read -r f; do shasum -a 256 "$f"; done <"$TMP/files" | LC_ALL=C sort) >"$TMP/want"
  # 算不出校验和就别往下走：空着比对的“全对”是假绿（macOS 的 md5 在 /sbin，PATH 里没有）
  [ "$(grep -c '^[0-9a-f]\{64\}  ' "$TMP/want")" = "$(wc -l <"$TMP/files" | tr -d ' ')" ] ||
    {
      echo "本地算不出 sha256 校验和，先别推"
      exit 1
    }

  ssh -o BatchMode=yes "$NAS" "
    set -e
    d='$NAS_SHARE'
    mkdir -p \"\$d/relay\"
    # 清掉上一世代平铺的源码、AppleDouble 垃圾和 mirror 里的 exe
    rm -f \"\$d\"/*.go \"\$d\"/gui.html \"\$d\"/._* \"\$d\"/写入测试.txt \
          \"\$d\"/relay/etlp-relay.exe \"\$d\"/relay/rsrc_windows_amd64.syso
    tar xf - -C \"\$d\"
    chown -R nobody:users \"\$d\"
    chmod 666 \"\$d\"/* \"\$d\"/relay/*
    chmod 777 \"\$d\" \"\$d/relay\"
    # macOS 的 tar 会把 xattr 写成 ._* 伴生文件，Windows 上会跟真文件混在一起，推完擦掉
    rm -f \"\$d\"/._* \"\$d\"/relay/._*
  " < <(COPYFILE_DISABLE=1 tar cf - -C "$STAGE" .)

  ssh -o BatchMode=yes "$NAS" "cd '$NAS_SHARE' && while IFS= read -r f; do sha256sum \"\$f\"; done < /dev/stdin" \
    <"$TMP/files" | LC_ALL=C sort >"$TMP/got"

  if diff -u "$TMP/want" "$TMP/got" >"$TMP/diff"; then
    echo "deployed -> $NAS_SHARE（$(wc -l <"$TMP/files" | tr -d ' ') 个文件，sha256 全对）"
  else
    echo "✗ 校验不过：NAS 上的内容和本地对不上，别当它推上去了"
    head -20 "$TMP/diff"
    exit 1
  fi
fi

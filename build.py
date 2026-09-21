#!/usr/bin/env python3
"""把 direct_module.js 打进上游 embyToLocalPlayer.user.js，生成直连版油猴脚本。

用法: python3 build.py
上游脚本: 先试 greasyfork，失败则用本目录 upstream.js（缓存）。

三个插入点:
  1. header: 加 @connect localhost / @connect *，改版本号，删掉自动更新地址（不然会被原版覆盖掉直连功能）
  2. 直连模块: 整段插在 `let serverName = null;` 之前
  3. dealWithPlaybackInfo 里: 开启直连时改走 dpPlay()
  4. 媒体库卡片 ▶ 按钮那条路（deailWithItemInfo）: 同样改走 dpPlay()
  5. 5 处网页播放闸门（webPlayerEnable）: 换成 dpIntercept()，直连开着时强制拦截，不再落到网页播放
  6. 菜单: mountDiskEnable 那行后加 直连开关/设置/测试连接
  7. 详情页按钮: 由 direct_module.js 自带的 dpSyncDetailButtons 负责
"""
import pathlib
import re
import subprocess
import sys
import urllib.request
from typing import NoReturn

HERE = pathlib.Path(__file__).resolve().parent
UPSTREAM_URL = 'https://update.greasyfork.org/scripts/448648/embyToLocalPlayer.user.js'
CACHE = HERE / 'upstream.js'
OUT = HERE / 'embyToLocalPlayer.direct.user.js'
MODULE = HERE / 'direct_module.js'
BASE_VERSION = '2026.02.11'      # 上游版本，build 时校验
PATCH_VERSION = '2.2'            # 直连版自己的版本号，发版时改这里（relay/logic.go 里的 const version 要同步改）
REPO_URL = 'https://github.com/icekale/emby-direct-player'


def fail(msg) -> NoReturn:
    sys.exit('build 失败: ' + msg)


def load_upstream():
    if CACHE.exists():
        return CACHE.read_text(encoding='utf-8')
    req = urllib.request.Request(UPSTREAM_URL, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        text = urllib.request.urlopen(req, timeout=30).read().decode('utf-8')
    except Exception as e:
        fail(f'{UPSTREAM_URL} 拿不到 ({e})，也不在 {CACHE}')
    CACHE.write_text(text, encoding='utf-8')
    return text


def patch_once(text, old, new, what):
    if text.count(old) != 1:
        fail(f'锚点 {what} 命中 {text.count(old)} 次（上游改版了，需要重新对锚点）')
    return text.replace(old, new)


def main():
    src = load_upstream()
    module = MODULE.read_text(encoding='utf-8').replace('__DP_VERSION__', PATCH_VERSION)

    if f'// @version      {BASE_VERSION}' not in src:
        print('注意: 上游版本不是 ' + BASE_VERSION + '，仍按锚点打补丁')

    # 1. header
    src = patch_once(src, '// @connect      127.0.0.1',
                     '// @connect      127.0.0.1\n// @connect      localhost\n// @connect      *', '@connect')
    # 名字/命名空间/@author 改成直连版自己的，不然装了上游的人分不清两个脚本，油猴也会当成同一个脚本互相顶掉
    src = patch_once(src, '// @name         embyToLocalPlayer\n// @name:zh-CN   embyToLocalPlayer\n// @name:en      embyToLocalPlayer',
                     '// @name         embyToLocalPlayer 直连版\n// @name:zh-CN   embyToLocalPlayer 直连版\n// @name:en      embyToLocalPlayer Direct', '@name')
    src = patch_once(src, '// @namespace    https://github.com/kjtsune/embyToLocalPlayer',
                     f'// @namespace    {REPO_URL}', '@namespace')
    src = patch_once(src, '// @author       Kjtsune',
                     f'// @author       Kjtsune, icekale\n// @homepageURL  {REPO_URL}\n// @supportURL   {REPO_URL}/issues', '@author')
    src = patch_once(src, f'// @version      {BASE_VERSION}', f'// @version      {PATCH_VERSION}', '@version')
    src = re.sub(r'^// @(download|update)URL .*\n', '', src, flags=re.M)
    src = src.replace('// @description  Emby/Jellyfin 调用外部本地播放器，并回传播放记录。适配 Plex。',
                      '// @description  Emby/Jellyfin 调用外部本地播放器，并回传播放记录。适配 Plex。直连版: 多一个不需要 Python 的直连模式（MPC-HC / JRiver MCWS / mpv）。')

    # 2. 模块
    src = patch_once(src, '\n    let serverName = null;', '\n' + module + '\n    let serverName = null;', 'serverName')

    # 3. 播放入口（详情页/卡片 ▶ 点击拦截后走这里）
    src = patch_once(src, """            let _req = options ? options : raw_url;
            playNotifiy();
            embyToLocalPlayer(url, _req, playbackData, extraData);
            return true;""",
        """            let _req = options ? options : raw_url;
            if (dpEnabled()) {
                dpPlay(playbackData, extraData, itemId).catch(e => {
                    logger.error('直连: 播放异常', e);
                    alert('直连播放出错，看控制台日志：' + e);
                });
                return true;
            }
            playNotifiy();
            embyToLocalPlayer(url, _req, playbackData, extraData);
            return true;""", 'dealWithPlaybackInfo')

    # 3b. 媒体库卡片上的 ▶ 按钮走的是另一条路（deailWithItemInfo），也要转直连
    src = patch_once(src, """        embyToLocalPlayer(playbackUrl, {}, playbackData, extraData)
    }""",
        """        if (dpEnabled()) {
            dpPlay(playbackData, extraData, itemId).catch(e => {
                logger.error('直连: 播放异常', e);
                alert('直连播放出错，看控制台日志：' + e);
            });
            return true;
        }
        embyToLocalPlayer(playbackUrl, {}, playbackData, extraData)
    }""", 'deailWithItemInfo')

    # 3c. 五处「网页播放」闸门：直连开着时无视「脚本在当前服务器 已禁用」，强制拦截
    for old, new in [
        ("if (urlStr.indexOf('IsPlayback=true') != -1 && localStorage.getItem(etlpStorageKeys.webPlayerEnable) != 'true') {",
         "if (urlStr.indexOf('IsPlayback=true') != -1 && dpIntercept()) {"),
        ("} else if (urlStr.indexOf('/Playing/Stopped') != -1 && localStorage.getItem(etlpStorageKeys.webPlayerEnable) != 'true') {",
         "} else if (urlStr.indexOf('/Playing/Stopped') != -1 && dpIntercept()) {"),
        ("if (catchPlex && localStorage.getItem(etlpStorageKeys.webPlayerEnable) != 'true') {",
         "if (catchPlex && dpIntercept()) {"),
        ("if (catchJellyfin && localStorage.getItem(etlpStorageKeys.webPlayerEnable) != 'true') {",
         "if (catchJellyfin && dpIntercept()) {"),
        ("if (localStorage.getItem(etlpStorageKeys.webPlayerEnable) == 'true') { return; }",
         "if (!dpIntercept()) { return; }"),
    ]:
        src = patch_once(src, old, new, '网页播放闸门 ' + old[:36])

    # 4. 网页播放总闸门: 直连开关开着就一律拦截
    # 4a. 新版网页客户端用 POST /Items/{id}/PlaybackInfo（没有 IsPlayback 查询参数），只认请求体
    src = patch_once(src, """            if (urlStr.indexOf('/PlaybackInfo?UserId') != -1) {""",
        """            if (dpEnabled() && urlStr.indexOf('PlaybackInfo') != -1
                && /"(IsPlayback|AutoOpenLiveStream)"\\s*:\\s*true/.test(String((options || {}).body || ''))) {
                let dealRes = await dealWithPlaybackInfo(input, urlStr, options);
                if (dealRes && dealRes != 'disableForLiveTv') { return; }
            }
            if (urlStr.indexOf('/PlaybackInfo?UserId') != -1) {""", 'POST PlaybackInfo')

    # 4b. 被拦下的播放如果不能起播（异常），别静默清掉响应，明确报出来
    src = patch_once(src, """        } catch (error) {
            logger.error(error, input, urlStr);
            removeErrorWindowsMultiTimes();
            return""",
        """        } catch (error) {
            logger.error(error, input, urlStr);
            removeErrorWindowsMultiTimes();
            if (dpEnabled() && urlStr.indexOf('IsPlayback=true') != -1 && !window.__etlpDpAlerted) {
                window.__etlpDpAlerted = true;
                alert('直连: 已拦下网页播放，但起播失败。看 Console 里 etlp / 直连 的报错（多数是播放器没开或地址填错）。要先用网页播放：油猴菜单 → 关闭「直连播放器」开关。');
            }
            return""", 'fetch catch')

    # 5. 菜单（开关默认开启，与 direct_module.js 里的 dpEnabled 默认值一致）
    src = patch_once(src, "    setModeSwitchMenu(etlpStorageKeys.mountDiskEnable, '读取硬盘模式已经 ');",
        "    setModeSwitchMenu(etlpStorageKeys.mountDiskEnable, '读取硬盘模式已经 ');\n"
        "    setModeSwitchMenu(dpKeys.enable, '直连播放器(MPC-HC/JRiver) 已', '', '开启', '开启', '关闭');\n"
        "    setCallbackMenu('直连播放器: 设置', dpShowConfig);\n"
        "    setCallbackMenu('直连播放器: 测试连接', dpTestConnection);\n"
        "    setCallbackMenu('直连播放器: 按钮自检', dpButtonCheck);\n"
        "    setCallbackMenu('直连播放器: JRiver 试播探测', dpJriverProbe);", '菜单')

    OUT.write_text(src, encoding='utf-8')
    print(f'已生成 {OUT}  ({len(src) // 1024} KB, 版本 {PATCH_VERSION})')

    if subprocess.run(['which', 'node'], capture_output=True).returncode == 0:
        subprocess.run(['node', '--check', str(OUT)], check=True)
        print('node --check 通过')
        subprocess.run(['node', str(HERE / 'selftest.mjs')], check=True)
    else:
        print('跳过语法检查: 没装 node')


if __name__ == '__main__':
    main()

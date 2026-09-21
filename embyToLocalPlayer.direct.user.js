// ==UserScript==
// @name         embyToLocalPlayer 直连版
// @name:zh-CN   embyToLocalPlayer 直连版
// @name:en      embyToLocalPlayer Direct
// @namespace    https://github.com/icekale/emby-direct-player
// @version      2.2
// @description  Emby/Jellyfin 调用外部本地播放器，并回传播放记录。适配 Plex。直连版: 多一个不需要 Python 的直连模式（MPC-HC / JRiver MCWS / mpv）。
// @description:zh-CN Emby/Jellyfin 调用外部本地播放器，并回传播放记录。适配 Plex。
// @description:en  Play in an external player. Update watch history to Emby/Jellyfin server. Support Plex.
// @author       Kjtsune, icekale
// @homepageURL  https://github.com/icekale/emby-direct-player
// @supportURL   https://github.com/icekale/emby-direct-player/issues
// @match        *://*/web/index.html*
// @match        *://*/*/web/index.html*
// @match        *://*/web/
// @match        *://*/*/web/
// @match        https://app.emby.media/*
// @match        https://app.plex.tv/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=emby.media
// @grant        unsafeWindow
// @grant        GM_info
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @run-at       document-start
// @connect      127.0.0.1
// @connect      localhost
// @connect      *
// @license MIT
// ==/UserScript==
'use strict';
/*global ApiClient*/

(function () {
    'use strict';
    let fistTime = true;
    let config = {
        logLevel: 2,
        disableOpenFolder: undefined, // undefined 改为 true 则禁用打开文件夹的按钮。
        crackFullPath: undefined,
        disableForLiveTv: undefined, // undefined 改为 true 则在浏览器里播放 IPTV。
        enableResumeReorder: true, // true 改为 undefined 则禁用。继续观看的前2位不变, 余下近3天更新的前移。
        resumeHideSomeSeries: undefined, // undefined 改为 true 则启用隐藏特定电视剧的油猴功能菜单。
    };

    let etlpStorageKeys = {
        webPlayerEnable: 'webPlayerEnable',
        mountDiskEnable: 'mountDiskEnable',
        crackFullPath: 'etlpCrackFullPath',
        resumeHide: 'etlpResumeHideSomeSeries',
        cacheResumeIds: 'etlpCacheResumeIds',
        hideSeriesIds: 'etlpResumeHideSeriesIds',
    }

    const originFetch = fetch;

    let logger = {
        error: function (...args) {
            if (config.logLevel >= 1) {
                console.log('%cERROR', 'color: #fff; background: #d32f2f; font-weight: bold; padding: 2px 6px; border-radius: 3px;', ...args);
            }
        },
        info: function (...args) {
            if (config.logLevel >= 2) {
                console.log('%cINFO', 'color: #fff; background: #1976d2; font-weight: bold; padding: 2px 6px; border-radius: 3px;', ...args);
            }
        },
        debug: function (...args) {
            if (config.logLevel >= 3) {
                console.log('%cDEBUG', 'color: #333; background: #ffeb3b; font-weight: bold; padding: 2px 6px; border-radius: 3px;', ...args);
            }
        },
    };

    function myBool(value) {
        if (Array.isArray(value) && value.length === 0) return false;
        if (value !== null && typeof value === 'object' && Object.keys(value).length === 0) return false;
        return Boolean(value);
    }

    async function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function isHidden(el) {
        return (el.offsetParent === null);
    }

    function getVisibleElement(elList) {
        if (!elList) return;
        if (Object.prototype.isPrototypeOf.call(NodeList.prototype, elList)) {
            for (let i = 0; i < elList.length; i++) {
                if (!isHidden(elList[i])) {
                    return elList[i];
                }
            }
        } else {
            return elList;
        }
    }

    function overwriteConfByStore() {
        function overwriteByKey(confKey) {
            let confLocal = localStorage.getItem(confKey);
            if (confLocal == null) return;
            if (confLocal == 'true') {
                GM_setValue(confKey, true);

            } else if (confLocal == 'false') {
                GM_setValue(confKey, false);
            }
            let confGM = GM_getValue(confKey, null);
            if (confGM !== null) {
                // 注意：etlpResumeHideSomeSeries 转换为 resumeHideSomeSeries。
                let _confKey = confKey.replace(/^etlp/, '');
                _confKey = _confKey.charAt(0).toLowerCase() + _confKey.slice(1);
                config[_confKey] = confGM;
            };
        }
        overwriteByKey(etlpStorageKeys.crackFullPath);
        overwriteByKey(etlpStorageKeys.resumeHide);
    }

    function playNotifiy(title = '正在播放', subtitle = '开始享受您的内容') {
        if (!document.getElementById('play-notification-style')) {
            const style = document.createElement('style');
            style.id = 'play-notification-style';
            style.textContent = `
                @keyframes slideIn { from { transform: translateX(400px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
                @keyframes slideOut { from { transform: translateX(0); opacity: 1; } to { transform: translateX(400px); opacity: 0; } }
                @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
            `;
            document.head.appendChild(style);
        }

        const notification = document.createElement('div');
        notification.innerHTML = `
            <svg width="40" height="40" viewBox="0 0 24 24" style="animation: pulse 1.5s ease-in-out infinite; flex-shrink: 0;">
                <circle cx="12" cy="12" r="10" stroke="white" stroke-width="2" fill="none" opacity="0.3"/>
                <path d="M9 8L17 12L9 16V8Z" fill="white"/>
            </svg>
            <div>
                <div style="font-weight: 600; font-size: 16px;">${title}</div>
                <div style="font-size: 13px; opacity: 0.9;">${subtitle}</div>
            </div>
        `;

        notification.style.cssText = `
            position: fixed; bottom: 30px; right: 30px; z-index: 999999;
            background: linear-gradient(135deg, #0296beff 0%, #008a51ff 100%);
            border-radius: 12px; padding: 20px 25px; color: white;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
            display: flex; align-items: center; gap: 15px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            animation: slideIn 0.5s ease-out;
        `;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.animation = 'slideOut 0.5s ease-in';
            setTimeout(() => notification.remove(), 500);
        }, 3000);
    }

    let menuRegistry = [];
    let registeredMenus = [];

    function switchLocalStorage(key, defaultValue = 'true', trueValue = 'true', falseValue = 'false') {
        if (key in localStorage) {
            let value = (localStorage.getItem(key) === trueValue) ? falseValue : trueValue;
            localStorage.setItem(key, value);
        } else {
            localStorage.setItem(key, defaultValue);
        }
        logger.info('switchLocalStorage', key, 'to', localStorage.getItem(key));
    }

    function registerAllMenus() {
        registeredMenus.forEach(id => GM_unregisterMenuCommand(id));
        registeredMenus = [];

        menuRegistry.forEach(item => {
            let id;

            if (item.type === 'switch') {
                let title = item.menuStart + item.switchNameMap[localStorage.getItem(item.storageKey)] + item.menuEnd;
                id = GM_registerMenuCommand(title, () => {
                    switchLocalStorage(item.storageKey);
                    registerAllMenus(); // 刷新菜单显示
                });
            } else if (item.type === 'callback') {
                id = GM_registerMenuCommand(item.title, item.callback);
            }

            registeredMenus.push(id);
            item.menuId = id;
        });
    }

    function setModeSwitchMenu(storageKey, menuStart = '', menuEnd = '', defaultValue = '关闭', trueValue = '开启', falseValue = '关闭') {
        let switchNameMap = { 'true': trueValue, 'false': falseValue, null: defaultValue };

        menuRegistry.push({
            type: 'switch',
            storageKey,
            menuStart,
            menuEnd,
            switchNameMap
        });

        registerAllMenus();
    }

    function setCallbackMenu(title, callback) {
        menuRegistry.push({
            type: 'callback',
            title,
            callback
        });

        registerAllMenus();
    }

    function hideCurrentSeries() {
        const urlMatch = window.location.href.match(/id=(\d+)/);
        let hint = '请在需要隐藏的电视剧【条目根页面】操作';
        if (!urlMatch) {
            alert(hint);
            return;
        }

        const seriesId = urlMatch[1];
        if (!seriesId) {
            alert(hint);
            return;
        }

        let hideList = [];
        const stored = localStorage.getItem(etlpStorageKeys.hideSeriesIds);
        if (stored) {
            try {
                hideList = JSON.parse(stored);
            } catch (e) {
                logger.error('解析隐藏列表失败:', e);
                hideList = [];
            }
        }

        if (!hideList.includes(seriesId)) {
            hideList.push(seriesId);
            localStorage.setItem(etlpStorageKeys.hideSeriesIds, JSON.stringify(hideList));
            logger.info('已隐藏电视剧, SeriesId:', seriesId);
            alert(`已隐藏该电视剧，注意要电视剧条目主页面操作 SeriesId=${seriesId}`);
        } else {
            alert('该电视剧已在隐藏列表中');
        }
    }

    function resetHiddenSeries() {
        localStorage.removeItem(etlpStorageKeys.hideSeriesIds);
        logger.info('已重置隐藏设置');
        alert('已重置隐藏设置,刷新页面后生效');
    }

    function removeErrorWindows() {
        let okButtonList = document.querySelectorAll('button[data-id="ok"]');
        let state = false;
        for (let index = 0; index < okButtonList.length; index++) {
            const element = okButtonList[index];
            if (element.textContent.search(/.+/) != -1) {
                element.click();
                if (isHidden(element)) { continue; }
                state = true;
            }
        }

        let jellyfinSpinner = document.querySelector('div.docspinner');
        if (jellyfinSpinner) {
            jellyfinSpinner.remove();
            state = true;
        };

        let plexErrorSelector = '[class*="Modal-small"] [class*="ModalContent-modalContent"] [class*="PlayerErrorModal-modalHeader"]';
        if (document.querySelector(plexErrorSelector)) {
            let escEvent = new KeyboardEvent('keydown', {
                key: 'Escape',
                keyCode: 27,
                code: 'Escape',
                which: 27,
                bubbles: true,
            });
            document.dispatchEvent(escEvent);
            state = true;
        }

        return state;
    }

    async function removeErrorWindowsMultiTimes() {
        for (const times of Array(15).keys()) {
            await sleep(200);
            if (removeErrorWindows()) {
                logger.info(`remove error window used time: ${(times + 1) * 0.2}`);
                break;
            };
        }
    }

    function sendDataToLocalServer(data, path) {
        let url = `http://127.0.0.1:58000/${path}/`;
        GM_xmlhttpRequest({
            method: 'POST',
            url: url,
            data: JSON.stringify(data),
            headers: {
                'Content-Type': 'application/json'
            },
            onerror: function (error) {
                alert(`${url}\n请求错误，本地服务未运行，请查看使用说明。\nhttps://github.com/kjtsune/embyToLocalPlayer`);
                console.error('请求错误:', error);
            }
        });
        logger.info(path, data);
    }

/* ============ 直连播放器 begin (MPC-HC / JRiver / MPV，不需要 Python 本地服务) ============
 * 只做直链：把 Emby 的 /Videos/{id}/stream?Static=true 直接交给本机播放器，并把进度回传给 Emby。
 * - JRiver : Media Center 的 MCWS HTTP 接口（默认 http://127.0.0.1:52199）
 * - MPC-HC : 它的网页界面只能打开本地路径，所以起播走自定义协议 etlp-mpc: → 注册表 → 中继（etlp-relay.exe，老版是 etlp-mpc-relay.ps1）→ mpc-hc.exe <直链>；进度/定位走网页界面
 * - MPV    : 同理走 etlp-mpv: → 同一个中继（etlp-relay.exe）→ mpv.exe（无网页界面，所以只有起播+续播定位，没有进度回传）
 * 开关与设置：油猴菜单里的「直连播放器」。详情页播放按钮旁边还有三个「指定播放器」按钮。
 */
const dpKeys = {
    enable: "directPlayerEnable",
    mode: "directPlayerMode",
    jriver: "directPlayerJriverHost",
    jrkey: "directPlayerJriverKey",
    jrNoUrl: "directPlayerJriverNoUrl", // 记住「哪个直链主机 MC 收不了」，换主机后自动重试（值 = 直链的 origin）
    streamBase: "directPlayerStreamBase", // 直链主机（实测反代端口拿到的直链只能 302 到网盘 CDN，JRiver 不吃）
    urlFrom: "directPlayerUrlFrom", // 直链来源：auto(默认) / path(用媒体源原始链接) / emby(只用 Emby 直连构造)
    lastUrl: "directPlayerLastUrl", // 上一条直链（给「试播探测」当测试素材）
    probeIdx: "directPlayerProbeIdx", // 探测走到第几种写法了
    zone: "directPlayerJriverZone",
    mpc: "directPlayerMpcHost",
};
const dpRelayScheme = "etlp-mpc";
const dpRelaySchemeMpv = "etlp-mpv";
const dpStore = {
    get(k, d = "") {
        try {
            const v = localStorage.getItem(k);
            return v === null ? d : v;
        } catch {
            return d;
        }
    },
    set(k, v) {
        try {
            localStorage.setItem(k, v);
        } catch {}
    },
};
const dpTrim = (s) =>
    String(s || "")
        .trim()
        .replace(/\/+$/, "");
const dpSleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 默认开启：直连版就是为了走 PC 播放器；菜单里关掉即回到网页播放
const dpEnabled = () => dpStore.get(dpKeys.enable, "true") === "true";
// 直连开关一开就无视「脚本在当前服务器 已禁用」：必须拉起 PC 播放器，不能在网页里播
const dpIntercept = () =>
    dpEnabled() ||
    localStorage.getItem(etlpStorageKeys.webPlayerEnable) != "true";
const dpConf = () => ({
    mode: (dpStore.get(dpKeys.mode, "jriver") || "jriver").toLowerCase(),
    jriver: dpTrim(dpStore.get(dpKeys.jriver, "http://127.0.0.1:52199")),
    jrkey: dpStore.get(dpKeys.jrkey, ""),
    zone: dpStore.get(dpKeys.zone, "-1") || "-1",
    mpc: dpTrim(dpStore.get(dpKeys.mpc, "http://127.0.0.1:13579")),
    streamBase: dpTrim(dpStore.get(dpKeys.streamBase, "")), // 留空 = 跟着当前网页地址走
    urlFrom: (dpStore.get(dpKeys.urlFrom, "auto") || "auto").toLowerCase(),
});

function dpHttp(url, opts = {}) {
    const { method = "GET", headers, data, timeout = 4000 } = opts;
    return new Promise((resolve) => {
        GM_xmlhttpRequest({
            method,
            url,
            headers,
            data,
            timeout,
            onload: (r) =>
                resolve({
                    ok: r.status >= 200 && r.status < 400,
                    status: r.status,
                    text: r.responseText || "",
                }),
            onerror: () => resolve({ ok: false, status: 0, text: "" }),
            ontimeout: () => resolve({ ok: false, status: 0, text: "" }),
        });
    });
}

// MPC-HC /variables.html 是 <p id="state">2</p> 这种格式
function dpParseVars(html) {
    const out = {};
    const re = /id="([^"]+)"[^>]*>([^<]*)</g;
    let m;
    while ((m = re.exec(html || "")) !== null) {
        out[m[1]] = m[2].trim();
    }
    return out;
}

// MPC-HC 的定位格式：wm_command=-1&position=h:m:s:ms
function dpTimeSyntax(ms) {
    ms = Math.max(0, Math.round(ms || 0));
    return [
        Math.floor(ms / 3600000),
        Math.floor((ms % 3600000) / 60000),
        Math.floor((ms % 60000) / 1000),
        ms % 1000,
    ].join(":");
}

// 播放器里现在播的是不是我们这一条（用 Emby itemId 判断）。返回 false = 不判断/判断不了。
function dpPlayingOther(file, itemId) {
    if (!file || !itemId) return false;
    let s = String(file);
    try {
        s = decodeURIComponent(s);
    } catch {}
    if (!/:\/\//.test(s)) return false; // 本地路径不判断
    return !s.includes(itemId);
}

// ---- JRiver MCWS ----
// 响应形如 <Response Status="OK"><Item Name="Position">123</Item></Response>
function dpXmlItems(text) {
    const out = {};
    if (!text) return out;
    try {
        const doc = new DOMParser().parseFromString(text, "application/xml");
        for (const it of doc.getElementsByTagName("Item")) {
            out[it.getAttribute("Name")] = it.textContent;
        }
        out.__status = doc.documentElement
            ? doc.documentElement.getAttribute("Status") || ""
            : "";
        out.__error = doc.documentElement
            ? doc.documentElement.getAttribute("Error") || ""
            : "";
    } catch (e) {
        logger.error("直连: MCWS 解析失败", e);
    }
    return out;
}
const dpMcwsOk = (r) => r.ok && dpXmlItems(r.text).__status !== "Failure";

// MCWS 认证：访问秘钥（JRiver 的 Access Key，六位字母）。两种写法都带上，多余的参数 MC 会忽略：
// 新版认 token=（/MCWS/v1/Authenticate 拿到的 Token 也走这个参数），老版/官方文档用 AccessKey=。
// ponytail: 只支持访问秘钥一种凭据；哪天要用户名/密码，再补 Authenticate + Basic。
function dpJrAuthParams(conf) {
    return conf.jrkey ? { AccessKey: conf.jrkey, token: conf.jrkey } : {};
}

function dpJriverCall(conf, path, params = {}) {
    const q = new URLSearchParams({
        ...params,
        ...dpJrAuthParams(conf),
        Zone: conf.zone,
    });
    return dpHttp(`${conf.jriver}/MCWS/v1/${path}?${q}`);
}

// 判据：“MC 里正在播的 Filename 是不是我们这条”（直链里带 Emby 的 itemId）—— 只有真的在播才算成功
async function dpJriverPlaying(conf, itemId) {
    const r = await dpJriverCall(conf, "Playback/Info");
    if (!r.ok) return false;
    const f = dpXmlItems(r.text).Filename;
    return !!f && String(f).includes(itemId);
}

// Emby 直链里的条目 id：/Videos/<id>/stream 或 /audio/<id>/stream（可能带子路径前缀）
const dpItemIdFromUrl = (url) =>
    (String(url).match(/\/([\w-]{16,})\//) || [])[1] || "";

// 起播：先试官方干净写法（PlayByFilename），不行再试「MC 命令行原样丢 URL」（= File→Open URL）。
// 都不行就交给对话框兜底（直链自动进剪贴板）。
// 失败记住的是「直链主机」不是 true，所以换直链地址（比如把反代端口换成 Emby 自己的端口）会自动重试，不会永久卡在对话框。
async function dpJriverStart(conf, url, itemId) {
    const host = dpUrlHost(url);
    if (dpStore.get(dpKeys.jrNoUrl, "") === host)
        return { err: "（这个地址的直链这台 MC 收不了，直接走对话框）" };
    const attempts = [
        ["Playback/PlayByFilename", { Filenames: url }], // 官方文档写法，等于 MC 自己的「打开 URL」
        ["Control/CommandLine", { CommandLine: url }], // MC 命令行 = mediacenter.exe "URL"
    ];
    const errs = [];
    let reachable = false;
    for (const [path, params] of attempts) {
        const r = await dpJriverCall(conf, path, params);
        if (r.status > 0) reachable = true;
        const d = dpXmlItems(r.text);
        if (!dpMcwsOk(r)) {
            errs.push(
                `${path}=${(d.__error || "HTTP " + r.status).slice(0, 60)}`,
            );
            continue;
        }
        for (let i = 0; i < 4 && itemId; i++) {
            // 「真的在播了」才算成功
            if (await dpJriverPlaying(conf, itemId)) {
                logger.info("直连: JRiver 起播方式", path);
                return { how: path };
            }
            await dpSleep(700);
        }
        errs.push(`${path}(OK 但没播起来)`);
    }
    if (reachable) dpStore.set(dpKeys.jrNoUrl, host); // MC 在线还是不吃直链 → 记住这个主机（MC 关了不记，免得误判）
    const err = errs.join("  ");
    logger.error("直连: JRiver 起播失败", err);
    return { err };
}

// 实在起不来：官方唯一的路 = 「打开 URL」（MCC 20001）+ 手工粘一次。
// 掉坑记录 1：别发 Control/Key 模拟 Ctrl+V —— 实测 MC 不认这个键位写法，只会往那个 URL 栏里留个字符（'c' / 'C'）。
// 掉坑记录 2：别信 navigator.clipboard —— Emby 页面是 http://（非安全上下文），navigator.clipboard 根本不存在；
//   execCommand('copy') 在 await fetch 之后调用也常被浏览器静默拒绝（user activation 已过期 / 文档没焦点）
//   → 结果就是剪贴板里还是旧内容（用户粘出来是个 'C'）。
//   所以这里用 prompt：文本默认全选，用户自己 Ctrl+C（他的手势永远有效），确认后再开 MC 的窗口。
function dpUrlHost(url) {
    try {
        return new URL(url).origin;
    } catch {
        return "";
    }
}

// 复制到剪贴板。Emby 网页往往跑在 http://（非安全上下文），那里 navigator.clipboard 根本不存在，
// 只能「造个 textarea + 选中 + execCommand('copy')」：它只要求文档有过用户激活，不要求安全上下文。
// （实测：http 页 + await fetch 两秒之后再调用，仍能成功写入系统剪贴板——已用 pbpaste 验证）
function dpCopyText(text) {
    try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ta.setSelectionRange(0, text.length);
        const ok = document.execCommand("copy");
        ta.remove();
        return ok;
    } catch (e) {
        logger.error("直连: 复制直链失败", e);
        return false;
    }
}

// 兜底：直链写进剪贴板 + 打开 MC 自己的「打开 URL」窗口（用户只需 Ctrl+V 回车）
async function dpJriverOpenUrlDialog(conf, url) {
    const copied = dpCopyText(url);
    await dpJriverCall(conf, "Control/MCC", { Command: "20001" });
    return copied;
}

// 试播探测：一次点一个候选写法，把 MC 的原话（HTTP + 响应）直接弹出来。
// 目的：不靠猜地摸清这台 MC 吃哪种写法。元组第 3 项 = 先发个 MCC（'20001' = 先开「打开 URL」窗口）。
// 注意：探测会动 Playing Now（SetPlaylist 那条），别在放歌的时候点。
const dpProbeList = [
    ["Playback/PlayByFilename", { Filenames: "{url}" }],
    [
        "Playback/PlayByFilename",
        { Filenames: "{url}", Filename: "{url}", Location: "End" },
    ],
    ["Playback/PlayLive", { Filenames: "{url}" }],
    ["Playback/SetPlaylist", { Filenames: "{url}", __play: 1 }], // 会弹「无播放内容」的就是它
    ["Control/CommandLine", { CommandLine: "{url}" }], // 裸 URL 当命令行参数
    ["Control/CommandLine", { CommandLine: '/Command:"MCC_OPEN_URL|{url}"' }],
    ["Control/CommandLine", { CommandLine: '/PlayReplace "{url}"' }],
    // 下面几条：先开「打开 URL」窗口，再试不同的组合键写法 —— 哪种能把剪贴板里的直链填进 URL 栏，就是要找的那个
    ["Control/Key", { Key: "Ctrl+V" }, "20001"],
    ["Control/Key", { Key: "CTRL+V" }, "20001"],
    ["Control/Key", { Key: "{Ctrl}{V}" }, "20001"],
    ["Control/Key", { Key: "^v" }, "20001"],
];

async function dpJriverProbe() {
    const conf = dpConf();
    const url = dpStore.get(dpKeys.lastUrl, "");
    if (!url)
        return alert(
            "先在 Emby 里点一次播放（失败没关系），脚本要那条直链才能试。",
        );
    const i = Number(dpStore.get(dpKeys.probeIdx, "0")) % dpProbeList.length;
    const [path, tplIn, preMcc] = dpProbeList[i];
    const tpl = { ...tplIn };
    const thenPlay = !!tpl.__play;
    delete tpl.__play;
    const params = {};
    for (const k in tpl) params[k] = tpl[k].replace("{url}", url);
    if (preMcc) {
        // 先开「打开 URL」窗口，再试键位写法
        await dpJriverCall(conf, "Control/MCC", { Command: preMcc });
        await dpSleep(1500);
    }
    const r = await dpJriverCall(conf, path, params);
    const d = dpXmlItems(r.text);
    let txt =
        `第 ${i + 1}/${dpProbeList.length} 种：${path}\n参数：${JSON.stringify(params)}\n` +
        `HTTP ${r.status}${d.__status ? " Status=" + d.__status : ""}${d.__error ? " Error=" + d.__error : ""}\n` +
        `${(r.text || "(空响应)").replace(/\s+/g, " ").slice(0, 300)}`;
    if (thenPlay) {
        await dpJriverCall(conf, "Playback/Play");
        txt +=
            "\n（这条后面跟着一个 Playback/Play —— MC 里弹「无播放内容」的就是它）";
    }
    if (dpMcwsOk(r)) {
        const id = dpItemIdFromUrl(url);
        let played = false;
        for (let k = 0; k < 4 && id && !played; k++) {
            played = await dpJriverPlaying(conf, id);
            if (!played) await dpSleep(700);
        }
        txt += `\n\n起播了？${!id ? "拿不到条目 id，看不出" : played ? "是 ✅（就是它，告诉我）" : "否"}`;
    }
    dpStore.set(dpKeys.probeIdx, String(i + 1));
    const tail = preMcc
        ? `\n\n看 JRiver 那个「打开流媒体文件」窗口：URL 栏里是不是填上了这条直链？（没填 = 这个键位写法 MC 不认）\n看完点「取消」关掉窗口，再点菜单试下一种。`
        : "\n\n再点一次菜单 = 试下一种（循环）。";
    alert(txt + tail);
}

function dpJriverPoller(conf, itemId) {
    let playingValue = null; // MC 的 State 数值语义没权威文档，第一次「位置在走」的那个值就是播放中
    let lastPos = -1;
    return async () => {
        const r = await dpJriverCall(conf, "Playback/Info");
        if (!r.ok) return null;
        const d = dpXmlItems(r.text);
        if (dpPlayingOther(d.Filename, itemId)) return { gone: true };
        const posMs = Number(d.Position) || 0;
        if (lastPos >= 0 && posMs > lastPos && playingValue === null)
            playingValue = String(d.State);
        lastPos = posMs;
        const playing =
            playingValue === null
                ? posMs > 0
                : String(d.State) === playingValue;
        return {
            playing,
            paused: !playing,
            posMs,
            durMs: Number(d.Duration) || 0,
        };
    };
}

// 续播定位：只在 MC 真的加载了东西之后才发 Position —— 空 Playing Now 上定位，MC 可能弹「无播放内容」。
async function dpJriverSeek(conf, ms) {
    if (ms < 30000) return;
    let loaded = "";
    for (let i = 0; i < 60; i++) {
        // 给到 30 秒：对话框路线下用户还要手动粘一下
        const r = await dpJriverCall(conf, "Playback/Info");
        if (r.ok) loaded = dpXmlItems(r.text).Filename || "";
        if (loaded) break;
        await dpSleep(500);
    }
    if (!loaded) {
        logger.info("直连: 没等到 MC 开始播，跳过续播定位");
        return;
    }
    const r = await dpJriverCall(conf, "Playback/Position", {
        Position: String(Math.round(ms)),
    });
    if (!dpMcwsOk(r))
        logger.error(
            "直连: JRiver 续播定位失败(可忽略)",
            r.status,
            (r.text || "").slice(0, 200),
        );
}

// ---- MPC-HC ----
const dpMpcPoll = async (conf, itemId) => {
    const r = await dpHttp(`${conf.mpc}/variables.html`, { timeout: 2500 });
    if (!r.ok) return null;
    const d = dpParseVars(r.text);
    if (dpPlayingOther(d.filepath, itemId)) return { gone: true };
    const out = {
        posMs: Number(d.position) || 0,
        durMs: Number(d.duration) || 0,
    };
    const state = Number(d.state);
    if (state === 2) {
        out.playing = true;
    } else if (state === 1) {
        out.playing = false;
        out.paused = true;
    } else if (state === 0) {
        out.playing = false;
        out.stopped = true;
    } else {
        out.idle = true;
    } // -1 = 还没加载媒体
    return out;
};

async function dpMpcSeek(conf, ms) {
    if (ms < 30000) return;
    for (let i = 0; i < 16; i++) {
        const r = await dpHttp(`${conf.mpc}/variables.html`, { timeout: 2500 });
        if (r.ok && Number(dpParseVars(r.text).duration) > 0) break;
        await dpSleep(500);
    }
    const q = new URLSearchParams({
        wm_command: "-1",
        position: dpTimeSyntax(ms),
    });
    const r = await dpHttp(`${conf.mpc}/command.html?${q}`);
    logger.info("直连: MPC-HC 续播", dpTimeSyntax(ms), r.status);
}

// ---- 回传 Emby ----
// 直链地址。两个踩过的坑：
// 1) 不带扩展名：Emby 会 302 到网盘 CDN（Content-Type: application/xml），JRiver 这种挑嘴的播放器不吃；
//    补上 .mkv/.mp4 后，Emby 直接吐 video/x-matroska + Accept-Ranges（实测 ✓）。
// 2) 经反代端口拿到的直链就是 302 那条；Emby 自己的端口才是干净流。
//    （补扩展名同理：不带 .mkv/.mp4 的地址也是 302 那条，外频播放器很多不吃）
//    所以允许在设置里写「直链主机」，只换 scheme://host:port，路径前缀（/emby）照样跟着网页走。
function dpStreamUrl(itemId, ms, playbackData) {
    const conf = dpConf();
    // 媒体源原始链接（.strm / 网盘直链）：http(s) 就直接用 —— 播器自己会跟着 302 走（PotPlayer/MPC 都会）。
    // 实测：这类链接是网盘/网盘直链服务自己的解析地址，它自己也会 302 到 CDN。
    const src = String(ms?.Path || "");
    if (
        src &&
        /^https?:/i.test(src) &&
        (conf.urlFrom === "path" ||
            (conf.urlFrom === "auto" && !conf.streamBase))
    )
        return src;
    const token =
        ApiClient?._userAuthInfo?.AccessToken ||
        ApiClient?._serverInfo?.AccessToken ||
        "";
    const ext = String(ms?.Container || "")
        .split(",")[0]
        .trim();
    const path = `/Videos/${itemId}/stream${ext ? "." + ext : ""}`;
    const params = {
        Static: "true",
        MediaSourceId: ms?.Id || itemId,
        PlaySessionId: playbackData?.PlaySessionId || "",
        api_key: token,
    };
    const base = (conf.streamBase || "").replace(/\/+$/, "");
    if (!base) return ApiClient.getUrl(path, params);
    const pageUrl = ApiClient.getUrl(path);
    const pagePath = pageUrl.replace(/^[a-z]+:\/\/[^/]+/i, "");
    const basePath = (base.match(/^[a-z]+:\/\/[^/]+(\/.*)?$/i) || [])[1] || "";
    const tail =
        basePath && pagePath.startsWith(basePath)
            ? pagePath.slice(basePath.length)
            : pagePath;
    return `${base}${tail}?${new URLSearchParams(params)}`;
}

async function dpReport(ctx, kind, posMs, isPaused) {
    const path = {
        start: "/Sessions/Playing",
        progress: "/Sessions/Playing/Progress",
        stop: "/Sessions/Playing/Stopped",
    }[kind];
    const body = {
        ItemId: ctx.itemId,
        MediaSourceId: ctx.msId,
        PlaySessionId: ctx.playSessionId,
        PlayMethod: "DirectStream",
        PositionTicks: Math.round((posMs || 0) * 10000),
        RepeatMode: "RepeatNone",
        CanSeek: true,
    };
    if (kind === "progress") {
        body.EventName = "timeupdate";
        body.IsPaused = Boolean(isPaused);
    }
    try {
        await ApiClient.ajax({
            type: "POST",
            url: ApiClient.getUrl(path),
            data: JSON.stringify(body),
            contentType: "application/json",
        });
        if (kind === "progress") logger.debug("直连: 回传进度", posMs);
        else logger.info("直连: 回传", kind, posMs);
    } catch (e) {
        logger.error("直连: 回传失败", kind, e);
    }
}

async function dpMonitor(ctx, poll) {
    await dpReport(ctx, "start", ctx.resumeMs, false);
    let lastMs = ctx.resumeMs || 0;
    let playedOnce = false;
    let miss = 0;
    let tick = 0;
    const deadline = Date.now() + 6 * 3600 * 1000; // ponytail: 6 小时上限，防止页面一直开着时无限轮询
    while (Date.now() < deadline) {
        await dpSleep(3000);
        const st = await poll();
        if (st === null || st.idle) {
            // 播放器没响应 / 还没加载
            miss++;
            if (playedOnce && miss >= 3) break;
            continue;
        }
        if (st.gone) break; // 播放器换片或关掉了
        miss = 0;
        if (st.posMs > 0) lastMs = st.posMs;
        if (st.stopped) {
            if (playedOnce) break;
            continue;
        } // MPC-HC 里按了停止
        const isPaused = Boolean(st.paused);
        if (!isPaused) playedOnce = true;
        if (playedOnce && ctx.runMs > 0 && lastMs >= ctx.runMs - 5000) break; // 播完了
        if (++tick % 4 === 0) await dpReport(ctx, "progress", lastMs, isPaused); // 约每 12 秒
    }
    await dpReport(ctx, "stop", lastMs, false);
}

async function dpPlay(playbackData, extraData, itemId) {
    const conf = dpConf();
    const mode = dpModeOverride || conf.mode; // 详情页那三个按钮可以临时指定播放器
    const main = extraData?.mainEpInfo || {};
    const ms = playbackData?.MediaSources?.[0] || {};
    const ctx = {
        itemId,
        msId: ms.Id || itemId,
        playSessionId: playbackData?.PlaySessionId || "",
        runMs: Math.round((main.RunTimeTicks || ms.RunTimeTicks || 0) / 10000),
        resumeMs: Math.round(
            (main?.UserData?.PlaybackPositionTicks || 0) / 10000,
        ),
    };
    const url = dpStreamUrl(itemId, ms, playbackData);
    dpStore.set(dpKeys.lastUrl, url); // 给「JRiver 试播探测」当测试素材
    logger.info("直连: 起播", mode, conf.zone, url);
    // 网页那边因为「播放被拦下」会弹「播放错误」，顺手关掉（上游现成的函数，找不到就自己放弃）
    removeErrorWindowsMultiTimes().catch(() => {});

    if (mode === "jriver") {
        playNotifiy("正在播放 (JRiver)", main.Name || "");
        const firstTime = !dpStore.get(dpKeys.jrNoUrl, "");
        const started = await dpJriverStart(conf, url, itemId);
        if (!started.how) {
            const copied = await dpJriverOpenUrlDialog(conf, url);
            if (!copied)
                prompt("直链（Ctrl+C 复制 → 到 JRiver 窗口 Ctrl+V 回车）", url); // 复制不到才让用户手拿，且每次都给
            if (firstTime) {
                alert(
                    `JRiver 没能自动起播：${started.err}\n\n${copied ? "直链已经复制到剪贴板" : "直链在上一个输入框里（Ctrl+C 复制）"}；JRiver 的「打开 URL」窗口已经帮你弹出 → 在里面 Ctrl+V、回车。\n（同一个直链主机只弹一次这个说明；右下角小提示会一直在）\n想完全不手工：把模式换成 mpc。`,
                );
            } else if (copied) {
                playNotifiy(
                    "JRiver 需要按一下 Ctrl+V",
                    "直链已在剪贴板，MC 的「打开 URL」框已弹出：Ctrl+V 回车",
                );
            }
        }
        // 对话框路线也继续监控：粘完开始播之后进度回传/续播定位照旧生效
        dpMonitor(ctx, dpJriverPoller(conf, itemId)).catch((e) =>
            logger.error("直连: 监控异常", e),
        );
        dpJriverSeek(conf, ctx.resumeMs).catch((e) =>
            logger.error("直连: 续播异常", e),
        );
        return true;
    }

    if (mode === "mpc" || mode === "mpv") {
        const isMpv = mode === "mpv";
        const who = isMpv ? "MPV" : "MPC-HC";
        if (!isMpv) {
            // MPV 没有网页界面，只有 MPC-HC 需要先开它（回传进度/续播定位靠它）
            const alive = await dpHttp(`${conf.mpc}/variables.html`, {
                timeout: 2500,
            });
            if (!alive.ok) {
                alert(
                    `MPC-HC 网页界面 (${conf.mpc}) 打不开，先启动 MPC-HC 并开启：选项 → 网页界面 → 勾选「监听端口 ${conf.mpc.split(":").pop()}」。\n（回传进度靠这个接口，所以必须先打开。）`,
                );
                return false;
            }
        }
        playNotifiy(`正在播放 (${who})`, main.Name || "");
        const copied = isMpv ? dpCopyText(url) : false; // MPV 没有可查的网页接口，中继没装/找不到 mpv.exe 时靠剪贴板当退路
        if (copied)
            playNotifiy(
                "MPV 没自动起来的话",
                "直链已在剪贴板：到 mpv 窗口按 Ctrl+V 回车（会自动弹一次打开文件框）",
            );
        // 自定义协议只能传字符串：注册表 → 中继（etlp-relay.exe）→ mpc-hc.exe / mpv.exe，直链（+续播位置）必须编码
        const launch = document.createElement("a");
        launch.href = dpRelayHref(mode, url, ctx.resumeMs);
        launch.style.display = "none";
        document.body.appendChild(launch);
        launch.click();
        launch.remove();
        if (isMpv) {
            // ponytail: MPV 没有可查的播放状态接口（命名管道浏览器连不上），所以不回传进度；
            // 要的话得让中继开个本地 HTTP 端口来转发 mpv 的 IPC。
            logger.info("直连: MPV 已起播（无进度回传）", ctx.resumeMs);
        } else {
            dpMonitor(ctx, () => dpMpcPoll(conf, itemId)).catch((e) =>
                logger.error("直连: 监控异常", e),
            );
            dpMpcSeek(conf, ctx.resumeMs).catch((e) =>
                logger.error("直连: 续播异常", e),
            );
        }
        return true;
    }

    logger.error("直连: 模式没设置", mode);
    alert("直连播放器模式没设置，请在油猴菜单里打开「直连播放器: 设置」。");
    return false;
}

function dpShowConfig() {
    const cur = dpConf();
    const mode = prompt(
        "直连播放器模式（详情页那三个按钮不受这里影响，它们各自指定播放器）：\njriver = JRiver Media Center（MCWS）\nmpc = MPC-HC（需先装 etlp-mpc 协议中继）\nmpv = MPV（需装同一个中继，它会连 etlp-mpv 也一起注册）\n\n中继下载（Windows 单文件，双击就是设置窗口）：\nhttps://github.com/icekale/emby-direct-player/releases/latest/download/etlp-relay.exe",
        cur.mode,
    );
    if (mode !== null) dpStore.set(dpKeys.mode, mode.trim().toLowerCase());
    dpStore.set(dpKeys.jrNoUrl, ""); // 设置改过就重试一次 MCWS 直链起播
    const jr = prompt(
        "JRiver MCWS 地址（Library Server，默认端口 52199）",
        cur.jriver,
    );
    if (jr !== null) dpStore.set(dpKeys.jriver, dpTrim(jr));
    const jrkey = prompt(
        "JRiver 访问秘钥（选项 → 媒体网络 里的 Access Key，六位字母；没有认证就留空）",
        cur.jrkey,
    );
    if (jrkey !== null) dpStore.set(dpKeys.jrkey, jrkey.trim());
    const zone = prompt(
        "JRiver Zone（-1 = 当前区域；也可填 0/1/2 或区域名）",
        cur.zone,
    );
    if (zone !== null) dpStore.set(dpKeys.zone, zone.trim());
    const mpc = prompt(
        "MPC-HC 网页界面地址（选项 → 网页界面 里的监听端口，默认 13579）",
        cur.mpc,
    );
    if (mpc !== null) dpStore.set(dpKeys.mpc, dpTrim(mpc));
    const sbase = prompt(
        "直链主机（留空 = 跟着当前网页地址走）\n什么时候需要改：网页走反代端口时，从那里拿到的直链可能 302 到网盘 CDN（外部播放器多半不吃），改成 Emby 自己的端口（例：http://192.168.1.10:8096）更稳\n（路径前缀 /emby 会自动跟着网页走，不用写）",
        cur.streamBase,
    );
    if (sbase !== null) dpStore.set(dpKeys.streamBase, dpTrim(sbase));
    const from = prompt(
        "直链来源：auto = 下面两空才用媒体源原始链接 / path = 总是优先用媒体源原始链接（.strm 网盘直链）/ emby = 总是用 Emby 直连",
        cur.urlFrom,
    );
    if (from !== null)
        dpStore.set(dpKeys.urlFrom, from.trim().toLowerCase() || "auto");
    const now = dpConf();
    alert(
        `已保存：\n开关 = ${dpEnabled() ? "开启" : "关闭"}（用菜单里的开关切换）\n模式 = ${now.mode}\nJRiver = ${now.jriver}  Zone=${now.zone}  秘钥=${now.jrkey || "(空)"}\nMPC-HC = ${now.mpc}\n直链主机 = ${now.streamBase || "(用网页地址)"}  直链来源 = ${now.urlFrom}`,
    );
}

async function dpTestConnection() {
    const conf = dpConf();
    const jrQuery = new URLSearchParams(dpJrAuthParams(conf)).toString();
    const jr = await dpHttp(
        `${conf.jriver}/MCWS/v1/Alive${jrQuery ? "?" + jrQuery : ""}`,
        { timeout: 3000 },
    );
    const mpc = await dpHttp(`${conf.mpc}/variables.html`, { timeout: 3000 });
    let fnList = "";
    if (jr.ok) {
        // MC 的 Web Service 是自文档的，把函数列表拉回来，一眼看出这台 MC 有哪些函数
        // （注意：要带访问秘钥，不然拿到的是登录页）
        const jrAuth = new URLSearchParams(dpJrAuthParams(conf));
        const idx = await dpHttp(
            `${conf.jriver}/MCWS/v1/${jrAuth.toString() ? "?" + jrAuth : ""}`,
            { timeout: 3000 },
        );
        const fns = [
            ...new Set(
                idx.text.match(
                    /(?:Playback|Playlist|Control|Library|Browse|File)\/[A-Za-z]+/g,
                ) || [],
            ),
        ].sort();
        fnList = fns.length
            ? `\n\nMCWS 函数 ${fns.length} 个：\n${fns.join("  ")}`
            : `\n\n/MCWS/v1/ 没解析出函数（HTTP ${idx.status}）：${(idx.text || "").replace(/\s+/g, " ").slice(0, 300)}`;
    }
    alert(
        `开关 = ${dpEnabled() ? "开启" : "关闭"}，模式 = ${conf.mode}\n` +
            `JRiver ${conf.jriver}：${jr.ok ? "通" : "不通 (" + jr.status + ")"}\n` +
            `MPC-HC ${conf.mpc}：${mpc.ok ? "通" : "不通 (" + mpc.status + ")"}\n\n` +
            `JRiver 不通：Media Center 要启动并开启 Library Server（选项 → 媒体网络）。\n` +
            `MPC-HC 不通：MPC-HC 要先启动，且选项 → 网页界面 勾选监听端口。` +
            fnList,
    );
}
const dpItemIdFromHash = (h) =>
    (String(h || "").match(/[?&]id=([\w-]+)/) || [])[1] || null;

async function dpPlayFromPage() {
    const id = dpItemIdFromHash(location.hash);
    if (!id) return alert("没识别到条目 id，请在条目详情页点这个按钮。");
    const item = await getItemInfoWithCace(id);
    if (!item || !item.Id) return alert("拿不到条目信息：" + id);
    await deailWithItemInfo(item);
}

/* ---- 详情页三个播放器按钮（MPC-HC / JRiver / MPV）------------------------
 * 放在 Emby 自己的 ▶ 播放按钮旁边，用哪个按钮就用哪个播放器（不看设置里的 mode）。
 * 样式匹配：不硬编码 Emby 的 class，而是把原生 ▶ 按钮的 class 抄过来（只去掉 btnPlay/btnResume/
 *   btnDownload 这种「哪个动作」的 class），图标用 Emby 自己的 md-icon 写法。
 * 不破坏页面：只当兄弟节点插入，不包装/不移动原有节点；找不到原生 ▶ 按钮就什么都不做；
 *   离开详情页或关掉直连就把自己删掉；Emby 重渲染后 1.5s 内自动补回。
 */
const dpPlayers = [
    ["mpc", "MPC-HC 播放", "theaters"],
    ["jriver", "JRiver 播放", "speaker"],
    ["mpv", "MPV 播放", "movie"],
];

function dpButtonBaseClass(cls) {
    const keep = String(cls || "")
        .split(/\s+/)
        .filter((c) => c && !/^btn(Play|Resume|Download|More)$/i.test(c));
    return keep.length
        ? keep.join(" ")
        : "raised button-submit block emby-button";
}

// 自定义协议只能传字符串：注册表 → 中继（etlp-relay.exe）→ mpc-hc.exe / mpv.exe；续播位置（>=30s 才带）跟在 || 后面
function dpRelayHref(mode, url, resumeMs) {
    const scheme = mode === "mpv" ? dpRelaySchemeMpv : dpRelayScheme;
    return (
        `${scheme}:${encodeURIComponent(url)}` +
        (resumeMs >= 30000 ? `||${Math.round(resumeMs)}` : "")
    );
}

let dpModeOverride = null; // 三个按钮临时指定的模式（dpPlay 里优先用它）

async function dpPlayWith(mode) {
    dpModeOverride = mode;
    try {
        await dpPlayFromPage();
    } finally {
        dpModeOverride = null;
    }
}

function dpRemoveDetailButtons() {
    for (const [mode] of dpPlayers) {
        const btn = document.getElementById("etlp-dp-btn-" + mode);
        if (btn) btn.remove();
    }
}

function dpSyncDetailButtons() {
    const id = dpEnabled() ? dpItemIdFromHash(location.hash) : null;
    if (!id) {
        dpRemoveDetailButtons();
        return;
    }
    // 拿原生 ▶ 按钮当锚点：它在哪，「播放按钮旁边」就是哪
    const play =
        document.querySelector(
            ".mainDetailButtons button.btnPlay, .detailButtons button.btnPlay, button.btnPlay",
        ) ||
        document.querySelector(
            ".mainDetailButtons button, .detailButtons button",
        );
    if (!play || !play.parentElement) return; // 还没渲染好 / 不是详情页
    const mine = document.getElementById("etlp-dp-btn-mpc");
    if (mine && play.parentElement.contains(mine)) return; // 已经插过了，别反复重建
    dpRemoveDetailButtons();
    const base = dpButtonBaseClass(play.className);
    let anchor = play; // 插在「播放/继续播放/下载」这一簇之后，不拆开它们
    while (
        /btn(Play|Resume|Download)/i.test(
            (anchor.nextElementSibling || {}).className || "",
        )
    )
        anchor = anchor.nextElementSibling;
    for (const [mode, label, icon] of dpPlayers) {
        const btn = document.createElement("button");
        btn.id = "etlp-dp-btn-" + mode;
        btn.type = "button";
        btn.className = base;
        btn.title = `直连播放：${label.replace(" 播放", "")}`;
        const ic = document.createElement("i");
        ic.className = "md-icon button-icon button-icon-left";
        ic.textContent = icon;
        btn.append(ic, label);
        btn.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            btn.disabled = true;
            dpPlayWith(mode)
                .catch((e) => {
                    logger.error("直连: 按钮播放异常", e);
                    alert("直连播放出错：" + e);
                })
                .finally(() => {
                    btn.disabled = false;
                });
        });
        anchor.insertAdjacentElement("afterend", btn);
        anchor = btn;
    }
}
// 菜单「直连播放器: 按钮自检」：不出按钮时把原因一次说清（顺便立刻同步一次，能插上就当场插上）
async function dpButtonCheck() {
    const ver =
        typeof GM_info !== "undefined" && GM_info.script
            ? GM_info.script.version
            : "未知";
    const id = dpItemIdFromHash(location.hash);
    const sel =
        ".mainDetailButtons button.btnPlay, .detailButtons button.btnPlay, button.btnPlay";
    const play =
        document.querySelector(sel) ||
        document.querySelector(
            ".mainDetailButtons button, .detailButtons button",
        );
    const row = play && play.parentElement;
    const have = () =>
        dpPlayers.filter(([m]) => document.getElementById("etlp-dp-btn-" + m))
            .length;
    const lines = [
        `脚本版本：${ver}（本版应该是 2.2；不是就重新导一次脚本）`,
        `直连开关：${dpEnabled() ? "开" : "关 —— 菜单里打开「直连播放器(MPC-HC/JRiver)」"}`,
        `地址：${location.href.slice(0, 150)}`,
        `条目 id：${id || "没识别到（这个详情页的 hash 里没有 id=，比如是搜索/列表页）"}`,
        `原生 ▶ 按钮：${play ? `<${play.tagName.toLowerCase()} class="${play.className}">“${(play.textContent || "").trim().slice(0, 10)}”` : "没找到"}`,
        `它所在的行：${row ? `class="${row.className}"，共 ${row.children.length} 个子元素` : "—"}`,
    ];
    if (row)
        lines.push(
            "行内子元素：" +
                [...row.children]
                    .map(
                        (c) =>
                            (c.id ||
                                (c.className || "").split(" ")[0] ||
                                c.tagName) +
                            "“" +
                            (c.textContent || "").trim().slice(0, 6) +
                            "”",
                    )
                    .join(" | "),
        );
    lines.push(`我的三个按钮：现在 ${have()}/3`);
    dpSyncDetailButtons();
    const now = have();
    lines.push("");
    lines.push(
        now === 3
            ? "自检里立刻同步一次 → 3/3 ✅（刚才是没同步上；还能看到按钮就直接用，下次刷新应该也有）"
            : `自检里立刻同步一次 → 还是 ${now}/3。把上面这段话发我。`,
    );
    alert(lines.join("\n"));
    logger.info("直连: 按钮自检", lines.join(" | "));
}

window.addEventListener("hashchange", dpSyncDetailButtons);
// Emby 是单页应用，详情页渲染/条目切换不触发 hashchange，用低频定时兜底
window.setInterval(dpSyncDetailButtons, 1500);
/* ============ 直连播放器 end ============ */

    let serverName = null;
    let episodesInfoCache = []; // ['type:[Episodes|NextUp|Items]', resp]
    let episodesInfoRe = /\/Episodes\?IsVirtual|\/NextUp\?Series|\/Items\?ParentId=\w+&Filters=IsNotFolder&Recursive=true/; // Items已排除播放列表
    // 点击位置：Episodes 继续观看，如果是即将观看，可能只有一集的信息 | NextUp 新播放或媒体库播放 | Items 季播放。 只有 Episodes 返回所有集的数据。
    let playlistInfoCache = null;
    let resumeRawInfoCache = null;
    let resumePlaybackCache = {};
    let resumeItemDataCache = {};
    let allPlaybackCache = {};
    let allItemDataCache = {};
    let episodesWithPathCache = {};

    let metadataChangeRe = /\/MetadataEditor|\/Refresh\?/;
    let metadataMayChange = false;

    function cleanOptionalCache() {
        resumeRawInfoCache = null;
        resumePlaybackCache = {};
        resumeItemDataCache = {};
        allPlaybackCache = {};
        allItemDataCache = {};
        episodesInfoCache = [];
        episodesWithPathCache = {};
    }

    function throttle(fn, delay) {
        let lastTime = 0;
        return function (...args) {
            const now = Date.now();
            if (now - lastTime >= delay) {
                lastTime = now;
                fn.apply(this, args);
            }
        };
    }

    let addOpenFolderElement = throttle(_addOpenFolderElement, 100);

    async function _addOpenFolderElement(itemId) {
        if (config.disableOpenFolder) return;
        let mediaSources = null;
        for (const _ of Array(5).keys()) {
            await sleep(500);
            mediaSources = getVisibleElement(document.querySelectorAll('div.mediaSources'));
            if (mediaSources) break;
        }
        if (!mediaSources) return;
        let pathDiv = mediaSources.querySelector('div[class^="sectionTitle sectionTitle-cards"] > div');
        if (!pathDiv || pathDiv.className == 'mediaInfoItems' || pathDiv.id == 'addFileNameElement') return;
        let full_path = pathDiv.textContent;
        if (!full_path.match(/[\\/:]/)) return;
        if (full_path.match(/\d{1,3}\.?\d{0,2} (MB|GB)/)) return;

        let itemData = (itemId in allItemDataCache) ? allItemDataCache[itemId] : null
        let strmFile = (full_path.startsWith('http')) ? itemData?.Path : null

        let openButtonHtml = `<a id="openFolderButton" is="emby-linkbutton" class="raised item-tag-button 
        nobackdropfilter emby-button" ><i class="md-icon button-icon button-icon-left">link</i>Open Folder</a>`
        pathDiv.insertAdjacentHTML('beforebegin', openButtonHtml);
        let btn = mediaSources.querySelector('a#openFolderButton');
        if (strmFile) {
            pathDiv.innerHTML = pathDiv.innerHTML + '<br>' + strmFile;
            full_path = strmFile; // emby 会把 strm 内的链接当路径展示
        }
        btn.addEventListener('click', () => {
            logger.info(full_path);
            sendDataToLocalServer({ full_path: full_path }, 'openFolder');
        });
    }

    async function addFileNameElement(resp) {
        let mediaSources = null;
        for (const _ of Array(5).keys()) {
            await sleep(500);
            mediaSources = getVisibleElement(document.querySelectorAll('div.mediaSources'));
            if (mediaSources) break;
        }
        if (!mediaSources) return;
        let pathDivs = mediaSources.querySelectorAll('div[class^="sectionTitle sectionTitle-cards"] > div');
        if (!pathDivs) return;
        pathDivs = Array.from(pathDivs);
        let _pathDiv = pathDivs[0];
        if (_pathDiv.id == 'addFileNameElement') return;
        let isAdmin = !/\d{4}\/\d+\/\d+/.test(_pathDiv.textContent); // 非管理员只有包含添加日期的文件类型 div
        let isStrm = _pathDiv.textContent.startsWith('http');
        if (isAdmin) {
            if (!isStrm) { return; }
            pathDivs = pathDivs.filter((_, index) => index % 2 === 0); // 管理员一个文件同时有路径和文件类型两个 div
        }

        let sources = await resp.clone().json();
        sources = sources.MediaSources;
        for (let index = 0; index < pathDivs.length; index++) {
            const pathDiv = pathDivs[index];
            let fileName = sources[index].Name; // 多版本的话，是版本名。
            let filePath = sources[index].Path;
            let strmFile = filePath.startsWith('http');
            if (!strmFile) {
                fileName = filePath.split('\\').pop().split('/').pop();
                fileName = (config.crackFullPath && !isAdmin) ? filePath : fileName;
            }
            let fileDiv = `<div id="addFileNameElement">${fileName}</div> `
            if (strmFile && (!isAdmin && config.crackFullPath)) {
                fileDiv = `<div id="addFileNameElement">${fileName}<br>${filePath}</div> `
            }
            pathDiv.insertAdjacentHTML('beforebegin', fileDiv);
        }
    }

    function makeItemIdCorrect(itemId) {
        if (serverName !== 'emby') { return itemId; }
        if (!resumeRawInfoCache || !episodesInfoCache) { return itemId; }
        let resumeIds = resumeRawInfoCache.map(item => item.Id);
        if (resumeIds.includes(itemId)) { return itemId; }
        let pageId = window.location.href.match(/\/item\?id=(\d+)/)?.[1];
        if (resumeIds.includes(pageId) && itemId == episodesInfoCache[0].Id) {
            // 解决从继续观看进入集详情页时，并非播放第一集，却请求首集视频文件信息导致无法播放。
            // 手动解决方法：从下方集卡片点击播放，或从集卡片再次进入集详情页后播放。
            // 本函数的副作用：集详情页底部的第一集卡片点播放按钮会播放当前集。
            // 副作用解决办法：再点击一次，或者点第一集卡片进入详情页后再播放。不过一般也不怎么会回头看第一集。
            return pageId;

        } else if (window.location.href.match(/serverId=/)) {
            return itemId; // 仅处理首页继续观看和集详情页，其他页面忽略。
        }
        let correctSeaId = episodesInfoCache.find(item => item.Id == itemId)?.SeasonId;
        let correctItemId = resumeRawInfoCache.find(item => item.SeasonId == correctSeaId)?.Id;
        if (correctSeaId && correctItemId) {
            logger.info(`makeItemIdCorrect, old=${itemId}, new=${correctItemId}`)
            return correctItemId;
        }
        return itemId;
    }

    async function embyToLocalPlayer(playbackUrl, request, playbackData, extraData) {
        let data = {
            ApiClient: ApiClient,
            playbackData: playbackData,
            playbackUrl: playbackUrl,
            request: request,
            mountDiskEnable: localStorage.getItem(etlpStorageKeys.mountDiskEnable),
            extraData: extraData,
            fistTime: fistTime,
        };
        sendDataToLocalServer(data, 'embyToLocalPlayer');
        removeErrorWindowsMultiTimes();
        fistTime = false;
    }

    async function apiClientGetWithCache(itemId, cacheList, funName) {
        if (!itemId) {
            logger.info(`Skip ${funName} ${itemId}`);
        }
        for (const cache of cacheList) {
            if (itemId in cache) {
                logger.info(`HIT ${funName} itemId=${itemId}`)
                return cache[itemId];
            }
        }
        logger.info(`MISS ${funName} itemId=${itemId}`)
        let resInfo;
        switch (funName) {
            case 'getPlaybackInfo':
                resInfo = await ApiClient.getPlaybackInfo(itemId);
                break;
            case 'getItem':
                resInfo = await ApiClient.getItem(ApiClient._serverInfo.UserId, itemId);
                break;
            case 'getEpisodes':
                {
                    let seasonId = itemId;
                    let options = {
                        'Fields': 'MediaSources,Path,ProviderIds',
                        'SeasonId': seasonId,
                    }
                    resInfo = await ApiClient.getEpisodes(seasonId, options);
                    break;
                }
            default:
                break;
        }
        for (const cache of cacheList) {
            if (funName == 'getPlaybackInfo') {
                // strm ffprobe 处理前后的外挂字幕 index 会变化，故不缓存。
                let runtime = resInfo?.MediaSources?.[0]?.RunTimeTicks;
                if (!runtime)
                    break;
            }
            cache[itemId] = resInfo;
        }
        return resInfo;
    }

    async function getPlaybackWithCace(itemId) {
        return apiClientGetWithCache(itemId, [resumePlaybackCache, allPlaybackCache], 'getPlaybackInfo');
    }

    async function getItemInfoWithCace(itemId) {
        return apiClientGetWithCache(itemId, [resumeItemDataCache, allItemDataCache], 'getItem');
    }

    async function getEpisodesWithCace(seasonId) {
        return apiClientGetWithCache(seasonId, [episodesWithPathCache], 'getEpisodes');
    }

    async function dealWithPlaybackInfo(raw_url, url, options) {
        console.time('dealWithPlaybackInfo');
        let rawId = url.match(/\/Items\/(\w+)\/PlaybackInfo/)[1];
        episodesInfoCache = episodesInfoCache[0] ? episodesInfoCache[1].clone() : null;
        let itemId = rawId;
        let [playbackData, mainEpInfo, episodesInfoData] = await Promise.all([
            getPlaybackWithCace(itemId), // originFetch(raw_url, request), 可能会 NoCompatibleStream
            getItemInfoWithCace(itemId),
            episodesInfoCache?.json(),
        ]);
        console.timeEnd('dealWithPlaybackInfo');
        episodesInfoData = (episodesInfoData && episodesInfoData.Items) ? episodesInfoData.Items : null;
        episodesInfoCache = episodesInfoData;
        let correctId = makeItemIdCorrect(itemId);
        url = url.replace(`/${rawId}/`, `/${correctId}/`)
        if (itemId != correctId) {
            itemId = correctId;
            [playbackData, mainEpInfo] = await Promise.all([
                getPlaybackWithCace(itemId),
                getItemInfoWithCace(itemId),
            ]);
            let startPos = mainEpInfo.UserData.PlaybackPositionTicks;
            url = url.replace('StartTimeTicks=0', `StartTimeTicks=${startPos}`);
        }
        let playlistData = (playlistInfoCache && playlistInfoCache.Items) ? playlistInfoCache.Items : null;
        episodesInfoCache = []
        let extraData = {
            mainEpInfo: mainEpInfo,
            episodesInfo: episodesInfoData,
            playlistInfo: playlistData,
            gmInfo: GM_info,
            userAgent: navigator.userAgent,
        }
        playlistInfoCache = null;
        // resumeInfoCache = null;
        logger.info(extraData);
        if (mainEpInfo?.Type == 'Trailer') {
            alert('etlp: Does not support Trailers plugin. Please disable it.');
            return false;
        }
        if (config.disableForLiveTv && mainEpInfo?.Type == 'TvChannel') { return 'disableForLiveTv'; }
        let notBackdrop = Boolean(playbackData.MediaSources[0].Path.search(/\Wbackdrop/i) == -1);
        if (notBackdrop) {
            let _req = options ? options : raw_url;
            if (dpEnabled()) {
                dpPlay(playbackData, extraData, itemId).catch(e => {
                    logger.error('直连: 播放异常', e);
                    alert('直连播放出错，看控制台日志：' + e);
                });
                return true;
            }
            playNotifiy();
            embyToLocalPlayer(url, _req, playbackData, extraData);
            return true;
        }
        return false;
    }

    async function deailWithItemInfo(item) {
        let itemId = item.Id;
        let seasonId = item.SeasonId;

        let [mainEpInfo, playbackData, episodesInfoData] = await Promise.all([
            getItemInfoWithCace(itemId),
            getPlaybackWithCace(itemId),
            (seasonId) ? getEpisodesWithCace(seasonId) : null,
        ]);

        let positonTicks = item.UserData.PlaybackPositionTicks;
        let userId = ApiClient._serverInfo.UserId;
        let deviceId = ApiClient._deviceId;
        let accessToken = ApiClient._userAuthInfo?.AccessToken || ApiClient._serverInfo?.AccessToken;
        if (!accessToken) {
            playNotifiy('Not accessToken');
        }
        let urlParams = {
            'X-Emby-Device-Id': deviceId,
            'StartTimeTicks': positonTicks,
            'X-Emby-Token': accessToken,
            'UserId': userId,
            'IsPlayback': true
        };
        let baseUrl = `${window.location.origin}/emby/Items/${itemId}/PlaybackInfo`;
        let searchParams = new URLSearchParams(urlParams);
        let playbackUrl = `${baseUrl}?${searchParams.toString()}`;
        let episodesInfo = episodesInfoData?.Items || [];
        let extraData = {
            mainEpInfo: mainEpInfo,
            episodesInfo: episodesInfo,
            playlistInfo: [],
            gmInfo: GM_info,
            userAgent: navigator.userAgent,
        }
        if (dpEnabled()) {
            dpPlay(playbackData, extraData, itemId).catch(e => {
                logger.error('直连: 播放异常', e);
                alert('直连播放出错，看控制台日志：' + e);
            });
            return true;
        }
        embyToLocalPlayer(playbackUrl, {}, playbackData, extraData)
    }

    document.addEventListener('click', e => {
        if (!dpIntercept()) { return; }
        // if (window.location.hash != '#!/home') { return; }
        const cardPlayBtn = e.target.closest('button.cardOverlayFab-primary[data-action="play"]');
        // 最新电视和媒体库电视会是 "resume" 需要额外请求 nextup 获取季和集信息。但多版本会只返回一个版本。播放前又要请求多版本信息来确定。
        // const cardPlayBtn = e.target.closest('button.cardOverlayFab-primary[data-action="play"], button.cardOverlayFab-primary[data-action="resume"]');
        // const listPlayBtn = e.target.closest('button.listItem[data-id="resume"][data-action="custom"]');
        // const listShuffleBtn = e.target.closest('button.listItem[data-id="shuffle"][data-action="custom"]');
        const playButton = cardPlayBtn;

        if (!playButton) {
            return;
        }
        const container = e.target.closest('div[is="emby-itemscontainer"]');
        if (!container || (!container._itemSource && !container.items)) {
            logger.info('🎬 Play button clicked, but not within a recognized item list container.');
            return;
        }
        const parentCard = e.target.closest('.virtualScrollItem.card, .backdropCard[data-index]');
        if (!parentCard) {
            return;
        }

        const index = parentCard._dataItemIndex ?? parentCard.dataset.index;
        const itemList = container._itemSource || container.items;
        const item = itemList[index];
        const action = playButton.dataset.action || playButton.dataset.mode;
        let itemType = item.Type;
        if (!['Movie', 'Episode'].includes(itemType)) {
            logger.info('🎬 Play button clicked, but not within legal itemType.');
            return
        }
        logger.info(`🎬 Action '${action}' triggered for item at index ${index}:`, item);
        e.preventDefault();
        e.stopImmediatePropagation();
        deailWithItemInfo(item);
        let title = item.SeriesName || item.Name;
        let subTitle = item.SeriesName && item.Name || item.ProductionYear;
        playNotifiy(title, subTitle);
    }, true);

    async function cacheResumeItemInfo() {
        let inInit = !myBool(resumeRawInfoCache);
        let resumeIds;
        let storageKey = etlpStorageKeys.cacheResumeIds;
        if (inInit) {
            resumeIds = localStorage.getItem(storageKey)
            if (resumeIds) {
                resumeIds = JSON.parse(resumeIds);
            } else {
                return
            }
        } else {
            resumeIds = resumeRawInfoCache.slice(0, 5).map(item => item.Id);
            let seasonIds = resumeRawInfoCache.slice(0, 5).map(item => item.SeasonId);
            await Promise.all(seasonIds.filter(Boolean).map(sid => getEpisodesWithCace(sid)));
            localStorage.setItem(storageKey, JSON.stringify(resumeIds));
        }

        for (let [globalCache, getFun] of [[resumePlaybackCache, getPlaybackWithCace], [resumeItemDataCache, getItemInfoWithCace]]) {
            let cacheDataAcc = {};
            if (myBool(globalCache)) {
                cacheDataAcc = globalCache;
                resumeIds = resumeIds.filter(id => !(id in globalCache));
                if (resumeIds.length == 0) { return; }
            }
            let itemInfoList = await Promise.all(
                resumeIds.map(id => getFun(id))
            )
            globalCache = itemInfoList.reduce((acc, result, index) => {
                acc[resumeIds[index]] = result;
                return acc;
            }, cacheDataAcc);
        }

    }

    async function cloneAndCacheFetch(resp, key, cache) {
        try {
            const data = await resp.clone().json();
            cache[key] = data;
            return data;
        } catch (_error) {
            // pass
        }
    }

    let itemInfoRe = /\/Items\/(\w+)\?/; // 要严格些，不然手动标记已播放 PlayedItems 也会命中，造成缓存错误数据。

    unsafeWindow.fetch = async (input, options) => {
        let isStrInput = typeof input === 'string';
        let urlStr = isStrInput ? input : input.url;

        if (serverName === null) {
            serverName = typeof ApiClient === 'undefined' ? null : ApiClient._appName.split(' ')[0].toLowerCase();
        } else {
            if (typeof ApiClient != 'undefined' && ApiClient._deviceName != 'embyToLocalPlayer' && localStorage.getItem(etlpStorageKeys.webPlayerEnable) != 'true') {
                ApiClient._deviceName = 'embyToLocalPlayer'
                cacheResumeItemInfo();
            }
        }
        if (metadataMayChange && urlStr.includes('Items')) {
            if (urlStr.includes('reqformat') && !urlStr.includes('fields')) {
                cleanOptionalCache();
                metadataMayChange = false;
                logger.info('cleanOptionalCache by metadataMayChange')
            }
        }
        // 适配播放列表及媒体库的全部播放、随机播放。会禁用版本筛选和美化标题。
        if (urlStr.includes('Items?') && /Limit=(300|1000|5\d\d\d)/.test(urlStr)) {
            let _resp = await originFetch(input, options);
            if (serverName == 'emby') {
                await ApiClient._userViewsPromise?.then(result => {
                    let viewsItems = result.Items;
                    let viewsIds = [];
                    viewsItems.forEach(item => {
                        viewsIds.push(item.Id);
                    });
                    let viewsRegex = viewsIds.join('|');
                    viewsRegex = `ParentId=(${viewsRegex})`
                    if (!RegExp(viewsRegex).test(urlStr)) { // 点击季播放美化标题所需，并非媒体库随机播放。
                        episodesInfoCache = ['Items', _resp.clone()]
                        logger.info('episodesInfoCache', episodesInfoCache);
                        logger.info('viewsRegex', viewsRegex);
                        return _resp;
                    }
                }).catch(error => {
                    console.error('Error occurred: ', error);
                });
            }

            playlistInfoCache = null;
            let _resd = await _resp.clone().json();
            if (!_resd.Items[0]) {
                logger.error('playlist is empty, skip');
                return _resp;
            }
            if (['Movie', 'MusicVideo', 'Episode'].includes(_resd.Items[0].Type)) {
                playlistInfoCache = _resd
                logger.info('playlistInfoCache', playlistInfoCache);
            }
            return _resp
        }
        // 获取各集标题等，仅用于美化标题，放后面避免误拦截首页右键媒体库随机播放数据。
        let _epMatch = urlStr.match(episodesInfoRe);
        if (_epMatch) {
            _epMatch = _epMatch[0].split(['?'])[0].substring(1); // Episodes|NextUp|Items
            let _resp = await originFetch(input, options);
            episodesInfoCache = [_epMatch, _resp.clone()]
            logger.info('episodesInfoCache', episodesInfoCache);
            return _resp
        }

        if (urlStr.includes('Items/Resume') && urlStr.includes('MediaTypes=Video')) {
            let reqUrl = urlStr;

            if (config.enableResumeReorder) {
                reqUrl = urlStr.replace(/Fields=([^&]*)/, 'Fields=$1,DateCreated');
            }

            let fetchInput = isStrInput ? reqUrl : new Request(reqUrl, input);

            let _resp = await originFetch(fetchInput, options);
            let _resd = await _resp.clone().json();

            // 处理隐藏特定电视剧
            if (config.resumeHideSomeSeries && _resd.Items && _resd.Items.length > 0) {
                const hideListStr = localStorage.getItem(etlpStorageKeys.hideSeriesIds);
                if (hideListStr) {
                    try {
                        const hideList = JSON.parse(hideListStr);
                        const originalLength = _resd.Items.length;
                        _resd.Items = _resd.Items.filter(item => {
                            if (!item.SeriesId) return true;
                            return !hideList.includes(item.SeriesId);
                        });
                        const hiddenCount = originalLength - _resd.Items.length;
                        if (hiddenCount > 0) {
                            logger.info(`已隐藏 ${hiddenCount} 个电视剧条目`);
                        }
                    } catch (e) {
                        logger.error('解析隐藏列表失败:', e);
                    }
                }
            }

            if (config.enableResumeReorder && _resd.Items && _resd.Items.length > 2) {
                const now = new Date();
                const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
                const firstTwo = _resd.Items.slice(0, 2);
                const rest = _resd.Items.slice(2);
                const recentItems = [];
                const olderItems = [];
                rest.forEach(item => {
                    const dateCreated = new Date(item.DateCreated);
                    if (dateCreated >= threeDaysAgo) {
                        recentItems.push(item);
                    } else {
                        olderItems.push(item);
                    }
                });
                _resd.Items = [...firstTwo, ...recentItems, ...olderItems];
                logger.info(`重排序完成: 前2位保持, ${recentItems.length}个近3天项目前移, ${olderItems.length}个旧项目后移`);
            }

            const modifiedBody = JSON.stringify(_resd);
            const modifiedResponse = new Response(modifiedBody, {
                status: _resp.status,
                statusText: _resp.statusText,
                headers: _resp.headers
            });

            resumeRawInfoCache = _resd.Items;
            cacheResumeItemInfo();
            logger.info('resumeRawInfoCache', resumeRawInfoCache);

            return modifiedResponse;
        }
        // 缓存 itemInfo ，可能匹配到 Items/Resume，故放后面。
        if (urlStr.match(itemInfoRe)) {
            let itemId = urlStr.match(itemInfoRe)[1];
            let resp = await originFetch(input, options);
            logger.info(`CACHE allItemDataCache itemId=${itemId}`);
            cloneAndCacheFetch(resp, itemId, allItemDataCache);
            return resp;
        }
        try {
            if (dpEnabled() && urlStr.indexOf('PlaybackInfo') != -1
                && /"(IsPlayback|AutoOpenLiveStream)"\s*:\s*true/.test(String((options || {}).body || ''))) {
                let dealRes = await dealWithPlaybackInfo(input, urlStr, options);
                if (dealRes && dealRes != 'disableForLiveTv') { return; }
            }
            if (urlStr.indexOf('/PlaybackInfo?UserId') != -1) {
                if (urlStr.indexOf('IsPlayback=true') != -1 && dpIntercept()) {
                    let dealRes = await dealWithPlaybackInfo(input, urlStr, options);
                    if (dealRes && dealRes != 'disableForLiveTv') { return; }
                } else {
                    let itemId = urlStr.match(/\/Items\/(\w+)\/PlaybackInfo/)[1];
                    let resp = await originFetch(input, options);
                    addFileNameElement(resp.clone()); // itemId data 不包含多版本的文件信息，故用不到
                    addOpenFolderElement(itemId);
                    logger.info(`CACHE allPlaybackCache itemId=${itemId}`);
                    cloneAndCacheFetch(resp.clone(), itemId, allPlaybackCache);
                    return resp;
                }
            } else if (urlStr.indexOf('/Playing/Stopped') != -1 && dpIntercept()) {
                return
            }
        } catch (error) {
            logger.error(error, input, urlStr);
            removeErrorWindowsMultiTimes();
            if (dpEnabled() && urlStr.indexOf('IsPlayback=true') != -1 && !window.__etlpDpAlerted) {
                window.__etlpDpAlerted = true;
                alert('直连: 已拦下网页播放，但起播失败。看 Console 里 etlp / 直连 的报错（多数是播放器没开或地址填错）。要先用网页播放：油猴菜单 → 关闭「直连播放器」开关。');
            }
            return
        }

        if (urlStr.match(metadataChangeRe)) {
            if (urlStr.includes('MetadataEditor')) {
                metadataMayChange = true;
            } else {
                cleanOptionalCache();
                logger.info('cleanOptionalCache by Refresh')
            }
        }
        return originFetch(input, options);
    }

    function initXMLHttpRequest() {

        const originOpen = XMLHttpRequest.prototype.open;
        const originSend = XMLHttpRequest.prototype.send;
        const originSetHeader = XMLHttpRequest.prototype.setRequestHeader;

        XMLHttpRequest.prototype.setRequestHeader = function (header, value) {
            this._headers[header] = value;
            return originSetHeader.apply(this, arguments);
        }

        XMLHttpRequest.prototype.open = function (method, url) {
            this._method = method;
            this._url = url;
            this._headers = {};

            if (serverName === null && this._url.indexOf('X-Plex-Product') != -1) { serverName = 'plex' };
            let catchPlex = (serverName == 'plex' && this._url.indexOf('playQueues?type=video') != -1)
            if (catchPlex && dpIntercept()) { // Plex
                fetch(this._url, {
                    method: this._method,
                    headers: {
                        'Accept': 'application/json',
                    }
                })
                    .then(response => response.json())
                    .then((res) => {
                        let extraData = {
                            gmInfo: GM_info,
                            userAgent: navigator.userAgent,
                        };
                        let data = {
                            playbackData: res,
                            playbackUrl: this._url,
                            mountDiskEnable: localStorage.getItem(etlpStorageKeys.mountDiskEnable),
                            extraData: extraData,
                        };
                        sendDataToLocalServer(data, 'plexToLocalPlayer');
                        removeErrorWindowsMultiTimes();
                    });
                return;
            }
            return originOpen.apply(this, arguments);
        }

        XMLHttpRequest.prototype.send = function (body) {

            let catchJellyfin = (this._method === 'POST' && this._url.endsWith('PlaybackInfo'))
            if (catchJellyfin && dpIntercept()) { // Jellyfin 10.10
                let pbUrl = this._url;
                body = JSON.parse(body);
                let _body = {};
                ['MediaSourceId', 'StartTimeTicks', 'UserId', 'SubtitleStreamIndex', 'AudioStreamIndex',].forEach(key => {
                    if (body[key] != undefined) {
                        _body[key] = body[key];
                    }
                });
                let query = new URLSearchParams(_body).toString();
                pbUrl = `${pbUrl}?${query}`
                let options = {
                    headers: this._headers,
                };
                dealWithPlaybackInfo(pbUrl, pbUrl, options);
                return;
            }
            originSend.apply(this, arguments);
        }
    }

    initXMLHttpRequest();

    setModeSwitchMenu(etlpStorageKeys.webPlayerEnable, '脚本在当前服务器 已', '', '可用', '禁用', '可用');
    setModeSwitchMenu(etlpStorageKeys.mountDiskEnable, '读取硬盘模式已经 ');
    setModeSwitchMenu(dpKeys.enable, '直连播放器(MPC-HC/JRiver) 已', '', '开启', '开启', '关闭');
    setCallbackMenu('直连播放器: 设置', dpShowConfig);
    setCallbackMenu('直连播放器: 测试连接', dpTestConnection);
    setCallbackMenu('直连播放器: 按钮自检', dpButtonCheck);
    setCallbackMenu('直连播放器: JRiver 试播探测', dpJriverProbe);

    function showGuiMenu() {
        sendDataToLocalServer({ 'showTaskManager': true }, 'embyToLocalPlayer');
    }
    if ('etlpTaskManager' in localStorage) {
        setCallbackMenu('查看缓存任务', showGuiMenu);
    }

    overwriteConfByStore();

    if (config.resumeHideSomeSeries || localStorage.getItem(etlpStorageKeys.resumeHide) === 'true') {
        setCallbackMenu('继续播放: 隐藏该电视剧', hideCurrentSeries);
        setCallbackMenu('继续播放: 重置隐藏设置', resetHiddenSeries);
    }

    // let debounceTimer; # 有的 css 选择器比较宽泛，播放后再检测比较稳妥。
    // const observer = new MutationObserver(() => {
    //     clearTimeout(debounceTimer);
    //     debounceTimer = setTimeout(removeErrorWindows, 100);
    // });
    // observer.observe(document.body, { childList: true, subtree: true });
})();

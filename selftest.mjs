// 直连模块的自检：把 direct_module.js 套一层 stub 跑起来，验证纯逻辑和进度回传节奏。
// 跑法: node selftest.mjs   （build.py 会自动跑）
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const src = fs.readFileSync(new URL('./direct_module.js', import.meta.url), 'utf8');
const EXPORTS = ['dpParseVars', 'dpTimeSyntax', 'dpPlayingOther', 'dpConf', 'dpStore', 'dpKeys', 'dpEnabled', 'dpIntercept', 'dpMonitor', 'dpReport', 'dpItemIdFromHash', 'dpItemIdFromUrl', 'dpStreamUrl', 'dpRelayHref', 'dpButtonBaseClass', 'dpSyncDetailButtons'];

// 把模块片段拼成一个真正的 ESM 文件再 import：片段依赖的一堆上游全局（logger/ApiClient/document…）
// 由 globalThis.__stub 按名字注入，比 new Function 那种动态执行干净，出栈也是真行号。
async function loadModule(stubs) {
    const file = path.join(os.tmpdir(), `etlp-selftest-${process.pid}.mjs`);
    const decl = Object.keys(stubs).map(n => `const ${n} = globalThis.__stub.${n};`).join('\n');
    fs.writeFileSync(file, `${decl}\n${src}\nexport { ${EXPORTS.join(', ')} };`);
    globalThis.__stub = stubs;
    try {
        return await import(pathToFileURL(file).href);
    } finally {
        fs.rmSync(file, { force: true });
        delete globalThis.__stub;
    }
}

const calls = [];
const created = [];
const logger = { error: (...a) => created.push(['error', ...a]), info: () => { }, debug: () => { } };
const localStorage = { _d: {}, getItem(k) { return k in this._d ? this._d[k] : null; }, setItem(k, v) { this._d[k] = String(v); } };
const ApiClient = {
    _userAuthInfo: { AccessToken: 'tok' },
    getUrl: (p, q) => 'http://srv' + p + (q ? '?' + new URLSearchParams(q) : ''),
    ajax: async o => {
        let body;
        try { body = JSON.parse(o.data); } catch (e) { throw new Error(`自检桩: 请求体不是合法 JSON (${e.message}): ${String(o.data).slice(0, 200)}`); }
        calls.push({ ...body, url: o.url });
    },
};
// ---- 假 DOM：够详情页三按钮用（class 模板复制 + 插入位置 + 幂等 + 清理）----
const serEl = n => typeof n === 'string' ? n
    : n.nodeType === 3 ? (n.textContent || '')
        : `<${n.tag} class="${n.className}">${(n.children || []).length ? n.children.map(serEl).join('') : (n.textContent || '')}</${n.tag}>`;
const mkEl = (cls, tag = 'button') => {
    const node = {
        tag, className: cls, id: '', type: '', title: '', children: [], parent: null,
        addEventListener() { }, contains(n) { return n === this || this.children.includes(n); },
        // 真 DOM 的 append 接受字符串（当文本节点），桩也照做
        append(...nodes) { for (const n of nodes) { if (typeof n === 'string') { node.children.push({ nodeType: 3, textContent: n }); continue; } n.parent = node; node.children.push(n); } },
        appendChild(n) { node.append(n); return n; },
        insertAdjacentElement(_pos, n) {   // 真页面里只用到 'afterend'，桩就固定插在节点后面
            const p = node.parent, i = p.children.indexOf(node); p.children.splice(i + 1, 0, n); n.parent = p; },
        remove() { if (node.parent) { const p = node.parent; p.children.splice(p.children.indexOf(node), 1); node.parent = null; } },
    };
    Object.defineProperty(node, 'parentElement', { get: () => node.parent });
    // innerHTML 在真 DOM 里会把 append 进去的子节点序列化回来，桩也照着拼（断言靠它看图标+文字的顺序）
    Object.defineProperty(node, 'innerHTML', {
        get: () => node.children.map(serEl).join(''), set: () => { },
    });
    Object.defineProperty(node, 'nextElementSibling', {
        get() { const p = node.parent; return p ? p.children[p.children.indexOf(node) + 1] || null : null; },
    });
    return node;
};
const row = mkEl('mainDetailButtons', 'div');
const playBtn = mkEl('button btnPlay raised button-submit block emby-button');
const made = [];
for (const el of [playBtn, mkEl('button btnResume raised button-submit block emby-button'),
    mkEl('button btnDownload raised button-submit block emby-button'), mkEl('button detailButton raised button-submit block emby-button')]) {
    row.children.push(el);
    el.parent = row;
}
const domStub = {
    _row: row,
    querySelector: sel => (/btnPlay/.test(sel) ? playBtn : row.children[0]),
    getElementById(id) {
        const walk = n => {
            for (const c of n.children || []) { if (c.id === id) return c; const hit = walk(c); if (hit) return hit; }
            return null;
        };
        return walk(row) || made.find(e => e.id === id) || null;
    },
    createElement: tag => { const el = mkEl('', tag); made.push(el); return el; },
};
const locationStub = { hash: '#!/item?id=4405927' };

const windowStub = { addEventListener() { }, setInterval() { } };   // 按钮定时器在自检里不跑
const M = await loadModule({
    logger, ApiClient, localStorage, alert: () => { }, prompt: () => 'jriver', GM_xmlhttpRequest: () => { },
    DOMParser: class DOMParser { }, document: domStub, playNotifiy: () => { },
    etlpStorageKeys: { webPlayerEnable: 'webPlayerEnable' },
    setTimeout: (fn) => setTimeout(fn, 0), location: locationStub, window: windowStub,
});

// ---- variables.html 解析 ----
assert.deepEqual(M.dpParseVars('<p id="state">2</p>\n<p id="position">1234</p>\n<p id="filepath">http://x/a?b=1&amp;c=2</p>'),
    { state: '2', position: '1234', filepath: 'http://x/a?b=1&amp;c=2' });

// ---- 开关：默认开启；关掉要完全回到原版行为（网页播放拦截交回原开关）----
assert.equal(M.dpEnabled(), true);
assert.equal(M.dpIntercept(), true);
M.dpStore.set(M.dpKeys.enable, 'false');
assert.equal(M.dpEnabled(), false);
M.dpStore.set('webPlayerEnable', 'true');   // 上游那个「脚本在当前服务器 已可用」开关
assert.equal(M.dpIntercept(), false);       // 直连关了：交回原开关，网页可以播
M.dpStore.set(M.dpKeys.enable, 'true');
assert.equal(M.dpIntercept(), true);        // 直连开着：无视原开关，一律拦
M.dpStore.set('webPlayerEnable', 'false');

// ---- MPC-HC 定位格式 h:m:s:ms ----
assert.equal(M.dpTimeSyntax(0), '0:0:0:0');
assert.equal(M.dpTimeSyntax(330000), '0:5:30:0');
assert.equal(M.dpTimeSyntax(3661001), '1:1:1:1');
assert.equal(M.dpTimeSyntax(-5), '0:0:0:0');

// ---- 「播放器里播的是别人吗」----
assert.equal(M.dpPlayingOther('http://h/emby/Videos/abc123/stream?Static=true&api_key=t', 'abc123'), false);
assert.equal(M.dpPlayingOther('http://h/emby/Videos/other/stream', 'abc123'), true);
assert.equal(M.dpPlayingOther('http://h/emby/Videos/abc%31%32%33/stream', 'abc123'), false);   // 带百分号编码的路径
assert.equal(M.dpPlayingOther('D:\\movie.mkv', 'abc123'), false);   // 本地路径不判断
assert.equal(M.dpPlayingOther('', 'abc123'), false);

// 条目 id 提取（真实详情页 URL）
assert.equal(M.dpItemIdFromHash('#!/item?id=4405927&serverId=2aabaaa9a6834271a69ec9a4afa4a394&context=home'), '4405927');
assert.equal(M.dpItemIdFromHash('#!/details?id=abc-123_def'), 'abc-123_def');
assert.equal(M.dpItemIdFromHash('#!/list?parentId=999'), null);   // parentId 不算
assert.equal(M.dpItemIdFromHash('#!/home'), null);
assert.equal(M.dpItemIdFromHash(''), null);

// ---- 直链里抠条目 id（试播探测/回传判据都靠它）----
assert.equal(M.dpItemIdFromUrl('http://10.0.0.9:8096/Videos/2f3c0a1b2c3d4e5f6a7b8c9d0e1f2a3b/stream?Static=true&api_key=x'), '2f3c0a1b2c3d4e5f6a7b8c9d0e1f2a3b');
assert.equal(M.dpItemIdFromUrl('http://h/emby/audio/2f3c0a1b2c3d4e5f6a7b8c9d0e1f2a3b/stream.mp3?a=1'), '2f3c0a1b2c3d4e5f6a7b8c9d0e1f2a3b');
assert.equal(M.dpItemIdFromUrl('http://h/stream'), '');

// ---- 直链组装：带扩展名 + 可换直链主机（路径前缀 /emby 跟着网页走）----
const ms = { Id: 'mediasource_4405927', Container: 'mkv' };
const pb = { PlaySessionId: 'ps1' };
localStorage.setItem('directPlayerStreamBase', '');   // 留空 = 用网页地址
assert.equal(M.dpStreamUrl('4405927', ms, pb),
    'http://srv/Videos/4405927/stream.mkv?Static=true&MediaSourceId=mediasource_4405927&PlaySessionId=ps1&api_key=tok');
localStorage.setItem('directPlayerStreamBase', 'http://10.0.0.9:8096/');
assert.equal(M.dpStreamUrl('4405927', ms, pb),
    'http://10.0.0.9:8096/Videos/4405927/stream.mkv?Static=true&MediaSourceId=mediasource_4405927&PlaySessionId=ps1&api_key=tok');
// 网页带 /emby 前缀 → 换主机后前缀保留；用户把前缀也写进主机里 → 不重复
ApiClient.getUrl = p => 'http://srv/emby' + p;
assert.ok(M.dpStreamUrl('4405927', ms, pb).startsWith('http://10.0.0.9:8096/emby/Videos/4405927/stream.mkv?'));
localStorage.setItem('directPlayerStreamBase', 'http://10.0.0.9:8096/emby');
assert.ok(M.dpStreamUrl('4405927', ms, pb).startsWith('http://10.0.0.9:8096/emby/Videos/4405927/stream.mkv?'));
localStorage.setItem('directPlayerStreamBase', '');
ApiClient.getUrl = (p, q) => 'http://srv' + p + (q ? '?' + new URLSearchParams(q) : '');

// ---- 媒体源原始链接（.strm / 网盘直链，本机实测能播）优先 ----
const strmMs = { ...ms, Path: 'http://10.0.0.9:9527/Media/xxx.mkv' };
// 直链主机留空 + auto → 用原始链接
assert.equal(M.dpStreamUrl('4405927', strmMs, pb), 'http://10.0.0.9:9527/Media/xxx.mkv');
// 直链主机有值 → auto 不用原始链接
localStorage.setItem('directPlayerStreamBase', 'http://10.0.0.9:8096');
assert.ok(M.dpStreamUrl('4405927', strmMs, pb).startsWith('http://10.0.0.9:8096/Videos/4405927/stream.mkv?'));
// urlFrom=path → 总是优先原始链接；本地文件路径（非 http）仍走 Emby 链接
localStorage.setItem('directPlayerUrlFrom', 'path');
assert.equal(M.dpStreamUrl('4405927', strmMs, pb), 'http://10.0.0.9:9527/Media/xxx.mkv');
assert.ok(M.dpStreamUrl('4405927', { ...ms, Path: '/mnt/media/x.mkv' }, pb).startsWith('http://10.0.0.9:8096/Videos/'));
localStorage.setItem('directPlayerUrlFrom', 'auto');
localStorage.setItem('directPlayerStreamBase', '');

// ---- 默认配置 ----
assert.deepEqual(M.dpConf(), { mode: 'jriver', jriver: 'http://127.0.0.1:52199', jrkey: '', zone: '-1', mpc: 'http://127.0.0.1:13579', streamBase: '', urlFrom: 'auto' });
M.dpStore.set(M.dpKeys.mpc, 'http://127.0.0.1:13579/');
M.dpStore.set(M.dpKeys.mode, 'MPC');
assert.equal(M.dpConf().mpc, 'http://127.0.0.1:13579');
assert.equal(M.dpConf().mode, 'mpc');

// ---- 回传节奏 ----
const ctx = { itemId: 'abc123', msId: 'abc123', playSessionId: 'ps1', runMs: 0, resumeMs: 60000 };
const run = async (polls, over = {}) => {
    calls.length = 0;
    await M.dpMonitor({ ...ctx, ...over }, async () => polls.length ? polls.shift() : { gone: true });
    return calls.map(c => `${c.url.split('/').pop()}:${c.PositionTicks}${c.IsPaused ? ':paused' : ''}`);
};

// 起播 + 每 4 次轮询回传一次进度 + 换片时上报停止
assert.deepEqual(await run([{ playing: true, posMs: 60000 }, { playing: true, posMs: 63000 }, { playing: true, posMs: 66000 },
    { playing: true, posMs: 69000 }, { playing: true, posMs: 72000 }]),
    ['Playing:600000000', 'Progress:690000000', 'Stopped:720000000']);

// 暂停不该结束会话，只是带 IsPaused 回传
assert.deepEqual(await run([{ playing: false, paused: true, posMs: 1000 }, { playing: false, paused: true, posMs: 1000 },
    { playing: false, paused: true, posMs: 1000 }, { playing: false, paused: true, posMs: 1000 }, { gone: true }], { resumeMs: 0 }),
    ['Playing:0', 'Progress:10000000:paused', 'Stopped:10000000']);

// 播放器关掉（连续 3 次没响应）也要收尾
assert.deepEqual(await run([{ playing: true, posMs: 5000 }, null, null, null], { resumeMs: 0 }),
    ['Playing:0', 'Stopped:50000000']);

// 播完（位置 >= 片长）上报停止
calls.length = 0;
await M.dpMonitor({ ...ctx, runMs: 10000, resumeMs: 0 }, async () => ({ playing: true, posMs: 11000 }));
assert.deepEqual(calls.map(c => c.url.split('/').pop()), ['Playing', 'Stopped']);

// 回传内容要有 Emby 需要的字段
assert.equal(calls[0].ItemId, 'abc123');
assert.equal(calls[0].MediaSourceId, 'abc123');
assert.equal(calls[0].PlaySessionId, 'ps1');
assert.equal(calls[0].PlayMethod, 'DirectStream');

// ---- 自定义协议载荷（中继脚本按这个格式解析，两边必须一致）----
assert.equal(M.dpRelayHref('mpc', 'http://h/a.mkv', 0), 'etlp-mpc:http%3A%2F%2Fh%2Fa.mkv');
assert.equal(M.dpRelayHref('mpv', 'http://h/a b.mkv', 90500), 'etlp-mpv:http%3A%2F%2Fh%2Fa%20b.mkv||90500');
assert.equal(M.dpRelayHref('mpc', 'http://h/a.mkv', 20000), 'etlp-mpc:http%3A%2F%2Fh%2Fa.mkv');   // <30s 不值得定位

// ---- 详情页三按钮：沿用原生按钮的 class（样式匹配），插在原生播放按钮那一簇之后 ----
assert.equal(M.dpButtonBaseClass('button btnPlay raised item-tag-button emby-button'), 'button raised item-tag-button emby-button');
assert.equal(M.dpButtonBaseClass(''), 'raised button-submit block emby-button');
M.dpSyncDetailButtons();
const ourBtns = row.children.filter(c => c.id && c.id.startsWith('etlp-dp-btn-'));
assert.deepEqual(row.children.map(c => c.id), ['', '', '', 'etlp-dp-btn-mpc', 'etlp-dp-btn-jriver', 'etlp-dp-btn-mpv', '']);   // 在 ▶/继续/下载 之后、⋯ 之前，没拆开原生按钮
assert.deepEqual(ourBtns.map(b => b.title.replace('直连播放：', '')), ['MPC-HC', 'JRiver', 'MPV']);
assert.equal(ourBtns[0].innerHTML, '<i class="md-icon button-icon button-icon-left">theaters</i>MPC-HC 播放');
assert.equal(ourBtns[0].className, 'button raised button-submit block emby-button');   // 抄了原生 class，但没抄 btnPlay
M.dpSyncDetailButtons();   // 幂等：定时器每 1.5s 都会调它
assert.equal(row.children.filter(c => c.id && c.id.startsWith('etlp-dp-btn-')).length, 3);
locationStub.hash = '#!/home';   // 离开详情页 → 自己删掉，不留垃圾
M.dpSyncDetailButtons();
assert.equal(row.children.filter(c => c.id && c.id.startsWith('etlp-dp-btn-')).length, 0);
locationStub.hash = '#!/item?id=4405927';

assert.deepEqual(created, [], '不该有 logger.error: ' + JSON.stringify(created.slice(0, 3)));
console.log('selftest 通过 (28 项)');

# embyToLocalPlayer 直连版（MPC-HC / JRiver / MPV，不需要 Python）

在上游脚本 [embyToLocalPlayer](https://greasyfork.org/zh-CN/scripts/448648-embytolocalplayer) 上打补丁：
多一个**直连模式**，用浏览器自己的网络请求把 Emby/Jellyfin 的直链丢给本机播放器，并把播放进度回传给 Emby。
不需要装 Python、不需要本地服务、不需要填路径映射。

- 支持的播放器：**JRiver Media Center**（MCWS HTTP 接口）、**MPC-HC**（自定义协议中继 + 网页界面；MPC-BE 网页界面同源，未实测）、**MPV**（同一个协议中继；没有进度回传）
- 条目详情页多了**三个按钮**（MPC-HC / JRiver / MPV 播放），紧跟在 Emby 自己的「播放 / 继续观看 / 下载」按钮后面，样式跟原生按钮一致（用的是原生按钮的 class 和它自带的 `link` 图标）
- 开关和设置都在油猴菜单「直连播放器」下面；**关掉开关就完全恢复原版行为**（走 Python 服务）

| 文件 | 用途 |
| --- | --- |
| `embyToLocalPlayer.direct.user.js` | 装这个（Tampermonkey → 添加新脚本 → 粘贴/导入） |
| `etlp-relay.exe` | **推荐**：中继器 + 设置窗口（双击就是设置界面：注册协议、找播放器、看日志） |
| `direct_module.js` / `build.py` / `selftest.mjs` | 源码：补丁模块、构建脚本、自检 |

## 安装

1. Tampermonkey 里导入 `embyToLocalPlayer.direct.user.js`（已含 `@connect localhost` / `@connect *`，不然读不到本地播放器）。
2. 点油猴菜单 →「直连播放器: 设置」→ 选模式、填地址。
3. 菜单 →「直连播放器: 测试连接」确认能通。
4. 菜单 →「直连播放器(MPC-HC/JRiver)」开关打开。
5. 在 Emby 网页里点播放。

**入口有三个**（都直接调 PC 播放器，不会出网页播放器）：

- 条目详情页 Emby 播放按钮**旁边那三个按钮**（MPC-HC 播放 / JRiver 播放 / MPV 播放）—— 脚本注入的，看到它们说明直连版脚本已生效；
- Emby 自己的 ▶（详情页按钮、卡片上悬停出现的圆按钮）—— 会被脚本接管，用设置里的默认模式；
- 可选的右下角绿色浮动按钮（默认**关**，油猴菜单里「直连播放器: 显示角落按钮」可开）。

**开关默认就是开的**（装好即走 PC 播放器）。要临时用网页播放：菜单 → 关掉「直连播放器」开关。

## 设置窗口（不想敲命令就用它）

**双击 `etlp-relay.exe`**（或 `etlp-relay.exe -Gui`）：直接弹 **Windows 原生窗口**，没有命令行黑框。

- 播放器路径：**浏览…** 选 exe，或点 **找找看** 深度扫盘自动填（几十秒；扫完把第一个结果填进路径框）
- JRiver：地址 + 访问密钥 + **测试连接**（这一步是真去问 MC 的 `MCWS/v1/Alive`）。**播放本身不经过中继**（MC 常驻，脚本直接用 HTTP 指挥它），所以这里只是帮你看「通不通、密钥对不对」——浏览器直连 `127.0.0.1:52199` 会撞 CORS/混合内容，中继没这个限制
- **保存并注册协议**：把 `etlp-mpc:` / `etlp-mpv:` 注册到 HKCU（不需要管理员），指向这个 exe
- 状态区：版本、exe 位置、配置文件位置、两个协议各注册成什么、JRiver 地址（密钥打码）
- 日志区：`etlp-relay.log` 最后 200 行；旁边有「刷新日志 / 打开日志文件夹 / 自检 / 卸载协议」

**不需要设置自启动**：中继不是常驻服务，浏览器点播放时 Windows 才拉起它一次，它把播放器启动起来就自己退了；没有任何后台进程要养（进度回传是脚本直接聊播放器的网页界面 / MCWS，不经过中继）。

命令行那套（`-Install` / `-Mpc=` / `-Mpv=` / `-Jr=` / `-JrKey=` / `-JrTest` / `-Status` / `-SelfTest` / `-Uninstall`）都还在，窗口按钮走的就是同一套逻辑。exe 是窗口程序（没有控制台），所以命令行跑这些参数时结果会直接**弹框**给你看。
`-Web` 是备用壳：起个本地网页版设置（只监听 `127.0.0.1`、带随机 token），比如远程/其它系统上想改配置时用。

## JRiver

- Media Center 打开，且**选项 → 媒体网络 → 允许通过 Library Server 访问（默认端口 52199）**。
- 设置里模式填 `jriver`，地址默认 `http://127.0.0.1:52199`。
- **访问秘钥**：Media Center 开了认证时，每次 MCWS 请求都要带 Access Key（MC 里：选项 → 媒体网络 → Access Key，六位字母）。脚本里默认**留空**，在「设置」里填你自己的那个（JRiver 密钥属于本机隐私，不要写进要分享的脚本）。
- **为什么中继里没有 JRiver 的播放器路径**：JRiver 不需要被「拉起来」（MC 常驻），也不经自定义协议——脚本直接对 `http://127.0.0.1:52199/MCWS/v1/...` 发 HTTP。中继窗口里能填的只有地址/密钥，用来测连通（`-JrTest`）。密钥真正生效的那份写在脚本里（菜单 → 设置 → JRiver 密钥）。
  脚本把它同时当 `token=` 和 `AccessKey=` 发（多带的参数 MC 会忽略）；换机器/换秘钥就在「设置」里改，或用网页播放时关掉直连开关。
- Zone 填 `-1`（当前区域）或 `0`/`1`/`2`/区域名（多区域时指定「播放到哪个区域」）。
- 起播：依次试 `Playback/PlayByFilename` → `Control/CommandLine`，每次都用「MC 的播放信息里是不是这条」判定真的起播了；两个都不行才落到对话框兜底（失败的方式写在 Console 日志里）。
- 都吃不下 http 直链时，退回「打开 URL」对话框（MCC 20001）：**脚本自己把直链复制进剪贴板**，再帮你弹出 MC 的「打开 URL」窗口 → 你只需要在里面 **Ctrl+V、回车**。
  - 怎么复制的：Emby 页面常是 `http://`（非安全上下文，`navigator.clipboard` 根本不存在），所以用「隐形 `<textarea>` + `setSelectionRange` + `execCommand('copy')`」。实测 http 页面、`await fetch` 两秒之后再调也能成功写进系统剪贴板（`pbpaste` 验证过），所以这条路真的好用。
  - 为什么不让 MC 自己粘？`Control/Key` 不支持 `Ctrl+V` 这种键位写法（实测只会在 URL 栏里留个 `c`/`C`）；而 MCC 表里 `20001 MCC_OPEN_URL` 标注 `ignore` = **不接受参数**，所以程序没法把 URL 直接喂进去。
  - 已经失败过的直链**主机**会被记住（`directPlayerJriverNoUrl` 存的是 `http://10.0.0.5:8096` 这样的 origin）：所以换了解析线路/换了端口就**自动重试**，不会像早先那样永久卡在对话框。MC 没开的时候不记（那只是没开机）。
  - 对话框路线**同样回传进度/续播定位**（粘完开始播之后 Emby 那边的进度、续播位置都正常）。
  - 要「一次点击直接播、无对话框」就用 MPC-HC 模式。
- 「测试连接」会顺带列出这台 MC 的 MCWS 函数清单（MC 的 Web Service 是自文档的），用来确认有没有 `PlayByURL` 之类的函数。
- 进度：每 3 秒查一次 `Playback/Info`，约每 12 秒回传一次；播完/换片回传 Stopped；续播位置用 `Playback/Position` 定位（超过 30 秒才定位）。

## MPC-HC

两步：

1. MPC-HC → 选项 → **网页界面** → 勾选「监听端口」（默认 13579）。进度回传和续播定位都靠它。
2. 装中继（一次性，**不需要管理员**，装完重启浏览器）：**双击 `etlp-relay.exe`** → 设置窗口里用「找找看」或「浏览…」选好 `mpc-hc64.exe` → 点「保存并注册协议」。

   窗口做两件事：把 `etlp-mpc:` / `etlp-mpv:` 两个协议注册到 HKCU（指向这个 exe），以及找 `mpc-hc64.exe` / `mpv.exe`（App Paths 注册表 → PATH → 常见安装路径 → K-Lite 自带路径）。找不到就用命令行补路径：

   ```
   etlp-relay.exe -Install -Mpc "C:\Program Files\MPC-HC\mpc-hc64.exe" -Mpv "C:\Program Files\mpv\mpv.exe"
   ```

   自查/卸载：窗口上的「自检」「卸载协议」，或者命令行 `etlp-relay.exe -Status`（结果会弹框）、`-SelfTest`、`-Uninstall`。
   配置写在 exe 同目录的 `etlp-relay.ini`（纯文本，两行），卸载就是删掉那条 HKCU 注册项。

   **为什么封装成 exe**：不依赖 PowerShell（ExecutionPolicy、脚本拦截、杀软对 `.ps1` 的误报都不再是变量）、播放和开设置都不闪任何窗口、单文件绿色（没有运行时、放哪都行）。

为什么 MPC-HC 要中继：它的网页界面只能打开**本地路径**，没有打开 URL 的接口，所以直链走自定义协议交给脚本去 `Start-Process mpc-hc.exe <直链>`；播放进度回传仍然走网页界面（`/variables.html`、`/command.html`）。

设置里模式填 `mpc`，地址默认 `http://127.0.0.1:13579`。

## MPV

- 设置里模式填 `mpv`。它跟 MPC-HC 用**同一个中继**（`etlp-mpv:` 协议在 `-Install` 时一起注册）；中继找不到 `mpv.exe` 就补一次：`etlp-relay.exe -Install -Mpv "C:\...\mpv.exe"`（或把路径写进同目录 `etlp-relay.ini`，或把 mpv 放进 PATH——Chocolatey / Scoop 装的能被自动找到）。
- 推给 mpv 的参数：续播位置（≥30 秒时）`--start=<秒>`，外加三个「保底」参数（防止 mpv.conf 里的设置把播放吃掉）：

  | 参数 | 为什么 |
  | --- | --- |
  | `--force-window=yes` | 配置里 `force-window=no` 或纯音频时也要有窗口，否则看着像「在后台播」 |
  | `--no-pause` | 配置里 `pause=yes` 会让它开着窗口停在暂停 |
  | `--no-ytdl` | mpv-lazy 这类配置包默认 `ytdl=yes`，会把 URL 先丢给 yt-dlp 解析（慢/卡住 = 窗口开着却不播） |

- **mpv 不播放怎么看**：中继会在自己所在目录写两个日志（Console 是藏起来的、mpv 的报错也只进它自己的终端，所以只能落盘）：`etlp-relay.log` 记我们给播放器发了什么（时间/协议/URL/完整参数/exe 路径），`mpv.log` 是 mpv 自己的日志（每次播放前会清空，只留最后一次；里面头几行有 mpv 版本号和读的配置文件路径）。
  常见凶手：`mpv.conf` 里的 `vo=null` / `vid=no` / `pause=yes` / `ytdl=yes` / `force-window=no`，或者 `--start` 指到了片尾。
- D 盘/移动盘的便携版不会被自动扫描到（自动扫描只看 App Paths → PATH → Program Files / LOCALAPPDATA 下两层），写进同目录 `etlp-relay.ini` 最稳（`etlp-relay.exe -Status` 会告诉你每个播放器最终解析到哪个 exe）。
- **中继没装 / 没找到 mpv 时的退路**：脚本会把直链复制进剪贴板并提示你 → 到 mpv 窗口按 `Ctrl+V` 回车（mpv 的粘贴自己会弹一次「打开文件」对话框，按回车就行）。
- **MPV 不回传进度**：mpv 没有网页界面，它的 JSON IPC 是命名管道/socket，浏览器读不到。所以 Emby 那边不会记「看到哪」、续播位置对 mpv 也不生效（`--start` 只能靠 Emby 里已有的旧进度）。要进度就用 JRiver / MPC-HC 模式。

## 拉起 PC 播放器，不是网页播放

直连开关（菜单「直连播放器(MPC-HC/JRiver)」）开着的时候，脚本会把网页播放彻底堵死：

- 详情页/卡片点播放 → 脚本吞掉 Emby 的 `PlaybackInfo?IsPlayback=true` 响应（网页播放器拿不到流地址，起不来）→ 拉起 PC 播放器
- 媒体库卡片上的 ▶ 按钮 → `deailWithItemInfo` 那条路，也改走直连（上游这里是直连到 Python 服务的，不堵就会没反应）
- 上游的「脚本在当前服务器 已 可用/禁用」开关**会被直连开关覆盖**：开着直连就一律拦截。想在某台服务器上用网页播放，就把直连开关关掉
- Plex / Jellyfin 10.10 的拦截闸门（`catchPlex` / `catchJellyfin`）同样按直连开关走

判断有没有生效：点播放后应该出现「正在播放 (MPC-HC)」/「正在播放 (JRiver)」的提示且**网页不会出现播放器**。
如果网页还是开始播了：看油猴菜单里那个开关是不是没开、Console 里 `etlp` 的日志报了什么。

## 已知限制

- **只适合直链播放**：Emby 转码、字幕烧录、HLS 分片这类流交给外部播放器不合适（JRiver 的 PlayByFilename 和 MPC-HC 的 URL 打开都不带 Emby 的认证头，靠 URL 里的 `api_key`，够用；但受保护的 Transcode 流不保证）。
- 起播/换片检测是**看播放器里现在播的是不是这条**（用 Emby 的 itemId 比对 filepath/Filename）：MPC-HC 能判断，JRiver 判断不了时就不判断（可能把别人手动播放的内容记到这条上）。
- 直连开关开着时，网页播放被强制拦截（包括新版客户端的 POST PlaybackInfo）—— 也就是说再也不能在浏览器里直接看了（要看得先关直连开关）。
- 详情页那三个按钮用的是 Emby 原生按钮的 class + 自带的 `material-icons`（`link` 图标，`<i>` 里写文字就渲染成图标），不依赖任何额外的图标字体文件；不拆分、不改动原生按钮，只在「播放/继续观看/下载」后面、`⋯` 之前插三个。
- MPC-HC 的 state 数值语义（-1/0/1/2）按官方说明处理；JRiver 的 State 数值没有权威文档，脚本用「位置第一次在走时的那个值」当播放中，第一次播放前按位置判断。
- 页面关掉就不回传了（没有后台服务，这是直连模式的代价）。要长期后台保活就用原版 + Python。
- 页面里已经开着的直连监控最多跑 6 小时（防止一直挂着）。

## 重新构建

上游更新后：

```
python3 build.py        # 会拉 https://update.greasyfork.org/scripts/448648/... 缓存成 upstream.js
```

`build.py` 按锚点打 6 处补丁，锚点找不到会直接报错并说明是哪个锚点（上游改版时改这几处即可）：
header（`@connect` / `@version` / 去掉 `@updateURL` 防止被原版覆盖）、模块插入点（`let serverName = null;` 之前）、
`dealWithPlaybackInfo` 里的播放入口、fetch 里拦网页播放的两道闸门（GET `IsPlayback=true` 用 `dpIntercept()`，
新版 POST PlaybackInfo 看请求体里有没有 `"IsPlayback": true`）、fetch catch 里的起播失败提示、`registerAllMenus` 的菜单。
改完 `direct_module.js` 后 `build.py` 会自动跑 `node --check` 和 `node selftest.mjs`。

`selftest.mjs` 覆盖：MPC-HC `/variables.html` 解析、定位时间格式 `h:m:s:ms`、itemId 比对、「每 4 次轮询回传一次进度 / 暂停不结束会话 / 播放器关掉后收尾 / 播完收尾」的回传序列；另外用搭的假 DOM 验一下三个按钮**插在原生「播放/继续观看/下载」后面、`⋯` 之前**、class 跟原生一致、点哪个就用哪个模式。

### 自己部署一份（可选）

部署目标（NAS/主机的地址和共享路径）不入库，写在 `relay/.deploy.env`（已 gitignore）：

```bash
echo 'NAS="root@你的主机"'            >  relay/.deploy.env
echo 'NAS_SHARE="/mnt/user/.../emby-direct-player"' >> relay/.deploy.env
cd relay && ./build.sh --deploy
```

推完逐个文件比 sha256，对不上直接报错退出；源码镜像里的 exe 会被清掉（exe 只留共享目录根层那一份）。不写 `.deploy.env`、直接 `./build.sh` 就只在本机编译。

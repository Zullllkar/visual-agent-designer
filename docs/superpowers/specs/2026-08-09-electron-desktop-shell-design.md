# Electron 桌面开发壳设计（Win + Mac）

**状态：** 实现中  
**日期：** 2026-08-09  
**范围档位：** B — 完整桌面应用（未签名安装包；不做自动更新）

---

## 0. 产品边界（2026-08-18）

本仓库从现在起按 **PC 桌面产品** 开发。公网网站另起项目，不从本仓库分叉、不把当前 `server.ts` 当公网站点后端。

| 形态 | 归属 |
|---|---|
| 桌面窗（Electron 壳 + 现有 Next/Agent） | 本仓库，产品路径 |
| `pnpm dev` 浏览器打开 | 本仓库，仅调试 UI / Agent |
| 公网网站 / 多用户 / 账号 | 仓库外，另做 |

A 档仍不改业务 UI、不打安装包。日常功能开发可以继续用 `pnpm dev`；`pnpm dev:desktop` 是同一套服务的桌面窗。

---

## 1. 背景与目标

Vibeboard当前是本地优先的 Next.js 应用：自定义 `server.ts`（含 WebSocket）、可选 daemon、数据落在仓库 `.vad/`。

本轮目标：用 Electron 提供 **Win / Mac 可用的开发态桌面窗口**，一条命令打开应用。浏览器 `pnpm dev` 只保留为调试入口，不再当产品形态。

**成功标准：**

1. Win / Mac 上 `pnpm dev:desktop` 可打开桌面窗并正常使用画布与聊天。
2. 本轮由 Electron 拉起的 Node 子进程在关窗时退出。
3. 现有 `pnpm dev`（浏览器）行为不变，供继续做功能。

---

## 2. 非目标（本轮不做）

- `electron-builder` / Windows `.exe` / macOS `.dmg`
- 代码签名、自动更新、托盘、开机自启
- 将 `VAD_ROOT` 迁移到用户目录（AppData / Application Support）
- 改写业务 UI、Agent、API、存储逻辑

---

## 3. 架构

```
Electron Main (desktop/main.cjs)
  ├─ 单实例锁（requestSingleInstanceLock）
  ├─ 探测 http://127.0.0.1:<PORT>（默认 3000）
  ├─ 未就绪 → spawn 现有服务：
  │     pnpm exec tsx --import ./preload.cjs server.ts
  │     （cwd = 仓库根；继承 env；PORT/HOSTNAME 可覆盖）
  ├─ 就绪 → BrowserWindow.loadURL
  └─ window-all-closed / before-quit → 结束本轮拉起的子进程
```

- **渲染层：** 现有 Web UI，无独立 React 桌面树。
- **数据：** 仍使用 `process.cwd()` 下的 `.vad/`（与现网一致）。
- **daemon：** 本轮不强制启动；行为与浏览器 `pnpm dev` 一致。

### 3.1 端口占用策略

| 情况 | 行为 |
|------|------|
| 3000（或 `PORT`）已有 Vibeboard 服务 | Electron 只开窗，不二次 spawn |
| 端口空闲 | Electron spawn `server.ts`，轮询就绪后开窗 |
| 轮询超时（如 60s） | 主进程日志报错，窗口可显示简单错误页或退出 |

判定「已有服务」：对 `http://127.0.0.1:PORT` 做 HTTP GET（任意 2xx/3xx/4xx HTML/JSON 均视为端口上有 HTTP 服务即可；不要求专门 health API）。

---

## 4. 文件与依赖

| 路径 | 职责 |
|------|------|
| `desktop/main.cjs` | Electron 主进程：单实例、启停服务、开窗、菜单、外链 |
| `desktop/preload.cjs` | `contextIsolation` 预加载；本轮可不暴露 API（空桥或最小 stub） |
| `desktop/origin.cjs` | 本机 URL 白名单 |
| `package.json` | 增加 `electron`（devDependency）；scripts：`dev:desktop` |

建议 scripts：

- `dev:desktop`：启动 Electron（主进程内按需拉起 server）
- 可选别名 `electron:dev` → 同上

不修改 `next.config.ts`、不引入 `output: 'standalone'`（那是安装包阶段的事）。

---

## 5. 主进程行为细节

1. **工作目录：** 始终为仓库根（`app.getAppPath()` 的上级或 `process.cwd()` 在 `electron .` 时指向根）。
2. **安全：** `nodeIntegration: false`，`contextIsolation: true`，使用 `desktop/preload.cjs`。
3. **窗口：** 合理默认尺寸（如 1280×800），标题 `Vibeboard`。
4. **生命周期：** 仅当本进程 spawn 了子进程时，退出时 `kill` 该子进程（含 Windows `taskkill`/树杀或 `detached: false` + 信号）；若复用已有服务则不杀。
5. **平台：** 主进程用 CommonJS（`.cjs`），避免 Electron 与 ESM/tsx 混用问题；Win / Mac 共用同一套脚本。

---

## 6. 错误处理

- Spawn 失败：主进程 `console.error`，可 `dialog.showErrorBox`，然后 `app.quit()`。
- 服务超时未就绪：同上。
- 渲染层加载失败：依赖 Chromium 默认错误。
- 冷启动先显示同窗口 data URL 等待页（「正在启动本地服务」），就绪后再 `loadURL` 到 sidecar。
- 外链经 `setWindowOpenHandler` / `will-navigate` 交给系统浏览器；仅允许导航到本机 `PORT`。

---

## 7. 测试与验证

手工验证（本轮无自动化 E2E）：

1. 冷启动：无 `pnpm dev` → `pnpm dev:desktop` → 窗内可用。
2. 热挂载：先 `pnpm dev` → 再 `pnpm dev:desktop` → 只多一个窗，无端口冲突。
3. 关窗：冷启动场景下子进程退出（任务管理器 / `lsof` 确认端口释放）。
4. 浏览器回归：单独 `pnpm dev` 仍正常。

Win 与 Mac 各跑一遍上述 1–3（若当前环境只有 Win，Mac 以代码审查 + 脚本跨平台写法保证，并在文档注明待真机验证）。

---

## 8. B 档 · 完整桌面应用（本轮补齐）

产品形态不再是「随便包一层浏览器」：

| 能力 | 做法 |
|---|---|
| 身份 | `appId=com.vibeboard.desktop`，任务栏 / 开始菜单名 `Vibeboard` |
| 数据 | 桌面进程写入 `userData/vad` 与 `userData/vad-data`（`VAD_ROOT` / `VAD_CHECKPOINTS_DIR`）；`pnpm dev` 浏览器仍用仓库 `.vad/` |
| 端口 | 桌面默认 `18765`，不和浏览器 3000 抢同一份数据 |
| 窗口 | 记住位置与最大化；最小 960×640；应用图标 |
| 菜单 | 打开项目目录 / 用户数据 / 日志；关于（版本 + 路径） |
| 日志 | `userData/logs/desktop.log` |
| 安装包 | `pnpm dist:desktop`：standalone Next + 打包进 extraResources 的 Node + `electron-builder` NSIS/DMG |
| 网站 | 仍另起，不在本仓库 |

**仍延期（C 档）：** 代码签名 / 公证 / SmartScreen、自动更新、托盘、`vad://` 协议。

---

## 8.1 后续（明确延期）

- C 档：签名、自动更新、协议、多 channel
- 公网网站：另起仓库，不在本规格范围

---

## 9. 规格自检

| 检查项 | 结果 |
|--------|------|
| 无 TBD/TODO 占位 | 通过 |
| 范围与非目标清晰 | 通过 |
| 与现有 server/preload 启动方式一致 | 通过（复用 `tsx --import ./preload.cjs server.ts`） |
| 不要求本轮改业务代码 | 通过 |
| 产品边界 | 本仓库桌面；网站另起 |

---

## 10. 修订

- 2026-08-09：A 档开发壳规格。
- 2026-08-18：产品边界改为「本仓库只做桌面，网站另起」；`pnpm dev` 降为调试入口。开始落地 `desktop/`。
- 2026-08-18：开发壳补等待页、应用菜单、外链走系统浏览器、本机导航白名单。
- 2026-08-18：升为完整桌面应用：userData 路径合同、专用端口、窗口状态、图标、electron-builder sidecar 打包。
- 2026-08-19：自定义顶栏/底栏。`titleBarStyle: hidden` + overlay；网页画菜单与状态条；浏览器 `pnpm dev` 不变。

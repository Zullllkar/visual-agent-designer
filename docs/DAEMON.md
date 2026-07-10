# VAD Daemon（`.vad` 独立落盘进程）

> 阶段 1：独立 Node 进程写 `.vad/projects/`，Next.js 通过 HTTP 转发。  
> 浏览器仍只访问 `/api/*`，无需改前端 store。

## 为什么需要 Daemon

- Next 开发模式热重载时，进程内写盘与 Agent 长任务挤在同一进程
- 将来可把 Daemon 换成常驻服务 / 文件监听 / 外部编辑器同步
- 落盘失败时可与 Web 进程隔离重启

## 快速开始

**终端 1** — 启动 Daemon：

```bash
pnpm install
pnpm daemon
```

默认监听 `http://127.0.0.1:3921`，数据目录为项目根下的 `.vad/`。

**终端 2** — 在 `.env.local` 中启用转发：

```env
VAD_DAEMON_URL=http://127.0.0.1:3921
```

然后照常 `pnpm dev`。

未配置 `VAD_DAEMON_URL` 时，行为与之前一致（Next 进程直接写 `.vad/`）。

## 环境变量

| 变量 | 说明 |
|------|------|
| `VAD_DAEMON_URL` | Next 转发目标，如 `http://127.0.0.1:3921` |
| `VAD_USE_DAEMON` | 设为 `true` 且未设 URL 时，默认连 `127.0.0.1:${VAD_DAEMON_PORT}` |
| `VAD_DAEMON_PORT` | Daemon 端口，默认 `3921` |
| `VAD_DAEMON_HOST` | 绑定地址，默认 `127.0.0.1` |
| `VAD_DAEMON_TOKEN` | 可选；设置后请求需带头 `x-vad-daemon-token` |

## HTTP API（Daemon）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/v1/projects` | 项目列表 |
| POST | `/v1/projects` | 保存项目（含 handoff 同步） |
| GET | `/v1/projects/:id` | 读取项目（合并 canvas.json） |
| GET/POST | `/v1/projects/:id/chat` | chat-history.jsonl |
| GET | `/v1/projects/:id/files` | 文件树 |
| GET/PUT | `/v1/projects/:id/files/...` | 读写 artifact |

Next 侧状态：`GET /api/daemon/status`（设置页可展示是否已连接）。

## 回退策略

配置了 `VAD_DAEMON_URL` 但 Daemon 不可达时，`src/lib/vad/storage.ts` 会 **自动回退** 到进程内写盘，并在服务端日志打印 `[vad-storage] daemon ... failed, fallback local`。

## 阶段 2：文件监听热更新（已实现）

IDE 打开项目后会订阅：

```
GET /api/projects/<id>/watch   (SSE)
```

- **Daemon 模式**：Next 代理 Daemon 的 `/v1/projects/<id>/watch`
- **内联模式**：Next 进程内 `fs.watch` 监听 `.vad/projects/`
- Daemon 不可达时 watch 自动回退内联

监听范围（变更后自动刷新）：

| 文件 | IDE 行为 |
|------|----------|
| `project.json` / `canvas.json` / `design/pages/*.canvas.json` | `reloadFromDisk` → 画布与侧栏更新 |
| `chat-history.jsonl` | 合并更长对话记录 |
| `prompts/`、`handoff/`、`assets/` 等 | Artifact 文件树刷新 |

外部用 VS Code 编辑 `.vad/projects/<id>/project.json` 保存后，无需刷新页面即可看到画布更新。

## Coding Agent（参考 Open Design）

| API | 说明 |
|-----|------|
| `GET /api/agents` | 检测本机 `claude` / `codex`（PATH + 配置目录） |
| `POST /api/skills/sync-cli` | 将 `skills/` symlink 到 `~/.claude/skills/vad-*` |
| `POST /api/projects/<id>/html-session` | HTML 分支 SSE（Daemon 同路径 `/v1/...`） |

Chat 工具 `generate_html_prototype`：不替代画布 Orchestrator，产出 `html-artifact/index.html`。

## 后续阶段（未实现）

- [ ] Adapter 真·流式 stdout（当前为完成后解析）
- [ ] 客户端直连 Daemon（跳过 Next）
- [ ] systemd / Windows 服务安装脚本
- [ ] 多工作区 / 自定义 `VAD_ROOT`

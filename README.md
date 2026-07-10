# Visual Agent Designer (VAD)

本地优先的可视化设计 Agent IDE：把「产品想法 → Brief → 视觉方向 → 高保真图片素材 → Handoff 开发包」串成一条可追踪流水线，供 Cursor / Claude Code / Codex 等 coding agent 直接落地代码。

## 特性

- **ChatCanvas 工作台**：在无限画布（tldraw）上产出成品视觉资产，而非网页结构 mock
- **多 Agent 流水线**：Brief → Architect → Design Direction → Layout → Content → Image Plan → Image Execute → Critic / Repair
- **本地优先**：项目数据落盘 `.vad/projects/`，LLM / 生图 Provider 在设置页配置，无需上传 API Key 到云端
- **Handoff 导出**：PNG 素材、prompts、设计 token、Brief 上下文一键打包
- **可选 Daemon**：独立进程处理落盘，避免 Next.js 热重载与长任务争抢（见 [docs/DAEMON.md](docs/DAEMON.md)）

## 技术栈

- Next.js 16 · React 19 · TypeScript
- tldraw 5 · Zustand · Tailwind CSS 4

## 快速开始

```bash
pnpm install
cp .env.example .env.local   # optional
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000)。

如需独立落盘进程（推荐开发时启用）：

```bash
# 终端 1
pnpm daemon

# 终端 2 — 在 .env.local 中设置 VAD_DAEMON_URL=http://127.0.0.1:3921
pnpm dev
```

## 脚本

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 启动 Next.js 开发服务器 |
| `pnpm daemon` | 启动 VAD 落盘 Daemon（默认 `127.0.0.1:3921`） |
| `pnpm build` | 生产构建 |
| `pnpm start` | 启动生产服务器 |
| `pnpm lint` | ESLint 检查 |

## 文档

- [架构概览](docs/ARCHITECTURE.md)
- [Daemon 说明](docs/DAEMON.md)
- [产品设计](PRODUCT.md)

## License

Apache License 2.0

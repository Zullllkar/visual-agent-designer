# Visual Agent Designer (VAD)

[English](#english) · [中文](#中文)

---

## 中文

**本地优先的可视化设计 Agent IDE** — 把「产品想法 → Brief → 视觉方向 → 高保真图片素材 → Handoff 开发包」串成一条可追踪流水线，供 Cursor / Claude Code / Codex 等 coding agent 直接落地代码。

### 核心能力

- **ChatCanvas 工作台**：在无限画布（tldraw）上产出成品视觉资产，而非网页结构 mock
- **多 Agent 流水线**：Brief → Architect → Design Direction → Layout → Content → Image Plan → Image Execute → Critic / Repair
- **本地优先**：项目数据落盘 `.vad/projects/`，LLM / 生图 Provider 在设置页配置，API Key 不上传云端
- **Handoff 导出**：PNG 素材、prompts、设计 token、Brief 上下文一键打包
- **可选 Daemon**：独立进程处理落盘，避免 Next.js 热重载与长任务争抢（见 [docs/DAEMON.md](docs/DAEMON.md)）

### 技术栈

Next.js 16 · React 19 · TypeScript · tldraw 5 · Zustand · Tailwind CSS 4

### 快速开始

```bash
pnpm install
cp .env.example .env.local   # 可选
pnpm dev
```

浏览器打开 [http://localhost:3000](http://localhost:3000)。

**可选：启用 Daemon（推荐开发时使用）**

```bash
# 终端 1
pnpm daemon

# 终端 2 — 在 .env.local 中设置 VAD_DAEMON_URL=http://127.0.0.1:3921
pnpm dev
```

### 常用命令

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 启动 Next.js 开发服务器 |
| `pnpm daemon` | 启动 VAD 落盘 Daemon（默认 `127.0.0.1:3921`） |
| `pnpm build` | 生产构建 |
| `pnpm start` | 启动生产服务器 |
| `pnpm lint` | ESLint 检查 |

### 文档

- [架构概览](docs/ARCHITECTURE.md)
- [Daemon 说明](docs/DAEMON.md)
- [产品设计](PRODUCT.md)

### 适用人群

独立开发者与一人全栈团队：手头有产品想法，需要快速产出**可交付的视觉素材图**，并把图片、prompt 与设计上下文打包交给 coding agent 实现代码。

---

## English

**A local-first visual design Agent IDE** — turns product ideas into deliverable visual assets through a traceable pipeline: Brief → Design Direction → High-fidelity Images → Handoff package, ready for Cursor, Claude Code, Codex, and other coding agents.

### Key Features

- **ChatCanvas workspace**: produce finished visual assets on an infinite canvas (tldraw), not wireframe-style page mocks
- **Multi-agent pipeline**: Brief → Architect → Design Direction → Layout → Content → Image Plan → Image Execute → Critic / Repair
- **Local-first**: projects persist to `.vad/projects/`; LLM and image providers are configured in-app — API keys never leave your machine
- **Handoff export**: one-click bundle of PNG assets, prompts, design tokens, and Brief context
- **Optional daemon**: separate process for disk I/O, keeping long agent tasks away from Next.js hot reload ([docs/DAEMON.md](docs/DAEMON.md))

### Tech Stack

Next.js 16 · React 19 · TypeScript · tldraw 5 · Zustand · Tailwind CSS 4

### Quick Start

```bash
pnpm install
cp .env.example .env.local   # optional
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

**Optional: enable the Daemon (recommended for development)**

```bash
# Terminal 1
pnpm daemon

# Terminal 2 — set VAD_DAEMON_URL=http://127.0.0.1:3921 in .env.local
pnpm dev
```

### Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start Next.js dev server |
| `pnpm daemon` | Start VAD persistence daemon (default `127.0.0.1:3921`) |
| `pnpm build` | Production build |
| `pnpm start` | Start production server |
| `pnpm lint` | Run ESLint |

### Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Daemon](docs/DAEMON.md)
- [Product spec](PRODUCT.md)

### Who It's For

Solo developers and one-person full-stack teams who need **production-ready visual assets** fast, with prompts and design context packaged for coding agents — without uploading sensitive API keys to the cloud.

---

## License

Apache License 2.0

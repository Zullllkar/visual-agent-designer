<div align="center">

# Vibeboard

### The design studio that talks to your coding agent.

Write a brief. Watch a team of AI agents design, iterate, and produce pixel-perfect visual assets on an infinite canvas. Export a handoff package — and your Cursor / Claude Code / Codex turns it into shipped code.

**No Figma. No design background. No API keys leaving your machine.**

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-61dafb)](https://react.dev)
[![tldraw](https://img.shields.io/badge/tldraw-5-000000)](https://tldraw.dev)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[English](#what-is-this) · [中文](README.zh.md) · [Roadmap](ROADMAP.md) · [Contributing](CONTRIBUTING.md)

</div>

---

## What is this?

You're a developer. You have a product idea. You know what it should look like — roughly — but you can't design it, and you don't want to pay a designer for something that might change tomorrow.

**Vibeboard** sits in the gap between "I have an idea" and "Cursor is writing the code."

You write a brief. A team of AI agents — Architect, Design Director, Layout Engineer, Content Writer, Image Planner, Image Executor, and a Critic — collaborate on an infinite canvas to produce **finished visual assets**, not wireframes, not HTML mockups, not "design files" that someone still has to interpret. Then you click one button and everything — PNGs, prompts, design tokens, context — gets bundled into a folder your coding agent reads and understands.

```
Your idea ──→ Brief ──→ 7 agents collaborate on canvas ──→ Handoff package ──→ Cursor ships code
                                    ↑
                          you watch, iterate, refine
```

### Pipeline

```
Product Idea → Brief → Architect → Design Direction → Layout → Content
                                                         ↓
                              Image Plan → Image Execute → Critic / Repair
                                                         ↓
                                         Handoff Package (PNG + Prompts + Tokens)
```

## Why it's different

- **Outputs images, not wireframes** — Every asset on the canvas is a finished, high-fidelity visual. Not a boxy gray mockup. Not a "design file" someone has to interpret. Something you can put in a README today.
- **7-agent pipeline, not a chat box** — Instead of one AI guessing everything, specialized agents handle structure, visual direction, layout, copy, image planning, image generation, and quality review — each doing one thing well.
- **Handoff package, not a screenshot** — Export isn't just PNGs. It's PNGs + prompts + design tokens + full context, structured so Cursor / Claude Code / Codex can read it and write code that matches the design.
- **Your API keys never touch the cloud** — LLM and image providers are configured in-app. Keys stay on your machine. Projects persist to local filesystem. No account, no telemetry, no upload.
- **It's an IDE, not a landing page** — The workspace feels like a tool, not a marketing site. Dense, keyboard-friendly, status-visible. You see what each agent is doing, when, and why.

## Quick Start

### Prerequisites

- **Node.js** 18.18+ (or 20+)
- **pnpm** 8+ (`npm i -g pnpm`)
- An LLM API key (OpenAI, Anthropic, or any OpenAI-compatible provider)

### Install & Run

```bash
git clone https://github.com/Zullllkar/vibeboard.git
cd vibeboard
pnpm install
cp .env.example .env.local   # optional — configure providers in-app instead
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser (debug). Desktop window:

```bash
pnpm dev:desktop
```

If `pnpm dev` is already running, this only opens a window and will not spawn a second server.

### Connect Cursor / Claude Code / Codex (no zip)

With the app running, open **Settings → 连接**.

- **Cursor**: click “在 Cursor 中安装” (deeplink) or “写入配置”.
- **Claude Code**: one-click `claude mcp add --transport http`.
- **Codex**: one-click `codex mcp add --url` plus `~/.codex/config.toml` headers.

Coding agents then call `get_handoff` / `get_asset_image` against `http://127.0.0.1:<port>/mcp` (Bearer token, loopback only). From a Handoff dialog you can also **link a code repo** so the package is written to `design/vibeboard/` with `AGENTS.md` / `CLAUDE.md` snippets — no download/unzip.

Fallback for stdio-only hosts:

```bash
node cli.js mcp
```

### Optional: Enable the Daemon (recommended for development)

```bash
# Terminal 1
pnpm daemon

# Terminal 2 — set VAD_DAEMON_URL=http://127.0.0.1:3921 in .env.local
pnpm dev
```

### Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start Next.js dev server (browser debug) |
| `pnpm dev:desktop` | Open the desktop app (userData, port 18765) |
| `pnpm dist:desktop` | Build unsigned NSIS / DMG |
| `pnpm dist:desktop:dir` | Unpacked app folder for smoke tests |
| `pnpm daemon` | Start Vibeboard persistence daemon (default `127.0.0.1:3921`) |
| `pnpm build` | Production build |
| `pnpm start` | Start production server |
| `pnpm lint` | Run ESLint |

## Built with

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| UI | React 19 · Tailwind CSS 4 |
| Canvas | tldraw 5 |
| State | Zustand |
| Language | TypeScript 5 |
| Persistence | Your filesystem — `.vad/projects/` |

## How it works

```
1. Write a brief          →  Name, positioning, target users, platform, visual style, core features
2. Agents go to work      →  Architect → Design Direction → Layout → Content → Image Plan → Execute → Critic
3. Watch on canvas        →  Everything lands on an infinite tldraw canvas. Iterate, rearrange, refine.
4. Click Export Handoff   →  PNGs + prompts + design tokens + Brief context → one folder → feed to your coding agent
```

## How it compares

| | Vibeboard | v0 | Figma AI | Lovart |
|---|---|---|---|---|
| What it outputs | Finished images | Code | Design files | Chat + images |
| Infinite canvas | ✅ tldraw | ❌ | ❌ | ✅ |
| Multi-agent pipeline | ✅ 7 specialized agents | ❌ single pass | ❌ | ~ partial |
| Handoff for coding agents | ✅ PNG + prompts + tokens + context | code only | design files | chat history |
| API keys stay local | ✅ | N/A | ❌ | ❌ |
| Open source | ✅ Apache 2.0 | ❌ | ❌ | ❌ |
| Requires design skills | ❌ | ❌ | ✅ | ❌ |

## Documentation

- [Architecture Overview](docs/ARCHITECTURE.md)
- [Daemon Guide](docs/DAEMON.md)
- [Product Specification](PRODUCT.md)
- [Design System](DESIGN.md)
- [Roadmap](ROADMAP.md)
- [Changelog](CHANGELOG.md)

## Who it's for

You write code. You have ideas. You don't have a designer — or you do, but you need to move faster than the design review cycle allows. Vibeboard is built for the **indie hacker, the one-person full-stack team, the weekend project builder** who needs to go from "I think this should look like..." to "Cursor, here's the design, build it" in one session.

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on bug reports, feature requests, and pull requests.

## Roadmap

See [ROADMAP.md](ROADMAP.md) for planned features and milestones.

## License

[Apache License 2.0](LICENSE)

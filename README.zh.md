<div align="center">

# Vibeboard

### 能跟你的 coding agent 对话的设计工作室。

写一段 Brief。看七个 AI Agent 在无限画布上协作设计、迭代、产出像素级视觉素材。一键导出 Handoff 包——你的 Cursor / Claude Code / Codex 拿来就写代码。

**不用 Figma。不需要设计基础。API Key 不出本机。**

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-61dafb)](https://react.dev)
[![tldraw](https://img.shields.io/badge/tldraw-5-000000)](https://tldraw.dev)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[English](README.md) · [中文](#这是什么) · [路线图](ROADMAP.md) · [贡献指南](CONTRIBUTING.md)

</div>

---

## 这是什么？

你是个开发者。你有个产品想法。你大概知道它应该长什么样——但你不会设计，也不想为可能明天就变的东西花钱请设计师。

**Vibeboard** 填的就是「我有个想法」和「Cursor 在写代码」之间的那个空。

你写一段 Brief。七个 AI Agent——架构师、设计方向、布局工程师、文案、图片规划、图片执行、审查员——在无限画布上协作产出**成品视觉素材**，不是线框图，不是 HTML mock，不是还需要别人解读的「设计文件」。然后你点一个按钮，所有东西——PNG、prompts、设计 token、上下文——打包成一个文件夹，你的 coding agent 读了就能写代码。

```
你的想法 ──→ Brief ──→ 7 个 Agent 在画布上协作 ──→ Handoff 包 ──→ Cursor 写代码
                              ↑
                    你看着、迭代、精修
```

### 流水线

```
产品想法 → Brief → Architect → Design Direction → Layout → Content
                                                    ↓
                         Image Plan → Image Execute → Critic / Repair
                                                    ↓
                                    Handoff 包 (PNG + Prompts + Tokens)
```

## 为什么不一样

- **产出的是图片，不是线框图** — 画布上每个素材都是成品级高保真视觉。不是灰盒子 mock，不是还需要人解读的「设计文件」，是今天就能放进 README 的东西。
- **七个 Agent 流水线，不是聊天框** — 不是一个 AI 猜所有事，而是专门的 Agent 分别处理结构、视觉方向、排版、文案、图片规划、图片生成和质量审查——每个只做一件事，做到好。
- **Handoff 包，不是截图** — 导出的不只是 PNG。是 PNG + prompts + 设计 token + 完整上下文，结构化组织，Cursor / Claude Code / Codex 读了就能写出匹配设计的代码。
- **你的 API Key 不出本机** — LLM 和生图 Provider 在应用内配置，Key 留在你机器上，项目落盘本地文件系统。没有账号、没有遥测、没有上传。
- **是 IDE，不是落地页** — 工作台像工具，不像营销网站。信息密度高、键盘友好、状态可见。你能看到每个 Agent 在做什么、什么时候做、为什么做。

## 快速开始

### 前置要求

- **Node.js** 18.18+（或 20+）
- **pnpm** 8+（`npm i -g pnpm`）
- 一个 LLM API Key（OpenAI、Anthropic 或任意 OpenAI 兼容 Provider）

### 安装与运行

```bash
git clone https://github.com/Zullllkar/vibeboard.git
cd vibeboard
pnpm install
cp .env.example .env.local   # 可选 — 也可在应用内配置 Provider
pnpm dev
```

浏览器打开 [http://localhost:3000](http://localhost:3000)（调试用）。桌面窗：

```bash
pnpm dev:desktop
```

若 `pnpm dev` 已在跑，这条命令只会再开一个窗口，不会占第二个端口。

### 可选：启用 Daemon（推荐开发时使用）

```bash
# 终端 1
pnpm daemon

# 终端 2 — 在 .env.local 中设置 VAD_DAEMON_URL=http://127.0.0.1:3921
pnpm dev
```

### 常用命令

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 启动 Next.js 开发服务器（浏览器调试） |
| `pnpm dev:desktop` | 打开桌面应用（数据在用户目录，默认端口 18765） |
| `pnpm dist:desktop` | 打 Windows NSIS / macOS DMG（未签名） |
| `pnpm dist:desktop:dir` | 只出未打包目录，供冒烟 |
| `pnpm daemon` | 启动 Vibeboard 落盘 Daemon（默认 `127.0.0.1:3921`） |
| `pnpm build` | 生产构建 |
| `pnpm start` | 启动生产服务器 |
| `pnpm lint` | ESLint 检查 |

## 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | Next.js 16 (App Router) |
| UI | React 19 · Tailwind CSS 4 |
| 画布 | tldraw 5 |
| 状态 | Zustand |
| 语言 | TypeScript 5 |
| 持久化 | 你的文件系统 — `.vad/projects/` |

## 工作流程

```
1. 写一段 Brief        →  名称、定位、目标用户、平台、视觉风格、核心功能
2. Agent 开始干活       →  Architect → Design Direction → Layout → Content → Image Plan → Execute → Critic
3. 在画布上看           →  所有素材出现在 tldraw 无限画布上。迭代、重排、精修。
4. 点导出 Handoff      →  PNG + prompts + 设计 token + Brief 上下文 → 一个文件夹 → 喂给你的 coding agent
```

## 横向对比

| | Vibeboard | v0 | Figma AI | Lovart |
|---|---|---|---|---|
| 产出物 | 成品图片 | 代码 | 设计文件 | 对话 + 图片 |
| 无限画布 | ✅ tldraw | ❌ | ❌ | ✅ |
| 多 Agent 流水线 | ✅ 7 个专门 Agent | ❌ 单次生成 | ❌ | ~ 部分 |
| Coding Agent 交付 | ✅ PNG + prompts + tokens + 上下文 | 仅代码 | 设计文件 | 对话记录 |
| API Key 本地保存 | ✅ | N/A | ❌ | ❌ |
| 开源 | ✅ Apache 2.0 | ❌ | ❌ | ❌ |
| 需要设计基础 | ❌ | ❌ | ✅ | ❌ |

## 文档

- [架构概览](docs/ARCHITECTURE.md)
- [Daemon 说明](docs/DAEMON.md)
- [产品设计](PRODUCT.md)
- [设计系统](DESIGN.md)
- [路线图](ROADMAP.md)
- [更新日志](CHANGELOG.md)

## 适用人群

你写代码。你有想法。你没有设计师——或者你有，但你需要比设计评审周期更快地推进。Vibeboard 为**独立开发者、一人全栈团队、周末项目建造者**而生：从「我觉得它应该长这样……」到「Cursor，这是设计，开始写」一个 session 搞定。

## 贡献

欢迎贡献！请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 了解如何提交 bug 报告、功能请求和 Pull Request。

## 路线图

请查看 [ROADMAP.md](ROADMAP.md) 了解计划中的功能和里程碑。

## 开源协议

[Apache License 2.0](LICENSE)

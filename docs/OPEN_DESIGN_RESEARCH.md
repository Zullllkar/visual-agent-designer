# Open Design 架构、功能、技术栈与 Agent 流程研究

> 研究对象：`nexu-io/open-design`
>
> 资料时间：2026-05-23
>
> 说明：本文基于 Open Design 官方 GitHub README、docs/spec.md、docs/architecture.md、docs/agent-adapters.md、docs/skills-protocol.md、docs/modes.md、QUICKSTART.md 以及官网公开页面整理。部分章节会标注“推断”，表示这是根据公开结构和流程做出的架构归纳。

---

## 1. Open Design 是什么

Open Design 是一个开源、本地优先、BYOK 的 AI 设计环境，定位为 Claude Design 的开源替代方案。

它的核心不是自己重新实现一个完整 AI agent，而是：

> 调用用户本机已经安装的 coding agent CLI，例如 Claude Code、Codex、Cursor Agent、Gemini CLI、OpenCode、Qwen 等，把这些 coding agent 变成设计引擎。

官方产品定义可以概括为：

> 一个 Web App，通过编排用户本机的 code agent，把自然语言 brief 转成可预览、可导出、可继续编辑的设计 artifact。

它支持的输出形态包括：

- Web / App / Dashboard / Docs / Blog 等产品原型
- Deck / PPT / 演示文稿
- Template 填充
- Design System 生成
- HTML / PDF / PPTX / ZIP / Markdown 等导出
- 图片、视频、HyperFrames 等媒体生成能力

Open Design 的重要产品哲学：

- 不拥有模型
- 不拥有 agent loop
- 不强制云端
- 不强制单一模型供应商
- 不做 Figma 替代
- 设计能力通过 Skill 文件和 Design System 文件扩展

---

## 2. 产品定位与设计理念

## 2.1 核心定位

Open Design 的定位可以拆成四层：

1. **AI Design Shell**
   一个运行设计任务的外壳。

2. **Coding Agent Orchestrator**
   调用现有 coding agent CLI 完成生成、修改、导出。

3. **Skill Runtime**
   通过 `SKILL.md` 定义不同设计能力，例如 prototype、deck、dashboard、mobile app。

4. **Design System Runtime**
   通过 `DESIGN.md` 注入品牌、颜色、字体、组件风格、布局规则和反模式。

## 2.2 它不是传统设计工具

Open Design 明确不是：

- Figma 替代品
- 纯画布编辑器
- 自研模型路由器
- 自研 agent runtime
- 重型 SaaS 设计平台

它更像：

> 一个把 coding agent、设计技能、设计系统、文件系统、预览器和导出器组合起来的设计工作台。

## 2.3 关键差异点

相比 Claude Design：

- Open Design 是开源的。
- 可以本地运行。
- 支持 BYOK。
- 可以接用户自己的 coding agent。
- Skill 和 Design System 是文件，可以被版本管理。

相比 Open CoDesign：

- Open Design 采用 Web App + Local Daemon，而不是单纯 Electron 架构。
- 它不自己拥有 agent loop，而是适配外部 coding agent。
- Skill 采用 `SKILL.md` 约定，而不是写死在应用内部。

---

## 3. 整体系统架构

Open Design 的架构核心是：

```txt
Web App
  -> Local Daemon
  -> Agent Adapter
  -> 用户本机 Coding Agent CLI
  -> 文件系统 Artifact
  -> Sandboxed Preview
  -> Export Pipeline
```

## 3.1 三种部署拓扑

官方架构文档给出三种形态。

### A. 完全本地模式，默认模式

```txt
Browser
  -> Next.js dev server
  -> od daemon
  -> spawn claude / codex / cursor / gemini / ...
```

特点：

- 本机浏览器打开 Web App。
- 本机启动 Next.js。
- 本机启动 Node daemon。
- daemon 负责调用本机 agent CLI。
- 无账号。
- 无云端依赖。

### B. Web 部署 + 本机 daemon

```txt
Browser
  -> Vercel Web App
  -> user-provided tunnel
  -> local od daemon
  -> local agent CLI
```

特点：

- Web UI 可以部署到 Vercel。
- daemon 仍然运行在用户本机。
- 机密信息保留在本地 daemon。
- Web 端通过用户提供的 URL 连接 daemon。

### C. 纯 Web + Direct API 模式

```txt
Browser
  -> Vercel serverless
  -> Anthropic / OpenAI-compatible / Gemini API
```

特点：

- 没有本地 CLI。
- 没有本地 daemon。
- 体验降级。
- 文件 artifact 存储能力变弱。
- 适合快速试用。

## 3.2 逻辑组件图

```txt
┌─────────────────────────────── Web App ───────────────────────────────┐
│ Chat Pane                                                              │
│ Artifact Tree                                                          │
│ Preview iframe                                                         │
│ Comment / Slider Overlay                                               │
│ Transport Layer: daemon SSE | API direct | browser runtime             │
└───────────────────────────────┬───────────────────────────────────────┘
                                │
                                ▼
┌────────────────────────────── Daemon ─────────────────────────────────┐
│ Session Manager                                                       │
│ Skill Registry                                                        │
│ Agent Adapter Pool                                                    │
│ Design System Resolver                                                │
│ Artifact Store                                                        │
│ Preview Compile Pipeline                                              │
│ Export Pipeline                                                       │
│ Detection Service                                                     │
└──────────────────────┬──────────────────────────────┬────────────────┘
                       │                              │
                       ▼                              ▼
              Agent CLIs                       File System
       Claude / Codex / Cursor             .od / skills / DESIGN.md
       Gemini / OpenCode / Qwen
```

---

## 4. 项目技术栈

## 4.1 Monorepo 与基础环境

公开仓库显示：

- 包管理：`pnpm`
- Node：`~24`
- pnpm：`10.33.x`
- TypeScript：`5.9.x`
- Monorepo：`apps/*`、`packages/*`、`tools/*`、`e2e`
- License：Apache-2.0

根目录重要结构：

```txt
open-design/
  apps/
    daemon/
    web/
    desktop/
  packages/
    contracts/
    sidecar-proto/
    sidecar/
    platform/
  tools/
    dev/
  e2e/
  skills/
  design-systems/
  docs/
  .od/
  pnpm-workspace.yaml
  package.json
```

## 4.2 Web App

官方架构文档写明 Web App 使用：

- Next.js 16
- App Router
- React
- TypeScript

Web App 职责：

- Chat UI
- 模式选择
- Skill 选择
- Design System 选择
- Artifact Tree
- 预览 iframe
- Comment Mode
- Slider 参数控制
- Export UI
- 与 daemon 通信

为什么使用 Next.js，而不是 Vite SPA：

- 需要 SSR 支撑 landing 页面。
- 需要 serverless route 支撑 Direct API 模式。
- 需要 Vercel 部署作为一等场景。

## 4.3 Local Daemon

daemon 是 Open Design 最关键的后端组件。

技术栈：

- Node.js
- Express / HTTP API
- Server-Sent Events
- 本地文件系统
- better-sqlite3，Quickstart 文件结构显示 `.od/app.sqlite`

daemon 职责：

- 监听本地端口，默认 `localhost:7456`
- 暴露 `/api/*`
- 管理 session
- 扫描本机 agent CLI
- 管理 agent adapter pool
- 加载 skills
- 加载 design systems
- 创建 artifact 工作目录
- 调用 coding agent
- 接收 streaming 输出
- 写入 artifact 文件
- 编译预览
- 执行导出

## 4.4 Desktop

项目中存在 `apps/desktop`。

根据 Quickstart，`pnpm tools-dev` 可以启动：

```txt
daemon + web + desktop
```

推断：

- Desktop 不是核心运行时。
- 它更像一个包装器或辅助壳。
- 核心仍然是 Web + daemon。

## 4.5 数据与存储

Open Design 的存储分两类：

### Artifact 文件存储

架构文档强调 artifact 是 plain files：

```txt
.od/
  config.json
  artifacts/
    2026-04-24T10-03-12-landing/
      artifact.json
      index.html
      assets/
  history.jsonl
  sessions/
```

好处：

- 可被 Git 管理
- 可在 PR 中 review
- artifact 可独立保存
- 方便用户直接检查生成内容

### App 状态数据库

Quickstart 文件结构中也出现：

```txt
.od/
  app.sqlite
  artifacts/
  projects/<id>/
```

这说明当前实现里可能同时使用：

- 文件系统保存 artifact
- SQLite 保存项目、会话、消息、tab 等应用状态

注意：

> 公开文档中 `architecture.md` 和 `QUICKSTART.md` 对 SQLite 的描述存在差异。合理理解是：设计理念上偏 plain files，但运行态应用数据已经引入 SQLite。

---

## 5. 功能设计架构

Open Design 的功能可以拆成八个核心模块。

## 5.1 Entry / Composer

用户入口包括：

- 选择 Mode
- 选择 Skill
- 选择 Design System
- 输入自然语言 brief
- 填写 discovery 表单
- 选择视觉方向
- 运行生成

Open Design 很强调“生成前先问清楚”。

它会在新 brief 的第一轮生成 discovery question form，用于锁定：

- surface
- audience
- tone
- brand context
- scale
- constraints

这能减少 AI freestyle，避免生成后大改方向。

## 5.2 Mode 系统

官方 `modes.md` 定义了四种模式。

### Prototype Mode

目标：

- 生成一个高保真屏幕或页面流程。

输出：

- `index.html`
- `Prototype.jsx`
- `assets/`
- `artifact.json`

支持：

- iframe preview
- comment refine
- 参数 slider
- HTML / PDF / ZIP 导出

### Deck Mode

目标：

- 生成多页演示文稿。

输出：

- HTML deck
- `slides.json`
- assets
- PDF
- PPTX

### Template Mode

目标：

- 从已有模板快速填充内容。

特点：

- 不让 agent 大幅决定布局。
- agent 主要填充内容。
- 速度更快。
- 下限更高。

### Design System Mode

目标：

- 生成 `DESIGN.md`。

输入：

- screenshot
- brand guide PDF
- URL
- free text brief

输出：

- `DESIGN.md`
- `preview.html`
- `tokens.json`

## 5.3 Skill 系统

Skill 是 Open Design 的设计能力单元。

每个 Skill 通常包含：

```txt
skill-name/
  SKILL.md
  assets/
  references/
```

Open Design 采用 Claude Code 的 `SKILL.md` 约定，并增加设计相关字段。

Skill 类型包括：

- prototype-skill
- deck-skill
- template-skill
- design-system-skill

官方示例技能：

- `web-prototype`
- `saas-landing`
- `dashboard`
- `pricing-page`
- `docs-page`
- `blog-post`
- `mobile-app`
- `simple-deck`
- `magazine-web-ppt`

Skill 的作用：

- 定义任务流程
- 定义输出格式
- 定义输入 schema
- 提供参考文件
- 提供模板
- 提供 checklist
- 指导 agent 生成符合特定设计类型的 artifact

## 5.4 Design System 系统

Design System 以 `DESIGN.md` 文件形式存在。

它不是 JSON theme，而是 Markdown 设计规范。

官方采用 9-section schema：

1. Visual Theme & Atmosphere
2. Color Palette & Roles
3. Typography Rules
4. Component Stylings
5. Layout Principles
6. Depth & Elevation
7. Do's and Don'ts
8. Responsive Behavior
9. Agent Prompt Guide

作用：

- 为每次生成提供品牌规范。
- 被注入 system prompt。
- 作为 skill 中的变量被引用。
- 支持跨 prototype、deck、template 复用。

Open Design 内置大量产品设计系统，例如 Linear、Stripe、Vercel、Airbnb、Tesla、Notion、Apple、Anthropic、Cursor、Supabase、Figma、小红书等。

## 5.5 Artifact 系统

Artifact 是 agent 生成的实际设计产物。

常见 artifact：

- HTML
- JSX
- Markdown
- PPTX JSON
- slides.json
- assets
- metadata

Artifact 生命周期：

```txt
User prompt
  -> daemon 创建 artifact dir
  -> agent 在 cwd 中写文件
  -> web artifact tree 实时更新
  -> preview iframe 渲染主文件
  -> user refine
  -> export
```

## 5.6 Preview 系统

Open Design 使用 sandboxed iframe 预览 artifact。

约束：

- 隔离 artifact code
- 不允许访问 host app cookies / parent DOM
- 支持 HTML 和 JSX
- 支持 hot reload

HTML：

- 使用 `srcdoc` 直接渲染。

JSX：

- 注入 React 18 + Babel standalone。
- 动态转换 JSX 后在 iframe 中执行。

## 5.7 Refinement 系统

Open Design 的 refine 有三类：

1. **Chat refine**
   用户用自然语言要求修改。

2. **Comment mode**
   用户点击预览中的元素，留下局部修改意见。

3. **Slider parameters**
   skill 定义可调参数，用户拖动 slider 触发参数化 prompt。

Comment mode 的核心流程：

```txt
用户点击 iframe 中带 data-od-id 的元素
  -> Web 获取 element_id
  -> 用户输入 note
  -> daemon 调用 session.refine
  -> agent adapter 根据能力执行局部编辑或整体重写
```

如果 active agent 支持 surgical edit，则局部修改。

如果不支持，则降级为：

> 带约束地重新生成目标文件。

## 5.8 Export 系统

官方架构文档列出的导出能力：

- HTML
- PDF
- PPTX
- ZIP
- Markdown

导出实现：

- HTML：内联 CSS，资源 URL 转 data URI。
- PDF：Puppeteer 渲染 HTML 后导出。
- PPTX：deck skill 输出 JSON 中间格式，再由 `pptxgenjs` 生成。
- ZIP：打包 artifact 目录。
- Markdown：直接复制或由 skill 定义渲染方式。

---

## 6. AI Agent 架构

## 6.1 核心原则

Open Design 的 agent 架构原则是：

> 不重新实现 agent loop，而是适配用户已经安装的 coding agent CLI。

也就是说：

- Claude Code 负责 Claude Code 的 agent loop。
- Codex 负责 Codex 的 agent loop。
- Cursor Agent 负责 Cursor 的 agent loop。
- Gemini CLI 负责 Gemini 的 agent loop。

Open Design 只做：

- 检测 agent
- 组合 prompt
- 注入 skill
- 注入 design system
- 设置工作目录
- spawn CLI
- 解析 stream
- 将事件显示到 UI
- 将文件写入 artifact store

## 6.2 Agent Adapter Pool

每个 coding agent 对应一个 adapter。

Adapter 接口核心能力：

```ts
interface AgentAdapter {
  id: string
  displayName: string
  detect(): Promise<AgentDetection | null>
  capabilities(): AgentCapabilities
  run(params: AgentRunParams): AsyncIterable<AgentEvent>
  cancel(runId: string): Promise<void>
  resume?(runId: string, message: string): AsyncIterable<AgentEvent>
}
```

Adapter 需要声明能力：

- 是否支持 surgical edit
- 是否支持 native skill loading
- 是否支持 streaming
- 是否支持 resume
- 权限模式
- context window hint

## 6.3 Agent 检测机制

检测策略：

1. PATH scan
   查找 `claude`、`codex`、`cursor-agent`、`gemini` 等可执行文件。

2. Config directory probe
   检查 `~/.claude/`、`~/.codex/`、`~/.cursor/` 等配置目录。

3. 缓存检测结果
   缓存在 `~/.open-design/agents.json`，文档中提到 24 小时 TTL。

## 6.4 Adapter Catalog

官方 adapter 文档提到的目标 agent 包括：

- Claude Code
- API fallback
- Codex
- Devin for Terminal
- Cursor Agent
- Gemini CLI
- OpenCode
- OpenClaw
- GitHub Copilot CLI
- Kiro
- Kilo
- Mistral Vibe
- DeepSeek TUI
- Qoder CLI
- Pi

MVP 中最重要的是：

- Claude Code
- API fallback

P1 / P2 中逐渐支持：

- Codex
- Cursor Agent
- Gemini CLI
- OpenCode
- Qwen
- Copilot
- DeepSeek 等

## 6.5 Skill 注入方式

Open Design 有三种 skill 注入策略。

### 1. Native skill loading

如果 agent 本身支持 skill 目录，例如 Claude Code：

```txt
~/.claude/skills/
```

Open Design 可以把 skill symlink 过去，让 agent 自己加载。

优点：

- prompt overhead 小
- 更接近 agent 原生体验

### 2. Prompt injection

如果 agent 不支持 skill：

- 读取 `SKILL.md`
- 读取相关 references
- 拼进 system prompt
- 将 assets 复制到 cwd

适用于：

- API fallback
- Cursor Agent
- Gemini CLI
- 其他不支持原生 skill 的 agent

### 3. File-placed workflow

对于支持项目级规则文件的 agent：

- Cursor Agent：写 `.cursorrules`
- OpenCode：写项目级 instruction

让 agent 在项目目录中自动读取这些规则。

## 6.6 事件流

Agent 输出被 adapter 标准化成事件：

- `thinking`
- `tool_call`
- `tool_result`
- `text_delta`
- `file_write`
- `error`
- `done`

Web UI 根据这些事件展示：

- thinking
- 工具调用
- 文件更新
- artifact tree
- preview 更新
- error state

## 6.7 API fallback

当用户没有本地 coding agent CLI 时，Open Design 提供 API fallback。

特点：

- 直接调用模型 API。
- daemon 自己实现最小 tool loop。
- 提供 Read / Write / Edit 工具。
- 权限被限制在 artifact cwd。

这是 Open Design 少数自己拥有 agent loop 的地方。

但官方强调：

> 这个 loop 应该尽量简单，因为主路线仍然是使用用户已有的 coding agent。

---

## 7. Prompt 架构

Open Design 的 prompt 不是简单的：

```txt
system + user
```

而是组合式 prompt stack。

官方 README 中描述的 prompt composition 包括：

```txt
DISCOVERY directives
  + identity charter
  + active DESIGN.md
  + active SKILL.md
  + project metadata
  + skill side files
```

Quickstart 中也给出更简化的版本：

```txt
BASE_SYSTEM_PROMPT
  + active DESIGN.md
  + active SKILL.md
```

## 7.1 Discovery Directives

作用：

- 强制新 brief 先问问题。
- 让 agent 不要直接开始画。
- 先收集 surface、audience、tone、brand context、scale。

## 7.2 Identity Charter

作用：

- 定义 agent 是“设计师”而不是普通聊天助手。
- 约束不要生成 AI 味很重的平庸结果。
- 引导先做 junior pass，再 refined pass。

## 7.3 DESIGN.md

作用：

- 注入品牌风格。
- 约束颜色、字体、布局、组件、动效、禁忌。

## 7.4 SKILL.md

作用：

- 定义当前任务应该如何完成。
- 例如 landing page、dashboard、deck、mobile app。

## 7.5 Project Metadata

作用：

- 当前 artifact 类型
- fidelity
- speaker notes
- animations
- inspiration ids
- mode

---

## 8. 业务流程

## 8.1 首次启动流程

```txt
用户启动 Open Design
  -> daemon 启动
  -> 扫描 PATH 中的 agent CLI
  -> 读取 agent auth 状态
  -> 加载 skills
  -> 加载 design systems
  -> Web App 展示默认 skill 和默认 design system
```

如果没有 agent CLI：

```txt
提示用户进入 API mode
  -> 粘贴 Anthropic / OpenAI-compatible / Gemini API key
  -> 走 API fallback
```

## 8.2 生成 Prototype 流程

```txt
用户输入 prompt
  -> Web 发送 session.generate 到 daemon
  -> daemon 选择 active skill
  -> daemon 加载 active DESIGN.md
  -> daemon 创建 artifact directory
  -> daemon 调用 agent adapter
  -> adapter spawn coding agent CLI
  -> agent 读取 skill + design system + prompt
  -> agent 写 index.html / JSX / assets
  -> adapter stream events
  -> Web 展示 tool feed 和 artifact tree
  -> preview iframe 渲染 artifact
  -> daemon 写 history
```

## 8.3 局部修改流程

```txt
用户在 preview 中点击元素
  -> Web 获取 element_id
  -> 用户输入修改意见
  -> Web 调用 session.refine
  -> daemon 重新调用 agent
  -> 如果 agent 支持 surgical edit，则局部编辑
  -> 如果不支持，则带约束重写文件
  -> preview 更新
```

## 8.4 Design System 生成流程

```txt
用户上传 screenshot / PDF / URL / brief
  -> 选择 design-system skill
  -> agent 生成 DESIGN.md
  -> 同时生成 preview.html 或 tokens.json
  -> 用户预览和修改
  -> 设置为 active design system
  -> 后续 prototype/deck/template 都读取该 DESIGN.md
```

## 8.5 Template 流程

```txt
用户选择 template
  -> 填写结构化内容
  -> agent 只填充内容
  -> 保持模板布局和设计决策
  -> 生成更快、更稳定
```

## 8.6 Deck 流程

```txt
用户输入主题和 slide count
  -> 选择 deck skill
  -> agent 生成 HTML deck
  -> 可选生成 slides.json
  -> preview 中浏览演示
  -> 导出 PDF / PPTX
```

---

## 9. 后端 API 设计

官方架构文档中列出的代表性 API：

```txt
GET  /api/health
GET  /api/agents
GET  /api/skills
GET  /api/design-systems
GET  /api/projects
POST /api/projects
POST /api/import/folder
GET  /api/projects/:id/files
POST /api/projects/:id/upload
POST /api/chat              -> text/event-stream
POST /api/artifacts/save
```

API 特点：

- 使用 REST + SSE。
- `/api/chat` 用 `text/event-stream` 返回 agent 流式输出。
- dev 模式下 Next.js rewrite `/api/*` 到 daemon。
- production daemon 可以直接 serve 静态 Next.js export。

## 9.1 Folder Import

Open Design 支持把一个本地文件夹作为项目根目录。

这意味着：

- 用户可以把设计项目放进已有 repo。
- agent 的 cwd 被限制在该目录。
- 用户可以自己用 Git 管理。
- 类似 Cursor / Claude Code / Aider 的工作方式。

安全策略：

- `realpath()` canonicalize
- path bounds check
- 拒绝导入 daemon 自己的数据目录
- 隐藏 `node_modules`、`.git`、`.next`、`dist` 等不应展示的目录

---

## 10. 安全与权限模型

Open Design 的安全边界主要来自三层。

## 10.1 Daemon 本地化

daemon 保留在用户本地。

好处：

- API key 不必上传到云端。
- 文件写入发生在本机。
- agent CLI 认证状态由用户本机管理。

## 10.2 Workspace 限制

daemon 调用 agent 时设置 cwd 为 artifact directory 或项目目录。

对于 Codex / Cursor 等按 workspace 工作的 agent：

> Open Design 通过限制 cwd 或 workspace 来降低写出范围。

## 10.3 Preview 沙箱

Preview 使用 iframe sandbox。

关键点：

- `allow-scripts`
- 不允许 `allow-same-origin`
- artifact 无法访问 host app cookie 和 parent DOM

## 10.4 API fallback 工具白名单

API fallback 模式下，Open Design 自己实现工具：

- Read
- Write
- Edit

这些工具被限制在 artifact cwd。

---

## 11. Open Design 对我们项目的启发

结合我们自己的产品方向：产品 UI 生成、产品原型、小红书图文、图片模型生成、coding agent handoff，可以借鉴以下部分。

## 11.1 借鉴：Web + Local Daemon

我们的产品也适合采用：

```txt
Next.js App
  -> Local Daemon / Local API
  -> LLM Provider
  -> Image Provider
  -> Coding Agent Handoff Export
```

理由：

- 前端体验好。
- 本地优先。
- API key 可留在本地。
- 可以连接 ComfyUI。
- 可以导出完整 handoff 包。

## 11.2 借鉴：Skill 文件化

我们可以设计自己的 skill：

- `product-ui-skill`
- `prototype-flow-skill`
- `xhs-cover-skill`
- `xhs-carousel-skill`
- `handoff-skill`
- `image-reference-redesign-skill`

每个 skill 使用：

```txt
SKILL.md
assets/
references/
examples/
```

## 11.3 借鉴：Design System 文件化

我们可以采用类似 `DESIGN.md`：

```txt
PRODUCT_DESIGN.md
BRAND_SYSTEM.md
VISUAL_DIRECTION.md
```

但因为我们要生成图片模型 prompt，还需要增加：

- image prompt guide
- image negative prompt
- asset usage rules
- coding agent implementation notes

## 11.4 借鉴：Adapter 思路

Open Design 适配 coding agent CLI。

我们可以适配两类 Provider：

1. LLM Provider
   - GPT
   - Claude
   - Gemini
   - DeepSeek
   - Qwen

2. Image Provider
   - nano banana
   - OpenAI Image
   - Flux
   - ComfyUI
   - Replicate
   - fal.ai

同时支持 Handoff Target：

- Cursor
- Claude Code
- Codex

## 11.5 借鉴：Artifact 文件系统

我们自己的 handoff 包可以采用类似：

```txt
.vad/
  projects/<id>/
    project.json
    prototype-flow.json
    design-tokens.json
    canvas/
    screenshots/
    ai-reference/
    assets/
    prompts/
    handoff/
      cursor-prompt.md
      claude-code-prompt.md
      codex-prompt.md
```

## 11.6 不直接照搬的地方

Open Design 输出主要是 HTML / JSX artifact。

我们的产品应该不同：

- 更强调图片模型生成的 UI 视觉图。
- 更强调可编辑画布。
- 更强调小红书图文。
- 更强调把视觉参考图、图片资产、prompt、设计 token 一起给 coding agent。
- 不应该只让 agent 写 HTML 作为设计结果。

---

## 12. 对我们产品的推荐架构参考

基于 Open Design 的启发，我们的推荐架构可以是：

```txt
Next.js App
  ├─ Product Brief Composer
  ├─ Prototype Flow Builder
  ├─ Canvas Editor
  ├─ Image Generation Workspace
  ├─ XHS Content Designer
  ├─ Handoff Exporter
  └─ Settings

Local API / Daemon
  ├─ Project Store
  ├─ LLM Provider Gateway
  ├─ Image Provider Gateway
  ├─ Agent Workflow Runtime
  ├─ Asset Store
  ├─ Export Pipeline
  └─ Coding Agent Handoff Builder

Providers
  ├─ LLM: OpenAI / Claude / Gemini / DeepSeek / Qwen
  ├─ Image: nano banana / OpenAI Image / Flux / ComfyUI
  └─ Handoff Target: Cursor / Claude Code / Codex
```

核心区别：

| 模块 | Open Design | 我们的产品 |
|---|---|---|
| 主要输出 | HTML / JSX / Deck / DESIGN.md | UI 图片、可编辑画布、产品原型、小红书图文、handoff 包 |
| Agent 策略 | 调用本机 coding agent CLI | 自己编排 LLM + Image Provider，再辅助 coding agent |
| 设计系统 | DESIGN.md | DESIGN.md + Image Prompt Guide + Handoff Spec |
| 画布 | iframe preview | Konva / Canvas 可编辑画布 |
| 图片模型 | 有 image/video prompt gallery | 核心能力之一 |
| coding agent 关系 | coding agent 是生成引擎 | coding agent 是开发落地目标 |

---

## 13. 资料来源

- Open Design GitHub README：https://github.com/nexu-io/open-design
- Open Design Architecture：https://github.com/nexu-io/open-design/blob/main/docs/architecture.md
- Open Design Product Spec：https://github.com/nexu-io/open-design/blob/main/docs/spec.md
- Open Design Modes：https://github.com/nexu-io/open-design/blob/main/docs/modes.md
- Open Design Agent Adapters：https://github.com/nexu-io/open-design/blob/main/docs/agent-adapters.md
- Open Design Skills Protocol：https://github.com/nexu-io/open-design/blob/main/docs/skills-protocol.md
- Open Design Quickstart：https://github.com/nexu-io/open-design/blob/main/QUICKSTART.md
- Open Design 官网：https://opendesigner.io/
- Open Design 介绍页：https://opendesign.lol/

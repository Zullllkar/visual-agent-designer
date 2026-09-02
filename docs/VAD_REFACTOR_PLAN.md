# Vibeboard 架构重构完整方案

> **版本**：v3.0 | **日期**：2026-07-12 | **状态**：待实施

---

## 目录

- [1. 背景与动机](#1-背景与动机)
- [2. 架构决策](#2-架构决策)
- [3. 目标架构总览](#3-目标架构总览)
- [4. Handoff 交付系统](#4-handoff-交付系统)
- [5. 详细设计](#5-详细设计)
- [6. 技术栈对比与选型](#6-技术栈对比与选型)
- [7. 文件变更清单](#7-文件变更清单)
- [8. 实施计划](#8-实施计划)
- [9. 风险与验收](#9-风险与验收)

---

## 1. 背景与动机

### 1.1 Vibeboard 现状

Vibeboard是本地优先的 AI 视觉设计工具，将用户的一句话想法转化为高保真视觉素材，并打包交付给 Cursor / Claude Code / Codex 等 AI coding 工具。

**当前架构**：固定流水线 + 一次性工具规划 + SSE 通信

```
用户消息 → planOrchestratorTools() 一次性规划 → switch-case 顺序执行 → SSE 返回
```

核心流水线：`BriefAgent → DesignDirectorAgent → ImagePlannerAgent → ImageExecutorAgent → HandoffAgent`

### 1.2 核心问题

| 问题 | 严重程度 |
|------|---------|
| 固定流水线，LLM 无法根据中间结果调整计划 | 高 |
| switch-case 工具分发，不可扩展 | 高 |
| SSE 单向通信，无法中途取消/断线重连 | 高 |
| 无会话记忆，Agent 不记得上次决策 | 中 |
| 无 Agent 运行生命周期管理 | 中 |
| 6 个废弃 Agent 代码堆积 | 低 |

### 1.3 市场标杆

| 产品 | Agent 架构 | 编排 | 通信 | 状态 |
|------|-----------|------|------|------|
| Cursor | 单 Agent | LLM 自主 | SSE | 内存 |
| Devin | 单 Agent + deepagents | LLM 自主 | WebSocket | LangGraph |
| Claude Code | 单 Agent | LLM 自主 | stdout | 内存 |
| Loomic | 单 Agent + deepagents | LLM 自主 | WebSocket | LangGraph + Supabase |
| **Vibeboard 现状** | 固定流水线 | 硬编码 | SSE | 无 |

**所有优秀 Agent 项目都是「LLM 自主编排工具调用」，没有一个是固定流水线。**

---

## 2. 架构决策

### 2.1 引入 LangGraph

| 能力 | 自己写 | LangGraph 内置 |
|------|--------|---------------|
| Agent 循环 | ~200 行 | `createReactAgent()` |
| 状态 + checkpoint | ~150 行 | `SqliteSaver` |
| 流式事件 | ~100 行 | `.streamEvents()` |
| 工具注册 + function calling | ~80 行 | `tool()` 装饰器 |
| Sub-Agent | ~120 行 | 嵌套 ReAct |
| 会话恢复 | ~100 行 | checkpointer 自动 |
| **总计** | **~830 行** | **~50 行** |

Vibeboard 用 `SqliteSaver`，数据存本地 `.vad/checkpoints.db`，零外部依赖。

### 2.2 不用 deepagents

| deepagents 能力 | Vibeboard 需要 | 原因 |
|----------------|---------|------|
| 文件系统工具 | ❌ | Vibeboard 操作 Canvas JSON |
| 代码执行 | ❌ | Vibeboard 是设计工具 |
| TODO 管理 | ✅ | 可在 LangGraph 上自实现 |
| Sub-Agent | ✅ | 可在 LangGraph 上自实现 |

### 2.3 SSE → WebSocket

| 能力 | SSE | WebSocket |
|------|-----|-----------|
| 中途取消 | ❌ | ✅ |
| 断线重连+回放 | ❌ | ✅ |
| 多标签同步 | ❌ | ✅ |
| Agent 后台运行 | ❌ | ✅ |

通过 **Next.js custom server** 挂载 WebSocket，不拆 Monorepo，不引入 Fastify。

### 2.4 最终定位

```
单 Agent + LangGraph ReAct + WebSocket + SqliteSaver + 自建工具注册表
```

与 Devin 同款模式，但用自建设计工具替代 deepagents 的 coding 工具，且独有启发式回退。

---

## 3. 目标架构总览

### 3.1 架构全景

```
┌───────────────────────────────────────────────────────┐
│  前端（React + Zustand + tldraw）                       │
│   画布 UI │ Chat Pane │ 首页 BriefLauncher │ 设置       │
│       └────────┬───────────────────┘                   │
│          WebSocket Client                              │
└──────────────────┬────────────────────────────────────┘
                   │ WebSocket（双向）
┌──────────────────┼────────────────────────────────────┐
│  Next.js Custom Server                                │
│   ┌──────────────┐                                    │
│   │ WS Handler   │ 连接管理、命令分发、心跳             │
│   └──────┬───────┘                                    │
│   ┌──────┴───────────┐                                │
│   │ AgentRunService  │ 生命周期：create/running/       │
│   │                  │ completed/failed/cancelled     │
│   └──────┬───────────┘                                │
│   ┌──────┴───────────┐                                │
│   │ LangGraph Agent  │ createReactAgent()             │
│   │                  │ LLM 自主调用工具                 │
│   │                  │ .streamEvents() 流式输出        │
│   │                  │ SqliteSaver checkpoint          │
│   └──────┬───────────┘                                │
│   ┌──────┴───────────┐                                │
│   │ Tool Registry    │ 统一注册 + dispatch             │
│   │                  │ execute() + fallback()         │
│   └──────┬───────────┘                                │
│    ┌─────┼─────┬─────┬─────┐                          │
│    ▼     ▼     ▼     ▼     ▼                          │
│  Brief  Dir  Images  Handoff Canvas  ...更多工具       │
│    │     │     │      │      │                        │
│    ▼     ▼     ▼      ▼      ▼                        │
│   LangChain ChatModel + Image Provider + 本地存储      │
└───────────────────────────────────────────────────────┘
```

### 3.2 两条工作路径

**Chat 模式（新架构）**：用户对话 → WebSocket → LangGraph Agent 自主循环 → 流式返回

**一键生成模式（保留）**：首页输入想法 → `runDesignPipeline()` 固定流水线 → SSE 返回

### 3.3 Agent 循环

```
LLM 分析状态 → 决定调用工具 X
  → streamEvents 产出 message.delta
  → ToolRegistry.execute("X")
  → streamEvents 产出 tool.started / tool.completed
  → 结果回传 LLM → 决定下一步
  → 循环直到 LLM 说"完成"
最大 10 次迭代，每步有启发式回退
```

### 3.4 四层回退策略

```
Layer 1: LLM 正常 → LangGraph ReAct Agent 自主调用工具
  ▼ LLM 超时 / 非法输出
Layer 2: 工具级回退 → tool.fallback() 启发式执行
  ▼ 工具 execute() 抛错
Layer 3: Agent 级回退 → decideToolsFallback() 规则引擎规划
  ▼ LLM 完全不可用
Layer 4: 流水线模式 → runDesignPipeline() 固定步骤
```

---

## 4. Handoff 交付系统

### 4.1 交付理念

Vibeboard 的核心价值不仅是生成视觉素材，更在于**将设计成果结构化交付给 AI coding 工具**。这不是简单的「导出图片」，而是一套完整的**设计上下文打包机制**，让 Cursor / Claude Code / Codex 拿到包后能准确还原设计意图。

**核心理念**：

```
Vibeboard 生成的不是「网页结构 JSON 让 coding agent 1:1 还原」
Vibeboard 交付的是「视觉参考图 + 设计上下文 + 产品规范」
让 coding agent 理解设计意图后自主实现
```

### 4.2 交付物清单

Vibeboard 的 Handoff 包是一个 ZIP 文件，包含以下完整内容：

```
project-handoff.zip
├── README.md                        # 项目概览 + 目录说明 + 使用方式
├── SPEC.md                          # 产品与实现规范（coding agent 必读）
├── .cursorrules                     # Cursor 专用规则文件（仅 cursor target）
├── CLAUDE.md                        # Claude Code 专用上下文（仅 claude-code target）
├── AGENTS.md                        # Codex 专用上下文（仅 codex target）
├── prompts/
│   └── {target}-kickoff.md          # 可直接粘贴的启动 prompt
├── design/
│   ├── project.json                 # 完整 ProjectFile 数据（全量）
│   ├── brief.json                   # 产品 Brief（名称、定位、用户、功能、风格）
│   ├── design-direction.json        # 视觉方向（情绪关键词、排版、布局说明）
│   ├── design-context.json          # 项目级设计记忆（色板、组件原则、DO/DON'T）
│   ├── tokens.json                  # 设计 token（颜色、字号、圆角、风格关键词）
│   ├── model-runs.json              # 生图元数据（模型、seed、耗时、成本）
│   ├── assets/                      # ★ 核心交付物：高保真视觉素材
│   │   ├── MANIFEST.md              # 素材清单（每张图的尺寸、角色、prompt）
│   │   ├── {asset-id}.png           # 素材图片（base64 解码后的二进制）
│   │   ├── {asset-id}.jpg           # ...
│   │   └── {asset-id}.url.txt       # 远端 URL 的占位文件
│   └── references/                  # 用户上传的参考图
│       ├── {ref-id}.png
│       └── references.json          # 参考图元数据
```

### 4.3 每个交付物的详细说明

#### 4.3.1 `README.md` — 项目概览

**给谁看**：开发者（人）

**内容**：
- 项目标题 + 原始想法
- 产品信息（名称、定位、目标用户、平台、视觉风格、核心功能）
- 素材概览（前 12 张文件名 + 尺寸 + 角色）
- 目录结构说明
- 推荐使用方式（4 步引导）

**示例**：

```markdown
# 智能助手

> 为个人用户提供高效信息处理的智能工具

**生成自 Vibeboard**。本目录是给 coding agent 的视觉素材交付包。

## 项目信息

- 产品名: 智能助手
- 定位: 为个人用户提供高效信息处理的智能工具
- 目标用户: 个人用户
- 平台: web
- 视觉风格: Clean, minimal, dark mode with purple accents
- 核心功能: 智能问答 / 任务提醒 / 知识整理

## 素材概览（6 张）

- `abc123.png` · 1024×1024 · hero
- `def456.png` · 800×600 · illustration
- ...

## 推荐使用方式

1. 在 Cursor / Claude Code / Codex 里打开本目录
2. 阅读 `SPEC.md` 与 `design/assets/MANIFEST.md`
3. 把 `design/assets/*` 图片当作 UI 参考 / 插图资源
4. 按 `prompts/<agent>-kickoff.md` 启动开发
```

#### 4.3.2 `SPEC.md` — 产品与实现规范

**给谁看**：AI coding agent（Cursor / Claude Code / Codex 的 LLM 上下文）

**内容**：
1. **产品概述**：原始想法、定位、目标用户、平台、视觉风格
2. **核心功能**：功能列表
3. **关键场景**：用户使用场景
4. **视觉方向**：情绪关键词、排版说明、布局说明
5. **设计记忆**：色板（颜色名 + 色值 + 用途）、执行准则（DO list）、避免事项（DON'T list）
6. **视觉素材清单**：每张图的文件名、尺寸、角色、prompt 摘要
7. **实现要求**：
   - 以 `design/assets/*` 为视觉参考，不另起风格
   - 颜色/字号/间距引用 `design/tokens.json`
   - 文案以 `design/brief.json` 为准
   - **不是网页结构 JSON 1:1 还原**，是视觉参考 + 产品上下文
   - 按平台选择技术栈

#### 4.3.3 `.cursorrules` / `CLAUDE.md` / `AGENTS.md` — Agent 专用规则

**给谁看**：各 coding agent 的自动读取机制

**机制**：
- **Cursor**：自动读取项目根目录 `.cursorrules` 文件作为系统上下文
- **Claude Code**：自动读取 `CLAUDE.md` 文件
- **Codex**：自动读取 `AGENTS.md` 文件

**内容**（以 `.cursorrules` 为例）：
```
# 智能助手 - Cursor Rules

你正在为这个产品写代码。请遵循以下原则：

- 始终先读取 `SPEC.md` 与 `design/assets/MANIFEST.md`
- 打开 `design/assets/*` 图片作为 UI / 插图视觉参考
- 先读取 `design/design-context.json`，保持设计记忆中的品牌语气、色板和组件原则
- 颜色 / 字号 / 间距引用 `design/tokens.json`
- 视觉风格: Clean, minimal, dark mode with purple accents
- 平台: web
- 本包是视觉素材交付，不是 Canvas JSON 结构稿；按参考图气质实现，勿臆造另一套风格
```

#### 4.3.4 `prompts/{target}-kickoff.md` — 启动 Prompt

**给谁看**：用户复制粘贴到 coding agent 对话框

**内容**：
```markdown
# Cursor 启动 Prompt

复制下面的内容粘贴到对话框：

---

请为我实现 **智能助手**。

**产品定位**: 为个人用户提供高效信息处理的智能工具
**平台**: web
**视觉风格**: Clean, minimal, dark mode with purple accents

请严格按照以下文件中的设计实现：

- `SPEC.md`
- `design/design-context.json`（项目级设计记忆）
- `design/assets/MANIFEST.md`
- `design/assets/abc123.png`
- `design/assets/def456.png`
- ...

**实现要求**：

1. 以 `design/assets/*` 图片为视觉参考（气质、配色、插图），不要另起一套风格
2. 品牌语气、色板、排版和组件原则遵循 `design/design-context.json`
3. 颜色 / 字号 / 圆角引用 `design/tokens.json`
4. 先实现主界面，跑通后再做其他模块
5. 本包是视觉素材交付，不是网页结构 JSON 1:1 还原

完整规范见 `SPEC.md`。
```

#### 4.3.5 `design/project.json` — 完整项目数据

**给谁看**：需要全量数据的工具或脚本

**内容**：完整的 `ProjectFile` JSON，包含 brief、designDirection、pages、assets、references 等所有字段。这是 Vibeboard 内部的完整数据结构。

#### 4.3.6 `design/brief.json` — 产品 Brief

**给谁看**：coding agent 需要产品上下文时

**内容**：
```json
{
  "productName": "智能助手",
  "positioning": "为个人用户提供高效信息处理的智能工具",
  "targetUser": "个人用户",
  "platform": "web",
  "visualStyle": "Clean, minimal, dark mode with purple accents",
  "coreFeatures": ["智能问答", "任务提醒", "知识整理"],
  "scenarios": ["日常信息查询", "任务管理", "学习辅助"],
  "outputTargets": ["cursor"]
}
```

#### 4.3.7 `design/design-direction.json` — 视觉方向

**给谁看**：coding agent 需要视觉风格指导时

**内容**：
```json
{
  "summary": "暗色主题，紫色强调色，简洁现代风格",
  "moodKeywords": ["clean", "minimal", "dark", "purple", "modern"],
  "typographyNotes": "无衬线字体，标题粗体，正文常规",
  "layoutNotes": "居中布局，大量留白，卡片式布局"
}
```

#### 4.3.8 `design/design-context.json` — 项目级设计记忆

**给谁看**：coding agent 必须遵守的设计约束

**这是 Vibeboard 独有的核心交付物**。它不是简单的颜色列表，而是从 Brief + DesignDirection 合成的**设计决策上下文**，包含：

```json
{
  "colorTokens": [
    { "name": "primary", "value": "#7C3AED", "usage": "主按钮、链接、强调" },
    { "name": "background", "value": "#0F0F0F", "usage": "页面背景" },
    { "name": "surface", "value": "#1A1A1A", "usage": "卡片背景" },
    { "name": "text-primary", "value": "#FFFFFF", "usage": "主文本" },
    { "name": "text-secondary", "value": "#A0A0A0", "usage": "次要文本" }
  ],
  "doList": [
    "使用紫色作为主要强调色",
    "保持大量留白",
    "卡片使用圆角 12px",
    "标题使用粗体无衬线字体"
  ],
  "avoidList": [
    "不要使用亮色背景",
    "不要使用衬线字体",
    "不要过度装饰",
    "不要使用渐变背景"
  ]
}
```

#### 4.3.9 `design/tokens.json` — 设计 Token

**给谁看**：coding agent 实现时引用具体数值

**内容**：
```json
{
  "color": ["#7C3AED", "#0F0F0F", "#1A1A1A", "#FFFFFF", "#A0A0A0"],
  "fontSize": [12, 14, 16, 24, 32, 48, 96],
  "radius": [8, 12, 16],
  "moodKeywords": ["clean", "minimal", "dark", "purple", "modern"],
  "visualStyle": "Clean, minimal, dark mode with purple accents"
}
```

#### 4.3.10 `design/assets/` — 核心视觉素材

**给谁看**：coding agent 作为 UI 实现的视觉参考

**这是 Handoff 包最重要的交付物**。每张图片是 Vibeboard 通过 AI 图像生成模型产出的高保真素材。

**包含**：
- PNG/JPG/WebP 二进制文件（从 base64 data URL 解码）
- 远端 URL 的 `.url.txt` 占位文件
- `MANIFEST.md` — 人类可读的素材清单

**MANIFEST.md 示例**：
```markdown
# 视觉素材清单

共 6 张可交付素材。

## 1. `abc123.png`

- 尺寸: 1024 × 1024
- 状态: candidate
- 角色: hero
- 模型: dall-e-3
- Prompt:

```
Clean, minimal, dark mode UI design, purple accent color,
hero illustration for AI assistant app, modern flat design...
```

## 2. `def456.png`

- 尺寸: 800 × 600
- 角色: illustration
- Prompt:

```
Clean, minimal dashboard interface, dark theme with purple
accents, card-based layout, data visualization...
```
```

#### 4.3.11 `design/model-runs.json` — 生图元数据

**给谁看**：需要追溯生成过程的场景

**内容**：每张图的完整生成记录
```json
{
  "count": 6,
  "runs": [
    {
      "kind": "asset",
      "id": "abc123",
      "file": "design/assets/abc123.png",
      "prompt": "Clean, minimal, dark mode...",
      "model": "dall-e-3",
      "seed": 12345,
      "width": 1024,
      "height": 1024,
      "durationMs": 8500,
      "costUsd": 0.04,
      "status": "candidate",
      "role": "hero"
    }
  ]
}
```

#### 4.3.12 `design/references/` — 用户参考图

**给谁看**：coding agent 理解用户的设计意图

如果用户在 Vibeboard 中上传了参考图（竞品截图、灵感图等），这些图也会打包交付。

### 4.4 交付流程

```
用户在 Vibeboard 中点击「导出」或 Chat 中说「导出给 Cursor」
  │
  ▼
export_handoff 工具触发
  │
  ▼
HandoffAgent.run({ project, target: "cursor" })
  │
  ▼
createHandoffTarget("cursor").build({ project })
  │
  ├─ 生成 README.md
  ├─ 生成 SPEC.md
  ├─ 生成 .cursorrules（如果 target=cursor）
  ├─ 生成 CLAUDE.md（如果 target=claude-code）
  ├─ 生成 AGENTS.md（如果 target=codex）
  ├─ 生成 prompts/cursor-kickoff.md
  ├─ 生成 design/project.json
  ├─ 生成 design/brief.json
  ├─ 生成 design/design-direction.json
  ├─ 生成 design/design-context.json
  ├─ 生成 design/tokens.json
  ├─ 生成 design/assets/MANIFEST.md
  ├─ 解码每张素材的 base64 → design/assets/{id}.png
  ├─ 生成 design/model-runs.json
  └─ 复制用户参考图 → design/references/
  │
  ▼
zipHandoffArtifact(artifact) → ZIP Blob
  │
  ▼
浏览器下载 {slug}.cursor.handoff.zip
  │
  ▼
用户解压到项目目录
  │
  ▼
在 Cursor 中打开该目录
  ├─ Cursor 自动读取 .cursorrules
  ├─ 用户粘贴 prompts/cursor-kickoff.md 内容
  └─ Cursor 开始按视觉素材 + 设计上下文实现 UI
```

### 4.5 四种 Target 的差异

| Target | 专用文件 | 自动读取机制 | 适用工具 |
|--------|---------|-------------|---------|
| `cursor` | `.cursorrules` | Cursor 自动读取项目根目录 | Cursor |
| `claude-code` | `CLAUDE.md` | Claude Code 自动读取 | Claude Code CLI |
| `codex` | `AGENTS.md` | Codex 自动读取 | OpenAI Codex |
| `markdown` | 无专用文件 | 通用 | 任意 AI 编码助手 |

其余文件（README.md、SPEC.md、design/*）在所有 target 中完全相同。

### 4.6 单张素材交付

除了整包导出，Vibeboard 还支持**单张素材的 Prompt 交付**——用户在画布上选中一张图，点击「复制 Prompt」，获得：

```markdown
请实现 **智能助手** 中的以下视觉素材。

**产品定位**: 为个人用户提供高效信息处理的智能工具
**视觉风格**: Clean, minimal, dark mode with purple accents

**素材 ID**: `abc123`
**尺寸**: 1024×1024
**角色**: hero

**生成 Prompt**:
Clean, minimal, dark mode UI design, purple accent color,
hero illustration for AI assistant app, modern flat design...

请以该图为视觉参考实现对应 UI，不要另起一套风格。
完整项目规范见交付包中的 `SPEC.md` 与 `design/assets/MANIFEST.md`。
```

### 4.7 Handoff 在新架构中的位置

在 LangGraph Agent 架构中，Handoff 仍然是作为一个**工具**存在：

```typescript
// src/lib/agents/tools/export-handoff.ts
export const exportHandoffTool: AgentTool = {
  name: "export_handoff",
  description: "编译视觉素材交付包（assets + prompts + Brief/tokens）给 coding 工具",
  parameters: {
    type: "object",
    properties: {
      target: { type: "string", enum: ["cursor", "claude-code", "codex", "markdown"] },
    },
  },
  async execute(args, ctx) {
    const target = (args.target as HandoffTarget["name"]) ?? "markdown";
    const result = await HandoffAgent.run({ project: ctx.project, target }, ctx.agentCtx);
    return {
      summary: `已编译 ${target} 交付包：${result.fileCount} 个文件`,
      output: { target, fileCount: result.fileCount, paths: result.paths },
    };
  },
};
```

Agent 在对话中自主决定何时调用 `export_handoff`——用户说「导出给 Cursor」时，LLM 会自动选择调用此工具并传入 `target: "cursor"`。

### 4.8 Handoff 系统的改进方向

当前 Handoff 系统已完善，但有以下可改进点：

| 改进 | 优先级 | 说明 |
|------|--------|------|
| 支持选择部分素材导出 | 中 | 用户可能只想导出选中的几张图 |
| 支持增量导出 | 低 | 只导出新增/变更的素材 |
| 截图导出 | 中 | 将 tldraw 画布渲染为 PNG 截图一并交付 |
| 组件清单 | 低 | 如果 Vibeboard 未来支持组件级设计，导出组件清单 |
| 多语言 SPEC | 低 | 根据 Brief 的 locale 输出中/英文 SPEC |

---

## 5. 详细设计

### 5.1 工具注册表系统

替换 `chat-orchestrator.ts` 中 390 行 switch-case，建立可扩展的工具注册机制。

**工具接口**：

```typescript
// src/lib/agents/tools/types.ts

export interface ToolContext {
  project: ProjectFile | null;
  userMessage: string;
  agentCtx: AgentContext;
  providerConfig?: ProviderConfig;
  onProjectUpdate?: (project: ProjectFile) => void;
  onAssetReady?: (asset: { id: string; src: string }) => void;
  abortSignal?: AbortSignal;
}

export interface ToolResult {
  summary: string;                          // 给用户看的简明摘要
  updatedProject?: ProjectFile | null;      // 更新后的项目
  output?: Record<string, unknown>;         // 给 LLM 看的结构化输出
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;      // JSON Schema
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
  fallback?(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}
```

**注册表核心**：

```typescript
// src/lib/agents/tools/registry.ts

class ToolRegistry {
  private tools = new Map<string, AgentTool>();
  register(tool: AgentTool) { this.tools.set(tool.name, tool); }
  get(name: string) { return this.tools.get(name); }
  list() { return [...this.tools.values()]; }
  toToolDefinitions(): LlmToolDefinition[] {
    return this.list().map(t => ({
      name: t.name, description: t.description, parameters: t.parameters
    }));
  }
  async execute(name, args, ctx): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    try { return await tool.execute(args, ctx); }
    catch (e) { if (tool.fallback) return tool.fallback(args, ctx); throw e; }
  }
}
export const toolRegistry = new ToolRegistry();
```

**工具实现示例**：

```typescript
// src/lib/agents/tools/generate-brief.ts
export const generateBriefTool: AgentTool = {
  name: "generate_brief",
  description: "从用户想法生成结构化 ProductBrief",
  parameters: { type: "object", properties: { idea: { type: "string" } }, required: ["idea"] },
  async execute(args, ctx) {
    const idea = (args.idea as string) || ctx.userMessage;
    const result = await BriefAgent.run({ idea }, ctx.agentCtx);
    return {
      summary: `已生成产品简报：${result.brief.productName}`,
      updatedProject: ctx.project ? { ...ctx.project, brief: result.brief } : null,
      output: { productName: result.brief.productName, positioning: result.brief.positioning },
    };
  },
  async fallback(args, ctx) { return this.execute(args, ctx); },
};
```

**统一注册入口**：

```typescript
// src/lib/agents/tools/index.ts
import { toolRegistry } from "./registry";
import { generateBriefTool } from "./generate-brief";
import { planDesignDirectionTool } from "./plan-design-direction";
import { generateImagesTool } from "./generate-images";
import { generateImageVariantsTool } from "./generate-image-variants";
import { restyleImagesTool } from "./restyle-images";
import { exportHandoffTool } from "./export-handoff";
import { answerQuestionTool } from "./answer-question";
import { inspectCanvasTool } from "./inspect-canvas";
import { manipulateCanvasTool } from "./manipulate-canvas";

export function registerAllTools(): void {
  toolRegistry.register(generateBriefTool);
  toolRegistry.register(planDesignDirectionTool);
  toolRegistry.register(generateImagesTool);
  toolRegistry.register(generateImageVariantsTool);
  toolRegistry.register(restyleImagesTool);
  toolRegistry.register(exportHandoffTool);
  toolRegistry.register(answerQuestionTool);
  toolRegistry.register(inspectCanvasTool);
  toolRegistry.register(manipulateCanvasTool);
}
```

### 5.2 LangGraph ReAct Agent

```typescript
// src/lib/agents/langgraph-agent.ts

import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { tool } from "@langchain/core/tools";

export function createVadAgent(options: CreateAgentOptions) {
  const llm = createChatModel(options.providerConfig);

  const tools = toolRegistry.list().map(agentTool =>
    tool(async (args: Record<string, unknown>) => {
      const result = await toolRegistry.execute(agentTool.name, args, ctx);
      return JSON.stringify(result.output ?? result.summary);
    }, {
      name: agentTool.name,
      description: agentTool.description,
      schema: agentTool.parameters,
    })
  );

  return createReactAgent({
    llm, tools,
    prompt: buildSystemPrompt(options.project, options.agentCtx),
    checkpointer: options.checkpointer,
  });
}

/** 从 Vibeboard ProviderConfig 创建 LangChain ChatModel */
function createChatModel(config: ProviderConfig) {
  if (!config.llm || config.llm.kind === "mock") {
    throw new Error("Real LLM provider required");
  }
  if (config.llm.kind === "openai-compatible" || config.llm.kind === "deepseek") {
    const baseURL = config.llm.kind === "deepseek"
      ? "https://api.deepseek.com/v1"
      : config.llm.baseURL;
    return new ChatOpenAI({ apiKey: config.llm.apiKey, baseURL, modelName: config.llm.model, streaming: true });
  }
  if (config.llm.kind === "anthropic") {
    return new ChatAnthropic({ apiKey: config.llm.apiKey, modelName: config.llm.model });
  }
  if (config.llm.kind === "gemini") {
    return new ChatGoogleGenerativeAI({ apiKey: config.llm.apiKey, modelName: config.llm.model });
  }
  throw new Error(`Unsupported LLM provider: ${config.llm.kind}`);
}
```

### 5.3 AgentRunService

```typescript
// src/lib/agents/agent-run-service.ts

export type RunStatus = "accepted" | "running" | "completed" | "failed" | "cancelled";

export interface AgentRun {
  runId: string;
  threadId: string;
  status: RunStatus;
  startedAt: number;
  endedAt?: number;
  error?: string;
}

class AgentRunService {
  private runs = new Map<string, AgentRun>();
  private abortControllers = new Map<string, AbortController>();

  createRun(input: CreateRunInput): AgentRun {
    const runId = nanoid(12);
    const run: AgentRun = { runId, threadId: input.threadId, status: "accepted", startedAt: Date.now() };
    this.runs.set(runId, run);
    return run;
  }

  async *streamRun(runId: string, input: CreateRunInput): AsyncGenerator<WsEvent> {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    const abortController = new AbortController();
    this.abortControllers.set(runId, abortController);
    run.status = "running";

    try {
      const agent = createVadAgent({ ... });
      const stream = agent.streamEvents(
        { messages: [{ role: "user", content: input.prompt }] },
        { version: "v2", configurable: { thread_id: input.threadId }, signal: abortController.signal }
      );
      for await (const event of adaptStreamEvents(stream, runId)) yield event;
      run.status = "completed";
      run.endedAt = Date.now();
    } catch (e) {
      run.status = abortController.signal.aborted ? "cancelled" : "failed";
      run.error = (e as Error).message;
      run.endedAt = Date.now();
      yield { type: "run.failed", data: { runId, error: run.error } };
    } finally {
      this.abortControllers.delete(runId);
    }
  }

  cancel(runId: string) { this.abortControllers.get(runId)?.abort(); }
  getRun(runId: string) { return this.runs.get(runId); }
}
export const agentRuns = new AgentRunService();
```

### 5.4 WebSocket 通信层

**消息 Schema**：

```typescript
// src/lib/ws/types.ts
export const WsCommandSchema = z.object({
  action: z.enum(["agent.run", "agent.cancel", "canvas.subscribe"]),
  prompt: z.string().optional(),
  projectId: z.string().optional(),
  threadId: z.string().optional(),
  runId: z.string().optional(),
});

export const WsEventSchema = z.object({
  type: z.enum(["command.ack", "message.delta", "tool.started", "tool.completed",
    "canvas.sync", "project.update", "handoff.download", "run.completed",
    "run.failed", "run.cancelled", "error"]),
  data: z.unknown(),
});
```

**Next.js Custom Server**：

```typescript
// server.ts（新增，替代 next dev）
import { createServer } from "node:http";
import next from "next";
import { attachWebSocketHandler } from "./src/lib/ws/server";

const app = next({ dev: process.env.NODE_ENV !== "production" });
const handler = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer(handler);
  attachWebSocketHandler(server);
  server.listen(3000, () => console.log("> Ready on http://localhost:3000"));
});
```

**Handler 核心**：

```typescript
// src/lib/ws/handler.ts
export function attachWebSocketHandler(server: Server) {
  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (ws) => {
    ws.on("message", async (raw) => {
      const cmd = WsCommandSchema.parse(JSON.parse(raw.toString()));
      switch (cmd.action) {
        case "agent.run":
          const run = agentRuns.createRun({ ... });
          connectionManager.subscribeToCanvas(ws, cmd.projectId);
          ws.send(JSON.stringify({ type: "command.ack", data: { runId: run.runId } }));
          for await (const event of agentRuns.streamRun(run.runId, { ... })) {
            connectionManager.pushToCanvas(cmd.projectId, event);
            eventBuffer.push(cmd.threadId, event);
          }
          break;
        case "agent.cancel":
          agentRuns.cancel(cmd.runId);
          break;
        case "canvas.subscribe":
          connectionManager.subscribeToCanvas(ws, cmd.projectId);
          for (const event of eventBuffer.getRecent(cmd.threadId)) ws.send(JSON.stringify(event));
          break;
      }
    });
  });
  setInterval(() => wss.clients.forEach(ws => ws.readyState === WebSocket.OPEN && ws.ping()), 30000);
}
```

**事件缓存（断线重连）**：

```typescript
// src/lib/ws/event-buffer.ts
class EventBuffer {
  private buffers = new Map<string, WsEvent[]>();
  private maxBufferSize = 100;
  push(threadId: string, event: WsEvent) {
    const buf = this.buffers.get(threadId) ?? [];
    buf.push(event);
    if (buf.length > this.maxBufferSize) buf.shift();
    this.buffers.set(threadId, buf);
  }
  getRecent(threadId: string): WsEvent[] { return this.buffers.get(threadId) ?? []; }
}
export const eventBuffer = new EventBuffer();
```

### 5.5 会话记忆

```typescript
// src/lib/agents/checkpointer.ts
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";

export async function getCheckpointer(): Promise<SqliteSaver> {
  const dir = ensureDir("checkpoints");
  return await SqliteSaver.fromConnString(path.join(dir, "checkpoints.db"));
}
```

### 5.6 Sub-Agent

```typescript
// src/lib/agents/sub-agents/types.ts
export interface SubAgentDef {
  name: string;
  description: string;
  systemPrompt: string;
  allowedTools: string[];
}

export function createDelegateTaskTool(subAgents: Map<string, SubAgentDef>): AgentTool {
  return {
    name: "delegate_task",
    description: "将复杂子任务委派给专门的子 Agent",
    parameters: {
      type: "object",
      properties: { subAgent: { type: "string", enum: [...] }, instruction: { type: "string" } },
      required: ["subAgent", "instruction"],
    },
    async execute(args, ctx) { /* 创建子 Agent 循环 */ },
  };
}
```

### 5.7 事件流适配

```typescript
// src/lib/agents/stream-adapter.ts
export async function* adaptStreamEvents(stream, runId): AsyncGenerator<WsEvent> {
  for await (const event of stream) {
    if (event.event === "on_chat_model_stream")
      yield { type: "message.delta", data: { text: event.data?.chunk?.content, runId } };
    if (event.event === "on_tool_start")
      yield { type: "tool.started", data: { runId, toolName: event.data?.name, args: event.data?.input } };
    if (event.event === "on_tool_end")
      yield { type: "tool.completed", data: { runId, toolName: event.data?.name, output: event.data?.output } };
  }
}
```

### 5.8 系统提示词

```typescript
// src/lib/agents/system-prompt.ts
export function buildSystemPrompt(project, agentCtx): string {
  return [
    "你是 Vibeboard，专业的 AI 视觉设计助手。",
    "通过调用工具完成任务，每次只调一个工具，等结果再决定下一步。",
    "任务完成后明确告知用户，不要无限循环。用中文回复。",
    `## 当前项目状态\n${formatProjectState(project)}`,
    `## 可用工具\n${toolRegistry.list().map(t => `- ${t.name}: ${t.description}`).join("\n")}`,
    "## 工具使用规则",
    "- 空白项目：generate_brief → plan_design_direction → generate_images",
    "- 已有 Brief 但无方向：plan_design_direction → generate_images",
    "- 用户要求导出：export_handoff",
    "- 纯问答：answer_question",
    agentCtx.skill?.markdown ? `## 设计技能\n${agentCtx.skill.markdown}` : "",
  ].filter(Boolean).join("\n\n---\n\n");
}
```

---

## 6. 技术栈对比与选型

### 6.1 全栈对比总表

| 维度 | Vibeboard（现状） | Loomic | 决策 |
|------|------------|--------|------|
| 项目结构 | 单体 Next.js | Turborepo Monorepo | **保持单体** |
| 后端框架 | Next.js API Routes | Fastify 5（独立进程） | **Next.js custom server** |
| 画布 | tldraw 5.0 | Excalidraw 0.18 | **保留 tldraw** |
| 通信 | SSE | WebSocket | **改 WebSocket** |
| Agent 框架 | 自研流水线 | LangGraph + deepagents | **引入 LangGraph** |
| LLM 集成 | 自研 Provider | LangChain ChatModel | **切换 LangChain** |
| LLM Provider | 4 家（含 DeepSeek） | 3 家 | **LangChain + ChatOpenAI baseURL 兼容 DeepSeek** |
| 图像生成 | 3 个 Provider | 10+ Provider | **保留现有 + 新增 Replicate** |
| 视频生成 | 无 | Google Veo / Replicate | 暂不加入 |
| 数据库 | 本地文件 | Supabase PostgreSQL | **不引入 Supabase** |
| 状态持久化 | 无 | PostgresCheckpointer | **SqliteSaver** |
| 认证 | 无 | Supabase Auth | 不需要 |
| 异步队列 | 无 | PGMQ | 暂不需要 |
| Worker 进程 | 无 | 独立 Worker | 暂不需要 |
| 支付 | 无 | LemonSqueezy | 不需要 |
| Lint | ESLint 9 | Biome | **换 Biome** |
| 测试 | 无 | Vitest 3 | **加 Vitest** |
| 构建 | Next.js 内置 | Turborepo | 不需要 |
| 部署 | 本地 / Vercel | Web→Vercel, Server→Railway | 本地优先 |
| 包管理 | pnpm | pnpm workspace | 不变 |
| 图像处理 | @resvg/resvg-js | Sharp | 保留 |

### 6.2 应该换

| 项目 | 现状 | 换成 | 优先级 | 原因 |
|------|------|------|--------|------|
| Agent 框架 | 自研流水线 | LangGraph | 高 | 行业标准，省 800+ 行 |
| 通信协议 | SSE | WebSocket | 高 | 支持取消/重连/多标签 |
| LLM 集成 | 自研 Provider | LangChain ChatModel | 高 | 与 LangGraph 配套 |
| 状态持久化 | 无 | SqliteSaver | 高 | 会话记忆 |
| Lint | ESLint | Biome | 中 | 更快，零配置 |
| 测试 | 无 | Vitest | 中 | Agent 循环必须有测试 |
| 图像 Provider | 3 个 | 新增 Replicate | 中 | Flux/SDXL 等高质量模型 |

### 6.3 不应该换

| 项目 | 原因 |
|------|------|
| 单体 Next.js | 本地工具不需要 Monorepo |
| Next.js 后端 | custom server 挂 WebSocket 即可 |
| tldraw | 比 Excalidraw 更适合设计工具 |
| 本地文件存储 | 不需要 Supabase，用 SQLite 替代 |
| 认证 / 支付 / 异步队列 | 本地工具不需要 |
| Zustand / Lucide + Tailwind | 已经够好 |
| pnpm | 不变 |

### 6.4 可选增强（未来）

| 项目 | 时机 |
|------|------|
| 视频生成 | 当 Vibeboard 需要视频时 |
| Worker 进程 | 当加视频生成时 |
| Monorepo 拆分 | 当需要独立部署后端时 |

---

## 7. 文件变更清单

### 7.1 新增文件（34 个）

**工具注册表系统（12 个）**：

| # | 文件路径 | 说明 |
|---|---------|------|
| 1 | `src/lib/agents/tools/types.ts` | 工具接口（AgentTool, ToolContext, ToolResult） |
| 2 | `src/lib/agents/tools/registry.ts` | 工具注册表核心 |
| 3 | `src/lib/agents/tools/generate-brief.ts` | Brief 工具 |
| 4 | `src/lib/agents/tools/plan-design-direction.ts` | 视觉方向工具 |
| 5 | `src/lib/agents/tools/generate-images.ts` | 生图工具 |
| 6 | `src/lib/agents/tools/generate-image-variants.ts` | 变体工具 |
| 7 | `src/lib/agents/tools/restyle-images.ts` | 换风格工具 |
| 8 | `src/lib/agents/tools/export-handoff.ts` | Handoff 导出工具 |
| 9 | `src/lib/agents/tools/answer-question.ts` | 问答工具 |
| 10 | `src/lib/agents/tools/inspect-canvas.ts` | 画布检查工具（新） |
| 11 | `src/lib/agents/tools/manipulate-canvas.ts` | 画布操作工具（新） |
| 12 | `src/lib/agents/tools/index.ts` | 统一注册入口 |

**LangGraph Agent（3 个）**：

| # | 文件路径 | 说明 |
|---|---------|------|
| 13 | `src/lib/agents/langgraph-agent.ts` | ReAct Agent 创建 |
| 14 | `src/lib/agents/agent-run-service.ts` | 运行生命周期管理 |
| 15 | `src/lib/agents/stream-adapter.ts` | 事件适配器 |

**回退与提示词（3 个）**：

| # | 文件路径 | 说明 |
|---|---------|------|
| 16 | `src/lib/agents/agent-loop-fallback.ts` | LLM 不可用时规则引擎回退 |
| 17 | `src/lib/agents/system-prompt.ts` | 系统提示词构建 |
| 18 | `src/lib/agents/checkpointer.ts` | SqliteSaver 管理 |

**会话记忆（1 个）**：

| # | 文件路径 | 说明 |
|---|---------|------|
| 19 | `src/lib/agents/session-memory.ts` | 会话记忆管理 |

**WebSocket 通信层（4 个）**：

| # | 文件路径 | 说明 |
|---|---------|------|
| 20 | `src/lib/ws/types.ts` | 消息 schema |
| 21 | `src/lib/ws/handler.ts` | 连接管理+命令分发 |
| 22 | `src/lib/ws/event-buffer.ts` | 事件缓存（断线重连） |
| 23 | `src/lib/ws/server.ts` | WebSocket 服务器初始化 |

**Sub-Agent（3 个）**：

| # | 文件路径 | 说明 |
|---|---------|------|
| 24 | `src/lib/agents/sub-agents/types.ts` | Sub-Agent 接口 |
| 25 | `src/lib/agents/sub-agents/image-batch-agent.ts` | 批量生图子 Agent |
| 26 | `src/lib/agents/sub-agents/index.ts` | Sub-Agent 注册 |

**前端（1 个）**：

| # | 文件路径 | 说明 |
|---|---------|------|
| 27 | `src/lib/chat/use-ws-client.ts` | WebSocket 客户端 Hook |

**基础设施（7 个）**：

| # | 文件路径 | 说明 |
|---|---------|------|
| 28 | `server.ts` | Next.js custom server（挂载 WebSocket） |
| 29 | `src/lib/providers/image/replicate.ts` | Replicate 图像生成 Provider |
| 30 | `biome.json` | Biome 配置 |
| 31 | `vitest.config.ts` | Vitest 配置 |
| 32 | `src/lib/agents/tools/registry.test.ts` | 工具注册表测试 |
| 33 | `src/lib/agents/agent-loop.test.ts` | Agent 循环测试 |
| 34 | `src/lib/ws/handler.test.ts` | WebSocket 处理器测试 |

### 7.2 修改文件（13 个）

| # | 文件 | 改动 | 量级 |
|---|------|------|------|
| 1 | `src/lib/agents/chat-orchestrator.ts` | 删除 `runTool()` switch-case，`runChatTurn()` 改为调用 `agentRuns.streamRun()` | 大改 |
| 2 | `src/lib/agents/orchestrator-planner.ts` | `planOrchestratorTools()` 标记 deprecated，保留 `decideToolsFallback()` | 中改 |
| 3 | `src/lib/agents/types.ts` | AgentContext 增加 threadId/checkpointer/abortSignal | 小改 |
| 4 | `src/lib/agents/chat-schema.ts` | 新增 WebSocket 事件类型 | 中改 |
| 5 | `src/lib/agents/plan-schema.ts` | 增加新工具名枚举 | 小改 |
| 6 | `src/lib/vad/paths.ts` | 增加 `checkpointsDir()` | 小改 |
| 7 | `src/store/chat-store.ts` | SSE→WebSocket 客户端，增加重连 | 大改 |
| 8 | `src/lib/chat/use-chat-stream.ts` | EventSource→WebSocket 或废弃 | 大改 |
| 9 | `src/app/api/chat/route.ts` | 改为兼容层或废弃 | 小改 |
| 10 | `package.json` | 增加 LangGraph+ws+replicate+biome+vitest 依赖，删除 eslint，修改 scripts | 小改 |
| 11 | `next.config.ts` | 配置自定义 server 支持 WebSocket | 小改 |
| 12 | `tsconfig.json` | 可能需要调整 server.ts 的编译配置 | 小改 |
| 13 | `eslint.config.mjs` | 删除（被 Biome 替代） | 删除 |

### 7.3 废弃/删除文件（12 个）

| # | 文件 | 原因 |
|---|------|------|
| 1 | `src/lib/agents/orchestrator-tools.ts` | 工具定义移入工具模块 |
| 2 | `src/lib/agents/architect-agent.ts` | 网页结构已废弃 |
| 3 | `src/lib/agents/layout-agent.ts` | 网页结构已废弃 |
| 4 | `src/lib/agents/content-agent.ts` | 网页结构已废弃 |
| 5 | `src/lib/agents/repair-agent.ts` | 网页结构已废弃 |
| 6 | `src/lib/agents/page-edit-agent.ts` | 网页结构已废弃 |
| 7 | `src/lib/agents/critic-agent.ts` | 后续以工具形式重做 |
| 8 | `src/lib/agents/critic-checks.ts` | 随 critic-agent 废弃 |
| 9 | `src/lib/agents/critic-schema.ts` | 随 critic-agent 废弃 |
| 10 | `src/lib/agents/content-preferences.ts` | 随 content-agent 废弃 |
| 11 | `src/lib/agents/page-reference.ts` | 引用解析移入工具内部 |
| 12 | `src/lib/chat/sse-parser.ts` | SSE 改 WebSocket 后不需要 |

### 7.4 保留不动的文件

| 文件 | 保留原因 |
|------|---------|
| `src/lib/agents/design-pipeline.ts` | 一键生成模式仍走固定流水线 |
| `src/lib/agents/orchestrator.ts` | 一键生成入口不变 |
| `src/lib/agents/brief-agent.ts` | 被工具模块内部调用 |
| `src/lib/agents/design-director-agent.ts` | 被工具模块内部调用 |
| `src/lib/agents/image-planner-agent.ts` | 被工具模块内部调用 |
| `src/lib/agents/image-executor-agent.ts` | 被工具模块内部调用 |
| `src/lib/agents/handoff-agent.ts` | 被 export-handoff 工具调用 |
| `src/lib/handoff/*` | Handoff 交付系统不变 |
| `src/lib/providers/*` | Provider 层不变（新增 replicate） |
| `src/lib/project/*` | Project schema 不变 |
| `src/lib/canvas/*` | Canvas 渲染层不变 |
| `src/lib/skills/*` | Skills 系统不变 |
| `src/lib/vad/persist.ts` | 本地持久化不变 |
| 所有前端组件 | 仅 chat-store 和 use-chat-stream 改动 |

### 7.5 新增依赖

```json
{
  "dependencies": {
    "@langchain/core": "^0.3.x",
    "@langchain/langgraph": "^0.2.x",
    "@langchain/langgraph-checkpoint-sqlite": "^0.0.x",
    "@langchain/openai": "^0.3.x",
    "@langchain/anthropic": "^0.3.x",
    "@langchain/google-genai": "^0.1.x",
    "ws": "^8.x",
    "replicate": "^1.x"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.4",
    "vitest": "^3.0.7",
    "@types/ws": "^8.x",
    "@testing-library/react": "^16.2.0",
    "@testing-library/jest-dom": "^6.6.3"
  }
}
```

**删除依赖**：`eslint`、`eslint-config-next`

---

## 8. 实施计划

### 8.1 阶段总览

```
阶段 1：工具注册表          ← 基础设施，无行为变化
  │   新增 12 文件，修改 2 文件 | 风险：低
  ▼
阶段 2：LangGraph + WebSocket  ← 核心架构变更
  │   新增 11 文件，修改 7 文件 | 风险：中
  ▼
阶段 3：会话记忆            ← 用户体验提升
  │   新增 2 文件，修改 3 文件 | 风险：低
  ▼
阶段 4：Sub-Agent           ← 扩展能力
  │   新增 3 文件，修改 1 文件 | 风险：低
  ▼
阶段 5：画布交互工具         ← 交互增强
  │   填充阶段 1 创建的占位文件 | 风险：低
  ▼
阶段 6：清理废弃代码         ← 技术债清理
      删除 12 文件 | 风险：低
```

### 8.2 阶段 1：工具注册表

**目标**：建立工具注册表，将 switch-case 逻辑抽取为独立工具模块。

**步骤**：
1. 创建 `tools/types.ts` — 定义 AgentTool / ToolContext / ToolResult
2. 创建 `tools/registry.ts` — 实现 ToolRegistry
3. 逐个创建 9 个工具模块
4. 创建 `tools/index.ts` — 统一注册
5. 修改 `chat-orchestrator.ts` — `runTool()` 改为 `toolRegistry.execute()`
6. 修改 `orchestrator-tools.ts` — 工具定义从 registry 获取

**验收**：所有现有 Chat 功能行为不变，新增工具可通过 `register()` 注册。

### 8.3 阶段 2：LangGraph Agent + WebSocket

**目标**：用 LangGraph ReAct Agent 替换一次性规划，用 WebSocket 替换 SSE。

**步骤**：
1. 安装依赖（LangGraph + ws + LangChain）
2. 创建 `langgraph-agent.ts` — `createVadAgent()`
3. 创建 `agent-run-service.ts` — AgentRunService
4. 创建 `stream-adapter.ts` — 事件适配
5. 创建 `system-prompt.ts` — 提示词构建
6. 创建 `agent-loop-fallback.ts` — 回退循环
7. 创建 `ws/types.ts` — 消息 schema
8. 创建 `ws/handler.ts` — WebSocket 处理器
9. 创建 `ws/event-buffer.ts` — 事件缓存
10. 创建 `ws/server.ts` — 服务器初始化
11. 创建 `server.ts` — Next.js custom server
12. 创建 `use-ws-client.ts` — 前端 WebSocket Hook
13. 修改 `chat-store.ts` — SSE→WebSocket
14. 修改 `chat-orchestrator.ts` — 调用 `agentRuns.streamRun()`
15. 修改 `next.config.ts` — 自定义 server
16. 修改 `api/chat/route.ts` — 兼容层
17. 修改 `package.json` — scripts 改用 `tsx server.ts`

**验收**：
- 用户发消息 → WebSocket → Agent 自主调用工具 → 流式返回
- 可中途取消（`agent.cancel`）
- 刷新页面后重连，可看到事件回放
- LLM 不可用时自动回退到规则引擎
- 多标签页同步

### 8.4 阶段 3：会话记忆

**步骤**：
1. 创建 `checkpointer.ts` — SqliteSaver 初始化
2. 创建 `session-memory.ts` — 会话管理
3. 修改 `types.ts` — AgentContext 增加 threadId/checkpointer
4. 修改 `paths.ts` — 增加 checkpointsDir()
5. 修改 `chat-store.ts` — threadId 管理

**验收**：关闭再打开同一项目，Agent 记住上次对话上下文。

### 8.5 阶段 4：Sub-Agent

**步骤**：
1. 创建 `sub-agents/types.ts` — SubAgentDef 接口
2. 创建 `sub-agents/image-batch-agent.ts` — 批量生图
3. 创建 `sub-agents/index.ts` — 注册 + delegate_task 工具
4. 修改 `tools/index.ts` — 注册 delegate_task

**验收**：主 Agent 可通过 `delegate_task` 委派批量生图任务。

### 8.6 阶段 5：画布交互工具

**步骤**：
1. 完善 `tools/inspect-canvas.ts` — 返回画布元素列表+状态
2. 完善 `tools/manipulate-canvas.ts` — move/delete/reorder/tag 操作

**验收**：用户说"把这张图移到左边"，Agent 调用 manipulate_canvas 完成。

### 8.7 阶段 6：清理废弃代码

**步骤**：
1. 全局搜索确认无引用
2. 逐个删除 12 个文件
3. 运行 `pnpm build` 确认无编译错误

### 8.8 横向：工具链迁移

与阶段 2 并行进行：

1. 安装 Biome，创建 `biome.json`
2. 删除 `eslint.config.mjs` 和 eslint 依赖
3. 修改 `package.json` scripts：`lint` → `biome check .`
4. 安装 Vitest，创建 `vitest.config.ts`
5. 编写 3 个核心测试文件

---

## 9. 风险与验收

### 9.1 风险与应对

| 风险 | 概率 | 影响 | 应对 |
|------|------|------|------|
| LangGraph 版本变更 API breaking | 中 | 中 | 锁定版本，升级前测试 |
| WebSocket 在 Next.js custom server 中集成复杂 | 中 | 高 | 参考 Loomic handler 实现 |
| LLM 循环不终止 | 低 | 高 | maxIterations=10，超过强制退出 |
| SqliteSaver 在 Windows 路径问题 | 低 | 中 | 使用 path.join()，测试 Windows |
| 前端 SSE→WebSocket 迁移引入 bug | 中 | 中 | 保留 SSE 兼容层，渐进迁移 |
| LangChain 依赖体积过大 | 中 | 低 | 按需安装，tree-shaking |

### 9.2 验收标准

**功能验收**：

- [ ] 用户发消息 → Agent 自主决定调用工具序列（不再固定）
- [ ] 工具执行结果影响 Agent 下一步决策
- [ ] 用户可中途取消 Agent 运行
- [ ] 用户刷新页面后重连，可看到已生成的事件回放
- [ ] 多标签页打开同一项目，一个触发生成，另一个实时看到更新
- [ ] LLM 不可用时自动回退到规则引擎，功能不中断
- [ ] 关闭再打开项目，Agent 记住上次对话上下文
- [ ] 一键生成模式（首页 BriefLauncher）行为不变
- [ ] Handoff 导出功能正常（4 种 target）
- [ ] 所有 Provider（OpenAI/Claude/Gemini/DeepSeek）正常工作

**技术验收**：

- [ ] `pnpm build` 无编译错误
- [ ] `pnpm lint`（Biome）无 lint 错误
- [ ] `pnpm test`（Vitest）全部通过
- [ ] 工具注册表可通过 `register()` 扩展新工具
- [ ] `toolRegistry.toToolDefinitions()` 输出正确 function calling 格式
- [ ] SqliteSaver checkpoint 文件正确创建在 `.vad/checkpoints/`
- [ ] WebSocket 心跳正常（30s ping）
- [ ] 事件缓存正确回放

**性能验收**：

- [ ] Agent 首次响应延迟 < 3 秒
- [ ] 图片生成事件实时推送延迟 < 500ms
- [ ] WebSocket 连接建立时间 < 1 秒
- [ ] 断线重连回放时间 < 2 秒

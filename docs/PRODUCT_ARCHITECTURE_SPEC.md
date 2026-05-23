# Visual Agent Designer 项目方案

## 0. 文档目标

本文是 Visual Agent Designer 的完整项目方案，重构整合了以下方向：

- 产品不是电商设计工具。
- 产品核心是 UI 生成、产品原型、小红书图文和设计到开发的 handoff。
- 前端主技术栈使用 Next.js。
- 产品第一阶段是开源、本地优先的设计工具，不优先做 SaaS 平台。
- 需要同时支持 LLM 模型和图片生成模型。
- 最终代码生成不是本产品核心职责，本产品主要给 Cursor、Claude Code、Codex 等 AI coding agent 提供高质量上下文。
- 可以参考 Open Design 的本地优先、Skill、Design System、Artifact、Prompt Stack 和 Export Pipeline，但不能照搬其 HTML/JSX artifact 路线。

---

## 1. 产品定位

Visual Agent Designer 是一个开源、本地优先的 AI 产品设计工具。

它帮助用户从一个产品想法出发，生成：

- 产品原型
- 页面流程
- 产品 UI 设计图
- Landing Page 首屏
- App / Web / 小程序 / 插件界面
- 小红书封面和多图图文
- 可编辑画布
- 图片模型生成的视觉资产
- 给 AI coding agent 使用的开发 handoff 包

一句话定位：

> 从产品想法到 UI 原型，再到 coding agent 可执行的开发上下文。

更具体地说：

> 用户输入一个产品想法，系统通过 LLM 和图片模型生成产品原型、UI 视觉稿、小红书图文和可编辑画布，最后导出包含截图、资产、prompt、设计 token、组件说明和实现任务的 handoff 包，辅助 Cursor、Claude Code、Codex 等 coding agent 完成开发落地。

---

## 2. 产品边界

### 2.1 当前要做

第一阶段要做的是一个本地优先的 AI 设计工具，重点包括：

- 产品 Brief 生成
- 产品原型生成
- 页面流程生成
- 产品 UI 视觉生成
- 小红书图文生成
- 参考图再设计
- 可编辑画布
- 多模型配置
- Agent 工作流可视化
- 本地项目文件
- PNG / JSON / Markdown / ZIP 导出
- Coding Agent Handoff

### 2.2 当前不做

第一阶段不做：

- 电商主图平台
- 淘宝 / 抖音电商运营工具
- 完整 Figma 替代
- 完整 PSD 级图层拆分
- 云端团队协作
- 登录系统
- 支付订阅
- 模板市场
- 在线 SaaS 管理后台
- 直接替代 Cursor / Claude Code / Codex 写完整代码

### 2.3 关键边界

本产品不是代码生成器。

Cursor、Claude Code、Codex 已经很擅长写代码。本产品不应该重复做一个 coding agent，而应该做：

> 产品设计、视觉生成、原型规划和开发上下文整理工具。

最终输出给 coding agent 的不是一句文字需求，而是一整套开发上下文：

- UI 参考图
- 最终页面截图
- 图片资产
- 画布 JSON
- 设计 token
- 页面结构
- 组件说明
- 交互状态
- LLM prompt
- 图片生成 prompt
- 模型参数
- 实现任务
- 验收标准

---

## 3. 目标用户

### 3.1 独立开发者

需求：

- 快速把产品想法变成 UI 和原型。
- 没有设计师也能获得可用视觉方向。
- 把设计结果交给 Cursor / Claude Code / Codex 开发。

典型任务：

- “帮我生成一个 AI 日程 App 的首页、详情页和设置页。”
- “帮我做一个产品官网首屏。”
- “把这套 UI 整理成 Cursor 可以执行的开发 prompt。”

### 3.2 产品经理和创业团队

需求：

- 快速表达产品概念。
- 生成页面流程和 MVP 范围。
- 和设计、开发、客户沟通产品方向。
- 输出给 AI coding agent 的实现说明。

典型任务：

- “根据这个 PRD 生成产品原型和 UI 方向。”
- “把这个产品拆成 MVP 页面。”
- “生成 Claude Code 开发任务清单。”

### 3.3 UI / UX 设计师

需求：

- 快速探索视觉方向。
- 基于参考图生成变体。
- 用 AI 生成 moodboard、页面草图和高保真方向。
- 保留可编辑图层继续精修。

典型任务：

- “保持这个布局，换成更年轻的视觉风格。”
- “基于这张参考图生成 5 个 UI 变体。”
- “把这个 App 改成高端 SaaS 风格。”

### 3.4 小红书内容创作者 / 运营

需求：

- 生成小红书封面。
- 生成多图图文。
- 生成标题、正文和标签。
- 把产品功能转成更适合内容平台的表达。

典型任务：

- “为这个 AI 工具生成一组小红书图文。”
- “生成一张更有点击感的封面。”
- “把产品功能讲得更生活化。”

### 3.5 AI Coding Agent 使用者

需求：

- 不想从空白 prompt 开始让 coding agent 写代码。
- 需要把产品、页面、组件、状态、视觉规范先整理清楚。
- 需要让 Cursor / Claude Code / Codex 拿到更稳定的上下文。

典型任务：

- “输出 Cursor 项目初始化 prompt。”
- “生成 Claude Code 开发任务清单。”
- “把这个设计拆成 React 组件结构。”
- “生成 MVP 实现步骤和验收标准。”

---

## 4. Open Design 可借鉴部分

Open Design 的核心模式是：

```txt
Coding Agent -> 生成 HTML / JSX / Deck / DESIGN.md artifact -> Preview / Export
```

我们的核心模式应该是：

```txt
LLM + 图片模型
  -> 生成产品原型 / UI 图片 / 小红书图文 / 可编辑画布
  -> 导出截图 + 资产 + prompt + 设计 token + handoff 包
  -> 辅助 Cursor / Claude Code / Codex 开发落地
```

因此，我们应该参考 Open Design 的工程组织方式，但不照搬它的输出形态。

### 4.1 借鉴 Web + Local Daemon

Open Design 的本地优先架构很适合参考：

```txt
Next.js App
  -> Local API / Daemon
  -> Agent / Model Adapter
  -> Local Project Files
  -> Export Pipeline
```

本项目也建议采用类似架构：

```txt
Next.js App
  -> Local API / Daemon
  -> LLM Provider Gateway
  -> Image Provider Gateway
  -> Project Artifact Store
  -> Handoff Exporter
```

价值：

- API Key 可以留在本地。
- 可以连接本地 ComfyUI。
- 可以读写本地项目文件。
- 开源用户无需注册账号即可使用。

### 4.2 借鉴 Skill 文件化

Open Design 用 `SKILL.md` 定义能力。本项目也应把设计能力文件化。

推荐结构：

```txt
skills/
  product-ui/
    SKILL.md
  prototype-flow/
    SKILL.md
  xhs-cover/
    SKILL.md
  xhs-carousel/
    SKILL.md
  reference-redesign/
    SKILL.md
  coding-agent-handoff/
    SKILL.md
```

每个 skill 定义：

- 输入字段
- Agent 工作流
- 需要调用的 LLM / Image Provider
- 输出画布结构
- 输出图片资产
- 质量检查规则
- handoff 导出规则

### 4.3 借鉴 Design System 文件化

Open Design 使用 `DESIGN.md`。本项目也需要文件化设计系统，但要扩展成同时服务 LLM、图片模型、画布和 coding agent。

推荐结构：

```txt
design-systems/
  linear-like/
    DESIGN.md
    IMAGE_PROMPT.md
    TOKENS.json
    HANDOFF_RULES.md
```

说明：

- `DESIGN.md`：颜色、字体、布局、组件、动效和设计禁忌。
- `IMAGE_PROMPT.md`：图片模型视觉风格和 prompt 规则。
- `TOKENS.json`：给画布和前端实现使用。
- `HANDOFF_RULES.md`：告诉 coding agent 哪些必须严格还原，哪些可以近似。

### 4.4 借鉴 Artifact 文件系统

Open Design 把结果保存为 artifact 文件夹。我们也应该把每个项目落到本地文件系统。

推荐结构：

```txt
.vad/
  projects/
    ai-calendar-app/
      project.json
      prototype-flow.json
      design-tokens.json
      canvas/
        home.json
        dashboard.json
      screenshots/
        home.png
        dashboard.png
      ai-reference/
        ui-direction-a.png
        ui-direction-b.png
      assets/
        hero-bg.png
        empty-state.png
      prompts/
        brief-agent.md
        image-home.md
      handoff/
        cursor-prompt.md
        claude-code-prompt.md
        codex-prompt.md
```

价值：

- 可 Git 管理。
- 方便调试。
- 方便 coding agent 读取。
- 方便导出 ZIP。
- 方便开源扩展。

### 4.5 借鉴 Adapter 思路

Open Design 适配 coding agent CLI。我们不需要第一阶段就适配大量 CLI，但应该借鉴 adapter 思路。

本项目需要三类 Adapter：

```txt
LLM Provider Adapter
  -> OpenAI / Claude / Gemini / DeepSeek / Qwen

Image Provider Adapter
  -> nano banana / OpenAI Image / Flux / ComfyUI / Replicate / fal.ai

Handoff Target Adapter
  -> Cursor / Claude Code / Codex
```

### 4.6 借鉴 Prompt Stack

Open Design 的 prompt 是组合式的。本项目也应该使用 prompt stack：

```txt
Base Product Designer Prompt
  + active Skill
  + active Design System
  + active Image Prompt Guide
  + prototype context
  + canvas state
  + asset manifest
  + target handoff format
  + user instruction
```

这样 Agent 输出更稳定，也更容易调试。

### 4.7 借鉴 Discovery 流程

用户输入“帮我做一个 AI 记账 App”时，系统不应立刻生成，而应该先补全关键信息：

- 面向谁？
- 是 App、Web、小程序还是插件？
- 需要几页？
- 偏工具型、生活方式还是高端 SaaS？
- 是否需要小红书图文？
- 最终导出给 Cursor、Claude Code 还是 Codex？
- 是否有参考图？

这个流程由 Brief Agent 完成。

### 4.8 借鉴 Comment Refine

Open Design 支持在 preview 中点击元素并局部修改。我们可以基于画布实现类似能力：

- 点中卡片：“这里更突出 AI 总结。”
- 点中封面标题：“更像小红书爆款。”
- 点中图片图层：“保持布局，重绘背景。”
- 点中页面：“输出给 Cursor 的实现说明。”

### 4.9 借鉴 Export Pipeline

Open Design 导出 HTML、PDF、PPTX、ZIP。我们的导出应围绕自己的核心结果：

- PNG
- PDF
- Project JSON
- Canvas JSON
- Design Tokens
- Image Assets
- Prompt Logs
- Coding Agent Handoff ZIP

其中：

> Handoff ZIP 是本产品的核心差异化输出。

### 4.10 不照搬 Open Design 的部分

不应照搬：

- 不以 HTML / JSX artifact 作为主要设计结果。
- 不把 coding agent 当成设计生成引擎。
- 不只依赖 Claude Code / Codex / Cursor 生成设计。
- 不把 iframe preview 当核心画布。
- 不在第一阶段适配大量 agent CLI。

我们的差异化：

- 图片模型生成 UI 视觉图。
- 可编辑画布。
- 产品原型。
- 小红书图文。
- 视觉参考图、图片资产、prompt、设计 token 一起交给 coding agent。

---

## 5. 核心功能架构

### 5.1 产品 Brief Composer

作用：

- 接收用户自然语言输入。
- 自动补全产品信息。
- 生成结构化 Brief。

输出：

- 产品名称
- 产品定位
- 目标用户
- 使用场景
- 核心功能
- 平台类型
- 视觉风格
- 输出目标

### 5.2 Product Prototype Builder

作用：

- 生成产品原型。
- 拆解 MVP。
- 规划页面流程。
- 生成用户路径。

输出：

- 信息架构
- 页面列表
- 用户流程
- 页面状态
- MVP 功能范围
- 交互说明

### 5.3 UI Generation Workspace

作用：

- 生成产品 UI 方向。
- 管理多套视觉方案。
- 生成页面组。

输出：

- App 页面
- Web 页面
- Landing Page
- Dashboard
- 插件页面
- 小程序页面

### 5.4 XHS Content Designer

作用：

- 生成小红书封面和多图图文。
- 生成标题、正文、标签。
- 将产品功能转成内容平台表达。

输出：

- 封面图
- 多图卡片
- 标题建议
- 正文
- 标签

### 5.5 Reference Redesign

作用：

- 上传参考图。
- 分析布局、颜色和文字。
- 生成同款变体或换风格版本。

能力：

- OCR
- 颜色提取
- 布局识别
- 半可编辑图层还原
- 保持结构换风格
- 保持风格换内容

### 5.6 Canvas Editor

作用：

- 编辑最终设计。
- 保证文字、按钮、卡片等是真实图层。

能力：

- 选择图层
- 拖拽移动
- 修改文字
- 修改颜色
- 调整尺寸
- 添加图片
- 添加按钮
- 添加卡片
- 多页面管理
- 导出 PNG / JSON

### 5.7 Image Generation Workspace

作用：

- 生成视觉素材。
- 管理图片模型结果。
- 将图片资产插入画布。

素材类型：

- UI 方向参考图
- 背景图
- 插画
- 产品展示图
- 小红书封面视觉
- 空状态插图
- Icon

### 5.8 Coding Agent Handoff Builder

作用：

- 将设计结果整理成 coding agent 可执行上下文。

输出：

- `handoff.md`
- `project.json`
- `prototype-flow.json`
- `design-tokens.json`
- `canvas/*.json`
- `screenshots/*.png`
- `ai-reference/*.png`
- `assets/*`
- `prompts/*.md`
- `cursor-prompt.md`
- `claude-code-prompt.md`
- `codex-prompt.md`

---

## 6. Agent 架构

### 6.1 Brief Agent

职责：

- 理解用户输入。
- 提取产品名、用户、平台、输出目标。
- 生成结构化 Brief。
- 在信息不足时发起 Discovery。

### 6.2 Product Architect Agent

职责：

- 生成产品原型。
- 拆解功能模块。
- 规划页面流程。
- 输出用户故事和 MVP 范围。

### 6.3 Design Director Agent

职责：

- 定义视觉方向。
- 选择设计系统。
- 生成设计 token。
- 规划 UI 信息层级。

### 6.4 Layout Agent

职责：

- 生成可编辑画布结构。
- 决定页面节点、位置、尺寸、层级。
- 输出 Canvas JSON。

### 6.5 Content Agent

职责：

- 生成标题、说明文案、按钮文案。
- 生成小红书标题、正文、标签。
- 根据平台调整语气。

### 6.6 Prompt Agent

职责：

- 生成 LLM prompt。
- 生成图片模型 prompt。
- 生成 negative prompt。
- 生成参考图重绘 prompt。

### 6.7 Image Agent

职责：

- 调用图片模型。
- 生成背景、插画、UI 方向图和产品场景图。
- 保存模型参数、seed、成本和耗时。

### 6.8 Vision Critic Agent

职责：

- 评估图片和页面质量。
- 判断文字是否清晰。
- 判断 UI 是否可信。
- 判断是否符合 Brief。
- 判断是否需要重试。

### 6.9 Layerization Agent

职责：

- 分析参考图。
- OCR 提取文字。
- 识别按钮、卡片、图片区域。
- 生成近似可编辑图层。

### 6.10 Handoff Agent

职责：

- 收集最终页面截图。
- 收集图片模型生成的 UI 参考图。
- 收集背景、插画、产品图等图片资产。
- 收集 LLM prompt、图片 prompt 和模型参数。
- 生成组件清单。
- 生成页面实现说明。
- 生成 Cursor / Claude Code / Codex prompt。
- 标注哪些视觉区域必须严格还原。
- 标注哪些地方可以由 coding agent 组件化实现。

---

## 7. 模型架构

### 7.1 LLM Provider

用途：

- Brief 解析
- 产品原型
- 页面流程
- 文案生成
- Prompt 生成
- 设计评估
- Handoff 生成

Provider：

- OpenAI GPT 系列
- Claude
- Gemini
- DeepSeek
- Qwen
- 本地 LLM，后续可选

接口示例：

```ts
interface LlmProvider {
  generateText(input: {
    system: string
    prompt: string
    schema?: unknown
  }): Promise<{
    text: string
    usage?: {
      inputTokens: number
      outputTokens: number
    }
  }>
}
```

### 7.2 Image Provider

用途：

- UI 方向图
- 背景图
- 插画
- 产品场景图
- 小红书封面
- 参考图重绘
- 局部重绘

Provider：

- nano banana / Gemini Image
- OpenAI Image
- Flux
- Stable Diffusion / SDXL
- ComfyUI
- Replicate
- fal.ai

接口示例：

```ts
interface ImageProvider {
  generateImage(input: {
    prompt: string
    width: number
    height: number
    referenceImages?: string[]
  }): Promise<{
    imageUrl: string
    model: string
    seed?: string
    cost?: number
  }>
}
```

### 7.3 Handoff Target Adapter

用途：

- 为不同 coding agent 输出不同格式的上下文。

Targets：

- Cursor
- Claude Code
- Codex
- 通用 Markdown

接口示例：

```ts
interface HandoffTarget {
  build(input: HandoffContext): Promise<{
    files: Array<{
      path: string
      content: string
    }>
  }>
}
```

---

## 8. 工作流设计

### 8.1 产品 UI + 原型工作流

```txt
用户输入产品想法
  -> Brief Agent 结构化需求
  -> Product Architect Agent 生成产品原型和页面流程
  -> Design Director Agent 生成视觉方向
  -> Layout Agent 生成可编辑页面结构
  -> Content Agent 生成页面文案
  -> Prompt Agent 生成模型 prompt
  -> Image Agent 生成视觉素材
  -> Canvas Renderer 合成设计稿
  -> Vision Critic Agent 评估质量
  -> 用户选择方向并编辑
  -> Handoff Agent 生成 coding agent 开发包
```

### 8.2 小红书图文工作流

```txt
用户输入主题
  -> Brief Agent 分析平台、人群和内容目标
  -> Content Agent 生成标题、正文和图文大纲
  -> Design Director Agent 选择图文风格
  -> Layout Agent 生成封面和多图卡片
  -> Image Agent 生成视觉素材
  -> Canvas Renderer 渲染真实文字
  -> Vision Critic Agent 检查点击感和可读性
  -> 导出 PNG
```

### 8.3 参考图再设计工作流

```txt
上传参考图
  -> Vision Parser 分析图片
  -> OCR 提取文字
  -> Layerization Agent 生成可编辑草图
  -> 用户选择目标：同款 / 换风格 / 换内容
  -> Design Director Agent 重设风格
  -> Image Agent 生成新素材
  -> Canvas Renderer 输出新设计
```

### 8.4 Coding Agent Handoff 工作流

```txt
用户完成设计和原型
  -> Handoff Agent 读取页面和图层
  -> 收集图像模型生成的 UI 参考图
  -> 收集最终画布导出的页面截图
  -> 收集背景、插画、产品图等图片资产
  -> 收集 LLM prompt、图片 prompt 和模型参数
  -> 生成产品说明
  -> 生成组件结构
  -> 生成页面任务
  -> 生成 design tokens
  -> 生成视觉还原说明
  -> 生成 Cursor / Claude Code / Codex prompt
  -> 导出 handoff 文件夹或 ZIP 包
```

---

## 9. Handoff 包设计

Handoff 包不是单一 Markdown 文档，而是一组结构化文件和视觉资产。

推荐结构：

```txt
handoff/
  README.md
  product-brief.md
  implementation-plan.md
  acceptance-criteria.md
  cursor-prompt.md
  claude-code-prompt.md
  codex-prompt.md
  project.json
  prototype-flow.json
  design-tokens.json
  canvas/
    home.json
    dashboard.json
    settings.json
  screenshots/
    home.png
    dashboard.png
    settings.png
  ai-reference/
    ui-direction-a.png
    ui-direction-b.png
    xhs-cover.png
  assets/
    background-hero.png
    illustration-empty-state.png
    app-mockup.png
  prompts/
    llm-brief-prompt.md
    layout-agent-prompt.md
    image-home-prompt.md
    image-xhs-cover-prompt.md
  metadata/
    model-runs.json
    asset-manifest.json
```

各目录作用：

- `screenshots/`：最终画布导出的页面图，用于视觉对照。
- `ai-reference/`：图像模型生成的 UI 方向图，用于表达风格和氛围。
- `assets/`：开发时可直接使用的图片素材。
- `prompts/`：保存生成设计时使用的提示词，方便理解设计意图。
- `canvas/`：保存可编辑图层结构，方便转换成组件布局。
- `design-tokens.json`：约束颜色、字号、间距和圆角。
- `metadata/model-runs.json`：记录模型、seed、尺寸、耗时和成本。

关键原则：

> 同时给 coding agent 图片、结构、资产、prompt 和验收标准，而不是只给一段文字需求。

---

## 10. 画布数据结构

设计稿必须保存为结构化 JSON，而不是只保存图片。

示例：

```json
{
  "id": "project_001",
  "title": "AI 灵感管理 App",
  "prototype": {
    "flows": ["collect idea", "create project", "generate tasks"],
    "pages": ["home", "project detail", "settings"]
  },
  "pages": [
    {
      "id": "page_home",
      "name": "首页",
      "width": 390,
      "height": 844,
      "nodes": [
        {
          "id": "node_title",
          "type": "text",
          "content": "Today",
          "x": 24,
          "y": 48,
          "width": 240,
          "height": 48,
          "fontSize": 32,
          "color": "#111827"
        }
      ]
    }
  ]
}
```

节点类型：

- frame
- text
- image
- shape
- card
- button
- group
- component
- background

设计原则：

- Schema 不绑定某个画布库。
- Konva / SVG / Figma / HTML 都可以从 schema 转换。
- 每个 AI 生成节点记录来源。
- 每个图片素材记录 prompt、模型、seed 和 provider。

---

## 11. 技术栈选择

### 11.1 主应用

推荐：

- Next.js
- React
- TypeScript
- Tailwind CSS
- shadcn/ui
- Zustand
- TanStack Query

原因：

- Next.js 同时适合前端、Route Handlers、模型代理和导出能力。
- TypeScript 有利于维护 Canvas schema、Agent 输出和 Provider 接口。
- shadcn/ui 适合快速构建设计工具界面。

### 11.2 画布

第一阶段推荐：

- Konva.js

原因：

- 适合固定尺寸画布。
- 适合小红书图文和 UI 展示图。
- PNG 导出直接。
- 图层编辑容易控制。

后续可选：

- tldraw SDK，用于无限画布、白板式协作和更复杂的原型工作区。

### 11.3 本地 API / Daemon

第一阶段：

- Next.js Route Handlers

第二阶段可拆出：

- Node.js
- Hono 或 Fastify
- SQLite
- Drizzle ORM
- BullMQ，可选
- sharp

### 11.4 AI / Agent

第一阶段：

- 自研轻量 workflow
- Local Mock LLM
- Local Mock Image

第二阶段：

- LLM Provider Gateway
- Image Provider Gateway
- LangGraph.js，可选

### 11.5 图像与 OCR

图像处理：

- sharp
- browser canvas

OCR：

- Tesseract.js，轻量本地方案。
- PaddleOCR，本地高质量方案。
- OpenAI / Gemini Vision，质量优先方案。

---

## 12. 模块架构

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
  ├─ Skill Registry
  ├─ Design System Resolver
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

---

## 13. MVP 优先级

### P0：必须先做

- Next.js 项目骨架
- 产品 Brief 输入
- 产品原型生成，Local Mock
- UI 页面生成，Local Mock
- 小红书图文生成，Local Mock
- Konva 可编辑画布
- 图层编辑
- PNG / JSON 导出
- Handoff Markdown 导出
- Agent 工作流可视化
- Local Project JSON

### P1：真实模型接入

- LLM Provider 抽象
- Image Provider 抽象
- OpenAI / Claude / Gemini 等 LLM 接入
- nano banana / OpenAI Image 接入
- 模型设置面板
- Prompt 查看和编辑
- 运行历史
- 图片资产库
- Handoff ZIP 导出

### P2：参考图与开发落地增强

- 上传参考图再设计
- OCR
- 颜色提取
- 布局分析
- 局部重绘
- Cursor / Claude Code / Codex prompt 模板
- design-tokens.json
- asset-manifest.json

### P3：生态扩展

- ComfyUI 本地接入
- Skill 插件接口
- Design System 插件接口
- Figma 导出
- HTML / Tailwind 导出，作为辅助能力
- 云端同步，可选

---

## 14. 开发路线

### 第 1 阶段：Next.js 本地设计工具原型

目标：

> 用户输入一个产品想法，可以生成产品原型、UI 视觉稿、小红书图文，并导出给 coding agent 的 handoff。

内容：

- Next.js + React + TypeScript
- Konva 画布
- Zustand 状态管理
- Local Mock LLM
- Local Mock Image
- Agent workflow mock
- 产品原型数据结构
- Handoff 导出

### 第 2 阶段：真实模型接入

目标：

> 让 LLM 和图像模型真实参与产品设计流程。

内容：

- LLM Provider 抽象
- Image Provider 抽象
- OpenAI / Claude / Gemini 等 LLM 接入
- nano banana / OpenAI Image 接入
- Prompt Agent
- Vision Critic 初版
- 模型设置面板

### 第 3 阶段：参考图再设计与 Handoff 增强

目标：

> 让用户上传参考图生成变体，并把设计交给 coding agent 开发。

内容：

- 图片上传
- OCR
- 颜色提取
- 布局分析
- 同款变体
- Handoff Agent
- Cursor / Claude Code / Codex prompt 输出
- Handoff ZIP

### 第 4 阶段：开源生态

目标：

> 让开发者可以扩展模型、Agent、模板和导出器。

内容：

- Provider 插件接口
- Agent 插件接口
- Skill 文档
- Canvas schema 文档
- Design System 文档
- 示例 Provider
- 示例 Agent
- 示例模板
- ComfyUI 本地教程

---

## 15. 与参考产品差异

### 15.1 相比 Google Stitch

Stitch 偏：

- UI 生成
- 产品原型
- 设计到开发

本项目偏：

- 开源和本地优先
- 多 LLM + 多图像模型
- 可编辑画布
- 产品 UI + 小红书图文
- 输出给 coding agent 的 handoff 包

### 15.2 相比 Open Design

Open Design 偏：

- 调用 coding agent 生成 HTML / JSX / Deck artifact
- Skill + Design System + Preview / Export

本项目偏：

- 自己编排 LLM + 图片模型生成设计和原型
- 图片模型是核心能力之一
- 可编辑画布是核心界面
- coding agent 是开发落地目标，不是主要设计生成引擎
- handoff 包包含截图、UI 参考图、图片资产、prompt、设计 token 和任务说明

### 15.3 相比 Canva

Canva 偏：

- 模板
- 手动编辑
- 泛设计

本项目偏：

- Agent 自动规划
- 产品原型生成
- 多模型 UI 视觉生成
- 参考图再设计
- coding agent handoff

---

## 16. 成功标准

### 第一阶段成功标准

- 用户输入一个产品想法，可以生成产品原型和 3 套 UI 方向。
- 用户输入一个主题，可以生成一组小红书图文。
- 生成结果可以编辑文字、颜色、位置和图片。
- 可以导出 PNG 和 JSON。
- 可以导出给 Cursor / Claude Code / Codex 的 handoff 文档。
- 开发者可以看懂 LLM Provider、Image Provider 和 Agent 接口。

### 第二阶段成功标准

- 可以配置至少 2 个 LLM Provider。
- 可以配置至少 2 个 Image Provider。
- 可以上传参考图并生成变体。
- 可以查看每次生成的 prompt、模型、耗时和结果。
- 可以导出包含截图、资产、prompt、设计 token 的 Handoff ZIP。

### 长期成功标准

- 用户把它当作“AI 产品设计和开发准备工作台”，而不是玩具图片生成器。
- 开发者可以贡献 Provider、Agent、Skill、Design System 和导出器。

---

## 17. 最终推荐方案

```txt
Next.js 本地优先开源设计工具
  -> Local API / Daemon
  -> Skill 文件化能力
  -> Design System 文件化
  -> Artifact 文件系统
  -> 产品原型生成
  -> 产品 UI 生成
  -> 小红书图文生成
  -> 可编辑画布
  -> LLM Provider
  -> Image Provider
  -> Agent 工作流
  -> Coding Agent Handoff
```

推荐技术路线：

```txt
Next.js + React + TypeScript
Tailwind CSS + shadcn/ui
Konva.js
Zustand
Next.js Route Handlers
Local Project JSON
LLM Provider: OpenAI / Claude / Gemini / DeepSeek / Qwen
Image Provider: nano banana / OpenAI Image / Flux / ComfyUI
Export: PNG / JSON / Markdown / Handoff ZIP
```

最终产品口号：

> 从产品想法到 UI 原型，再到 coding agent 可执行的开发方案。

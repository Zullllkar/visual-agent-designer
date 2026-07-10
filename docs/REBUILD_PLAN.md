# 完全重构计划：Open Design 三栏工作台模式

> 决策时间：2026-05-24
> 决策原因：用户指出当前架构在 5 个根本性偏差（无 Chat / 无无限画布 / 图片不进资产库 / 无 Skill 文件化 / 无 DESIGN.md 系统）。
> 目标：对齐 Open Design / Claude Design 的产品形态，保持我们自己的差异化（图片模型为核心、coding agent 是落地目标而非生成引擎）。

---

## 北极星形态

```
┌─────────────────┬──────────────────────────────┬─────────────────┐
│ AI Chat Pane    │    无限画布 (tldraw)          │ Artifact Panel  │
│                 │                              │                 │
│ Skill: ▼        │  [CanvasPage shape]          │ ▾ design/       │
│ DesignSys: ▼    │  [ImageAsset shape]          │ ▾ assets/       │
│                 │  [ReferenceCard shape]       │ ▾ prompts/      │
│ messages...     │  [Arrow] (prototype flow)    │ ▾ handoff/      │
│                 │                              │                 │
│ [send]          │  Comment Mode: 点元素 refine │                 │
└─────────────────┴──────────────────────────────┴─────────────────┘
                          ↑
              Prompt Stack:
              BASE + active SKILL.md + active DESIGN.md
              + project context + chat history + user message
```

## 文件系统形态

```
.vad/
├ skills/                       # 文件化技能；可被用户/社区扩展
│   ├ web-prototype/SKILL.md
│   ├ saas-landing/SKILL.md
│   ├ xhs-cover/SKILL.md
│   ├ xhs-carousel/SKILL.md
│   └ mobile-app/SKILL.md
├ design-systems/               # 文件化设计系统；DESIGN.md 9-section
│   ├ linear-like/DESIGN.md
│   ├ stripe-like/DESIGN.md
│   ├ apple-like/DESIGN.md
│   └ xhs-style/DESIGN.md
└ projects/<id>/
    ├ project.json
    ├ canvas.json               # tldraw 整个无限画布快照
    ├ chat-history.jsonl        # 持续对话流
    ├ assets/<id>.png           # 真实图片素材
    ├ prompts/<turn>.md         # 每次 LLM 调用留档
    └ handoff/<target>.zip
```

## 阶段拆分（3-5 天）

### 阶段 A：基础设施（无 UI 改动；让现有流程仍可跑）
- A1. SKILL.md / DESIGN.md 协议（frontmatter + 9-section schema）
- A2. Skill / DesignSystem 加载器（启动扫描，热更新可后置）
- A3. Prompt Stack 组合器（替换硬编码 system prompt）
- A4. 写 3 个示例 SKILL.md（web-prototype / saas-landing / xhs-cover）
- A5. 写 2 个示例 DESIGN.md（linear-like / xhs-style）
- A6. 把 LayoutAgent 的 prompt 抽到 web-prototype/SKILL.md
- A7. SSE chat orchestrator：`/api/chat` route 用 ReadableStream，把 BriefAgent / LayoutAgent / RepairAgent 包成工具调用
- A8. ChatSession schema：projectId + messages + active skill/ds

### 阶段 B：三栏 UI 重构（推倒 BriefLauncher 单页流程）
- B1. tldraw 技术 spike（client-only wrapper）
- B2. 自定义 Shape：CanvasPage / ImageAsset / ReferenceCard
- B3. 左侧 Chat Pane（流式消息 + skill/ds 选择器）
- B4. 中间无限画布
- B5. 右侧 Artifact Tree（文件视图）
- B6. Comment Mode：点元素 → emit element_id 给 Chat

### 阶段 C：Image Workspace（解决偏差 3）
- C1. OpenAIImageProvider（/v1/images/generations）
- C2. ImageAgent：候选 N 张图，存到 assets/
- C3. 候选图作为 ImageAsset shape 出现在画布角
- C4. 拖图入 CanvasPage（变成 image node 引用）
- C5. metadata（prompt/seed/model/cost）跟着 image node 走，最后进 Handoff

### 阶段 D：保留任务
- 小红书工作流（用 xhs-cover skill 跑）
- 参考图再设计（OCR / Layerization）
- Daemon 化（拆出 .vad/ 文件系统持久化层，第一阶段仍用 localStorage）
- Slider 参数控制

## 技术风险与对策

| 风险 | 对策 |
|---|---|
| tldraw 与 Next.js 16 / React 19 兼容性 | 阶段 B1 先做技术 spike；client-only dynamic import 兜底 |
| SKILL.md 协议设计不当导致后期改动 | 直接采用 Claude Code 的 frontmatter 约定（name/description/inputs），未来可 symlink 到 ~/.claude/skills/ |
| 现有 RepairAgent / Critic 流程在 Chat 模式下水土不服 | 包装成工具调用：`refine_layout(pageId, instruction)` / `critique(pageId)` |
| 全部跑通需要的工作量超出预期 | 每个阶段都保留可单独 demo 的状态，分批合入 |

## 当前进度

- [x] 方向校准：用户确认完全重构（2026-05-24）
- [x] 蓝图固化：本文件
- [x] **A1** SKILL.md / DESIGN.md zod schema（`src/lib/skills/schema.ts`）
- [x] **A2** 加载器 + registry（`src/lib/skills/loader.ts`、`src/lib/skills/registry.ts`）
- [x] **A3** Prompt Stack 组合器（`src/lib/skills/prompt-stack.ts`）
- [x] **A4** 3 个示例 SKILL.md（web-prototype / saas-landing / xhs-cover）
- [x] **A5** 2 个示例 DESIGN.md（linear-like / xhs-style）
- [x] 端到端验证：`/api/skills` 返回完整 manifest
- [x] **A6** 重构 4 个 agent + orchestrator 走 prompt-stack（`src/lib/skills/prompt-stack.ts` 4 个特化函数）
- [x] **A6 验证**：`/api/agents/generate` 用 `skillId=xhs-cover` 时正确解析 skill + xhs-style 设计系统
- [x] **A8** ChatSession schema（`src/lib/agents/chat-schema.ts`）+ 工具化（5 个工具：generate_brief / generate_layout / critique_pages / repair_page / answer_question）
- [x] **A7** SSE `/api/chat` Route Handler（`src/app/api/chat/route.ts`）+ chat-orchestrator（`src/lib/agents/chat-orchestrator.ts`）
- [x] **A7 验证**：第一轮空白 → 15 事件正确序列；第二轮 refine → 关键词意图分发到 repair_page + critique_pages
- [x] **A6b** Mock LLM fallback 按 `skill.output.artifact` 选择模板（canvas-pages / xhs-cards / landing-page）
- [x] **B1** tldraw 技术 spike：client-only dynamic wrapper，Next.js 下可稳定挂载
- [x] **B2** 自定义 Shape：CanvasPage / ImageAsset / ReferenceCard 已完成
- [x] **B3** 左侧 Chat Pane：流式消息、skill / design system 上下文、页面引用发送
- [x] **B4** 中间无限画布：project.pages → CanvasPage shape；project.assets → ImageAsset shape
- [x] **B5** 右侧 Artifact Tree：design/pages/project/critique/handoff 展示与下载入口
- [x] **B6** Comment Mode 页面级完成：选中 CanvasPage → Chat 消息带 `【引用页面: name#id】`
- [x] **B6b** Orchestrator 解析页面引用，强制路由 `targetPageId` / `focusPageId`
- [x] **C1** OpenAI-compatible ImageProvider（`/v1/images/generations`）+ MockImageProvider
- [x] **C1b** ProviderConfig.image 扩展 + Provider Settings Image 选项
- [x] **C2** ImageAsset schema + Project.assets 字段
- [x] **C2b** `/api/agents/image/generate` route
- [x] **C2c** ImagePane + RightPane tab 容器
- [x] **C3** ImageAsset 作为独立 tldraw shape util，支持空白画布落点与选中后 Enter 应用到最近 CanvasPage
- [x] **C4** 拖拽 ImageAsset → CanvasPage 转为 page 内 image node
- [x] **C5** Handoff metadata：model-runs.json + design/assets/* + image node generation metadata
- [x] **C-storage** project-store 从 localStorage 迁移到 IndexedDB；新增 `useProjectStoreHydrated`
- [x] **当前验证**：`pnpm exec tsc --noEmit` 通过；浏览器验证 3 个 CanvasPage + 4 个 ImageAsset shape，Enter 转换可用
- [x] **P1 验证**：ReferenceCard schema / shape / drag local image file → project.references[] 类型检查通过
- [x] **P1 验证**：tldraw 同步改为按业务 id diff / patch；`project.updatedAt` 不再触发画布 remount；类型检查通过
- [x] **P1 验证**：ProjectFile 增加 `canvasSnapshot`；tldraw store 变化 debounce 写回项目；重新打开项目时可恢复 shape records；类型检查通过
- [x] **P1 验证**：新增 `flow-arrow` shape；从 `project.prototype.pages` / page 顺序派生页面流程箭头；页面移动后 debounce 重算箭头位置；类型检查通过
- [x] **P1 验证**：Comment Mode 支持元素级引用；CanvasSvg 节点可点击选中；Chat 前缀携带 pageId/nodeId；Orchestrator 解析并传入 repair/answer 上下文；类型检查通过
- [x] **P2 验证**：Vision Critic 已接入；CanvasPage 可 rasterize 为 PNG data URL；OpenAI-compatible LLM 支持 image_url content block；Provider 设置支持开关；类型检查通过
- [x] **P2 验证**：RepairAgent 优先输出 RepairPatch（updatePage / updateNode / deleteNode）并在本地应用；patch 失败时 fallback 到旧整页修复；类型检查通过

## 尚未完善 / 下一步 backlog

### P0：技术债清理
- [x] 更新过期注释与文档，确保 roadmap 反映真实状态
- [x] 清理开发日志文件并补充 ignore 规则

### P1：画布体验
- [x] ReferenceCard shape：本地图片拖入画布后写入 `project.references[]`，并作为一等 tldraw shape 展示
- [x] tldraw 同步从全量 remount 改为细粒度 diff / patch
- [x] 持久化 tldraw canvas snapshot，保留用户手动排布、连线和标注
- [x] 页面流程箭头 / prototype flow
- [x] Comment Mode 从页面级升级到元素级（nodeId / elementId）

### P2：模型与生成质量
- [x] Vision Critic：用截图 + canvas json 做视觉评审
- [x] RepairAgent 从整页替换升级为 diff patch
- [ ] 每个 Skill 提供高质量 fallback 模板（尤其 xhs / landing）
- [ ] 更多 LLM / Image Provider：Claude、Gemini、DeepSeek、Qwen、Flux、Replicate 等
- [x] Provider health check（`/api/providers/health`）
- [x] timeout + retry（`src/lib/providers/retry.ts`、`fetch-with-retry.ts`）
- [ ] rate limit、错误可恢复提示（UI 级）

### P3：本地文件系统化
- [x] `.vad/projects/<id>` 文件系统持久化（`src/lib/vad/persist.ts`）
- [x] `chat-history.jsonl`、`prompts/critique-report.md`、`design/pages/*.canvas.json` 落盘
- [x] Artifact Tree 真实文件树 + 可编辑保存
- [x] Provider 健康检查 API（`/api/providers/health`）
- [ ] Provider API key 更安全的本地存储策略
- [x] Daemon 阶段 1：独立进程 + `VAD_DAEMON_URL` 转发（见 `docs/DAEMON.md`）
- [x] Daemon 阶段 2：SSE 文件 watch → IDE 热更新（`/api/projects/[id]/watch`）
- [ ] Daemon 阶段 3：客户端直连 / 系统服务

### P4：高级工作流
- [ ] 参考图再设计：上传、OCR、Layerization、布局/色彩/组件提取
- [ ] 小红书完整工作流：多图 PNG 导出、标题/正文/标签 artifact、carousel 节奏
- [ ] Slider 参数控制：风格强度、复杂度、页面数量、repair threshold
- [ ] Deck / Template skill 类型落地

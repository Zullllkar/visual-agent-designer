# Architecture（Vibeboard）

本地优先的可视化设计 Agent IDE：Next.js 16 + React 19 + tldraw + Zustand，项目与日志落盘 `.vad/projects/`，会话记忆落盘 `.vad-data/`。

## 运行时拓扑

```txt
Browser (Next.js App Router)
  ├─ 首页 BriefLauncher
  │     POST /api/agents/generate/stream  →  SSE: log | progress | final_project
  ├─ IDE /projects/[id]
  │     WebSocket /ws                     →  message.delta | tool.* | run.* | canvas.sync
  │     POST /api/chat（SSE 兼容层）       →  thinking | tool_* | pipeline_log | final_project
  │     GET  /api/projects/[id]/watch    →  SSE: .vad 文件热更新
  │     GET  /api/projects/[id]/pipeline-log
  └─ 可选 VAD_DAEMON_URL → 独立 Daemon（见 docs/DAEMON.md）

Next.js Custom Server (server.ts)
  ├─ WebSocket Server (ws/handler.ts)
  │     连接管理、命令分发、心跳、事件缓存（断线重连）
  ├─ AgentRunService
  │     生命周期：create/running/completed/failed/cancelled
  ├─ LangGraph ReAct Agent (langgraph-agent.ts)
  │     LLM 自主调用工具、streamEvents() 流式输出
  │     maxIterations=10、SqliteSaver checkpoint
  ├─ Tool Registry (tools/registry.ts)
  │     统一注册 + dispatch + fallback
  └─ Sub-Agent Registry (sub-agents/registry.ts)
        delegate_task 工具委派子任务

持久化
  ├─ IndexedDB（project-store、Zustand persist）
  ├─ .vad/projects/<id>/
  │     project.json, design/pages/*.canvas.json, pipeline-log.jsonl, chat-history.jsonl, …
  └─ .vad-data/
        checkpoints.sqlite（LangGraph SqliteSaver 会话记忆）
```

## Agent 架构（新）

### Chat 模式（正式运行时：LangGraph Agent）

```txt
用户消息 → WebSocket → LangGraph ReAct Agent
  → LLM 分析状态 → 决定调用工具 X
  → streamEvents 产出 message.delta
  → ToolRegistry.execute("X")
  → streamEvents 产出 tool.started / tool.completed
  → 结果回传 LLM → 决定下一步
  → 循环直到 LLM 说"完成"（maxIterations=10）
```

LangGraph Agent 是唯一正式的顶层协调器。固定设计流水线只作为 LLM
不可用时的内部 fallback；专业化 Agent Coordinator 只能通过
`delegate_task` 作为有边界的子任务执行，不再作为第二个产品入口。

一次用户请求建模为一个 Turn：

```txt
Turn
├── Agent Run
├── Tool Calls
└── Background Jobs
```

阶段状态统一为：Discovery → Brief → Direction → Asset Plan → Generation
→ Review → Refinement → Handoff。

### 一键生成模式（保留）

```txt
首页输入想法 → runDesignPipeline() 固定流水线 → SSE 返回
  Brief → Design Direction → Image Plan → Image Execute
```

### 四层回退策略

```txt
Layer 1: LLM 正常 → LangGraph ReAct Agent 自主调用工具
  ▼ LLM 超时 / 非法输出
Layer 2: 工具级回退 → tool.fallback() 启发式执行
  ▼ 工具 execute() 抛错
Layer 3: Agent 级回退 → decideToolsFallback() 规则引擎规划
  ▼ LLM 完全不可用
Layer 4: 流水线模式 → runDesignPipeline() 固定步骤
```

## 工具注册表

所有工具通过 `ToolRegistry` 统一管理：

- `generate_brief` / `plan_design_direction` / `generate_images`
- `generate_image_variants` / `restyle_images` / `export_handoff`
- `answer_question` / `inspect_canvas` / `manipulate_canvas`
- `star_asset` / `batch_delete_assets` / `delegate_task`

## Sub-Agent 系统

通过 `delegate_task` 工具，主 Agent 可委派子任务：

- **Image Generation Sub-Agent**：批量生图
- **Handoff Sub-Agent**：编译交付包

## 流式 UI

| 场景 | 组件 | 事件源 |
|------|------|--------|
| IDE 助理 | `ChatStreamView` + `ChatTimelineBody` | WebSocket /ws（SSE 回退） |
| 首页生成 | `BriefLauncher` + `ChatTimelineBody` | `/api/agents/generate/stream` |

共用 `buildChatTimeline()`：合并历史消息与 `liveEvents`。

- WebSocket 客户端：`useWsClient`（自动重连、事件回放、心跳保活）
- SSE 兼容层：`useChatStream`（WebSocket 优先，失败回退到 SSE）

## Provider 边界

- LLM：OpenAI-compatible、Anthropic、Gemini、DeepSeek（通过 LangChain ChatModel 集成）
- Image：OpenAI / Gemini / SiliconFlow / **Replicate**（Flux/SDXL）
- 编排：LangGraph ReAct Agent + Tool Registry

## 技术栈

| 维度 | 选型 |
|------|------|
| 框架 | Next.js 16 (custom server + WebSocket) |
| Agent | LangGraph ReAct Agent |
| LLM | LangChain ChatModel (OpenAI/Anthropic/Gemini) |
| 通信 | WebSocket (ws) + SSE 兼容层 |
| 会话记忆 | SqliteSaver (.vad-data/checkpoints.sqlite) |
| 画布 | tldraw 5.0 |
| 状态 | Zustand + persist |
| Lint | Biome |
| 测试 | Vitest |
| 包管理 | pnpm |

## 文档索引

- 重构方案：`docs/VAD_REFACTOR_PLAN.md`
- Daemon：`docs/DAEMON.md`
- 产品规格：`docs/PRODUCT_ARCHITECTURE_SPEC.md`

# Architecture（Visual Agent Designer）

本地优先的可视化设计 Agent IDE：Next.js 16 + React 19 + tldraw + Zustand，项目与日志落盘 `.vad/projects/`。

## 运行时拓扑

```txt
Browser (Next.js App Router)
  ├─ 首页 BriefLauncher
  │     POST /api/agents/generate/stream  →  SSE: log | progress | final_project
  ├─ IDE /projects/[id]
  │     POST /api/chat                    →  SSE: thinking | tool_* | pipeline_log | final_project
  │     GET  /api/projects/[id]/watch    →  SSE: .vad 文件热更新
  │     GET  /api/projects/[id]/pipeline-log
  └─ 可选 VAD_DAEMON_URL → 独立 Daemon（见 docs/DAEMON.md）

持久化
  ├─ IndexedDB（project-store、Zustand persist）
  └─ .vad/projects/<id>/
        project.json, design/pages/*.canvas.json, pipeline-log.jsonl, chat-history.jsonl, …
```

## Agent 流水线（设计主路径）

```txt
Brief → Architect → Design Direction → Layout（结构）
  → Content 润色 → Image Plan → Image Execute → Critic ↔ Repair
```

- **首页**：`generateProjectFromIdea` + `PipelineLogger`（source: `generate`）
- **IDE Chat**：`chat-orchestrator` 工具规划 + 顺序执行 + `PipelineLogger`（source: `chat`）
- **生图**：独立 Image Provider，不替代 Layout 结构

## 流式 UI（Cursor 风格）

| 场景 | 组件 | 事件源 |
|------|------|--------|
| IDE 助理 | `ChatStreamView` + `ChatTimelineBody` | `/api/chat` |
| 首页生成 | `BriefLauncher` + `ChatTimelineBody` | `/api/agents/generate/stream` |

共用 `buildChatTimeline()`：合并历史消息与 `liveEvents`（思考、工具、文件、`pipeline_log`、`code_diff`）。

- 编排规划：OpenAI-compatible / Anthropic 支持 `generateTextStream` 输出规划前言（40ms 轮询并入 SSE）
- 首页生成 SSE：`log` + `code_diff`（layout / repair 页面 JSON 预览）+ `progress`
- HTML 原型工具默认不出现在规划器；仅当用户明确提到 HTML/网页原型时启用
- Handoff 后写代码：`HandoffDialog` / Chat Handoff 卡片内 **一键复制 MCP** 或写入 `~/.claude.json`
- 编排规划流式：OpenAI-compatible、Anthropic、Gemini（`generateTextStream`）

## Provider 边界

- LLM：OpenAI-compatible、Anthropic、Gemini、DeepSeek、**Claude/Codex CLI**（`cli-adapter`）
- Image：OpenAI / Gemini / SiliconFlow 等（见 `src/lib/providers/registry.ts`）
- 编排：JSON 计划 + 工具调用；CLI 用于本地沙盒任务，HTML 原型为可选分支（非主路径）

## 文档索引

- 路线图：`docs/REBUILD_PLAN.md`
- Daemon：`docs/DAEMON.md`
- 产品规格：`docs/PRODUCT_ARCHITECTURE_SPEC.md`

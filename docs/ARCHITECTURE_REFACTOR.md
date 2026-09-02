# Vibeboard 架构重构方案：从固定流水线到 LLM 自主编排

> **版本**：v2.0 | **日期**：2026-07-11 | **状态**：待实施

---

## 1. 背景与动机

### 1.1 Vibeboard 现状架构

Vibeboard 当前采用**固定流水线 + 一次性工具规划**：

```
用户消息 → planOrchestratorTools() 一次性规划 → 顺序执行 switch-case → SSE 返回
```

核心流水线：`BriefAgent → DesignDirectorAgent → ImagePlannerAgent → ImageExecutorAgent`

**关键文件**：

| 文件 | 职责 |
|------|------|
| `src/lib/agents/chat-orchestrator.ts` (32KB) | Chat 核心：规划+执行+流式事件 |
| `src/lib/agents/orchestrator-planner.ts` (14KB) | LLM 工具规划 |
| `src/lib/agents/orchestrator-tools.ts` (3KB) | function calling 工具定义 |
| `src/lib/agents/design-pipeline.ts` (9KB) | 一键生成固定流水线 |
| `src/lib/agents/brief-agent.ts` 等 | 各 Agent 实现 |
| `src/app/api/chat/route.ts` | SSE 端点 |
| `src/lib/chat/use-chat-stream.ts` | 前端 SSE 客户端 |

### 1.2 Loomic 参考架构

Loomic 采用**单 DeepAgent + LLM 自主工具调用**：

```
WebSocket → AgentRunService → createLoomicDeepAgent() → Agent 自主循环 → streamEvents → WebSocket
```

| 文件 | 职责 |
|------|------|
| `Loomic/apps/server/src/ws/handler.ts` | WebSocket 连接+命令处理 |
| `Loomic/apps/server/src/agent/runtime.ts` | Agent 运行生命周期管理 |
| `Loomic/apps/server/src/agent/deep-agent.ts` | DeepAgent 创建 |
| `Loomic/apps/server/src/agent/stream-adapter.ts` | 事件适配 |
| `Loomic/apps/server/src/agent/tools/*.ts` | 各工具实现 |

### 1.3 市场标杆对比

| 产品 | Agent 架构 | 编排方式 | 通信协议 | 状态管理 |
|------|-----------|---------|---------|---------|
| Cursor | 单 Agent | LLM 自主 | SSE | 内存 |
| Devin | 单 Agent + deepagents | LLM 自主 | WebSocket | LangGraph checkpointer |
| Claude Code | 单 Agent | LLM 自主 | stdout | 内存 |
| Loomic | 单 Agent + deepagents | LLM 自主 | WebSocket | LangGraph + Supabase |
| **Vibeboard（现状）** | 固定流水线 | 代码硬编码 | SSE | 无 |

**所有优秀 Agent 项目都是「LLM 自主编排工具调用」，没有一个是固定流水线。**

### 1.4 Vibeboard 现状核心问题

| 问题 | 严重程度 |
|------|---------|
| 固定流水线，LLM 无法根据中间结果调整计划 | 高 |
| switch-case 工具分发，不可扩展 | 高 |
| SSE 单向通信，无法中途取消 | 高 |
| 无会话记忆，Agent 不记得上次决策 | 中 |
| 无 Agent 运行生命周期管理 | 中 |
| 6 个废弃 Agent 代码堆积 | 低 |
| 无 Sub-Agent 模式 | 低 |

---

## 2. 架构决策

### 2.1 为什么引入 LangGraph

| 能力 | 自己写 | LangGraph 内置 |
|------|--------|---------------|
| Agent 循环 | ~200 行 | `createReactAgent()` 一行 |
| 状态管理 + checkpoint | ~150 行 | `SqliteSaver` |
| 流式事件 | ~100 行 | `.streamEvents()` |
| 工具注册 + function calling | ~80 行 | `tool()` 装饰器 |
| Sub-Agent 委派 | ~120 行 | 嵌套 `createReactAgent` |
| 会话恢复 | ~100 行 | checkpointer 自动 |
| 人机协作 | ~80 行 | `interrupt()` |
| **总计** | **~830 行** | **~50 行调用** |

Vibeboard 用 `SqliteSaver`，零外部依赖，数据存本地 `.vad/checkpoints.db`。

**决策：引入 LangGraph。**

### 2.2 为什么不用 deepagents

| deepagents 能力 | Vibeboard 是否需要 | 原因 |
|----------------|-------------|------|
| 文件系统工具 | ❌ | Vibeboard 操作 Canvas JSON，不是文件系统 |
| 代码执行 | ❌ | Vibeboard 是设计工具，不是 coding agent |
| TODO 管理 | ✅ | Agent 可追踪设计任务进度 |
| Sub-Agent 委派 | ✅ | 批量生图、Handoff 编译可委派 |
| 状态持久化 | ✅ | 会话恢复 |

deepagents 核心价值（文件系统+代码执行）对 Vibeboard 无用。需要的部分可在 LangGraph 上自己实现。

**决策：用 LangGraph + 自建设计工具，不用 deepagents。**

### 2.3 为什么从 SSE 改为 WebSocket

| 能力 | SSE | WebSocket |
|------|-----|-----------|
| 中途取消 | ❌ | ✅ |
| 断线重连+事件回放 | ❌ | ✅（eventBuffer） |
| 多标签页同步 | ❌ | ✅（connectionManager 广播） |
| Agent 后台运行 | ❌ | ✅ |
| 双向通信 | ❌ | ✅ |

Vibeboard 图片生成 30-60 秒，用户可能刷新页面、想中途取消、开多个标签页。

**决策：改 WebSocket。**

### 2.4 最终架构定位

```
单 Agent + 工具调用（LangGraph ReAct 模式）
  ├─ 通信：WebSocket
  ├─ 框架：LangGraph
  ├─ 工具：自建设计工具注册表（每个工具有 fallback）
  ├─ 记忆：SqliteSaver（本地 SQLite）
  ├─ Sub-Agent：LangGraph 嵌套 ReAct
  └─ 不用 deepagents
```

与 Devin 最接近，但用自建工具替代 deepagents 的 coding 工具，且独有启发式回退。

---

## 3. 目标架构总览

### 3.1 架构全景图

```
┌─────────────────────────────────────────────────────┐
│  前端（React + Zustand）                              │
│   画布 UI │ Chat Pane │ 首页 │ Provider设置           │
│       └────────┬──────────────────────┘              │
│          WebSocket Client (chat-store)               │
└──────────────────┬──────────────────────────────────┘
                   │ WebSocket（双向）
┌──────────────────┼──────────────────────────────────┐
│  后端（Next.js）  ▼                                    │
│   ┌──────────────┐                                   │
│   │ WS Handler   │ 连接管理、认证、命令分发             │
│   └──────┬───────┘                                   │
│   ┌──────┴───────────┐                               │
│   │ AgentRunService  │ 生命周期：create/running/      │
│   │                  │ completed/failed/cancelled    │
│   └──────┬───────────┘                               │
│   ┌──────┴───────────┐                               │
│   │ LangGraph Agent  │ createReactAgent()            │
│   │                  │ LLM 自主决定调用工具            │
│   │                  │ .streamEvents() 流式输出       │
│   │                  │ SqliteSaver checkpoint         │
│   └──────┬───────────┘                               │
│   ┌──────┴───────────┐                               │
│   │ Tool Registry    │ 统一注册 + dispatch            │
│   │                  │ execute() + fallback()        │
│   └──────┬───────────┘                               │
│    ┌─────┼─────┬─────┬─────┐                         │
│    ▼     ▼     ▼     ▼     ▼                         │
│  Brief  Dir  Images  Handoff Canvas ...更多工具       │
│    │     │     │      │      │                       │
│    ▼     ▼     ▼      ▼      ▼                       │
│   Provider 层（不变）+ 本地存储（不变）                 │
└──────────────────────────────────────────────────────┘
```

### 3.2 核心数据流

**Chat 模式（新架构）**：

```
1. 用户输入消息 → WebSocket 发送 { action: "agent.run", prompt, projectId, threadId }
2. WS Handler → AgentRunService.createRun() → 生成 runId
3. AgentRunService 启动 LangGraph Agent
4. Agent 循环：
   a. LLM 分析状态 → 决定调用工具 X
   b. streamEvents → 适配为 message.delta
   c. streamEvents → 适配为 tool.started
   d. ToolRegistry.execute("X") → 返回结果
   e. streamEvents → 适配为 tool.completed
   f. 结果回传 LLM → 决定下一步
   g. 循环直到 LLM 说"完成"
5. 事件通过 WebSocket 实时推送
6. SqliteSaver 保存 checkpoint
```

**一键生成模式（保留不变）**：仍走 `orchestrator.ts → runDesignPipeline()`

---

## 4. 详细设计

### 4.1 工具注册表系统

替换 `chat-orchestrator.ts` 中 390 行 switch-case。

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
  summary: string;
  updatedProject?: ProjectFile | null;
  output?: Record<string, unknown>;  // 给 LLM 看的结构化输出
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;  // JSON Schema
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
  fallback?(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}
```

**注册表**：

```typescript
// src/lib/agents/tools/registry.ts

class ToolRegistry {
  private tools = new Map<string, AgentTool>();
  register(tool: AgentTool) { this.tools.set(tool.name, tool); }
  get(name: string) { return this.tools.get(name); }
  list() { return [...this.tools.values()]; }
  toToolDefinitions(): LlmToolDefinition[] {
    return this.list().map(t => ({ name: t.name, description: t.description, parameters: t.parameters }));
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
  async fallback(args, ctx) { return this.execute(args, ctx); },  // BriefAgent 内部已有回退
};
```

### 4.2 LangGraph ReAct Agent

```typescript
// src/lib/agents/langgraph-agent.ts

import { createReactAgent } from "@langchain/langgraph/prebuilt";

export function createVadAgent(options: CreateAgentOptions) {
  const llm = createChatModel(options.providerConfig);  // 转换为 LangChain ChatModel
  const tools = toolRegistry.list().map(agentTool =>
    tool(async (args) => {
      const result = await toolRegistry.execute(agentTool.name, args, ctx);
      return JSON.stringify(result.output ?? result.summary);
    }, { name: agentTool.name, description: agentTool.description, schema: agentTool.parameters })
  );
  return createReactAgent({ llm, tools, prompt: buildSystemPrompt(project, agentCtx), checkpointer });
}
```

### 4.3 AgentRunService

```typescript
// src/lib/agents/agent-run-service.ts

class AgentRunService {
  private runs = new Map<string, AgentRun>();
  private abortControllers = new Map<string, AbortController>();

  createRun(input): AgentRun { /* 生成 runId，初始化状态 */ }
  async *streamRun(runId, input): AsyncGenerator<WsEvent> {
    const agent = createVadAgent({ ... });
    const stream = agent.streamEvents({ messages: [...] }, { version: "v2", configurable: { thread_id }, signal });
    for await (const event of adaptStreamEvents(stream, runId)) yield event;
  }
  cancel(runId) { this.abortControllers.get(runId)?.abort(); }
}
```

### 4.4 WebSocket 通信层

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
    "canvas.sync", "project.update", "run.completed", "run.failed", "run.cancelled", "error"]),
  data: z.unknown(),
});
```

**Handler 核心**：

```typescript
// src/lib/ws/handler.ts
export function attachWebSocketServer(server: Server) {
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
}
```

### 4.5 会话记忆

```typescript
// src/lib/agents/checkpointer.ts
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";

export async function getCheckpointer(): Promise<SqliteSaver> {
  const dir = ensureDir("checkpoints");
  return await SqliteSaver.fromConnString(path.join(dir, "checkpoints.db"));
}
```

### 4.6 Sub-Agent 模式

```typescript
// src/lib/agents/sub-agents/types.ts
export interface SubAgentDef {
  name: string;
  description: string;
  systemPrompt: string;
  allowedTools: string[];
}

// delegate_task 工具：主 Agent 用它委派子任务
export function createDelegateTaskTool(subAgents: Map<string, SubAgentDef>): AgentTool {
  return {
    name: "delegate_task",
    description: "将复杂子任务委派给专门的子 Agent",
    parameters: { type: "object", properties: { subAgent: { type: "string", enum: [...] }, instruction: { type: "string" } }, required: ["subAgent", "instruction"] },
    async execute(args, ctx) { /* 创建子 Agent 循环 */ },
  };
}
```

### 4.7 启发式回退策略

```
Layer 1: LLM 正常 → LangGraph ReAct Agent 自主调用工具
  │  LLM 超时 / 非法 JSON / 不支持 function calling
  ▼
Layer 2: 工具级回退 → tool.fallback() 启发式执行
  │  工具 execute() 抛错
  ▼
Layer 3: Agent 级回退 → decideToolsFallback() 规则引擎规划
  │  LLM 完全不可用
  ▼
Layer 4: 流水线模式 → runDesignPipeline() 固定步骤
```

### 4.8 事件流适配

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

### 4.9 系统提示词

```typescript
// src/lib/agents/system-prompt.ts
export function buildSystemPrompt(project, agentCtx): string {
  return [
    "你是 Vibeboard，专业的 AI 视觉设计助手。",
    "通过调用工具完成任务，每次只调一个工具，等结果再决定下一步。",
    `## 当前项目状态\n${formatProjectState(project)}`,
    `## 可用工具\n${toolRegistry.list().map(t => `- ${t.name}: ${t.description}`).join("\n")}`,
    agentCtx.skill?.markdown ? `## 设计技能\n${agentCtx.skill.markdown}` : "",
  ].filter(Boolean).join("\n\n---\n\n");
}
```

---

## 5. 完整文件变更清单

### 5.1 新增文件（27 个）

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
| 8 | `src/lib/agents/tools/export-handoff.ts` | Handoff 工具 |
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

### 5.2 修改文件（11 个）

| # | 文件 | 改动 | 量级 |
|---|------|------|------|
| 1 | `src/lib/agents/chat-orchestrator.ts` | 删除 `runTool()` switch-case，`runChatTurn()` 改为调用 `agentRuns.streamRun()` | 大改 ~400行删 |
| 2 | `src/lib/agents/orchestrator-planner.ts` | `planOrchestratorTools()` 标记 deprecated，保留 `decideToolsFallback()` | 中改 ~200行删 |
| 3 | `src/lib/agents/types.ts` | AgentContext 增加 threadId/checkpointer/abortSignal | 小改 ~10行 |
| 4 | `src/lib/agents/chat-schema.ts` | 新增 WebSocket 事件类型 | 中改 ~40行 |
| 5 | `src/lib/agents/plan-schema.ts` | 增加新工具名枚举 | 小改 ~3行 |
| 6 | `src/lib/vad/paths.ts` | 增加 `checkpointsDir()` | 小改 ~5行 |
| 7 | `src/store/chat-store.ts` | SSE→WebSocket 客户端，增加重连 | 大改 ~80行 |
| 8 | `src/lib/chat/use-chat-stream.ts` | EventSource→WebSocket 或废弃 | 大改 ~50行 |
| 9 | `src/app/api/chat/route.ts` | 改为兼容层或废弃 | 小改 ~20行 |
| 10 | `package.json` | 增加 LangGraph+ws 依赖 | 小改 ~6行 |
| 11 | `next.config.ts` | 配置自定义 server 支持 WebSocket | 小改 ~10行 |

### 5.3 废弃/删除文件（12 个）

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

### 5.4 保留不动的文件

| 文件 | 保留原因 |
|------|---------|
| `src/lib/agents/design-pipeline.ts` | 一键生成模式仍走固定流水线 |
| `src/lib/agents/orchestrator.ts` | 一键生成入口不变 |
| `src/lib/agents/brief-agent.ts` | 被工具模块内部调用 |
| `src/lib/agents/design-director-agent.ts` | 被工具模块内部调用 |
| `src/lib/agents/image-planner-agent.ts` | 被工具模块内部调用 |
| `src/lib/agents/image-executor-agent.ts` | 被工具模块内部调用 |
| `src/lib/agents/handoff-agent.ts` | 被工具模块内部调用 |
| `src/lib/agents/pending-assets.ts` | 被工具模块内部调用 |
| `src/lib/agents/pipeline-logger.ts` | 日志系统不变 |
| `src/lib/agents/chat-pipeline-log.ts` | 日志系统不变 |
| `src/lib/providers/*` | Provider 层完全不变 |
| `src/lib/project/*` | Project schema 不变 |
| `src/lib/canvas/*` | Canvas 渲染层不变 |
| `src/lib/handoff/*` | Handoff 逻辑不变 |
| `src/lib/skills/*` | Skills 系统不变 |
| `src/lib/vad/persist.ts` | 本地持久化不变 |
| 所有前端组件 | 仅 chat-store 和 use-chat-stream 改动 |

### 5.5 新增依赖

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
    "@types/ws": "^8.x"
  }
}
```

---

## 6. 实施计划

### 6.1 阶段总览

```
阶段 1：工具注册表          ← 基础设施，无行为变化
  │   新增 12 文件，修改 2 文件 | 风险：低
  ▼
阶段 2：LangGraph + WebSocket  ← 核心架构变更
  │   新增 8 文件，修改 5 文件 | 风险：中
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

### 6.2 阶段 1：工具注册表

**目标**：建立工具注册表，将 switch-case 逻辑抽取为独立工具模块。

**步骤**：
1. 创建 `tools/types.ts` — 定义 AgentTool / ToolContext / ToolResult
2. 创建 `tools/registry.ts` — 实现 ToolRegistry
3. 逐个创建 9 个工具模块（generate-brief、plan-design-direction、generate-images、generate-image-variants、restyle-images、export-handoff、answer-question、inspect-canvas、manipulate-canvas）
4. 创建 `tools/index.ts` — 统一注册
5. 修改 `chat-orchestrator.ts` — `runTool()` 改为 `toolRegistry.execute()`
6. 修改 `orchestrator-tools.ts` — 工具定义从 registry 获取

**验收**：所有现有 Chat 功能行为不变，新增工具可通过 `register()` 注册。

### 6.3 阶段 2：LangGraph Agent + WebSocket

**目标**：用 LangGraph ReAct Agent 替换一次性规划，用 WebSocket 替换 SSE。

**步骤**：
1. 安装依赖（LangGraph + ws）
2. 创建 `langgraph-agent.ts` — `createVadAgent()`
3. 创建 `agent-run-service.ts` — AgentRunService
4. 创建 `stream-adapter.ts` — 事件适配
5. 创建 `system-prompt.ts` — 提示词构建
6. 创建 `agent-loop-fallback.ts` — 回退循环
7. 创建 `ws/types.ts` — 消息 schema
8. 创建 `ws/handler.ts` — WebSocket 处理器
9. 创建 `ws/event-buffer.ts` — 事件缓存
10. 创建 `ws/server.ts` — 服务器初始化
11. 创建 `use-ws-client.ts` — 前端 WebSocket Hook
12. 修改 `chat-store.ts` — SSE→WebSocket
13. 修改 `chat-orchestrator.ts` — 调用 `agentRuns.streamRun()`
14. 修改 `next.config.ts` — 自定义 server
15. 修改 `api/chat/route.ts` — 兼容层

**验收**：
- 用户发消息 → WebSocket → Agent 自主调用工具 → 流式返回
- 可中途取消（`agent.cancel`）
- 刷新页面后重连，可看到事件回放
- LLM 不可用时自动回退到规则引擎
- 多标签页同步

### 6.4 阶段 3：会话记忆

**目标**：用 SqliteSaver 实现跨会话记忆。

**步骤**：
1. 创建 `checkpointer.ts` — SqliteSaver 初始化
2. 创建 `session-memory.ts` — 会话管理
3. 修改 `types.ts` — AgentContext 增加 threadId/checkpointer
4. 修改 `paths.ts` — 增加 checkpointsDir()
5. 修改 `chat-store.ts` — threadId 管理

**验收**：关闭再打开同一项目，Agent 记住上次对话上下文。

### 6.5 阶段 4：Sub-Agent

**目标**：支持主 Agent 委派子任务。

**步骤**：
1. 创建 `sub-agents/types.ts` — SubAgentDef 接口
2. 创建 `sub-agents/image-batch-agent.ts` — 批量生图
3. 创建 `sub-agents/index.ts` — 注册 + delegate_task 工具
4. 修改 `tools/index.ts` — 注册 delegate_task

**验收**：主 Agent 可通过 `delegate_task` 委派批量生图任务。

### 6.6 阶段 5：画布交互工具

**目标**：填充 inspect-canvas 和 manipulate-canvas 的完整实现。

**步骤**：
1. 完善 `tools/inspect-canvas.ts` — 返回画布元素列表+状态
2. 完善 `tools/manipulate-canvas.ts` — move/delete/reorder/tag 操作

**验收**：用户说"把这张图移到左边"，Agent 调用 manipulate_canvas 完成。

### 6.7 阶段 6：清理废弃代码

**目标**：删除 12 个废弃文件，清理技术债。

**步骤**：
1. 全局搜索确认无引用
2. 逐个删除 12 个文件
3. 运行 `pnpm build` 确认无编译错误

---

## 7. 风险与应对

| 风险 | 概率 | 影响 | 应对 |
|------|------|------|------|
| LangGraph 版本变更导致 API breaking | 中 | 中 | 锁定版本，升级前测试 |
| WebSocket 在 Next.js 中的集成复杂 | 中 | 高 | 使用 custom server 模式，参考 Loomic 实现 |
| LLM 循环不终止 | 低 | 高 | 设置 maxIterations=10，超过强制退出 |
| SqliteSaver 在 Windows 路径问题 | 低 | 中 | 使用 path.join()，测试 Windows 路径 |
| 前端从 SSE 到 WebSocket 迁移引入 bug | 中 | 中 | 保留 SSE 兼容层，渐进迁移 |
| LangChain 依赖体积过大 | 中 | 低 | 按需安装，tree-shaking |

---

## 8. 验收标准

### 功能验收

- [ ] 用户发消息 → Agent 自主决定调用工具序列（不再固定）
- [ ] 工具执行结果影响 Agent 下一步决策
- [ ] 用户可中途取消 Agent 运行
- [ ] 用户刷新页面后重连，可看到已生成的事件回放
- [ ] 多标签页打开同一项目，一个触发生成，另一个实时看到更新
- [ ] LLM 不可用时自动回退到规则引擎，功能不中断
- [ ] 关闭再打开项目，Agent 记住上次对话上下文
- [ ] 一键生成模式（首页 BriefLauncher）行为不变
- [ ] Handoff 导出功能正常
- [ ] 所有 Provider（OpenAI/Claude/Gemini/DeepSeek）正常工作

### 技术验收

- [ ] `pnpm build` 无编译错误
- [ ] `pnpm lint` 无 lint 错误
- [ ] 工具注册表可通过 `register()` 扩展新工具
- [ ] `toolRegistry.toToolDefinitions()` 输出正确 function calling 格式
- [ ] SqliteSaver checkpoint 文件正确创建在 `.vad/checkpoints/`
- [ ] WebSocket 心跳正常（30s ping）
- [ ] 事件缓存正确回放

### 性能验收

- [ ] Agent 首次响应延迟 < 3 秒
- [ ] 图片生成事件实时推送延迟 < 500ms
- [ ] WebSocket 连接建立时间 < 1 秒
- [ ] 断线重连回放时间 < 2 秒

---

## 9. 技术栈对比与选型

### 9.1 全栈对比总表

| 维度 | Vibeboard（现状） | Loomic | 市场主流（Cursor/Devin/Claude Code） |
|------|------------|--------|--------------------------------------|
| **项目结构** | 单体 Next.js | Monorepo（Turborepo + pnpm workspace） | 单体或轻量 monorepo |
| **前端框架** | Next.js 16 | Next.js 15（web 独立 app） | Next.js / Electron |
| **后端框架** | Next.js API Routes（内置） | Fastify 5（独立 Node 进程） | 自研 / Fastify / Hono |
| **画布技术** | tldraw 5.0 | Excalidraw 0.18 | 自研 |
| **UI 组件库** | Lucide React + TailwindCSS 4 | Base UI + shadcn + TailwindCSS 4 + Framer Motion | shadcn + Tailwind |
| **状态管理** | Zustand 5 | React hooks + Supabase 实时 | Zustand / Jotai |
| **通信协议** | SSE | WebSocket（@fastify/websocket） | SSE 或 WebSocket |
| **Agent 框架** | 自研（固定流水线 + switch-case） | LangGraph 1.2 + deepagents 1.8 | LangGraph / 自研 |
| **LLM 集成** | 自研 Provider 抽象层 | LangChain（@langchain/openai、google-genai、google-vertexai） | LangChain / 自研 |
| **LLM Provider** | OpenAI-compatible / Anthropic / Gemini / DeepSeek | OpenAI / Google Gemini / Google Vertex AI | 多家 |
| **图像生成** | OpenAI-compatible / SiliconFlow / Gemini Image | Replicate（13+ 模型）/ Google Imagen / OpenAI / Volces | 多家 |
| **视频生成** | 无 | Google Veo 3.1 / Replicate（Kling 等） | — |
| **数据库** | 无（本地文件系统） | Supabase（PostgreSQL 17） | — |
| **认证** | 无 | Supabase Auth（JWT + jose 验证） | — |
| **存储** | 本地文件系统 `.vad/` | Supabase Storage（S3 兼容） | — |
| **状态持久化** | 无 | LangGraph PostgresCheckpointer | — |
| **异步队列** | 无 | PGMQ（PostgreSQL 消息队列） | — |
| **Worker 进程** | 无 | 独立 Worker 进程（image + video + code execution） | — |
| **支付/计费** | 无 | LemonSqueezy + 积分系统 | — |
| **Lint/Format** | ESLint 9 + eslint-config-next | Biome（统一 lint + format） | ESLint 或 Biome |
| **测试** | 无 | Vitest 3 | Vitest / Jest |
| **构建工具** | Next.js 内置 | Turborepo（增量构建 + 缓存） | — |
| **部署** | 本地 / Vercel | Web → Vercel，Server → Railway（Docker） | — |
| **包管理** | pnpm | pnpm（workspace 模式） | pnpm |
| **TypeScript** | TS 5 | TS 5.7 | TS 5 |
| **图像处理** | @resvg/resvg-js（SVG→PNG） | Sharp（图像处理） | Sharp |
| **代理支持** | 无 | global-agent + undici ProxyAgent | — |

### 9.2 逐层分析

#### 9.2.1 项目结构

**Vibeboard：单体应用**

```
vibeboard/
  src/
    app/          # Next.js 路由 + API
    components/   # 前端组件
    lib/          # 核心逻辑（agents、providers、canvas...）
    store/        # Zustand 状态
  package.json    # 单一 package
```

**Loomic：Turborepo Monorepo**

```
Loomic/
  apps/
    server/       # Fastify 后端（独立进程）
    web/          # Next.js 前端（独立部署）
  packages/
    shared/       # 共享类型 + Zod schema
    ui/           # 共享 UI 组件库
    config/       # 共享配置
  supabase/       # 数据库迁移
  turbo.json      # 构建编排
```

| 点 | Vibeboard 单体 | Loomic Monorepo |
|----|---------|-----------------|
| 开发体验 | 简单，一个 `pnpm dev` 全跑 | 复杂，需同时启动 server + web |
| 代码隔离 | 前后端混在一起 | 前后端完全分离，可独立部署 |
| 共享类型 | 直接 import | 通过 `@loomic/shared` 包 |
| 构建速度 | 快（单一构建） | Turborepo 增量构建 + 缓存 |
| 适合场景 | 本地工具 | SaaS 产品 |

**结论：Vibeboard 保持单体结构。** 本地优先工具不需要 Monorepo 的复杂度。如果后续加独立 Worker 进程再考虑拆分。

#### 9.2.2 后端框架

**Vibeboard：Next.js API Routes**
- 所有 API 都是 `/api/*` 路由
- 无独立后端进程
- WebSocket 支持需要 custom server

**Loomic：Fastify 5（独立进程）**
- 独立 Node.js 服务器，端口 3001
- 原生支持 WebSocket（@fastify/websocket）
- 原生支持 multipart 文件上传（@fastify/multipart）
- 插件系统，20+ 路由模块独立注册
- 内置日志（pino）
- 前端 Vercel + 后端 Railway 分离部署

| 点 | Next.js API Routes | Fastify 独立 |
|----|-------------------|-------------|
| WebSocket | 需 custom server | 原生插件 |
| 性能 | 中（Next.js 封装层） | 高（裸 Node.js） |
| 部署灵活性 | Vercel 限定 | 任意平台 |
| 开发体验 | 简单 | 需维护两个进程 |
| 文件上传 | 手写 | @fastify/multipart |
| 路由组织 | 文件系统路由 | 手动注册（更灵活） |

**关键问题**：Vibeboard 要改 WebSocket，Next.js API Routes 原生不支持。两条路：

1. **Next.js custom server**：挂载 WebSocket 到 Next.js 的 HTTP server，保持单体结构
2. **拆分 Fastify 后端**：像 Loomic 一样独立后端，但增加 Monorepo 复杂度

**结论：用 Next.js custom server。** Vibeboard 是本地工具，不需要 Vercel 部署，custom server 完全可行且改动最小。

```typescript
// server.ts（新增，替代 next dev）
import { createServer } from "node:http";
import next from "next";
import { WebSocketServer } from "ws";
import { attachWebSocketHandler } from "./src/lib/ws/server";

const app = next({ dev: process.env.NODE_ENV !== "production" });
const handler = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer(handler);
  attachWebSocketHandler(server);  // 挂载 /ws 路径

  server.listen(3000, () => {
    console.log("> Ready on http://localhost:3000");
  });
});
```

`package.json` scripts 修改：
```json
{
  "scripts": {
    "dev": "tsx server.ts",
    "build": "next build",
    "start": "tsx server.ts"
  }
}
```

#### 9.2.3 画布技术

| 点 | tldraw 5.0（Vibeboard） | Excalidraw 0.18（Loomic） |
|----|-------------------|--------------------------|
| 节点类型 | 丰富（形状、文本、图片、箭头、embed） | 较少（手绘风格） |
| 序列化 | 完整 JSON schema | 简单 JSON |
| 社区 | 活跃，MIT 协议 | 活跃，MIT 协议 |
| 适合场景 | 专业设计工具 | 白板/草图 |

**结论：保留 tldraw。** 比 Excalidraw 更适合设计工具，不需要换。

#### 9.2.4 Agent 框架

已在第 2 章详细论证。**结论：引入 LangGraph，不用 deepagents。**

#### 9.2.5 LLM Provider 集成

**Vibeboard 自研 Provider 抽象**：

```
src/lib/providers/llm/
  openai-compatible.ts   # OpenAI 兼容（含 DeepSeek）
  anthropic.ts           # Claude
  gemini.ts              # Gemini
  mock.ts                # Mock
```

统一接口：`generateText()` / `generateTextStream()` / `generateWithTools()`

**Loomic LangChain ChatModel**：

```
@langchain/openai           # ChatOpenAI
@langchain/google-genai     # ChatGoogleGenerativeAI
@langchain/google-vertexai  # ChatVertexAI
```

| 点 | Vibeboard 自研 | Loomic LangChain |
|----|---------|-----------------|
| 控制力 | 完全可控 | 受框架约束 |
| 维护成本 | 高（自己维护 API 变更） | 低（社区维护） |
| Provider 数量 | 4（含 DeepSeek） | 3（无 DeepSeek） |
| tool calling | 自己实现 | 内置 |
| streaming | 自己实现 | 内置 |
| vision | 自己实现 | 内置 |
| 新 Provider | 需自己写适配 | 社区提供 |

**结论：切换到 LangChain ChatModel 作为主 LLM 集成，保留自研 Provider 作为 DeepSeek fallback。**

LangChain 不原生支持 DeepSeek，但 DeepSeek 是 OpenAI-compatible 的，可以用 `ChatOpenAI` 配置 `baseURL: "https://api.deepseek.com/v1"` 来兼容。因此自研 Provider 层可以完全废弃。

```typescript
// 新的 LLM 创建逻辑（langgraph-agent.ts）
function createChatModel(config: ProviderConfig) {
  if (!config.llm || config.llm.kind === "mock") {
    throw new Error("Real LLM provider required");
  }

  if (config.llm.kind === "openai-compatible" || config.llm.kind === "deepseek") {
    const baseURL = config.llm.kind === "deepseek"
      ? "https://api.deepseek.com/v1"
      : config.llm.baseURL;
    return new ChatOpenAI({
      apiKey: config.llm.apiKey,
      baseURL,
      modelName: config.llm.model,
      streaming: true,
    });
  }

  if (config.llm.kind === "anthropic") {
    return new ChatAnthropic({
      apiKey: config.llm.apiKey,
      modelName: config.llm.model,
    });
  }

  if (config.llm.kind === "gemini") {
    return new ChatGoogleGenerativeAI({
      apiKey: config.llm.apiKey,
      modelName: config.llm.model,
    });
  }

  throw new Error(`Unsupported LLM provider: ${config.llm.kind}`);
}
```

#### 9.2.6 图像/视频生成

**Vibeboard：3 个 Provider**
- OpenAI-compatible（DALL-E / SiliconFlow / 任意 OpenAI 兼容端点）
- Gemini Image
- Mock

**Loomic：10+ Provider**
- Replicate（Flux、SDXL、Recraft、Seedream、Kling 等 13+ 模型）
- Google Imagen
- Google Vertex AI Image
- OpenAI DALL-E / GPT Image
- Volces（字节跳动）
- Google Veo 3.1（视频）
- Replicate 视频（Kling 等）

**结论：保留 Vibeboard 的 OpenAI-compatible 抽象（最灵活的设计），新增 Replicate Provider。**

Replicate 接入可以参考 Loomic 的 `Loomic/apps/server/src/generation/providers/replicate-image.ts` 实现。

新增文件：
- `src/lib/providers/image/replicate.ts` — Replicate 图像生成 Provider

新增依赖：
```json
{
  "dependencies": {
    "replicate": "^1.x"
  }
}
```

视频生成暂不加入，当 Vibeboard 需要时再参考 Loomic 实现。

#### 9.2.7 数据持久化

**Vibeboard：本地文件系统**

```
.vad/
  projects/          # 项目 JSON 文件
  handoffs/          # 导出的 Handoff 包
  pipeline-logs/     # 日志
```

**Loomic：Supabase（PostgreSQL 17 + Storage + Auth + PGMQ）**

29 个 SQL migrations，覆盖：用户、项目、画布、聊天、积分、支付、品牌套件、技能管理、后台任务等。

| 点 | Vibeboard 本地文件 | Loomic Supabase |
|----|-------------|-----------------|
| 零依赖 | ✅ | ❌ 需 Supabase 账号 |
| 多用户 | ❌ | ✅ |
| 并发安全 | ❌（文件锁） | ✅（行级锁） |
| 查询能力 | 弱（全量扫描） | 强（SQL） |
| 离线可用 | ✅ | ❌ |
| 部署成本 | 免费 | Supabase 免费层起步 |
| 适合场景 | 本地工具 | SaaS |

**结论：不引入 Supabase。** Vibeboard 作为本地优先工具不需要云数据库。用 SQLite 替代文件系统解决会话记忆问题：

| 用途 | Vibeboard 方案 | Loomic 方案 |
|------|---------|------------|
| 项目存储 | 本地 JSON 文件（不变） | Supabase PostgreSQL |
| 会话记忆 | **SqliteSaver**（`.vad/checkpoints.db`） | PostgresCheckpointer |
| 图片存储 | 本地文件（不变） | Supabase Storage |
| 异步队列 | Node.js 内置队列（如果需要） | PGMQ |
| 用户认证 | 不需要 | Supabase Auth |

#### 9.2.8 通信协议

已在第 2.3 节详细论证。**结论：从 SSE 改 WebSocket。**

通过 Next.js custom server 挂载，不需要拆分 Fastify。

#### 9.2.9 开发工具链

| 点 | Vibeboard（现状） | Loomic | 建议 |
|----|------------|--------|------|
| Lint | ESLint 9 | Biome | **换 Biome** — 更快，零配置，统一 lint+format |
| 测试 | 无 | Vitest 3 | **加 Vitest** — Agent 循环、工具执行必须有测试 |
| 构建 | Next.js 内置 | Turborepo | 不需要（单体够用） |
| 类型检查 | tsc | tsc + turbo 缓存 | 不变 |

**Biome 迁移**：

```json
// biome.json（新增）
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "files": {
    "ignore": ["**/node_modules/**", "**/.next/**", "**/dist/**"]
  },
  "formatter": { "enabled": true, "indentStyle": "space" },
  "linter": { "enabled": true, "rules": { "recommended": true } }
}
```

```json
// package.json 修改
{
  "scripts": {
    "lint": "biome check .",
    "format": "biome format . --write"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.4"
  }
}
```

删除 `eslint.config.mjs` 和 `eslint-config-next` 依赖。

**Vitest 添加**：

```json
// package.json 修改
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "vitest": "^3.0.7",
    "@testing-library/react": "^16.2.0",
    "@testing-library/jest-dom": "^6.6.3"
  }
}
```

新增测试文件：
- `src/lib/agents/tools/registry.test.ts` — 工具注册表测试
- `src/lib/agents/agent-loop.test.ts` — Agent 循环测试
- `src/lib/ws/handler.test.ts` — WebSocket 处理器测试

### 9.3 决策汇总

#### 应该换

| 项目 | 现状 | 换成 | 优先级 | 原因 |
|------|------|------|--------|------|
| Agent 框架 | 自研流水线 | LangGraph | 高 | 行业标准，省 800+ 行代码 |
| 通信协议 | SSE | WebSocket | 高 | 支持取消/重连/多标签 |
| LLM 集成 | 自研 Provider | LangChain ChatModel | 高 | 与 LangGraph 配套，减少维护 |
| 状态持久化 | 无 | SqliteSaver | 高 | 会话记忆 |
| Lint | ESLint | Biome | 中 | 更快，零配置 |
| 测试 | 无 | Vitest | 中 | Agent 循环必须有测试 |
| 图像 Provider | 3 个 | 新增 Replicate | 中 | Flux/SDXL 等高质量模型 |

#### 不应该换

| 项目 | 现状 | 原因 |
|------|------|------|
| 项目结构 | 单体 Next.js | 本地工具不需要 Monorepo |
| 后端框架 | Next.js | 用 custom server 挂 WebSocket 即可 |
| 画布 | tldraw 5.0 | 比 Excalidraw 更适合设计工具 |
| 数据库 | 本地文件 | 不需要 Supabase，用 SQLite 替代 |
| 认证 | 无 | 本地工具不需要 |
| 支付 | 无 | 本地工具不需要 |
| 异步队列 | 无 | 暂不需要 PGMQ，Node.js 内置队列够用 |
| UI 组件 | Lucide + Tailwind | 已经够好 |
| 状态管理 | Zustand | 已经够好 |
| 包管理 | pnpm | 不变 |
| 图像处理 | @resvg/resvg-js | SVG→PNG 够用 |

#### 可选增强（未来）

| 项目 | 说明 | 时机 |
|------|------|------|
| 视频生成 | 参考 Loomic 的 Replicate/Google Video | 当 Vibeboard 需要视频时 |
| Worker 进程 | 独立进程处理耗时任务 | 当加视频生成时 |
| Sharp | 替代 @resvg/resvg-js，更全面的图像处理 | 当需要缩略图/压缩时 |
| Framer Motion | 增强前端动画 | 当 UI 需要复杂动画时 |
| Monorepo | 拆分 apps/web + apps/server | 当需要独立部署后端时 |

### 9.4 对架构文档的影响

基于技术栈选型，对第 5 章文件变更清单的修正：

**新增依赖更新**：

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

**删除依赖**：
- `eslint`、`eslint-config-next` — 被 Biome 替代

**新增文件补充**：

| # | 文件路径 | 说明 |
|---|---------|------|
| 28 | `server.ts` | Next.js custom server（挂载 WebSocket） |
| 29 | `src/lib/providers/image/replicate.ts` | Replicate 图像生成 Provider |
| 30 | `biome.json` | Biome 配置 |
| 31 | `vitest.config.ts` | Vitest 配置 |
| 32 | `src/lib/agents/tools/registry.test.ts` | 工具注册表测试 |
| 33 | `src/lib/agents/agent-loop.test.ts` | Agent 循环测试 |
| 34 | `src/lib/ws/handler.test.ts` | WebSocket 处理器测试 |

**修改文件补充**：

| # | 文件 | 改动 |
|---|------|------|
| 12 | `package.json` | 增加 LangGraph + ws + replicate + biome + vitest 依赖，删除 eslint，修改 scripts |
| 13 | `eslint.config.mjs` | 删除 |

**关键架构决策修正**：

| 原方案 | 修正后 |
|--------|--------|
| WebSocket via 独立 `ws` 库 | ✅ 通过 Next.js **custom server** 挂载 |
| 不拆 Monorepo | ✅ 确认保持单体 |
| 不引入 Fastify | ✅ 确认用 Next.js custom server |
| 不引入 Supabase | ✅ 确认用 SQLite |
| 自研 LLM Provider 全废弃 | **修正：DeepSeek 用 ChatOpenAI + baseURL 兼容，自研 Provider 全废弃** |
| 不新增 Replicate | **修正：新增 Replicate Provider** |
| 不换 Lint | **修正：ESLint → Biome** |
| 不加测试 | **修正：新增 Vitest** |

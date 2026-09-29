# Phase 2: 工具并行执行 + 智能确认机制

## 目标

Phase 2 将解决两个核心问题：
1. **工具串行执行慢**：当前工具顺序执行，生成 5 张图需要 150 秒
2. **确认机制中断推理**：工具确认需要 LangGraph interrupt，破坏 ReAct 推理链

## 问题分析

### 问题 1：串行执行瓶颈

**当前代码**：
```typescript
// chat-orchestrator.ts
for await (const event of runCalls(decision.calls, ...)) {
  // 工具顺序执行
  if (event.type === "tool_call") {
    await executeTool(event.call); // 阻塞等待
  }
}
```

**性能影响**：
- 生成 1 张图：30 秒
- 生成 5 张图（串行）：150 秒
- 生成 5 张图（并行）：35 秒（理论值）

**改进目标**：4.3x 加速

### 问题 2：确认机制复杂

**当前流程**：
```typescript
// tool-confirmation-pause.ts
if (shouldPauseToolForConfirmation(toolName)) {
  const approval = await awaitUserToolApproval(...);
  // 这里需要 LangGraph.interrupt()
  // 推理链中断，等待用户批准
  // 用户批准后需要手动 Command.resume()
}
```

**问题**：
- ❌ ReAct 推理链中断
- ❌ 状态管理复杂（需要 checkpoint + resume）
- ❌ Agent 无法根据用户反馈调整策略
- ❌ 代码分散在多个文件

## 解决方案

### 方案 A：保守改进（推荐 Phase 2）

**核心思路**：保留现有架构，局部优化

#### 1. 工具并行执行

```typescript
// 新代码：lib/agents/parallel-tool-executor.ts
export async function executeToolsInParallel(
  calls: ToolCall[],
  ctx: ExecutionContext
): Promise<ToolResult[]> {
  // 分析依赖关系
  const graph = buildDependencyGraph(calls);
  
  // 按层级并行执行
  const layers = topologicalSort(graph);
  const results = new Map<string, ToolResult>();
  
  for (const layer of layers) {
    // 同一层的工具可以并行
    const layerResults = await Promise.allSettled(
      layer.map(call => executeSingleTool(call, ctx, results))
    );
    
    // 记录结果
    layer.forEach((call, i) => {
      results.set(call.id, layerResults[i]);
    });
  }
  
  return Array.from(results.values());
}

function buildDependencyGraph(calls: ToolCall[]): DependencyGraph {
  // 检测依赖关系
  // 例如：generate_images 不依赖其他工具，可以并行
  //      finalize_brief 可能依赖 ask_discovery_questions
  return calls.map(call => ({
    id: call.id,
    name: call.name,
    dependencies: detectDependencies(call, calls),
  }));
}
```

**依赖检测规则**：
```typescript
const TOOL_DEPENDENCIES: Record<string, string[]> = {
  // 这些工具可以完全并行
  "generate_images": [],
  "materialize_mockup": [],
  "export_handoff": [],
  
  // 这些工具需要等待前置工具
  "finalize_brief": ["ask_discovery_questions"],
  "set_design_direction": ["finalize_brief"],
  "iterate_critique": ["generate_images"],
};
```

**预期效果**：
- ✅ 图像生成：150s → 35s（4.3x 加速）
- ✅ 不破坏现有架构
- ✅ 低风险实施

#### 2. 简化确认流程

**核心思路**：确认请求作为特殊的工具结果返回

```typescript
// 新代码：lib/agents/tool-approval-handler.ts
export async function executeWithApproval(
  call: ToolCall,
  ctx: ExecutionContext
): Promise<ToolResult | ApprovalRequest> {
  const risk = getRiskLevel(call.name);
  
  if (risk === "high" && !ctx.autoApprove) {
    // 返回确认请求，而不是中断
    return {
      type: "approval_request",
      toolCall: call,
      risk,
      message: `需要确认：${call.name}`,
    };
  }
  
  // 直接执行
  return await toolRegistry.execute(call.name, call.args, ctx);
}
```

**优势**：
- ✅ 不需要 LangGraph interrupt
- ✅ ReAct 推理链完整
- ✅ 代码集中在一处

### 方案 B：激进重构（Phase 3）

**核心思路**：确认作为工具，成为推理的一部分

```typescript
// 新工具：request_approval
const requestApprovalTool = tool({
  name: "request_approval",
  description: "Request user approval for a high-risk action before executing it",
  schema: z.object({
    action: z.string().describe("The action name (e.g., 'generate_images')"),
    reason: z.string().describe("Why this action is needed"),
    args: z.record(z.unknown()).describe("Arguments for the action"),
    alternatives: z.array(z.string()).optional().describe("Alternative approaches"),
  }),
  execute: async (input) => {
    const approval = await showApprovalDialog({
      action: input.action,
      reason: input.reason,
      args: input.args,
      alternatives: input.alternatives,
    });
    
    if (approval.approved) {
      return { approved: true, note: approval.userNote };
    } else {
      return { approved: false, reason: approval.reason };
    }
  },
});
```

**ReAct 推理示例**：
```
Thought: 用户要求生成 5 张图，这是高风险操作
Action: request_approval
{
  "action": "generate_images",
  "reason": "用户要求为登录、注册等 5 个场景生成图像",
  "args": { "count": 5, "provider": "flux" },
  "alternatives": ["先生成 1 张预览", "使用占位符"]
}

Observation: { "approved": true, "note": "用户批准，但要求使用 midjourney" }

Thought: 好的，用户批准了，但要求换成 midjourney
Action: generate_images
{
  "provider": "midjourney",
  "count": 5,
  ...
}
```

**优势**：
- ✅ 确认成为推理的一部分
- ✅ Agent 可以根据用户反馈调整
- ✅ 完整的审计日志
- ✅ 支持提供替代方案

**风险**：
- ⚠️ 需要重构大量代码
- ⚠️ 改变用户交互流程
- ⚠️ 可能增加推理复杂度

## Phase 2 实施计划

### Step 1: 工具依赖分析（1 天）

**任务**：
- [ ] 梳理所有 21 个工具的依赖关系
- [ ] 创建 `TOOL_DEPENDENCIES` 映射表
- [ ] 识别可以并行的工具组合

**输出**：
- `lib/agents/tool-dependencies.ts`
- 依赖关系文档

### Step 2: 并行执行引擎（2 天）

**任务**：
- [ ] 实现 `buildDependencyGraph()`
- [ ] 实现 `topologicalSort()`
- [ ] 实现 `executeToolsInParallel()`
- [ ] 编写单元测试

**输出**：
- `lib/agents/parallel-tool-executor.ts`
- `lib/agents/parallel-tool-executor.test.ts`

**关键代码**：
```typescript
export interface DependencyGraph {
  nodes: ToolNode[];
  edges: Edge[];
}

export interface ToolNode {
  id: string;
  name: string;
  call: ToolCall;
}

export interface Edge {
  from: string;
  to: string;
  type: "data" | "sequence";
}

export function buildDependencyGraph(calls: ToolCall[]): DependencyGraph {
  // 实现逻辑
}

export function topologicalSort(graph: DependencyGraph): ToolNode[][] {
  // 返回层级化的工具列表
  // 例如：[[tool1, tool2], [tool3], [tool4, tool5]]
  // 表示 tool1 和 tool2 可以并行，完成后执行 tool3，最后并行执行 tool4 和 tool5
}
```

### Step 3: 集成到 Chat Orchestrator（1 天）

**任务**：
- [ ] 替换 `runCalls()` 的串行逻辑
- [ ] 保留向后兼容性（通过 feature flag）
- [ ] 更新流式事件（并行工具的进度报告）

**代码修改**：
```typescript
// chat-orchestrator.ts
async function* runCalls(
  calls: ToolCall[],
  ctx: ExecutionContext
): AsyncGenerator<OrchestratorEvent> {
  // Feature flag
  if (ctx.enableParallelExecution) {
    // 新逻辑：并行执行
    const layers = buildDependencyGraph(calls);
    
    for (const layer of layers) {
      yield { type: "layer_start", tools: layer.map(n => n.name) };
      
      const results = await Promise.allSettled(
        layer.map(node => executeSingleTool(node.call, ctx))
      );
      
      yield { type: "layer_complete", results };
    }
  } else {
    // 旧逻辑：串行执行（保留兼容性）
    for (const call of calls) {
      const result = await executeSingleTool(call, ctx);
      yield { type: "tool_complete", result };
    }
  }
}
```

### Step 4: 简化确认流程（2 天）

**任务**：
- [ ] 创建 `executeWithApproval()` 函数
- [ ] 重构 `tool-confirmation-pause.ts`
- [ ] 更新 UI 以支持新的确认流程
- [ ] 确保不需要 LangGraph interrupt

**关键改动**：
```typescript
// 旧代码：需要 interrupt
if (shouldPauseToolForConfirmation(toolName)) {
  return Command.interrupt({ /* approval payload */ });
}

// 新代码：返回特殊结果
const result = await executeWithApproval(call, ctx);
if (result.type === "approval_request") {
  // UI 会消费这个事件并显示确认对话框
  yield { type: "approval_needed", request: result };
  
  // 等待用户决策
  const decision = await ctx.awaitApproval(result.id);
  
  if (decision.approved) {
    // 继续执行
    const actualResult = await toolRegistry.execute(call.name, call.args, ctx);
    yield { type: "tool_complete", result: actualResult };
  } else {
    // 用户取消
    yield { type: "tool_cancelled", reason: decision.reason };
  }
}
```

### Step 5: 测试和验证（2 天）

**任务**：
- [ ] 单元测试：依赖图构建
- [ ] 单元测试：拓扑排序
- [ ] 单元测试：并行执行
- [ ] 集成测试：完整流程
- [ ] 性能测试：串行 vs 并行
- [ ] UI 测试：确认流程

**测试用例**：
```typescript
describe("Parallel Tool Execution", () => {
  it("executes independent tools in parallel", async () => {
    const calls = [
      { name: "generate_images", args: { count: 3 } },
      { name: "materialize_mockup", args: { pageId: "login" } },
      { name: "export_handoff", args: { format: "zip" } },
    ];
    
    const start = Date.now();
    const results = await executeToolsInParallel(calls, ctx);
    const duration = Date.now() - start;
    
    // 并行执行应该接近最慢工具的时间，而不是总和
    expect(duration).toBeLessThan(40000); // 35 秒 + 5 秒容差
    expect(results).toHaveLength(3);
  });
  
  it("respects dependencies", async () => {
    const calls = [
      { name: "ask_discovery_questions", args: {} },
      { name: "finalize_brief", args: {} }, // 依赖上面
    ];
    
    const executionOrder: string[] = [];
    const results = await executeToolsInParallel(calls, {
      ...ctx,
      onToolStart: (name) => executionOrder.push(name),
    });
    
    expect(executionOrder).toEqual([
      "ask_discovery_questions",
      "finalize_brief",
    ]);
  });
});
```

### Step 6: 文档和部署（1 天）

**任务**：
- [ ] 更新 README（并行执行特性）
- [ ] 更新 API 文档
- [ ] 创建性能对比报告
- [ ] 编写迁移指南

---

## 成功指标

### 性能提升
- ✅ 图像生成时间减少 70%（150s → 35s）
- ✅ 多工具任务平均加速 2-3x
- ✅ 首次响应延迟不增加

### 代码质量
- ✅ 测试覆盖率 > 90%
- ✅ 零 TypeScript 错误
- ✅ 零 Lint 警告
- ✅ 向后兼容（feature flag 控制）

### 用户体验
- ✅ 并行工具有清晰的进度指示
- ✅ 确认流程不中断推理链
- ✅ 用户可以取消单个工具而不影响其他

---

## 风险评估

### 技术风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 依赖检测错误 | 中 | 高 | 保守策略：不确定的依赖关系默认串行 |
| 并行导致资源耗尽 | 低 | 中 | 限制并行度（最多 5 个并发） |
| 确认流程回归 | 低 | 高 | Feature flag + 完整测试覆盖 |
| 性能提升不明显 | 低 | 中 | 提前做性能分析，确认瓶颈 |

### 实施风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 工期延误 | 中 | 中 | 预留 2 天 buffer |
| 破坏现有功能 | 低 | 高 | Feature flag + 渐进式部署 |
| 团队不熟悉新代码 | 中 | 低 | 详细文档 + Code Review |

---

## 时间规划

| 阶段 | 工作量 | 开始日期 | 结束日期 |
|------|--------|----------|----------|
| Step 1: 依赖分析 | 1 天 | Day 1 | Day 1 |
| Step 2: 并行引擎 | 2 天 | Day 2 | Day 3 |
| Step 3: 集成 | 1 天 | Day 4 | Day 4 |
| Step 4: 确认流程 | 2 天 | Day 5 | Day 6 |
| Step 5: 测试 | 2 天 | Day 7 | Day 8 |
| Step 6: 文档 | 1 天 | Day 9 | Day 9 |
| **总计** | **9 天** | - | - |

---

## Phase 3 预告

Phase 3 将实施更激进的改进：

### 1. 确认作为工具
- 新增 `request_approval` 工具
- Agent 主动请求确认
- 支持提供替代方案

### 2. 事件驱动架构
- Agents 通过事件总线通信
- 真正的多 Agent 并行协作
- 动态工作流编排

### 3. 分布式执行
- 支持多机并行
- Kubernetes 部署
- 弹性伸缩

---

**日期**: 2026-09-29  
**作者**: Vibeboard Team  
**状态**: 📋 Phase 2 计划，等待实施

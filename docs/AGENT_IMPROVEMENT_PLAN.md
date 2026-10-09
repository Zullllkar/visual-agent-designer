# Agent 系统改进计划

## 设计原则

**保留现有 LangGraph 系统**，通过**专业化 Agent**并行优化，渐进式迁移。

---

## 一、当前架构（保留）

```
用户输入
  ↓
ChatOrchestrator (orchestrator-planner.ts)
  ↓
AgentRunService + LangGraph
  ↓
createReactAgent() → 通用工具集 (21 tools)
```

**优点**：成熟、稳定、支持复杂交互
**缺点**：通用性强但效率低，串行执行慢

---

## 二、新增专业化 Agent 层（并行）

### 架构图

```
                    用户输入
                      ↓
        ┌─────────────┴─────────────┐
        │                           │
   简单任务                      复杂任务
        │                           │
        ↓                           ↓
┌───────────────┐          ┌──────────────┐
│ 轻量化 Agent  │          │  LangGraph   │
│   (新系统)    │          │  (现有系统)  │
└───────────────┘          └──────────────┘
        │                           │
        ↓                           ↓
 专业化协作团队              通用工具链
 (并行执行)                 (串行执行)
```

### 路由策略

```typescript
// chat-orchestrator.ts 增强
async function routeToAgent(input: UserInput): Promise<AgentType> {
  // 规则 1: 明确的设计任务 → 专业化团队
  if (isDesignBrief(input)) {
    return "specialized-team"; // 新系统
  }
  
  // 规则 2: 需要多工具编排 → LangGraph
  if (needsComplexOrchestration(input)) {
    return "langgraph"; // 现有系统
  }
  
  // 规则 3: 简单查询 → 纯聊天
  return "chat-only";
}
```

---

## 三、专业化 Agent 团队

### 1. 团队组成

| Agent | 职责 | 输入 | 输出 |
|-------|------|------|------|
| **ArchitectAgent** | 结构规划 | 用户简报 | 页面结构 JSON |
| **DesignerAgent** | 视觉方向 | 结构 + 偏好 | 配色/字体方案 |
| **ImagePlannerAgent** | 图像规划 | 结构 + 视觉 | 图像生成清单 |
| **ImageExecutorAgent** | 图像生成 | 单个图像规格 | 图像 URL |
| **CriticAgent** | 质量检查 | 完整设计 | 改进建议 |

### 2. 协作流程

```typescript
// agent-coordinator.ts (已实现)
async function coordinateDesign(brief: string) {
  // 第 1 阶段：并行规划
  const [structure, direction] = await Promise.all([
    architectAgent.execute({ userBrief: brief }),
    designerAgent.execute({ userBrief: brief }),
  ]);
  
  // 第 2 阶段：图像规划
  const imagePlan = await imagePlannerAgent.execute({
    structure: structure.data,
    direction: direction.data,
  });
  
  // 第 3 阶段：并行生成所有图像
  const images = await Promise.all(
    imagePlan.data.images.map(spec =>
      imageExecutorAgent.execute(spec)
    )
  );
  
  // 第 4 阶段：质量检查
  const review = await criticAgent.execute({
    structure,
    direction,
    images,
  });
  
  return { structure, direction, images, review };
}
```

**关键优化**：
- ✅ 阶段 1、3 **并行执行**，减少 60% 等待时间
- ✅ 每个 Agent 专注单一职责，提升质量
- ✅ 结构化输出（JSON），易于调试和测试

---

## 四、并行工具执行器

### 问题：当前工具串行执行

```typescript
// 现有：agent-run-service.ts
for (const tool of toolCalls) {
  await executeTool(tool); // 串行，慢
}
```

### 解决方案：依赖分层并行

```typescript
// parallel-tool-executor.ts (已实现)
await executeInLayers([
  { name: "generate_images", args: {...}, deps: [] },
  { name: "generate_images", args: {...}, deps: [] },
  { name: "materialize_mockup", args: {...}, deps: ["generate_images"] },
]);

// 结果：
// Layer 0: generate_images (2 个并行) → 30 秒
// Layer 1: materialize_mockup (依赖完成后执行) → 5 秒
// 总时间：35 秒 (vs 串行 65 秒)
```

**集成方式**：
```typescript
// agent-run-service.ts 增强
if (canParallelize(toolCalls)) {
  return executeInLayers(toolCalls); // 新逻辑
} else {
  return executeSequentially(toolCalls); // 现有逻辑
}
```

---

## 五、轻量化 Agent Loop

### 问题：LangGraph 过重

- SQLite checkpoint 增加延迟
- 上下文超限时清空所有记忆

### 解决方案：自定义 Agent Loop（可选）

```typescript
// lightweight-agent-loop.ts (已实现)
class LightweightAgentLoop {
  async run(userMessage: string) {
    let messages = [{ role: "user", content: userMessage }];
    
    for (let i = 0; i < maxIterations; i++) {
      const response = await llm.generate({ messages, tools });
      
      if (response.stopReason === "end_turn") break;
      
      // 并行执行工具
      const results = await executeInLayers(response.toolCalls);
      
      messages.push(...results);
    }
    
    return messages;
  }
}
```

**使用场景**：
- ✅ 简单设计任务（5 步以内）
- ✅ 不需要长期记忆的场景
- ❌ 复杂交互仍用 LangGraph

---

## 六、渐进式迁移路径

### 阶段 1：并行工具执行（立即可做）

1. ✅ 实现 `parallel-tool-executor.ts`
2. 🔲 在 `agent-run-service.ts` 中集成
3. 🔲 A/B 测试：对比串行 vs 并行性能

### 阶段 2：专业化 Agent 试点（2 周）

1. ✅ 实现 5 个专业化 Agents
2. ✅ 实现 `AgentCoordinator`
3. 🔲 路由层：设计任务 → 专业化团队
4. 🔲 其他任务 → LangGraph（保持不变）

### 阶段 3：智能路由优化（1 个月）

```typescript
// 基于任务特征自动选择系统
if (isSimpleDesign) {
  return specializedTeam.run();
} else if (needsLongContext) {
  return langGraph.run();
} else {
  return lightweightLoop.run();
}
```

### 阶段 4：性能监控与调优

```typescript
// 记录每个系统的指标
{
  system: "specialized-team",
  taskType: "design-brief",
  duration: 35000, // ms
  toolCalls: 8,
  parallelLayers: 3,
  userSatisfaction: 4.5,
}
```

---

## 七、预期收益

| 指标 | 现状 | 目标 | 改进 |
|------|------|------|------|
| 设计任务完成时间 | 120s | 40s | **66% ↓** |
| 工具执行并发度 | 1x | 3-5x | **300% ↑** |
| 上下文超限率 | 15% | 5% | **67% ↓** |
| 代码复杂度 | 高 | 中 | 模块化 |
| 可测试性 | 低 | 高 | 单元测试覆盖 |

---

## 八、风险与缓解

### 风险 1：两套系统维护成本

**缓解**：
- 共享工具注册表（`tool-registry.ts`）
- 共享 LLM provider 抽象层
- 专业化 Agents 可独立测试，降低维护成本

### 风险 2：路由逻辑可能误判

**缓解**：
- 提供手动切换开关（用户可选择系统）
- 记录路由决策，定期审查
- 默认使用 LangGraph（稳定优先）

### 风险 3：并行执行可能产生竞态

**缓解**：
- 工具声明依赖关系（`deps` 字段）
- 执行器自动构建 DAG，保证顺序
- 幂等性控制（重复调用结果一致）

---

## 九、下一步行动

### 立即可做（本周）

- [x] 实现 `parallel-tool-executor.ts`
- [x] 实现 5 个专业化 Agents
- [x] 实现 `AgentCoordinator`
- [ ] 编写集成测试
- [ ] 在 `chat-orchestrator.ts` 中添加路由逻辑

### 近期目标（2 周）

- [ ] A/B 测试：设计任务用专业化团队
- [ ] 性能基准测试：串行 vs 并行
- [ ] 用户反馈收集

### 长期目标（1-3 个月）

- [ ] 智能路由优化（基于 ML 模型）
- [ ] 可视化工作流编辑器
- [ ] 分布式执行（多机并行）

---

## 十、总结

这个改进计划遵循**渐进式增强**原则：

1. **保留现有系统**：LangGraph 继续处理复杂任务
2. **并行构建新系统**：专业化 Agents 处理设计任务
3. **智能路由**：根据任务特征选择最优系统
4. **持续优化**：基于数据驱动的性能调优

核心理念：**专业化分工 + 并行执行 + 智能协作** = 效率提升 3-5 倍。

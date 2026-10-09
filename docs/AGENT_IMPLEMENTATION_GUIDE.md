# Agent 系统技术实现细节

本文档详细说明专业化 Agent 系统的技术实现，包括关键代码、集成方式和最佳实践。

---

## 一、核心组件架构

### 1. 基础 Agent 抽象层

```typescript
// src/lib/agents/specialized/base-agent.ts
export abstract class SpecializedAgent<TInput, TOutput> {
  protected config: AgentConfig;
  protected logger: Logger;
  
  constructor(config: AgentConfig) {
    this.config = config;
    this.logger = createLogger(config.name);
  }
  
  /**
   * 核心执行方法 - 子类必须实现
   */
  abstract execute(input: TInput): Promise<AgentResult<TOutput>>;
  
  /**
   * 调用 LLM（使用项目现有的 provider）
   */
  protected async callLLM(params: {
    prompt: string;
    responseFormat?: "text" | "json";
  }): Promise<LLMResponse> {
    // 使用项目现有的 LLM provider
    const provider = await getActiveProvider();
    return provider.generate({
      messages: [
        { role: "system", content: this.config.systemPrompt },
        { role: "user", content: params.prompt },
      ],
      temperature: this.config.temperature,
      responseFormat: params.responseFormat,
    });
  }
  
  /**
   * 执行工具（使用项目现有的 tool registry）
   */
  protected async executeTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    const tool = toolRegistry.get(name);
    if (!tool) throw new Error(`Tool not found: ${name}`);
    
    return tool.execute(args);
  }
  
  /**
   * 性能测量
   */
  protected async measureTime<T>(
    fn: () => Promise<T>
  ): Promise<{ result: T; duration: number }> {
    const start = performance.now();
    const result = await fn();
    const duration = performance.now() - start;
    return { result, duration };
  }
  
  /**
   * 日志记录
   */
  protected log(level: "info" | "warn" | "error", message: string, meta?: any) {
    this.logger[level](message, { agent: this.config.name, ...meta });
  }
}
```

**设计要点**：
- ✅ 复用项目现有的 LLM provider 和 tool registry
- ✅ 不依赖 LangGraph，轻量化
- ✅ 提供通用能力（LLM 调用、工具执行、日志）
- ✅ 子类只需实现 `execute()` 方法

---

### 2. 专业化 Agent 实现示例

#### ArchitectAgent（结构规划专家）

```typescript
// src/lib/agents/specialized/architect-agent.ts
export class ArchitectAgent extends SpecializedAgent<
  ArchitectInput,
  ArchitectureSpec
> {
  constructor() {
    super({
      name: "ArchitectAgent",
      expertise: "Information Architecture & Layout Planning",
      systemPrompt: `你是信息架构专家，专注于网页结构规划。

职责：
1. 分析用户需求，规划页面结构
2. 决定页面数量和用途
3. 规划每个页面的布局和区块

规则：
- 只关注结构和信息架构，不涉及视觉样式
- 输出结构化 JSON，便于下游 agents 使用
- 始终解释你的设计决策

输出格式：
{
  "screens": [...],
  "navigation": {...},
  "contentPriority": [...],
  "reasoning": "..."
}`,
      temperature: 0.3, // 低温度 = 更结构化
    });
  }
  
  async execute(input: ArchitectInput): Promise<AgentResult<ArchitectureSpec>> {
    this.log("info", "开始结构规划", { brief: input.userBrief });
    
    try {
      const { result, duration } = await this.measureTime(async () => {
        // 1. 构建提示词
        const prompt = this.buildPrompt(input);
        
        // 2. 调用 LLM
        const llmResponse = await this.callLLM({
          prompt,
          responseFormat: "json",
        });
        
        // 3. 解析并验证结果
        const spec = this.parseJSON<ArchitectureSpec>(llmResponse.content);
        this.validateSpec(spec);
        
        return { spec, tokens: llmResponse.usage };
      });
      
      this.log("info", "结构规划完成", {
        screenCount: result.spec.screens.length,
        duration,
      });
      
      return {
        success: true,
        data: result.spec,
        duration,
        tokensUsed: result.tokens,
      };
    } catch (error) {
      this.log("error", "结构规划失败", { error });
      return {
        success: false,
        error: error.message,
        duration: 0,
      };
    }
  }
  
  private buildPrompt(input: ArchitectInput): string {
    let prompt = `用户需求：\n${input.userBrief}\n\n`;
    
    if (input.projectContext?.existingScreens) {
      prompt += `现有页面：${input.projectContext.existingScreens.join(", ")}\n`;
    }
    
    prompt += `\n请规划页面结构，输出 JSON 格式。`;
    return prompt;
  }
  
  private validateSpec(spec: ArchitectureSpec) {
    if (!spec.screens || spec.screens.length === 0) {
      throw new Error("至少需要 1 个页面");
    }
    
    for (const screen of spec.screens) {
      if (!screen.id || !screen.name || !screen.layout) {
        throw new Error(`页面 ${screen.id} 缺少必需字段`);
      }
    }
  }
}
```

**关键设计**：
- ✅ 专注单一职责（结构规划）
- ✅ 输出结构化 JSON（易于测试和调试）
- ✅ 验证输出质量（防止下游 agents 崩溃）
- ✅ 详细日志记录（可观测性）

---

### 3. Agent 协调器

```typescript
// src/lib/agents/specialized/agent-coordinator.ts
export class AgentCoordinator {
  private architect: ArchitectAgent;
  private designer: DesignerAgent;
  private imagePlanner: ImagePlannerAgent;
  private imageExecutor: ImageExecutorAgent;
  private critic: CriticAgent;
  
  constructor() {
    this.architect = new ArchitectAgent();
    this.designer = new DesignerAgent();
    this.imagePlanner = new ImagePlannerAgent();
    this.imageExecutor = new ImageExecutorAgent();
    this.critic = new CriticAgent();
  }
  
  /**
   * 协调整个设计流程
   */
  async coordinateDesign(brief: string): Promise<CoordinationResult> {
    const timeline: AgentEvent[] = [];
    
    try {
      // ============ 阶段 1：并行规划 ============
      timeline.push({ type: "phase", name: "规划阶段", timestamp: Date.now() });
      
      const [architectResult, designerResult] = await Promise.all([
        this.architect.execute({ userBrief: brief }),
        this.designer.execute({ userBrief: brief }),
      ]);
      
      if (!architectResult.success || !designerResult.success) {
        throw new Error("规划阶段失败");
      }
      
      timeline.push({
        type: "agent_complete",
        agent: "architect",
        duration: architectResult.duration,
      });
      timeline.push({
        type: "agent_complete",
        agent: "designer",
        duration: designerResult.duration,
      });
      
      // ============ 阶段 2：图像规划 ============
      timeline.push({ type: "phase", name: "图像规划", timestamp: Date.now() });
      
      const imagePlanResult = await this.imagePlanner.execute({
        structure: architectResult.data,
        direction: designerResult.data,
      });
      
      if (!imagePlanResult.success) {
        throw new Error("图像规划失败");
      }
      
      // ============ 阶段 3：并行生成图像 ============
      timeline.push({ type: "phase", name: "图像生成", timestamp: Date.now() });
      
      const imageSpecs = imagePlanResult.data.images;
      const imageResults = await Promise.all(
        imageSpecs.map((spec) => this.imageExecutor.execute(spec))
      );
      
      const failedImages = imageResults.filter((r) => !r.success);
      if (failedImages.length > 0) {
        console.warn(`${failedImages.length} 张图像生成失败`);
      }
      
      const images = imageResults
        .filter((r) => r.success)
        .map((r) => r.data!);
      
      // ============ 阶段 4：质量检查 ============
      timeline.push({ type: "phase", name: "质量检查", timestamp: Date.now() });
      
      const criticResult = await this.critic.execute({
        structure: architectResult.data,
        direction: designerResult.data,
        images,
      });
      
      // ============ 返回完整结果 ============
      return {
        success: true,
        structure: architectResult.data,
        direction: designerResult.data,
        images,
        review: criticResult.data,
        timeline,
        totalDuration: this.calculateTotalDuration(timeline),
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        timeline,
      };
    }
  }
  
  private calculateTotalDuration(timeline: AgentEvent[]): number {
    const start = timeline[0]?.timestamp || 0;
    const end = timeline[timeline.length - 1]?.timestamp || 0;
    return end - start;
  }
}
```

**关键优化**：
- ✅ 阶段 1 并行执行（architect + designer）
- ✅ 阶段 3 并行执行（所有图像）
- ✅ 详细的时间线记录（性能分析）
- ✅ 错误处理和降级（部分失败仍可继续）

---

## 二、并行工具执行器

### 核心算法：依赖分层

```typescript
// src/lib/agents/parallel-tool-executor.ts

/**
 * 工具调用（带依赖声明）
 */
interface ToolCallWithDeps {
  id: string;
  name: string;
  args: Record<string, unknown>;
  deps: string[]; // 依赖的工具 id
}

/**
 * 构建依赖图并按层执行
 */
export class ParallelToolExecutor {
  async executeInLayers(
    calls: ToolCallWithDeps[]
  ): Promise<ToolExecutionSummary> {
    // 1. 构建依赖图
    const graph = this.buildDependencyGraph(calls);
    
    // 2. 拓扑排序，分层
    const layers = this.topologicalSort(graph);
    
    // 3. 逐层并行执行
    const results: ToolResult[] = [];
    
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      console.log(`[Layer ${i}] 开始执行 ${layer.length} 个工具`);
      
      const layerStart = performance.now();
      
      // 并行执行本层所有工具
      const layerResults = await Promise.allSettled(
        layer.map((call) => this.executeToolWithTimeout(call))
      );
      
      const layerDuration = performance.now() - layerStart;
      console.log(`[Layer ${i}] 完成，耗时: ${layerDuration}ms`);
      
      results.push(...layerResults.map((r) => 
        r.status === "fulfilled" ? r.value : { error: r.reason }
      ));
    }
    
    return this.summarize(results);
  }
  
  /**
   * 拓扑排序：将工具分层
   */
  private topologicalSort(
    graph: Map<string, ToolCallWithDeps>
  ): ToolCallWithDeps[][] {
    const layers: ToolCallWithDeps[][] = [];
    const visited = new Set<string>();
    const inDegree = new Map<string, number>();
    
    // 计算入度
    for (const [id, call] of graph) {
      inDegree.set(id, call.deps.length);
    }
    
    // 分层处理
    while (visited.size < graph.size) {
      // 找到所有入度为 0 的节点（当前层）
      const currentLayer: ToolCallWithDeps[] = [];
      
      for (const [id, call] of graph) {
        if (!visited.has(id) && inDegree.get(id) === 0) {
          currentLayer.push(call);
        }
      }
      
      if (currentLayer.length === 0) {
        throw new Error("检测到循环依赖");
      }
      
      layers.push(currentLayer);
      
      // 标记已访问，更新后续节点的入度
      for (const call of currentLayer) {
        visited.add(call.id);
        
        // 更新依赖此节点的其他节点的入度
        for (const [otherId, otherCall] of graph) {
          if (otherCall.deps.includes(call.id)) {
            inDegree.set(otherId, inDegree.get(otherId)! - 1);
          }
        }
      }
    }
    
    return layers;
  }
  
  /**
   * 执行单个工具（带超时）
   */
  private async executeToolWithTimeout(
    call: ToolCallWithDeps,
    timeout: number = 60000
  ): Promise<ToolResult> {
    const tool = toolRegistry.get(call.name);
    if (!tool) {
      throw new Error(`Tool not found: ${call.name}`);
    }
    
    return Promise.race([
      tool.execute(call.args),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Tool timeout")), timeout)
      ),
    ]);
  }
}
```

**示例：并行执行图像生成**

```typescript
// 场景：生成 3 张图像，然后合成 mockup
const calls: ToolCallWithDeps[] = [
  { id: "img1", name: "generate_images", args: {...}, deps: [] },
  { id: "img2", name: "generate_images", args: {...}, deps: [] },
  { id: "img3", name: "generate_images", args: {...}, deps: [] },
  { id: "mockup", name: "materialize_mockup", args: {...}, deps: ["img1", "img2", "img3"] },
];

const executor = new ParallelToolExecutor();
const result = await executor.executeInLayers(calls);

// 执行过程：
// Layer 0: [img1, img2, img3] 并行执行 → 30 秒
// Layer 1: [mockup] 等待 Layer 0 完成后执行 → 5 秒
// 总时间：35 秒（vs 串行 95 秒）
```

---

## 三、集成到现有系统

### 步骤 1：在 ChatOrchestrator 中添加路由

```typescript
// src/lib/agents/chat-orchestrator.ts

import { AgentCoordinator } from "./specialized/agent-coordinator";

export class ChatOrchestrator {
  private specializedCoordinator: AgentCoordinator;
  
  constructor() {
    this.specializedCoordinator = new AgentCoordinator();
  }
  
  async processMessage(input: UserInput): Promise<Response> {
    // ============ 路由决策 ============
    const route = this.decideRoute(input);
    
    switch (route) {
      case "specialized-team":
        // 使用专业化 Agent 团队
        return this.runSpecializedTeam(input);
        
      case "langgraph":
        // 使用现有 LangGraph 系统
        return this.runLangGraph(input);
        
      case "chat-only":
        // 纯聊天，不调用工具
        return this.runChatOnly(input);
    }
  }
  
  /**
   * 路由决策逻辑
   */
  private decideRoute(input: UserInput): RouteType {
    const message = input.message.toLowerCase();
    
    // 规则 1：设计简报 → 专业化团队
    const designKeywords = [
      "design",
      "设计",
      "landing page",
      "着陆页",
      "网站",
      "app",
    ];
    
    if (designKeywords.some((kw) => message.includes(kw))) {
      return "specialized-team";
    }
    
    // 规则 2：复杂工具编排 → LangGraph
    if (this.needsComplexOrchestration(input)) {
      return "langgraph";
    }
    
    // 规则 3：简单查询 → 纯聊天
    return "chat-only";
  }
  
  /**
   * 运行专业化团队
   */
  private async runSpecializedTeam(input: UserInput): Promise<Response> {
    const result = await this.specializedCoordinator.coordinateDesign(
      input.message
    );
    
    if (!result.success) {
      // 降级到 LangGraph
      console.warn("专业化团队失败，降级到 LangGraph");
      return this.runLangGraph(input);
    }
    
    return {
      type: "design_complete",
      structure: result.structure,
      direction: result.direction,
      images: result.images,
      review: result.review,
      timeline: result.timeline,
    };
  }
  
  /**
   * 运行 LangGraph（现有逻辑）
   */
  private async runLangGraph(input: UserInput): Promise<Response> {
    // 保持现有代码不变
    return agentRunService.createRun(input);
  }
}
```

**关键点**：
- ✅ 先尝试专业化团队（快）
- ✅ 失败时降级到 LangGraph（稳定）
- ✅ 路由逻辑简单清晰（基于关键词）

---

### 步骤 2：在 AgentRunService 中集成并行执行器

```typescript
// src/lib/agents/agent-run-service.ts

import { ParallelToolExecutor } from "./parallel-tool-executor";

export class AgentRunService {
  private parallelExecutor: ParallelToolExecutor;
  
  constructor() {
    this.parallelExecutor = new ParallelToolExecutor();
  }
  
  async executeTools(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    // 分析工具调用，决定是否并行
    if (this.canParallelize(toolCalls)) {
      console.log("[AgentRunService] 使用并行执行器");
      
      // 自动推断依赖关系
      const callsWithDeps = this.inferDependencies(toolCalls);
      
      const summary = await this.parallelExecutor.executeInLayers(callsWithDeps);
      return summary.results;
    } else {
      console.log("[AgentRunService] 使用串行执行");
      
      // 保持现有串行逻辑
      const results: ToolResult[] = [];
      for (const call of toolCalls) {
        const result = await this.executeSingleTool(call);
        results.push(result);
      }
      return results;
    }
  }
  
  /**
   * 判断是否可以并行执行
   */
  private canParallelize(toolCalls: ToolCall[]): boolean {
    // 规则 1：少于 2 个工具 → 不需要并行
    if (toolCalls.length < 2) return false;
    
    // 规则 2：包含高风险工具 → 不并行（需要用户确认）
    const highRiskTools = ["delete_project", "export_code"];
    if (toolCalls.some((c) => highRiskTools.includes(c.name))) {
      return false;
    }
    
    // 规则 3：多个图像生成 → 并行
    const imageGenCount = toolCalls.filter(
      (c) => c.name === "generate_images"
    ).length;
    if (imageGenCount >= 2) return true;
    
    return false;
  }
  
  /**
   * 自动推断依赖关系
   */
  private inferDependencies(toolCalls: ToolCall[]): ToolCallWithDeps[] {
    return toolCalls.map((call, index) => {
      const deps: string[] = [];
      
      // 规则：mockup 依赖所有图像生成
      if (call.name === "materialize_mockup") {
        for (let i = 0; i < index; i++) {
          if (toolCalls[i].name === "generate_images") {
            deps.push(toolCalls[i].id);
          }
        }
      }
      
      return {
        ...call,
        deps,
      };
    });
  }
}
```

---

## 四、测试策略

### 单元测试：ArchitectAgent

```typescript
// src/lib/agents/specialized/architect-agent.test.ts
describe("ArchitectAgent", () => {
  let agent: ArchitectAgent;
  
  beforeEach(() => {
    agent = new ArchitectAgent();
  });
  
  it("should generate structure for landing page", async () => {
    const result = await agent.execute({
      userBrief: "Design a SaaS landing page for project management tool",
    });
    
    expect(result.success).toBe(true);
    expect(result.data.screens.length).toBeGreaterThan(0);
    expect(result.data.screens[0]).toHaveProperty("id");
    expect(result.data.screens[0]).toHaveProperty("layout");
  });
  
  it("should validate output structure", async () => {
    const result = await agent.execute({
      userBrief: "Invalid brief",
    });
    
    if (!result.success) {
      expect(result.error).toBeDefined();
    }
  });
});
```

### 集成测试：AgentCoordinator

```typescript
// src/lib/agents/specialized/agent-coordinator.test.ts
describe("AgentCoordinator", () => {
  let coordinator: AgentCoordinator;
  
  beforeEach(() => {
    coordinator = new AgentCoordinator();
  });
  
  it("should complete full design workflow", async () => {
    const result = await coordinator.coordinateDesign(
      "Design a landing page for AI writing assistant"
    );
    
    expect(result.success).toBe(true);
    expect(result.structure).toBeDefined();
    expect(result.direction).toBeDefined();
    expect(result.images.length).toBeGreaterThan(0);
    expect(result.totalDuration).toBeLessThan(60000); // < 60 秒
  });
  
  it("should record detailed timeline", async () => {
    const result = await coordinator.coordinateDesign("Test brief");
    
    expect(result.timeline.length).toBeGreaterThan(0);
    
    const phases = result.timeline.filter((e) => e.type === "phase");
    expect(phases.length).toBe(4); // 4 个阶段
  });
});
```

### 性能基准测试

```typescript
// src/lib/agents/performance-benchmark.test.ts
describe("Performance Benchmark", () => {
  it("parallel executor should be faster than sequential", async () => {
    const calls = [
      { name: "generate_images", args: { prompt: "test1" } },
      { name: "generate_images", args: { prompt: "test2" } },
      { name: "generate_images", args: { prompt: "test3" } },
    ];
    
    // 串行执行
    const seqStart = performance.now();
    for (const call of calls) {
      await executeTool(call);
    }
    const seqDuration = performance.now() - seqStart;
    
    // 并行执行
    const parallelExecutor = new ParallelToolExecutor();
    const parStart = performance.now();
    await parallelExecutor.executeInLayers(
      calls.map((c, i) => ({ ...c, id: `call${i}`, deps: [] }))
    );
    const parDuration = performance.now() - parStart;
    
    console.log(`串行: ${seqDuration}ms, 并行: ${parDuration}ms`);
    expect(parDuration).toBeLessThan(seqDuration * 0.5); // 并行至少快 2 倍
  });
});
```

---

## 五、监控与可观测性

### 性能指标收集

```typescript
// src/lib/agents/telemetry.ts
export interface AgentMetrics {
  agentName: string;
  taskType: string;
  duration: number;
  tokensUsed: number;
  toolCallsCount: number;
  parallelLayers?: number;
  success: boolean;
  timestamp: number;
}

export class AgentTelemetry {
  private metrics: AgentMetrics[] = [];
  
  recordExecution(metric: AgentMetrics) {
    this.metrics.push(metric);
    
    // 存储到数据库或发送到监控系统
    this.persist(metric);
  }
  
  getAveragePerformance(agentName: string): {
    avgDuration: number;
    avgTokens: number;
    successRate: number;
  } {
    const agentMetrics = this.metrics.filter((m) => m.agentName === agentName);
    
    return {
      avgDuration: average(agentMetrics.map((m) => m.duration)),
      avgTokens: average(agentMetrics.map((m) => m.tokensUsed)),
      successRate: agentMetrics.filter((m) => m.success).length / agentMetrics.length,
    };
  }
}
```

### 日志示例

```
[2026-09-29T14:22:03] [ArchitectAgent] 开始结构规划 { brief: "Design a SaaS landing page" }
[2026-09-29T14:22:08] [ArchitectAgent] 结构规划完成 { screenCount: 3, duration: 4523 }
[2026-09-29T14:22:08] [DesignerAgent] 开始视觉规划 { structure: {...} }
[2026-09-29T14:22:12] [DesignerAgent] 视觉规划完成 { duration: 3842 }
[2026-09-29T14:22:12] [ImageExecutorAgent] 并行生成 5 张图像
[2026-09-29T14:22:42] [ImageExecutorAgent] 图像生成完成 { successCount: 5, duration: 30124 }
[2026-09-29T14:22:45] [CriticAgent] 质量检查完成 { score: 8.5, suggestions: 2 }
[2026-09-29T14:22:45] [AgentCoordinator] 设计流程完成 { totalDuration: 42315, phases: 4 }
```

---

## 六、最佳实践

### 1. Agent 设计原则

✅ **单一职责**：每个 Agent 只做一件事  
✅ **结构化输出**：输出 JSON，便于下游使用  
✅ **验证输出**：防止错误传播到下游  
✅ **详细日志**：记录关键决策和性能指标  

### 2. 并行执行原则

✅ **声明依赖**：明确工具之间的依赖关系  
✅ **幂等性**：重复调用结果一致  
✅ **超时控制**：防止单个工具阻塞整个流程  
✅ **错误隔离**：一个工具失败不影响其他工具  

### 3. 集成原则

✅ **渐进式**：先试点，再推广  
✅ **降级策略**：新系统失败时回退到旧系统  
✅ **监控优先**：记录指标，数据驱动优化  
✅ **用户可选**：提供开关，让用户选择系统  

---

## 七、下一步计划

### 立即可做
- [ ] 完善 ArchitectAgent 的提示词
- [ ] 实现 CriticAgent（质量检查）
- [ ] 编写集成测试
- [ ] 添加性能监控

### 近期目标
- [ ] 在生产环境 A/B 测试
- [ ] 收集用户反馈
- [ ] 基于数据优化路由逻辑

### 长期目标
- [ ] 支持用户自定义 Agent
- [ ] 可视化工作流编辑器
- [ ] 分布式执行支持

---

## 八、参考资源

- [LangChain Agent 文档](https://python.langchain.com/docs/modules/agents/)
- [LangGraph 最佳实践](https://langchain-ai.github.io/langgraph/)
- [并行执行模式](https://en.wikipedia.org/wiki/Topological_sorting)
- [Agent 架构设计](https://www.anthropic.com/research/building-effective-agents)

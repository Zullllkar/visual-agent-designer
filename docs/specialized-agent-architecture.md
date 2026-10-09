# 专业化 Agent 架构设计

## 设计理念

**核心思想**：不替换现有的 LangGraph 实现，而是在其基础上构建一个专业化的多 Agent 协作层。

```
现有架构（保留）:
├── ChatOrchestrator (规则引擎决策)
├── AgentRunService (生命周期管理)
└── LangGraph ReAct Agent (通用 agent loop)

新增架构（专业化）:
├── SpecializedAgentTeam (专业 agent 团队)
│   ├── ArchitectAgent (结构规划专家)
│   ├── DesignerAgent (视觉方向专家)
│   ├── ImagePlannerAgent (图像规划专家)
│   ├── ImageExecutorAgent (图像生成专家)
│   └── CriticAgent (质量检查专家)
├── AgentCoordinator (协调器 - 管理 agent 协作)
└── ParallelToolExecutor (工具并行执行器 - 已实现)
```

## 架构分层

### Layer 1: 现有系统（保持不变）

**ChatOrchestrator**
- 继续作为入口点
- 使用规则引擎决定何时使用专业化 agents
- 简单任务继续使用现有 LangGraph 流程

**AgentRunService**
- 保留现有的生命周期管理
- 继续支持工具确认、持久化、超时等功能

### Layer 2: 专业化 Agent 层（新增）

**设计原则**：
1. **职责单一**：每个 agent 只专注一个领域
2. **可组合**：agents 可以灵活组合成不同的工作流
3. **并行优先**：独立任务并行执行
4. **向后兼容**：不破坏现有功能

## 专业化 Agent 定义

### 1. ArchitectAgent (结构规划专家)

**职责**：
- 分析用户需求，规划页面结构
- 决定有多少个 screen、每个 screen 的布局
- 输出结构化的设计规范

**输入**：
- `userBrief`: 用户简报（来自 generate_brief）
- `projectContext`: 项目上下文

**输出**：
```typescript
interface ArchitectureSpec {
  screens: Array<{
    id: string;
    name: string;
    purpose: string;
    layout: "hero" | "grid" | "list" | "form";
    sections: string[];
  }>;
  navigation: {
    type: "single-page" | "multi-page";
    structure: string;
  };
}
```

**工具调用**：
- `generate_brief` (如果还没有 brief)
- `inspect_canvas` (查看现有设计)

### 2. DesignerAgent (视觉方向专家)

**职责**：
- 定义整体视觉风格
- 选择配色、字体、视觉语言
- 确保品牌一致性

**输入**：
- `architectureSpec`: 结构规范
- `brandKit`: 品牌资产（如果有）

**输出**：
```typescript
interface DesignDirection {
  colorPalette: {
    primary: string;
    secondary: string;
    accent: string;
    backgrounds: string[];
  };
  typography: {
    headingFont: string;
    bodyFont: string;
    scale: string;
  };
  visualStyle: "minimal" | "bold" | "playful" | "corporate";
  mood: string[];
}
```

**工具调用**：
- `plan_design_direction`
- `brand_kit` (读取品牌资产)

### 3. ImagePlannerAgent (图像规划专家)

**职责**：
- 根据结构和视觉方向，规划需要生成的图像
- 为每张图像编写详细的 prompt
- 决定图像的尺寸、风格、用途

**输入**：
- `architectureSpec`: 结构规范
- `designDirection`: 视觉方向

**输出**：
```typescript
interface ImagePlan {
  images: Array<{
    id: string;
    screenId: string;
    purpose: "hero" | "illustration" | "icon" | "background";
    prompt: string;
    size: { width: number; height: number };
    style: string;
  }>;
}
```

**工具调用**：
- 无（纯规划，不执行生成）

### 4. ImageExecutorAgent (图像生成专家)

**职责**：
- 并行执行所有图像生成任务
- 管理图像生成的并发控制
- 处理生成失败和重试

**输入**：
- `imagePlan`: 图像规划

**输出**：
```typescript
interface GeneratedImages {
  images: Array<{
    id: string;
    assetId: string;
    url: string;
    status: "success" | "failed";
    error?: string;
  }>;
}
```

**工具调用**：
- `generate_images` (并行执行多次)

### 5. CriticAgent (质量检查专家)

**职责**：
- 检查生成的设计是否符合要求
- 发现问题并提出改进建议
- 决定是否需要重新生成

**输入**：
- `architectureSpec`: 结构规范
- `designDirection`: 视觉方向
- `generatedImages`: 生成的图像
- `project`: 完整项目

**输出**：
```typescript
interface QualityReport {
  overallScore: number; // 0-100
  issues: Array<{
    severity: "critical" | "major" | "minor";
    category: "composition" | "color" | "content" | "consistency";
    description: string;
    suggestion: string;
    affectedAssets: string[];
  }>;
  approved: boolean;
}
```

**工具调用**：
- `inspect_canvas`
- `screenshot_canvas`

## 协作工作流

### 工作流 1: 完整设计流程

```typescript
async function completeDesignWorkflow(userInput: string) {
  // Phase 1: 规划（串行 - 有依赖）
  const architect = new ArchitectAgent();
  const designer = new DesignerAgent();
  
  const [architectureSpec, designDirection] = await runSequential([
    () => architect.plan(userInput),
    (spec) => designer.planDirection(spec),
  ]);

  // Phase 2: 图像规划（依赖 Phase 1）
  const imagePlanner = new ImagePlannerAgent();
  const imagePlan = await imagePlanner.plan({
    architectureSpec,
    designDirection,
  });

  // Phase 3: 图像生成（并行 - 无依赖）
  const imageExecutor = new ImageExecutorAgent();
  const generatedImages = await imageExecutor.executeParallel(imagePlan);

  // Phase 4: 质量检查（依赖 Phase 3）
  const critic = new CriticAgent();
  const qualityReport = await critic.review({
    architectureSpec,
    designDirection,
    generatedImages,
  });

  // Phase 5: 迭代改进（如果需要）
  if (!qualityReport.approved) {
    return await refineDesign(qualityReport, generatedImages);
  }

  return {
    project: buildProject(architectureSpec, designDirection, generatedImages),
    qualityReport,
  };
}
```

**时间对比**：

| Phase | 串行执行 | 并行执行 | 加速比 |
|-------|---------|---------|--------|
| Phase 1 | 5s | 5s | 1x |
| Phase 2 | 3s | 3s | 1x |
| Phase 3 | 150s (5图×30s) | 30s | **5x** |
| Phase 4 | 5s | 5s | 1x |
| **总计** | **163s** | **43s** | **3.8x** |

### 工作流 2: 快速原型

```typescript
async function quickPrototypeWorkflow(userInput: string) {
  // 只用 Architect + Designer，不生成图像
  const [spec, direction] = await Promise.all([
    new ArchitectAgent().plan(userInput),
    new DesignerAgent().quickDirection(userInput),
  ]);

  return { spec, direction };
}
```

**时间**：5s（并行执行）vs 8s（串行执行）

### 工作流 3: 仅图像生成

```typescript
async function generateImagesOnly(prompts: string[]) {
  const executor = new ImageExecutorAgent();
  
  // 并行生成所有图像
  return await executor.generateBatch(prompts);
}
```

**时间**：30s（并行）vs 150s（串行，5图）

## Agent 协调器

**AgentCoordinator** 负责：
1. 选择合适的工作流
2. 管理 agent 生命周期
3. 处理 agent 之间的数据传递
4. 错误恢复和重试

```typescript
class AgentCoordinator {
  private agents: Map<string, SpecializedAgent>;
  
  async runWorkflow(
    workflowType: "complete" | "quick" | "images-only",
    input: any
  ) {
    switch (workflowType) {
      case "complete":
        return await this.completeDesignWorkflow(input);
      case "quick":
        return await this.quickPrototypeWorkflow(input);
      case "images-only":
        return await this.generateImagesOnly(input);
    }
  }
  
  private async completeDesignWorkflow(input: any) {
    // 实现完整流程
  }
}
```

## 与现有系统集成

### 集成点 1: ChatOrchestrator

```typescript
// chat-orchestrator.ts

async function handleUserMessage(message: string) {
  // 规则引擎决策
  const decision = await planOrchestratorTools(message);
  
  if (decision.useSpecializedAgents) {
    // 新：使用专业化 agent 团队
    const coordinator = new AgentCoordinator();
    return await coordinator.runWorkflow(
      decision.workflowType,
      message
    );
  } else {
    // 旧：使用现有 LangGraph agent
    return await runLangGraphAgent(message);
  }
}
```

### 集成点 2: 工具并行执行

```typescript
// 专业化 agents 使用 ParallelToolExecutor
class ImageExecutorAgent {
  async executeParallel(plan: ImagePlan) {
    const calls = plan.images.map(img => ({
      id: img.id,
      name: "generate_images",
      args: { prompt: img.prompt, size: img.size },
    }));
    
    // 使用已实现的并行执行器
    return await executeToolsInParallel(calls, this.context, {
      maxConcurrency: 5,
      toolTimeout: 300000,
    });
  }
}
```

### 集成点 3: 工具确认机制

```typescript
// 专业化 agents 继续使用现有的确认机制
class ImageExecutorAgent {
  async generate(prompt: string) {
    // 通过 AgentRunService 执行（自动处理确认）
    return await this.agentRunService.executeTool(
      "generate_images",
      { prompt }
    );
  }
}
```

## 实现路径

### Phase 1: 基础设施（已完成）
- ✅ 工具依赖图分析
- ✅ 并行工具执行器
- ✅ 性能基准测试

### Phase 2: 专业化 Agents（进行中）
- [ ] ArchitectAgent 实现
- [ ] DesignerAgent 实现
- [ ] ImagePlannerAgent 实现
- [ ] ImageExecutorAgent 实现
- [ ] CriticAgent 实现

### Phase 3: 协调器
- [ ] AgentCoordinator 实现
- [ ] 工作流定义和执行
- [ ] 与 ChatOrchestrator 集成

### Phase 4: 优化和扩展
- [ ] Agent 间通信优化
- [ ] 智能工作流选择
- [ ] 更多工作流模板
- [ ] Agent 插件系统

## 优势总结

**相比现有 LangGraph 方案**：

1. **性能提升**
   - 并行执行独立任务：3-5 倍加速
   - 专业化减少 token 消耗：每个 agent 上下文更小

2. **可维护性提升**
   - 职责明确：每个 agent 只做一件事
   - 易于测试：单个 agent 可以独立测试
   - 易于扩展：添加新 agent 不影响现有的

3. **用户体验提升**
   - 更快的响应时间
   - 更清晰的进度反馈
   - 更好的错误恢复

4. **向后兼容**
   - 不破坏现有功能
   - 简单任务继续使用 LangGraph
   - 复杂任务使用专业化 agents

## 决策树：何时使用哪个系统？

```
用户请求
  │
  ├─ 简单对话 → LangGraph (现有)
  ├─ 单个工具调用 → LangGraph (现有)
  ├─ 完整设计流程 → SpecializedAgents (新)
  ├─ 批量图像生成 → ImageExecutorAgent (新)
  └─ 复杂多步骤任务 → AgentCoordinator (新)
```

这种设计既保留了现有系统的优势（稳定、功能完整），又引入了专业化 agents 的优势（性能、可维护性）。

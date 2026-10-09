/**
 * 专业化 Agent 系统集成指南
 * --------------------------------------------------------------
 * 展示如何将新的专业化 agent 系统与现有的 LangGraph 系统集成
 */

import { AgentCoordinator, type WorkflowType } from "./agent-coordinator";
import type { ToolContext } from "../tools/types";
import type { ProjectFile } from "@/lib/project/schema";

/**
 * 决策：何时使用专业化 agents？
 */
export function shouldUseSpecializedAgents(
  userMessage: string,
  project: ProjectFile | null
): { use: boolean; workflowType?: WorkflowType; reason: string } {
  const msg = userMessage.toLowerCase();

  // 规则 1: 完整设计流程
  if (
    msg.includes("design a") ||
    msg.includes("create a") ||
    msg.includes("build a") ||
    msg.includes("make a landing page") ||
    msg.includes("make a website")
  ) {
    return {
      use: true,
      workflowType: "complete",
      reason: "完整设计流程：需要结构 + 视觉 + 图像",
    };
  }

  // 规则 2: 快速原型
  if (
    msg.includes("quick") ||
    msg.includes("fast") ||
    msg.includes("prototype") ||
    msg.includes("sketch")
  ) {
    return {
      use: true,
      workflowType: "quick-prototype",
      reason: "快速原型：并行执行以加速",
    };
  }

  // 规则 3: 批量图像生成
  const imageCountMatch = msg.match(/(\d+)[^\n]{0,24}(image|图像|图片)/);
  const imageCount = imageCountMatch ? Number(imageCountMatch[1]) : 0;
  if (
    imageCount > 0 ||
    msg.includes("generate images") ||
    msg.includes("create images") ||
    msg.includes("生成图像")
  ) {
    return {
      use: true,
      workflowType: "images-only",
      reason: `批量图像生成：${imageCount || "多张"}图像并行生成`,
    };
  }

  // 规则 4: 仅规划
  if (
    msg.includes("plan the structure") ||
    msg.includes("architecture") ||
    msg.includes("layout plan") ||
    msg.includes("规划结构")
  ) {
    return {
      use: true,
      workflowType: "architecture-only",
      reason: "仅结构规划：不需要生成图像",
    };
  }

  // 规则 5: 仅视觉方向
  if (
    msg.includes("design direction") ||
    msg.includes("visual style") ||
    msg.includes("color palette") ||
    msg.includes("视觉方向")
  ) {
    return {
      use: true,
      workflowType: "design-only",
      reason: "仅视觉方向：定义配色和风格",
    };
  }

  // 默认：使用现有 LangGraph 系统
  return {
    use: false,
    reason: "简单任务或聊天，使用现有 LangGraph",
  };
}

/**
 * 集成到 ChatOrchestrator
 *
 * 在 chat-orchestrator.ts 中添加：
 */
export async function handleUserMessageWithSpecializedAgents(
  userMessage: string,
  project: ProjectFile | null,
  toolContext: ToolContext,
  anthropicApiKey: string
): Promise<any> {
  // 1. 决策：是否使用专业化 agents
  const decision = shouldUseSpecializedAgents(userMessage, project);

  console.log(`[Integration] Decision:`, decision);

  if (!decision.use) {
    // 使用现有 LangGraph 系统
    console.log(`[Integration] 使用现有 LangGraph 系统`);
    // return await runLangGraphAgent(...);
    return { message: "使用现有系统处理" };
  }

  // 2. 使用专业化 agent 系统
  console.log(`[Integration] 使用专业化 Agent 系统: ${decision.workflowType}`);

  const coordinator = new AgentCoordinator(anthropicApiKey);
  coordinator.setToolContext(toolContext);

  // 3. 估算时间（可选：向用户展示）
  const estimate = coordinator.estimateDuration({
    userInput: userMessage,
    workflowType: decision.workflowType!,
  });

  console.log(
    `[Integration] 预计耗时: ${estimate.estimated}ms`,
    estimate.breakdown
  );

  // 4. 执行工作流
  try {
    const result = await coordinator.execute({
      userInput: userMessage,
      workflowType: decision.workflowType!,
    });

    console.log(`[Integration] 执行完成:`, {
      totalDuration: result.metadata.totalDuration,
      agents: result.metadata.agentExecutions.map(e => ({
        name: e.agentName,
        duration: e.duration,
        success: e.success,
      })),
    });

    return result;
  } catch (error) {
    console.error(`[Integration] 执行失败:`, error);
    throw error;
  }
}

/**
 * 性能对比示例
 */
export async function performanceComparison(
  anthropicApiKey: string,
  toolContext: ToolContext
) {
  const testInput = {
    userInput: "Create a SaaS landing page with 5 hero images",
    workflowType: "complete" as WorkflowType,
    options: { maxImages: 5 },
  };

  console.log("\n=== 性能对比 ===\n");

  // 1. 专业化 agents（并行）
  console.log("测试 1: 专业化 Agents（并行执行）");
  const coordinator = new AgentCoordinator(anthropicApiKey);
  coordinator.setToolContext(toolContext);

  const specializedStart = Date.now();
  try {
    const result = await coordinator.execute(testInput);
    const specializedDuration = Date.now() - specializedStart;

    console.log("专业化 Agents 结果:");
    console.log(`  总耗时: ${specializedDuration}ms`);
    console.log(`  Agent 执行:`);
    result.metadata.agentExecutions.forEach(e => {
      console.log(`    - ${e.agentName}: ${e.duration}ms (${e.success ? "✓" : "✗"})`);
    });

    if (result.generatedImages) {
      console.log(`  图像生成:`);
      console.log(`    - 成功: ${result.generatedImages.stats.successCount}`);
      console.log(`    - 失败: ${result.generatedImages.stats.failedCount}`);
      console.log(`    - 平均耗时: ${result.generatedImages.stats.averageDuration}ms`);
    }
  } catch (error) {
    console.error("专业化 Agents 失败:", error);
  }

  // 2. 现有 LangGraph（串行）
  console.log("\n测试 2: 现有 LangGraph（串行执行）");
  console.log("（假设数据，实际需要运行）");
  const langGraphEstimate = 3000 + 3000 + 5 * 30000; // architect + designer + 5图串行
  console.log(`  预计耗时: ${langGraphEstimate}ms`);

  // 3. 对比
  console.log("\n=== 对比结果 ===");
  // const speedup = langGraphEstimate / specializedDuration;
  // console.log(`加速比: ${speedup.toFixed(2)}x`);
}

/**
 * 使用示例
 */
export function usageExamples() {
  console.log(`
专业化 Agent 系统使用示例
==============================

1. 完整设计流程
--------------
输入: "Design a modern SaaS landing page for AI tool"
工作流: complete
预计时间: ~40s (并行)
vs 现有系统: ~163s (串行)
加速比: 4x

2. 快速原型
-----------
输入: "Quick sketch of a dashboard layout"
工作流: quick-prototype
预计时间: ~1s (并行 + 启发式)
vs 现有系统: ~8s (串行)
加速比: 8x

3. 批量图像生成
--------------
输入: "Generate 5 hero images for landing page"
工作流: images-only
预计时间: ~30s (并行，5图同时生成)
vs 现有系统: ~150s (串行，5图依次生成)
加速比: 5x

4. 仅结构规划
-------------
输入: "Plan the structure for a blog website"
工作流: architecture-only
预计时间: ~3s
vs 现有系统: ~5s
加速比: 1.7x

5. 仅视觉方向
-------------
输入: "Define a bold visual style with red accent"
工作流: design-only
预计时间: ~3.5s
vs 现有系统: ~5s
加速比: 1.4x

集成代码示例
============

// 在 chat-orchestrator.ts 中:

import { shouldUseSpecializedAgents, handleUserMessageWithSpecializedAgents } from './specialized/integration-guide';

export async function handleUserMessage(message: string, context: any) {
  const decision = shouldUseSpecializedAgents(message, context.project);

  if (decision.use) {
    console.log(\`使用专业化 Agents: \${decision.reason}\`);
    return await handleUserMessageWithSpecializedAgents(
      message,
      context.project,
      context.toolContext,
      context.apiKey
    );
  }

  // 否则使用现有 LangGraph
  return await runLangGraphAgent(message, context);
}

关键优势
========

1. **性能提升**
   - 并行执行独立任务（3-5 倍加速）
   - 专业化减少上下文（更快的 LLM 调用）

2. **可维护性**
   - 每个 agent 职责单一
   - 易于测试和调试
   - 易于添加新 agents

3. **向后兼容**
   - 不破坏现有功能
   - 简单任务继续使用 LangGraph
   - 逐步迁移，无需一次性重写

4. **用户体验**
   - 更快的响应时间
   - 清晰的进度反馈
   - 更好的错误恢复

注意事项
========

1. 两个系统需要共享 ToolContext
2. 工具确认机制继续使用现有的 AgentRunService
3. 持久化继续使用现有的项目文件系统
4. 错误处理需要适配两种系统

下一步
======

1. ✅ 基础设施（并行执行器）
2. ✅ 专业化 Agents（Architect, Designer, ImageExecutor）
3. ✅ 协调器（AgentCoordinator）
4. ⬜ 集成到 ChatOrchestrator
5. ⬜ 添加 UI 进度展示
6. ⬜ 性能监控和分析
7. ⬜ 用户反馈收集
  `);
}

// 导出供测试使用
export { AgentCoordinator } from "./agent-coordinator";
export { ArchitectAgent } from "./architect-agent";
export { DesignerAgent } from "./designer-agent";
export { ImageExecutorAgent } from "./image-executor-agent";

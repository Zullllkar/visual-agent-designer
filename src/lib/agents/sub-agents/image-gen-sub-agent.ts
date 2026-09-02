/**
 * Image Generation Sub-Agent
 * --------------------------------------------------------------
 * 专门负责批量生图任务，支持更复杂的生图策略。
 */

import { ImagePlannerAgent } from "@/lib/agents/image-planner-agent";
import { ImageExecutorAgent } from "@/lib/agents/image-executor-agent";
import type { SubAgent } from "./types";
import { parseRequestedImageCount, ProjectFileSchema } from "@/lib/agents/tools/utils";

export const imageGenSubAgent: SubAgent = {
  name: "image-generation",
  description: "批量生成视觉素材，支持自定义数量和风格",
  keywords: ["生成素材", "生图", "批量生成", "generate images", "视觉素材"],

  async run(input) {
    if (!input.project?.brief) {
      throw new Error("缺少 brief，无法生图");
    }

    const requestedCount = parseRequestedImageCount(input.task) ?? 1;
    const plan = await ImagePlannerAgent.run(
      {
        brief: input.project.brief,
        pages: [],
        designDirection: input.project.designDirection,
        standaloneCount: requestedCount,
      },
      input.agentCtx
    );

    if (plan.tasks.length === 0) {
      return { summary: "没有待生成的视觉素材。" };
    }

    const executed = await ImageExecutorAgent.run(
      {
        brief: input.project.brief,
        pages: [],
        plan,
        providerConfig: input.providerConfig,
      },
      input.agentCtx
    );

    const updated = ProjectFileSchema.parse({
      ...input.project,
      assets: [...(input.project.assets ?? []), ...executed.assets],
      updatedAt: new Date().toISOString(),
    });

    return {
      summary: `Sub-Agent 生图完成 ${executed.succeeded}/${plan.tasks.length}`,
      updatedProject: updated,
      data: { succeeded: executed.succeeded, failed: executed.failed },
    };
  },
};

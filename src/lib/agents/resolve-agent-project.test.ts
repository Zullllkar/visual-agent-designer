import { describe, expect, it } from "vitest";

import { createPlaceholderProject } from "@/lib/project/placeholder";
import type { ToolContext } from "@/lib/agents/tools/types";
import type { AgentContext } from "@/lib/agents/types";
import {
  attachProjectToToolContext,
  resolveAgentContextProjectId,
} from "@/lib/agents/resolve-agent-project";
import { resolveBoundProjectId } from "@/lib/studio/bound-project-id";
import { inspectCanvasTool } from "@/lib/agents/tools/inspect-canvas";

function agentCtx(projectId: string): AgentContext {
  return {
    projectId,
    scratch: {},
    providers: {
      llm: {} as never,
      image: {} as never,
      visionCritic: false,
    },
  };
}

describe("resolveAgentContextProjectId", () => {
  it("keeps the open project id when disk load returned null", () => {
    expect(resolveAgentContextProjectId(null, "xiaohongshu-cover")).toBe(
      "xiaohongshu-cover",
    );
  });

  it("prefers the loaded project id when both exist", () => {
    expect(
      resolveAgentContextProjectId({ id: "from-disk" }, "from-client"),
    ).toBe("from-disk");
  });
});

describe("attachProjectToToolContext", () => {
  it("reloads the open project so inspect_canvas is not empty", async () => {
    const project = createPlaceholderProject("xiaohongshu-cover", "GPT-6 封面");
    const ctx: ToolContext = {
      project: null,
      userMessage: "检查画布",
      agentCtx: agentCtx("xiaohongshu-cover"),
    };

    const attached = await attachProjectToToolContext(ctx, async (id) =>
      id === "xiaohongshu-cover" ? project : null,
    );

    expect(attached?.id).toBe("xiaohongshu-cover");
    expect(ctx.project?.id).toBe("xiaohongshu-cover");

    const inspected = await inspectCanvasTool.execute({}, ctx);
    expect(inspected.summary).not.toContain("没有打开的项目");
    expect(inspected.summary).toContain("画布检查");
  });
});

describe("resolveBoundProjectId", () => {
  it("reuses the workspace project id when the in-memory store missed it", () => {
    expect(
      resolveBoundProjectId({
        existingId: undefined,
        boundProjectId: "xiaohongshu-cover",
      }),
    ).toBe("xiaohongshu-cover");
  });
});

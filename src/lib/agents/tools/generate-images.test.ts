import { describe, expect, it, beforeEach } from "vitest";
import { registerAllTools } from "@/lib/agents/tools";
import { toolRegistry } from "@/lib/agents/tools/registry";
import type { ToolContext } from "@/lib/agents/tools/types";
import type { AgentContext } from "@/lib/agents/types";
import type { ProjectFile } from "@/lib/project/schema";

function makeAgentCtx(projectId = "omni-1"): AgentContext {
  return {
    projectId,
    scratch: {},
    providers: {
      llm: { kind: "mock" } as never,
      image: {
        kind: "mock",
        generateImage: async () => ({
          imageUrl: "data:image/png;base64,mock",
          model: "mock",
        }),
      } as never,
      visionCritic: false,
    },
  };
}

function canvasProjectWithoutBrief(id = "omni-1"): ProjectFile {
  return {
    id,
    slug: id,
    title: "omni1.0.3",
    rawIdea: "生成不同设计的版本出来",
    createdAt: "2026-09-18T00:00:00.000Z",
    updatedAt: "2026-09-18T00:00:00.000Z",
    pages: [],
    assets: [],
  };
}

describe("generate_images without brief", () => {
  beforeEach(() => {
    registerAllTools();
  });

  it("does not block a canvas project that never ran generate_brief", async () => {
    const ctx: ToolContext = {
      project: canvasProjectWithoutBrief(),
      userMessage: "生成深色版",
      agentCtx: makeAgentCtx(),
      providerConfig: {
        llm: { kind: "mock" },
        image: { kind: "mock" },
      },
      runId: "run-1",
    };

    const result = await toolRegistry.execute(
      "generate_images",
      {
        prompt: "Dark theme OmniTab home matching the reference",
        count: 1,
        confirmed: true,
        approvalId: "run-1:generate_images",
        mode: "async",
      },
      ctx
    );

    expect(result.summary).not.toMatch(/Missing brief/i);
    expect(result.data).toMatchObject({ jobId: expect.any(String) });
  });

  it("stages generating placeholders and scratch before the job can reload disk", async () => {
    const agentCtx = makeAgentCtx("omni-placeholder");
    const ctx: ToolContext = {
      project: canvasProjectWithoutBrief("omni-placeholder"),
      userMessage: "生成封面",
      agentCtx,
      providerConfig: {
        llm: { kind: "mock" },
        image: { kind: "mock" },
      },
      runId: "run-placeholder",
    };

    const result = await toolRegistry.execute(
      "generate_images",
      {
        prompt: "Xiaohongshu cover for GPT-6",
        count: 1,
        confirmed: true,
        approvalId: "run-placeholder:generate_images",
        mode: "async",
      },
      ctx
    );

    const pending = result.updatedProject?.assets ?? [];
    expect(pending.some((asset) => asset.status === "generating")).toBe(true);
    expect(agentCtx.scratch.__updatedProject).toBe(result.updatedProject);
    expect(result.summary).toMatch(/占位图|正在生成|已开始生成/);
  });

  it("keeps placeholders visible even if the model asked for sync mode", async () => {
    const ctx: ToolContext = {
      project: canvasProjectWithoutBrief("omni-sync-placeholder"),
      userMessage: "生成封面",
      agentCtx: makeAgentCtx("omni-sync-placeholder"),
      providerConfig: {
        llm: { kind: "mock" },
        image: { kind: "mock" },
      },
      runId: "run-sync-placeholder",
    };

    const result = await toolRegistry.execute(
      "generate_images",
      {
        prompt: "Xiaohongshu cover for GPT-6",
        count: 1,
        confirmed: true,
        approvalId: "run-sync-placeholder:generate_images",
        mode: "sync",
      },
      ctx
    );

    expect(result.data).toMatchObject({ jobId: expect.any(String) });
    expect(result.updatedProject?.assets?.some((a) => a.status === "generating")).toBe(
      true
    );
  });

  it("does not queue a second job when the same approval runs again at 1080x1440", async () => {
    const ctx: ToolContext = {
      project: canvasProjectWithoutBrief("omni-dedupe"),
      userMessage: "生成封面",
      agentCtx: makeAgentCtx("omni-dedupe"),
      providerConfig: {
        llm: { kind: "mock" },
        image: { kind: "mock" },
      },
      runId: "run-dedupe",
    };
    const args = {
      prompt: "Xiaohongshu GPT-6 cover",
      count: 1,
      confirmed: true,
      approvalId: "run-dedupe:generate_images",
      mode: "async" as const,
      width: 1080,
      height: 1440,
    };

    const first = await toolRegistry.execute("generate_images", args, ctx);
    const second = await toolRegistry.execute("generate_images", args, ctx);
    const firstJobId = (first.data as { jobId?: string }).jobId;
    const secondData = second.data as { jobId?: string; deduped?: boolean };

    expect(firstJobId).toEqual(expect.any(String));
    expect(secondData.jobId).toBe(firstJobId);
    expect(secondData.deduped).toBe(true);
  });
});

import { describe, expect, it } from "vitest";

import { askDiscoveryTool } from "./ask-discovery";
import type { ToolContext } from "./types";

function mockCtx(userMessage: string): ToolContext {
  return {
    project: null,
    userMessage,
    agentCtx: { projectId: "p1", scratch: {}, providers: {} as never },
    providerConfig: {} as never,
  };
}

describe("askDiscoveryTool", () => {
  it("can run after direction is set so adjust questions are not rejected", () => {
    expect(askDiscoveryTool.inputPhase).toEqual([
      "DISCOVERY",
      "DISCOVERY",
      "BRIEF",
      "DIRECTION",
      "GENERATION",
      "REVIEW",
    ]);
  });

  it("fills a prefilled form when the model omits questions", async () => {
    const ctx = mockCtx("帮我做一个产品落地页");
    const result = await askDiscoveryTool.execute({}, ctx);
    const form = ctx.agentCtx.scratch.__discoveryQuestions as {
      questions: Array<{ id: string; default?: string }>;
    };
    expect(form.questions.length).toBeGreaterThan(0);
    expect(form.questions.find((q) => q.id === "productType")?.default).toBe(
      "landing"
    );
    expect(result.data).toMatchObject({ questionsAsked: true });
  });

  it("fills a direction-adjust form when the user clicked 我想调整", async () => {
    const ctx = mockCtx(
      "[视觉方向调整] 我希望调整当前视觉方向，请先询问我需要修改的部分。"
    );
    await askDiscoveryTool.execute({}, ctx);
    const form = ctx.agentCtx.scratch.__discoveryQuestions as {
      title: string;
      questions: Array<{ id: string }>;
    };
    expect(form.title).toMatch(/调整视觉方向/);
    expect(form.questions.some((q) => q.id === "mood")).toBe(true);
  });
});

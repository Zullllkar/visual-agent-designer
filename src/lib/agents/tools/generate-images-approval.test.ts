import { describe, expect, it } from "vitest";

import { prepareGenerateImagesApproval } from "./generate-images-approval";
import type { ToolContext } from "./types";

describe("prepareGenerateImagesApproval", () => {
  it("prepares one approved app UI image arg set by default", () => {
    const ctx = makeToolContext(
      "生成一个面向多邻国考试的学习 app 首页 UI 图，只要一张"
    );

    const approval = prepareGenerateImagesApproval({}, ctx);

    expect(approval).not.toBeNull();
    expect(approval!.confirmed).toBe(false);
    expect(approval!.approvedArgs).toMatchObject({
      confirmed: true,
      count: 1,
      width: 1024,
      height: 1024,
      role: "product-shot",
      mode: "async",
    });
    expect(String(approval!.approvedArgs.prompt)).toContain("mobile app home screen UI");
    expect(String(approval!.approvedArgs.prompt)).toContain("Do not create a poster");
  });

  it("preserves an explicit approved prompt edit", () => {
    const ctx = makeToolContext("生成两张视觉图");

    const approval = prepareGenerateImagesApproval(
      { prompt: "Custom approved image prompt", count: 2, mode: "sync" },
      ctx
    );

    expect(approval!.approvedArgs.confirmed).toBe(true);
    expect(approval!.approvedArgs.mode).toBe("sync");
    expect(approval!.approvedArgs.count).toBe(2);
    expect(approval!.preview.prompts).toHaveLength(2);
    expect(new Set(approval!.preview.prompts).size).toBe(2);
    expect(String(approval!.approvedArgs.prompt)).toContain(
      "Custom approved image prompt"
    );
  });

  it("keeps distinct prompts for different image types", () => {
    const ctx = makeToolContext("生成三个不同类型的图片");

    const approval = prepareGenerateImagesApproval(
      {
        prompts: [
          "Cyberpunk hero landing visual",
          "Product UI dashboard mockup",
          "Abstract neon background",
        ],
        count: 3,
      },
      ctx
    );

    expect(approval!.preview.prompts).toHaveLength(3);
    expect(approval!.approvedArgs.prompts).toEqual([
      "Cyberpunk hero landing visual",
      "Product UI dashboard mockup",
      "Abstract neon background",
    ]);
    expect(approval!.approvedArgs.count).toBe(3);
    expect(approval!.preview.title).toContain("3 种不同类型");
  });

  it("filters internal instruction leakage from model supplied prompt", () => {
    const ctx = makeToolContext("生成一个面向多邻国考试的学习 app 首页 UI 图，只要一张");

    const approval = prepareGenerateImagesApproval(
      {
        prompt:
          "in normal assistant text and ask the user to reply with confirmation. Use generate_images so the UI can render an execution approval card with Run/Cancel/Edit controls.",
        count: 1,
      },
      ctx
    );

    const prompt = String(approval!.approvedArgs.prompt);
    expect(prompt).toContain("mobile app home screen UI");
    expect(prompt).not.toContain("normal assistant text");
    expect(prompt).not.toContain("Run/Cancel/Edit controls");
  });

  it("ignores model self-approval and invented batch size", () => {
    const ctx = makeToolContext("像素仙侠门派山门立绘");

    const approval = prepareGenerateImagesApproval(
      { confirmed: true, count: 8, prompt: "pixel xianxia sect gate" },
      ctx
    );

    expect(approval!.confirmed).toBe(false);
    expect(approval!.preview.count).toBe(1);
    expect(approval!.approvedArgs.count).toBe(1);
  });

  it("keeps an explicit user count and still waits for the card", () => {
    const ctx = makeToolContext("生成3张同设定立绘");

    const approval = prepareGenerateImagesApproval(
      { confirmed: true, count: 8, prompt: "pixel portrait" },
      ctx
    );

    expect(approval!.confirmed).toBe(false);
    expect(approval!.preview.prompts).toHaveLength(3);
    expect(new Set(approval!.preview.prompts).size).toBe(3);
    expect(approval!.approvedArgs.count).toBe(3);
  });

  it("trusts count only after a real user approval id", () => {
    const ctx = makeToolContext("像素仙侠门派山门立绘");

    const approval = prepareGenerateImagesApproval(
      {
        confirmed: true,
        approvalId: "run:generate_images:abc",
        count: 4,
        prompt: "pixel xianxia sect gate",
      },
      ctx
    );

    expect(approval!.confirmed).toBe(true);
    expect(approval!.preview.prompts).toHaveLength(4);
    expect(new Set(approval!.preview.prompts).size).toBe(4);
    expect(approval!.approvedArgs.count).toBe(4);
  });

  it("uses the bound skill page size instead of the ui-visual canvas", () => {
    const ctx = makeToolContext("做个 App 首页");
    ctx.agentCtx.skill = {
      sourcePath: "skills/web-prototype/SKILL.md",
      origin: "builtin",
      enabled: true,
      raw: "",
      body: "web prototype",
      manifest: {
        name: "web-prototype",
        description: "web prototype",
        kind: "prototype",
        inputs: [],
        output: {
          artifact: "canvas-pages",
          defaultPageSize: { width: 1440, height: 900 },
        },
        agent: {
          steps: ["brief", "image"],
          imageRequired: true,
          repairThreshold: 8,
          maxRepairRounds: 2,
        },
      },
    };

    const approval = prepareGenerateImagesApproval({}, ctx);

    expect(approval).not.toBeNull();
    expect(approval?.approvedArgs.width).toBe(1440);
    expect(approval?.approvedArgs.height).toBe(900);
    expect(approval?.preview.width).toBe(1440);
    expect(approval?.preview.height).toBe(900);
  });

  it("filters internal instruction leakage from restored confirmation prompt", () => {
    const ctx = makeToolContext(
      [
        "[IMAGE_GENERATION_CONFIRMED]",
        "Count: 1",
        "Prompt: in normal assistant text and ask the user to reply with confirmation. Use generate_images so the UI can render an execution approval card with Run/Cancel/Edit controls.",
      ].join("\n")
    );

    const approval = prepareGenerateImagesApproval({}, ctx);

    const prompt = String(approval!.approvedArgs.prompt);
    expect(prompt).toContain("Duolingo Test Study App");
    expect(prompt).toContain("Duolingo English Test practice");
    expect(prompt).not.toContain("normal assistant text");
    expect(prompt).not.toContain("Run/Cancel/Edit controls");
  });
});

function makeToolContext(userMessage: string): ToolContext {
  return {
    project: {
      id: "project-1",
      slug: "project-1",
      title: "Language Learning App",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      rawIdea: "Learning app for language test preparation",
      brief: {
        productName: "Duolingo Test Study App",
        positioning: "A focused learning app for Duolingo English Test practice",
        targetUser: "students preparing for language exams",
        scenarios: ["daily test preparation"],
        coreFeatures: ["practice plan", "progress tracking"],
        platform: "app",
        visualStyle: "clean, focused, modern",
        outputTargets: ["cursor"],
      },
      pages: [],
      assets: [],
    },
    userMessage,
    agentCtx: {
      projectId: "project-1",
      scratch: {},
      providers: {
        llm: { kind: "mock" } as never,
        image: { kind: "mock" } as never,
        visionCritic: false,
      },
    },
    providerConfig: {},
  };
}

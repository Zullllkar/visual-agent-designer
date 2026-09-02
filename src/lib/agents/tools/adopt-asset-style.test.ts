import { describe, expect, it } from "vitest";

import { adoptAssetStyleTool } from "./adopt-asset-style";
import type { ToolContext } from "./types";
import type { ProjectFile } from "@/lib/project/schema";

function mockCtx(project: ProjectFile): ToolContext {
  return {
    project,
    userMessage: "【引用素材: 像素仙侠#asset_liked】 [采用素材风格]",
    agentCtx: { projectId: project.id, scratch: {}, providers: {} as never },
    providerConfig: {} as never,
  };
}

describe("adoptAssetStyleTool", () => {
  it("locks project direction from the selected picture without restyling when it is the only asset", async () => {
    const project = {
      id: "p1",
      slug: "demo",
      title: "Demo",
      rawIdea: "像素仙侠游戏",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      brief: {
        productName: "剑横扫",
        targetUser: "玩家",
        positioning: "像素仙侠",
        platform: "other",
        visualStyle: "像素 / 仙侠",
        coreFeatures: ["门派"],
        scenarios: ["概念图"],
        outputTargets: ["markdown"],
      },
      pages: [],
      assets: [
        {
          id: "asset_liked",
          prompt: "像素仙侠门派山门，金色飞檐",
          src: "data:image/png;base64,aaa",
          width: 1024,
          height: 1024,
          model: "mock",
          status: "starred",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    } as unknown as ProjectFile;

    const ctx = mockCtx(project);
    const result = await adoptAssetStyleTool.execute(
      { assetId: "asset_liked" },
      ctx
    );

    expect(result.updatedProject?.designDirection?.styleSourceAssetId).toBe(
      "asset_liked"
    );
    expect(result.updatedProject?.designDirection?.summary).toMatch(/像素仙侠门派山门/);
    expect(ctx.agentCtx.scratch.__directionConfirmation).toMatchObject({
      title: "已按选中画面锁定视觉方向",
    });
    expect(result.data).toMatchObject({ restyleCount: 0 });
  });
});

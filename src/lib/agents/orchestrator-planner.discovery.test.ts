import { describe, expect, it } from "vitest";

import { decideToolsFallback } from "./orchestrator-planner";

describe("decideToolsFallback discovery gates", () => {
  it("asks to switch target when a default ui project sounds like game art", () => {
    const decision = decideToolsFallback(
      {
        id: "p1",
        title: "Demo",
        pages: [],
        targetId: "ui-visual",
        targetLocked: false,
      } as never,
      "像素仙侠门派山门立绘"
    );
    expect(decision.calls.map((c) => c.name)).toEqual(["ask_discovery"]);
    expect(String(decision.calls[0]?.args?.title ?? "")).toMatch(/换目标/);
  });

  it("asks discovery on a vague blank-project brief and stops", () => {
    const decision = decideToolsFallback(null, "帮我做一个产品落地页");
    expect(decision.calls.map((c) => c.name)).toEqual(["ask_discovery"]);
  });

  it("skips discovery when type and style are already in the brief", () => {
    const decision = decideToolsFallback(
      null,
      "我要开发一个剑横扫游戏，风格是像素+仙侠"
    );
    expect(decision.calls.map((c) => c.name)).toEqual([
      "generate_brief",
      "plan_design_direction",
      "confirm_direction",
    ]);
  });

  it("continues to brief and direction confirm after discovery answers", () => {
    const decision = decideToolsFallback(
      null,
      "[需求确认回答]\n**要做什么？**：落地页 / 官网 [value: landing]"
    );
    expect(decision.calls.map((c) => c.name)).toEqual([
      "generate_brief",
      "plan_design_direction",
      "confirm_direction",
    ]);
  });

  it("generates images only after the user confirms direction", () => {
    const decision = decideToolsFallback(
      {
        id: "p1",
        title: "Demo",
        brief: { summary: "ok" } as never,
        designDirection: { summary: "pixel xianxia" } as never,
        pages: [],
        assets: [],
      } as never,
      "[视觉方向确认] 当前视觉方向满意，请继续生成视觉素材。"
    );
    expect(decision.calls.map((c) => c.name)).toEqual(["generate_images"]);
  });

  it("shows a direction-adjust form instead of writing questions in prose", () => {
    const decision = decideToolsFallback(
      {
        id: "p1",
        title: "Demo",
        brief: { summary: "ok" } as never,
        designDirection: { summary: "pixel xianxia" } as never,
        pages: [],
        assets: [],
      } as never,
      "[视觉方向调整] 我希望调整当前视觉方向，请先询问我需要修改的部分。"
    );
    expect(decision.calls.map((c) => c.name)).toEqual(["ask_discovery"]);
    expect(decision.calls[0]?.args?.title).toMatch(/调整视觉方向/);
  });

  it("replans direction after the user submits the adjust form", () => {
    const decision = decideToolsFallback(
      {
        id: "p1",
        title: "Demo",
        brief: { summary: "ok" } as never,
        designDirection: { summary: "pixel xianxia" } as never,
        pages: [],
        assets: [],
      } as never,
      "[需求确认回答]\n**整体调性**：更明亮 [value: brighter]"
    );
    expect(decision.calls.map((c) => c.name)).toEqual([
      "plan_design_direction",
      "confirm_direction",
    ]);
  });

  it("adopts a selected picture as the project visual direction", () => {
    const decision = decideToolsFallback(
      {
        id: "p1",
        title: "Demo",
        brief: { summary: "ok", visualStyle: "像素" } as never,
        designDirection: { summary: "old" } as never,
        pages: [],
        assets: [
          {
            id: "asset_liked",
            prompt: "像素仙侠门派",
            src: "data:image/png;base64,aaa",
            status: "starred",
          },
        ],
      } as never,
      "【引用素材: 像素仙侠门派#asset_liked】 [采用素材风格] 按这张图更新项目整体风格"
    );
    expect(decision.calls.map((c) => c.name)).toEqual(["adopt_asset_style"]);
    expect(decision.calls[0]?.args?.assetId).toBe("asset_liked");
  });

  it("confirms direction instead of generating images when direction is missing", () => {
    const decision = decideToolsFallback(
      {
        id: "p1",
        title: "Demo",
        brief: { summary: "ok" } as never,
        pages: [],
        assets: [],
      } as never,
      "帮我规划视觉方向"
    );
    expect(decision.calls.map((c) => c.name)).toEqual([
      "plan_design_direction",
      "confirm_direction",
    ]);
  });
});

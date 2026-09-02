import { describe, expect, it } from "vitest";
import {
  extractChatInlineAnswerText,
  isChatInlineTool,
  isExplicitVisualWorkRequest,
  isLikelyPureQuestion,
} from "./chat-inline-tools";
import { decideToolsFallback } from "./orchestrator-planner";

describe("chat-inline-tools", () => {
  it("recognizes answer_question as chat-inline", () => {
    expect(isChatInlineTool("answer_question")).toBe(true);
    expect(isChatInlineTool("generate_images")).toBe(false);
  });

  it("extracts answer text from tool payloads", () => {
    expect(
      extractChatInlineAnswerText({
        ok: true,
        summary: "先做详情页",
        data: { text: "先做详情页" },
      })
    ).toBe("先做详情页");
    expect(
      extractChatInlineAnswerText(
        JSON.stringify({ summary: "优先 Pricing" })
      )
    ).toBe("优先 Pricing");
  });

  it("classifies planning questions as pure questions", () => {
    expect(
      isLikelyPureQuestion("还需要那些页面要进行生成 在这方面进行思考")
    ).toBe(true);
    expect(isExplicitVisualWorkRequest("还需要那些页面要进行生成 在这方面进行思考")).toBe(
      false
    );
  });

  it("classifies explicit generation as visual work", () => {
    expect(isExplicitVisualWorkRequest("生成一张首页")).toBe(true);
    expect(isExplicitVisualWorkRequest("生图 3 张")).toBe(true);
    expect(isLikelyPureQuestion("生图 3 张")).toBe(false);
  });
});

describe("decideToolsFallback chat mode", () => {
  it("returns chat mode for page-priority questions", () => {
    const decision = decideToolsFallback(
      {
        id: "p1",
        title: "黑核素材库",
        brief: { summary: "ok" } as never,
        designDirection: { summary: "dark" } as never,
        pages: [
          { id: "1", name: "Landing", nodes: [] },
          { id: "2", name: "Login", nodes: [] },
        ],
        assets: [{ id: "a1", prompt: "hero", src: "x", width: 1, height: 1, model: "m", createdAt: "2026-01-01" }],
      } as never,
      "还需要那些页面要进行生成 在这方面进行思考"
    );
    expect(decision.mode).toBe("chat");
    expect(decision.calls).toEqual([]);
  });

  it("still plans generate_images for explicit visual work", () => {
    const decision = decideToolsFallback(
      {
        id: "p1",
        title: "Demo",
        brief: { summary: "ok" } as never,
        designDirection: { summary: "dark" } as never,
        pages: [],
        assets: [],
      } as never,
      "生成一张首页"
    );
    expect(decision.mode).toBe("tools");
    expect(decision.calls.some((c) => c.name === "generate_images")).toBe(true);
  });
});

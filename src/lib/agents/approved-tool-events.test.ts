import { describe, expect, it } from "vitest";
import {
  approvedToolResultEventOrder,
  imageApprovalNarration,
  imageApprovalThinkingText,
  shouldCanvasSyncOnToolCompleted,
} from "./approved-tool-events";

describe("approved tool follow-up events", () => {
  it("emits project.update before tool.completed when placeholders exist", () => {
    expect(approvedToolResultEventOrder(true)).toEqual([
      "project.update",
      "tool.completed",
    ]);
  });

  it("explains generation in Chinese after the user confirms", () => {
    expect(imageApprovalThinkingText("generate_images")).toMatch(/正在生成/);
    expect(imageApprovalNarration("generate_images")).toMatch(/占位图/);
    expect(imageApprovalThinkingText("generate_images")).not.toMatch(/User approved/);
  });

  it("does not canvas.sync on generate_images tool.completed", () => {
    expect(shouldCanvasSyncOnToolCompleted("generate_images")).toBe(false);
    expect(shouldCanvasSyncOnToolCompleted("inspect_canvas")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import {
  pendingImageToolApprovalFromEvents,
  shouldSendImageConfirm,
} from "./pending-image-approval";

describe("pendingImageToolApprovalFromEvents", () => {
  it("picks the latest generate_images tool.confirm so the card can resume the job", () => {
    expect(
      pendingImageToolApprovalFromEvents([
        {
          type: "tool.confirm",
          data: {
            runId: "run-1",
            approvalId: "run-1:generate_images",
            toolName: "generate_images",
          },
        },
        {
          type: "image_generation.confirm",
          data: { prompt: "Dark home", count: 1 },
        },
      ])
    ).toEqual({
      runId: "run-1",
      approvalId: "run-1:generate_images",
    });
  });

  it("returns null when there is no resumable approval", () => {
    expect(
      pendingImageToolApprovalFromEvents([
        { type: "image_generation.confirm", data: { prompt: "Dark home" } },
      ])
    ).toBeNull();
  });

  it("recovers a generate_images card that only emitted image_generation.confirm", () => {
    expect(
      pendingImageToolApprovalFromEvents([
        {
          type: "image_generation.confirm",
          data: {
            runId: "run-2",
            approvalId: "run-2:generate_images",
            prompt: "小红书竖版封面",
            count: 1,
          },
        },
      ])
    ).toEqual({
      runId: "run-2",
      approvalId: "run-2:generate_images",
    });
  });
});

describe("shouldSendImageConfirm", () => {
  it("lets the user approve while the parent run is still streaming", () => {
    expect(
      shouldSendImageConfirm("streaming", {
        runId: "run-1",
        approvalId: "run-1:generate_images",
      }),
    ).toBe(true);
    expect(shouldSendImageConfirm("streaming", null)).toBe(false);
    expect(
      shouldSendImageConfirm("cancelling", {
        runId: "run-1",
        approvalId: "run-1:generate_images",
      }),
    ).toBe(false);
  });
});

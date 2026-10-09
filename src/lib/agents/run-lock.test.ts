import { describe, expect, it } from "vitest";

import { isWaitingChatTurn, runBlocksNewAgentTurn, shouldSupersedeForNewTurn } from "./run-lock";

describe("runBlocksNewAgentTurn", () => {
  it("blocks executing runs", () => {
    expect(runBlocksNewAgentTurn({ status: "accepted" })).toBe(true);
    expect(runBlocksNewAgentTurn({ status: "running" })).toBe(true);
    expect(runBlocksNewAgentTurn({ status: "cancelling" })).toBe(true);
  });

  it("blocks waiting_user only when a tool approval card is pending", () => {
    expect(
      runBlocksNewAgentTurn({
        status: "waiting_user",
        pendingToolApproval: { status: "pending" },
      }),
    ).toBe(true);
  });

  it("does not block discovery/direction waiting_user so the next user reply can start a new turn", () => {
    expect(runBlocksNewAgentTurn({ status: "waiting_user" })).toBe(false);
    expect(
      runBlocksNewAgentTurn({
        status: "waiting_user",
        pendingToolApproval: { status: "approved" },
      }),
    ).toBe(false);
  });

  it("does not block finished runs", () => {
    expect(runBlocksNewAgentTurn({ status: "completed" })).toBe(false);
    expect(runBlocksNewAgentTurn({ status: "failed" })).toBe(false);
    expect(runBlocksNewAgentTurn({ status: "cancelled" })).toBe(false);
  });
});

describe("isWaitingChatTurn", () => {
  it("treats discovery waiting_user as a chat wait that can be released", () => {
    expect(isWaitingChatTurn({ status: "waiting_user" })).toBe(true);
  });

  it("does not treat pending tool approval as a chat wait", () => {
    expect(
      isWaitingChatTurn({
        status: "waiting_user",
        pendingToolApproval: { status: "pending" },
      }),
    ).toBe(false);
  });
});

describe("shouldSupersedeForNewTurn", () => {
  it("supersedes a pending image approval so a new user turn is not blocked", () => {
    expect(
      shouldSupersedeForNewTurn({
        status: "waiting_user",
        pendingToolApproval: { status: "pending", toolName: "generate_images" },
        lastHeartbeatAt: Date.now(),
      }),
    ).toBe(true);
  });

  it("does not supersede a freshly running generation", () => {
    expect(
      shouldSupersedeForNewTurn({
        status: "running",
        currentStep: "delegate_task",
        lastHeartbeatAt: Date.now(),
      }),
    ).toBe(false);
  });

  it("supersedes a running run after the last tool finished so 继续 is not blocked", () => {
    expect(
      shouldSupersedeForNewTurn({
        status: "running",
        currentStep: "delegate_task:done",
        lastHeartbeatAt: Date.now(),
      }),
    ).toBe(true);
  });

  it("supersedes a running run that still holds a generate_images confirm card", () => {
    expect(
      shouldSupersedeForNewTurn({
        status: "running",
        currentStep: "generate_images",
        pendingToolApproval: { status: "pending", toolName: "generate_images" },
        lastHeartbeatAt: Date.now(),
      }),
    ).toBe(true);
  });

  it("supersedes a running run with no heartbeat as a zombie", () => {
    expect(shouldSupersedeForNewTurn({ status: "running" })).toBe(true);
  });
});

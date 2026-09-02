import { describe, expect, it } from "vitest";
import {
  bindCommandToWaitingRun,
  matchWaitingApproval,
  resumeWaitingImageApproval,
  rewriteMissingToolApproval,
} from "./missing-run-fallback";
import type { WsCommand } from "./types";

describe("rewriteMissingToolApproval", () => {
  it("rewrites a lost generate_images approval into a confirmed agent.run", () => {
    const rewritten = rewriteMissingToolApproval({
      action: "tool.approve",
      projectId: "p1",
      runId: "missing-run",
      approvalId: "missing-run:generate_images:abc",
      threadId: "thread-1",
      toolArgs: {
        prompt: "A login page matching the attached reference",
        count: 1,
        width: 1024,
        height: 1024,
      },
    } as WsCommand);

    expect(rewritten).not.toBeNull();
    expect(rewritten?.action).toBe("agent.run");
    expect(rewritten?.runId).toBeUndefined();
    expect(rewritten?.threadId).toBe("thread-1");
    expect(rewritten?.prompt).toContain("[IMAGE_GENERATION_CONFIRMED]");
    expect(rewritten?.prompt).toContain("A login page matching the attached reference");
  });

  it("does not rewrite cancel or approvals without a prompt", () => {
    expect(
      rewriteMissingToolApproval({
        action: "tool.cancel",
        projectId: "p1",
        runId: "missing-run",
        approvalId: "a1",
      } as WsCommand),
    ).toBeNull();
    expect(
      rewriteMissingToolApproval({
        action: "tool.approve",
        projectId: "p1",
        runId: "missing-run",
        approvalId: "a1",
        toolArgs: { width: 1024 },
      } as WsCommand),
    ).toBeNull();
  });
});

describe("matchWaitingApproval", () => {
  const waiting = {
    runId: "live-run",
    projectId: "p1",
    status: "waiting_user",
    pendingToolApproval: {
      approvalId: "live-run:generate_images:abc",
      status: "pending",
      toolName: "generate_images",
    },
  };

  it("recovers the live waiting run when the card runId is stale", () => {
    expect(
      matchWaitingApproval([waiting], {
        projectId: "p1",
        approvalId: "stale:generate_images:abc",
      })?.runId,
    ).toBe("live-run");
    expect(
      matchWaitingApproval([waiting], {
        projectId: "p1",
        approvalId: "live-run:generate_images:abc",
      })?.runId,
    ).toBe("live-run");
  });

  it("rewrites the command onto the live waiting run", () => {
    const bound = bindCommandToWaitingRun(
      {
        action: "tool.approve",
        projectId: "p1",
        runId: "stale-run",
        approvalId: "stale:generate_images:abc",
      } as WsCommand,
      waiting,
    );
    expect(bound.runId).toBe("live-run");
    expect(bound.approvalId).toBe("live-run:generate_images:abc");
  });

  it("turns agent.approve into tool.approve on the live waiting run", () => {
    const resumed = resumeWaitingImageApproval(
      {
        action: "agent.approve",
        projectId: "p1",
        prompt: "A login page matching the attached reference",
        count: 1,
        threadId: "thread-1",
      } as WsCommand,
      waiting,
    );
    expect(resumed?.action).toBe("tool.approve");
    expect(resumed?.runId).toBe("live-run");
    expect(resumed?.approvalId).toBe("live-run:generate_images:abc");
    expect(resumed?.toolArgs?.prompt).toBe("A login page matching the attached reference");
    expect(resumed?.toolArgs?.confirmed).toBe(true);
  });
});

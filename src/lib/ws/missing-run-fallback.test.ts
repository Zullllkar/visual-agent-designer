import { describe, expect, it } from "vitest";
import {
  bindCommandToWaitingRun,
  matchWaitingApproval,
  resumeBlockedImageApproval,
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

  it("turns a new agent.run into tool.approve when generate_images is already waiting", () => {
    const resumed = resumeBlockedImageApproval(
      {
        action: "agent.run",
        projectId: "p1",
        prompt: "ONLY the color and light change: convert to a dark palette",
        count: 1,
        threadId: "thread-1",
      } as WsCommand,
      waiting,
    );
    expect(resumed?.action).toBe("tool.approve");
    expect(resumed?.runId).toBe("live-run");
    expect(resumed?.approvalId).toBe("live-run:generate_images:abc");
    expect(resumed?.toolArgs?.prompt).toContain("dark palette");
  });

  it("does not swallow a new chat turn that is not an image approval", () => {
    expect(
      resumeBlockedImageApproval(
        {
          action: "agent.run",
          projectId: "p1",
          prompt: "改成横版海报，不要再生这一张",
          threadId: "thread-1",
        } as WsCommand,
        waiting,
      )
    ).toBeNull();
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

  it("resumes generate_images even if the parent run is still marked running", () => {
    const running = {
      ...waiting,
      status: "running",
      lastHeartbeatAt: Date.now(),
    };
    expect(
      matchWaitingApproval([running], {
        projectId: "p1",
        approvalId: "live-run:generate_images:abc",
      })?.runId,
    ).toBe("live-run");

    const resumed = resumeBlockedImageApproval(
      {
        action: "agent.approve",
        projectId: "p1",
        prompt: "小红书竖版封面",
        count: 1,
        threadId: "thread-1",
      } as WsCommand,
      running,
    );
    expect(resumed?.action).toBe("tool.approve");
    expect(resumed?.runId).toBe("live-run");
    expect(resumed?.toolArgs?.confirmed).toBe(true);
  });

  it("does not treat a busy generation without pending approval as resumable", () => {
    expect(
      matchWaitingApproval(
        [{ runId: "busy", projectId: "p1", status: "running" }],
        { projectId: "p1" },
      ),
    ).toBeUndefined();
  });
});

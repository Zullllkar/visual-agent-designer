import { describe, expect, it } from "vitest";
import {
  Annotation,
  Command,
  MemorySaver,
  StateGraph,
} from "@langchain/langgraph";

import {
  applyApprovalDecision,
  awaitUserToolApproval,
  isReinterruptOfApprovedImageTool,
  shouldPauseToolForConfirmation,
  shouldResumeGraphInterrupt,
  subAgentRunThreadId,
} from "./tool-confirmation-pause";

const PauseState = Annotation.Root({
  result: Annotation<string>({
    reducer: (_left, right) => right,
    default: () => "",
  }),
});

describe("shouldPauseToolForConfirmation", () => {
  it("still pauses generate_images when the model sets confirmed:true", () => {
    expect(
      shouldPauseToolForConfirmation({
        toolName: "generate_images",
        requiresConfirmation: true,
        args: { confirmed: true, prompt: "cover" },
      }),
    ).toBe(true);
  });

  it("still pauses delegate_task when the model sets confirmed:true", () => {
    expect(
      shouldPauseToolForConfirmation({
        toolName: "delegate_task",
        requiresConfirmation: true,
        args: { confirmed: true, subAgent: "image-generation" },
      }),
    ).toBe(true);
  });

  it("does not pause generate_images after the user confirmation marker", () => {
    expect(
      shouldPauseToolForConfirmation({
        toolName: "generate_images",
        requiresConfirmation: true,
        args: { prompt: "cover" },
        userMessageConfirmed: true,
      }),
    ).toBe(false);
  });

  it("does not pause generate_images when the user already approved this card", () => {
    expect(
      shouldPauseToolForConfirmation({
        toolName: "generate_images",
        requiresConfirmation: true,
        args: { prompt: "cover" },
        trustedResume: true,
      }),
    ).toBe(false);
  });
});

describe("shouldResumeGraphInterrupt", () => {
  it("does not Command-resume generate_images because a new agent instance re-opens the confirm card", () => {
    expect(
      shouldResumeGraphInterrupt({
        toolName: "generate_images",
        pausedByInterrupt: true,
        checkpointInterruptId: "interrupt-1",
      }),
    ).toBe(false);
  });

  it("still Command-resumes non-image tool interrupts", () => {
    expect(
      shouldResumeGraphInterrupt({
        toolName: "manipulate_canvas",
        pausedByInterrupt: true,
        checkpointInterruptId: "interrupt-1",
      }),
    ).toBe(true);
  });
});

describe("isReinterruptOfApprovedImageTool", () => {
  it("treats a confirm event after image approval as a failed graph resume, not a new wait", () => {
    expect(
      isReinterruptOfApprovedImageTool({
        toolName: "generate_images",
        eventType: "tool.confirm",
      }),
    ).toBe(true);
    expect(
      isReinterruptOfApprovedImageTool({
        toolName: "manipulate_canvas",
        eventType: "tool.confirm",
      }),
    ).toBe(false);
  });
});

describe("awaitUserToolApproval", () => {
  it("interrupts so later tools cannot run before the user approves", async () => {
    let laterRan = false;
    const graph = new StateGraph(PauseState)
      .addNode("tool", () => {
        awaitUserToolApproval({
          approvalId: "run-1:generate_images",
          title: "生成图片",
          toolName: "generate_images",
          riskLevel: "moderate",
          args: { prompt: "cover", count: 1 },
          reason: "needs approval",
        });
        laterRan = true;
        return { result: "delegated" };
      })
      .addEdge("__start__", "tool")
      .compile({ checkpointer: new MemorySaver() });

    const chunks = [];
    for await (const chunk of await graph.stream(
      { result: "" },
      { configurable: { thread_id: "pause-1" }, streamMode: "updates" as const },
    )) {
      chunks.push(chunk);
    }

    expect(laterRan).toBe(false);
    expect(chunks).toEqual([
      {
        __interrupt__: [
          expect.objectContaining({
            value: expect.objectContaining({
              toolName: "generate_images",
              approvalId: "run-1:generate_images",
            }),
          }),
        ],
      },
    ]);
  });

  it("resumes with confirmed args after the user approves", async () => {
    const graph = new StateGraph(PauseState)
      .addNode("tool", () => {
        const payload = {
          approvalId: "run-1:generate_images",
          title: "生成图片",
          toolName: "generate_images",
          riskLevel: "moderate",
          args: { prompt: "cover", count: 1 },
          reason: "needs approval",
        };
        const applied = applyApprovalDecision(
          payload,
          awaitUserToolApproval(payload),
        );
        return {
          result: applied.cancelled
            ? "cancelled"
            : `ok:${String(applied.args.confirmed)}:${String(applied.args.prompt)}`,
        };
      })
      .addEdge("__start__", "tool")
      .compile({ checkpointer: new MemorySaver() });

    const config = {
      configurable: { thread_id: "pause-resume" },
      streamMode: "updates" as const,
    };
    for await (const _chunk of await graph.stream({ result: "" }, config)) {
      // consume interrupt
    }

    const resumed = [];
    for await (const chunk of await graph.stream(
      new Command({
        resume: {
          action: "approve",
          approvalId: "run-1:generate_images",
          args: { prompt: "edited cover", count: 1 },
        },
      }),
      config,
    )) {
      resumed.push(chunk);
    }

    expect(resumed).toContainEqual({
      tool: { result: "ok:true:edited cover" },
    });
  });
});

describe("subAgentRunThreadId", () => {
  it("keeps image-generation sub-runs off the parent conversation thread", () => {
    expect(subAgentRunThreadId("thread-abc", "proj-1", "sub1")).toBe(
      "thread-abc:sub:sub1",
    );
    expect(subAgentRunThreadId("thread-abc", "proj-1", "sub1")).not.toBe(
      "thread-abc",
    );
    expect(subAgentRunThreadId("thread-abc", "proj-1", "sub1")).not.toBe(
      "proj-1",
    );
  });
});

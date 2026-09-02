import { describe, expect, it } from "vitest";
import {
  Annotation,
  Command,
  MemorySaver,
  StateGraph,
  interrupt,
} from "@langchain/langgraph";

type ApprovalDecision = {
  action?: "approve" | "cancel";
  approvalId?: string;
  args?: Record<string, unknown>;
};

const ApprovalState = Annotation.Root({
  result: Annotation<string>({
    reducer: (_left, right) => right,
    default: () => "",
  }),
});

describe("LangGraph approval resume", () => {
  it("resumes an interrupted tool with approved edited args", async () => {
    const graph = new StateGraph(ApprovalState)
      .addNode("tool", () => {
        const approvalId = "approval-1";
        const decision = interrupt<
          {
            approvalId: string;
            toolName: string;
            args: Record<string, unknown>;
          },
          ApprovalDecision
        >({
          approvalId,
          toolName: "generate_images",
          args: { prompt: "original", count: 4 },
        });
        if (decision.action !== "approve" || decision.approvalId !== approvalId) {
          return { result: "cancelled" };
        }
        return { result: `approved:${decision.args?.prompt}:${decision.args?.count}` };
      })
      .addEdge("__start__", "tool")
      .compile({ checkpointer: new MemorySaver() });

    const config = { configurable: { thread_id: "approval-edit" }, streamMode: "updates" as const };
    const interrupted = [];
    for await (const chunk of await graph.stream({ result: "" }, config)) {
      interrupted.push(chunk);
    }

    expect(interrupted).toEqual([
      {
        __interrupt__: [
          expect.objectContaining({
            value: expect.objectContaining({
              approvalId: "approval-1",
              toolName: "generate_images",
            }),
          }),
        ],
      },
    ]);

    const resumed = [];
    for await (const chunk of await graph.stream(
      new Command({
        resume: {
          action: "approve",
          approvalId: "approval-1",
          args: { prompt: "edited", count: 1 },
        },
      }),
      config
    )) {
      resumed.push(chunk);
    }

    expect(resumed).toContainEqual({ tool: { result: "approved:edited:1" } });
  });

  it("resumes an interrupted tool as cancelled", async () => {
    const graph = new StateGraph(ApprovalState)
      .addNode("tool", () => {
        const approvalId = "approval-2";
        const decision = interrupt<
          { approvalId: string; toolName: string; args: Record<string, unknown> },
          ApprovalDecision
        >({
          approvalId,
          toolName: "manipulate_canvas",
          args: { operation: "delete" },
        });
        if (decision.action !== "approve" || decision.approvalId !== approvalId) {
          return { result: "cancelled" };
        }
        return { result: "approved" };
      })
      .addEdge("__start__", "tool")
      .compile({ checkpointer: new MemorySaver() });

    const config = { configurable: { thread_id: "approval-cancel" }, streamMode: "updates" as const };
    for await (const _chunk of await graph.stream({ result: "" }, config)) {
      // consume interrupt stream
    }

    const resumed = [];
    for await (const chunk of await graph.stream(
      new Command({ resume: { action: "cancel", approvalId: "approval-2" } }),
      config
    )) {
      resumed.push(chunk);
    }

    expect(resumed).toContainEqual({ tool: { result: "cancelled" } });
  });
});

import { describe, it, expect } from "vitest";
import { adaptStreamEvents } from "@/lib/agents/stream-adapter";
import type { StreamEvent } from "@langchain/core/tracers/log_stream";
import type { AgentContext } from "@/lib/agents/types";

async function* mockStream(
  events: StreamEvent[]
): AsyncGenerator<StreamEvent> {
  for (const e of events) yield e;
}

function makeMockAgentCtx(): AgentContext {
  return {
    projectId: "test-adapter",
    scratch: {},
    providers: {
      llm: { kind: "mock" } as never,
      image: { kind: "mock" } as never,
      visionCritic: false,
    },
  };
}

describe("Stream Adapter", () => {
  it("should yield message.delta for on_chat_model_stream", async () => {
    const events: StreamEvent[] = [
      {
        event: "on_chat_model_stream",
        data: { chunk: { content: "hello" } },
      } as unknown as StreamEvent,
      {
        event: "on_chat_model_stream",
        data: { chunk: { content: " world" } },
      } as unknown as StreamEvent,
    ];

    const results = [];
    for await (const ev of adaptStreamEvents(
      mockStream(events),
      "run-1",
      undefined,
      "thread-1"
    )) {
      results.push(ev);
    }

    const started = results.find((e) => e.type === "run.started");
    expect(started).toBeDefined();
    expect(started!.data).toEqual({ runId: "run-1", threadId: "thread-1" });

    const deltas = results.filter((e) => e.type === "message.delta");
    expect(deltas.length).toBe(2);
    expect(deltas[0].data).toEqual({ text: "hello", runId: "run-1" });
    expect(deltas[1].data).toEqual({ text: " world", runId: "run-1" });
  });

  it("should yield tool.started and tool.completed for tool events", async () => {
    const events: StreamEvent[] = [
      {
        event: "on_tool_start",
        data: { name: "generate_brief", input: { idea: "test" } },
      } as unknown as StreamEvent,
      {
        event: "on_tool_end",
        data: { name: "generate_brief", output: "done" },
      } as unknown as StreamEvent,
    ];

    const results = [];
    for await (const ev of adaptStreamEvents(
      mockStream(events),
      "run-2"
    )) {
      results.push(ev);
    }

    const started = results.find((e) => e.type === "tool.started");
    expect(started).toBeDefined();
    expect(started!.data).toEqual({
      runId: "run-2",
      toolName: "generate_brief",
      args: { idea: "test" },
    });

    const completed = results.find((e) => e.type === "tool.completed");
    expect(completed).toBeDefined();
    expect((completed!.data as { runId: string }).runId).toBe("run-2");
    expect((completed!.data as { toolName: string }).toolName).toBe("generate_brief");
    expect((completed!.data as { output: unknown }).output).toBe("done");
  });

  it("should yield tool.confirm for LangGraph interrupt chunks", async () => {
    const events: StreamEvent[] = [
      {
        event: "on_chain_stream",
        data: {
          chunk: {
            __interrupt__: [
              {
                id: "interrupt-1",
                value: {
                  approvalId: "approval-1",
                  toolName: "manipulate_canvas",
                  toolCallId: "tool-call-1",
                  riskLevel: "moderate",
                  args: { operation: "move" },
                  reason: "Needs approval",
                },
              },
            ],
          },
        },
      } as unknown as StreamEvent,
    ];

    const results = [];
    for await (const ev of adaptStreamEvents(
      mockStream(events),
      "run-interrupt",
      makeMockAgentCtx(),
      "thread-interrupt"
    )) {
      results.push(ev);
    }

    const confirm = results.find((e) => e.type === "tool.confirm");
    expect(confirm?.data).toMatchObject({
      runId: "run-interrupt",
      checkpointInterruptId: "interrupt-1",
      approvalId: "approval-1",
      toolName: "manipulate_canvas",
      toolCallId: "tool-call-1",
      riskLevel: "moderate",
      args: { operation: "move" },
    });
  });

  it("yields tool.confirm when interrupt is on the event data root", async () => {
    const events: StreamEvent[] = [
      {
        event: "on_chain_stream",
        data: {
          __interrupt__: [
            {
              id: "interrupt-root",
              value: {
                approvalId: "run-1:generate_images",
                toolName: "generate_images",
                pausedByInterrupt: true,
              },
            },
          ],
        },
      } as unknown as StreamEvent,
    ];

    const results = [];
    for await (const ev of adaptStreamEvents(mockStream(events), "run-1")) {
      results.push(ev);
    }

    expect(results.find((e) => e.type === "tool.confirm")?.data).toMatchObject({
      runId: "run-1",
      checkpointInterruptId: "interrupt-root",
      toolName: "generate_images",
      pausedByInterrupt: true,
    });
  });

  it("should prefer native LangGraph tool call id over tool run id", async () => {
    const events: StreamEvent[] = [
      {
        event: "on_tool_start",
        name: "generate_images",
        run_id: "tool-run-1",
        data: {
          input: {
            tool_call: {
              id: "tool-call-native-1",
              name: "generate_images",
              args: { count: 4 },
            },
          },
        },
      } as unknown as StreamEvent,
      {
        event: "on_tool_end",
        name: "generate_images",
        run_id: "tool-run-1",
        data: { output: JSON.stringify({ summary: "queued" }) },
      } as unknown as StreamEvent,
    ];

    const results = [];
    for await (const ev of adaptStreamEvents(mockStream(events), "run-native")) {
      results.push(ev);
    }

    const started = results.find((e) => e.type === "tool.started");
    const completed = results.find((e) => e.type === "tool.completed");
    expect(started?.data).toMatchObject({
      toolCallId: "tool-call-native-1",
      toolName: "generate_images",
    });
    expect(completed?.data).toMatchObject({
      toolCallId: "tool-call-native-1",
      toolName: "generate_images",
    });
  });

  it("should read tool call id from lg_tool_call input shape", async () => {
    const events: StreamEvent[] = [
      {
        event: "on_tool_start",
        name: "generate_images",
        run_id: "tool-run-2",
        data: {
          input: {
            lg_tool_call: {
              id: "tool-call-lg-1",
              name: "generate_images",
              args: { count: 2 },
            },
          },
        },
      } as unknown as StreamEvent,
    ];

    const results = [];
    for await (const ev of adaptStreamEvents(mockStream(events), "run-lg")) {
      results.push(ev);
    }

    const started = results.find((e) => e.type === "tool.started");
    expect(started?.data).toMatchObject({
      toolCallId: "tool-call-lg-1",
      toolName: "generate_images",
    });
  });

  it("should yield run.completed at the end", async () => {
    const results = [];
    for await (const ev of adaptStreamEvents(
      mockStream([]),
      "run-3"
    )) {
      results.push(ev);
    }

    expect(results.length).toBe(2);
    expect(results[0].type).toBe("run.started");
    expect(results[1].type).toBe("run.completed");
    expect(results[1].data).toEqual({ runId: "run-3" });
  });

  it("should yield project.update when scratch.__updatedProject is set", async () => {
    const agentCtx = makeMockAgentCtx();
    const mockProject = {
      id: "test-project",
      version: 1,
      updatedAt: new Date().toISOString(),
    };
    agentCtx.scratch.__updatedProject = mockProject;

    const events: StreamEvent[] = [
      {
        event: "on_tool_end",
        data: { name: "generate_images", output: "ok" },
      } as unknown as StreamEvent,
    ];

    const results = [];
    for await (const ev of adaptStreamEvents(
      mockStream(events),
      "run-4",
      agentCtx,
      "thread-4"
    )) {
      results.push(ev);
    }

    const projectUpdate = results.find((e) => e.type === "project.update");
    expect(projectUpdate).toBeDefined();
    expect((projectUpdate!.data as { project: unknown }).project).toEqual(
      mockProject
    );
    const completedIdx = results.findIndex((e) => e.type === "tool.completed");
    const updateIdx = results.findIndex((e) => e.type === "project.update");
    expect(updateIdx).toBeGreaterThan(-1);
    expect(updateIdx).toBeLessThan(completedIdx);

    // scratch should be cleaned up after yielding
    expect(agentCtx.scratch.__updatedProject).toBeUndefined();
  });

  it("should not yield project.update when scratch has no __updatedProject", async () => {
    const agentCtx = makeMockAgentCtx();

    const events: StreamEvent[] = [
      {
        event: "on_tool_end",
        data: { name: "generate_brief", output: JSON.stringify({ summary: "ok" }) },
      } as unknown as StreamEvent,
    ];

    const results = [];
    for await (const ev of adaptStreamEvents(
      mockStream(events),
      "run-5",
      agentCtx
    )) {
      results.push(ev);
    }

    const projectUpdate = results.find((e) => e.type === "project.update");
    expect(projectUpdate).toBeUndefined();
  });

  it("should promote answer_question tool output to message.delta", async () => {
    const events: StreamEvent[] = [
      {
        event: "on_tool_start",
        name: "answer_question",
        data: { name: "answer_question", input: { question: "hi" } },
      } as unknown as StreamEvent,
      {
        event: "on_tool_end",
        name: "answer_question",
        data: {
          name: "answer_question",
          output: JSON.stringify({
            ok: true,
            summary: "建议先做详情页",
            data: { text: "建议先做详情页" },
          }),
        },
      } as unknown as StreamEvent,
    ];

    const results = [];
    for await (const ev of adaptStreamEvents(mockStream(events), "run-chat")) {
      results.push(ev);
    }

    expect(results.some((e) => e.type === "tool.started")).toBe(false);
    expect(results.some((e) => e.type === "tool.completed")).toBe(false);
    const deltas = results.filter((e) => e.type === "message.delta");
    expect(deltas.length).toBe(1);
    expect((deltas[0].data as { text: string }).text).toBe("建议先做详情页");
  });

  it("should emit discovery.questions when ask_discovery finishes", async () => {
    const agentCtx = makeMockAgentCtx();
    agentCtx.scratch.__discoveryQuestions = {
      title: "快速需求确认",
      questions: [
        { id: "productType", label: "要做什么？", type: "radio" },
      ],
    };
    const events: StreamEvent[] = [
      {
        event: "on_tool_start",
        name: "ask_discovery",
        data: { name: "ask_discovery", input: { title: "快速需求确认" } },
      } as unknown as StreamEvent,
      {
        event: "on_tool_end",
        name: "ask_discovery",
        data: {
          name: "ask_discovery",
          output: JSON.stringify({
            ok: true,
            summary: "已向用户提出 1 个需求确认问题，等待用户回复。",
            data: { questionsAsked: true, questionCount: 1 },
          }),
        },
      } as unknown as StreamEvent,
    ];

    const results = [];
    for await (const ev of adaptStreamEvents(
      mockStream(events),
      "run-disco",
      agentCtx
    )) {
      results.push(ev);
    }

    const discovery = results.find((e) => e.type === "discovery.questions");
    expect(discovery).toBeDefined();
    expect(discovery?.data).toMatchObject({
      runId: "run-disco",
      title: "快速需求确认",
    });
  });

  it("should skip empty content in on_chat_model_stream", async () => {
    const events: StreamEvent[] = [
      {
        event: "on_chat_model_stream",
        data: { chunk: { content: "" } },
      } as unknown as StreamEvent,
      {
        event: "on_chat_model_stream",
        data: { chunk: { content: "valid" } },
      } as unknown as StreamEvent,
    ];

    const results = [];
    for await (const ev of adaptStreamEvents(
      mockStream(events),
      "run-6"
    )) {
      results.push(ev);
    }

    const deltas = results.filter((e) => e.type === "message.delta");
    expect(deltas.length).toBe(1);
    expect(deltas[0].data).toEqual({ text: "valid", runId: "run-6" });
  });

  it("should yield thinking.delta for content_blocks with thinking type", async () => {
    const events: StreamEvent[] = [
      {
        event: "on_chat_model_stream",
        data: {
          chunk: {
            content: "",
            content_blocks: [
              { type: "thinking", thinking: "Let me analyze..." },
              { type: "text", text: "Here is my answer" },
            ],
          },
        },
      } as unknown as StreamEvent,
    ];

    const results = [];
    for await (const ev of adaptStreamEvents(
      mockStream(events),
      "run-7",
      undefined,
      "thread-7"
    )) {
      results.push(ev);
    }

    const thinking = results.filter((e) => e.type === "thinking.delta");
    expect(thinking.length).toBe(1);
    expect(thinking[0].data).toEqual({ text: "Let me analyze...", runId: "run-7" });

    const deltas = results.filter((e) => e.type === "message.delta");
    expect(deltas.length).toBe(1);
    expect(deltas[0].data).toEqual({ text: "Here is my answer", runId: "run-7" });
  });

  it("should extract artifacts from tool output", async () => {
    const events: StreamEvent[] = [
      {
        event: "on_tool_end",
        data: {
          name: "generate_images",
          output: {
            summary: "Generated 2 images",
            images: [
              { url: "https://example.com/1.png", mimeType: "image/png", width: 1024, height: 768 },
              { url: "https://example.com/2.png", mimeType: "image/png", width: 512, height: 512 },
            ],
          },
        },
      } as unknown as StreamEvent,
    ];

    const results = [];
    for await (const ev of adaptStreamEvents(
      mockStream(events),
      "run-8",
      undefined,
      "thread-8"
    )) {
      results.push(ev);
    }

    const completed = results.find((e) => e.type === "tool.completed");
    expect(completed).toBeDefined();
    const data = completed!.data as { artifacts?: unknown[]; outputSummary?: string };
    expect(data.artifacts).toBeDefined();
    expect(data.artifacts!.length).toBe(2);
    expect(data.outputSummary).toBe("Generated 2 images");
  });

  it("yields a single generate_images approval, not tool.confirm plus image_generation.confirm", async () => {
    const agentCtx = makeMockAgentCtx();
    agentCtx.scratch.__toolConfirmation = {
      approvalId: "run-9:generate_images",
      toolName: "generate_images",
      args: { prompt: "Dark OmniTab home", count: 1 },
      reason: "Needs approval",
    };
    agentCtx.scratch.__imageGenerationConfirmation = {
      title: "生图执行请求",
      prompt: "Dark OmniTab home",
      count: 1,
      width: 1024,
      height: 1024,
    };

    const events: StreamEvent[] = [
      {
        event: "on_tool_end",
        name: "generate_images",
        data: {
          name: "generate_images",
          output: JSON.stringify({
            ok: false,
            data: { confirmationRequired: true },
          }),
        },
      } as unknown as StreamEvent,
    ];

    const results = [];
    for await (const ev of adaptStreamEvents(mockStream(events), "run-9", agentCtx)) {
      results.push(ev);
    }

    const confirms = results.filter(
      (ev) => ev.type === "tool.confirm" || ev.type === "image_generation.confirm"
    );
    expect(confirms).toHaveLength(1);
    expect(confirms[0]?.type).toBe("tool.confirm");
    expect(confirms[0]?.data).toMatchObject({
      approvalId: "run-9:generate_images",
      toolName: "generate_images",
    });
  });
});

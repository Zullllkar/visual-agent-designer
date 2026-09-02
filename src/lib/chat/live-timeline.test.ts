import { describe, expect, it } from "vitest";

import {
  buildChatTimeline,
  buildChatTimelineTurns,
  describeFallbackActivity,
} from "./live-timeline";
import type { ChatMessage } from "@/lib/agents/chat-schema";
import type { ChatLiveEvent } from "./chat-live-event";
import { formatThoughtMessageContent } from "./thought-message";

describe("buildChatTimeline", () => {
  it("closes running tools when a run waits for user input", () => {
    const events: ChatLiveEvent[] = [
      {
        type: "tool_call",
        data: { id: "tool-1", name: "confirm_direction", args: {} },
        at: 100,
      },
      {
        type: "run.waiting_user",
        data: { runId: "run-1", reason: "user_input_required" },
        at: 140,
      },
    ];

    const timeline = buildChatTimeline([], events, false);
    const tool = timeline.find((item) => item.kind === "tool");

    expect(tool).toMatchObject({
      kind: "tool",
      id: "tool-1",
      status: "done",
      summary: "Waiting for user input",
      durationMs: 40,
    });
  });

  it("dedupes repeated error events", () => {
    const events: ChatLiveEvent[] = [
      { type: "run.failed", data: { error: "Provider failed" }, at: 100 },
      { type: "error", data: { message: "Provider failed" }, at: 101 },
    ];

    const timeline = buildChatTimeline([], events, false);

    expect(timeline.filter((item) => item.kind === "error")).toHaveLength(1);
  });

  it("groups a user request and its execution items into a turn", () => {
    const messages: ChatMessage[] = [
      {
        id: "user-1",
        role: "user",
        content: "Generate image assets",
        createdAt: new Date(1000).toISOString(),
      },
    ];
    const events: ChatLiveEvent[] = [
      {
        type: "tool_call",
        data: { id: "tool-1", name: "generate_images", args: {} },
        at: 1100,
      },
      {
        type: "job.queued",
        data: {
          jobId: "job-1",
          jobType: "direct_image_generation",
          toolCallId: "tool-1",
          progress: 0,
          detail: { stage: "queued", completed: 0, failed: 0, total: 4 },
        },
        at: 1200,
      },
    ];

    const turns = buildChatTimelineTurns(messages, events, true);

    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      id: "user-1",
      title: "Generate image assets",
      status: "running",
      counts: { tools: 1, jobs: 1 },
    });
    expect(turns[0].items.map((item) => item.kind)).toEqual(["tool", "job"]);
    expect(turns[0].items[1]).toMatchObject({
      kind: "job",
      toolCallId: "tool-1",
    });
  });

  it("keeps chronological interleaving: thought then tool then assistant", () => {
    const messages: ChatMessage[] = [
      {
        id: "user-2",
        role: "user",
        content: "做三张不同类型",
        createdAt: new Date(1000).toISOString(),
      },
    ];
    const events: ChatLiveEvent[] = [
      { type: "thinking", data: { text: "先拆成三种构图" }, at: 1100 },
      {
        type: "tool_call",
        data: { id: "tool-g", name: "generate_images", args: {} },
        at: 1200,
      },
      {
        type: "assistant_text",
        data: { text: "已提交三种不同类型。" },
        at: 1300,
      },
    ];

    const turns = buildChatTimelineTurns(messages, events, true);
    expect(turns[0].items.map((item) => item.kind)).toEqual([
      "thought",
      "tool",
      "assistant",
    ]);
  });

  it("compacts consecutive pipeline logs into one expandable group", () => {
    const messages: ChatMessage[] = [
      {
        id: "user-plog",
        role: "user",
        content: "生成 layout",
        createdAt: new Date(1000).toISOString(),
      },
    ];
    const events: ChatLiveEvent[] = [
      {
        type: "pipeline_log",
        data: {
          id: "l1",
          at: new Date(1100).toISOString(),
          level: "info",
          stage: "brief",
          message: "Brief 完成",
        },
        at: 1100,
      },
      {
        type: "pipeline_log",
        data: {
          id: "l2",
          at: new Date(1200).toISOString(),
          level: "info",
          stage: "layout",
          message: "Layout 完成",
        },
        at: 1200,
      },
      {
        type: "tool_call",
        data: { id: "tool-layout", name: "generate_layout", args: {} },
        at: 1300,
      },
      {
        type: "pipeline_log",
        data: {
          id: "l3",
          at: new Date(1400).toISOString(),
          level: "success",
          stage: "image_plan",
          message: "生图规划完成",
        },
        at: 1400,
      },
    ];

    const turns = buildChatTimelineTurns(messages, events, true);
    expect(turns[0].items.map((item) => item.kind)).toEqual([
      "pipeline_logs",
      "tool",
      "pipeline_logs",
    ]);
    const firstGroup = turns[0].items[0];
    expect(firstGroup).toMatchObject({
      kind: "pipeline_logs",
      entries: [{ id: "l1" }, { id: "l2" }],
    });
    const secondGroup = turns[0].items[2];
    expect(secondGroup).toMatchObject({
      kind: "pipeline_logs",
      entries: [{ id: "l3" }],
    });
  });

  it("drops connecting-LLM noise thoughts after stream ends", () => {
    const timeline = buildChatTimeline(
      [],
      [
        {
          type: "thinking",
          data: { text: "\n正在连接 LLM，准备规划任务...\n" },
          at: 100,
        },
      ],
      false
    );
    expect(timeline.some((item) => item.kind === "thought")).toBe(false);
  });

  it("dedupes replayed events by stable event id", () => {
    const events: ChatLiveEvent[] = [
      {
        id: "event-1",
        type: "thinking",
        data: { text: "first" },
        at: 100,
      },
      {
        id: "event-1",
        type: "thinking",
        data: { text: "duplicate" },
        at: 101,
      },
    ];

    const timeline = buildChatTimeline([], events, true);
    const thought = timeline.find((item) => item.kind === "thought");

    expect(thought).toMatchObject({ content: "first" });
  });

  it("keeps turn running while streaming even before first live event", () => {
    const turns = buildChatTimelineTurns(
      [
        {
          id: "user-streaming",
          role: "user",
          content: "生成一张图",
          createdAt: new Date(1000).toISOString(),
        },
      ],
      [],
      true
    );
    expect(turns[0].status).toBe("running");
  });

  it("keeps turn running after agent run ends while image job is still active", () => {
    const turns = buildChatTimelineTurns(
      [
        {
          id: "user-job",
          role: "user",
          content: "生成素材",
          createdAt: new Date(1000).toISOString(),
        },
      ],
      [
        {
          id: "job-running-1",
          type: "job.progress",
          data: {
            jobId: "job-1",
            jobType: "image_generation",
            progress: 40,
            detail: { completed: 0, total: 2, message: "Generating…" },
          },
          at: 1500,
        },
      ],
      false
    );
    expect(turns[0].status).toBe("running");
  });

  it("marks a turn cancelled after the run reaches a cancellation terminal state", () => {
    const turns = buildChatTimelineTurns(
      [
        {
          id: "user-2",
          role: "user",
          content: "Stop this run",
          createdAt: new Date(1000).toISOString(),
        },
      ],
      [
        {
          id: "cancel-1",
          type: "run.cancelled",
          data: { runId: "run-2" },
          at: 1200,
        },
      ],
      false
    );

    expect(turns[0].status).toBe("cancelled");
  });

  it("turns generic tool confirmation requests into waiting turns", () => {
    const turns = buildChatTimelineTurns(
      [
        {
          id: "user-3",
          role: "user",
          content: "Export handoff",
          createdAt: new Date(1000).toISOString(),
        },
      ],
      [
        {
          id: "confirm-1",
          type: "tool.confirm",
          data: {
            runId: "run-3",
            toolName: "export_handoff",
            riskLevel: "moderate",
            args: { target: "codex" },
            reason: "Requires confirmation",
          },
          at: 1200,
        },
      ],
      false
    );

    expect(turns[0].status).toBe("waiting");
    expect(turns[0].items[0]).toMatchObject({
      kind: "tool_confirm",
      toolName: "export_handoff",
      riskLevel: "moderate",
    });
  });

  it("blocks leaked internal prompts in image tool confirmation cards", () => {
    const timeline = buildChatTimeline(
      [],
      [
        {
          id: "confirm-image-1",
          type: "tool.confirm",
          data: {
            runId: "run-image",
            toolName: "generate_images",
            riskLevel: "moderate",
            args: {
              prompt:
                "in normal assistant text and ask the user to reply with confirmation. Use generate_images so the UI can render an execution approval card with Run/Cancel/Edit controls.",
              count: 1,
            },
            reason: "Requires confirmation",
          },
          at: 1200,
        },
      ],
      false
    );

    const item = timeline.find((entry) => entry.kind === "tool_confirm");
    expect(item).toMatchObject({
      kind: "tool_confirm",
      toolName: "generate_images",
    });
    expect(String(item && "args" in item ? item.args?.prompt : "")).toContain(
      "Blocked internal agent instructions"
    );
    expect(String(item && "args" in item ? item.args?.prompt : "")).not.toContain(
      "normal assistant text"
    );
  });

  it("does not turn generate_images confirmationRequired tool.completed into a run-less image_confirm card", () => {
    const timeline = buildChatTimeline(
      [],
      [
        {
          id: "completed-confirm",
          type: "tool_result",
          data: {
            id: "call-1",
            runId: "run-image",
            toolName: "generate_images",
            ok: false,
            data: {
              confirmationRequired: true,
              prompt: "A login page matching the attached reference",
              count: 1,
              width: 1024,
              height: 1024,
            },
          },
          at: 1100,
        },
        {
          id: "confirm-image-live",
          type: "tool.confirm",
          data: {
            runId: "run-image",
            approvalId: "run-image:generate_images:abc",
            toolName: "generate_images",
            args: {
              prompt: "A login page matching the attached reference",
              count: 1,
            },
          },
          at: 1200,
        },
      ],
      false,
    );

    expect(timeline.some((entry) => entry.kind === "image_confirm")).toBe(false);
    expect(timeline.some((entry) => entry.kind === "tool_confirm")).toBe(true);
  });

  it("hides tool confirmation cards after the approval is resolved", () => {
    const timeline = buildChatTimeline(
      [],
      [
        {
          id: "confirm-image-2",
          type: "tool.confirm",
          data: {
            runId: "run-image",
            approvalId: "approval-image",
            toolName: "generate_images",
            riskLevel: "moderate",
            args: { prompt: "Real prompt", count: 1 },
          },
          at: 1200,
        },
        {
          id: "completed-image-2",
          type: "tool.completed",
          data: {
            runId: "run-image",
            approvalId: "approval-image",
            toolName: "generate_images",
            approved: true,
            outputSummary: "Started image generation",
          },
          at: 1300,
        },
      ],
      false
    );

    expect(timeline.some((entry) => entry.kind === "tool_confirm")).toBe(false);
  });

  it("maps persisted 💭 assistant messages to collapsed thought items", () => {
    const messages: ChatMessage[] = [
      {
        id: "t1",
        role: "assistant",
        content: formatThoughtMessageContent(
          "The user is asking me to think about pages."
        ),
        createdAt: "2026-07-22T00:00:00.000Z",
      },
      {
        id: "a1",
        role: "assistant",
        content: "这是正式回复",
        createdAt: "2026-07-22T00:00:01.000Z",
      },
    ];

    const timeline = buildChatTimeline(messages, [], false);
    expect(timeline.map((item) => item.kind)).toEqual(["thought", "assistant"]);
    expect(timeline[0]).toMatchObject({
      kind: "thought",
      content: "The user is asking me to think about pages.",
      streaming: false,
    });
  });

  it("renders ask_discovery questions as a waiting discovery form", () => {
    const messages: ChatMessage[] = [
      {
        id: "user-1",
        role: "user",
        content: "帮我做一个产品落地页",
        createdAt: new Date(1000).toISOString(),
      },
    ];
    const events: ChatLiveEvent[] = [
      {
        id: "dq-1",
        type: "discovery.questions",
        data: {
          runId: "run-1",
          title: "快速需求确认",
          questions: [
            { id: "productType", label: "要做什么？", type: "radio", options: ["落地页"] },
          ],
        },
        at: 1100,
      },
      {
        type: "run.waiting_user",
        data: { runId: "run-1", reason: "user_input_required" },
        at: 1200,
      },
    ];

    const turns = buildChatTimelineTurns(messages, events, false);
    expect(turns).toHaveLength(1);
    expect(turns[0].status).toBe("waiting");
    expect(turns[0].items.some((item) => item.kind === "discovery")).toBe(true);
  });
});

describe("describeFallbackActivity", () => {
  it("does not call a checkpoint reset an LLM outage", () => {
    expect(
      describeFallbackActivity({
        text: "Agent memory contained an incomplete tool-call checkpoint, so it has been reset. Retrying this request on a clean thread now.",
      })
    ).toEqual({
      tone: "info",
      text: "会话记忆不完整，已重置并自动重试。",
    });
  });

  it("keeps a real model outage as a warning", () => {
    expect(
      describeFallbackActivity({
        reason: "llm_unavailable",
        text: "LLM unavailable. Continued with the local rule engine.",
      })
    ).toEqual({
      tone: "warning",
      text: "模型请求失败，已改用本地规则流程继续。",
    });
  });
});

describe("buildChatTimeline fallback copy", () => {
  it("renders localized checkpoint reset instead of LLM unavailable", () => {
    const timeline = buildChatTimeline(
      [],
      [
        {
          type: "agent.fallback",
          data: {
            text: "\nAgent memory contained an incomplete tool-call checkpoint, so it has been reset. Retrying this request on a clean thread now.\n",
            runId: "YYtBrHSRQdRy",
          },
          at: 100,
        },
      ],
      false
    );
    const activity = timeline.find((item) => item.kind === "activity");
    expect(activity).toMatchObject({
      kind: "activity",
      tone: "info",
      text: "会话记忆不完整，已重置并自动重试。",
    });
  });
});

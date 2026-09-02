import { describe, expect, it } from "vitest";
import {
  AIMessage,
  HumanMessage,
  RemoveMessage,
  ToolMessage,
} from "@langchain/core/messages";
import {
  compactMessagesForContext,
  createContextWindowPreModelHook,
  isConsistentToolHistory,
  selectRecentWindow,
  summarizeMessagesExtractive,
} from "./context-window";

describe("isConsistentToolHistory", () => {
  it("accepts paired tool calls", () => {
    const messages = [
      new HumanMessage("hi"),
      new AIMessage({
        content: "",
        tool_calls: [{ id: "c1", name: "inspect_canvas", args: {}, type: "tool_call" }],
      }),
      new ToolMessage({ content: "ok", tool_call_id: "c1" }),
    ];
    expect(isConsistentToolHistory(messages)).toBe(true);
  });

  it("rejects dangling tool calls", () => {
    const messages = [
      new AIMessage({
        content: "",
        tool_calls: [{ id: "c1", name: "inspect_canvas", args: {}, type: "tool_call" }],
      }),
    ];
    expect(isConsistentToolHistory(messages)).toBe(false);
  });
});

describe("selectRecentWindow", () => {
  it("starts on human and keeps tool pairs", () => {
    const messages = [
      new HumanMessage("old"),
      new AIMessage("old reply"),
      new HumanMessage("new"),
      new AIMessage({
        content: "",
        tool_calls: [{ id: "c2", name: "generate_images", args: {}, type: "tool_call" }],
      }),
      new ToolMessage({ content: '{"summary":"done"}', tool_call_id: "c2" }),
    ];
    const recent = selectRecentWindow(messages, 3, 10_000);
    expect(isConsistentToolHistory(recent)).toBe(true);
    expect(recent.some((m) => m instanceof HumanMessage)).toBe(true);
  });
});

describe("summarizeMessagesExtractive", () => {
  it("captures user and tool lines", () => {
    const text = summarizeMessagesExtractive(
      [
        new HumanMessage("做一个赛博朋克落地页"),
        new AIMessage({
          content: "",
          tool_calls: [
            { id: "c1", name: "generate_brief", args: {}, type: "tool_call" },
          ],
        }),
        new ToolMessage({
          content: '{"summary":"Brief 已生成"}',
          tool_call_id: "c1",
          name: "generate_brief",
        }),
      ],
      2000
    );
    expect(text).toContain("用户:");
    expect(text).toContain("generate_brief");
  });
});

describe("compactMessagesForContext", () => {
  it("no-ops under soft limit", () => {
    const messages = [new HumanMessage("hi"), new AIMessage("hello")];
    const result = compactMessagesForContext(messages, {
      maxRecentMessages: 10,
      maxRecentChars: 10_000,
    });
    expect(result.changed).toBe(false);
    expect(result.llmMessages).toEqual(messages);
  });

  it("summarizes dropped history and can persist", () => {
    const messages = Array.from({ length: 40 }, (_, i) =>
      i % 2 === 0
        ? new HumanMessage(`用户消息 ${i}`)
        : new AIMessage(`助手回复 ${i}`)
    );
    const result = compactMessagesForContext(messages, {
      maxRecentMessages: 8,
      maxRecentChars: 50_000,
      persistAboveMessages: 20,
      persistAboveChars: 1_000_000,
    });
    expect(result.changed).toBe(true);
    expect(result.shouldPersist).toBe(true);
    expect(result.droppedCount).toBeGreaterThan(0);
    expect(String(result.llmMessages[0].content)).toContain("会话记忆摘要");
    expect(result.llmMessages.length).toBeLessThan(messages.length);
  });
});

describe("createContextWindowPreModelHook", () => {
  it("returns llmInputMessages when over soft limit but under persist", () => {
    const messages = Array.from({ length: 20 }, (_, i) =>
      new HumanMessage(`m${i} ${"x".repeat(100)}`)
    );
    const hook = createContextWindowPreModelHook({
      maxRecentMessages: 6,
      maxRecentChars: 5_000,
      persistAboveMessages: 100,
      persistAboveChars: 1_000_000,
    });
    const update = hook({ messages }) as {
      llmInputMessages?: unknown[];
      messages?: unknown[];
    };
    expect(update.llmInputMessages?.length).toBeGreaterThan(0);
    expect(update.messages).toBeUndefined();
  });

  it("rewrites checkpoint messages when over persist threshold", () => {
    const messages = Array.from({ length: 50 }, (_, i) =>
      new HumanMessage(`m${i}`)
    );
    const hook = createContextWindowPreModelHook({
      maxRecentMessages: 6,
      maxRecentChars: 50_000,
      persistAboveMessages: 10,
      persistAboveChars: 1_000_000,
    });
    const update = hook({ messages }) as {
      messages?: Array<{ type?: string; id?: string }>;
      llmInputMessages?: unknown[];
    };
    expect(RemoveMessage.isInstance(update.messages?.[0])).toBe(true);
    expect(update.llmInputMessages?.length).toBeGreaterThan(0);
  });
});

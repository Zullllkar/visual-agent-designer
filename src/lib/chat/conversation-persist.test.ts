import { describe, expect, it } from "vitest";

import {
  applyVadChatToState,
  parseVadChatPayload,
  resolveWriteConversationId,
} from "./conversation-persist";
import { createEmptyConversation } from "./conversation-model";
import { liveViewForConversation } from "./conversation-live-view";
import { resolveAgentRunThreadId } from "./resolve-run-thread";
import type { ChatMessage } from "@/lib/agents/chat-schema";

function msg(id: string, content: string): ChatMessage {
  return {
    id,
    role: "user",
    content,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("parseVadChatPayload", () => {
  it("reads conversations table", () => {
    const conv = createEmptyConversation("p1", {
      title: "默认对话",
      titleLocked: true,
      threadId: "thread-a",
    });
    conv.messages = [msg("m1", "hello")];
    const parsed = parseVadChatPayload({
      conversations: [conv],
      activeId: conv.id,
    });
    expect(parsed.conversations).toHaveLength(1);
    expect(parsed.activeId).toBe(conv.id);
    expect(parsed.legacyMessages).toBeUndefined();
  });

  it("reads legacy messages array", () => {
    const parsed = parseVadChatPayload({ messages: [msg("m1", "old")] });
    expect(parsed.legacyMessages?.[0]?.content).toBe("old");
    expect(parsed.conversations).toBeUndefined();
  });
});

describe("applyVadChatToState", () => {
  it("does not dump legacy history into an empty 新对话 when 默认对话 exists", () => {
    const def = createEmptyConversation("p1", {
      title: "默认对话",
      titleLocked: true,
      threadId: "thread-def",
    });
    def.messages = [msg("old", "历史")];
    const fresh = createEmptyConversation("p1", {
      title: "新对话",
      threadId: "thread-new",
    });
    const next = applyVadChatToState(
      { conversations: [def, fresh], activeId: fresh.id },
      { legacyMessages: [msg("disk", "磁盘历史")] },
      "p1"
    );
    const defNext = next.conversations.find((c) => c.id === def.id)!;
    const freshNext = next.conversations.find((c) => c.id === fresh.id)!;
    expect(freshNext.messages).toHaveLength(0);
    expect(defNext.messages.some((m) => m.id === "disk")).toBe(true);
    expect(next.activeId).toBe(fresh.id);
  });

  it("hydrates the only empty conversation from legacy messages", () => {
    const only = createEmptyConversation("p1", { title: "新对话" });
    const next = applyVadChatToState(
      { conversations: [only], activeId: only.id },
      { legacyMessages: [msg("d1", "唯一历史")] },
      "p1"
    );
    expect(next.conversations[0]!.messages[0]?.content).toBe("唯一历史");
  });

  it("merges disk conversations by id without dropping local-only chats", () => {
    const local = createEmptyConversation("p1", { title: "本地新对话" });
    const disk = createEmptyConversation("p1", {
      title: "默认对话",
      titleLocked: true,
      threadId: "thread-disk",
    });
    disk.messages = [msg("d1", "disk")];
    const next = applyVadChatToState(
      { conversations: [local], activeId: local.id },
      { conversations: [disk], activeId: disk.id },
      "p1"
    );
    expect(next.conversations.some((c) => c.id === local.id)).toBe(true);
    expect(next.conversations.some((c) => c.id === disk.id)).toBe(true);
    expect(next.activeId).toBe(local.id);
  });
});

describe("resolveWriteConversationId", () => {
  it("prefers the bound conversation over active", () => {
    expect(
      resolveWriteConversationId({
        boundId: "conv-a",
        activeId: "conv-b",
        ids: ["conv-a", "conv-b"],
      })
    ).toBe("conv-a");
  });

  it("falls back to active when bound is gone", () => {
    expect(
      resolveWriteConversationId({
        boundId: "missing",
        activeId: "conv-b",
        ids: ["conv-b"],
      })
    ).toBe("conv-b");
  });
});

describe("liveViewForConversation", () => {
  it("hides live events when viewing another conversation", () => {
    const view = liveViewForConversation({
      activeConversationId: "conv-b",
      runConversationId: "conv-a",
      liveEvents: [{ id: "e1" }],
      status: "streaming",
    });
    expect(view.liveEvents).toEqual([]);
    expect(view.status).toBe("idle");
    expect(view.isRunOwner).toBe(false);
  });

  it("keeps live events on the conversation that started the run", () => {
    const view = liveViewForConversation({
      activeConversationId: "conv-a",
      runConversationId: "conv-a",
      liveEvents: [{ id: "e1" }],
      status: "streaming",
    });
    expect(view.liveEvents).toHaveLength(1);
    expect(view.status).toBe("streaming");
    expect(view.isRunOwner).toBe(true);
  });
});

describe("resolveAgentRunThreadId", () => {
  it("rejects missing threadId instead of falling back", () => {
    const result = resolveAgentRunThreadId({ projectId: "p1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("THREAD_ID_REQUIRED");
  });

  it("accepts explicit threadId", () => {
    const result = resolveAgentRunThreadId({
      projectId: "p1",
      threadId: "thread-abc",
    });
    expect(result).toEqual({ ok: true, threadId: "thread-abc" });
  });
});

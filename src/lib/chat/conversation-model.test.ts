import { describe, expect, it } from "vitest";

import { migrateLegacyChatState } from "@/lib/chat/conversation-model";
import {
  deriveConversationTitle,
  stripChatTitlePrefixes,
} from "@/lib/chat/conversation-title";

describe("conversation-title", () => {
  it("strips reference prefixes", () => {
    expect(
      stripChatTitlePrefixes("【引用素材: 定价#abc】 【参考图: x#1】 生成变体")
    ).toBe("生成变体");
  });

  it("derives truncated title", () => {
    const long = "这是一段很长的用户需求描述用来测试标题截断是否正确工作";
    expect(deriveConversationTitle(long, 8).endsWith("…")).toBe(true);
  });
});

describe("migrateLegacyChatState", () => {
  it("turns old sessions into a locked 默认对话", () => {
    const migrated = migrateLegacyChatState({
      sessions: {
        p1: [
          {
            id: "m1",
            role: "user",
            content: "hello",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
      threadIds: { p1: "thread-legacy" },
    });
    expect(migrated.conversationsByProject.p1).toHaveLength(1);
    const conv = migrated.conversationsByProject.p1![0]!;
    expect(conv.title).toBe("默认对话");
    expect(conv.titleLocked).toBe(true);
    expect(conv.threadId).toBe("thread-legacy");
    expect(conv.messages[0]?.content).toBe("hello");
    expect(migrated.activeIdByProject.p1).toBe(conv.id);
  });
});

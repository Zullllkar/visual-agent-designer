import { describe, expect, it, vi } from "vitest";

import { createEmptyConversation } from "./conversation-model";
import { resolveSendConversation } from "./resolve-send-conversation";

describe("resolveSendConversation", () => {
  it("creates a conversation when home send races ahead of chat hydrate", () => {
    const created = createEmptyConversation("p1");
    const ensure = vi.fn(() => created);

    const resolved = resolveSendConversation(null, ensure);

    expect(ensure).toHaveBeenCalledOnce();
    expect(resolved.threadId).toBe(created.threadId);
    expect(resolved.id).toBe(created.id);
  });

  it("reuses the active conversation when it already has a threadId", () => {
    const existing = createEmptyConversation("p1", {
      threadId: "thread-existing",
    });
    const ensure = vi.fn(() => createEmptyConversation("p1"));

    const resolved = resolveSendConversation(existing, ensure);

    expect(ensure).not.toHaveBeenCalled();
    expect(resolved.threadId).toBe("thread-existing");
  });
});

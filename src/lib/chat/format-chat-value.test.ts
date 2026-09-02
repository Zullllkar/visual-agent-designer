import { describe, expect, it } from "vitest";

import { formatChatValue } from "./format-chat-value";

describe("formatChatValue", () => {
  it("extracts text from structured content parts", () => {
    expect(formatChatValue({ type: "text", text: "hello" })).toBe("hello");
    expect(formatChatValue([{ type: "text", text: "hello" }, { text: "world" }])).toBe(
      "hello\nworld"
    );
  });

  it("does not render JavaScript object placeholders", () => {
    expect(formatChatValue("[object Object]")).toBe("");
  });

  it("falls back to JSON for unknown objects", () => {
    expect(formatChatValue({ foo: "bar" })).toContain('"foo": "bar"');
  });
});

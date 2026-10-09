import { describe, expect, it } from "vitest";
import { createBuildStreamParser, parseBuildStreamObject } from "./build-stream";

describe("parseBuildStreamObject", () => {
  it("extracts cursor assistant text and tool calls", () => {
    const text = parseBuildStreamObject("cursor", {
      type: "assistant",
      message: { content: [{ type: "text", text: "Reading DESIGN.md" }] },
    });
    expect(text[0]).toMatchObject({ kind: "text", text: "Reading DESIGN.md" });

    const tool = parseBuildStreamObject("cursor", {
      type: "tool_call",
      name: "Read",
      input: { path: "design/vibeboard/DESIGN.md" },
    });
    expect(tool[0]).toMatchObject({
      kind: "tool",
      name: "Read",
      text: "design/vibeboard/DESIGN.md",
    });
  });

  it("extracts claude text deltas and tool_use blocks", () => {
    const delta = parseBuildStreamObject("claude", {
      type: "content_block_delta",
      delta: { type: "text_delta", text: "Hello" },
    });
    expect(delta[0]).toMatchObject({ kind: "text", text: "Hello" });

    const tool = parseBuildStreamObject("claude", {
      type: "content_block_start",
      content_block: { type: "tool_use", name: "Edit", input: { file_path: "src/App.tsx" } },
    });
    expect(tool[0]).toMatchObject({ kind: "tool", name: "Edit", text: "src/App.tsx" });
  });

  it("extracts codex thread id, shell commands, and agent messages", () => {
    const thread = parseBuildStreamObject("codex", { type: "thread.started", thread_id: "thr_1" });
    expect(thread[0]?.text).toContain("thr_1");

    const shell = parseBuildStreamObject("codex", {
      type: "item.started",
      item: { type: "command_execution", command: "npm test" },
    });
    expect(shell[0]).toMatchObject({ kind: "tool", name: "shell", text: "npm test" });

    const msg = parseBuildStreamObject("codex", {
      type: "item.completed",
      item: { type: "agent_message", text: "Done." },
    });
    expect(msg[0]).toMatchObject({ kind: "text", text: "Done." });
  });

  it("turns JSON error objects into error events", () => {
    const ev = parseBuildStreamObject("claude", { type: "error", message: "not logged in" });
    expect(ev[0]).toMatchObject({ kind: "error", text: "not logged in" });
  });
});

describe("createBuildStreamParser", () => {
  it("parses JSONL, splits incomplete lines, and maps stderr", () => {
    const parser = createBuildStreamParser("cursor");
    const first = parser.push(
      '{"type":"assistant","message":{"content":[{"type":"text","text":"Hel"',
    );
    expect(first).toEqual([]);
    const second = parser.push('}]}}\n{"type":"assistant","message":{"text":"Hello"}}\n');
    expect(second.some((e) => e.kind === "text")).toBe(true);
    const err = parser.push("boom\n", "stderr");
    expect(err[0]).toMatchObject({ kind: "stderr", text: "boom" });
  });

  it("dedupes a full-turn replay against already streamed text", () => {
    const parser = createBuildStreamParser("cursor");
    parser.push('{"type":"assistant","timestamp_ms":1,"message":{"text":"Hello"}}\n');
    const replay = parser.push('{"type":"assistant","message":{"text":"Hello world"}}\n');
    expect(replay.map((e) => e.text).join("")).toBe(" world");
  });
});

/**
 * 三端 JSONL 事件流 → 统一日志
 * --------------------------------------------------------------
 * 不追求 Open Design 那套完整 delta 去重，只把用户能看懂的
 * 文本 / 工具 / 错误抽出来。非 JSON 行落到 stderr/raw。
 */

import type { BridgeAgentSlug } from "./install-planner";

export type BuildLogKind = "status" | "text" | "thinking" | "tool" | "error" | "stderr";

export interface BuildLogEvent {
  ts: number;
  kind: BuildLogKind;
  text: string;
  name?: string;
  seq?: number;
}

type JsonObject = Record<string, unknown>;

function isRecord(value: unknown): value is JsonObject {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function extractText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return "";
  if (typeof value.text === "string" && value.text) return value.text;
  if (typeof value.content === "string" && value.content) return value.content;
  if (Array.isArray(value.content)) {
    return value.content
      .map((part) => {
        if (typeof part === "string") return part;
        if (isRecord(part) && typeof part.text === "string") return part.text;
        return "";
      })
      .join("");
  }
  if (Array.isArray(value)) {
    return (value as unknown[]).map(extractText).join("");
  }
  return "";
}

function toolName(value: unknown): string {
  if (!isRecord(value)) return "tool";
  return asString(value.name) || asString(value.tool) || asString(value.type) || "tool";
}

function toolSummary(value: unknown): string {
  if (!isRecord(value)) return "";
  const input = isRecord(value.input)
    ? value.input
    : isRecord(value.arguments)
      ? value.arguments
      : isRecord(value.args)
        ? value.args
        : value;
  const path =
    asString(input.path) ||
    asString(input.file_path) ||
    asString(input.filePath) ||
    asString(input.command) ||
    asString(input.cmd);
  return path;
}

export function parseBuildStreamObject(
  slug: BridgeAgentSlug,
  obj: unknown,
  now = Date.now(),
): BuildLogEvent[] {
  if (!isRecord(obj)) return [];
  const type = asString(obj.type) || asString(obj.event);
  const subtype = asString(obj.subtype);

  if (type === "system" && (subtype === "init" || subtype === "status")) {
    const model = asString(obj.model);
    return [event("status", model ? `初始化 · ${model}` : "初始化", now)];
  }

  if (type === "error" || type === "turn.failed" || obj.is_error === true) {
    const message =
      extractText(obj.error) || asString(obj.message) || asString(obj.error) || "agent error";
    return message ? [event("error", message, now)] : [];
  }

  if (slug === "codex") return parseCodex(obj, type, now);
  if (slug === "claude") return parseClaude(obj, type, now);
  return parseCursor(obj, type, now);
}

function parseCursor(obj: JsonObject, type: string, now: number): BuildLogEvent[] {
  if (type === "assistant") {
    const text = extractText(obj.message ?? obj);
    return text ? [event("text", text, now)] : [];
  }
  if (type === "tool_call" || type === "tool_use") {
    const name = toolName(obj.tool_call ?? obj);
    const summary = toolSummary(obj.tool_call ?? obj.input ?? obj);
    return [event("tool", summary || name, now, name)];
  }
  if (type === "result") {
    const text = extractText(obj.result) || asString(obj.subtype) || "完成";
    return [event("status", text.slice(0, 240), now)];
  }
  return fallbackAssistant(obj, now);
}

function parseClaude(obj: JsonObject, type: string, now: number): BuildLogEvent[] {
  if (type === "assistant") {
    const text = extractText(obj.message ?? obj);
    const tools = Array.isArray(
      (isRecord(obj.message) ? obj.message.content : obj.content) as unknown[],
    )
      ? ((isRecord(obj.message) ? obj.message.content : obj.content) as unknown[]).filter(
          (part) => isRecord(part) && part.type === "tool_use",
        )
      : [];
    const events: BuildLogEvent[] = [];
    if (text) events.push(event("text", text, now));
    for (const tool of tools) {
      const name = toolName(tool);
      events.push(event("tool", toolSummary(tool) || name, now, name));
    }
    return events;
  }
  if (type === "content_block_delta") {
    const delta = isRecord(obj.delta) ? obj.delta : obj;
    const text = asString(isRecord(delta) ? delta.text : "") || extractText(delta);
    return text ? [event("text", text, now)] : [];
  }
  if (type === "content_block_start") {
    const block = isRecord(obj.content_block) ? obj.content_block : null;
    if (block && block.type === "tool_use") {
      const name = toolName(block);
      return [event("tool", toolSummary(block) || name, now, name)];
    }
    if (block && block.type === "thinking") {
      const text = extractText(block);
      return text ? [event("thinking", text, now)] : [];
    }
  }
  if (type === "result") {
    return [event("status", asString(obj.subtype) || "完成", now)];
  }
  return fallbackAssistant(obj, now);
}

function parseCodex(obj: JsonObject, type: string, now: number): BuildLogEvent[] {
  if (type === "thread.started") {
    const id = asString(obj.thread_id);
    return [event("status", id ? `会话 ${id}` : "会话开始", now)];
  }
  const item = isRecord(obj.item) ? obj.item : isRecord(obj.msg) ? obj.msg : obj;
  const itemType = asString(item.type);
  if (type === "item.started" || type === "item.updated") {
    if (itemType === "command_execution" || itemType === "cmd") {
      const cmd = asString(item.command) || asString(item.cmd) || "shell";
      return [event("tool", cmd, now, "shell")];
    }
    if (itemType === "file_change" || itemType === "file_edit") {
      const file = asString(item.path) || asString(item.file) || "file";
      return [event("tool", file, now, itemType)];
    }
  }
  if (type === "item.completed") {
    if (itemType === "agent_message" || itemType === "message") {
      const text = extractText(item) || asString(item.text);
      return text ? [event("text", text, now)] : [];
    }
    if (itemType === "reasoning") {
      const text = extractText(item);
      return text ? [event("thinking", text, now)] : [];
    }
  }
  if (type === "turn.completed") {
    return [event("status", "回合完成", now)];
  }
  return fallbackAssistant(obj, now);
}

function fallbackAssistant(obj: JsonObject, now: number): BuildLogEvent[] {
  const text = extractText(obj.message) || extractText(obj);
  if (text && text.length < 4000 && !asString(obj.type).includes("delta")) {
    return [event("text", text, now)];
  }
  return [];
}

function event(kind: BuildLogKind, text: string, ts: number, name?: string): BuildLogEvent {
  return { ts, kind, text: text.slice(0, 8000), name };
}

export function createBuildStreamParser(slug: BridgeAgentSlug): {
  push(chunk: string, stream?: "stdout" | "stderr"): BuildLogEvent[];
  flush(): BuildLogEvent[];
} {
  let stdoutBuf = "";
  let stderrBuf = "";
  let lastText = "";

  const consume = (incoming: BuildLogEvent[]): BuildLogEvent[] => {
    const out: BuildLogEvent[] = [];
    for (const ev of incoming) {
      if (ev.kind === "text") {
        if (!ev.text || ev.text === lastText) continue;
        if (ev.text.startsWith(lastText)) {
          const suffix = ev.text.slice(lastText.length);
          lastText = ev.text;
          if (suffix) out.push({ ...ev, text: suffix });
          continue;
        }
        lastText += ev.text;
      }
      out.push(ev);
    }
    return out;
  };

  const takeLines = (
    buf: string,
    stream: "stdout" | "stderr",
  ): { rest: string; events: BuildLogEvent[] } => {
    const parts = buf.split(/\r?\n/);
    const rest = parts.pop() ?? "";
    const events: BuildLogEvent[] = [];
    for (const line of parts) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (stream === "stderr") {
        events.push(event("stderr", trimmed, Date.now()));
        continue;
      }
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        events.push(...parseBuildStreamObject(slug, parsed));
      } catch {
        events.push(event("text", trimmed, Date.now()));
      }
    }
    return { rest, events: consume(events) };
  };

  return {
    push(chunk: string, stream: "stdout" | "stderr" = "stdout") {
      if (stream === "stderr") {
        stderrBuf += chunk;
        const taken = takeLines(stderrBuf, "stderr");
        stderrBuf = taken.rest;
        return taken.events;
      }
      stdoutBuf += chunk;
      const taken = takeLines(stdoutBuf, "stdout");
      stdoutBuf = taken.rest;
      return taken.events;
    },
    flush() {
      const events: BuildLogEvent[] = [];
      if (stdoutBuf.trim()) {
        const taken = takeLines(`${stdoutBuf}\n`, "stdout");
        events.push(...taken.events);
        stdoutBuf = "";
      }
      if (stderrBuf.trim()) {
        const taken = takeLines(`${stderrBuf}\n`, "stderr");
        events.push(...taken.events);
        stderrBuf = "";
      }
      return events;
    },
  };
}

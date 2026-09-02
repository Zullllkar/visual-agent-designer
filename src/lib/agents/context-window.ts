/**
 * Agent 上下文滑动窗口 + 旧消息摘要
 * --------------------------------------------------------------
 * 在 createReactAgent.preModelHook 中调用：
 * - 近期消息原样保留（对齐 tool_call 配对）
 * - 更早消息压成短摘要
 * - 超阈值时写回 checkpoint，避免 SQLite 无限膨胀
 *
 * @author：wangjunhua
 */

import {
  RemoveMessage,
  SystemMessage,
  isAIMessage,
  isHumanMessage,
  isSystemMessage,
  isToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { REMOVE_ALL_MESSAGES } from "@langchain/langgraph";

export interface ContextWindowOptions {
  /** 近期保留的最大消息条数（含 tool） */
  maxRecentMessages: number;
  /** 近期保留的最大字符预算（近似 token） */
  maxRecentChars: number;
  /** 摘要最大字符 */
  maxSummaryChars: number;
  /**
   * 超过该条数才压缩并写回 checkpoint。
   * 低于阈值时仅通过 llmInputMessages 裁剪，不改持久化历史。
   */
  persistAboveMessages: number;
  /** 超过该字符数写回 checkpoint */
  persistAboveChars: number;
}

export const DEFAULT_CONTEXT_WINDOW: ContextWindowOptions = {
  maxRecentMessages: 24,
  maxRecentChars: 60_000,
  maxSummaryChars: 4_000,
  persistAboveMessages: 36,
  persistAboveChars: 90_000,
};

export interface CompactResult {
  /** 是否发生了裁剪/摘要 */
  changed: boolean;
  /** 是否应覆盖 checkpoint messages */
  shouldPersist: boolean;
  /** 送给 LLM 的消息 */
  llmMessages: BaseMessage[];
  /** 写回 checkpoint 的消息（通常与 llmMessages 相同） */
  persistMessages: BaseMessage[];
  droppedCount: number;
  summaryText: string | null;
}

export function estimateMessageChars(message: BaseMessage): number {
  return messageContentToString(message.content).length + 32;
}

export function estimateMessagesChars(messages: BaseMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateMessageChars(m), 0);
}

export function messageContentToString(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .join("");
  }
  if (content == null) return "";
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

/** 工具调用配对是否完整（无悬空 tool_call_id） */
export function isConsistentToolHistory(messages: BaseMessage[]): boolean {
  const pending = new Set<string>();
  for (const message of messages) {
    if (isAIMessage(message) && message.tool_calls?.length) {
      for (const call of message.tool_calls) {
        if (call.id) pending.add(call.id);
      }
    } else if (isToolMessage(message) && message.tool_call_id) {
      pending.delete(message.tool_call_id);
    }
  }
  return pending.size === 0;
}

/**
 * 从尾部选取近期窗口，并裁到安全起点（优先 Human，且 tool 配对完整）。
 */
export function selectRecentWindow(
  messages: BaseMessage[],
  maxMessages: number,
  maxChars: number
): BaseMessage[] {
  if (messages.length === 0) return [];

  const kept: BaseMessage[] = [];
  let chars = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    const nextChars = chars + estimateMessageChars(msg);
    if (kept.length >= maxMessages || (kept.length > 0 && nextChars > maxChars)) {
      break;
    }
    kept.unshift(msg);
    chars = nextChars;
  }

  const safeStart = findSafeStartIndex(kept);
  return kept.slice(safeStart);
}

function findSafeStartIndex(messages: BaseMessage[]): number {
  for (let i = 0; i < messages.length; i += 1) {
    if (!isHumanMessage(messages[i])) continue;
    if (isConsistentToolHistory(messages.slice(i))) return i;
  }
  for (let i = 0; i < messages.length; i += 1) {
    if (isConsistentToolHistory(messages.slice(i))) return i;
  }
  return 0;
}

/** 对将丢弃的旧消息做抽取式摘要（不另调 LLM） */
export function summarizeMessagesExtractive(
  messages: BaseMessage[],
  maxSummaryChars: number
): string {
  const lines: string[] = [];
  for (const message of messages) {
    if (isSystemMessage(message)) {
      const text = messageContentToString(message.content).trim();
      if (text.startsWith("[会话记忆摘要")) continue;
      if (text) lines.push(`系统: ${clip(text, 160)}`);
      continue;
    }
    if (isHumanMessage(message)) {
      const text = messageContentToString(message.content).trim();
      if (text) lines.push(`用户: ${clip(text, 220)}`);
      continue;
    }
    if (isAIMessage(message)) {
      const tools =
        message.tool_calls?.map((t) => t.name).filter(Boolean) ?? [];
      if (tools.length > 0) {
        lines.push(`助手调用: ${tools.join(", ")}`);
      }
      const text = messageContentToString(message.content).trim();
      if (text) lines.push(`助手: ${clip(text, 180)}`);
      continue;
    }
    if (isToolMessage(message)) {
      const name = message.name ?? message.tool_call_id ?? "tool";
      const text = messageContentToString(message.content).trim();
      lines.push(`工具(${name}): ${clip(text, 140)}`);
    }
  }

  const joined = lines.slice(-48).join("\n");
  if (joined.length <= maxSummaryChars) return joined;
  return `${joined.slice(0, maxSummaryChars - 20)}\n…[摘要已截断]`;
}

export function compactMessagesForContext(
  messages: BaseMessage[],
  options: Partial<ContextWindowOptions> = {}
): CompactResult {
  const opts = { ...DEFAULT_CONTEXT_WINDOW, ...options };
  const totalChars = estimateMessagesChars(messages);

  const withinSoft =
    messages.length <= opts.maxRecentMessages &&
    totalChars <= opts.maxRecentChars;
  if (withinSoft) {
    return {
      changed: false,
      shouldPersist: false,
      llmMessages: messages,
      persistMessages: messages,
      droppedCount: 0,
      summaryText: null,
    };
  }

  const recent = selectRecentWindow(
    messages,
    opts.maxRecentMessages,
    opts.maxRecentChars
  );
  const recentStartIdx = findRecentStartIndex(messages, recent);
  const droppedByIndex = messages.slice(0, recentStartIdx);

  const summaryText = summarizeMessagesExtractive(
    droppedByIndex,
    opts.maxSummaryChars
  );
  const summaryMessage = new SystemMessage({
    content: [
      `[会话记忆摘要 · 已压缩 ${droppedByIndex.length} 条旧消息]`,
      "以下为较早对话的要点，细节以当前项目状态与近期消息为准：",
      summaryText || "(无文本要点)",
    ].join("\n"),
  });

  const llmMessages = [summaryMessage, ...recent];
  const shouldPersist =
    messages.length >= opts.persistAboveMessages ||
    totalChars >= opts.persistAboveChars;

  return {
    changed: true,
    shouldPersist,
    llmMessages,
    persistMessages: llmMessages,
    droppedCount: droppedByIndex.length,
    summaryText,
  };
}

/** createReactAgent.preModelHook */
export function createContextWindowPreModelHook(
  options: Partial<ContextWindowOptions> = {}
) {
  return (state: { messages?: BaseMessage[] }) => {
    const messages = state.messages ?? [];
    const result = compactMessagesForContext(messages, options);

    if (!result.changed) {
      return {};
    }

    if (result.shouldPersist) {
      return {
        messages: [
          new RemoveMessage({ id: REMOVE_ALL_MESSAGES }),
          ...result.persistMessages,
        ],
        llmInputMessages: result.llmMessages,
      };
    }

    // 未达持久化阈值：只裁剪本次 LLM 输入，保留完整 checkpoint
    return {
      llmInputMessages: result.llmMessages,
    };
  };
}

function findRecentStartIndex(
  messages: BaseMessage[],
  recent: BaseMessage[]
): number {
  if (recent.length === 0) return messages.length;
  const first = recent[0];
  for (let i = 0; i <= messages.length - recent.length; i += 1) {
    if (messages[i] !== first) continue;
    let match = true;
    for (let j = 0; j < recent.length; j += 1) {
      if (messages[i + j] !== recent[j]) {
        match = false;
        break;
      }
    }
    if (match) return i;
  }
  return Math.max(0, messages.length - recent.length);
}

function clip(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 1)}…`;
}

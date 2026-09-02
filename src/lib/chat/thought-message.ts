/**
 * 思考消息前缀（持久化 assistant 消息用标记识别为 thought）
 */

/** 💭 + 空格 */
export const THOUGHT_MESSAGE_PREFIX = "\u{1F4AD} ";

/** 历史误编码前缀（UTF-8 💭 被当 Latin1 再解成的「馃挱」） */
const THOUGHT_PREFIX_MOJIBAKE = "\u9983\u6331 ";

export function isThoughtMessageContent(content: string): boolean {
  return (
    content.startsWith(THOUGHT_MESSAGE_PREFIX) ||
    content.startsWith(THOUGHT_PREFIX_MOJIBAKE)
  );
}

export function stripThoughtMessagePrefix(content: string): string {
  if (content.startsWith(THOUGHT_MESSAGE_PREFIX)) {
    return content.slice(THOUGHT_MESSAGE_PREFIX.length).trim();
  }
  if (content.startsWith(THOUGHT_PREFIX_MOJIBAKE)) {
    return content.slice(THOUGHT_PREFIX_MOJIBAKE.length).trim();
  }
  return content.trim();
}

export function formatThoughtMessageContent(thinking: string): string {
  const trimmed = thinking.trim();
  return trimmed ? `${THOUGHT_MESSAGE_PREFIX}${trimmed}` : "";
}

/** 折叠态展示的最新一行思考（Cursor / Codex：收起时仍流式刷尾句） */
export function latestThoughtPreview(content: string): string {
  const lines = content
    .split(/\n+/)
    .map((line) =>
      line
        .replace(/^#{1,6}\s+/, "")
        .replace(/^[-*+]\s+/, "")
        .replace(/^\d+\.\s+/, "")
        .replace(/^>\s?/, "")
        .trim()
    )
    .filter(Boolean);
  return lines[lines.length - 1] ?? "";
}

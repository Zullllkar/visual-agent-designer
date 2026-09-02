/**
 * 对话标题：去掉侧栏引用前缀后截断
 * @author：wangjunhua
 */

const REF_PREFIX =
  /^(?:【引用素材:[^】]*】|【参考图:[^】]*】|【引用页面:[^】]*】|【引用元素:[^】]*】|\s)+/u;

export function stripChatTitlePrefixes(text: string): string {
  return text.replace(REF_PREFIX, "").replace(/\s+/g, " ").trim();
}

export function deriveConversationTitle(
  userMessage: string,
  maxChars = 24
): string {
  const cleaned = stripChatTitlePrefixes(userMessage);
  if (!cleaned) return "新对话";
  if (cleaned.length <= maxChars) return cleaned;
  return `${cleaned.slice(0, maxChars)}…`;
}

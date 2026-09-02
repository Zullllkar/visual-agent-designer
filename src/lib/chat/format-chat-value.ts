import {
  isChatTechnicalNoise,
  isNoiseValue,
} from "@/lib/chat/chat-content-noise";

/** 是否值得写入侧栏历史（过滤工具 JSON / LangChain 转储） */
export function shouldPersistChatText(text: string): boolean {
  const trimmed = text.trim();
  return Boolean(trimmed && !isChatTechnicalNoise(trimmed));
}

export function formatChatValue(value: unknown): string {
  if (typeof value === "string") {
    return value === "[object Object]" ? "" : value;
  }
  if (value == null) return "";
  if (Array.isArray(value)) {
    return value.map((item) => formatChatValue(item)).filter(Boolean).join("\n");
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;

    // 工具回执：只露出 summary，避免整段 JSON 进侧栏
    if (
      typeof record.ok === "boolean" &&
      typeof record.summary === "string" &&
      record.summary.trim()
    ) {
      return record.summary.trim();
    }

    // LangChain ToolMessage 等：优先可读 input/content，否则视为噪声清空
    if (isNoiseValue(record)) {
      const input = record.input;
      if (typeof input === "string" && input.trim() && input.trim().length < 400) {
        return input.trim();
      }
      const content = record.content;
      if (typeof content === "string" && content.trim()) {
        return content.trim();
      }
      if (typeof record.summary === "string" && record.summary.trim()) {
        return record.summary.trim();
      }
      return "";
    }

    const directText =
      record.text ?? record.content ?? record.message ?? record.label ?? record.title;
    if (typeof directText === "string") return directText;
    if (Array.isArray(directText)) return formatChatValue(directText);
    if (record.type === "text" && typeof record.value === "string") return record.value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return "";
    }
  }
  return String(value);
}

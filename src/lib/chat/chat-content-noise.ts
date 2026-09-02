/**
 * 识别不应作为助手气泡展示的技术噪声（工具回执 JSON、LangChain 消息转储等）
 * @author：wangjunhua
 */

export function isChatTechnicalNoise(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return false;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return isNoiseValue(parsed);
  } catch {
    return false;
  }
}

export function isNoiseValue(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    return value.length > 0 && value.every(isNoiseValue);
  }
  const record = value as Record<string, unknown>;

  // 工具回执信封：{ ok, summary, data }
  if (
    typeof record.ok === "boolean" &&
    (typeof record.summary === "string" || "data" in record)
  ) {
    return true;
  }

  // LangChain 序列化消息 / ToolMessage 残片
  if ("additional_kwargs" in record || "response_metadata" in record) {
    return true;
  }
  if (record.lc != null && typeof record.type === "string") {
    return true;
  }
  if (
    record.versions &&
    typeof record.versions === "object" &&
    !Array.isArray(record.versions) &&
    "@langchain/core" in (record.versions as Record<string, unknown>)
  ) {
    return true;
  }

  return false;
}

/**
 * Agent 上下文预算：检测溢出 + 截断工具结果，避免 checkpoint 无限膨胀。
 * Cursor / Codex 同类策略：工具输出落盘摘要进模型，原始大 payload 不进对话历史。
 *
 * @author：wangjunhua
 */

const DEFAULT_MAX_TOOL_JSON_CHARS = 12_000;
const DEFAULT_MAX_STRING_CHARS = 2_000;

/** DeepSeek / OpenAI 等常见 context overflow 文案 */
export function isContextLengthError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("maximum context length") ||
    normalized.includes("context_length_exceeded") ||
    normalized.includes("context length") ||
    normalized.includes("too many tokens") ||
    normalized.includes("prompt is too long") ||
    (normalized.includes("max_tokens") && normalized.includes("exceed")) ||
    (normalized.includes("requested") &&
      normalized.includes("tokens") &&
      normalized.includes("messages"))
  );
}

/**
 * 把工具返回裁成适合写进 LLM / checkpoint 的短 JSON。
 * - 剥掉 data:image / 超长 base64
 * - 限制字符串与整体体积
 */
export function truncateToolResultForLlm(
  payload: unknown,
  options?: { maxJsonChars?: number; maxStringChars?: number }
): unknown {
  const maxJsonChars = options?.maxJsonChars ?? DEFAULT_MAX_TOOL_JSON_CHARS;
  const maxStringChars = options?.maxStringChars ?? DEFAULT_MAX_STRING_CHARS;
  const compacted = compactValue(payload, maxStringChars);
  const json = JSON.stringify(compacted);
  if (json.length <= maxJsonChars) return compacted;
  return {
    ok: typeof (payload as { ok?: unknown })?.ok === "boolean"
      ? (payload as { ok: boolean }).ok
      : true,
    summary:
      typeof (payload as { summary?: unknown })?.summary === "string"
        ? (payload as { summary: string }).summary
        : "工具结果过大，已截断后写入会话记忆。",
    data: {
      truncated: true,
      originalChars: json.length,
      maxChars: maxJsonChars,
      preview: json.slice(0, Math.min(800, maxJsonChars)),
    },
  };
}

function compactValue(value: unknown, maxStringChars: number): unknown {
  if (typeof value === "string") {
    if (value.startsWith("data:image") || looksLikeBase64Blob(value)) {
      return `[omitted binary/base64 ${value.length} chars]`;
    }
    if (value.length > maxStringChars) {
      return `${value.slice(0, maxStringChars)}…[truncated ${value.length - maxStringChars} chars]`;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 40).map((item) => compactValue(item, maxStringChars));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (
        /^(screenshot|dataUrl|imageUrl|imageBase64|base64|src)$/i.test(key) &&
        typeof child === "string" &&
        (child.startsWith("data:") || child.length > 400)
      ) {
        out[key] = `[omitted ${key} ${child.length} chars]`;
        continue;
      }
      out[key] = compactValue(child, maxStringChars);
    }
    return out;
  }
  return value;
}

function looksLikeBase64Blob(value: string): boolean {
  return value.length > 4_000 && /^[A-Za-z0-9+/=\s]+$/.test(value.slice(0, 200));
}

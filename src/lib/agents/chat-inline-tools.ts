/**
 * Chat-inline tools — 对话类能力，应走 thinking + assistant 主通道，
 * 不展示为 ToolBlock「执行任务」。
 */

import type { ToolCall } from "@/lib/agents/chat-schema";

/** 历史上用工具包装的纯问答；Agent 侧已改为直出，保留名单做兼容提升 */
export const CHAT_INLINE_TOOL_NAMES = new Set<ToolCall["name"]>([
  "answer_question",
]);

export function isChatInlineTool(name: string | undefined | null): boolean {
  if (!name) return false;
  return CHAT_INLINE_TOOL_NAMES.has(name as ToolCall["name"]);
}

/** 从工具输出里抽出应展示给用户的回答正文 */
export function extractChatInlineAnswerText(output: unknown): string | undefined {
  if (typeof output === "string") {
    const trimmed = output.trim();
    if (!trimmed) return undefined;
    try {
      return extractChatInlineAnswerText(JSON.parse(trimmed) as unknown);
    } catch {
      return trimmed;
    }
  }
  if (!output || typeof output !== "object") return undefined;
  const obj = output as Record<string, unknown>;
  if (typeof obj.summary === "string" && obj.summary.trim()) return obj.summary;
  if (typeof obj.text === "string" && obj.text.trim()) return obj.text;
  if (typeof obj.message === "string" && obj.message.trim()) return obj.message;
  if (obj.data && typeof obj.data === "object") {
    const data = obj.data as Record<string, unknown>;
    if (typeof data.text === "string" && data.text.trim()) return data.text;
  }
  return undefined;
}

/**
 * 启发式：更像讨论/问答，而非生图或改项目。
 */
export function isLikelyPureQuestion(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (
    /[?？]|还需要|哪些|什么|怎么|如何|为什么|为何|是否|建议|推荐|分析一下|讨论|思考|think about|which pages|what else|优先/i.test(
      t
    )
  ) {
    return true;
  }
  return /^(什么|如何|为什么|是否|哪些|还要|建议|what|how|why|is |are |should )/i.test(
    t
  );
}

/**
 * 明确要求立刻做视觉工作（生图/出图），应走工具。
 * 比「消息里出现页面/UI 字样」更窄，避免「还需要哪些页面」被误判成生图。
 */
export function isExplicitVisualWorkRequest(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (
    /生图|出图|生成\s*\d+\s*张|做一张|画一张|开始生成|执行生图|确认生成|重新生成|换图|局部重绘/i.test(
      t
    )
  ) {
    return true;
  }
  // 讨论语气优先 chat（如「还需要哪些页面」）
  if (isLikelyPureQuestion(t)) return false;
  return /生成.*(图|海报|素材|ui|界面|landing|首页|主页|页面|dashboard|screen)|帮我生成|做.*页面|画.*界面/i.test(
    t
  );
}

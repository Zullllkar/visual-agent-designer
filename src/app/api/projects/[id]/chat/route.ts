/**
 * GET/POST /api/projects/[id]/chat
 * --------------------------------------------------------------
 * conversations.json + 兼容 chat-history.jsonl。
 *
 * @author：wangjunhua
 */

import { z } from "zod";
import { ChatMessageSchema } from "@/lib/agents/chat-schema";
import {
  loadChatHistoryFromVad,
  loadConversationsFromVad,
  saveChatHistoryToVad,
  saveConversationsToVad,
} from "@/lib/vad/persist";
import { parseVadChatPayload } from "@/lib/chat/conversation-persist";

const ConversationSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    title: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    threadId: z.string(),
    messages: z.array(ChatMessageSchema),
    titleLocked: z.boolean().optional(),
  })
  .passthrough();

const PostSchema = z
  .object({
    messages: z.array(ChatMessageSchema).optional(),
    conversations: z.array(ConversationSchema).optional(),
    activeId: z.string().optional(),
  })
  .refine(
    (v) =>
      (v.conversations && v.conversations.length > 0) ||
      (v.messages && v.messages.length >= 0),
    { message: "messages_or_conversations_required" }
  );

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const table = await loadConversationsFromVad(id);
  const parsed = parseVadChatPayload(table ?? {});
  if (parsed.conversations && parsed.conversations.length > 0) {
    const active =
      parsed.conversations.find((c) => c.id === parsed.activeId) ??
      parsed.conversations[0];
    return Response.json({
      conversations: parsed.conversations,
      activeId: parsed.activeId ?? active?.id,
      messages: active?.messages ?? [],
    });
  }
  const messages = await loadChatHistoryFromVad(id);
  return Response.json({ messages });
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = PostSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }

  if (parsed.data.conversations && parsed.data.conversations.length > 0) {
    await saveConversationsToVad(id, {
      conversations: parsed.data.conversations,
      activeId: parsed.data.activeId,
    });
    const active =
      parsed.data.conversations.find((c) => c.id === parsed.data.activeId) ??
      parsed.data.conversations[0];
    await saveChatHistoryToVad(id, active?.messages ?? []);
    return Response.json({
      success: true,
      count: parsed.data.conversations.length,
    });
  }

  const messages = parsed.data.messages ?? [];
  await saveChatHistoryToVad(id, messages);
  return Response.json({ success: true, count: messages.length });
}

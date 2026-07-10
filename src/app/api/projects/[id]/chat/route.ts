/**
 * GET/POST /api/projects/[id]/chat
 * --------------------------------------------------------------
 * chat-history.jsonl 读写。
 *
 * @author：wangjunhua
 */

import { z } from "zod";
import { ChatMessageSchema } from "@/lib/agents/chat-schema";
import {
  loadChatHistoryFromVad,
  saveChatHistoryToVad,
} from "@/lib/vad/storage";

const PostSchema = z.object({
  messages: z.array(ChatMessageSchema),
});

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
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
  await saveChatHistoryToVad(id, parsed.data.messages);
  return Response.json({ success: true, count: parsed.data.messages.length });
}

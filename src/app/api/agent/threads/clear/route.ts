/**
 * POST /api/agent/threads/clear
 * 按 threadId 清理 LangGraph checkpoint（删会话时调用）
 */

import { z } from "zod";
import { clearThreadMemory } from "@/lib/agents/checkpoint";

const BodySchema = z.object({
  threadId: z.string().min(1).max(200),
});

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }
  clearThreadMemory(parsed.data.threadId);
  return Response.json({ ok: true });
}

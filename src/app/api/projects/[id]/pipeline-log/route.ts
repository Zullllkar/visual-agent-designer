/**
 * GET /api/projects/[id]/pipeline-log
 * --------------------------------------------------------------
 * 读取 .vad/projects/<id>/pipeline-log.jsonl 最近执行记录。
 *
 * @author：wangjunhua
 */

import { readPipelineLog } from "@/lib/vad/pipeline-log-persist";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const limit = 500;
  const entries = await readPipelineLog(id, limit);
  return Response.json({ projectId: id, entries, count: entries.length });
}

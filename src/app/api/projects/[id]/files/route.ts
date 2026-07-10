/**
 * GET /api/projects/[id]/files
 * --------------------------------------------------------------
 * 返回项目 .vad 目录文件树。
 *
 * @author：wangjunhua
 */

import { listProjectFileTree } from "@/lib/vad/storage";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const tree = await listProjectFileTree(id);
  return Response.json({ projectId: id, tree });
}

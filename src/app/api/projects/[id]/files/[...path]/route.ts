/**
 * GET/PUT /api/projects/[id]/files/[...path]
 * --------------------------------------------------------------
 * 读取 / 保存可编辑 artifact 文件。
 *
 * @author：wangjunhua
 */

import {
  applyFileEditToProjectViaStorage,
  readProjectFile,
} from "@/lib/vad/storage";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; path: string[] }> }
) {
  const { id, path: segments } = await ctx.params;
  const relPath = segments.join("/");
  try {
    const content = await readProjectFile(id, relPath);
    return Response.json({ path: relPath, content });
  } catch (e) {
    const msg = (e as Error).message;
    const status = msg === "invalid_path" ? 403 : 404;
    return Response.json({ error: msg }, { status });
  }
}

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string; path: string[] }> }
) {
  const { id, path: segments } = await ctx.params;
  const relPath = segments.join("/");
  let body: { content?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (typeof body.content !== "string") {
    return Response.json({ error: "missing_content" }, { status: 400 });
  }
  try {
    const sync = await applyFileEditToProjectViaStorage(
      id,
      relPath,
      body.content
    );
    return Response.json({
      success: true,
      path: relPath,
      project: sync.synced ? sync.project : undefined,
      syncWarning: sync.synced
        ? undefined
        : sync.reason === "parse_error"
          ? sync.message
          : undefined,
    });
  } catch (e) {
    const msg = (e as Error).message;
    const status =
      msg === "path_not_editable" || msg === "invalid_path" ? 403 : 500;
    return Response.json({ error: msg }, { status });
  }
}

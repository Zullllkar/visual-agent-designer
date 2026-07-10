/**
 * GET /api/projects/[id]
 * --------------------------------------------------------------
 * 从 .vad 读取单个项目（合并 canvas.json）。
 *
 * @author：wangjunhua
 */

import { NextResponse } from "next/server";
import { loadMergedProjectFromVad } from "@/lib/vad/storage";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    const project = await loadMergedProjectFromVad(id);
    if (!project) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ project });
  } catch (error) {
    console.error("[projects-id-api] GET error:", error);
    return NextResponse.json(
      { error: "Failed to load project" },
      { status: 500 }
    );
  }
}

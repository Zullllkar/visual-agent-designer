import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { isSafeProjectId } from "@/lib/studio/project-actions";
import { duplicateProjectFromVad } from "@/lib/vad/storage";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  if (!isSafeProjectId(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  try {
    const project = await duplicateProjectFromVad(id, nanoid(10));
    return NextResponse.json({ project });
  } catch (error) {
    const message = error instanceof Error ? error.message : "duplicate_failed";
    const status = message === "not_found" ? 404 : 500;
    console.error("[projects-duplicate] POST error:", error);
    return NextResponse.json({ error: message }, { status });
  }
}

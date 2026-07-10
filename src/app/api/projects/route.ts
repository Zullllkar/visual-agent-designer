import { NextResponse } from "next/server";
import type { ProjectFile } from "@/lib/project/schema";
import {
  listProjectsFromVad,
  saveProjectToVad,
} from "@/lib/vad/storage";
import { syncHandoffBundle } from "@/lib/vad/handoff-sync";

/**
 * GET: 扫描 .vad/projects
 * POST: 双写项目（含 assets 脱脂、canvas、pages、prompts）
 */
export async function GET() {
  try {
    const projects = await listProjectsFromVad();
    return NextResponse.json(projects);
  } catch (error) {
    console.error("[projects-api] GET error:", error);
    return NextResponse.json(
      { error: "Failed to read projects from disk" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const project = (await req.json()) as ProjectFile;
    if (!project?.id) {
      return NextResponse.json({ error: "Invalid project data" }, { status: 400 });
    }

    const updated = await saveProjectToVad(project);

    try {
      await syncHandoffBundle(updated);
    } catch (handoffErr) {
      console.warn("[projects-api] handoff sync failed:", handoffErr);
    }

    return NextResponse.json({ success: true, project: updated });
  } catch (error) {
    console.error("[projects-api] POST error:", error);
    return NextResponse.json(
      { error: "Failed to save project to disk" },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { VAD_ROOT } from "@/lib/vad/paths";
import { inspectWorkspaceFolder } from "@/lib/vad/inspect-workspace";
import { saveProjectToVad } from "@/lib/vad/storage";
import { listWorkspaceIndex } from "@/lib/vad/workspace-registry";
import { workspaceFolderName } from "@/lib/studio/workspace";

export async function GET() {
  try {
    return NextResponse.json({ workspaces: listWorkspaceIndex() });
  } catch (error) {
    console.error("[workspaces-api] GET error:", error);
    return NextResponse.json({ error: "Failed to list workspaces" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      path?: string;
      idea?: string;
      mkdirIfMissing?: boolean;
    };
    const path = body.path?.trim();
    if (!path) {
      return NextResponse.json({ error: "Missing workspace path" }, { status: 400 });
    }

    const inspected = await inspectWorkspaceFolder({
      path,
      vadRoot: VAD_ROOT,
      idea: body.idea || workspaceFolderName(path),
      mkdirIfMissing: body.mkdirIfMissing === true,
    });

    const saved = inspected.created
      ? await saveProjectToVad(inspected.project)
      : await saveProjectToVad({
          ...inspected.project,
          workspacePath: inspected.workspacePath,
        });

    return NextResponse.json({
      created: inspected.created,
      project: saved,
      workspacePath: inspected.workspacePath,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to open workspace";
    console.error("[workspaces-api] POST error:", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

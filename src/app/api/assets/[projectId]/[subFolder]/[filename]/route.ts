import { promises as fs } from "node:fs";
import { join } from "node:path";
import { VAD_PROJECTS_DIR } from "@/lib/vad/paths";

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "");
}

function contentTypeFor(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "image/png";
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; subFolder: string; filename: string }> }
) {
  try {
    const { projectId, subFolder, filename } = await params;
    if (subFolder !== "assets" && subFolder !== "references") {
      return new Response("Forbidden", { status: 403 });
    }

    const safeProjectId = safeSegment(projectId);
    const safeFilename = safeSegment(filename);
    if (!safeProjectId || !safeFilename) {
      return new Response("Not Found", { status: 404 });
    }

    const filePath = join(VAD_PROJECTS_DIR, safeProjectId, subFolder, safeFilename);
    const buffer = await fs.readFile(filePath);
    return new Response(buffer, {
      headers: {
        "Content-Type": contentTypeFor(safeFilename),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not Found", { status: 404 });
  }
}

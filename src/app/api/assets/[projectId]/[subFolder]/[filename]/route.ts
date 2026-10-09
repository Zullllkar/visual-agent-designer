import { promises as fs } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { projectDir } from "@/lib/vad/paths";

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

    const root = resolve(projectDir(safeProjectId));
    const filePath = resolve(join(root, subFolder, safeFilename));
    const rel = relative(root, filePath);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
      return new Response("Forbidden", { status: 403 });
    }
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

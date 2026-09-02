/**
 * File Upload API
 * --------------------------------------------------------------
 * 接收 multipart 文件上传（图片等），保存到 .vad/projects/<id>/assets/。
 * 支持 png/jpeg/webp/gif/svg。
 */

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import { resolve, join, extname } from "node:path";
import { projectDir } from "@/lib/vad/paths";
import { ensureDir } from "@/lib/vad/persist";
import { nanoid } from "nanoid";

const ALLOWED_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
};

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

export async function POST(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "missing projectId" }, { status: 400 });
  }

  const formData = await req.formData();
  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "no file uploaded" }, { status: 400 });
  }

  const mimeType = file.type;
  if (!ALLOWED_MIME[mimeType]) {
    return NextResponse.json(
      { error: `unsupported file type: ${mimeType}` },
      { status: 415 }
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `file too large: ${file.size} bytes (max ${MAX_FILE_SIZE})` },
      { status: 413 }
    );
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = ALLOWED_MIME[mimeType];
    const fileId = nanoid(12);
    const filename = `${fileId}${ext}`;
    const assetsDir = resolve(projectDir(projectId), "assets");
    await ensureDir(assetsDir);
    const fullPath = join(assetsDir, filename);
    await fs.writeFile(fullPath, buffer);

    const relPath = `assets/${filename}`;
    return NextResponse.json({
      id: fileId,
      filename,
      path: relPath,
      mimeType,
      size: buffer.length,
      url: `/api/projects/${projectId}/files/${relPath}`,
    });
  } catch (e) {
    return NextResponse.json(
      { error: `upload failed: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import { join } from "node:path";

const VAD_DIR = join(process.cwd(), ".vad", "projects");

/**
 * 静态读取本地物理磁盘存储的图片资源
 * 路由：/api/assets/[projectId]/[subFolder]/[filename]
 * 例如：/api/assets/p12345/assets/image1.png
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string[] }> }
) {
  try {
    const { slug } = await params;
    if (!slug || slug.length < 3) {
      return new Response("Not Found", { status: 404 });
    }

    const [projectId, subFolder, filename] = slug;
    
    // 安全校验：防止路径穿越攻击（只允许 assets 与 references 子目录，filename 限制为常规字符）
    if (subFolder !== "assets" && subFolder !== "references") {
      return new Response("Forbidden", { status: 403 });
    }

    const safeFilename = filename.replace(/[^a-zA-Z0-9.-]/g, "");
    const filePath = join(VAD_DIR, projectId, subFolder, safeFilename);

    const buffer = await fs.readFile(filePath);
    
    // 自适应设置 Content-Type Header
    const ext = safeFilename.split(".").pop()?.toLowerCase() ?? "png";
    const contentType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";

    return new Response(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable", // 本地高奢缓存
      },
    });
  } catch (error) {
    return new Response("Not Found", { status: 404 });
  }
}

/**
 * Image Proxy API
 * --------------------------------------------------------------
 * 代理外部图片请求，绕过浏览器 CORS 限制。
 * 仅允许白名单域名，防止 SSRF。
 */

import { NextRequest, NextResponse } from "next/server";

const ALLOWED_DOMAINS = [
  "replicate.delivery",
  "replicate.com",
  "pbxt.replicate.delivery",
  "oaidalleapiprodscus.blob.core.windows.net",
  "files.oaiusercontent.com",
  "api.siliconflow.cn",
  "generativelanguage.googleapis.com",
  "storage.googleapis.com",
  "cdn.openai.com",
];

function isAllowedDomain(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ALLOWED_DOMAINS.some(
      (d) => parsed.hostname === d || parsed.hostname.endsWith(`.${d}`)
    );
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "missing url parameter" }, { status: 400 });
  }

  if (!isAllowedDomain(url)) {
    return NextResponse.json({ error: "domain not allowed" }, { status: 403 });
  }

  try {
    const proxyUrl =
      process.env.HTTPS_PROXY ||
      process.env.https_proxy ||
      process.env.HTTP_PROXY ||
      process.env.http_proxy;

    const res = await fetch(url);

    if (!res.ok) {
      return NextResponse.json(
        { error: `upstream error: ${res.status}` },
        { status: res.status }
      );
    }

    const contentType = res.headers.get("content-type") ?? "image/png";
    const buffer = await res.arrayBuffer();

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: `proxy failed: ${(e as Error).message}` },
      { status: 502 }
    );
  }
}

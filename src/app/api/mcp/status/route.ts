/**
 * GET /api/mcp/status
 * --------------------------------------------------------------
 * 返回 MCP 服务路径，供 Cursor 手动配置。
 *
 * @author：wangjunhua
 */

import { NextResponse } from "next/server";
import { join } from "node:path";

export async function GET() {
  const nodePath = process.execPath;
  const cliPath = join(process.cwd(), "cli.js");

  return NextResponse.json({
    nodePath,
    cliPath,
    cursorHint:
      "在 Cursor Settings → MCP 中添加 stdio 服务，Command 为 nodePath，Args 为 cliPath + mcp",
  });
}

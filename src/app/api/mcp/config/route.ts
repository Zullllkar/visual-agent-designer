import { NextResponse } from "next/server";
import { join } from "node:path";

/**
 * GET /api/mcp/config
 * --------------------------------------------------------------
 * 返回本地 Node 路径与 cli.js 的绝对路径，
 * 供前端 Settings → MCP 面板生成 Cursor 接入说明。
 */
export async function GET() {
  try {
    const nodePath = process.execPath;
    const cliPath = join(process.cwd(), "cli.js");

    const cursorConfig = {
      name: "visual-agent-designer",
      type: "stdio",
      command: nodePath,
      args: [cliPath, "mcp"],
    };

    return NextResponse.json({
      nodePath,
      cliPath,
      cursorConfig,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to get MCP configurations", details: (error as Error).message },
      { status: 500 }
    );
  }
}

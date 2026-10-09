/**
 * screenshot_canvas 工具
 * --------------------------------------------------------------
 * 通过 WebSocket RPC 从浏览器截取画布图像，供 Agent 视觉检查。
 * 支持 full（全画布）、viewport（当前视口）、area（指定区域）三种模式。
 */

import type { AgentTool, ToolContext, ToolResult } from "./types";
import { connectionManager } from "@/lib/ws/connection-manager";

export const screenshotCanvasTool: AgentTool = {
  name: "screenshot_canvas",
  description:
    "截取当前画布的图像，用于视觉检查画布布局和素材效果。支持 full（全画布）、viewport（当前视口）、area（指定区域）模式。",
  riskLevel: "safe",
  timeoutMs: 20_000,
  parameters: {
    type: "object",
    properties: {
      mode: {
        type: "string",
        enum: ["full", "viewport", "area"],
        description: "截图模式：full=全画布, viewport=当前视口, area=指定区域",
      },
      pageId: {
        type: "string",
        description: "要截图的页面 ID（不指定则截当前页面）",
      },
      x: { type: "number", description: "area 模式：区域起点 x" },
      y: { type: "number", description: "area 模式：区域起点 y" },
      width: { type: "number", description: "area 模式：区域宽度" },
      height: { type: "number", description: "area 模式：区域高度" },
    },
  },

  async execute(
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    const projectId = ctx.project?.id ?? ctx.agentCtx.projectId;
    const mode = (args.mode as string) ?? "full";
    const pageId = args.pageId as string | undefined;

    const params: Record<string, unknown> = { mode };
    if (pageId) params.pageId = pageId;
    if (mode === "area") {
      if (typeof args.x === "number") params.x = args.x;
      if (typeof args.y === "number") params.y = args.y;
      if (typeof args.width === "number") params.width = args.width;
      if (typeof args.height === "number") params.height = args.height;
    }

    try {
      const result = await connectionManager.sendRpcTo(
        projectId,
        "canvas.screenshot",
        params,
        15_000,
      );

      const data = result as { dataUrl?: string; width?: number; height?: number };
      if (!data?.dataUrl) {
        return { summary: "截图失败：客户端未返回图像数据。" };
      }

      // 不把 dataUrl 写进工具结果——会进入 LangGraph checkpoint，极易撑爆上下文
      return {
        summary: `画布截图成功 (${mode} 模式, ${data.width ?? "?"}x${data.height ?? "?"})。图像已由客户端展示，未写入会话记忆。`,
        data: {
          captured: true,
          bytes: data.dataUrl.length,
          width: data.width,
          height: data.height,
          mode,
        },
      };
    } catch (e) {
      return {
        summary: `截图失败: ${(e as Error).message}`,
      };
    }
  },

  async fallback(
    _args: Record<string, unknown>,
    _ctx: ToolContext
  ): Promise<ToolResult> {
    return {
      summary: "截图工具在回退模式下不可用，需要活跃的 WebSocket 连接。",
    };
  },
};

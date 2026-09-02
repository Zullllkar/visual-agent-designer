/**
 * MCP 工具桥接器
 * --------------------------------------------------------------
 * 将 MCP 服务器上的工具转换为 Vibeboard AgentTool 接口，
 * 使主 Agent 能像调用内置工具一样调用 MCP 工具。
 */

import "server-only";

import type { AgentTool, ToolContext, ToolResult } from "@/lib/agents/tools/types";
import type { McpToolAdapter, McpToolMetadata } from "./mcp-types";
import { mcpRegistry } from "./mcp-registry";

/** 将 MCP 工具适配器转换为 Vibeboard AgentTool */
export function mcpToolToAgentTool(
  adapter: McpToolAdapter,
  metadata: McpToolMetadata
): AgentTool {
  return {
    name: `mcp_${metadata.serverId}_${metadata.name}`,
    description: `[MCP:${metadata.serverId}] ${metadata.description}`,
    parameters: metadata.parameters,
    riskLevel: metadata.riskLevel,
    inputPhase: metadata.inputPhase,
    outputPhase: metadata.outputPhase,
    timeoutMs: metadata.timeoutMs,

    async execute(
      args: Record<string, unknown>,
      _ctx: ToolContext
    ): Promise<ToolResult> {
      const result = await adapter.call(args);

      if (result.isError) {
        const errorText = result.content
          .filter((c) => c.type === "text")
          .map((c) => (c as { text: string }).text)
          .join("\n");
        throw new Error(`MCP 工具错误: ${errorText || "未知错误"}`);
      }

      // 提取文本内容作为摘要
      const textContent = result.content
        .filter((c) => c.type === "text")
        .map((c) => (c as { text: string }).text)
        .join("\n");

      // 提取图片内容
      const images = result.content
        .filter((c) => c.type === "image")
        .map((c) => {
          const img = c as { data: string; mimeType: string };
          return {
            id: `mcp_img_${Date.now()}`,
            src: `data:${img.mimeType};base64,${img.data}`,
          };
        });

      return {
        summary: textContent.slice(0, 200) || "MCP 工具执行完成",
        data: {
          content: result.content,
          images: images.length > 0 ? images : undefined,
        },
      };
    },

    async fallback(
      _args: Record<string, unknown>,
      _ctx: ToolContext
    ): Promise<ToolResult> {
      return {
        summary: `MCP 工具 ${metadata.name} 在回退模式下不可用`,
      };
    },
  };
}

/** 从注册表加载所有 MCP 工具并转换为 AgentTool */
export function loadMcpToolsAsAgentTools(): AgentTool[] {
  const tools: AgentTool[] = [];

  for (const { serverId, tool } of mcpRegistry.listAllTools()) {
    const adapter = mcpRegistry.getToolAdapter(serverId, tool.name);
    if (!adapter) continue;

    const metadata: McpToolMetadata = {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema as unknown as Record<string, unknown>,
      serverId,
      riskLevel: "moderate",
      timeoutMs: 30_000,
    };

    tools.push(mcpToolToAgentTool(adapter, metadata));
  }

  return tools;
}

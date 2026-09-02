/**
 * MCP 服务器注册表
 * --------------------------------------------------------------
 * 管理所有已配置的 MCP 服务器连接和工具。
 */

import "server-only";

import { promises as fs } from "node:fs";
import { join } from "node:path";
import type {
  McpServerConfig,
  McpServerInfo,
  McpToolDefinition,
  McpToolCallRequest,
  McpToolCallResult,
  McpToolAdapter,
  McpConfigFile,
} from "./mcp-types";

class McpRegistry {
  private servers = new Map<string, McpServerInfo>();
  private adapters = new Map<string, McpToolAdapter>();

  /** 注册 MCP 服务器配置 */
  registerServer(config: McpServerConfig): void {
    const info: McpServerInfo = {
      config,
      status: "disconnected",
      tools: [],
    };
    this.servers.set(config.id, info);
  }

  /** 获取服务器信息 */
  getServer(serverId: string): McpServerInfo | undefined {
    return this.servers.get(serverId);
  }

  /** 列出所有服务器 */
  listServers(): McpServerInfo[] {
    return Array.from(this.servers.values());
  }

  /** 注册工具适配器 */
  registerToolAdapter(serverId: string, adapter: McpToolAdapter): void {
    const key = `${serverId}:${adapter.definition.name}`;
    this.adapters.set(key, adapter);
  }

  /** 获取工具适配器 */
  getToolAdapter(serverId: string, toolName: string): McpToolAdapter | undefined {
    return this.adapters.get(`${serverId}:${toolName}`);
  }

  /** 列出所有已注册的工具 */
  listAllTools(): Array<{ serverId: string; tool: McpToolDefinition }> {
    const result: Array<{ serverId: string; tool: McpToolDefinition }> = [];
    for (const [key, adapter] of this.adapters) {
      const [serverId] = key.split(":");
      result.push({ serverId, tool: adapter.definition });
    }
    return result;
  }

  /** 调用 MCP 工具 */
  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<McpToolCallResult> {
    const adapter = this.getToolAdapter(serverId, toolName);
    if (!adapter) {
      return {
        content: [{ type: "text", text: `工具 ${toolName} 未在服务器 ${serverId} 上注册` }],
        isError: true,
      };
    }
    return adapter.call(args);
  }

  /** 从配置文件加载 */
  async loadConfig(configPath: string): Promise<void> {
    try {
      const raw = await fs.readFile(configPath, "utf8");
      const config = JSON.parse(raw) as McpConfigFile;
      for (const server of config.servers) {
        if (server.enabled) {
          this.registerServer(server);
        }
      }
    } catch {
      // 配置文件不存在或格式错误，忽略
    }
  }

  /** 清空所有注册 */
  clear(): void {
    this.servers.clear();
    this.adapters.clear();
  }
}

export const mcpRegistry = new McpRegistry();

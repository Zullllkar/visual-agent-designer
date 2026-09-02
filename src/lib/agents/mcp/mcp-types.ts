/**
 * MCP (Model Context Protocol) 兼容工具接口
 * --------------------------------------------------------------
 * 定义与 MCP 标准兼容的工具协议，使 Vibeboard 能接入外部 MCP 服务器。
 * MCP 工具通过统一的 JSON Schema 描述参数，返回结构化结果。
 */

import type { AgentPhase } from "@/lib/agents/agent-phase";
import type { RiskLevel } from "@/lib/agents/tools/types";

/** MCP 工具定义（对应 MCP 协议中的 Tool 定义） */
export interface McpToolDefinition {
  /** 工具名称（唯一标识） */
  name: string;
  /** 工具描述 */
  description: string;
  /** JSON Schema 参数定义 */
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/** MCP 工具调用请求 */
export interface McpToolCallRequest {
  name: string;
  arguments: Record<string, unknown>;
}

/** MCP 工具调用结果 */
export interface McpToolCallResult {
  content: McpContentBlock[];
  isError?: boolean;
}

/** MCP 内容块（文本、图片、资源引用） */
export type McpContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "resource"; resource: { uri: string; name?: string; description?: string } };

/** MCP 服务器配置 */
export interface McpServerConfig {
  /** 服务器唯一 ID */
  id: string;
  /** 服务器名称 */
  name: string;
  /** 传输方式 */
  transport: "stdio" | "sse" | "websocket";
  /** 连接地址（sse/websocket 模式） */
  url?: string;
  /** 启动命令（stdio 模式） */
  command?: string;
  /** 启动参数（stdio 模式） */
  args?: string[];
  /** 环境变量 */
  env?: Record<string, string>;
  /** 是否启用 */
  enabled: boolean;
}

/** MCP 服务器连接状态 */
export type McpConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

/** MCP 服务器实例信息 */
export interface McpServerInfo {
  config: McpServerConfig;
  status: McpConnectionStatus;
  tools: McpToolDefinition[];
  error?: string;
  connectedAt?: number;
}

/** Vibeboard 内部使用的 MCP 工具适配器接口 */
export interface McpToolAdapter {
  /** 原始 MCP 工具定义 */
  definition: McpToolDefinition;
  /** 调用 MCP 工具 */
  call(args: Record<string, unknown>): Promise<McpToolCallResult>;
}

/** 将 MCP 工具定义转换为 Vibeboard AgentTool 兼容的元数据 */
export interface McpToolMetadata {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** MCP 服务器 ID */
  serverId: string;
  /** 风险等级（MCP 工具默认 moderate） */
  riskLevel: RiskLevel;
  /** 允许的调用阶段（可选，默认不限） */
  inputPhase?: AgentPhase[];
  /** 执行后进入的阶段（可选） */
  outputPhase?: AgentPhase;
  /** 超时时间 */
  timeoutMs?: number;
}

/** MCP 配置文件结构（.vad/mcp-config.json） */
export interface McpConfigFile {
  servers: McpServerConfig[];
  /** 全局超时 */
  defaultTimeoutMs?: number;
  /** 全局并发限制 */
  maxConcurrentCalls?: number;
}

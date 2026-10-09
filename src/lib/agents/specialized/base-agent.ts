/**
 * 专业化 Agent 基类
 * --------------------------------------------------------------
 * 所有专业化 agents 的基类，提供通用功能：
 * - 工具执行（通过现有的 AgentRunService）
 * - 错误处理
 * - 日志记录
 *
 * 注意：LLM 调用通过 toolContext 委托给现有系统
 */

import type { ToolCall } from "../tool-dependency-graph";
import type { ToolContext, ToolResult } from "../tools/types";

/**
 * Agent 配置
 */
export interface SpecializedAgentConfig {
  /** Agent 名称 */
  name: string;
  /** Agent 专长描述 */
  expertise: string;
  /** 系统提示词 */
  systemPrompt: string;
  /** 使用的模型 */
  model?: string;
  /** 温度（创造性） */
  temperature?: number;
  /** 最大重试次数 */
  maxRetries?: number;
  /** 超时时间（毫秒） */
  timeout?: number;
}

/**
 * Agent 执行结果
 */
export interface AgentResult<T = any> {
  /** 成功标志 */
  success: boolean;
  /** 结果数据 */
  data?: T;
  /** 错误信息 */
  error?: string;
  /** 执行时长 */
  duration: number;
  /** 使用的 tokens */
  tokens?: {
    input: number;
    output: number;
  };
  /** Agent 的推理过程（可选） */
  reasoning?: string;
}

/**
 * 专业化 Agent 基类
 */
export abstract class SpecializedAgent<TInput = any, TOutput = any> {
  protected config: Required<SpecializedAgentConfig>;
  protected toolContext?: ToolContext;

  constructor(config: SpecializedAgentConfig) {
    this.config = {
      name: config.name,
      expertise: config.expertise,
      systemPrompt: config.systemPrompt,
      model: config.model ?? "claude-3-5-sonnet-20241022",
      temperature: config.temperature ?? 0.7,
      maxRetries: config.maxRetries ?? 3,
      timeout: config.timeout ?? 300000, // 5 分钟
    };
  }

  /**
   * 设置工具上下文（用于执行工具）
   */
  setToolContext(context: ToolContext): void {
    this.toolContext = context;
  }

  /**
   * 执行 Agent（子类必须实现）
   */
  abstract execute(input: TInput): Promise<AgentResult<TOutput>>;

  /**
   * 调用 LLM（委托给现有系统）
   *
   * 注意：这是一个占位符，实际实现需要集成到现有的 LLM 调用系统
   */
  protected async callLLM(options: {
    prompt: string;
    tools?: any[];
    responseFormat?: "text" | "json";
  }): Promise<{
    content: string;
    toolCalls?: ToolCall[];
    usage: { input: number; output: number };
  }> {
    // TODO: 集成到现有的 LLM 系统
    // 目前返回模拟数据用于测试
    this.log("warn", "callLLM 需要集成到现有系统");

    return {
      content: "Mock response",
      toolCalls: undefined,
      usage: { input: 100, output: 50 },
    };
  }

  /**
   * 执行工具（通过 toolContext）
   */
  protected async executeTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    if (!this.toolContext) {
      throw new Error(
        `[${this.config.name}] Tool context not set. Call setToolContext() first.`
      );
    }

    try {
      const toolRegistry = await import("../tools/registry");
    const result = await toolRegistry.toolRegistry.execute(
        toolName,
        args,
        this.toolContext
      );
      return result;
    } catch (error) {
      throw new Error(
        `[${this.config.name}] Tool execution failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * 执行多个工具（并行）
   */
  protected async executeToolsParallel(
    calls: Array<{ name: string; args: Record<string, unknown> }>
  ): Promise<ToolResult[]> {
    if (!this.toolContext) {
      throw new Error(
        `[${this.config.name}] Tool context not set. Call setToolContext() first.`
      );
    }

    const { executeToolsInParallel } = await import("../parallel-tool-executor");

    const toolCalls = calls.map((call, i) => ({
      id: `call-${i}`,
      name: call.name,
      args: call.args,
    })) as unknown as ToolCall[];

    const summary = await executeToolsInParallel(toolCalls, this.toolContext, {
      maxConcurrency: 5,
      toolTimeout: 300000,
      continueOnError: true,
    });

    return summary.results.map(r => {
      if (r.error) {
        throw new Error(`Tool ${r.call.name} failed: ${r.error.message}`);
      }
      return r.result!;
    });
  }

  /**
   * 解析 JSON 响应（安全）
   */
  protected parseJSON<T>(content: string): T {
    try {
      // 尝试提取 JSON 代码块
      const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1]);
      }

      // 直接解析
      return JSON.parse(content);
    } catch (error) {
      throw new Error(
        `[${this.config.name}] Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * 睡眠（用于重试）
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 记录日志
   */
  protected log(level: "info" | "warn" | "error", message: string, data?: any): void {
    const prefix = `[${this.config.name}]`;
    switch (level) {
      case "info":
        console.log(prefix, message, data ?? "");
        break;
      case "warn":
        console.warn(prefix, message, data ?? "");
        break;
      case "error":
        console.error(prefix, message, data ?? "");
        break;
    }
  }

  /**
   * 测量执行时间
   */
  protected async measureTime<T>(
    fn: () => Promise<T>
  ): Promise<{ result: T; duration: number }> {
    const startTime = Date.now();
    const result = await fn();
    const duration = Date.now() - startTime;
    return { result, duration };
  }

  /**
   * 创建成功结果
   */
  protected createSuccessResult<T>(
    data: T,
    duration: number,
    tokens?: { input: number; output: number },
    reasoning?: string
  ): AgentResult<T> {
    return {
      success: true,
      data,
      duration,
      tokens,
      reasoning,
    };
  }

  /**
   * 创建错误结果
   */
  protected createErrorResult(
    error: string | Error,
    duration: number
  ): AgentResult<never> {
    return {
      success: false,
      error: error instanceof Error ? error.message : error,
      duration,
    };
  }
}

/**
 * Agent 工厂（用于创建和管理 agents）
 */
export class AgentFactory {
  private agents = new Map<string, SpecializedAgent>();

  /**
   * 注册 Agent
   */
  register<T extends SpecializedAgent>(
    name: string,
    agent: T
  ): void {
    this.agents.set(name, agent);
  }

  /**
   * 获取 Agent
   */
  get<T extends SpecializedAgent>(name: string): T | undefined {
    return this.agents.get(name) as T | undefined;
  }

  /**
   * 设置所有 agents 的工具上下文
   */
  setToolContextForAll(context: ToolContext): void {
    for (const agent of this.agents.values()) {
      agent.setToolContext(context);
    }
  }

  /**
   * 列出所有已注册的 agents
   */
  list(): Array<{ name: string; expertise: string }> {
    return Array.from(this.agents.values()).map(agent => ({
      name: (agent as any).config.name,
      expertise: (agent as any).config.expertise,
    }));
  }
}

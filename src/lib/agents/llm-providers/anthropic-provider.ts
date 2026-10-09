/**
 * Anthropic LLM Provider
 * --------------------------------------------------------------
 * 实现 LLMProvider 接口，封装 Anthropic API
 */

import Anthropic from "@anthropic-ai/sdk";
import type { LLMProvider, AgentMessage, ToolCall } from "../lightweight-agent-loop";

export class AnthropicProvider implements LLMProvider {
  private client: any;
  private model: string;

  constructor(apiKey: string, model: string = "claude-3-5-sonnet-20241022") {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  /**
   * 生成带工具调用的响应（非流式）
   */
  async generateWithTools(options: {
    messages: AgentMessage[];
    tools: any[];
    temperature?: number;
  }): Promise<{
    content: string;
    toolCalls?: ToolCall[];
    stopReason: "end_turn" | "tool_use" | "max_tokens";
    usage: { inputTokens: number; outputTokens: number };
  }> {
    const anthropicMessages = this.convertToAnthropicMessages(options.messages);
    const systemPrompt = this.extractSystemPrompt(options.messages);

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      temperature: options.temperature,
      system: systemPrompt,
      messages: anthropicMessages,
      tools: options.tools.length > 0 ? options.tools : undefined,
    });

    // 提取文本内容
    const textContent = response.content
      .filter((block: any) => block.type === "text")
      .map((block: any) => (block as any).text)
      .join("\n");

    // 提取工具调用
    const toolUseBlocks = response.content.filter((block: any) => block.type === "tool_use");
    const toolCalls: ToolCall[] | undefined =
      toolUseBlocks.length > 0
        ? toolUseBlocks.map((block: any) => {
            const toolUse = block as any;
            return {
              id: toolUse.id,
              name: toolUse.name,
              args: toolUse.input,
            };
          })
        : undefined;

    return {
      content: textContent,
      toolCalls,
      stopReason: response.stop_reason === "tool_use" ? "tool_use" : response.stop_reason === "max_tokens" ? "max_tokens" : "end_turn",
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }

  /**
   * 流式生成
   */
  async *streamWithTools(options: {
    messages: AgentMessage[];
    tools: any[];
    temperature?: number;
  }): AsyncGenerator<{
    type: "token" | "tool_calls" | "done";
    token?: string;
    toolCalls?: ToolCall[];
    usage?: { inputTokens: number; outputTokens: number };
  }> {
    const anthropicMessages = this.convertToAnthropicMessages(options.messages);
    const systemPrompt = this.extractSystemPrompt(options.messages);

    const stream = await this.client.messages.stream({
      model: this.model,
      max_tokens: 4096,
      temperature: options.temperature,
      system: systemPrompt,
      messages: anthropicMessages,
      tools: options.tools.length > 0 ? options.tools : undefined,
    });

    const toolCalls: ToolCall[] = [];

    for await (const event of stream) {
      if (event.type === "content_block_delta") {
        const delta = event.delta;
        if (delta.type === "text_delta") {
          yield { type: "token", token: delta.text };
        } else if (delta.type === "input_json_delta") {
          // 工具调用的输入正在构建中（暂不处理增量）
        }
      } else if (event.type === "content_block_start") {
        const content = event.content_block;
        if (content.type === "tool_use") {
          // 工具调用开始
          toolCalls.push({
            id: content.id,
            name: content.name,
            args: {}, // 稍后通过 content_block_stop 填充完整输入
          });
        }
      } else if (event.type === "content_block_stop") {
        // 工具调用完成（需要从完整消息中提取）
      } else if (event.type === "message_stop") {
        // 流结束
        const finalMessage = await stream.finalMessage();

        // 提取完整的工具调用
        const toolUseBlocks = (finalMessage.content as any[]).filter(
          (block: any) => block.type === "tool_use"
        );
        const completedToolCalls: ToolCall[] = toolUseBlocks.map((block: any) => {
          const toolUse = block as any;
          return {
            id: toolUse.id,
            name: toolUse.name,
            args: toolUse.input,
          };
        });

        if (completedToolCalls.length > 0) {
          yield { type: "tool_calls", toolCalls: completedToolCalls };
        }

        yield {
          type: "done",
          usage: {
            inputTokens: finalMessage.usage.input_tokens,
            outputTokens: finalMessage.usage.output_tokens,
          },
        };
      }
    }
  }

  /**
   * 生成摘要
   */
  async summarize(options: {
    messages: AgentMessage[];
    instruction: string;
  }): Promise<string> {
    const conversationText = options.messages
      .map(msg => `${msg.role}: ${msg.content}`)
      .join("\n\n");

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      temperature: 0.3,
      messages: [
        {
          role: "user",
          content: `${options.instruction}\n\nConversation:\n${conversationText}`,
        },
      ],
    });

    const textContent = response.content
      .filter((block: any) => block.type === "text")
      .map((block: any) => (block as any).text)
      .join("\n");

    return textContent;
  }

  /**
   * 转换消息格式（AgentMessage → Anthropic Message）
   */
  private convertToAnthropicMessages(
    messages: AgentMessage[]
  ): any[] {
    return messages
      .filter(msg => msg.role !== "system") // 系统消息单独处理
      .map(msg => {
        if (msg.role === "assistant" && msg.toolCalls) {
          // Assistant 消息 + 工具调用
          return {
            role: "assistant" as const,
            content: [
              ...(msg.content
                ? [{ type: "text" as const, text: msg.content }]
                : []),
              ...msg.toolCalls.map(call => ({
                type: "tool_use" as const,
                id: call.id,
                name: call.name,
                input: call.args,
              })),
            ],
          };
        } else if (msg.role === "user" && msg.toolResults) {
          // User 消息 + 工具结果
          return {
            role: "user" as const,
            content: msg.toolResults.map(result => ({
              type: "tool_result" as const,
              tool_use_id: result.id,
              content: result.error
                ? `Error: ${result.error}`
                : JSON.stringify(result.result),
            })),
          };
        } else {
          // 普通文本消息
          return {
            role: msg.role as "user" | "assistant",
            content: msg.content,
          };
        }
      });
  }

  /**
   * 提取系统提示词
   */
  private extractSystemPrompt(messages: AgentMessage[]): string {
    return messages
      .filter(msg => msg.role === "system")
      .map(msg => msg.content)
      .join("\n\n");
  }
}



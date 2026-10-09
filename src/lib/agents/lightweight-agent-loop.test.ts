/**
 * 轻量级 Agent Loop 测试
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { LightweightAgentLoop, type AgentConfig, type LLMProvider, type AgentMessage } from "./lightweight-agent-loop";
import type { ToolContext } from "./tools/types";

/**
 * Mock LLM Provider
 */
class MockLLMProvider implements LLMProvider {
  private responses: Array<{
    content: string;
    toolCalls?: any[];
    stopReason: "end_turn" | "tool_use" | "max_tokens";
  }> = [];
  private currentResponseIndex = 0;

  constructor(responses: Array<{
    content: string;
    toolCalls?: any[];
    stopReason?: "end_turn" | "tool_use" | "max_tokens";
  }>) {
    this.responses = responses.map(r => ({
      ...r,
      stopReason: r.stopReason ?? "end_turn",
    }));
  }

  async generateWithTools(options: {
    messages: AgentMessage[];
    tools: any[];
    temperature?: number;
  }) {
    if (this.currentResponseIndex >= this.responses.length) {
      // 如果响应用完了，返回结束
      return {
        content: "Done",
        toolCalls: undefined,
        stopReason: "end_turn" as const,
        usage: { inputTokens: 100, outputTokens: 50 },
      };
    }

    const response = this.responses[this.currentResponseIndex];
    this.currentResponseIndex++;

    return {
      content: response?.content ?? "No response",
      toolCalls: response?.toolCalls,
      stopReason: response?.stopReason ?? "end_turn",
      usage: {
        inputTokens: 100,
        outputTokens: 50,
      },
    };
  }

  async *streamWithTools(options: {
    messages: AgentMessage[];
    tools: any[];
    temperature?: number;
  }) {
    if (this.currentResponseIndex >= this.responses.length) {
      // 如果响应用完了，返回结束
      yield { type: "token" as const, token: "Done" };
      yield {
        type: "done" as const,
        usage: { inputTokens: 100, outputTokens: 50 },
      };
      return;
    }

    const response = this.responses[this.currentResponseIndex];
    this.currentResponseIndex++;

    // 模拟流式输出
    const tokens = (response?.content ?? "").split(" ");
    for (const token of tokens) {
      yield { type: "token" as const, token: token + " " };
    }

    if (response?.toolCalls) {
      yield { type: "tool_calls" as const, toolCalls: response.toolCalls };
    }

    yield {
      type: "done" as const,
      usage: { inputTokens: 100, outputTokens: 50 },
    };
  }

  async summarize(options: { messages: AgentMessage[]; instruction: string }) {
    return "Summary of previous conversation: user asked about design, agent provided mockups.";
  }
}

describe("LightweightAgentLoop", () => {
  let config: AgentConfig;
  let toolContext: ToolContext;

  beforeEach(() => {
    config = {
      model: "claude-3-5-sonnet-20241022",
      systemPrompt: "You are a helpful design assistant.",
      maxIterations: 10,
      maxContextTokens: 100000,
      temperature: 0.7,
      parallelExecution: {
        enabled: true,
        maxConcurrency: 5,
      },
      contextCompression: {
        enabled: true,
        keepRecentMessages: 10,
        summaryModel: "claude-3-5-sonnet-20241022",
      },
    };

    toolContext = {
      project: null,
      userMessage: "",
      agentCtx: { projectId: "test-project", scratch: {}, providers: {} as any },
      projectId: "test-project",
      providers: {} as any,
      scratch: {},
    } as ToolContext;
  });

  describe("基本功能", () => {
    it("should run a simple conversation without tools", async () => {
      const llmProvider = new MockLLMProvider([
        { content: "Hello! How can I help you design today?" },
      ]);

      const agent = new LightweightAgentLoop(config, llmProvider, toolContext);
      const result = await agent.run("Help me design a landing page");

      expect(result.finalMessage).toBe("Hello! How can I help you design today?");
      expect(result.iterations).toBe(1);
      expect(result.stopReason).toBe("end_turn");
      expect(result.messages.length).toBeGreaterThan(0);
    });

    it("should handle tool calls", async () => {
      const llmProvider = new MockLLMProvider([
        {
          content: "Let me generate a brief for you.",
          toolCalls: [
            {
              id: "call-1",
              name: "generate_brief",
              args: { userInput: "landing page" },
            },
          ],
          stopReason: "tool_use",
        },
        {
          content: "I've generated the brief. Here's what we'll create...",
          stopReason: "end_turn",
        },
      ]);

      const agent = new LightweightAgentLoop(config, llmProvider, toolContext);
      const result = await agent.run("Help me design a landing page");

      expect(result.iterations).toBe(2);
      expect(result.toolStats.totalCalls).toBe(1);
      expect(result.messages.length).toBeGreaterThan(2);
    });

    it("should stop at max iterations", async () => {
      const llmProvider = new MockLLMProvider(
        Array.from({ length: 20 }, () => ({
          content: "Thinking...",
          toolCalls: [
            {
              id: "call-1",
              name: "inspect_canvas",
              args: {},
            },
          ],
          stopReason: "tool_use" as const,
        }))
      );

      const shortConfig = { ...config, maxIterations: 5 };
      const agent = new LightweightAgentLoop(shortConfig, llmProvider, toolContext);
      const result = await agent.run("Keep thinking");

      expect(result.iterations).toBe(5);
      expect(result.stopReason).toBe("max_iterations");
    });

    it("should track token usage", async () => {
      const llmProvider = new MockLLMProvider([
        { content: "Response 1" },
        { content: "Response 2" },
      ]);

      const agent = new LightweightAgentLoop(config, llmProvider, toolContext);
      await agent.run("Test");
      const result = await agent.run("Test again");

      expect(result.tokenStats.totalInput).toBeGreaterThan(0);
      expect(result.tokenStats.totalOutput).toBeGreaterThan(0);
    });
  });

  describe("流式输出", () => {
    it("should stream tokens", async () => {
      const llmProvider = new MockLLMProvider([
        { content: "Hello streaming world" },
      ]);

      const agent = new LightweightAgentLoop(config, llmProvider, toolContext);
      const events = [];

      for await (const event of agent.runStream("Test stream")) {
        events.push(event);
      }

      // 检查事件类型
      const tokenEvents = events.filter(e => e.type === "llm_token");
      const startEvent = events.find(e => e.type === "iteration_start");
      const endEvent = events.find(e => e.type === "agent_end");

      expect(tokenEvents.length).toBeGreaterThan(0);
      expect(startEvent).toBeDefined();
      expect(endEvent).toBeDefined();
      expect((endEvent as any).reason).toBe("end_turn");
    });

    it("should stream tool calls", async () => {
      const llmProvider = new MockLLMProvider([
        {
          content: "Calling tool",
          toolCalls: [
            {
              id: "call-1",
              name: "generate_brief",
              args: { userInput: "test" },
            },
          ],
          stopReason: "tool_use",
        },
        { content: "Done" },
      ]);

      const agent = new LightweightAgentLoop(config, llmProvider, toolContext);
      const events = [];

      for await (const event of agent.runStream("Test")) {
        events.push(event);
      }

      const toolStartEvent = events.find(e => e.type === "tool_start");
      const toolEndEvent = events.find(e => e.type === "tool_end");

      expect(toolStartEvent).toBeDefined();
      expect(toolEndEvent).toBeDefined();
    });
  });

  describe("上下文压缩", () => {
    it("should compress context when it exceeds limit", async () => {
      // 创建一个会生成大量消息的 provider
      const llmProvider = new MockLLMProvider(
        Array.from({ length: 15 }, (_, i) => ({
          content: "A".repeat(10000), // 大消息
          toolCalls: i < 14 ? [{ id: `call-${i}`, name: "inspect_canvas", args: {} }] : undefined,
          stopReason: i < 14 ? "tool_use" : "end_turn",
        }))
      );

      // 设置低上下文限制
      const lowLimitConfig = {
        ...config,
        maxContextTokens: 5000, // 很低的限制
        contextCompression: {
          enabled: true,
          keepRecentMessages: 3,
          summaryModel: config.model,
        },
      };

      const agent = new LightweightAgentLoop(lowLimitConfig, llmProvider, toolContext);
      const result = await agent.run("Test compression");

      // 应该成功完成（通过压缩）
      expect(result.iterations).toBeGreaterThan(0);
      expect(result.messages.length).toBeLessThan(20); // 压缩后消息数量减少
    });

    it("should preserve system prompt during compression", async () => {
      const llmProvider = new MockLLMProvider([
        { content: "Response" },
      ]);

      const agent = new LightweightAgentLoop(config, llmProvider, toolContext);

      // 触发压缩（通过访问私有方法，仅用于测试）
      const compressMethod = (agent as any).compressContext.bind(agent);

      // 添加大量消息
      for (let i = 0; i < 20; i++) {
        (agent as any).messages.push({
          role: "user",
          content: "Test message",
          timestamp: Date.now(),
        });
      }

      await compressMethod();

      const messages = (agent as any).messages;
      expect(messages[0].role).toBe("system");
      expect(messages[0].content).toBe(config.systemPrompt);
    });
  });

  describe("错误处理", () => {
    it("should handle tool execution errors gracefully", async () => {
      const llmProvider = new MockLLMProvider([
        {
          content: "Calling invalid tool",
          toolCalls: [
            {
              id: "call-1",
              name: "non_existent_tool",
              args: {},
            },
          ],
          stopReason: "tool_use",
        },
        { content: "Handled error" },
      ]);

      const agent = new LightweightAgentLoop(config, llmProvider, toolContext);
      const result = await agent.run("Test error handling");

      expect(result.iterations).toBe(2);
      expect(result.toolStats.errorCount).toBeGreaterThan(0);
      expect(result.stopReason).toBe("end_turn"); // 应该继续执行
    });

    it("should stop on fatal errors", async () => {
      const llmProvider = new MockLLMProvider([
        {
          content: "Calling tool that will fail fatally",
          toolCalls: [
            {
              id: "call-1",
              name: "fatal_tool",
              args: {},
            },
          ],
          stopReason: "tool_use",
        },
      ]);

      // Mock 一个会抛出 fatal error 的工具执行器
      vi.doMock("./tools/registry", () => ({
        toolRegistry: {
          execute: vi.fn().mockRejectedValue(new Error("fatal: critical failure")),
        },
      }));

      vi.resetModules();
      const { LightweightAgentLoop: DynamicLightweightAgentLoop } = await import("./lightweight-agent-loop");
      const agent = new DynamicLightweightAgentLoop(config, llmProvider, toolContext);
      const result = await agent.run("Test fatal error");

      expect(result.stopReason).toBe("error");
    });
  });

  describe("并行执行配置", () => {
    it("should use parallel execution when enabled", async () => {
      const llmProvider = new MockLLMProvider([
        {
          content: "Calling multiple tools",
          toolCalls: [
            { id: "call-1", name: "inspect_canvas", args: {} },
            { id: "call-2", name: "inspect_canvas", args: {} },
            { id: "call-3", name: "inspect_canvas", args: {} },
          ],
          stopReason: "tool_use",
        },
        { content: "Done" },
      ]);

      const parallelConfig = {
        ...config,
        parallelExecution: { enabled: true, maxConcurrency: 5 },
      };

      const agent = new LightweightAgentLoop(parallelConfig, llmProvider, toolContext);
      const result = await agent.run("Test parallel");

      expect(result.toolStats.totalCalls).toBe(3);
      // 并行执行应该更快（但在 mock 中无法测试实际时间）
    });

    it("should use sequential execution when disabled", async () => {
      const llmProvider = new MockLLMProvider([
        {
          content: "Calling multiple tools",
          toolCalls: [
            { id: "call-1", name: "inspect_canvas", args: {} },
            { id: "call-2", name: "inspect_canvas", args: {} },
          ],
          stopReason: "tool_use",
        },
        { content: "Done" },
      ]);

      const sequentialConfig = {
        ...config,
        parallelExecution: { enabled: false, maxConcurrency: 1 },
      };

      const agent = new LightweightAgentLoop(sequentialConfig, llmProvider, toolContext);
      const result = await agent.run("Test sequential");

      expect(result.toolStats.totalCalls).toBe(2);
    });
  });

  describe("统计信息", () => {
    it("should track tool execution statistics", async () => {
      const llmProvider = new MockLLMProvider([
        {
          content: "Calling tools",
          toolCalls: [
            { id: "call-1", name: "generate_brief", args: {} },
            { id: "call-2", name: "plan_design_direction", args: {} },
            { id: "call-3", name: "non_existent_tool", args: {} }, // 会失败
          ],
          stopReason: "tool_use",
        },
        { content: "Done" },
      ]);

      const agent = new LightweightAgentLoop(config, llmProvider, toolContext);
      const result = await agent.run("Test stats");

      expect(result.toolStats.totalCalls).toBe(3);
      expect(result.toolStats.successCount).toBeGreaterThanOrEqual(0);
      expect(result.toolStats.errorCount).toBeGreaterThan(0);
      expect(result.toolStats.successCount + result.toolStats.errorCount).toBe(3);
    });

    it("should calculate total duration", async () => {
      const llmProvider = new MockLLMProvider([
        { content: "Response" },
      ]);

      const agent = new LightweightAgentLoop(config, llmProvider, toolContext);
      const result = await agent.run("Test duration");

      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });
});

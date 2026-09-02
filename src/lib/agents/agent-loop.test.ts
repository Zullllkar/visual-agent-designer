import { describe, it, expect, beforeEach } from "vitest";
import { toolRegistry } from "@/lib/agents/tools/registry";
import { registerAllTools } from "@/lib/agents/tools";
import type { ToolContext } from "@/lib/agents/tools/types";
import type { AgentContext } from "@/lib/agents/types";

function makeMockAgentCtx(projectId = "test-agent-loop"): AgentContext {
  return {
    projectId,
    scratch: {},
    providers: {
      llm: {
        kind: "mock",
        generateText: async () => "这是一条 Mock LLM 回复。",
        generateTextStream: async function* () {
          yield "这是一条 Mock LLM 回复。";
        },
      } as never,
      image: {
        kind: "mock",
        generateImage: async () => ({
          imageUrl: "data:image/png;base64,mock",
          model: "mock",
        }),
      } as never,
      visionCritic: false,
    },
  };
}

describe("Agent Loop", () => {
  beforeEach(() => {
    registerAllTools();
  });

  it("should execute generate_brief tool and return a summary", async () => {
    const ctx: ToolContext = {
      project: null,
      userMessage: "做一个智能助手应用",
      agentCtx: makeMockAgentCtx(),
      providerConfig: {
        llm: { kind: "mock" },
        image: { kind: "mock" },
      },
    };

    const result = await toolRegistry.execute("generate_brief", {
      idea: "做一个智能助手应用",
    }, ctx);

    expect(result.summary).toBeTruthy();
  });

  it("should execute answer_question tool with mock LLM", async () => {
    const ctx: ToolContext = {
      project: null,
      userMessage: "什么是设计系统？",
      agentCtx: makeMockAgentCtx(),
      providerConfig: {
        llm: { kind: "mock" },
        image: { kind: "mock" },
      },
    };

    const result = await toolRegistry.execute("answer_question", {
      question: "什么是设计系统？",
    }, ctx);

    expect(result).toBeDefined();
    expect(result.summary).toBeTruthy();
  });

  it("should handle inspect_canvas with no project gracefully", async () => {
    const ctx: ToolContext = {
      project: null,
      userMessage: "test",
      agentCtx: makeMockAgentCtx("test-fallback"),
      providerConfig: {},
    };

    const result = await toolRegistry.execute("inspect_canvas", {}, ctx);
    expect(result).toBeDefined();
    expect(result.summary).toContain("没有打开的项目");
  });

  it("should list all registered tools with definitions", () => {
    const defs = toolRegistry.toToolDefinitions();
    expect(defs.length).toBeGreaterThanOrEqual(12);

    const names = defs.map((d) => d.name);
    expect(names).toContain("delegate_task");
    expect(names).toContain("star_asset");
    expect(names).toContain("batch_delete_assets");
    expect(names).toContain("manipulate_canvas");
  });
});

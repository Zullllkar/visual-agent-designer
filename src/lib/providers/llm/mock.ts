import type { LlmProvider } from "./types";

/**
 * MockLlmProvider
 * --------------------------------------------------------------
 * 第一阶段使用的本地占位实现。不调用真实模型；
 * 根据 prompt 规则化产出可被 JSON.parse 的输出，
 * 用于跑通 Agent 工作流。
 *
 * 真正的 OpenAI / Claude / Gemini Provider 在 P1 阶段加入。
 */
export const MockLlmProvider: LlmProvider = {
  name: "mock-llm",
  async *generateTextStream({ prompt }) {
    const text = `（模拟）正在分析：${prompt.slice(0, 60)}…`;
    for (let i = 0; i < text.length; i += 8) {
      yield text.slice(i, i + 8);
      await new Promise((r) => setTimeout(r, 40));
    }
  },
  async generateText({ prompt }) {
    // 模拟微小延迟，让 UI 上能看到"正在生成"。
    await new Promise((r) => setTimeout(r, 200));
    return {
      text: `MOCK_LLM_OUTPUT::${prompt.slice(0, 40)}`,
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  },
};

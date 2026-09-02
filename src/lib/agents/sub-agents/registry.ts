/**
 * Sub-Agent 注册表
 * --------------------------------------------------------------
 * 管理所有 Sub-Agent 的注册和路由。
 */

import type { SubAgent, SubAgentInput, SubAgentOutput } from "./types";

class SubAgentRegistry {
  private agents = new Map<string, SubAgent>();

  register(agent: SubAgent): void {
    if (this.agents.has(agent.name)) {
      console.warn(`[SubAgentRegistry] Sub-Agent "${agent.name}" 已存在，将被覆盖`);
    }
    this.agents.set(agent.name, agent);
  }

  get(name: string): SubAgent | undefined {
    return this.agents.get(name);
  }

  list(): SubAgent[] {
    return [...this.agents.values()];
  }

  /**
   * 根据任务描述自动路由到最合适的 Sub-Agent。
   * 匹配关键词，返回最佳匹配。
   */
  route(task: string): SubAgent | null {
    const lower = task.toLowerCase();
    let best: SubAgent | null = null;
    let bestScore = 0;

    for (const agent of this.agents.values()) {
      let score = 0;
      for (const kw of agent.keywords) {
        if (lower.includes(kw.toLowerCase())) {
          score += kw.length;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        best = agent;
      }
    }

    return best;
  }

  async run(name: string, input: SubAgentInput): Promise<SubAgentOutput> {
    const agent = this.agents.get(name);
    if (!agent) throw new Error(`未知 Sub-Agent: ${name}`);
    return agent.run(input);
  }
}

export const subAgentRegistry = new SubAgentRegistry();

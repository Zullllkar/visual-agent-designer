/**
 * Agent Hooks 生命周期
 * --------------------------------------------------------------
 * 提供 beforeTool/afterTool/beforeRun/afterRun 钩子，
 * 允许插件在 Agent 执行的关键节点插入逻辑。
 */

import "server-only";

import type { AgentPhase } from "@/lib/agents/agent-phase";
import type { ProjectFile } from "@/lib/project/schema";
import type { ToolContext } from "@/lib/agents/tools/types";

/** 钩子上下文 */
export interface HookContext {
  runId: string;
  threadId: string;
  projectId: string;
  phase: AgentPhase;
  project: ProjectFile | null;
}

/** beforeRun 钩子参数 */
export interface BeforeRunHookArgs extends HookContext {
  prompt: string;
}

/** afterRun 钩子参数 */
export interface AfterRunHookArgs extends HookContext {
  status: "completed" | "waiting_user" | "failed" | "cancelled" | "interrupted";
  durationMs: number;
  error?: string;
}

/** beforeTool 钩子参数 */
export interface BeforeToolHookArgs extends HookContext {
  toolName: string;
  toolArgs: Record<string, unknown>;
}

/** afterTool 钩子参数 */
export interface AfterToolHookArgs extends HookContext {
  toolName: string;
  toolArgs: Record<string, unknown>;
  result?: { summary: string; data?: unknown };
  error?: string;
  durationMs: number;
}

/** 钩子函数类型 */
export type HookFn<TArgs> = (args: TArgs) => void | Promise<void>;

/** 钩子注册 */
export interface HookRegistration {
  beforeRun?: HookFn<BeforeRunHookArgs>;
  afterRun?: HookFn<AfterRunHookArgs>;
  beforeTool?: HookFn<BeforeToolHookArgs>;
  afterTool?: HookFn<AfterToolHookArgs>;
}

class HookManager {
  private registrations: HookRegistration[] = [];

  /** 注册钩子 */
  register(hooks: HookRegistration): () => void {
    this.registrations.push(hooks);
    return () => {
      this.registrations = this.registrations.filter((r) => r !== hooks);
    };
  }

  /** 触发 beforeRun */
  async beforeRun(args: BeforeRunHookArgs): Promise<void> {
    for (const reg of this.registrations) {
      if (reg.beforeRun) {
        try {
          await reg.beforeRun(args);
        } catch (e) {
          console.error("[Hooks] beforeRun error:", e);
        }
      }
    }
  }

  /** 触发 afterRun */
  async afterRun(args: AfterRunHookArgs): Promise<void> {
    for (const reg of this.registrations) {
      if (reg.afterRun) {
        try {
          await reg.afterRun(args);
        } catch (e) {
          console.error("[Hooks] afterRun error:", e);
        }
      }
    }
  }

  /** 触发 beforeTool */
  async beforeTool(args: BeforeToolHookArgs): Promise<void> {
    for (const reg of this.registrations) {
      if (reg.beforeTool) {
        try {
          await reg.beforeTool(args);
        } catch (e) {
          console.error("[Hooks] beforeTool error:", e);
        }
      }
    }
  }

  /** 触发 afterTool */
  async afterTool(args: AfterToolHookArgs): Promise<void> {
    for (const reg of this.registrations) {
      if (reg.afterTool) {
        try {
          await reg.afterTool(args);
        } catch (e) {
          console.error("[Hooks] afterTool error:", e);
        }
      }
    }
  }

  /** 清空所有注册 */
  clear(): void {
    this.registrations = [];
  }
}

export const hookManager = new HookManager();

/**
 * Active Context
 * --------------------------------------------------------------
 * 记录用户此刻在 Vibeboard 里打开的项目。coding agent 调用工具时
 * 省略 project 参数即回退到这里，避免"你要哪个项目"的往返。
 *
 * 信号来源：WebSocket 订阅 / 命令 / pong 心跳（见 ws/handler.ts）。
 * 超过 ACTIVE_CONTEXT_TTL_MS 无任何信号即视为不活跃。
 */

export const ACTIVE_CONTEXT_TTL_MS = 5 * 60_000;

export interface ActiveContextSnapshot {
  active: boolean;
  projectId?: string;
  lastInteractionAt?: number;
  ageMs?: number;
  hint?: string;
}

class ActiveContextTracker {
  private projectId: string | undefined;
  private lastInteractionAt = 0;

  touch(projectId: string | null | undefined, at: number = Date.now()): void {
    if (!projectId) return;
    this.projectId = projectId;
    this.lastInteractionAt = at;
  }

  clear(projectId?: string): void {
    if (projectId && this.projectId !== projectId) return;
    this.projectId = undefined;
    this.lastInteractionAt = 0;
  }

  snapshot(now: number = Date.now(), ttlMs: number = ACTIVE_CONTEXT_TTL_MS): ActiveContextSnapshot {
    if (!this.projectId || this.lastInteractionAt === 0) {
      return {
        active: false,
        hint: "No project is open in Vibeboard. Ask the user to open a project, or pass an explicit project id.",
      };
    }
    const ageMs = now - this.lastInteractionAt;
    if (ageMs > ttlMs) {
      return {
        active: false,
        projectId: this.projectId,
        lastInteractionAt: this.lastInteractionAt,
        ageMs,
        hint: `The last Vibeboard interaction was ${Math.round(ageMs / 60_000)} min ago (expired). Pass project explicitly or ask the user to interact with Vibeboard.`,
      };
    }
    return {
      active: true,
      projectId: this.projectId,
      lastInteractionAt: this.lastInteractionAt,
      ageMs,
    };
  }
}

export const activeContext = new ActiveContextTracker();

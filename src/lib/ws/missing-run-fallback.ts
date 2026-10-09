import {
  IMAGE_CONFIRM_MARKER,
  parseImageGenerationConfirmation,
} from "@/lib/agents/image-generation-confirmation";
import { formatImageConfirmMarker } from "@/lib/agents/image-prompts";
import {
  isImageApprovalTool,
  isResumableImageApprovalRun,
} from "@/lib/agents/tool-confirmation-pause";
import type { WsCommand } from "./types";

type WaitingRun = {
  runId: string;
  projectId: string;
  status: string;
  threadId?: string;
  pendingToolApproval?: {
    approvalId?: string;
    status?: string;
    toolName?: string;
  } | null;
};

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function promptFromToolArgs(args: Record<string, unknown> | undefined): {
  prompt: string;
  prompts?: string[];
  count: number;
} | null {
  if (!args) return null;
  const prompts = stringList(args.prompts);
  const prompt = (typeof args.prompt === "string" && args.prompt.trim()) || prompts[0] || "";
  if (!prompt) return null;
  const count = prompts.length > 1 ? prompts.length : 1;
  return {
    prompt,
    prompts: prompts.length > 0 ? prompts : undefined,
    count,
  };
}

/** 卡片上的 runId 对不上时，找回项目里仍在等确认的 run。 */
export function matchWaitingApproval<T extends WaitingRun>(
  runs: T[],
  input: { projectId: string; approvalId?: string | null },
): T | undefined {
  const pending = runs.filter(
    (run) => run.projectId === input.projectId && isResumableImageApprovalRun(run),
  );
  const ranked = [...pending].sort((a, b) => {
    if (a.status === "waiting_user" && b.status !== "waiting_user") return -1;
    if (b.status === "waiting_user" && a.status !== "waiting_user") return 1;
    return 0;
  });
  if (input.approvalId) {
    const exact = ranked.find((run) => run.pendingToolApproval?.approvalId === input.approvalId);
    if (exact) return exact;
  }
  return (
    ranked.find((run) => isImageApprovalTool(run.pendingToolApproval?.toolName)) ??
    ranked[0]
  );
}

/** 把审批命令绑到实际还活着的 run，避免卡片 runId / approvalId 过期。 */
export function bindCommandToWaitingRun(cmd: WsCommand, run: WaitingRun): WsCommand {
  return {
    ...cmd,
    runId: run.runId,
    approvalId: run.pendingToolApproval?.approvalId ?? cmd.approvalId,
    threadId: run.threadId ?? cmd.threadId,
  };
}

export function isImageGenerationConfirmedPrompt(prompt?: string | null): boolean {
  return typeof prompt === "string" && prompt.includes(IMAGE_CONFIRM_MARKER);
}

/** 生图确认卡点生成时，接着原来的等待 run，而不是再开一轮撞 RUN_IN_PROGRESS。 */
export function resumeBlockedImageApproval(
  cmd: WsCommand,
  run: WaitingRun,
): WsCommand | null {
  const toolName = run.pendingToolApproval?.toolName;
  if (
    toolName !== "generate_images" &&
    toolName !== "generate_image_variants"
  ) {
    return null;
  }
  if (run.pendingToolApproval?.status !== "pending") return null;
  if (cmd.action === "agent.approve") {
    return resumeWaitingImageApproval(cmd, run);
  }
  if (cmd.action !== "agent.run") return null;
  if (isImageGenerationConfirmedPrompt(cmd.prompt)) {
    return resumeWaitingImageApproval(cmd, run);
  }
  if (
    typeof cmd.count === "number" ||
    (Array.isArray(cmd.prompts) && cmd.prompts.length > 0)
  ) {
    return resumeWaitingImageApproval(cmd, run);
  }
  return null;
}

/** 无 runId 的确认卡（agent.approve）点生成时，接着原来的等待 run，而不是再开一轮。 */
export function resumeWaitingImageApproval(cmd: WsCommand, run: WaitingRun): WsCommand | null {
  if (!cmd.projectId || run.projectId !== cmd.projectId) return null;
  if (!run.pendingToolApproval?.approvalId) return null;
  const marker =
    typeof cmd.prompt === "string"
      ? parseImageGenerationConfirmation(cmd.prompt)
      : { confirmed: false };
  const fromArgs = promptFromToolArgs(cmd.toolArgs);
  const rawPrompt =
    typeof cmd.prompt === "string" &&
    cmd.prompt.trim() &&
    !isImageGenerationConfirmedPrompt(cmd.prompt)
      ? cmd.prompt.trim()
      : "";
  const prompt = rawPrompt || marker.prompt || fromArgs?.prompt || "";
  const prompts =
    (Array.isArray(cmd.prompts)
      ? cmd.prompts.map((item) => String(item).trim()).filter(Boolean)
      : undefined) ||
    marker.prompts ||
    fromArgs?.prompts;
  const count = cmd.count ?? marker.count ?? fromArgs?.count ?? 1;
  return bindCommandToWaitingRun(
    {
      ...cmd,
      action: "tool.approve",
      toolArgs: {
        confirmed: true,
        ...(prompt ? { prompt } : {}),
        ...(prompts && prompts.length > 0 ? { prompts } : {}),
        count,
      },
    },
    run,
  );
}

/** 审批 run 已丢失时，把 tool.approve 改写成已确认的 agent.run，避免卡死。 */
export function rewriteMissingToolApproval(cmd: WsCommand): WsCommand | null {
  if (cmd.action !== "tool.approve" || !cmd.projectId) return null;
  const parsed = promptFromToolArgs(cmd.toolArgs);
  if (!parsed) return null;
  return {
    ...cmd,
    action: "agent.run",
    prompt: formatImageConfirmMarker(parsed),
    prompts: parsed.prompts,
    count: parsed.count,
    runId: undefined,
    approvalId: undefined,
    toolArgs: undefined,
  };
}

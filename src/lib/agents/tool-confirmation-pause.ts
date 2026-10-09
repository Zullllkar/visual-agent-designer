import { interrupt } from "@langchain/langgraph";
import { isToolGrantedForProject } from "./tool-approval-policy";

export type ToolApprovalDecision = {
  action?: "approve" | "cancel";
  approvalId?: string;
  args?: Record<string, unknown>;
};

export type ToolApprovalPayload = {
  approvalId: string;
  title: string;
  toolName: string;
  toolCallId?: string;
  riskLevel: string;
  args: Record<string, unknown>;
  reason: string;
  model?: string;
  estimatedSeconds?: number;
  affectedAssets?: string[];
  pausedByInterrupt?: boolean;
};

const IMAGE_TOOLS = new Set(["generate_images", "generate_image_variants"]);

export function isImageApprovalTool(toolName: string | undefined): boolean {
  return Boolean(toolName && IMAGE_TOOLS.has(toolName));
}

export function shouldPauseToolForConfirmation(input: {
  toolName: string;
  requiresConfirmation?: boolean;
  args: Record<string, unknown>;
  userMessageConfirmed?: boolean;
  trustedResume?: boolean;
  projectId?: string;
  confirmationPolicy?: "auto" | "session" | "always" | "external";
  projectGranted?: boolean;
}): boolean {
  if (input.trustedResume) return false;
  if (input.userMessageConfirmed && isImageApprovalTool(input.toolName)) {
    return false;
  }
  if (input.toolName === "file_system") {
    return input.args.action === "write";
  }
  if (
    input.confirmationPolicy === "auto" ||
    (input.confirmationPolicy === "session" &&
      (input.projectGranted || isToolGrantedForProject(input.projectId, input.toolName)))
  ) {
    return false;
  }
  return Boolean(input.requiresConfirmation);
}

export function awaitUserToolApproval(
  payload: ToolApprovalPayload,
): ToolApprovalDecision {
  return interrupt<ToolApprovalPayload, ToolApprovalDecision>({
    ...payload,
    pausedByInterrupt: true,
  });
}

export function applyApprovalDecision(
  payload: ToolApprovalPayload,
  decision: ToolApprovalDecision,
): { cancelled: boolean; args: Record<string, unknown> } {
  if (decision?.action === "cancel") {
    return { cancelled: true, args: payload.args };
  }
  if (decision?.approvalId && decision.approvalId !== payload.approvalId) {
    return { cancelled: true, args: payload.args };
  }
  return {
    cancelled: false,
    args: {
      ...payload.args,
      ...(decision?.args ?? {}),
      confirmed: true,
      approvalId: payload.approvalId,
    },
  };
}

export const TRUSTED_TOOL_RESUME_SCRATCH = "__trustedToolResume";

export type TrustedToolResume = {
  approvalId: string;
  toolName: string;
  args?: Record<string, unknown>;
};

export function readTrustedToolResume(
  scratch: Record<string, unknown> | undefined,
): TrustedToolResume | null {
  const value = scratch?.[TRUSTED_TOOL_RESUME_SCRATCH];
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.approvalId !== "string" || typeof record.toolName !== "string") {
    return null;
  }
  return {
    approvalId: record.approvalId,
    toolName: record.toolName,
    args: isRecord(record.args) ? record.args : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function shouldResumeGraphInterrupt(pending: {
  toolName?: string;
  checkpointInterruptId?: string;
  pausedByInterrupt?: boolean;
  args?: Record<string, unknown>;
}): boolean {
  if (isImageApprovalTool(pending.toolName)) return false;
  if (pending.pausedByInterrupt) return true;
  if (typeof pending.checkpointInterruptId === "string" && pending.checkpointInterruptId) {
    return true;
  }
  return pending.args?.pausedByInterrupt === true;
}

export function isReinterruptOfApprovedImageTool(input: {
  toolName?: string;
  eventType?: string;
}): boolean {
  return (
    isImageApprovalTool(input.toolName) &&
    (input.eventType === "tool.confirm" || input.eventType === "image_generation.confirm")
  );
}

export function subAgentRunThreadId(
  parentThreadId: string | undefined,
  projectId: string,
  subRunId: string,
): string {
  const parent = parentThreadId?.trim() || projectId;
  return `${parent}:sub:${subRunId}`;
}

export function isResumableImageApprovalRun(run: {
  status: string;
  pendingToolApproval?: { status?: string; toolName?: string } | null;
}): boolean {
  if (run.pendingToolApproval?.status !== "pending") return false;
  if (run.status === "waiting_user") return true;
  if (run.status !== "running" && run.status !== "accepted") return false;
  return isImageApprovalTool(run.pendingToolApproval.toolName);
}

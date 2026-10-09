import { expandDistinctPrompts, uniquePrompts } from "@/lib/agents/distinct-image-prompts";
import {
  buildImageGenerationConfirmation,
  parseImageGenerationConfirmation,
} from "@/lib/agents/image-generation-confirmation";
import { normalizeImagePrompts } from "@/lib/agents/image-prompts";
import type { ToolContext } from "@/lib/agents/tools/types";
import { clampInt, parseRequestedImageCount } from "@/lib/agents/tools/utils";

export interface GenerateImagesApprovalPlan {
  confirmed: boolean;
  preview: {
    title: string;
    prompt: string;
    prompts: string[];
    reason: string;
    count: number;
    width: number;
    height: number;
    role?: string;
  };
  approvedArgs: Record<string, unknown>;
}

export function imageToolApprovalId(
  runId: string | undefined,
  toolName: string
): string {
  return `${runId ?? "run"}:${toolName}`;
}

export function toolResultNeedsUserConfirmation(data: unknown): boolean {
  return Boolean(
    data &&
      typeof data === "object" &&
      (data as { confirmationRequired?: unknown }).confirmationRequired === true
  );
}

export function prepareGenerateImagesApproval(
  args: Record<string, unknown>,
  ctx: ToolContext,
): GenerateImagesApprovalPlan | null {
  if (!ctx.project) return null;

  const confirmation = parseImageGenerationConfirmation(ctx.userMessage ?? "");
  const userApproved = isUserImageApproval(args, confirmation.confirmed);
  const fromArgs = normalizeImagePrompts({
    prompt: args.prompt,
    prompts: args.prompts ?? confirmation.prompts,
    variants: args.variants,
    count: args.count,
    n: args.n,
  });

  const userCount = confirmation.count ?? parseRequestedImageCount(ctx.userMessage ?? "");
  const seedPrompts = uniquePrompts(
    (confirmation.prompts && confirmation.prompts.length > 0
      ? confirmation.prompts
      : fromArgs.prompts
    ).filter((p) => p && !looksLikeInternalPromptLeak(p)),
  );
  const requestedCount = clampInt(
    seedPrompts.length >= 2
      ? seedPrompts.length
      : (userCount ?? (userApproved ? Number(args.count ?? args.n ?? 1) : 1)),
    1,
    8,
  );
  const confirmedPrompt =
    confirmation.prompt && !looksLikeInternalPromptLeak(confirmation.prompt)
      ? confirmation.prompt
      : undefined;
  const explicitPrompt =
    typeof args.prompt === "string" &&
    args.prompt.trim() &&
    !looksLikeInternalPromptLeak(args.prompt)
      ? args.prompt.trim()
      : confirmedPrompt;

  const prompts = expandDistinctPrompts({
    basePrompt: explicitPrompt || seedPrompts[0] || "",
    requestedCount,
    existing: seedPrompts,
    kind: "generate",
  });

  const preview = buildImageGenerationConfirmation({
    project: ctx.project,
    userMessage: sanitizeUserMessageForImagePrompt(ctx.userMessage ?? ""),
    explicitPrompt: prompts[0] || explicitPrompt,
    explicitPrompts: prompts.length > 0 ? prompts : undefined,
    count: Math.max(1, prompts.length),
    skillSize: ctx.agentCtx.skill?.manifest.output.defaultPageSize,
  });

  return {
    confirmed: userApproved,
    preview: {
      ...preview,
      prompts: prompts.length > 0 ? prompts : (preview.prompts ?? []),
      count: Math.max(1, prompts.length),
    },
    approvedArgs: {
      ...args,
      confirmed: true,
      count: Math.max(1, prompts.length),
      n: undefined,
      prompt: prompts[0] ?? preview.prompt,
      prompts,
      width: preview.width,
      height: preview.height,
      role: preview.role,
      mode: typeof args.mode === "string" ? args.mode : "async",
    },
  };
}

export function normalizeGenerateImagesApprovalArgs(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Record<string, unknown> {
  return prepareGenerateImagesApproval(args, ctx)?.approvedArgs ?? args;
}

function isUserImageApproval(
  args: Record<string, unknown>,
  confirmationConfirmed: boolean,
): boolean {
  if (confirmationConfirmed) return true;
  return typeof args.approvalId === "string" && args.approvalId.trim().length > 0;
}

function looksLikeInternalPromptLeak(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  return [
    "never show a prompt preview",
    "normal assistant text",
    "use generate_images",
    "render an execution approval card",
    "run/cancel/edit controls",
    "visual asset generation rule",
    "tool approval card",
    "[image_generation_confirmed]",
  ].some((marker) => normalized.includes(marker));
}

function sanitizeUserMessageForImagePrompt(message: string): string {
  return message.replace(/\[IMAGE_GENERATION_CONFIRMED\][\s\S]*$/i, "").trim();
}

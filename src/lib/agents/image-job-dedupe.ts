/**
 * 同一确认卡只允许一个进行中的生图 Job。
 * payload 把宽高放在 request 里时，根字段默认 1280×720 会对不上封面尺寸。
 */

export function imageJobSignature(input: {
  prompt: string;
  prompts?: string[];
  count: number;
  width: number;
  height: number;
  role?: string;
}): string {
  const prompts = (input.prompts?.length ? input.prompts : [input.prompt]).map((item) =>
    item.replace(/\s+/g, " ").trim()
  );
  return JSON.stringify({
    prompts,
    count: input.count,
    width: input.width,
    height: input.height,
    role: input.role ?? "",
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function readImageJobRequest(payload: Record<string, unknown> | undefined): {
  approvalId?: string;
  prompt: string;
  prompts: string[];
  count: number;
  width: number;
  height: number;
  role?: string;
} {
  const request = isRecord(payload?.request) ? payload.request : {};
  const approvalId =
    typeof payload?.approvalId === "string"
      ? payload.approvalId
      : typeof request.approvalId === "string"
        ? request.approvalId
        : undefined;
  const prompt =
    typeof payload?.prompt === "string"
      ? payload.prompt
      : typeof request.prompt === "string"
        ? request.prompt
        : "";
  const rawPrompts = Array.isArray(payload?.prompts)
    ? payload.prompts
    : Array.isArray(request.prompts)
      ? request.prompts
      : [];
  const prompts = rawPrompts.filter((item): item is string => typeof item === "string");
  return {
    approvalId,
    prompt,
    prompts: prompts.length > 0 ? prompts : prompt ? [prompt] : [],
    count: Number(payload?.count ?? request.count ?? 1),
    width: Number(payload?.width ?? request.width ?? 1280),
    height: Number(payload?.height ?? request.height ?? 720),
    role:
      typeof payload?.role === "string"
        ? payload.role
        : typeof request.role === "string"
          ? request.role
          : undefined,
  };
}

export function isSameActiveImageJob(
  job: { type: string; status: string; payload: Record<string, unknown> },
  request: {
    approvalId?: string;
    prompt: string;
    prompts?: string[];
    count: number;
    width: number;
    height: number;
    role?: string;
  }
): boolean {
  if (job.type !== "image_generation" && job.type !== "direct_image_generation") {
    return false;
  }
  if (job.status !== "pending" && job.status !== "running") return false;
  const stored = readImageJobRequest(job.payload);
  if (request.approvalId && stored.approvalId === request.approvalId) return true;
  return (
    imageJobSignature({
      prompt: stored.prompt,
      prompts: stored.prompts,
      count: stored.count,
      width: stored.width,
      height: stored.height,
      role: stored.role,
    }) ===
    imageJobSignature({
      prompt: request.prompt,
      prompts: request.prompts,
      count: request.count,
      width: request.width,
      height: request.height,
      role: request.role,
    })
  );
}

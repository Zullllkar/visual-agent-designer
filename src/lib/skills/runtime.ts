export function resolveImageFrame(input: {
  skillSize?: { width: number; height: number } | null;
  targetSize: { width: number; height: number };
}): { width: number; height: number } {
  const width = input.skillSize?.width;
  const height = input.skillSize?.height;
  if (typeof width === "number" && width > 0 && typeof height === "number" && height > 0) {
    return { width, height };
  }
  return input.targetSize;
}

export function resolveRepairThreshold(input: {
  skillThreshold?: number | null;
  sliderThreshold?: number | null;
  fallback?: number;
}): number {
  if (typeof input.skillThreshold === "number" && Number.isFinite(input.skillThreshold)) {
    return input.skillThreshold;
  }
  if (typeof input.sliderThreshold === "number" && Number.isFinite(input.sliderThreshold)) {
    return input.sliderThreshold;
  }
  return input.fallback ?? 8;
}

export function formatSkillRuntime(input: {
  skillSize?: { width: number; height: number } | null;
  targetSize: { width: number; height: number };
  repairThreshold?: number | null;
  sliderThreshold?: number | null;
}): string {
  const frame = resolveImageFrame(input);
  const threshold = resolveRepairThreshold({
    skillThreshold: input.repairThreshold,
    sliderThreshold: input.sliderThreshold,
  });
  return [
    `Default image size: ${frame.width}×${frame.height}`,
    `Repair threshold: ${threshold}`,
    "Produce images via generate_images. Do not emit CanvasPage JSON or layout trees.",
  ].join("\n");
}

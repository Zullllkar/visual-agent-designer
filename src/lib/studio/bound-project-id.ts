/** Browser-safe: do not import vad/storage or server-only modules from here. */

export function resolveBoundProjectId(input: {
  existingId?: string | null;
  boundProjectId?: string | null;
}): string | undefined {
  const existing = input.existingId?.trim();
  if (existing) return existing;
  const bound = input.boundProjectId?.trim();
  return bound || undefined;
}

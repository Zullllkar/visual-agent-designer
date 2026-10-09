export function pendingImageToolApprovalFromEvents(
  events: Array<{ type: string; data?: unknown }>
): { runId: string; approvalId: string } | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    const data =
      event.data && typeof event.data === "object"
        ? (event.data as {
            runId?: unknown;
            approvalId?: unknown;
            toolName?: unknown;
          })
        : null;
    const runId = typeof data?.runId === "string" ? data.runId.trim() : "";
    const approvalId =
      typeof data?.approvalId === "string" ? data.approvalId.trim() : "";
    const toolName = typeof data?.toolName === "string" ? data.toolName : "";
    if (
      event.type === "tool.confirm" &&
      (toolName === "generate_images" ||
        toolName === "generate_image_variants") &&
      runId &&
      approvalId
    ) {
      return { runId, approvalId };
    }
    if (event.type === "image_generation.confirm" && runId) {
      return {
        runId,
        approvalId: approvalId || `${runId}:generate_images`,
      };
    }
  }
  return null;
}

export function shouldSendImageConfirm(
  status: string | undefined,
  pending: { runId: string; approvalId: string } | null,
): boolean {
  if (status === "cancelling") return false;
  if (pending) return true;
  return status !== "streaming";
}

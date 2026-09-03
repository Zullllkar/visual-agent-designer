import { describe, expect, it, vi } from "vitest";
import { bridgeRequests } from "./pending-requests";

function newAsset(projectId = "p1") {
  return bridgeRequests.create({
    kind: "asset",
    projectId,
    asset: { description: "isolated hero illustration", width: 1280, height: 720, count: 1 },
  });
}

describe("bridgeRequests", () => {
  it("approve resolves a waiter before the timeout", async () => {
    const request = newAsset();
    const waiting = bridgeRequests.wait(request.id, 5_000);
    bridgeRequests.resolve(request.id, { action: "approve" });
    await expect(waiting).resolves.toMatchObject({ id: request.id, status: "approved" });
  });

  it("reject carries the reason back to the waiter", async () => {
    const request = newAsset();
    const waiting = bridgeRequests.wait(request.id, 5_000);
    bridgeRequests.resolve(request.id, { action: "reject", reason: "use the existing hero" });
    await expect(waiting).resolves.toMatchObject({
      status: "rejected",
      reason: "use the existing hero",
    });
  });

  it("answers questions and rejects wrong-kind resolutions", async () => {
    const question = bridgeRequests.create({
      kind: "question",
      projectId: "p1",
      question: { question: "Should the CTA be full width on mobile?" },
    });
    expect(bridgeRequests.resolve(question.id, { action: "approve" })).toBeUndefined();
    const waiting = bridgeRequests.wait(question.id, 5_000);
    bridgeRequests.resolve(question.id, { action: "answer", answer: "Yes, full width." });
    await expect(waiting).resolves.toMatchObject({ status: "answered", answer: "Yes, full width." });
  });

  it("resolving twice is a no-op", () => {
    const request = newAsset();
    expect(bridgeRequests.resolve(request.id, { action: "approve" })?.status).toBe("approved");
    expect(bridgeRequests.resolve(request.id, { action: "reject" })).toBeUndefined();
  });

  it("wait resolves with the still-pending request after the timeout", async () => {
    vi.useFakeTimers();
    try {
      const request = newAsset();
      const waiting = bridgeRequests.wait(request.id, 1_000);
      await vi.advanceTimersByTimeAsync(1_100);
      await expect(waiting).resolves.toMatchObject({ id: request.id, status: "pending" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("lists pending requests per project and notifies listeners", () => {
    const seen: string[] = [];
    const off = bridgeRequests.onChange((r) => seen.push(`${r.id}:${r.status}`));
    const mine = newAsset("proj-a");
    newAsset("proj-b");
    const pendingA = bridgeRequests.list({ projectId: "proj-a", status: "pending" });
    expect(pendingA.map((r) => r.id)).toContain(mine.id);
    expect(pendingA.every((r) => r.projectId === "proj-a")).toBe(true);
    bridgeRequests.resolve(mine.id, { action: "approve" });
    off();
    expect(seen).toContain(`${mine.id}:pending`);
    expect(seen).toContain(`${mine.id}:approved`);
  });

  it("attachJob records the generation job id", () => {
    const request = newAsset();
    bridgeRequests.resolve(request.id, { action: "approve" });
    bridgeRequests.attachJob(request.id, "job_123");
    expect(bridgeRequests.get(request.id)?.jobId).toBe("job_123");
  });

  it("rejects waiting on an unknown request", async () => {
    await expect(bridgeRequests.wait("nope", 10)).rejects.toThrow(/Unknown bridge request/);
  });
});

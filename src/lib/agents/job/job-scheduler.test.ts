import { describe, expect, it } from "vitest";

import { inferJobTotal, jobScheduler } from "./job-scheduler";

describe("inferJobTotal", () => {
  it("uses pending asset count before request count", () => {
    expect(
      inferJobTotal({
        pendingAssets: [{ id: "a" }, { id: "b" }],
        request: { count: 4 },
      })
    ).toBe(2);
  });

  it("falls back to direct image request count", () => {
    expect(inferJobTotal({ request: { count: 3 } })).toBe(3);
  });

  it("returns zero for missing or invalid totals", () => {
    expect(inferJobTotal({})).toBe(0);
    expect(inferJobTotal({ request: { count: "nope" } })).toBe(0);
  });
});

describe("jobScheduler", () => {
  it("includes toolCallId in queued events", () => {
    const events: unknown[] = [];
    const unsubscribe = jobScheduler.onEvent((event) => events.push(event));
    try {
      const job = jobScheduler.submit({
        type: "custom",
        payload: { total: 1 },
        runId: "run-test-tool",
        toolCallId: "tool-test-1",
      });

      expect(job.toolCallId).toBe("tool-test-1");
      expect(events[0]).toMatchObject({
        type: "job.queued",
        data: {
          jobId: job.id,
          runId: "run-test-tool",
          toolCallId: "tool-test-1",
        },
      });
    } finally {
      unsubscribe();
    }
  });
});

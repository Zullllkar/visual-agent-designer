import { describe, expect, it, vi } from "vitest";

import {
  loadListPreferLocalIfEmpty,
  loadWithDaemonFallback,
} from "@/lib/vad/load-with-daemon-fallback";

describe("loadWithDaemonFallback", () => {
  it("falls back to local when daemon answers 404/null", async () => {
    const local = vi.fn(async () => ({ id: "xiaohongshu-cover" }));
    const result = await loadWithDaemonFallback(
      async () => null,
      local,
      true,
      "loadMergedProject",
    );
    expect(result).toEqual({ id: "xiaohongshu-cover" });
    expect(local).toHaveBeenCalledTimes(1);
  });

  it("does not invent a miss when daemon has the project", async () => {
    const local = vi.fn(async () => ({ id: "stale" }));
    const result = await loadWithDaemonFallback(
      async () => ({ id: "from-daemon" }),
      local,
      true,
      "loadMergedProject",
    );
    expect(result).toEqual({ id: "from-daemon" });
    expect(local).not.toHaveBeenCalled();
  });
});

describe("loadListPreferLocalIfEmpty", () => {
  it("reads local chat when daemon returns an empty list for a workspace project", async () => {
    const local = vi.fn(async () => [{ id: "m1" }]);
    const result = await loadListPreferLocalIfEmpty(
      async () => [],
      local,
      true,
      "loadChat",
    );
    expect(result).toEqual([{ id: "m1" }]);
  });
});

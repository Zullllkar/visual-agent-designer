import { describe, expect, it } from "vitest";
import { ACTIVE_CONTEXT_TTL_MS, activeContext } from "./active-context";

describe("activeContext", () => {
  it("reports inactive with a hint before any interaction", () => {
    activeContext.clear();
    const snap = activeContext.snapshot();
    expect(snap.active).toBe(false);
    expect(snap.hint).toMatch(/open a project/i);
  });

  it("tracks the most recent project and expires after the TTL", () => {
    const now = 1_000_000;
    activeContext.touch("p1", now);
    activeContext.touch("p2", now + 10);
    expect(activeContext.snapshot(now + 20)).toMatchObject({ active: true, projectId: "p2" });
    const expired = activeContext.snapshot(now + 10 + ACTIVE_CONTEXT_TTL_MS + 1);
    expect(expired.active).toBe(false);
    expect(expired.projectId).toBe("p2");
    expect(expired.hint).toMatch(/expired/);
  });

  it("ignores empty project ids", () => {
    activeContext.clear();
    activeContext.touch(undefined);
    activeContext.touch(null);
    expect(activeContext.snapshot().active).toBe(false);
  });
});

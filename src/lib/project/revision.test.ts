import { describe, expect, it } from "vitest";
import { isStaleProjectWrite, nextProjectRevision } from "./revision";

const project = (revision: number) => ({ id: "p", slug: "p", title: "P", rawIdea: "idea", createdAt: "2026-01-01", updatedAt: "2026-01-01", revision, pages: [] }) as never;

describe("project revisions", () => {
  it("rejects an older Agent or Job snapshot", () => {
    expect(isStaleProjectWrite(project(2), project(3))).toBe(true);
    expect(isStaleProjectWrite(project(3), project(3))).toBe(false);
  });

  it("advances the persisted revision monotonically", () => {
    expect(nextProjectRevision(project(3), project(4)).revision).toBe(5);
  });
});

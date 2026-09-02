import { describe, expect, it } from "vitest";

import { parseProjectFileLight } from "./parse-project";
import type { ProjectFile } from "./schema";

function baseProject(overrides: Partial<ProjectFile> = {}): ProjectFile {
  return {
    id: "p1",
    slug: "p1",
    title: "Demo",
    rawIdea: "idea",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    pages: [],
    ...overrides,
  };
}

describe("parseProjectFileLight", () => {
  it("reattaches canvasSnapshot without sending it through Zod", () => {
    const canvasSnapshot = {
      schemaVersion: 1 as const,
      updatedAt: "2026-01-01T00:00:00.000Z",
      shapes: [{ id: "s1", type: "image-asset", cyclic: null as unknown }],
    };
    (canvasSnapshot.shapes[0] as { cyclic: unknown }).cyclic = canvasSnapshot;

    const parsed = parseProjectFileLight(
      baseProject({
        canvasSnapshot,
        assets: [
          {
            id: "a1",
            prompt: "neon",
            src: "/api/assets/p1/assets/a1.png",
            width: 1024,
            height: 1024,
            model: "test",
            createdAt: "2026-01-01T00:00:00.000Z",
            status: "candidate",
          },
        ],
      })
    );

    expect(parsed.canvasSnapshot).toBe(canvasSnapshot);
    expect(parsed.assets?.[0]?.src).toBe("/api/assets/p1/assets/a1.png");
  });
});

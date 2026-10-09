import { describe, expect, it } from "vitest";
import { toSafeAssetFilename } from "./asset-filename";

describe("toSafeAssetFilename", () => {
  it("turns pending:direct ids into Windows-safe names", () => {
    expect(toSafeAssetFilename("pending:direct:tgs6_Lab:0", "png")).toBe(
      "pending-direct-tgs6_Lab-0.png"
    );
  });

  it("keeps the result inside the asset route charset", () => {
    const name = toSafeAssetFilename("pending:direct:tgs6_Lab:0", "png");
    expect(name).toMatch(/^[a-zA-Z0-9._-]+$/);
    expect(name).not.toContain(":");
  });

  it("uses an ascii slug from the human title while keeping a unique id tail", () => {
    expect(
      toSafeAssetFilename("pending:direct:tgs6_Lab:0", "png", "Fitness Home"),
    ).toBe("fitness-home-tgs6_Lab-0.png");
  });
});

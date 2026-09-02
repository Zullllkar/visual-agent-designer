import { describe, expect, it } from "vitest";
import { compressImageDataUrlForVision } from "./vision-image";

/** 1x1 PNG */
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("compressImageDataUrlForVision", () => {
  it("returns tiny images mostly unchanged", async () => {
    const out = await compressImageDataUrlForVision(TINY_PNG, { maxEdge: 1536 });
    expect(out.dataUrl.startsWith("data:image/")).toBe(true);
    expect(out.bytesApprox).toBeGreaterThan(0);
  });
});

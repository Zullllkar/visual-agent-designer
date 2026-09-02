import { describe, expect, it } from "vitest";
import { formatSkillRuntime, resolveImageFrame, resolveRepairThreshold } from "./runtime";

describe("resolveImageFrame", () => {
  it("uses the skill default page size when present", () => {
    expect(
      resolveImageFrame({
        skillSize: { width: 1920, height: 1080 },
        targetSize: { width: 1024, height: 1024 },
      }),
    ).toEqual({ width: 1920, height: 1080 });
  });

  it("falls back to the target canvas when no skill size is set", () => {
    expect(
      resolveImageFrame({
        targetSize: { width: 1080, height: 1440 },
      }),
    ).toEqual({ width: 1080, height: 1440 });
  });
});

describe("resolveRepairThreshold", () => {
  it("prefers the skill threshold over the provider slider", () => {
    expect(
      resolveRepairThreshold({
        skillThreshold: 7.5,
        sliderThreshold: 9,
      }),
    ).toBe(7.5);
  });

  it("uses the slider when no skill threshold is set", () => {
    expect(resolveRepairThreshold({ sliderThreshold: 9 })).toBe(9);
  });
});

describe("formatSkillRuntime", () => {
  it("names the image frame, threshold, and generate_images path", () => {
    const text = formatSkillRuntime({
      skillSize: { width: 1440, height: 900 },
      targetSize: { width: 1024, height: 1024 },
      repairThreshold: 8.5,
    });
    expect(text).toContain("1440×900");
    expect(text).toContain("8.5");
    expect(text).toContain("generate_images");
    expect(text).toContain("Do not emit CanvasPage JSON");
  });
});

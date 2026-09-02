import { describe, expect, it } from "vitest";
import { assetLinkDrawStyle } from "./asset-link-style";

describe("assetLinkDrawStyle", () => {
  it("keeps idle links faint and unlabeled", () => {
    const idle = assetLinkDrawStyle(false);
    expect(idle.strokeOpacity).toBeGreaterThan(0.2);
    expect(idle.strokeOpacity).toBeLessThan(0.45);
    expect(idle.showLabel).toBe(false);
    expect(idle.showMarker).toBe(false);
  });

  it("emphasizes links when a family member is selected", () => {
    const on = assetLinkDrawStyle(true);
    expect(on.strokeOpacity).toBeGreaterThan(0.6);
    expect(on.showLabel).toBe(true);
    expect(on.showMarker).toBe(true);
  });
});

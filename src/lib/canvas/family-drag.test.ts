import { describe, expect, it } from "vitest";
import {
  familyDragUpdates,
  parseFamilyMemberIds,
  type FamilyDragOrigin,
} from "./family-drag";

describe("parseFamilyMemberIds", () => {
  it("splits a comma list", () => {
    expect(parseFamilyMemberIds("a, b,c")).toEqual(["a", "b", "c"]);
  });
});

describe("familyDragUpdates", () => {
  const origins: FamilyDragOrigin[] = [
    { id: "leader", type: "image-asset", x: 10, y: 20 },
    { id: "child", type: "image-asset", x: 40, y: 80 },
    { id: "board", type: "family-board", x: 0, y: 0 },
  ];

  it("moves unselected family mates with the leader", () => {
    expect(
      familyDragUpdates(origins, "leader", 15, -5, new Set(["leader"]))
    ).toEqual([
      { id: "child", type: "image-asset", x: 55, y: 75 },
      { id: "board", type: "family-board", x: 15, y: -5 },
    ]);
  });

  it("skips shapes tldraw is already translating", () => {
    expect(
      familyDragUpdates(
        origins,
        "leader",
        15,
        -5,
        new Set(["leader", "child"])
      )
    ).toEqual([{ id: "board", type: "family-board", x: 15, y: -5 }]);
  });
});

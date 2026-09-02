import { describe, expect, it } from "vitest";
import {
  composerRefIdForAsset,
  upsertComposerReference,
} from "./composer-refs";
import type { ReferenceAsset } from "@/lib/project/assets-schema";

function ref(
  id: string,
  src: string,
  notes?: string
): ReferenceAsset {
  return {
    id,
    label: "r",
    src,
    width: 10,
    height: 10,
    source: "upload",
    createdAt: "2026-01-01T00:00:00.000Z",
    notes,
  };
}

describe("upsertComposerReference", () => {
  it("appends a new reference", () => {
    const next = upsertComposerReference([], ref("a", "src-a"));
    expect(next).toHaveLength(1);
    expect(next[0]?.id).toBe("a");
  });

  it("replaces same src instead of duplicating", () => {
    const next = upsertComposerReference(
      [ref("a", "src-a", "from-asset:1")],
      ref("b", "src-a", "from-asset:1")
    );
    expect(next).toHaveLength(1);
    expect(next[0]?.id).toBe("b");
  });

  it("replaces same from-asset notes", () => {
    const next = upsertComposerReference(
      [ref("a", "src-a", "from-asset:x")],
      ref("b", "src-b", "from-asset:x")
    );
    expect(next).toHaveLength(1);
    expect(next[0]?.id).toBe("b");
  });

  it("uses stable asset-derived ids", () => {
    expect(composerRefIdForAsset("abc")).toBe("from-asset-abc");
  });
});

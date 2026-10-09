import { describe, expect, it } from "vitest";
import { createBrowserJsonStorage, normalizePersistedJson } from "./idb-storage";

describe("normalizePersistedJson", () => {
  it("returns null for empty persist payloads so JSON.parse is not called", () => {
    expect(normalizePersistedJson(null)).toBeNull();
    expect(normalizePersistedJson("")).toBeNull();
    expect(normalizePersistedJson("   ")).toBeNull();
    expect(normalizePersistedJson('{"projects":{}}')).toBe('{"projects":{}}');
  });
});

describe("createBrowserJsonStorage", () => {
  it("returns null for empty localStorage values so persist does not JSON.parse them", () => {
    const memory = new Map<string, string>([["vad.providers.v2", ""]]);
    const storage = createBrowserJsonStorage({
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => {
        memory.set(key, value);
      },
      removeItem: (key) => {
        memory.delete(key);
      },
    });
    expect(storage.getItem("vad.providers.v2")).toBeNull();
  });
});

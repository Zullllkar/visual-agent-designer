import { beforeEach, describe, expect, it } from "vitest";
import type { ProviderConfig } from "@/lib/providers/registry";
import {
  clearPersistedProviderConfig,
  clearProviderCache,
  getCachedProviderConfig,
  providerCacheStatus,
  rememberPersistedProviderConfig,
  rememberProviderConfig,
} from "./provider-cache";

const cfg = (tag: string): ProviderConfig =>
  ({
    llm: { kind: "mock" },
    image: { kind: "openai", apiKey: `key-${tag}`, model: "gpt-image" },
  }) as unknown as ProviderConfig;

describe("provider cache fallback order", () => {
  beforeEach(() => clearProviderCache());

  it("is empty until something is remembered", () => {
    expect(getCachedProviderConfig("p1")).toBeUndefined();
    expect(providerCacheStatus("p1")).toEqual({
      available: false,
      scope: "none",
      desktopPersisted: false,
    });
  });

  it("falls back project → latest → desktop-persisted", () => {
    expect(rememberPersistedProviderConfig(cfg("desktop"))).toBe(true);
    expect(providerCacheStatus("p1").scope).toBe("desktop");
    expect(getCachedProviderConfig("p1")).toEqual(cfg("desktop"));

    rememberProviderConfig("p2", cfg("latest"));
    expect(providerCacheStatus("p1")).toMatchObject({ scope: "latest", desktopPersisted: true });
    expect(getCachedProviderConfig("p1")).toEqual(cfg("latest"));

    rememberProviderConfig("p1", cfg("project"));
    expect(providerCacheStatus("p1").scope).toBe("project");
    expect(getCachedProviderConfig("p1")).toEqual(cfg("project"));
  });

  it("ignores mock-only configs and can drop the persisted one", () => {
    expect(
      rememberPersistedProviderConfig({
        llm: { kind: "mock" },
        image: { kind: "mock" },
      } as unknown as ProviderConfig),
    ).toBe(false);
    rememberPersistedProviderConfig(cfg("desktop"));
    clearPersistedProviderConfig();
    expect(getCachedProviderConfig()).toBeUndefined();
  });
});

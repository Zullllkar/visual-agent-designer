import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { validateProviderConfigJson, createProviderSecretStore, providerSecretPath } =
  require("./secrets.cjs") as {
    validateProviderConfigJson: (
      json: unknown
    ) => { ok: true; config: Record<string, unknown> } | { ok: false; reason: string };
    createProviderSecretStore: (
      safeStorage: {
        isEncryptionAvailable: () => boolean;
        encryptString: (s: string) => Buffer;
        decryptString: (b: Buffer) => string;
      },
      userData: string
    ) => {
      file: string;
      available: () => boolean;
      save: (json: unknown) => { ok: boolean; reason?: string };
      load: () => string | null;
      clear: () => void;
    };
    providerSecretPath: (userData: string) => string;
  };

const usable = JSON.stringify({
  llm: { kind: "openai-compatible", apiKey: "sk-test", model: "gpt" },
  image: { kind: "mock" },
});

describe("validateProviderConfigJson", () => {
  it("accepts a config with at least one real provider", () => {
    const out = validateProviderConfigJson(usable);
    expect(out.ok).toBe(true);
  });

  it("rejects mock-only, malformed and oversized payloads", () => {
    expect(validateProviderConfigJson(JSON.stringify({ llm: { kind: "mock" }, image: { kind: "mock" } }))).toEqual({
      ok: false,
      reason: "no_usable_provider",
    });
    expect(validateProviderConfigJson("{nope")).toEqual({ ok: false, reason: "invalid_json" });
    expect(validateProviderConfigJson(JSON.stringify([1, 2]))).toEqual({ ok: false, reason: "not_object" });
    expect(validateProviderConfigJson(42)).toEqual({ ok: false, reason: "not_string" });
    expect(validateProviderConfigJson(`{"llm":{"kind":"x","pad":"${"a".repeat(70_000)}"}}`)).toEqual({
      ok: false,
      reason: "too_large",
    });
  });
});

describe("createProviderSecretStore", () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  const fakeSafeStorage = (available = true) => ({
    isEncryptionAvailable: () => available,
    encryptString: (s: string) => Buffer.from(`enc:${s}`),
    decryptString: (b: Buffer) => b.toString("utf8").replace(/^enc:/, ""),
  });

  it("round-trips through the encryptor and clears cleanly", () => {
    dir = mkdtempSync(join(tmpdir(), "vb-secrets-"));
    const store = createProviderSecretStore(fakeSafeStorage(), dir);
    expect(store.file).toBe(providerSecretPath(dir));
    expect(store.load()).toBeNull();

    expect(store.save(usable)).toEqual({ ok: true });
    expect(store.load()).toBe(usable);

    store.clear();
    expect(store.load()).toBeNull();
  });

  it("refuses to save when encryption is unavailable or the payload is unusable", () => {
    dir = mkdtempSync(join(tmpdir(), "vb-secrets-"));
    const noCrypto = createProviderSecretStore(fakeSafeStorage(false), dir);
    expect(noCrypto.save(usable)).toEqual({ ok: false, reason: "encryption_unavailable" });
    const store = createProviderSecretStore(fakeSafeStorage(), dir);
    expect(store.save(JSON.stringify({ llm: { kind: "mock" } }))).toEqual({
      ok: false,
      reason: "no_usable_provider",
    });
    expect(store.load()).toBeNull();
  });
});

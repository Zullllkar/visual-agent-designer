import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { upsertManagedSnippet, removeManagedSnippet, hasManagedSnippet, MARKER_START, MARKER_END } from "./managed-snippet";
import { DEFAULT_MOUNT_DIR, normalizeMountDir, validateRepoPath } from "./repo-path";

describe("managed snippets", () => {
  it("creates a file from empty", () => {
    const out = upsertManagedSnippet(null, "hello");
    expect(out).toContain(MARKER_START);
    expect(out).toContain("hello");
    expect(hasManagedSnippet(out)).toBe(true);
  });

  it("replaces only the marked region", () => {
    const existing = ["# Title", "", MARKER_START, "old", MARKER_END, "", "user notes"].join("\n");
    const out = upsertManagedSnippet(existing, "new body");
    expect(out).toContain("# Title");
    expect(out).toContain("user notes");
    expect(out).toContain("new body");
    expect(out).not.toContain("old");
  });

  it("appends when markers are missing", () => {
    const out = upsertManagedSnippet("# mine\n", "injected");
    expect(out.startsWith("# mine")).toBe(true);
    expect(out).toContain("injected");
  });

  it("removes the marked region", () => {
    const existing = ["keep", MARKER_START, "gone", MARKER_END, "also", ""].join("\n");
    expect(removeManagedSnippet(existing)).toBe("keep\n\nalso\n");
  });
});

describe("repo path", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const dir of roots) rmSync(dir, { recursive: true, force: true });
    roots.length = 0;
  });

  it("normalizes mountDir and rejects traversal", () => {
    const fallback = normalizeMountDir(undefined);
    expect(fallback.ok && fallback.mountDir).toBe(DEFAULT_MOUNT_DIR);
    expect(normalizeMountDir("../etc").ok).toBe(false);
    expect(normalizeMountDir("/abs").ok).toBe(false);
    expect(normalizeMountDir("design/vibeboard").ok).toBe(true);
  });

  it("requires an existing absolute directory outside VAD_ROOT", () => {
    const dir = mkdtempSync(join(tmpdir(), "vad-repo-"));
    roots.push(dir);
    mkdirSync(join(dir, ".git"));
    const vadRoot = mkdtempSync(join(tmpdir(), "vad-root-"));
    roots.push(vadRoot);

    expect(validateRepoPath("relative/path", { vadRoot }).ok).toBe(false);
    expect(validateRepoPath(vadRoot, { vadRoot }).ok).toBe(false);
    const ok = validateRepoPath(dir, { vadRoot, mountDir: "design/vibeboard" });
    expect(ok).toMatchObject({ ok: true, git: true, mountDir: "design/vibeboard" });
  });

  it("rejects a file path", () => {
    const dir = mkdtempSync(join(tmpdir(), "vad-repo-"));
    roots.push(dir);
    const file = join(dir, "not-a-dir.txt");
    writeFileSync(file, "x");
    expect(validateRepoPath(file, { vadRoot: join(dir, "unrelated") }).ok).toBe(false);
  });
});

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readScreenshotInput } from "./screenshot-input";
import type { ProjectFile } from "@/lib/project/schema";

const ONE_PX_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

function project(linkedPath?: string): ProjectFile {
  return {
    id: "p1",
    slug: "p1",
    title: "t",
    rawIdea: "idea",
    createdAt: "",
    updatedAt: "",
    pages: [],
    ...(linkedPath ? { linkedRepo: { path: linkedPath, mountDir: "design/vibeboard", writeAgentFiles: true, writeMcpConfig: true } } : {}),
  } as ProjectFile;
}

describe("readScreenshotInput", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
  });

  it("accepts a data URL and raw base64 of a tiny PNG", async () => {
    const raw = ONE_PX_PNG.toString("base64");
    const a = await readScreenshotInput(project(), { screenshotBase64: raw });
    expect(a.ok).toBe(true);
    if (a.ok) {
      expect(a.from).toBe("base64");
      expect(a.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
      expect(a.bytes).toBeGreaterThanOrEqual(64);
    }
    const b = await readScreenshotInput(project(), { screenshotBase64: `data:image/png;base64,${raw}` });
    expect(b.ok).toBe(true);
  });

  it("rejects truncated / empty payloads with a size message", async () => {
    const tiny = await readScreenshotInput(project(), { screenshotBase64: "AAAA" });
    expect(tiny.ok).toBe(false);
    if (!tiny.ok) expect(tiny.error).toMatch(/truncated|bytes/i);
    const missing = await readScreenshotInput(project(), {});
    expect(missing.ok).toBe(false);
  });

  it("reads a file from the system temp dir", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vad-shot-"));
    dirs.push(dir);
    const file = join(dir, "screen.png");
    writeFileSync(file, ONE_PX_PNG);
    const result = await readScreenshotInput(project(), { screenshotPath: file });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.from).toBe("path");
  });

  it("rejects paths outside the linked repo and temp dir", async () => {
    const result = await readScreenshotInput(project(), {
      screenshotPath: process.platform === "win32" ? "C:\\Windows\\win.ini" : "/etc/hosts",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/linked repository or the system temp dir/);
  });

  it("rejects a relative path", async () => {
    const result = await readScreenshotInput(project(), { screenshotPath: "shot.png" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/absolute/);
  });
});

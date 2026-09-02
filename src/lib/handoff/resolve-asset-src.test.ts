import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/vad/paths", () => ({
  projectDir: (id: string) => join(mockRoot, id),
}));

let mockRoot = "";

describe("resolveAssetImageDataUrl", () => {
  beforeEach(async () => {
    mockRoot = await mkdtemp(join(tmpdir(), "vad-resolve-"));
  });

  afterEach(async () => {
    await rm(mockRoot, { recursive: true, force: true });
  });

  it("returns data URLs unchanged", async () => {
    const { resolveAssetImageDataUrl } = await import("./resolve-asset-src");
    const data = "data:image/png;base64,abcd";
    expect(await resolveAssetImageDataUrl(data)).toBe(data);
  });

  it("reads /api/assets paths from project disk", async () => {
    const projectId = "proj1";
    const assetsDir = join(mockRoot, projectId, "assets");
    await mkdir(assetsDir, { recursive: true });
    await writeFile(join(assetsDir, "img1.png"), Buffer.from("png-bytes"));

    const { resolveAssetImageDataUrl } = await import("./resolve-asset-src");
    const out = await resolveAssetImageDataUrl(
      `/api/assets/${projectId}/assets/img1.png`,
      projectId
    );
    expect(out).toMatch(/^data:image\/png;base64,/);
  });
});

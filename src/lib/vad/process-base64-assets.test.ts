import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tempRoot = { current: "" };

vi.mock("@/lib/vad/paths", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/vad/paths")>();
  return {
    ...orig,
    projectDir: (projectId: string) => join(tempRoot.current, projectId),
  };
});

const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("processBase64Assets", () => {
  beforeEach(async () => {
    tempRoot.current = await mkdtemp(join(tmpdir(), "vad-assets-"));
  });

  afterEach(async () => {
    await rm(tempRoot.current, { recursive: true, force: true });
  });

  it("writes colon ids to a safe png path and keeps the logical id", async () => {
    const { processBase64Assets } = await import("./persist");
    const id = "pending:direct:tgs6_Lab:0";
    const [out] = await processBase64Assets("QI0M0xQ80A", [
      { id, src: `data:image/png;base64,${TINY_PNG}` },
    ]);

    expect(out.id).toBe(id);
    expect(out.src).toBe(
      "/api/assets/QI0M0xQ80A/assets/pending-direct-tgs6_Lab-0.png"
    );
    const disk = join(
      tempRoot.current,
      "QI0M0xQ80A",
      "assets",
      "pending-direct-tgs6_Lab-0.png"
    );
    await expect(readFile(disk)).resolves.toBeInstanceOf(Buffer);
  });

  it("writes a readable ascii filename when the asset has a human title", async () => {
    const { processBase64Assets } = await import("./persist");
    const id = "pending:direct:tgs6_Lab:0";
    const [out] = await processBase64Assets("QI0M0xQ80A", [
      {
        id,
        title: "Fitness Home",
        src: `data:image/png;base64,${TINY_PNG}`,
      },
    ]);
    expect(out.src).toBe(
      "/api/assets/QI0M0xQ80A/assets/fitness-home-tgs6_Lab-0.png"
    );
  });

  it("persists wrapped base64 data URIs to a safe filename", async () => {
    const { processBase64Assets } = await import("./persist");
    const id = "pending:direct:9c3982bea0:0";
    const wrapped = `data:image/png;base64,${TINY_PNG.slice(0, 40)}\n${TINY_PNG.slice(40)}`;
    const [out] = await processBase64Assets("QI0M0xQ80A", [{ id, src: wrapped }]);
    expect(out.src).toBe(
      "/api/assets/QI0M0xQ80A/assets/pending-direct-9c3982bea0-0.png"
    );
  });

  it("leaves url-encoded svg placeholders in memory instead of writing garbage files", async () => {
    const { processBase64Assets } = await import("./persist");
    const { GENERATING_PLACEHOLDER_SRC } = await import(
      "@/lib/canvas/generating-placeholder"
    );
    const id = "pending-direct-12d94bbc99-0";
    const [out] = await processBase64Assets("QI0M0xQ80A", [
      { id, src: GENERATING_PLACEHOLDER_SRC },
    ]);
    expect(out.src).toBe(GENERATING_PLACEHOLDER_SRC);
    await expect(
      readFile(join(tempRoot.current, "QI0M0xQ80A", "assets", `${id}.svg`))
    ).rejects.toThrow();
  });
});

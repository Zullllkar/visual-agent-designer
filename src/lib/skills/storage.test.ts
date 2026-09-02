import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import matter from "gray-matter";
import { afterEach, describe, expect, it } from "vitest";
import { DesignSystemManifestSchema } from "./schema";
import {
  deleteUserSkill,
  parseSkillDocument,
  readUserSkillDocument,
  setUserSkillEnabled,
  writeUserSkillDocument,
} from "./storage";

const roots: string[] = [];

const RAW = `---
name: test-skill
description: 测试 Skill
kind: prototype
version: "1.0.0"
inputs: []
output:
  artifact: canvas-pages
agent:
  steps: [brief, image]
  imageRequired: true
  repairThreshold: 8
  maxRepairRounds: 1
---

# Test Skill

只生成测试素材。`;

const BUILTIN_SKILLS = [
  "web-prototype",
  "saas-landing",
  "xhs-cover",
  "game-art",
  "promo-kv",
  "product-shot",
  "style-board",
] as const;

const BUILTIN_DESIGN_SYSTEMS = [
  "linear-like",
  "xhs-style",
  "cinematic-concept",
  "campaign-key",
  "product-photo",
  "exploration-board",
] as const;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Skill document storage", () => {
  it("parses every builtin SKILL.md as an image recipe", async () => {
    for (const id of BUILTIN_SKILLS) {
      const raw = await readFile(join(process.cwd(), "skills", id, "SKILL.md"), "utf8");
      const parsed = parseSkillDocument(raw);
      expect(parsed.manifest.name).toBe(id);
      expect(parsed.manifest.output.defaultPageSize).toEqual(
        expect.objectContaining({ width: expect.any(Number), height: expect.any(Number) }),
      );
      expect(raw).not.toMatch(/CanvasPage/);
      expect(parsed.body).toMatch(/P0/);
    }
  });

  it("keeps landing frames at a single-shot height", async () => {
    const raw = await readFile(join(process.cwd(), "skills", "saas-landing", "SKILL.md"), "utf8");
    const parsed = parseSkillDocument(raw);
    expect(parsed.manifest.output.defaultPageSize).toEqual({ width: 1440, height: 900 });
  });

  it("parses every builtin DESIGN.md nine-section file", async () => {
    for (const id of BUILTIN_DESIGN_SYSTEMS) {
      const raw = await readFile(join(process.cwd(), "design-systems", id, "DESIGN.md"), "utf8");
      const fm = matter(raw);
      const parsed = DesignSystemManifestSchema.parse(fm.data);
      expect(parsed.name).toBe(id);
      expect(fm.content).toMatch(/## 1\. Visual Theme/);
      expect(fm.content).toMatch(/## 9\. Agent Prompt Guide/);
    }
  });

  it("rejects path traversal and malformed documents", () => {
    expect(() => parseSkillDocument(RAW.replace("test-skill", "../escape"))).toThrow();
    expect(() => parseSkillDocument("---\nname: broken\n---\nbody")).toThrow();
  });

  it("creates, disables, enables and deletes a user Skill", async () => {
    const root = await mkdtemp(join(tmpdir(), "vad-skills-"));
    roots.push(root);

    const created = await writeUserSkillDocument(RAW, { userSkillsDir: root });
    expect(created.manifest.name).toBe("test-skill");
    expect(await readFile(join(root, "test-skill", "SKILL.md"), "utf8")).toContain("# Test Skill");

    await setUserSkillEnabled("test-skill", false, { userSkillsDir: root });
    expect((await readUserSkillDocument("test-skill", { userSkillsDir: root })).enabled).toBe(
      false,
    );

    await setUserSkillEnabled("test-skill", true, { userSkillsDir: root });
    expect((await readUserSkillDocument("test-skill", { userSkillsDir: root })).enabled).toBe(true);

    await deleteUserSkill("test-skill", { userSkillsDir: root });
    await expect(readUserSkillDocument("test-skill", { userSkillsDir: root })).rejects.toThrow();
  });
});

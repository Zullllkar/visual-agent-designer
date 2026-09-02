/**
 * Skill / DesignSystem 文件加载器（server-only）
 * --------------------------------------------------------------
 * 扫描项目根的 skills/ 和 design-systems/ 目录，把每个子文件夹的
 * SKILL.md / DESIGN.md 解析成结构化对象。
 *
 * 设计目标：
 *   - frontmatter 用 gray-matter 解析 YAML
 *   - frontmatter 必须通过 zod 校验（不合规则跳过）
 *   - markdown body 全文保留（注入 prompt 用）
 *   - 失败用 console.warn 报告但不中断（让用户看到坏的 skill 名字）
 */

import "server-only";

import type { Dirent } from "node:fs";
import { access, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import matter from "gray-matter";
import { resolveVadRoot } from "@/lib/vad/paths";
import {
  type DesignSystem,
  DesignSystemManifestSchema,
  type Skill,
  SkillManifestSchema,
  type SkillOrigin,
} from "./schema";

/** 项目根目录（cwd）；桌面端可经 VAD_PROJECT_ROOT 指向安装资源 */
const projectRoot = () => process.env.VAD_PROJECT_ROOT?.trim() || process.cwd();

/** skills/ 默认目录 */
const SKILLS_DIR = "skills";
/** design-systems/ 默认目录 */
const DESIGN_SYSTEMS_DIR = "design-systems";

/** 解析单个 SKILL.md */
function parseSkill(
  sourcePath: string,
  raw: string,
  origin: SkillOrigin,
  enabled: boolean,
): Skill | null {
  const fm = matter(raw);
  const result = SkillManifestSchema.safeParse(fm.data);
  if (!result.success) {
    console.warn(`[skill-loader] frontmatter 不合规 ${sourcePath}: ${result.error.message}`);
    return null;
  }
  return {
    sourcePath,
    manifest: result.data,
    body: fm.content.trim(),
    raw,
    origin,
    enabled,
  };
}

/** 解析单个 DESIGN.md */
function parseDesignSystem(sourcePath: string, raw: string): DesignSystem | null {
  const fm = matter(raw);
  const result = DesignSystemManifestSchema.safeParse(fm.data);
  if (!result.success) {
    console.warn(
      `[design-system-loader] frontmatter 不合规 ${sourcePath}: ${result.error.message}`,
    );
    return null;
  }
  return {
    sourcePath,
    manifest: result.data,
    body: fm.content.trim(),
  };
}

export async function loadAllSkills(): Promise<Skill[]> {
  const roots: Array<{
    dir: string;
    label: string;
    origin: SkillOrigin;
    supportsDisabled: boolean;
  }> = [
    {
      dir: resolve(/* turbopackIgnore: true */ projectRoot(), SKILLS_DIR),
      label: SKILLS_DIR,
      origin: "builtin",
      supportsDisabled: false,
    },
    {
      dir: join(/* turbopackIgnore: true */ resolveVadRoot(), SKILLS_DIR),
      label: "user-skills",
      origin: "user",
      supportsDisabled: true,
    },
  ];

  const byId = new Map<string, Skill>();
  for (const root of roots) {
    let entries: string[];
    try {
      entries = await readdir(root.dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const filePath = join(/* turbopackIgnore: true */ root.dir, entry, "SKILL.md");
      let raw: string;
      try {
        raw = await readFile(filePath, "utf8");
      } catch {
        continue;
      }
      let enabled = true;
      if (root.supportsDisabled) {
        try {
          await access(join(/* turbopackIgnore: true */ root.dir, entry, ".disabled"));
          enabled = false;
        } catch {
          enabled = true;
        }
      }
      const sourcePath = `${root.label}/${entry}/SKILL.md`;
      try {
        const parsed = parseSkill(sourcePath, raw, root.origin, enabled);
        if (!parsed) continue;
        const id = parsed.manifest.name;
        if (byId.has(id)) {
          console.warn(`[skill-loader] 跳过重复 Skill "${id}"（${sourcePath}）`);
          continue;
        }
        byId.set(id, parsed);
      } catch (error) {
        console.warn(`[skill-loader] 解析失败 ${sourcePath}: ${(error as Error).message}`);
      }
    }
  }
  return [...byId.values()];
}

export async function loadAllDesignSystems(): Promise<DesignSystem[]> {
  const dir = resolve(/* turbopackIgnore: true */ projectRoot(), DESIGN_SYSTEMS_DIR);
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const systems: DesignSystem[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sourcePath = `${DESIGN_SYSTEMS_DIR}/${entry.name}/DESIGN.md`;
    try {
      const raw = await readFile(
        join(/* turbopackIgnore: true */ dir, entry.name, "DESIGN.md"),
        "utf8",
      );
      const system = parseDesignSystem(sourcePath, raw);
      if (system) systems.push(system);
    } catch (error) {
      console.warn(`[design-system-loader] 解析失败 ${sourcePath}: ${(error as Error).message}`);
    }
  }
  return systems;
}

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

import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import matter from "gray-matter";
import {
  SkillManifestSchema,
  DesignSystemManifestSchema,
  type Skill,
  type DesignSystem,
} from "./schema";

/** 项目根目录（cwd） */
const projectRoot = () => process.cwd();

/** skills/ 默认目录 */
const SKILLS_DIR = "skills";
/** design-systems/ 默认目录 */
const DESIGN_SYSTEMS_DIR = "design-systems";

/** 通用：扫描某目录的子文件夹，找特定文件名解析为对象 */
async function scanDir<T>(
  dirRel: string,
  fileName: string,
  parser: (sourcePath: string, raw: string) => T | null
): Promise<T[]> {
  const dirAbs = resolve(projectRoot(), dirRel);
  let entries: string[];
  try {
    entries = await readdir(dirAbs);
  } catch {
    // 目录不存在直接返回空，让 daemon 在没有内置 skill 的情况下也能起来
    return [];
  }

  const out: T[] = [];
  for (const entry of entries) {
    const subdir = join(dirAbs, entry);
    let s;
    try {
      s = await stat(subdir);
    } catch {
      continue;
    }
    if (!s.isDirectory()) continue;

    const filePath = join(subdir, fileName);
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch {
      continue; // 子目录里没有目标文件就跳过
    }

    try {
      const parsed = parser(`${dirRel}/${entry}/${fileName}`, raw);
      if (parsed) out.push(parsed);
    } catch (e) {
      console.warn(
        `[skill-loader] 解析失败 ${dirRel}/${entry}/${fileName}: ${(e as Error).message}`
      );
    }
  }
  return out;
}

/** 解析单个 SKILL.md */
function parseSkill(sourcePath: string, raw: string): Skill | null {
  const fm = matter(raw);
  const result = SkillManifestSchema.safeParse(fm.data);
  if (!result.success) {
    console.warn(
      `[skill-loader] frontmatter 不合规 ${sourcePath}: ${result.error.message}`
    );
    return null;
  }
  return {
    sourcePath,
    manifest: result.data,
    body: fm.content.trim(),
  };
}

/** 解析单个 DESIGN.md */
function parseDesignSystem(sourcePath: string, raw: string): DesignSystem | null {
  const fm = matter(raw);
  const result = DesignSystemManifestSchema.safeParse(fm.data);
  if (!result.success) {
    console.warn(
      `[design-system-loader] frontmatter 不合规 ${sourcePath}: ${result.error.message}`
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
  return scanDir(SKILLS_DIR, "SKILL.md", parseSkill);
}

export async function loadAllDesignSystems(): Promise<DesignSystem[]> {
  return scanDir(DESIGN_SYSTEMS_DIR, "DESIGN.md", parseDesignSystem);
}

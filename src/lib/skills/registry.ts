/**
 * Skill / DesignSystem Registry（server-only，进程级缓存）
 * --------------------------------------------------------------
 * 第一次调用扫描磁盘；之后命中缓存。dev 模式下若需要热更新，
 * 后续可加文件 watcher；MVP 阶段先要求重启 next dev。
 *
 * 提供：
 *   - getSkillRegistry()        所有可用 Skill
 *   - getDesignSystemRegistry() 所有可用 DesignSystem
 *   - resolveSkill(id)          按 id 取（找不到回退到第一个）
 *   - resolveDesignSystem(id)   按 id 取（找不到回退到第一个）
 *
 * 注：只能在 server 端用（包含 fs 操作）。
 */

import "server-only";

import { loadAllDesignSystems, loadAllSkills } from "./loader";
import type { DesignSystem, Skill } from "./schema";
import { findSkillById } from "./selection";

interface Registry {
  skills: Skill[];
  designSystems: DesignSystem[];
}

let cache: Registry | null = null;
let pending: Promise<Registry> | null = null;

async function build(): Promise<Registry> {
  const [skills, designSystems] = await Promise.all([loadAllSkills(), loadAllDesignSystems()]);
  return { skills, designSystems };
}

async function ensure(): Promise<Registry> {
  if (cache) return cache;
  if (!pending) pending = build().then((r) => (cache = r));
  return pending;
}

/** 强制重建索引（Dev 工具或 watcher 触发用） */
export function invalidateRegistry() {
  cache = null;
  pending = null;
}

export async function getAllSkillRegistry(): Promise<Skill[]> {
  return (await ensure()).skills;
}

export async function getSkillRegistry(): Promise<Skill[]> {
  return (await ensure()).skills.filter((skill) => skill.enabled);
}

export async function getDesignSystemRegistry(): Promise<DesignSystem[]> {
  return (await ensure()).designSystems;
}

/**
 * 按 id 取 Skill；找不到返回 null（让上游决定回退策略）。
 */
export async function resolveSkill(id: string | undefined): Promise<Skill | null> {
  const all = await getSkillRegistry();
  return findSkillById(all, id);
}

export async function resolveDesignSystem(id: string | undefined): Promise<DesignSystem | null> {
  const all = await getDesignSystemRegistry();
  if (!id) return all[0] ?? null;
  return all.find((d) => d.manifest.name === id) ?? all[0] ?? null;
}

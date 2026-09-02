import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";
import { resolveVadRoot } from "@/lib/vad/paths";
import { type SkillManifest, SkillManifestSchema } from "./schema";

const SKILL_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SKILL_FILENAME = "SKILL.md";
const DISABLED_FILENAME = ".disabled";

type StorageOptions = {
  userSkillsDir?: string;
};

export type ParsedSkillDocument = {
  manifest: SkillManifest;
  body: string;
  raw: string;
};

function resolveUserSkillsDir(options?: StorageOptions): string {
  return options?.userSkillsDir ?? join(/* turbopackIgnore: true */ resolveVadRoot(), "skills");
}

export function assertSafeSkillId(id: string): void {
  if (!SKILL_ID_PATTERN.test(id)) {
    throw new Error("Skill ID 只能包含小写字母、数字和连字符");
  }
}

function userSkillDir(id: string, options?: StorageOptions): string {
  assertSafeSkillId(id);
  return join(/* turbopackIgnore: true */ resolveUserSkillsDir(options), id);
}

export function parseSkillDocument(raw: string): ParsedSkillDocument {
  if (!raw.trim()) throw new Error("SKILL.md 不能为空");
  const parsed = matter(raw);
  const manifest = SkillManifestSchema.parse(parsed.data);
  assertSafeSkillId(manifest.name);
  const body = parsed.content.trim();
  if (!body) throw new Error("Skill 指令正文不能为空");
  return {
    manifest,
    body,
    raw: `${raw.replace(/\r\n/g, "\n").trimEnd()}\n`,
  };
}

export async function writeUserSkillDocument(
  raw: string,
  options?: StorageOptions & { overwrite?: boolean },
): Promise<ParsedSkillDocument> {
  const parsed = parseSkillDocument(raw);
  const dir = userSkillDir(parsed.manifest.name, options);
  if (!options?.overwrite) {
    try {
      await access(dir);
      throw new Error(`Skill "${parsed.manifest.name}" 已存在`);
    } catch (error) {
      if (error instanceof Error && error.message.includes("已存在")) throw error;
    }
  }
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, SKILL_FILENAME), parsed.raw, "utf8");
  return parsed;
}

export async function readUserSkillDocument(
  id: string,
  options?: StorageOptions,
): Promise<ParsedSkillDocument & { enabled: boolean }> {
  const dir = userSkillDir(id, options);
  const raw = await readFile(join(dir, SKILL_FILENAME), "utf8");
  let enabled = true;
  try {
    await access(join(dir, DISABLED_FILENAME));
    enabled = false;
  } catch {
    enabled = true;
  }
  return { ...parseSkillDocument(raw), enabled };
}

export async function setUserSkillEnabled(
  id: string,
  enabled: boolean,
  options?: StorageOptions,
): Promise<void> {
  const dir = userSkillDir(id, options);
  await access(join(dir, SKILL_FILENAME));
  const marker = join(dir, DISABLED_FILENAME);
  if (enabled) {
    await rm(marker, { force: true });
  } else {
    await writeFile(marker, "disabled\n", "utf8");
  }
}

export async function deleteUserSkill(id: string, options?: StorageOptions): Promise<void> {
  const dir = userSkillDir(id, options);
  await access(join(dir, SKILL_FILENAME));
  await rm(dir, { recursive: true, force: false });
}

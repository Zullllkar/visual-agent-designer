/**
 * Composer slash menu: assets, skills, and shortcut commands.
 */

import { displayAssetTitle } from "@/lib/project/asset-title";

export type SlashItemKind = "asset" | "skill" | "command";

export interface SlashItem {
  id: string;
  kind: SlashItemKind;
  label: string;
  hint?: string;
  insert?: string;
  assetId?: string;
  skillName?: string;
}

export const SLASH_GROUP_LABEL: Record<SlashItemKind, string> = {
  asset: "素材",
  skill: "Skill",
  command: "快捷",
};

export const SLASH_COMMANDS: SlashItem[] = [
  {
    id: "cmd-gen-1",
    kind: "command",
    label: "生成 1 张视觉素材",
    hint: "快捷",
    insert: "生成 1 张视觉素材",
  },
  {
    id: "cmd-variants-2",
    kind: "command",
    label: "生成 2 个变体",
    hint: "快捷",
    insert: "生成 2 个变体",
  },
  {
    id: "cmd-variants-4",
    kind: "command",
    label: "生成 4 个变体",
    hint: "快捷",
    insert: "生成 4 个变体",
  },
  {
    id: "cmd-recolor",
    kind: "command",
    label: "换个配色",
    hint: "快捷",
    insert: "换个配色重新出图",
  },
  {
    id: "cmd-region",
    kind: "command",
    label: "局部重绘这张",
    hint: "快捷",
    insert: "局部重绘这张",
  },
  {
    id: "cmd-dark",
    kind: "command",
    label: "生成深色版本",
    hint: "快捷",
    insert: "生成深色版本",
  },
  {
    id: "cmd-export",
    kind: "command",
    label: "导出交付包",
    hint: "快捷",
    insert: "导出交付包",
  },
];

export function parseSlashQuery(
  text: string,
  cursor: number,
): { start: number; query: string } | null {
  const before = text.slice(0, Math.max(0, cursor));
  const match = before.match(/(^|[\s])\/([^\s]*)$/);
  if (!match) return null;
  const query = match[2] ?? "";
  const start = before.length - query.length - 1;
  return { start, query };
}

export function filterSlashItems(query: string, items: SlashItem[]): SlashItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) => {
    const hay = [item.label, item.hint, item.kind, item.skillName, item.insert]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(needle);
  });
}

export function applySlashSelection(
  text: string,
  start: number,
  cursor: number,
): string {
  return `${text.slice(0, start)}${text.slice(cursor)}`;
}

export function buildSlashItems(input: {
  assets: Array<{ id: string; prompt?: string; title?: string; src?: string }>;
  skills: Array<{ name: string; description: string; bodyPreview?: string }>;
}): SlashItem[] {
  const assets = input.assets
    .filter((asset) => Boolean(asset.src))
    .slice(0, 8)
    .map((asset) => ({
      id: `asset-${asset.id}`,
      kind: "asset" as const,
      label: displayAssetTitle(asset).slice(0, 28),
      hint: "素材",
      assetId: asset.id,
    }));

  const skills = input.skills.slice(0, 12).map((skill) => {
    const heading = String(skill.bodyPreview ?? "")
      .match(/^#\s+(.+)$/m)?.[1]
      ?.trim();
    const title =
      heading ||
      skill.description.split(/[。.\n]/)[0]?.trim() ||
      skill.name;
    return {
      id: `skill-${skill.name}`,
      kind: "skill" as const,
      label: title.slice(0, 28),
      hint: "Skill",
      skillName: skill.name,
    };
  });

  return [...assets, ...skills, ...SLASH_COMMANDS];
}

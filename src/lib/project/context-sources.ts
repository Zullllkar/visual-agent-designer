import type { ProjectFile } from "./schema";

export type ContextSourceKind = "brief" | "direction" | "asset-plan" | "references" | "canvas" | "notes" | "handoff";

export interface ContextSourcePreference {
  id: string;
  kind: ContextSourceKind;
  label: string;
  enabled: boolean;
  priority: number;
  updatedAt: string;
}

const labels: Record<ContextSourceKind, string> = {
  brief: "Brief / 原始需求",
  direction: "Design Direction",
  "asset-plan": "Asset Plan",
  references: "参考素材",
  canvas: "当前画布",
  notes: "画布笔记",
  handoff: "Handoff 约束",
};

export function defaultContextSources(project: ProjectFile): ContextSourcePreference[] {
  const now = new Date().toISOString();
  return (Object.keys(labels) as ContextSourceKind[]).map((kind, index) => ({
    id: `context-${kind}`,
    kind,
    label: labels[kind],
    enabled: true,
    priority: index,
    updatedAt: now,
  }));
}

export function listContextSources(project: ProjectFile): ContextSourcePreference[] {
  const defaults = defaultContextSources(project);
  const saved = new Map((project.contextSources ?? []).map((item) => [item.id, item]));
  return defaults.map((item) => ({ ...item, ...saved.get(item.id) })).sort((a, b) => a.priority - b.priority);
}

export function updateContextSource(project: ProjectFile, id: string, patch: Partial<Pick<ContextSourcePreference, "enabled" | "priority">>): ProjectFile {
  const now = new Date().toISOString();
  const current = listContextSources(project);
  const selected = current.find((item) => item.id === id);
  if (!selected) return project;
  const ordered = current.filter((item) => item.id !== id);
  const target = Math.max(0, Math.min(ordered.length, patch.priority ?? selected.priority));
  ordered.splice(target, 0, { ...selected, ...patch, updatedAt: now });
  const next = ordered.map((item, index) => ({ ...item, priority: index }));
  return { ...project, contextSources: next, updatedAt: now };
}

export function contextSourcesForPrompt(project: ProjectFile): ContextSourcePreference[] {
  return listContextSources(project).filter((item) => item.enabled);
}

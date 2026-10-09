/**
 * 设计快照与语义 diff（纯函数）
 * --------------------------------------------------------------
 * coding agent 写完代码后设计侧又改了图，只告诉它 "changed: true" 没用，
 * 它需要知道：哪屏换图了、哪个 region 挪了 / 没了 / 新增了、哪句文案变了、
 * 哪个素材重生成了、色板动没动。快照只存这些结构化字段，不存图。
 */

import { createHash } from "node:crypto";
import type { ImageAsset } from "@/lib/project/assets-schema";
import type { CopyPlanItem } from "@/lib/project/design-spec-schema";
import type { ProjectFile } from "@/lib/project/schema";
import type { LayoutNode } from "./layout-ir";
import { screenTitle } from "./screens";
import { listSelectableHandoffAssets, pickPrimaryMockup } from "./select-assets";

export interface NodeSnapshot {
  role: string;
  rebuildInCode: boolean;
  bbox: { x: number; y: number; w: number; h: number };
  copy?: string;
  copySource?: string;
  media?: string | null;
  materialAssetId?: string;
  materialSrcHash?: string;
  swatch?: { dominant: string; accent?: string };
}

export interface ScreenSnapshot {
  assetId: string;
  title: string;
  width: number;
  height: number;
  /** 图片内容指纹；变了说明整图被重生成 / 编辑 */
  srcHash: string;
  approval?: string;
  materialized: boolean;
  nodes: Record<string, NodeSnapshot>;
  copyPlan: CopyPlanItem[];
  palette: string[];
}

export interface DesignSnapshot {
  version: 1;
  projectId: string;
  takenAt: string;
  projectUpdatedAt: string;
  /** 内容指纹：相同就不用再存一份 */
  hash: string;
  primaryAssetId?: string;
  palette: string[];
  screens: Record<string, ScreenSnapshot>;
}

export function takeDesignSnapshot(project: ProjectFile, now = new Date()): DesignSnapshot {
  const assetById = new Map((project.assets ?? []).map((a) => [a.id, a]));
  const screens: Record<string, ScreenSnapshot> = {};
  for (const asset of listSelectableHandoffAssets(project)) {
    screens[asset.id] = snapshotScreen(project, asset, assetById);
  }
  const primary = pickPrimaryMockup(project);
  const palette =
    primary?.designSpec?.tokens.colors
      .filter((c) => c.source === "pixels")
      .map((c) => c.value.toUpperCase()) ?? [];
  const body = { screens, palette, primaryAssetId: primary?.id };
  return {
    version: 1,
    projectId: project.id,
    takenAt: now.toISOString(),
    projectUpdatedAt: project.updatedAt,
    hash: createHash("sha1").update(JSON.stringify(body)).digest("hex").slice(0, 16),
    ...body,
  };
}

function snapshotScreen(
  project: ProjectFile,
  asset: ImageAsset,
  assetById: Map<string, ImageAsset>,
): ScreenSnapshot {
  const layout = project.materializations?.[asset.id]?.layout;
  const nodes: Record<string, NodeSnapshot> = {};
  for (const node of layout?.nodes ?? []) nodes[node.id] = snapshotNode(node, assetById);
  return {
    assetId: asset.id,
    title: screenTitle(asset),
    width: asset.width,
    height: asset.height,
    srcHash: hashSrc(asset.src),
    approval: asset.approval?.status,
    materialized: Boolean(layout),
    nodes,
    copyPlan: asset.copyPlan ?? asset.designSpec?.copyPlan ?? [],
    palette:
      asset.designSpec?.tokens.colors
        .filter((c) => c.source === "pixels")
        .map((c) => c.value.toUpperCase()) ?? [],
  };
}

function snapshotNode(node: LayoutNode, assetById: Map<string, ImageAsset>): NodeSnapshot {
  const base: NodeSnapshot = {
    role: node.role,
    rebuildInCode: node.rebuildInCode,
    bbox: { x: r3(node.bbox.x), y: r3(node.bbox.y), w: r3(node.bbox.w), h: r3(node.bbox.h) },
    swatch: node.swatch
      ? { dominant: node.swatch.dominant, accent: node.swatch.accent }
      : undefined,
  };
  if (node.rebuildInCode === false) {
    const material = node.materialAssetId ? assetById.get(node.materialAssetId) : undefined;
    return {
      ...base,
      media: node.media ?? null,
      materialAssetId: node.materialAssetId,
      materialSrcHash: material?.src ? hashSrc(material.src) : undefined,
    };
  }
  return { ...base, copy: node.copy, copySource: node.copySource };
}

/** data URL 可能有几 MB；取长度 + 头尾各 2KB 足够判断是否换图 */
export function hashSrc(src: string): string {
  const h = createHash("sha1");
  h.update(String(src.length));
  h.update(src.slice(0, 2048));
  h.update(src.slice(-2048));
  return h.digest("hex").slice(0, 12);
}

// ───────────────────────── diff ─────────────────────────

export type ChangeKind =
  | "image-regenerated"
  | "approval"
  | "layout-added"
  | "layout-removed"
  | "node-added"
  | "node-removed"
  | "node-moved"
  | "node-resized"
  | "node-role"
  | "node-build-mode"
  | "copy"
  | "copy-plan"
  | "material-regenerated"
  | "material-path"
  | "swatch"
  | "palette";

export type ScreenImpact = "rebuild" | "relayout" | "restyle" | "copy-only" | "none";

export interface DesignChange {
  kind: ChangeKind;
  nodeId?: string;
  before?: unknown;
  after?: unknown;
  note: string;
}

export interface ScreenChanges {
  assetId: string;
  title: string;
  impact: ScreenImpact;
  changes: DesignChange[];
}

export interface DesignChanges {
  baselineTakenAt: string;
  currentTakenAt: string;
  addedScreens: Array<{ assetId: string; title: string }>;
  removedScreens: Array<{ assetId: string; title: string }>;
  changedScreens: ScreenChanges[];
  unchangedScreens: string[];
  palette?: { before: string[]; after: string[] };
  summary: string[];
}

/** bbox 位置 / 尺寸变化超过这个比例才算"动了"（Vision 重跑本身有抖动） */
const MOVE_EPS = 0.02;

export function diffDesignSnapshots(before: DesignSnapshot, after: DesignSnapshot): DesignChanges {
  const addedScreens: DesignChanges["addedScreens"] = [];
  const removedScreens: DesignChanges["removedScreens"] = [];
  const changedScreens: ScreenChanges[] = [];
  const unchangedScreens: string[] = [];

  for (const [id, cur] of Object.entries(after.screens)) {
    const prev = before.screens[id];
    if (!prev) {
      addedScreens.push({ assetId: id, title: cur.title });
      continue;
    }
    const changes = diffScreen(prev, cur);
    if (changes.length === 0) {
      unchangedScreens.push(id);
    } else {
      changedScreens.push({ assetId: id, title: cur.title, impact: impactOf(changes), changes });
    }
  }
  for (const [id, prev] of Object.entries(before.screens)) {
    if (!after.screens[id]) removedScreens.push({ assetId: id, title: prev.title });
  }

  const palette =
    !sameList(before.palette, after.palette) && (before.palette.length || after.palette.length)
      ? { before: before.palette, after: after.palette }
      : undefined;

  const summary: string[] = [];
  if (addedScreens.length)
    summary.push(
      `${addedScreens.length} new screen(s): ${addedScreens.map((s) => s.title).join(", ")}.`,
    );
  if (removedScreens.length)
    summary.push(
      `${removedScreens.length} screen(s) removed: ${removedScreens.map((s) => s.title).join(", ")}.`,
    );
  for (const s of changedScreens) {
    summary.push(`${s.title} (${s.assetId}) → ${s.impact}: ${s.changes.length} change(s).`);
  }
  if (palette)
    summary.push(
      `Project palette changed (${palette.before.length} → ${palette.after.length} colors); re-check tokens.`,
    );
  if (!summary.length) summary.push("No design changes since the baseline.");

  return {
    baselineTakenAt: before.takenAt,
    currentTakenAt: after.takenAt,
    addedScreens,
    removedScreens,
    changedScreens,
    unchangedScreens,
    palette,
    summary,
  };
}

function diffScreen(prev: ScreenSnapshot, cur: ScreenSnapshot): DesignChange[] {
  const out: DesignChange[] = [];

  if (prev.srcHash !== cur.srcHash) {
    out.push({
      kind: "image-regenerated",
      note: "The mockup image itself changed (regenerated or edited). Re-read get_asset_image and the region table before touching code.",
    });
  }
  if ((prev.approval ?? "") !== (cur.approval ?? "")) {
    out.push({
      kind: "approval",
      before: prev.approval,
      after: cur.approval,
      note: "Approval status changed.",
    });
  }
  if (!prev.materialized && cur.materialized) {
    out.push({
      kind: "layout-added",
      note: "Layout IR now exists — regions and materials are authoritative from here on.",
    });
  } else if (prev.materialized && !cur.materialized) {
    out.push({
      kind: "layout-removed",
      note: "Layout IR was removed; fall back to the mockup image.",
    });
  }

  for (const [nodeId, curNode] of Object.entries(cur.nodes)) {
    const prevNode = prev.nodes[nodeId];
    if (!prevNode) {
      out.push({
        kind: "node-added",
        nodeId,
        after: curNode,
        note: `New ${curNode.rebuildInCode ? "code" : "media"} region "${nodeId}" (${curNode.role}) — implement it.`,
      });
      continue;
    }
    out.push(...diffNode(nodeId, prevNode, curNode));
  }
  for (const nodeId of Object.keys(prev.nodes)) {
    if (!cur.nodes[nodeId]) {
      out.push({
        kind: "node-removed",
        nodeId,
        before: prev.nodes[nodeId],
        note: `Region "${nodeId}" was removed — delete its UI.`,
      });
    }
  }

  const planDiff = diffCopyPlan(prev.copyPlan, cur.copyPlan);
  if (planDiff) out.push(planDiff);

  if (!sameList(prev.palette, cur.palette) && (prev.palette.length || cur.palette.length)) {
    out.push({
      kind: "palette",
      before: prev.palette,
      after: cur.palette,
      note: "Screen palette changed.",
    });
  }
  return out;
}

function diffNode(nodeId: string, a: NodeSnapshot, b: NodeSnapshot): DesignChange[] {
  const out: DesignChange[] = [];
  if (a.rebuildInCode !== b.rebuildInCode) {
    out.push({
      kind: "node-build-mode",
      nodeId,
      before: a.rebuildInCode ? "code" : "media",
      after: b.rebuildInCode ? "code" : "media",
      note: b.rebuildInCode
        ? `"${nodeId}" is now a code region — replace the image with real components.`
        : `"${nodeId}" is now a media region — place the material file instead of components.`,
    });
  }
  if (a.role !== b.role) {
    out.push({
      kind: "node-role",
      nodeId,
      before: a.role,
      after: b.role,
      note: `Role of "${nodeId}" changed.`,
    });
  }
  const moved =
    Math.abs(a.bbox.x - b.bbox.x) > MOVE_EPS || Math.abs(a.bbox.y - b.bbox.y) > MOVE_EPS;
  const resized =
    Math.abs(a.bbox.w - b.bbox.w) > MOVE_EPS || Math.abs(a.bbox.h - b.bbox.h) > MOVE_EPS;
  if (moved) {
    out.push({
      kind: "node-moved",
      nodeId,
      before: a.bbox,
      after: b.bbox,
      note: `"${nodeId}" moved (${pct(a.bbox.x)},${pct(a.bbox.y)} → ${pct(b.bbox.x)},${pct(b.bbox.y)}).`,
    });
  }
  if (resized) {
    out.push({
      kind: "node-resized",
      nodeId,
      before: a.bbox,
      after: b.bbox,
      note: `"${nodeId}" resized (${pct(a.bbox.w)}×${pct(a.bbox.h)} → ${pct(b.bbox.w)}×${pct(b.bbox.h)}).`,
    });
  }
  if ((a.copy ?? "") !== (b.copy ?? "")) {
    out.push({
      kind: "copy",
      nodeId,
      before: a.copy,
      after: b.copy,
      note: `Copy of "${nodeId}" changed${b.copySource === "vision" ? " (source: vision — verify wording)" : ""}.`,
    });
  }
  if (!b.rebuildInCode) {
    if (a.materialSrcHash && b.materialSrcHash && a.materialSrcHash !== b.materialSrcHash) {
      out.push({
        kind: "material-regenerated",
        nodeId,
        note: `Material for "${nodeId}" was regenerated — re-copy ${b.media ?? "the file"} into the repo.`,
      });
    } else if (!a.materialSrcHash && b.materialSrcHash) {
      out.push({
        kind: "material-regenerated",
        nodeId,
        note: `Material for "${nodeId}" is now available at ${b.media ?? "assets/materials"} — replace any placeholder.`,
      });
    }
    if ((a.media ?? null) !== (b.media ?? null) && a.media && b.media) {
      out.push({
        kind: "material-path",
        nodeId,
        before: a.media,
        after: b.media,
        note: `Material path for "${nodeId}" changed.`,
      });
    }
  }
  if (a.swatch?.dominant !== b.swatch?.dominant || a.swatch?.accent !== b.swatch?.accent) {
    if (a.swatch || b.swatch) {
      out.push({
        kind: "swatch",
        nodeId,
        before: a.swatch,
        after: b.swatch,
        note: `Colors of "${nodeId}" changed.`,
      });
    }
  }
  return out;
}

function diffCopyPlan(a: CopyPlanItem[], b: CopyPlanItem[]): DesignChange | null {
  const norm = (list: CopyPlanItem[]) => list.map((c) => `${c.role}:${c.text}`).sort();
  const na = norm(a);
  const nb = norm(b);
  if (sameList(na, nb)) return null;
  const added = nb.filter((x) => !na.includes(x));
  const removed = na.filter((x) => !nb.includes(x));
  return {
    kind: "copy-plan",
    before: removed,
    after: added,
    note: `Copy plan changed: ${added.length} added, ${removed.length} removed. Update the UI text accordingly.`,
  };
}

function impactOf(changes: DesignChange[]): ScreenImpact {
  const kinds = new Set(changes.map((c) => c.kind));
  if (
    kinds.has("image-regenerated") ||
    kinds.has("layout-added") ||
    kinds.has("layout-removed") ||
    kinds.has("node-build-mode")
  ) {
    return "rebuild";
  }
  if (
    kinds.has("node-added") ||
    kinds.has("node-removed") ||
    kinds.has("node-moved") ||
    kinds.has("node-resized") ||
    kinds.has("node-role")
  ) {
    return "relayout";
  }
  if (
    kinds.has("swatch") ||
    kinds.has("palette") ||
    kinds.has("material-regenerated") ||
    kinds.has("material-path")
  ) {
    return "restyle";
  }
  if (kinds.has("copy") || kinds.has("copy-plan")) return "copy-only";
  return "none";
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function r3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

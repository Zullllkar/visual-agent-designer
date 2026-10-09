/**
 * coding agent 的设计变更提案（纯逻辑）
 * --------------------------------------------------------------
 * 开发时经常发现"三栏在手机上放不下"、"这段文案太长"、"这块其实该做成组件"。
 * ask_designer 只能问文字；这里让 agent 提一个结构化的 Layout IR 变更，
 * 在画布 dock 里出一张待批准卡，批准后直接改 IR / 规格并落盘。
 *
 * 只允许无副作用、可回滚的改动：文案、bbox、媒体槽转代码、删槽、加状态、加备注。
 * 不允许"让设计侧生图"——那走 request_asset（要花钱、要审批）。
 */

import { z } from "zod";
import { markMaterialSlotsAsCode } from "@/lib/handoff/layout-ir";
import type { ProjectFile } from "@/lib/project/schema";

const BBoxInput = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0.005).max(1),
  h: z.number().min(0.005).max(1),
});

export const ProposalChangeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("copy"),
    slotId: z.string().min(1),
    copy: z.string().min(1).max(400),
  }),
  z.object({
    kind: z.literal("bbox"),
    slotId: z.string().min(1),
    bbox: BBoxInput,
  }),
  z.object({
    kind: z.literal("convert-to-code"),
    slotId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("remove-slot"),
    slotId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("add-state"),
    slotId: z.string().min(1),
    state: z.object({
      name: z.string().min(1).max(32),
      notes: z.string().min(1).max(240),
      copy: z.string().max(160).optional(),
    }),
  }),
  z.object({
    kind: z.literal("note"),
    slotId: z.string().min(1).optional(),
    text: z.string().min(1).max(600),
  }),
]);

export type ProposalChange = z.infer<typeof ProposalChangeSchema>;

export interface DesignProposalInput {
  assetId: string;
  change: ProposalChange;
  rationale: string;
}

export type ApplyProposalResult =
  | { ok: true; project: ProjectFile; summary: string }
  | { ok: false; error: string };

/** 一句话描述，给 dock 卡片和 get_request 用 */
export function describeProposal(p: DesignProposalInput): string {
  const c = p.change;
  switch (c.kind) {
    case "copy":
      return `Change copy of "${c.slotId}" to "${c.copy}"`;
    case "bbox":
      return `Move / resize "${c.slotId}" to x=${pct(c.bbox.x)} y=${pct(c.bbox.y)} w=${pct(c.bbox.w)} h=${pct(c.bbox.h)}`;
    case "convert-to-code":
      return `Build "${c.slotId}" in code instead of placing a material image`;
    case "remove-slot":
      return `Remove region "${c.slotId}" from the layout`;
    case "add-state":
      return `Add state "${c.state.name}" to "${c.slotId}"`;
    case "note":
      return c.slotId ? `Note on "${c.slotId}": ${c.text}` : `Note: ${c.text}`;
  }
}

export function applyProposalToProject(project: ProjectFile, p: DesignProposalInput): ApplyProposalResult {
  const record = project.materializations?.[p.assetId];
  const asset = (project.assets ?? []).find((a) => a.id === p.assetId);
  if (!asset) return { ok: false, error: `No asset ${p.assetId} in project ${project.id}.` };

  const c = p.change;
  const now = new Date().toISOString();
  const tag = `[coding agent] ${p.rationale.trim()}`;

  // note 可以没有 Layout IR：落到 designSpec.implementationNotes
  if (c.kind === "note" && !record) {
    if (!asset.designSpec) {
      return { ok: false, error: `Asset ${p.assetId} has neither a Layout IR nor a design spec to attach the note to.` };
    }
    const next: ProjectFile = {
      ...project,
      updatedAt: now,
      assets: (project.assets ?? []).map((a) =>
        a.id === asset.id && a.designSpec
          ? {
              ...a,
              designSpec: {
                ...a.designSpec,
                implementationNotes: [...a.designSpec.implementationNotes, `${c.text} — ${tag}`],
                updatedAt: now,
              },
            }
          : a
      ),
    };
    return { ok: true, project: next, summary: `Added note to spec of ${p.assetId}.` };
  }

  if (!record) {
    return { ok: false, error: `Asset ${p.assetId} has no Layout IR; only "note" proposals are possible before materialize.` };
  }
  const node = "slotId" in c && c.slotId ? record.layout.nodes.find((n) => n.id === c.slotId) : undefined;
  if ("slotId" in c && c.slotId && !node) {
    return {
      ok: false,
      error: `No node "${c.slotId}" in the Layout IR of ${p.assetId}. Available: ${record.layout.nodes.map((n) => n.id).join(", ")}`,
    };
  }

  let nextRecord = record;
  let summary = "";

  switch (c.kind) {
    case "copy": {
      if (!node || node.rebuildInCode !== true) {
        return { ok: false, error: `"${c.slotId}" is a media region; copy applies to code regions only.` };
      }
      nextRecord = mapNode(record, c.slotId, (n) =>
        n.rebuildInCode === true
          ? { ...n, copy: c.copy, copySource: "plan" as const, copyObserved: n.copy !== c.copy ? n.copy : n.copyObserved, notes: appendNote(n.notes, tag) }
          : n
      );
      summary = `Copy of "${c.slotId}" is now "${c.copy}" (authoritative).`;
      break;
    }
    case "bbox": {
      const bbox = clampBBox(c.bbox);
      nextRecord = mapNode(record, c.slotId, (n) => ({ ...n, bbox, notes: appendNote(n.notes, tag) }));
      summary = `"${c.slotId}" moved to ${pct(bbox.x)},${pct(bbox.y)} ${pct(bbox.w)}×${pct(bbox.h)}.`;
      break;
    }
    case "convert-to-code": {
      if (!node || node.rebuildInCode !== false) {
        return { ok: false, error: `"${c.slotId}" is already a code region.` };
      }
      nextRecord = markMaterialSlotsAsCode(record, [c.slotId]);
      nextRecord = mapNode(nextRecord, c.slotId, (n) => ({ ...n, notes: appendNote(n.notes, tag) }));
      summary = `"${c.slotId}" is now a code region; the material image is no longer required.`;
      break;
    }
    case "remove-slot": {
      nextRecord = {
        ...record,
        updatedAt: now,
        layout: { ...record.layout, nodes: record.layout.nodes.filter((n) => n.id !== c.slotId) },
      };
      summary = `Region "${c.slotId}" removed from the layout.`;
      break;
    }
    case "add-state": {
      if (!node || node.rebuildInCode !== true) {
        return { ok: false, error: `"${c.slotId}" is a media region; states apply to code regions only.` };
      }
      nextRecord = mapNode(record, c.slotId, (n) => {
        if (n.rebuildInCode !== true) return n;
        const states = (n.states ?? []).filter((s) => s.name !== c.state.name);
        return { ...n, states: [...states, c.state] };
      });
      summary = `State "${c.state.name}" added to "${c.slotId}".`;
      break;
    }
    case "note": {
      if (c.slotId) {
        nextRecord = mapNode(record, c.slotId, (n) => ({ ...n, notes: appendNote(n.notes, `${c.text} — ${tag}`) }));
        summary = `Note attached to "${c.slotId}".`;
      } else {
        nextRecord = {
          ...record,
          updatedAt: now,
          layout: {
            ...record.layout,
            meta: {
              source: record.layout.meta?.source ?? "heuristic",
              createdAt: record.layout.meta?.createdAt ?? now,
              warnings: [...(record.layout.meta?.warnings ?? []), `${c.text} — ${tag}`],
            },
          },
        };
        summary = "Note attached to the layout.";
      }
      break;
    }
  }

  const next: ProjectFile = {
    ...project,
    updatedAt: now,
    materializations: { ...(project.materializations ?? {}), [p.assetId]: { ...nextRecord, updatedAt: now } },
  };
  return { ok: true, project: next, summary };
}

type Record_ = NonNullable<ProjectFile["materializations"]>[string];
type Node_ = Record_["layout"]["nodes"][number];

function mapNode(record: Record_, slotId: string, fn: (n: Node_) => Node_): Record_ {
  return {
    ...record,
    layout: { ...record.layout, nodes: record.layout.nodes.map((n) => (n.id === slotId ? fn(n) : n)) },
  };
}

function appendNote(existing: string | undefined, add: string): string {
  return existing ? `${existing}\n${add}` : add;
}

function clampBBox(b: { x: number; y: number; w: number; h: number }) {
  const x = round4(Math.max(0, Math.min(1, b.x)));
  const y = round4(Math.max(0, Math.min(1, b.y)));
  return {
    x,
    y,
    w: round4(Math.min(b.w, 1 - x)),
    h: round4(Math.min(b.h, 1 - y)),
  };
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

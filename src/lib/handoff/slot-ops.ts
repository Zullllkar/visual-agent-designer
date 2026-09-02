/**
 * 物料化槽位操作（纯函数，便于单测）
 * Vision 拆解 + 人工修正：加槽 / 删槽 / 改 prompt / media↔code
 */

import { nanoid } from "nanoid";
import type { ProjectFile } from "@/lib/project/schema";
import {
  assignLayoutHints,
  buildMaterialPromptForSlot,
  countReadyMaterials,
  markMaterialSlotsAsCode,
  type BBox,
  type CodeSlot,
  type LayoutNode,
  type MaterializationRecord,
  type MaterialSlot,
} from "./layout-ir";
import { suggestGenMode, type MaterialGenMode, type MaterialOutputSpec } from "./material-gen-mode";

const MEDIA_ROLES = new Set<MaterialSlot["role"]>([
  "hero",
  "illustration",
  "background",
  "avatar",
  "icon",
  "decoration",
  "other",
]);

const CODE_ROLES = new Set<CodeSlot["role"]>([
  "nav",
  "cta",
  "form",
  "footer",
  "card",
  "sidebar",
  "main",
  "other",
]);

export function clampBBox(bbox: BBox): BBox {
  const x = clamp01(bbox.x);
  const y = clamp01(bbox.y);
  const w = Math.max(0.02, clamp01(bbox.w));
  const h = Math.max(0.02, clamp01(bbox.h));
  return {
    x,
    y,
    w: Math.min(w, 1 - x),
    h: Math.min(h, 1 - y),
  };
}

/** 更新槽位 bbox；媒体槽会清除 crop / 材料绑定（需再生成） */
export function applySlotBBoxes(
  project: ProjectFile,
  mockupAssetId: string,
  updates: Array<{ slotId: string; bbox: BBox }>
): { project: ProjectFile; record: MaterializationRecord; changedSlotIds: string[] } {
  const existing = project.materializations?.[mockupAssetId];
  if (!existing) {
    throw new Error(`no materialization for ${mockupAssetId}`);
  }
  const byId = new Map(updates.map((u) => [u.slotId, clampBBox(u.bbox)]));
  const changedSlotIds: string[] = [];
  const now = new Date().toISOString();

  const nodes = existing.layout.nodes.map((node) => {
    const nextBBox = byId.get(node.id);
    if (!nextBBox) return node;
    const same =
      approx(node.bbox.x, nextBBox.x) &&
      approx(node.bbox.y, nextBBox.y) &&
      approx(node.bbox.w, nextBBox.w) &&
      approx(node.bbox.h, nextBBox.h);
    if (same) return node;
    changedSlotIds.push(node.id);
    if (node.rebuildInCode === false) {
      return {
        ...node,
        bbox: nextBBox,
        cropPreviewSrc: undefined,
        materialAssetId: undefined,
        media: undefined,
        status: "pending" as const,
        notes: [node.notes, "bbox adjusted — regenerate"].filter(Boolean).join(" | "),
      };
    }
    return { ...node, bbox: nextBBox };
  });

  const record: MaterializationRecord = {
    ...existing,
    updatedAt: now,
    layout: { ...existing.layout, nodes },
  };

  return {
    record,
    changedSlotIds,
    project: {
      ...project,
      materializations: {
        ...(project.materializations ?? {}),
        [mockupAssetId]: record,
      },
      updatedAt: now,
    },
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function approx(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.0005;
}

export function applyMarkSlotsAsCode(
  project: ProjectFile,
  mockupAssetId: string,
  slotIds: string[]
): { project: ProjectFile; record: MaterializationRecord } {
  const existing = project.materializations?.[mockupAssetId];
  if (!existing) {
    throw new Error(`no materialization for ${mockupAssetId}`);
  }
  const record = markMaterialSlotsAsCode(existing, slotIds);
  return withUpdatedRecord(project, mockupAssetId, record, slotIds);
}

/** 人工：在 bbox 处新增媒体槽 */
export function applyAddMediaSlot(
  project: ProjectFile,
  mockupAssetId: string,
  input: {
    bbox: BBox;
    name?: string;
    role?: MaterialSlot["role"];
    prompt?: string;
  }
): { project: ProjectFile; record: MaterializationRecord; slotId: string } {
  const existing = requireRecord(project, mockupAssetId);
  const mockup = (project.assets ?? []).find((a) => a.id === mockupAssetId);
  const slotId = `manual-${nanoid(6)}`;
  const role = input.role ?? "illustration";
  const name = input.name?.trim() || "Manual media";
  const prompt =
    input.prompt?.trim() ||
    buildMaterialPromptForSlot({
      role,
      regionName: name,
      styleLock: existing.styleLock,
      mockupPrompt: mockup?.prompt ?? "",
    });
  const bbox = clampBBox(input.bbox);
  const plan = suggestGenMode({ role, bbox, prompt });
  const node: MaterialSlot = {
    id: slotId,
    parentAssetId: mockupAssetId,
    role,
    bbox,
    rebuildInCode: false,
    prompt,
    status: "pending",
    notes: "Added manually",
    genMode: plan.genMode,
    outputSpec: plan.outputSpec,
    genModeConfidence: plan.confidence,
    genModeReasons: plan.reasons,
  };
  const nodes = assignLayoutHints([...existing.layout.nodes, node]);
  const record: MaterializationRecord = {
    ...existing,
    updatedAt: new Date().toISOString(),
    layout: {
      ...existing.layout,
      nodes,
      meta: {
        ...(existing.layout.meta ?? {
          source: "mixed",
          createdAt: existing.createdAt,
        }),
        source:
          existing.layout.meta?.source === "vision" ? "mixed" : existing.layout.meta?.source ?? "mixed",
        createdAt: existing.layout.meta?.createdAt ?? existing.createdAt,
        warnings: [
          ...(existing.layout.meta?.warnings ?? []),
          `人工新增媒体槽 ${slotId}`,
        ],
      },
    },
  };
  return {
    slotId,
    ...withUpdatedRecord(project, mockupAssetId, record),
  };
}

/** 人工：删除槽位 */
export function applyRemoveSlots(
  project: ProjectFile,
  mockupAssetId: string,
  slotIds: string[]
): { project: ProjectFile; record: MaterializationRecord } {
  const existing = requireRecord(project, mockupAssetId);
  const wanted = new Set(slotIds);
  const nodes = existing.layout.nodes.filter((n) => !wanted.has(n.id));
  if (nodes.length === existing.layout.nodes.length) {
    return { project, record: existing };
  }
  const record: MaterializationRecord = {
    ...existing,
    updatedAt: new Date().toISOString(),
    layout: {
      ...existing.layout,
      nodes: assignLayoutHints(nodes),
    },
  };
  return withUpdatedRecord(project, mockupAssetId, record, slotIds);
}

/** 人工：改写媒体槽 prompt */
export function applyUpdateSlotPrompt(
  project: ProjectFile,
  mockupAssetId: string,
  slotId: string,
  prompt: string
): { project: ProjectFile; record: MaterializationRecord } {
  const existing = requireRecord(project, mockupAssetId);
  const nextPrompt = prompt.trim();
  if (!nextPrompt) throw new Error("prompt_empty");
  const nodes = existing.layout.nodes.map((node) => {
    if (node.id !== slotId || node.rebuildInCode !== false) return node;
    const plan = suggestGenMode({
      role: node.role,
      bbox: node.bbox,
      prompt: nextPrompt,
    });
    return {
      ...node,
      prompt: nextPrompt,
      status: "pending" as const,
      materialAssetId: undefined,
      media: undefined,
      // 用户改 prompt 后重新建议 mode（若未手动锁死可覆盖）
      genMode: plan.genMode,
      outputSpec: plan.outputSpec,
      genModeConfidence: plan.confidence,
      genModeReasons: plan.reasons,
      notes: [node.notes, "prompt edited"].filter(Boolean).join(" | "),
    };
  });
  const record: MaterializationRecord = {
    ...existing,
    updatedAt: new Date().toISOString(),
    layout: { ...existing.layout, nodes },
  };
  return withUpdatedRecord(project, mockupAssetId, record, [slotId]);
}

/** 人工：改写媒体槽 genMode / outputSpec */
export function applyUpdateSlotGenMode(
  project: ProjectFile,
  mockupAssetId: string,
  slotId: string,
  input: {
    genMode: MaterialGenMode;
    outputSpec?: Partial<MaterialOutputSpec>;
  }
): { project: ProjectFile; record: MaterializationRecord } {
  const existing = requireRecord(project, mockupAssetId);
  const nodes = existing.layout.nodes.map((node) => {
    if (node.id !== slotId || node.rebuildInCode !== false) return node;
    const base =
      node.outputSpec ??
      suggestGenMode({
        role: node.role,
        bbox: node.bbox,
        prompt: node.prompt,
      }).outputSpec;
    const nextSpec = {
      alpha: input.outputSpec?.alpha ?? base.alpha,
      tileable: input.outputSpec?.tileable ?? base.tileable,
      bleed: input.outputSpec?.bleed ?? base.bleed,
    };
    const noteBits = [
      node.genMode !== input.genMode ? `genMode → ${input.genMode}` : "",
      input.outputSpec
        ? `outputSpec α=${nextSpec.alpha ? 1 : 0} tile=${nextSpec.tileable ? 1 : 0} bleed=${nextSpec.bleed}`
        : "",
    ].filter(Boolean);
    return {
      ...node,
      genMode: input.genMode,
      outputSpec: nextSpec,
      genModeConfidence: 1,
      genModeReasons: ["user-override"],
      status: "pending" as const,
      materialAssetId: undefined,
      media: undefined,
      notes: [node.notes, ...noteBits].filter(Boolean).join(" | "),
    };
  });
  const record: MaterializationRecord = {
    ...existing,
    updatedAt: new Date().toISOString(),
    layout: { ...existing.layout, nodes },
  };
  return withUpdatedRecord(project, mockupAssetId, record, [slotId]);
}

/** 人工：在 bbox 处新增代码槽 */
export function applyAddCodeSlot(
  project: ProjectFile,
  mockupAssetId: string,
  input: {
    bbox: BBox;
    name?: string;
    role?: CodeSlot["role"];
    copy?: string;
    suggestedComponent?: string;
  }
): { project: ProjectFile; record: MaterializationRecord; slotId: string } {
  const existing = requireRecord(project, mockupAssetId);
  const slotId = `manual-code-${nanoid(6)}`;
  const role = input.role ?? "other";
  if (!CODE_ROLES.has(role)) {
    throw new Error(`invalid_code_role:${role}`);
  }
  const copy = input.copy?.trim() || input.name?.trim() || "UI chrome";
  const node: CodeSlot = {
    id: slotId,
    role,
    bbox: clampBBox(input.bbox),
    rebuildInCode: true,
    copy,
    suggestedComponent: input.suggestedComponent?.trim() || undefined,
    notes: "Added manually",
  };
  const nodes = assignLayoutHints([...existing.layout.nodes, node]);
  const record: MaterializationRecord = {
    ...existing,
    updatedAt: new Date().toISOString(),
    layout: {
      ...existing.layout,
      nodes,
      meta: {
        ...(existing.layout.meta ?? {
          source: "mixed",
          createdAt: existing.createdAt,
        }),
        source:
          existing.layout.meta?.source === "vision"
            ? "mixed"
            : existing.layout.meta?.source ?? "mixed",
        createdAt: existing.layout.meta?.createdAt ?? existing.createdAt,
        warnings: [
          ...(existing.layout.meta?.warnings ?? []),
          `人工新增代码槽 ${slotId}`,
        ],
      },
    },
  };
  return {
    slotId,
    ...withUpdatedRecord(project, mockupAssetId, record),
  };
}

/** 人工：改写槽位 role（媒体/代码各自合法枚举） */
export function applyUpdateSlotRole(
  project: ProjectFile,
  mockupAssetId: string,
  slotId: string,
  role: string
): { project: ProjectFile; record: MaterializationRecord } {
  const existing = requireRecord(project, mockupAssetId);
  const mockup = (project.assets ?? []).find((a) => a.id === mockupAssetId);
  const nodes = existing.layout.nodes.map((node) => {
    if (node.id !== slotId) return node;
    if (node.rebuildInCode === false) {
      if (!MEDIA_ROLES.has(role as MaterialSlot["role"])) {
        throw new Error(`invalid_media_role:${role}`);
      }
      const nextRole = role as MaterialSlot["role"];
      const nextPrompt =
        node.prompt.trim() ||
        buildMaterialPromptForSlot({
          role: nextRole,
          regionName: node.id,
          styleLock: existing.styleLock,
          mockupPrompt: mockup?.prompt ?? "",
        });
      const plan = suggestGenMode({
        role: nextRole,
        bbox: node.bbox,
        prompt: nextPrompt,
      });
      return {
        ...node,
        role: nextRole,
        status: "pending" as const,
        materialAssetId: undefined,
        media: undefined,
        prompt: nextPrompt,
        genMode: plan.genMode,
        outputSpec: plan.outputSpec,
        genModeConfidence: plan.confidence,
        genModeReasons: plan.reasons,
        notes: [node.notes, `role → ${nextRole}`].filter(Boolean).join(" | "),
      };
    }
    if (!CODE_ROLES.has(role as CodeSlot["role"])) {
      throw new Error(`invalid_code_role:${role}`);
    }
    return {
      ...node,
      role: role as CodeSlot["role"],
      notes: [node.notes, `role → ${role}`].filter(Boolean).join(" | "),
    };
  });
  const record: MaterializationRecord = {
    ...existing,
    updatedAt: new Date().toISOString(),
    layout: { ...existing.layout, nodes },
  };
  return withUpdatedRecord(project, mockupAssetId, record, [slotId]);
}

/** 人工：代码槽 → 媒体槽 */
export function applyMarkSlotsAsMedia(
  project: ProjectFile,
  mockupAssetId: string,
  slotIds: string[]
): { project: ProjectFile; record: MaterializationRecord } {
  const existing = requireRecord(project, mockupAssetId);
  const mockup = (project.assets ?? []).find((a) => a.id === mockupAssetId);
  const wanted = new Set(slotIds);
  const nodes: LayoutNode[] = existing.layout.nodes.map((node) => {
    if (node.rebuildInCode !== true || !wanted.has(node.id)) return node;
    const role: MaterialSlot["role"] = "illustration";
    const prompt = buildMaterialPromptForSlot({
      role,
      regionName: node.copy || node.id,
      notes: node.notes,
      styleLock: existing.styleLock,
      mockupPrompt: mockup?.prompt ?? "",
    });
    const plan = suggestGenMode({
      role,
      bbox: node.bbox,
      prompt,
    });
    return {
      id: node.id,
      parentAssetId: mockupAssetId,
      role,
      bbox: node.bbox,
      rebuildInCode: false as const,
      prompt,
      status: "pending" as const,
      notes: `Converted from code slot (${node.role})`,
      genMode: plan.genMode,
      outputSpec: plan.outputSpec,
      genModeConfidence: plan.confidence,
      genModeReasons: plan.reasons,
    };
  });
  const record: MaterializationRecord = {
    ...existing,
    updatedAt: new Date().toISOString(),
    layout: { ...existing.layout, nodes: assignLayoutHints(nodes) },
  };
  return withUpdatedRecord(project, mockupAssetId, record, slotIds);
}

function requireRecord(
  project: ProjectFile,
  mockupAssetId: string
): MaterializationRecord {
  const existing = project.materializations?.[mockupAssetId];
  if (!existing) throw new Error(`no materialization for ${mockupAssetId}`);
  return existing;
}

function withUpdatedRecord(
  project: ProjectFile,
  mockupAssetId: string,
  record: MaterializationRecord,
  unboundSlotIds: string[] = []
): { project: ProjectFile; record: MaterializationRecord } {
  const now = new Date().toISOString();
  const ready = countReadyMaterials(record.layout);
  const mediaLeft = record.layout.nodes.filter(
    (n) => n.rebuildInCode === false
  ).length;
  const unbound = new Set(unboundSlotIds);

  return {
    record,
    project: {
      ...project,
      materializations: {
        ...(project.materializations ?? {}),
        [mockupAssetId]: record,
      },
      assets: (project.assets ?? []).map((asset) => {
        if (asset.id !== mockupAssetId) {
          if (
            unbound.size &&
            asset.parentAssetId === mockupAssetId &&
            asset.materialSlotId &&
            unbound.has(asset.materialSlotId)
          ) {
            return {
              ...asset,
              materialSlotId: undefined,
              status: asset.status === "starred" ? "candidate" : asset.status,
            };
          }
          return asset;
        }
        return {
          ...asset,
          approval: {
            status:
              ready > 0 || mediaLeft === 0
                ? ("materials_ready" as const)
                : ("materializing" as const),
            approvedAt: asset.approval?.approvedAt ?? now,
            layoutId: mockupAssetId,
          },
        };
      }),
      updatedAt: now,
    },
  };
}

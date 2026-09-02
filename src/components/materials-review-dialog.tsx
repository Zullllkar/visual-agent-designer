"use client";

/**
 * 素材确认面板（规格 Step C）
 * Vision 拆解 + 人工修正：叠框 / 手动画框加槽 / 改 prompt / 标代码·媒体
 * 确认后再走 JobScheduler 生图
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Code2,
  ImagePlus,
  Layers,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

type SlotFilter = "all" | "media" | "code" | "pending";
import type { ProjectFile } from "@/lib/project/schema";
import type { ImageAsset } from "@/lib/project/assets-schema";
import type {
  BBox,
  CodeSlot,
  LayoutNode,
  MaterializationRecord,
  MaterialSlot,
} from "@/lib/handoff/layout-ir";
import { clampBBox } from "@/lib/handoff/slot-ops";
import { composeMaterialGenerationPrompt } from "@/lib/handoff/material-prompt";
import {
  suggestGenMode,
  type MaterialGenMode,
  type MaterialOutputSpec,
} from "@/lib/handoff/material-gen-mode";
import { estimateMaterializeCostUsd } from "@/lib/handoff/materialize-cost";
import {
  countMediaSlots,
  countReadyMaterials,
  type StyleLock,
} from "@/lib/handoff/layout-ir";
import type { ProviderConfig } from "@/lib/providers/registry";
import {
  ImageLightbox,
  PreviewableThumb,
  type ImageLightboxItem,
} from "@/components/image-lightbox";

type DragMode = "move" | "resize-se";

const BLEED_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "0% · 无出血" },
  { value: 0.01, label: "1%" },
  { value: 0.02, label: "2%" },
  { value: 0.03, label: "3%" },
  { value: 0.05, label: "5%" },
  { value: 0.1, label: "10%" },
];

const GEN_MODE_OPTIONS: {
  value: MaterialGenMode;
  label: string;
}[] = [
  { value: "slice", label: "slice · 直接裁切（不调模型）" },
  { value: "refine", label: "refine · 裁切精修（像素锚定）" },
  { value: "regenerate", label: "regenerate · 文本重绘（少用）" },
];

const MEDIA_ROLE_OPTIONS: { value: MaterialSlot["role"]; label: string }[] = [
  { value: "hero", label: "hero · 主视觉/首屏大图" },
  { value: "illustration", label: "illustration · 插画/场景图" },
  { value: "background", label: "background · 背景/纹理" },
  { value: "avatar", label: "avatar · 头像/人像" },
  { value: "icon", label: "icon · 图标/Logo" },
  { value: "decoration", label: "decoration · 装饰零件" },
  { value: "other", label: "other · 其它媒体" },
];

const CODE_ROLE_OPTIONS: { value: CodeSlot["role"]; label: string }[] = [
  { value: "nav", label: "nav · 导航栏" },
  { value: "cta", label: "cta · 行动按钮" },
  { value: "form", label: "form · 表单/输入" },
  { value: "footer", label: "footer · 页脚" },
  { value: "card", label: "card · 卡片容器" },
  { value: "sidebar", label: "sidebar · 侧栏" },
  { value: "main", label: "main · 主内容区" },
  { value: "other", label: "other · 其它代码槽" },
];

type PendingAdd = {
  bbox: BBox;
  kind: "media" | "code";
  role: string;
  name: string;
};

type ConfirmState = {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  run: () => Promise<void> | void;
};

export function MaterialsReviewDialog({
  project,
  mockupAssetId,
  providerConfig,
  onProjectUpdate,
  onClose,
  onExportHandoff,
}: {
  project: ProjectFile;
  mockupAssetId: string;
  providerConfig: ProviderConfig;
  onProjectUpdate: (project: ProjectFile) => void;
  onClose: () => void;
  onExportHandoff?: () => void;
}) {
  const mockup = (project.assets ?? []).find((a) => a.id === mockupAssetId);
  const record = project.materializations?.[mockupAssetId];
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [busySlotId, setBusySlotId] = useState<string | null>(null);
  const [jobBusy, setJobBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftBBoxes, setDraftBBoxes] = useState<Record<string, BBox>>({});
  const [drawAddMode, setDrawAddMode] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState("");
  const [slotFilter, setSlotFilter] = useState<SlotFilter>("all");
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [pendingAdd, setPendingAdd] = useState<PendingAdd | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [hoverSlotId, setHoverSlotId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImageLightboxItem | null>(null);

  const assetById = useMemo(() => {
    const map = new Map<string, ImageAsset>();
    for (const a of project.assets ?? []) map.set(a.id, a);
    return map;
  }, [project.assets]);

  const flash = useCallback((msg: string) => {
    setToast(msg);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    setDraftBBoxes({});
    setCheckedIds([]);
    setPendingAdd(null);
    setZoom(1);
  }, [record?.updatedAt]);

  useEffect(() => {
    const node = record?.layout.nodes.find((n) => n.id === selectedSlotId);
    if (node && node.rebuildInCode === false) {
      setDraftPrompt(node.prompt);
    } else {
      setDraftPrompt("");
    }
  }, [selectedSlotId, record?.updatedAt, record?.layout.nodes]);

  const nodeIds = useMemo(
    () => record?.layout.nodes.map((n) => n.id) ?? [],
    [record?.layout.nodes]
  );

  const liveRef = useRef({
    activeId: null as string | null,
    nodeIds: [] as string[],
    checkedIds: [] as string[],
    confirm: null as ConfirmState | null,
    pendingAdd: null as PendingAdd | null,
    drawAddMode: false,
    jobBusy: false,
    nodes: [] as LayoutNode[],
    draftBBoxes: {} as Record<string, BBox>,
  });
  liveRef.current.nodeIds = nodeIds;
  liveRef.current.checkedIds = checkedIds;
  liveRef.current.confirm = confirm;
  liveRef.current.pendingAdd = pendingAdd;
  liveRef.current.drawAddMode = drawAddMode;
  liveRef.current.jobBusy = jobBusy;
  liveRef.current.nodes = record?.layout.nodes ?? [];
  liveRef.current.draftBBoxes = draftBBoxes;
  liveRef.current.activeId =
    selectedSlotId ??
    record?.layout.nodes.find((n) => n.rebuildInCode === false)?.id ??
    record?.layout.nodes[0]?.id ??
    null;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const typing =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (e.target as HTMLElement | null)?.isContentEditable;
      if (typing) {
        if (e.key === "Escape") (e.target as HTMLElement).blur();
        return;
      }
      const live = liveRef.current;
      if (e.key === "Escape") {
        if (live.confirm) {
          setConfirm(null);
          return;
        }
        if (live.pendingAdd) {
          setPendingAdd(null);
          return;
        }
        if (live.drawAddMode) {
          setDrawAddMode(false);
          return;
        }
        if (live.checkedIds.length) {
          setCheckedIds([]);
          return;
        }
        return;
      }
      if (live.confirm || live.pendingAdd || live.jobBusy) return;
      if (e.key === "d" || e.key === "D") {
        e.preventDefault();
        setDrawAddMode((v) => !v);
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        const ids =
          live.checkedIds.length > 0
            ? live.checkedIds
            : live.activeId
              ? [live.activeId]
              : [];
        if (!ids.length) return;
        e.preventDefault();
        setConfirm({
          title: ids.length > 1 ? `删除 ${ids.length} 个槽位` : "删除槽位",
          body: "删除后需重新拆解或手动画框才能恢复，确认继续？",
          confirmLabel: "确认删除",
          danger: true,
          run: async () => {
            setBusySlotId(ids[0] ?? null);
            setError(null);
            try {
              const res = await fetch("/api/agents/materialize", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  projectId: project.id,
                  assetId: mockupAssetId,
                  providerConfig,
                  removeSlotIds: ids,
                  async: false,
                }),
              });
              const data = await res.json();
              if (!res.ok) {
                throw new Error(
                  data?.message || data?.error || `HTTP ${res.status}`
                );
              }
              if (data.project) onProjectUpdate(data.project as ProjectFile);
              setSelectedSlotId((cur) =>
                cur && ids.includes(cur) ? null : cur
              );
              setCheckedIds((prev) => prev.filter((id) => !ids.includes(id)));
              setToast(`已删除 ${ids.length} 个槽位`);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusySlotId(null);
            }
          },
        });
        return;
      }
      if (e.key === "[" || e.key === "]") {
        if (!live.nodeIds.length || !live.activeId) return;
        e.preventDefault();
        const idx = live.nodeIds.indexOf(live.activeId);
        if (idx < 0) return;
        const next =
          e.key === "]"
            ? live.nodeIds[(idx + 1) % live.nodeIds.length]
            : live.nodeIds[
                (idx - 1 + live.nodeIds.length) % live.nodeIds.length
              ];
        if (next) setSelectedSlotId(next);
        return;
      }
      const step = e.shiftKey ? 0.02 : 0.005;
      const aid = live.activeId;
      if (!aid) return;
      const node = live.nodes.find((n) => n.id === aid);
      if (!node) return;
      const cur = live.draftBBoxes[aid] ?? node.bbox;
      const applyNudge = (dx: number, dy: number) => {
        setDraftBBoxes((prev) => ({
          ...prev,
          [aid]: clampBBox({ ...cur, x: cur.x + dx, y: cur.y + dy }),
        }));
      };
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        applyNudge(-step, 0);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        applyNudge(step, 0);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        applyNudge(0, -step);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        applyNudge(0, step);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mockupAssetId, onProjectUpdate, project.id, providerConfig]);

  if (!mockup?.src || !record) {
    return (
      <div className="app-dialog-overlay" onClick={onClose}>
        <div
          className="app-dialog max-w-md"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-sm">尚未拆解素材，请先执行「拆解方案」。</p>
          <button
            type="button"
            className="mt-4 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-white"
            onClick={onClose}
          >
            关闭
          </button>
        </div>
      </div>
    );
  }

  const mediaReady = countReadyMaterials(record.layout);
  const mediaTotal = countMediaSlots(record.layout);
  const codeTotal = record.layout.nodes.filter(
    (n) => n.rebuildInCode === true
  ).length;
  const pendingGen = record.layout.nodes.filter(
    (n) =>
      n.rebuildInCode === false &&
      (n.status !== "ready" || !n.materialAssetId)
  ).length;
  const awaitingConfirm = pendingGen > 0 && mediaReady === 0;
  const costHint = estimateMaterializeCostUsd({
    mediaSlotCount: mediaTotal,
    generateSlotCount: Math.max(pendingGen, 0),
  });
  const activeId =
    selectedSlotId ??
    record.layout.nodes.find((n) => n.rebuildInCode === false)?.id ??
    record.layout.nodes[0]?.id ??
    null;
  const dirtySlotIds = Object.keys(draftBBoxes);
  const bboxDirty = dirtySlotIds.length > 0;

  async function pollMaterializeJob(jobId: string) {
    while (true) {
      await new Promise((r) => setTimeout(r, 900));
      const res = await fetch(
        `/api/jobs/${jobId}?projectId=${encodeURIComponent(project.id)}`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
      }
      const job = data.job as {
        status: string;
        error?: string;
        result?: { updatedProject?: ProjectFile };
      };
      if (job.status === "completed") {
        const projectRes = await fetch(`/api/projects/${encodeURIComponent(project.id)}`);
        const projectData = await projectRes.json().catch(() => ({}));
        if (projectData.project) onProjectUpdate(projectData.project as ProjectFile);
        return;
      }
      if (job.status === "failed") {
        throw new Error(job.error || "拆素材任务失败");
      }
      if (job.status === "cancelled") {
        throw new Error("拆素材任务已取消");
      }
    }
  }

  async function callMaterialize(body: Record<string, unknown>) {
    const res = await fetch("/api/agents/materialize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        assetId: mockupAssetId,
        providerConfig,
        ...body,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
    }
    if (data.project) onProjectUpdate(data.project as ProjectFile);
    if (data.job?.jobId) {
      setJobBusy(true);
      try {
        await pollMaterializeJob(data.job.jobId as string);
      } finally {
        setJobBusy(false);
      }
    }
    return data;
  }

  async function redecompose() {
    setJobBusy(true);
    setError(null);
    try {
      const data = await callMaterialize({
        forceDecompose: true,
        skipGeneration: true,
        async: false,
      });
      setDraftBBoxes({});
      if (data.visionOk === false) {
        setError(
          String(
            data.visionError ||
              "Vision 拆解失败，已回退启发式。请确认 LLM 支持看图；若提示 timeout，已自动压缩送图，请再点一次「重新拆解」。"
          )
        );
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setJobBusy(false);
    }
  }

  /** 用户确认拆解方案后，启动全部待生成媒体槽 */
  async function confirmAndGenerate() {
    if (pendingGen <= 0 || jobBusy) return;
    setJobBusy(true);
    setError(null);
    try {
      const bboxUpdates = bboxDirty
        ? dirtySlotIds.map((slotId) => ({
            slotId,
            bbox: draftBBoxes[slotId],
          }))
        : undefined;
      await callMaterialize({
        ...(bboxUpdates ? { bboxUpdates } : {}),
        forceRegen: mediaReady > 0 || Boolean(bboxUpdates?.length),
        skipGeneration: false,
        async: true,
      });
      setDraftBBoxes({});
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setJobBusy(false);
    }
  }

  async function regenSlot(slotId: string) {
    setBusySlotId(slotId);
    setError(null);
    try {
      const updates = draftBBoxes[slotId]
        ? [{ slotId, bbox: draftBBoxes[slotId] }]
        : undefined;
      await callMaterialize({
        slotIds: [slotId],
        forceRegen: true,
        skipGeneration: false,
        async: true,
        ...(updates ? { bboxUpdates: updates } : {}),
      });
      setDraftBBoxes((prev) => {
        const next = { ...prev };
        delete next[slotId];
        return next;
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusySlotId(null);
    }
  }

  async function applyBBoxesOnly() {
    if (!bboxDirty) return;
    setJobBusy(true);
    setError(null);
    try {
      const bboxUpdates = dirtySlotIds.map((slotId) => ({
        slotId,
        bbox: draftBBoxes[slotId],
      }));
      await callMaterialize({
        bboxUpdates,
        skipGeneration: true,
        async: false,
      });
      setDraftBBoxes({});
      flash("框位已应用");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setJobBusy(false);
    }
  }

  async function markCode(slotId: string) {
    setBusySlotId(slotId);
    setError(null);
    try {
      await callMaterialize({ markCodeSlotIds: [slotId], async: false });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusySlotId(null);
    }
  }

  async function markMedia(slotId: string) {
    setBusySlotId(slotId);
    setError(null);
    try {
      await callMaterialize({ markMediaSlotIds: [slotId], async: false });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusySlotId(null);
    }
  }

  async function removeSlots(slotIds: string[]) {
    if (!slotIds.length) return;
    setBusySlotId(slotIds[0] ?? null);
    setError(null);
    try {
      await callMaterialize({ removeSlotIds: slotIds, async: false });
      if (selectedSlotId && slotIds.includes(selectedSlotId)) {
        setSelectedSlotId(null);
      }
      setCheckedIds((prev) => prev.filter((id) => !slotIds.includes(id)));
      flash(`已删除 ${slotIds.length} 个槽位`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusySlotId(null);
    }
  }

  function askRemoveSlots(slotIds: string[]) {
    if (!slotIds.length) return;
    setConfirm({
      title: slotIds.length > 1 ? `删除 ${slotIds.length} 个槽位` : "删除槽位",
      body: "删除后需重新拆解或手动画框才能恢复，确认继续？",
      confirmLabel: "确认删除",
      danger: true,
      run: () => removeSlots(slotIds),
    });
  }

  async function batchMarkCode(slotIds: string[]) {
    if (!slotIds.length) return;
    setJobBusy(true);
    setError(null);
    try {
      await callMaterialize({ markCodeSlotIds: slotIds, async: false });
      setCheckedIds([]);
      flash(`已标为代码 ×${slotIds.length}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setJobBusy(false);
    }
  }

  async function batchMarkMedia(slotIds: string[]) {
    if (!slotIds.length) return;
    setJobBusy(true);
    setError(null);
    try {
      await callMaterialize({ markMediaSlotIds: slotIds, async: false });
      setCheckedIds([]);
      flash(`已标为媒体 ×${slotIds.length}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setJobBusy(false);
    }
  }

  async function savePrompt(slotId: string) {
    if (!draftPrompt.trim()) return;
    setBusySlotId(slotId);
    setError(null);
    try {
      await callMaterialize({
        promptUpdate: { slotId, prompt: draftPrompt.trim() },
        async: false,
      });
      flash("提示词已保存");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusySlotId(null);
    }
  }

  async function saveRole(slotId: string, role: string) {
    setBusySlotId(slotId);
    setError(null);
    try {
      await callMaterialize({
        roleUpdate: { slotId, role },
        async: false,
      });
      flash(`角色已改为 ${role}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusySlotId(null);
    }
  }

  async function saveGenPlan(
    slotId: string,
    genMode: MaterialGenMode,
    outputSpec?: Partial<MaterialOutputSpec>
  ) {
    setBusySlotId(slotId);
    setError(null);
    try {
      await callMaterialize({
        genModeUpdate: { slotId, genMode, outputSpec },
        async: false,
      });
      const bits = [
        `模式 ${genMode}`,
        outputSpec?.alpha !== undefined
          ? `α=${outputSpec.alpha ? "开" : "关"}`
          : "",
        outputSpec?.tileable !== undefined
          ? `平铺=${outputSpec.tileable ? "开" : "关"}`
          : "",
        outputSpec?.bleed !== undefined
          ? `bleed=${Math.round(outputSpec.bleed * 100)}%`
          : "",
      ].filter(Boolean);
      flash(bits.join(" · "));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusySlotId(null);
    }
  }

  function beginAddFromBBox(bbox: BBox) {
    setDrawAddMode(false);
    setPendingAdd({
      bbox: clampBBox(bbox),
      kind: "media",
      role: "illustration",
      name: "",
    });
  }

  async function confirmPendingAdd() {
    if (!pendingAdd) return;
    setJobBusy(true);
    setError(null);
    try {
      const name = pendingAdd.name.trim() || undefined;
      const data =
        pendingAdd.kind === "media"
          ? await callMaterialize({
              addMediaSlot: {
                bbox: pendingAdd.bbox,
                name: name || "Manual media",
                role: pendingAdd.role as MaterialSlot["role"],
              },
              async: false,
            })
          : await callMaterialize({
              addCodeSlot: {
                bbox: pendingAdd.bbox,
                name: name || "UI chrome",
                role: pendingAdd.role as CodeSlot["role"],
                copy: name,
              },
              async: false,
            });
      if (typeof data.slotId === "string") setSelectedSlotId(data.slotId);
      setPendingAdd(null);
      flash(pendingAdd.kind === "media" ? "已添加媒体槽" : "已添加代码槽");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setJobBusy(false);
    }
  }

  function resolveBBox(node: LayoutNode): BBox {
    return draftBBoxes[node.id] ?? node.bbox;
  }

  function selectSlot(id: string, opts?: { toggleCheck?: boolean; additive?: boolean }) {
    setSelectedSlotId(id);
    if (opts?.toggleCheck) {
      setCheckedIds((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      );
      return;
    }
    if (opts?.additive) {
      setCheckedIds((prev) =>
        prev.includes(id) ? prev : [...prev, id]
      );
    }
  }

  function askRedecompose() {
    setConfirm({
      title: "重新 Vision 拆解",
      body: "将覆盖当前槽位方案（未生成的人工调整会丢失）。确认重新拆解？",
      confirmLabel: "重新拆解",
      danger: true,
      run: async () => {
        await redecompose();
        flash("拆解已完成");
      },
    });
  }

  const visionSource = record.layout.meta?.source ?? "unknown";
  const regionCount = record.layout.nodes.length;

  const activeNode = record.layout.nodes.find((n) => n.id === activeId);
  const filterCounts = {
    all: regionCount,
    media: mediaTotal,
    code: codeTotal,
    pending: pendingGen,
  };

  return (
    <div
      className="app-dialog-overlay app-dialog-overlay-workspace"
      onClick={onClose}
    >
      <div
        className="app-dialog app-dialog-workspace"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--border)] pb-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
                <Layers className="size-5 app-accent-text" />
                {awaitingConfirm ? "确认拆解方案" : "审槽 / 素材工作台"}
              </h2>
              <StatusChip
                tone={visionSource === "vision" ? "ok" : "warn"}
                label={
                  visionSource === "vision"
                    ? "Vision 已生效"
                    : `来源 ${visionSource}`
                }
              />
              <StatusChip
                tone="neutral"
                label={`共 ${regionCount} 区`}
              />
              <StatusChip tone="media" label={`媒体 ${mediaTotal}`} />
              <StatusChip tone="code" label={`代码 ${codeTotal}`} />
              <StatusChip
                tone={pendingGen > 0 ? "warn" : "ok"}
                label={
                  pendingGen > 0
                    ? `待生成 ${pendingGen} · ≈$${costHint.estimatedUsd.toFixed(2)}`
                    : `已就绪 ${mediaReady}/${mediaTotal}`
                }
              />
              {jobBusy ? (
                <StatusChip tone="warn" label="后台处理中…" />
              ) : null}
            </div>
            <p className="mt-1.5 text-xs app-subtle">
              {awaitingConfirm
                ? "先核对左侧叠框与右侧槽位/提示词，确认后再生成素材（此时不扣生图费）。"
                : "可拖框调区域 · 手动画框加槽 · 编辑提示词 · 标为代码/媒体"}
              {mockup.width && mockup.height
                ? ` · 原图 ${mockup.width}×${mockup.height}`
                : ""}
            </p>
            {record.layout.meta?.warnings?.length ? (
              <ul className="mt-2 max-h-16 space-y-0.5 overflow-y-auto text-[11px] text-amber-700 dark:text-amber-300">
                {record.layout.meta.warnings.map((w) => (
                  <li key={w}>⚠ {w}</li>
                ))}
              </ul>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 app-subtle transition hover:bg-[var(--surface-muted)]"
            aria-label="关闭"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="mt-3 flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={jobBusy || Boolean(pendingAdd)}
            onClick={() => setDrawAddMode((v) => !v)}
            className={
              "inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium disabled:opacity-50 " +
              (drawAddMode
                ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-800 dark:text-emerald-200"
                : "border-[var(--border)]")
            }
            data-tip="快捷键 D"
          >
            <Plus className="size-3.5" />
            {drawAddMode ? "拖拽画框中…（Esc 取消）" : "画框加槽"}
          </button>
          <button
            type="button"
            disabled={jobBusy}
            onClick={askRedecompose}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 text-xs font-medium disabled:opacity-50"
          >
            {jobBusy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            重新 Vision 拆解
          </button>
          {bboxDirty ? (
            <>
              <button
                type="button"
                disabled={jobBusy}
                onClick={() => void applyBBoxesOnly()}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 text-xs font-medium text-amber-800 disabled:opacity-50 dark:text-amber-200"
              >
                应用已调框位 ({dirtySlotIds.length})
              </button>
              <button
                type="button"
                disabled={jobBusy}
                onClick={() => {
                  setDraftBBoxes({});
                  flash("已丢弃未应用框位");
                }}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 text-xs font-medium disabled:opacity-50"
              >
                <RotateCcw className="size-3.5" />
                丢弃框位
              </button>
            </>
          ) : null}
          {checkedIds.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-[var(--primary)]/30 bg-[var(--primary)]/8 px-2 py-1">
              <span className="text-[11px] font-medium tabular-nums">
                已选 {checkedIds.length}
              </span>
              <button
                type="button"
                disabled={jobBusy}
                onClick={() => void batchMarkCode(checkedIds)}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-[10px] font-medium disabled:opacity-50"
              >
                <Code2 className="size-3" />
                批量标代码
              </button>
              <button
                type="button"
                disabled={jobBusy}
                onClick={() => void batchMarkMedia(checkedIds)}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-[10px] font-medium disabled:opacity-50"
              >
                <ImagePlus className="size-3" />
                批量标媒体
              </button>
              <button
                type="button"
                disabled={jobBusy}
                onClick={() => askRemoveSlots(checkedIds)}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-red-500/30 bg-[var(--background)] px-2 text-[10px] font-medium text-red-600 disabled:opacity-50 dark:text-red-400"
              >
                <Trash2 className="size-3" />
                批量删除
              </button>
              <button
                type="button"
                onClick={() => setCheckedIds([])}
                className="inline-flex h-7 items-center rounded-md px-2 text-[10px] app-subtle"
              >
                清除选择
              </button>
            </div>
          ) : null}
          <div className="ml-auto flex flex-wrap items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)]/40 p-0.5">
            {(
              [
                ["all", "全部"],
                ["media", "媒体"],
                ["code", "代码"],
                ["pending", "待生成"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setSlotFilter(key)}
                className={
                  "inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-[11px] font-medium transition " +
                  (slotFilter === key
                    ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm"
                    : "app-subtle hover:text-[var(--foreground)]")
                }
              >
                {label}
                <span className="tabular-nums opacity-70">
                  {filterCounts[key]}
                </span>
              </button>
            ))}
          </div>
        </div>
        <p className="mt-1.5 shrink-0 text-[10px] app-subtle">
          快捷键：D 画框 · Esc 取消 · Delete 删除 · [ ] 切换槽 · 方向键微调框（Shift 加速）
        </p>

        {awaitingConfirm ? (
          <p className="mt-2 shrink-0 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
            Vision + 人工协同：核对方案 →「确认并生成素材」。生成前可随时改框、加槽、改提示词或标为代码。
          </p>
        ) : null}

        {/* Main workspace: 左叠框 | 右（槽位 + 详情） */}
        <div className="materials-review-main mt-3">
          <div className="flex min-h-0 min-w-0 flex-col gap-2">
            <div className="flex shrink-0 items-center justify-between gap-2">
              <p className="text-[11px] font-medium app-subtle">
                整图叠框
                {drawAddMode
                  ? " · 十字光标拖拽后填写类型"
                  : " · 点选 / 拖动 / 右下角缩放"}
                {hoverSlotId ? ` · 悬停 ${hoverSlotId}` : ""}
              </p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="inline-flex h-7 items-center rounded-md border border-[var(--border)] px-2 text-[10px] font-medium"
                  onClick={() =>
                    setPreview({
                      src: mockup.src,
                      title: `整图 ${mockupAssetId.slice(0, 10)}`,
                      subtitle:
                        mockup.width && mockup.height
                          ? `${mockup.width}×${mockup.height}`
                          : undefined,
                    })
                  }
                >
                  预览整图
                </button>
                <button
                  type="button"
                  className="inline-flex size-7 items-center justify-center rounded-md border border-[var(--border)] disabled:opacity-40"
                  disabled={zoom <= 0.75}
                  onClick={() => setZoom((z) => Math.max(0.75, +(z - 0.25).toFixed(2)))}
                  aria-label="缩小"
                >
                  <ZoomOut className="size-3.5" />
                </button>
                <button
                  type="button"
                  className="inline-flex h-7 min-w-[3rem] items-center justify-center rounded-md border border-[var(--border)] px-1.5 text-[10px] tabular-nums"
                  onClick={() => setZoom(1)}
                >
                  {Math.round(zoom * 100)}%
                </button>
                <button
                  type="button"
                  className="inline-flex size-7 items-center justify-center rounded-md border border-[var(--border)] disabled:opacity-40"
                  disabled={zoom >= 2.5}
                  onClick={() => setZoom((z) => Math.min(2.5, +(z + 0.25).toFixed(2)))}
                  aria-label="放大"
                >
                  <ZoomIn className="size-3.5" />
                </button>
              </div>
            </div>
            <MockupOverlay
              mockup={mockup}
              record={record}
              activeId={activeId}
              hoverId={hoverSlotId}
              zoom={zoom}
              resolveBBox={resolveBBox}
              drawAddMode={drawAddMode}
              onSelect={(id, additive) =>
                selectSlot(id, additive ? { additive: true } : undefined)
              }
              onHover={setHoverSlotId}
              onBBoxChange={(slotId, bbox) =>
                setDraftBBoxes((prev) => ({ ...prev, [slotId]: bbox }))
              }
              onAddMediaBBox={beginAddFromBBox}
            />
          </div>

          <div className="materials-review-side">
            <div className="flex min-h-0 min-w-0 flex-col gap-2">
              <div className="flex shrink-0 items-center justify-between gap-2">
                <p className="text-[11px] font-medium app-subtle">槽位列表</p>
                <button
                  type="button"
                  className="text-[10px] app-subtle hover:text-[var(--foreground)]"
                  onClick={() => {
                    const visible = record.layout.nodes
                      .filter((node) => {
                        if (slotFilter === "all") return true;
                        if (slotFilter === "media")
                          return node.rebuildInCode === false;
                        if (slotFilter === "code")
                          return node.rebuildInCode === true;
                        return (
                          node.rebuildInCode === false &&
                          (node.status !== "ready" || !node.materialAssetId)
                        );
                      })
                      .map((n) => n.id);
                    setCheckedIds((prev) =>
                      prev.length === visible.length ? [] : visible
                    );
                  }}
                >
                  {checkedIds.length ? "取消全选" : "全选当前筛选"}
                </button>
              </div>
              <div className="flex min-h-0 flex-1 flex-col">
                <SlotList
                  record={record}
                  assetById={assetById}
                  activeId={activeId}
                  checkedIds={checkedIds}
                  busySlotId={busySlotId}
                  draftBBoxes={draftBBoxes}
                  awaitingConfirm={awaitingConfirm}
                  filter={slotFilter}
                  onSelect={(id, opts) => selectSlot(id, opts)}
                  onToggleCheck={(id) =>
                    selectSlot(id, { toggleCheck: true })
                  }
                  onPreview={setPreview}
                  onRegen={regenSlot}
                  onMarkCode={markCode}
                  onMarkMedia={markMedia}
                  onRemove={(id) => askRemoveSlots([id])}
                />
              </div>
            </div>

            <div className="flex min-h-0 min-w-0 flex-col gap-2 overflow-hidden">
              <p className="shrink-0 text-[11px] font-medium app-subtle">
                当前槽位详情
              </p>
              {activeNode ? (
                <SlotDetailPanel
                  node={activeNode}
                  material={
                    activeNode.rebuildInCode === false &&
                    activeNode.materialAssetId
                      ? assetById.get(activeNode.materialAssetId)
                      : undefined
                  }
                  styleLock={record.styleLock ?? record.layout.styleLock}
                  draftPrompt={draftPrompt}
                  bboxDirty={Boolean(draftBBoxes[activeNode.id])}
                  busy={busySlotId === activeNode.id || jobBusy}
                  onPromptChange={setDraftPrompt}
                  onSavePrompt={() => void savePrompt(activeNode.id)}
                  onRoleChange={(role) => void saveRole(activeNode.id, role)}
                  onGenModeChange={(mode) => void saveGenPlan(activeNode.id, mode)}
                  onOutputSpecChange={(patch) => {
                    const mode =
                      activeNode.rebuildInCode === false
                        ? (activeNode.genMode ??
                          suggestGenMode({
                            role: activeNode.role,
                            bbox: activeNode.bbox,
                            prompt: activeNode.prompt,
                          }).genMode)
                        : "refine";
                    void saveGenPlan(activeNode.id, mode, patch);
                  }}
                  onPreview={setPreview}
                  onRegen={() => void regenSlot(activeNode.id)}
                  onMarkCode={() => void markCode(activeNode.id)}
                  onMarkMedia={() => void markMedia(activeNode.id)}
                  onRemove={() => askRemoveSlots([activeNode.id])}
                />
              ) : (
                <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-[var(--border)] p-6 text-xs app-subtle">
                  在左侧或列表中选中一个槽位
                </div>
              )}
            </div>
          </div>
        </div>

        {error ? (
          <p className="mt-3 shrink-0 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
            {error}
          </p>
        ) : null}

        {toast ? (
          <div className="pointer-events-none absolute bottom-16 left-1/2 z-10 -translate-x-1/2 rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-2 text-xs font-medium shadow-[var(--shadow-elevated)]">
            {toast}
          </div>
        ) : null}

        {pendingAdd ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/35 p-4">
            <div
              className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4 shadow-[var(--shadow-elevated)]"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-sm font-semibold">确认新增槽位</h3>
              <p className="mt-1 text-[11px] app-subtle">
                画框已就绪，选择类型与角色后写入方案
              </p>
              <div className="mt-3 flex gap-2">
                {(
                  [
                    ["media", "媒体槽"],
                    ["code", "代码槽"],
                  ] as const
                ).map(([kind, label]) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() =>
                      setPendingAdd((p) =>
                        p
                          ? {
                              ...p,
                              kind,
                              role:
                                kind === "media" ? "illustration" : "other",
                            }
                          : p
                      )
                    }
                    className={
                      "inline-flex h-9 flex-1 items-center justify-center rounded-lg border text-xs font-medium " +
                      (pendingAdd.kind === kind
                        ? "border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--foreground)]"
                        : "border-[var(--border)]")
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="mt-3 block text-[11px] font-medium">
                角色
                <select
                  className="mt-1 h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 text-xs"
                  value={pendingAdd.role}
                  onChange={(e) =>
                    setPendingAdd((p) =>
                      p ? { ...p, role: e.target.value } : p
                    )
                  }
                >
                  {(pendingAdd.kind === "media"
                    ? MEDIA_ROLE_OPTIONS
                    : CODE_ROLE_OPTIONS
                  ).map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mt-3 block text-[11px] font-medium">
                名称（可选）
                <input
                  className="mt-1 h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 text-xs"
                  value={pendingAdd.name}
                  placeholder={
                    pendingAdd.kind === "media" ? "如 Hero art" : "如 Top nav"
                  }
                  onChange={(e) =>
                    setPendingAdd((p) =>
                      p ? { ...p, name: e.target.value } : p
                    )
                  }
                />
              </label>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  className="inline-flex h-9 items-center rounded-lg border border-[var(--border)] px-3 text-xs"
                  onClick={() => setPendingAdd(null)}
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={jobBusy}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 text-xs font-semibold text-white disabled:opacity-50"
                  onClick={() => void confirmPendingAdd()}
                >
                  {jobBusy ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Plus className="size-3.5" />
                  )}
                  确认添加
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {confirm ? (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
            <div
              className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4 shadow-[var(--shadow-elevated)]"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-sm font-semibold">{confirm.title}</h3>
              <p className="mt-2 text-xs app-subtle">{confirm.body}</p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  className="inline-flex h-9 items-center rounded-lg border border-[var(--border)] px-3 text-xs"
                  onClick={() => setConfirm(null)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className={
                    "inline-flex h-9 items-center rounded-lg px-3 text-xs font-semibold text-white " +
                    (confirm.danger
                      ? "bg-red-600 hover:bg-red-700"
                      : "bg-[var(--primary)]")
                  }
                  onClick={() => {
                    const run = confirm.run;
                    setConfirm(null);
                    void run();
                  }}
                >
                  {confirm.confirmLabel}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <ImageLightbox item={preview} onClose={() => setPreview(null)} />

        {/* Footer */}
        <div className="mt-3 flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-3">
          <p className="text-[11px] app-subtle">
            {bboxDirty
              ? `已调整 ${dirtySlotIds.length} 个框（可先「应用已调框位」或生成时一并带上）`
              : awaitingConfirm
                ? "方案确认后点右侧生成；也可只生成单个媒体槽"
                : "选中媒体槽后可拖动 / 右下角缩放 · 缩略图可点预览"}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 items-center rounded-lg border border-[var(--border)] px-4 text-xs font-medium"
            >
              稍后继续
            </button>
            {pendingGen > 0 ? (
              <button
                type="button"
                disabled={jobBusy}
                onClick={() => void confirmAndGenerate()}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 text-xs font-semibold text-white disabled:opacity-50"
              >
                {jobBusy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Play className="size-3.5" />
                )}
                确认并生成素材 ({pendingGen})
              </button>
            ) : onExportHandoff ? (
              <button
                type="button"
                disabled={jobBusy}
                onClick={onExportHandoff}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 text-xs font-semibold text-white disabled:opacity-50"
              >
                <Check className="size-3.5" />
                确认并导出 Handoff
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusChip({
  label,
  tone,
}: {
  label: string;
  tone: "ok" | "warn" | "neutral" | "media" | "code";
}) {
  const toneClass =
    tone === "ok"
      ? "bg-emerald-500/12 text-emerald-800 dark:text-emerald-200"
      : tone === "warn"
        ? "bg-amber-500/12 text-amber-800 dark:text-amber-200"
        : tone === "media"
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : tone === "code"
            ? "bg-sky-500/10 text-sky-700 dark:text-sky-300"
            : "bg-[var(--surface-muted)] app-subtle";
  return (
    <span
      className={
        "inline-flex h-6 items-center rounded-full px-2 text-[10px] font-medium " +
        toneClass
      }
    >
      {label}
    </span>
  );
}

function SlotDetailPanel({
  node,
  material,
  styleLock,
  draftPrompt,
  bboxDirty,
  busy,
  onPromptChange,
  onSavePrompt,
  onRoleChange,
  onGenModeChange,
  onOutputSpecChange,
  onPreview,
  onRegen,
  onMarkCode,
  onMarkMedia,
  onRemove,
}: {
  node: LayoutNode;
  material?: ImageAsset;
  styleLock?: StyleLock;
  draftPrompt: string;
  bboxDirty: boolean;
  busy: boolean;
  onPromptChange: (v: string) => void;
  onSavePrompt: () => void;
  onRoleChange: (role: string) => void;
  onGenModeChange: (mode: MaterialGenMode) => void;
  onOutputSpecChange: (patch: Partial<MaterialOutputSpec>) => void;
  onPreview: (item: ImageLightboxItem) => void;
  onRegen: () => void;
  onMarkCode: () => void;
  onMarkMedia: () => void;
  onRemove: () => void;
}) {
  const isMedia = node.rebuildInCode === false;
  const needsGen =
    isMedia && (node.status !== "ready" || !node.materialAssetId);
  const thumb =
    isMedia &&
    (material?.src ||
      (node.rebuildInCode === false ? node.cropPreviewSrc : undefined));
  const roleOptions = isMedia ? MEDIA_ROLE_OPTIONS : CODE_ROLE_OPTIONS;
  const mediaNode = isMedia ? (node as MaterialSlot) : null;
  const suggested = mediaNode
    ? suggestGenMode({
        role: mediaNode.role,
        bbox: mediaNode.bbox,
        prompt: draftPrompt || mediaNode.prompt,
      })
    : null;
  const genMode: MaterialGenMode =
    mediaNode?.genMode ?? suggested?.genMode ?? "refine";
  const outputSpec: MaterialOutputSpec =
    mediaNode?.outputSpec ??
    suggested?.outputSpec ?? {
      alpha: false,
      tileable: false,
      bleed: 0.02,
    };
  const finalPrompt =
    isMedia && genMode !== "slice"
      ? composeMaterialGenerationPrompt({
          slotPrompt: draftPrompt,
          styleLock,
          role: node.role,
          genMode,
          outputSpec,
        })
      : isMedia
        ? "（slice 模式：直接使用槽位裁切，不调用生图模型）"
        : "";
  const promptDiffers =
    isMedia &&
    genMode !== "slice" &&
    finalPrompt.trim() !== draftPrompt.trim() &&
    Boolean(draftPrompt.trim());

  const bleedValue = BLEED_OPTIONS.some((o) => o.value === outputSpec.bleed)
    ? outputSpec.bleed
    : BLEED_OPTIONS.reduce((best, o) =>
        Math.abs(o.value - outputSpec.bleed) <
        Math.abs(best.value - outputSpec.bleed)
          ? o
          : best
      ).value;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-muted)]/25">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3">
        <div className="flex gap-3">
          {thumb ? (
            <PreviewableThumb
              src={thumb}
              className="size-16 shrink-0 rounded-lg"
              title={`${node.id} · ${node.role}`}
              subtitle={isMedia ? (needsGen ? "待生成" : node.status) : "code"}
              onPreview={onPreview}
            />
          ) : (
            <span className="relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--background)] text-[10px] app-subtle">
              {isMedia ? (needsGen ? "待生成" : node.status) : "code"}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-sm font-semibold">{node.id}</p>
            <p className="mt-1 flex flex-wrap gap-1 text-[10px]">
              <span
                className={
                  "rounded px-1.5 py-0.5 font-medium " +
                  (isMedia
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                    : "bg-sky-500/15 text-sky-700 dark:text-sky-300")
                }
              >
                {isMedia ? "媒体槽" : "代码槽"}
              </span>
              {bboxDirty ? (
                <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-700 dark:text-amber-300">
                  bbox 已改
                </span>
              ) : null}
            </p>
            <p className="mt-1.5 font-mono text-[10px] app-subtle">
              bbox {fmtBBox(node.bbox)}
              {node.layoutHint?.parentId
                ? ` · 父级 ${node.layoutHint.parentId}`
                : ""}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="block text-[10px] font-medium app-subtle">
            角色
            <select
              className="mt-1 h-8 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-[11px] text-[var(--foreground)]"
              value={node.role}
              disabled={busy}
              onChange={(e) => onRoleChange(e.target.value)}
            >
              {roleOptions.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
          </label>
          {isMedia ? (
            <label className="block text-[10px] font-medium app-subtle">
              生成模式
              <select
                className="mt-1 h-8 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-[11px] text-[var(--foreground)]"
                value={genMode}
                disabled={busy}
                onChange={(e) =>
                  onGenModeChange(e.target.value as MaterialGenMode)
                }
              >
                {GEN_MODE_OPTIONS.map((mode) => (
                  <option key={mode.value} value={mode.value}>
                    {mode.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        {isMedia && suggested ? (
          <p className="-mt-1 text-[10px] app-subtle">
            建议 {suggested.genMode}
            {mediaNode?.genModeReasons?.[0]
              ? ` · ${mediaNode.genModeReasons[0]}`
              : suggested.reasons[0]
                ? ` · ${suggested.reasons[0]}`
                : ""}
          </p>
        ) : null}

        {isMedia ? (
          <div className="rounded-md border border-[var(--border)] bg-[var(--background)]/60 p-2">
            <p className="text-[10px] font-medium app-subtle">交付形态</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px]">
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  className="size-3.5 accent-[var(--primary)]"
                  checked={outputSpec.alpha}
                  disabled={busy}
                  onChange={(e) =>
                    onOutputSpecChange({ alpha: e.target.checked })
                  }
                />
                透明底 α
              </label>
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  className="size-3.5 accent-[var(--primary)]"
                  checked={outputSpec.tileable}
                  disabled={busy}
                  onChange={(e) =>
                    onOutputSpecChange({ tileable: e.target.checked })
                  }
                />
                可平铺
              </label>
              <label className="inline-flex min-w-[7rem] flex-1 items-center gap-1.5 text-[10px] app-subtle">
                bleed
                <select
                  className="h-7 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-1.5 text-[11px] text-[var(--foreground)]"
                  value={String(bleedValue)}
                  disabled={busy}
                  onChange={(e) =>
                    onOutputSpecChange({ bleed: Number(e.target.value) })
                  }
                >
                  {BLEED_OPTIONS.map((opt) => (
                    <option key={opt.value} value={String(opt.value)}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        ) : null}

        {isMedia ? (
          <div className="flex flex-col gap-2">
            <p className="text-[11px] font-medium">槽位提示词（可编辑）</p>
            <textarea
              value={draftPrompt}
              onChange={(e) => onPromptChange(e.target.value)}
              rows={4}
              className="min-h-[88px] w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-2 text-[12px] leading-relaxed"
            />
            <button
              type="button"
              disabled={busy || !draftPrompt.trim()}
              onClick={onSavePrompt}
              className="inline-flex h-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] px-3 text-[11px] font-medium disabled:opacity-50"
            >
              保存提示词
            </button>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--background)]/70 p-2.5">
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="text-[11px] font-medium">
                  实际发送给模型
                  {promptDiffers ? (
                    <span className="ml-1.5 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:text-amber-200">
                      含附加约束
                    </span>
                  ) : null}
                </p>
                <button
                  type="button"
                  className="shrink-0 text-[10px] font-medium text-[var(--primary)]"
                  onClick={() => {
                    void navigator.clipboard?.writeText(finalPrompt);
                  }}
                >
                  复制
                </button>
              </div>
              <p className="max-h-28 overflow-y-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed app-subtle">
                {finalPrompt || "（保存或填写槽位提示词后预览）"}
              </p>
              {genMode === "slice" ? (
                <p className="mt-1.5 text-[10px] app-subtle">
                  slice：跳过生图，导出槽位裁切（可按 bleed 膨胀）。
                </p>
              ) : promptDiffers ? (
                <p className="mt-1.5 text-[10px] app-subtle">
                  {genMode === "refine"
                    ? node.role === "background"
                      ? "refine（背景）：整张 mockup 作参考，抽出连续底图/纹理；去掉前景 UI。"
                      : "refine：以槽位 crop 为真值做清洁/抠边；附加 Style DNA + outputSpec。"
                    : node.role === "background"
                      ? "regenerate（背景）：整张 mockup 作参考；匹配氛围并去掉 UI chrome。"
                      : "regenerate：文本主导重绘；零件槽不拼整页 Mood；参考图为风格裁片 + 槽位 crop。"}
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--background)]/60 p-3 text-[12px]">
            <p className="font-medium">代码实现</p>
            <p className="mt-1 app-subtle">
              {node.copy || node.suggestedComponent || "由编码 Agent 用组件实现"}
            </p>
            {node.suggestedComponent ? (
              <p className="mt-2 font-mono text-[11px]">
                component: {node.suggestedComponent}
              </p>
            ) : null}
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap gap-1.5 border-t border-[var(--border)] bg-[var(--surface-muted)]/40 px-3 py-2.5">
        {isMedia ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={onRegen}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 text-[11px] font-medium disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="size-3 animate-spin" />
              ) : needsGen ? (
                <Play className="size-3" />
              ) : (
                <RefreshCw className="size-3" />
              )}
              {needsGen ? "生成此槽" : "重做此槽"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onMarkCode}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 text-[11px] font-medium disabled:opacity-50"
            >
              <Code2 className="size-3" />
              标为代码
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={onMarkMedia}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 text-[11px] font-medium disabled:opacity-50"
          >
            <ImagePlus className="size-3" />
            标为媒体
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={onRemove}
          className="inline-flex h-8 items-center gap-1 rounded-lg border border-red-500/30 bg-[var(--background)] px-2.5 text-[11px] font-medium text-red-600 disabled:opacity-50 dark:text-red-400"
        >
          <Trash2 className="size-3" />
          删除槽位
        </button>
      </div>
    </div>
  );
}

function fmtBBox(b: BBox): string {
  const p = (n: number) => `${Math.round(n * 100)}%`;
  return `${p(b.x)}, ${p(b.y)}, ${p(b.w)}×${p(b.h)}`;
}

function MockupOverlay({
  mockup,
  record,
  activeId,
  hoverId,
  zoom,
  resolveBBox,
  drawAddMode,
  onSelect,
  onHover,
  onBBoxChange,
  onAddMediaBBox,
}: {
  mockup: ImageAsset;
  record: MaterializationRecord;
  activeId: string | null;
  hoverId: string | null;
  zoom: number;
  resolveBBox: (node: LayoutNode) => BBox;
  drawAddMode: boolean;
  onSelect: (id: string, additive?: boolean) => void;
  onHover: (id: string | null) => void;
  onBBoxChange: (slotId: string, bbox: BBox) => void;
  onAddMediaBBox: (bbox: BBox) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [imgBox, setImgBox] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const [drawDraft, setDrawDraft] = useState<BBox | null>(null);
  const drawDraftRef = useRef<BBox | null>(null);
  const dragRef = useRef<{
    slotId: string;
    mode: DragMode;
    startX: number;
    startY: number;
    origin: BBox;
  } | null>(null);
  const drawRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const measure = useCallback(() => {
    const container = containerRef.current;
    const img = imgRef.current;
    if (!container || !img) return;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const nw = img.naturalWidth || mockup.width;
    const nh = img.naturalHeight || mockup.height;
    if (!cw || !ch || !nw || !nh) return;
    const scale = Math.min(cw / nw, ch / nh);
    const width = nw * scale;
    const height = nh * scale;
    setImgBox({
      left: (cw - width) / 2,
      top: (ch - height) / 2,
      width,
      height,
    });
  }, [mockup.width, mockup.height]);

  useEffect(() => {
    measure();
    const ro = new ResizeObserver(() => measure());
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [measure]);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const box = imgBox;
      if (!box || box.width <= 0 || box.height <= 0) return;

      if (drawRef.current) {
        const dx = (e.clientX - drawRef.current.startX) / box.width;
        const dy = (e.clientY - drawRef.current.startY) / box.height;
        const x0 = drawRef.current.originX;
        const y0 = drawRef.current.originY;
        const x1 = Math.max(0, Math.min(1, x0 + dx));
        const y1 = Math.max(0, Math.min(1, y0 + dy));
        const next = {
          x: Math.min(x0, x1),
          y: Math.min(y0, y1),
          w: Math.max(0.04, Math.abs(x1 - x0)),
          h: Math.max(0.04, Math.abs(y1 - y0)),
        };
        drawDraftRef.current = next;
        setDrawDraft(next);
        return;
      }

      const drag = dragRef.current;
      if (!drag) return;
      const mdx = (e.clientX - drag.startX) / box.width;
      const mdy = (e.clientY - drag.startY) / box.height;
      const o = drag.origin;
      if (drag.mode === "move") {
        onBBoxChange(drag.slotId, {
          x: Math.min(1 - o.w, Math.max(0, o.x + mdx)),
          y: Math.min(1 - o.h, Math.max(0, o.y + mdy)),
          w: o.w,
          h: o.h,
        });
      } else {
        onBBoxChange(drag.slotId, {
          x: o.x,
          y: o.y,
          w: Math.max(0.04, Math.min(1 - o.x, o.w + mdx)),
          h: Math.max(0.04, Math.min(1 - o.y, o.h + mdy)),
        });
      }
    }
    function onUp() {
      const draft = drawDraftRef.current;
      if (drawRef.current && draft && draft.w >= 0.04 && draft.h >= 0.04) {
        onAddMediaBBox(draft);
      }
      drawRef.current = null;
      drawDraftRef.current = null;
      setDrawDraft(null);
      dragRef.current = null;
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [imgBox, onBBoxChange, onAddMediaBBox]);

  return (
    <div
      ref={containerRef}
      className={
        "relative min-h-[280px] h-full flex-1 overflow-auto rounded-xl border bg-[var(--surface-muted)]/40 " +
        (drawAddMode
          ? "border-emerald-500/60 ring-1 ring-emerald-500/30"
          : "border-[var(--border)]")
      }
    >
      <div
        className="relative size-full min-h-[280px] origin-center transition-transform duration-150 ease-out motion-reduce:transition-none"
        style={{ transform: `scale(${zoom})` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={mockup.src}
          alt="approved mockup"
          className="pointer-events-none absolute inset-0 size-full object-contain"
          onLoad={measure}
          draggable={false}
        />
        {imgBox ? (
          <div
            className={
              "absolute " +
              (drawAddMode
                ? "pointer-events-auto cursor-crosshair"
                : "pointer-events-none")
            }
            style={{
              left: imgBox.left,
              top: imgBox.top,
              width: imgBox.width,
              height: imgBox.height,
            }}
            onPointerDown={(e) => {
              if (!drawAddMode || !imgBox) return;
              e.preventDefault();
              const rect = (
                e.currentTarget as HTMLDivElement
              ).getBoundingClientRect();
              const ox = (e.clientX - rect.left) / imgBox.width;
              const oy = (e.clientY - rect.top) / imgBox.height;
              drawRef.current = {
                startX: e.clientX,
                startY: e.clientY,
                originX: Math.max(0, Math.min(1, ox)),
                originY: Math.max(0, Math.min(1, oy)),
              };
              const seed = {
                x: drawRef.current.originX,
                y: drawRef.current.originY,
                w: 0.04,
                h: 0.04,
              };
              drawDraftRef.current = seed;
              setDrawDraft(seed);
            }}
          >
            {record.layout.nodes.map((node) => {
              const bbox = resolveBBox(node);
              const active = node.id === activeId;
              const hovered = node.id === hoverId;
              const isMedia = node.rebuildInCode === false;
              return (
                <div
                  key={node.id}
                  className={
                    "absolute box-border text-left transition-[box-shadow,background-color] duration-150 " +
                    (drawAddMode
                      ? "pointer-events-none "
                      : "pointer-events-auto ") +
                    (active
                      ? "z-10 border-2 border-amber-400 bg-amber-400/20 shadow-[0_0_0_1px_rgba(251,191,36,0.35)]"
                      : hovered
                        ? "z-[5] border-2 border-[var(--primary)] bg-[var(--primary)]/15"
                        : isMedia
                          ? "border border-emerald-400/70 bg-emerald-400/10"
                          : "border border-dashed border-sky-400/60 bg-sky-400/10")
                  }
                  style={{
                    left: `${bbox.x * 100}%`,
                    top: `${bbox.y * 100}%`,
                    width: `${bbox.w * 100}%`,
                    height: `${bbox.h * 100}%`,
                    cursor: drawAddMode
                      ? "crosshair"
                      : isMedia
                        ? "move"
                        : "pointer",
                  }}
                  onPointerEnter={() => onHover(node.id)}
                  onPointerLeave={() => onHover(null)}
                  onPointerDown={(e) => {
                    if (drawAddMode) return;
                    onSelect(node.id, e.shiftKey || e.metaKey || e.ctrlKey);
                    if (!isMedia) return;
                    e.preventDefault();
                    e.stopPropagation();
                    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                    dragRef.current = {
                      slotId: node.id,
                      mode: "move",
                      startX: e.clientX,
                      startY: e.clientY,
                      origin: { ...bbox },
                    };
                  }}
                  title={`${node.id} · ${node.role}${isMedia ? "" : " · code"}`}
                >
                  <span className="m-0.5 inline-block max-w-[96%] truncate rounded bg-black/60 px-1 py-0.5 text-[9px] font-medium text-white">
                    {node.role}
                    {isMedia ? "" : " · code"}
                  </span>
                  {!drawAddMode && isMedia && active ? (
                    <span
                      className="absolute bottom-0 right-0 size-3 cursor-se-resize rounded-sm bg-amber-400"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        dragRef.current = {
                          slotId: node.id,
                          mode: "resize-se",
                          startX: e.clientX,
                          startY: e.clientY,
                          origin: { ...bbox },
                        };
                      }}
                    />
                  ) : null}
                </div>
              );
            })}
            {drawDraft ? (
              <div
                className="pointer-events-none absolute box-border border-2 border-emerald-400 bg-emerald-400/20"
                style={{
                  left: `${drawDraft.x * 100}%`,
                  top: `${drawDraft.y * 100}%`,
                  width: `${drawDraft.w * 100}%`,
                  height: `${drawDraft.h * 100}%`,
                }}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SlotList({
  record,
  assetById,
  activeId,
  checkedIds,
  busySlotId,
  draftBBoxes,
  awaitingConfirm,
  filter,
  onSelect,
  onToggleCheck,
  onPreview,
  onRegen,
  onMarkCode,
  onMarkMedia,
  onRemove,
}: {
  record: MaterializationRecord;
  assetById: Map<string, ImageAsset>;
  activeId: string | null;
  checkedIds: string[];
  busySlotId: string | null;
  draftBBoxes: Record<string, BBox>;
  awaitingConfirm: boolean;
  filter: SlotFilter;
  onSelect: (id: string, opts?: { toggleCheck?: boolean; additive?: boolean }) => void;
  onToggleCheck: (id: string) => void;
  onPreview: (item: ImageLightboxItem) => void;
  onRegen: (id: string) => void;
  onMarkCode: (id: string) => void;
  onMarkMedia: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const nodes = record.layout.nodes.filter((node) => {
    if (filter === "all") return true;
    if (filter === "media") return node.rebuildInCode === false;
    if (filter === "code") return node.rebuildInCode === true;
    return (
      node.rebuildInCode === false &&
      (node.status !== "ready" || !node.materialAssetId)
    );
  });

  if (nodes.length === 0) {
    return (
      <div className="flex min-h-[200px] flex-1 items-center justify-center rounded-xl border border-dashed border-[var(--border)] text-xs app-subtle">
        当前筛选下无槽位
      </div>
    );
  }

  const checkedSet = new Set(checkedIds);

  return (
    <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
      {nodes.map((node) => (
        <SlotRow
          key={node.id}
          node={node}
          material={
            node.rebuildInCode === false && node.materialAssetId
              ? assetById.get(node.materialAssetId)
              : undefined
          }
          active={node.id === activeId}
          checked={checkedSet.has(node.id)}
          busy={busySlotId === node.id}
          bboxDirty={Boolean(draftBBoxes[node.id])}
          awaitingConfirm={awaitingConfirm}
          onSelect={() => onSelect(node.id)}
          onToggleCheck={() => onToggleCheck(node.id)}
          onPreview={onPreview}
          onRegen={() => onRegen(node.id)}
          onMarkCode={() => onMarkCode(node.id)}
          onMarkMedia={() => onMarkMedia(node.id)}
          onRemove={() => onRemove(node.id)}
        />
      ))}
    </ul>
  );
}

function SlotRow({
  node,
  material,
  active,
  checked,
  busy,
  bboxDirty,
  awaitingConfirm,
  onSelect,
  onToggleCheck,
  onPreview,
  onRegen,
  onMarkCode,
  onMarkMedia,
  onRemove,
}: {
  node: LayoutNode;
  material?: ImageAsset;
  active: boolean;
  checked: boolean;
  busy: boolean;
  bboxDirty: boolean;
  awaitingConfirm: boolean;
  onSelect: () => void;
  onToggleCheck: () => void;
  onPreview: (item: ImageLightboxItem) => void;
  onRegen: () => void;
  onMarkCode: () => void;
  onMarkMedia: () => void;
  onRemove: () => void;
}) {
  const isMedia = node.rebuildInCode === false;
  const status = isMedia ? node.status : "code";
  const thumbSrc =
    isMedia &&
    (material?.src ||
      (node.rebuildInCode === false ? node.cropPreviewSrc : undefined));
  const isCropOnly =
    isMedia &&
    !material?.src &&
    Boolean(node.rebuildInCode === false && node.cropPreviewSrc);
  const isCropFallback =
    isMedia &&
    Boolean(
      node.rebuildInCode === false && node.notes?.includes("crop fallback")
    );
  const needsGen =
    isMedia && (node.status !== "ready" || !node.materialAssetId);

  return (
    <li
      className={
        "rounded-lg border p-2 transition " +
        (active
          ? "border-amber-500/50 bg-amber-500/5"
          : checked
            ? "border-[var(--primary)]/40 bg-[var(--primary)]/5"
            : "border-[var(--border)] bg-[var(--surface-muted)]/35")
      }
    >
      <div className="flex gap-2">
        <label className="mt-1 flex size-4 shrink-0 cursor-pointer items-center justify-center">
          <input
            type="checkbox"
            className="size-3.5 accent-[var(--primary)]"
            checked={checked}
            onChange={onToggleCheck}
            aria-label={`选择 ${node.id}`}
          />
        </label>
      <button
        type="button"
        className="flex min-w-0 flex-1 gap-2 text-left"
        onClick={onSelect}
      >
        {thumbSrc ? (
          <PreviewableThumb
            src={thumbSrc}
            className="size-14"
            title={`${node.id} · ${node.role}`}
            subtitle={
              isMedia ? (needsGen ? "待生成" : String(status)) : "code"
            }
            onPreview={onPreview}
          >
            {isCropOnly || isCropFallback ? (
              <span className="absolute inset-x-0 bottom-0 bg-amber-600/85 px-0.5 text-center text-[8px] font-medium text-white">
                crop
              </span>
            ) : null}
          </PreviewableThumb>
        ) : (
          <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-[var(--border)] bg-[var(--background)] text-[10px] app-subtle">
            {isMedia ? (needsGen ? "待生成" : status) : "code"}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5 text-[12px] font-medium">
            <code className="text-[11px]">{node.id}</code>
            <span className="rounded bg-[var(--surface-muted)] px-1 py-0.5 text-[9px] app-subtle">
              {node.role}
            </span>
            <span
              className={
                "rounded px-1 py-0.5 text-[9px] font-medium " +
                (status === "ready"
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                  : status === "failed"
                    ? "bg-red-500/15 text-red-700 dark:text-red-300"
                    : status === "code"
                      ? "bg-sky-500/15 text-sky-700 dark:text-sky-300"
                      : "bg-amber-500/15 text-amber-700 dark:text-amber-300")
              }
            >
              {status === "code"
                ? "代码"
                : needsGen
                  ? "待生成"
                  : status}
            </span>
            {bboxDirty ? (
              <span className="rounded bg-amber-500/15 px-1 py-0.5 text-[9px] font-medium text-amber-700 dark:text-amber-300">
                bbox*
              </span>
            ) : null}
            {isMedia && node.rebuildInCode === false && node.genMode ? (
              <span className="rounded bg-[var(--surface-muted)] px-1 py-0.5 text-[9px] font-mono app-subtle">
                {node.genMode}
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 line-clamp-3 block text-[10px] app-subtle">
            {node.layoutHint?.parentId
              ? `↳ ${node.layoutHint.parentId} · `
              : ""}
            {isMedia
              ? node.prompt
              : node.copy || node.suggestedComponent || "rebuild in code"}
          </span>
        </span>
      </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5 pl-6">
        {isMedia && (!awaitingConfirm || needsGen) ? (
          <button
            type="button"
            disabled={busy}
            onClick={onRegen}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-[10px] font-medium disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="size-3 animate-spin" />
            ) : needsGen ? (
              <Play className="size-3" />
            ) : (
              <RefreshCw className="size-3" />
            )}
            {needsGen ? "生成此槽" : "重做"}
          </button>
        ) : null}
        {isMedia ? (
          <button
            type="button"
            disabled={busy}
            onClick={onMarkCode}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-[10px] font-medium disabled:opacity-50"
          >
            <Code2 className="size-3" />
            标为代码
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={onMarkMedia}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-[10px] font-medium disabled:opacity-50"
          >
            <ImagePlus className="size-3" />
            标为媒体
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={onRemove}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-[10px] font-medium text-red-600 disabled:opacity-50 dark:text-red-400"
        >
          <Trash2 className="size-3" />
          删除
        </button>
      </div>
    </li>
  );
}

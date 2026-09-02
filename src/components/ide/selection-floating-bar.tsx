"use client";

/**
 * 选中元素浮动操作条 — 画板/生图选中后的上下文操作（Lovart 式）
 * 含：收藏 / 框选重绘 / 变体 / 复制 Prompt / 下载 / 移除
 * @author：wangjunhua
 */

import { useEffect, useState } from "react";
import {
  ArrowUp,
  Copy,
  Download,
  FileJson,
  Focus,
  Images,
  Layers,
  Loader2,
  MoreHorizontal,
  Palette,
  Pencil,
  RefreshCw,
  Sparkles,
  Star,
  Trash2,
} from "lucide-react";
import { useEditor, useValue } from "tldraw";
import { useCanvasSelectionStore } from "@/store/canvas-selection-store";
import { useCanvasUiStore } from "@/store/canvas-ui-store";
import {
  isValidMarkRegion,
  useAssetMarkStore,
} from "@/store/asset-mark-store";
import { useProjectStore } from "@/store/project-store";
import { useProviderStore } from "@/store/provider-store";
import type { ImageAsset } from "@/lib/project/assets-schema";
import type { ProjectFile } from "@/lib/project/schema";
import {
  buildRegionEditPrompt,
  createRegionAnnotatedDataUrl,
} from "@/lib/canvas/region-annotate";
import { buildSingleAssetPrompt } from "@/lib/handoff/kickoff-prompt";
import type { AssetDesignSpec } from "@/lib/project/design-spec-schema";
import { renderAssetDesignSpecMarkdown } from "@/lib/design-spec/spec-format";
import { discardAssetsInProject } from "@/lib/project/discard-assets";
import { MaterialsReviewDialog } from "@/components/materials-review-dialog";
import { buildAdoptAssetStyleMessage } from "@/lib/agents/adopt-asset-style";

interface SelectionFloatingBarProps {
  onPrompt?: (prompt: string) => void;
  onRunPrompt?: (prompt: string) => void;
  onExportPage?: () => void;
  onOpenHandoff?: () => void;
}

export function SelectionFloatingBar({
  onPrompt,
  onRunPrompt,
  onOpenHandoff,
}: SelectionFloatingBarProps) {
  const editor = useEditor();
  const selection = useCanvasSelectionStore((s) => s.selection);
  const upsert = useProjectStore((s) => s.upsert);
  const reloadFromDisk = useProjectStore((s) => s.reloadFromDisk);
  const providerConfig = useProviderStore((s) => s.config);
  const project = useProjectStore((s) =>
    selection ? (s.projects[selection.projectId] ?? null) : null
  );

  const markMode = useAssetMarkStore((s) => s.mode);
  const markAssetId = useAssetMarkStore((s) => s.assetId);
  const markRegion = useAssetMarkStore((s) => s.region);
  const instruction = useAssetMarkStore((s) => s.instruction);
  const startMarking = useAssetMarkStore((s) => s.startMarking);
  const setInstruction = useAssetMarkStore((s) => s.setInstruction);
  const cancelMark = useAssetMarkStore((s) => s.cancel);
  const resetAfterSubmit = useAssetMarkStore((s) => s.resetAfterSubmit);

  const screenBounds = useValue(
    "selection screen bounds",
    () => editor.getSelectionScreenBounds(),
    [editor]
  );
  const viewportBounds = useValue(
    "viewport screen bounds",
    () => editor.getViewportScreenBounds(),
    [editor]
  );

  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [variantOpen, setVariantOpen] = useState(false);
  const [inlineDraft, setInlineDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const [specBusy, setSpecBusy] = useState(false);
  const [specOpen, setSpecOpen] = useState(false);
  const [specPreview, setSpecPreview] = useState<AssetDesignSpec | null>(null);
  const [materializeBusy, setMaterializeBusy] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<{
    projectId: string;
    assetId: string;
  } | null>(null);
  const reviewProject = useProjectStore((s) =>
    reviewTarget ? (s.projects[reviewTarget.projectId] ?? null) : null
  );

  useEffect(() => {
    if (!screenBounds || !viewportBounds || !selection) {
      setPos(null);
      return;
    }
    // tldraw「screen」坐标含视口偏移；转成容器内坐标（与官方 ContextualToolbar 一致）
    const barW = 328;
    const barH = 108;
    const gap = 10;
    const margin = 12;
    const localX = screenBounds.x - viewportBounds.x;
    const localY = screenBounds.y - viewportBounds.y;
    const midX = localX + screenBounds.w / 2;
    let left = midX;
    let top = localY - gap;
    // 上方不够则放到选区下方（top = 元素底边，配合 -translate-y-full）
    if (top - barH < margin) {
      top = localY + screenBounds.h + gap + barH;
    }
    left = Math.min(
      viewportBounds.w - margin - barW / 2,
      Math.max(margin + barW / 2, left)
    );
    top = Math.min(
      viewportBounds.h - margin,
      Math.max(margin + barH, top)
    );
    const { scrollLeft, scrollTop } = editor.getContainer();
    setPos({ left: left + scrollLeft, top: top + scrollTop });
  }, [screenBounds, viewportBounds, selection, editor]);

  useEffect(() => {
    setEditError(null);
    setCopied(false);
    setSpecOpen(false);
    setSpecPreview(null);
    setMoreOpen(false);
    setVariantOpen(false);
    setInlineDraft("");
    if (
      selection?.kind !== "asset" ||
      (markAssetId && selection.assetId !== markAssetId)
    ) {
      if (markMode !== "idle") cancelMark();
    }
  }, [selection?.assetId, selection?.kind, markAssetId, markMode, cancelMark]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && markMode !== "idle") {
        e.preventDefault();
        cancelMark();
        setEditError(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [markMode, cancelMark]);

  const reviewDialog =
    reviewTarget && reviewProject ? (
      <MaterialsReviewDialog
        project={reviewProject}
        mockupAssetId={reviewTarget.assetId}
        providerConfig={providerConfig}
        onProjectUpdate={upsert}
        onClose={() => setReviewTarget(null)}
        onExportHandoff={
          onOpenHandoff
            ? () => {
                setReviewTarget(null);
                onOpenHandoff();
              }
            : undefined
        }
      />
    ) : null;

  if (!selection || !pos || !project) {
    return reviewDialog;
  }

  const asset =
    selection.kind === "asset" && selection.assetId
      ? project.assets?.find((a) => a.id === selection.assetId)
      : null;

  const isMarkingThis =
    asset &&
    markAssetId === asset.id &&
    (markMode === "marking" || markMode === "instruct");

  function toggleStar() {
    if (!asset || !project) return;
    upsert({
      ...project,
      assets: (project.assets ?? []).map((a) =>
        a.id === asset.id
          ? { ...a, status: a.status === "starred" ? "candidate" : "starred" }
          : a
      ),
      updatedAt: new Date().toISOString(),
    });
  }

  function discardAsset() {
    if (!asset || !project) return;
    cancelMark();
    const assetId = asset.id;
    const shapes = editor.getCurrentPageShapes().filter((s) => {
      if ((s.type as string) !== "image-asset") return false;
      return (
        (s as unknown as { props: { assetId: string } }).props.assetId ===
        assetId
      );
    });
    // 标记 discarded（勿 filter）——upsert merge 会把物理删除的 id 合并回来
    const latest =
      useProjectStore.getState().projects[project.id] ?? project;
    upsert(discardAssetsInProject(latest, [assetId]));
    editor.selectNone();
    useCanvasSelectionStore.getState().clear();
    if (shapes.length > 0) {
      editor.deleteShapes(shapes.map((shape) => shape.id));
    }
  }

  function downloadAsset() {
    if (!asset?.src) return;
    const a = document.createElement("a");
    a.href = asset.src;
    a.download = `asset-${asset.id.slice(0, 8)}.png`;
    a.click();
  }

  function focusSelection() {
    editor.zoomToSelection({ animation: { duration: 200 } });
  }

  async function copyAssetPrompt() {
    if (!asset || !project) return;
    try {
      const text = asset.designSpec
        ? `${buildSingleAssetPrompt(project, asset)}\n\n---\n\n${renderAssetDesignSpecMarkdown(asset.designSpec)}`
        : buildSingleAssetPrompt(project, asset);
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setEditError("复制失败，请检查剪贴板权限");
    }
  }

  async function generateDesignSpec() {
    if (!asset?.src || !project || specBusy) return;
    setSpecBusy(true);
    setEditError(null);
    try {
      const res = await fetch("/api/agents/design-spec", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          assetId: asset.id,
          providerConfig,
          persist: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
      }
      const nextSpec = data.designSpec as AssetDesignSpec;
      if (data.project) {
        upsert(data.project as ProjectFile);
      } else {
        upsert({
          ...project,
          assets: (project.assets ?? []).map((a) =>
            a.id === asset.id ? { ...a, designSpec: nextSpec } : a
          ),
          updatedAt: new Date().toISOString(),
        });
      }
      setSpecPreview(nextSpec);
      setSpecOpen(true);
    } catch (err) {
      setEditError((err as Error).message);
    } finally {
      setSpecBusy(false);
    }
  }

  async function materializeMockup() {
    if (!asset?.src || !project || materializeBusy) return;
    if (asset.source === "materialized") {
      setEditError("零件素材不能再次拆解，请选择整屏 mockup");
      return;
    }
    setMaterializeBusy(true);
    setEditError(null);
    try {
      const res = await fetch("/api/agents/materialize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          assetId: asset.id,
          providerConfig,
          /** 只拆解 IR，不自动生图；用户在审槽面板确认后再生成 */
          skipGeneration: true,
          async: false,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
      }
      if (data.project) {
        upsert(data.project as ProjectFile);
      }
      if (data.visionOk === false) {
        setEditError(
          String(
            data.visionError ||
              "Vision 拆解失败，已回退启发式。请在审槽面板查看详情并点「重新拆解」。"
          )
        );
      }
      setReviewTarget({ projectId: project.id, assetId: asset.id });
    } catch (err) {
      setEditError((err as Error).message);
    } finally {
      setMaterializeBusy(false);
    }
  }

  async function pollMaterializeJob(jobId: string, projectId: string) {
    while (true) {
      await delay(900);
      const res = await fetch(
        `/api/jobs/${jobId}?projectId=${encodeURIComponent(projectId)}`,
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
        await reloadFromDisk(projectId);
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

  function enterMarkMode() {
    if (!asset || !project) return;
    setEditError(null);
    editor.zoomToSelection({ animation: { duration: 220 } });
    startMarking(project.id, asset.id);
  }

  async function submitRegionEdit() {
    if (
      !asset?.src ||
      !project ||
      !isValidMarkRegion(markRegion) ||
      !instruction.trim() ||
      editBusy
    ) {
      return;
    }
    setEditBusy(true);
    setEditError(null);
    try {
      const region = markRegion!;
      const annotated = await createRegionAnnotatedDataUrl(asset.src, region);
      const prompt = buildRegionEditPrompt(
        instruction.trim(),
        asset.prompt,
        region
      );
      const res = await fetch("/api/agents/image/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt,
          n: 1,
          width: asset.width || 1024,
          height: asset.height || 1024,
          visualStyle: project.brief?.visualStyle,
          referenceImages: [asset.src, annotated],
          projectId: project.id,
          parentAssetId: asset.id,
          editInstruction: instruction.trim(),
          editRegion: region,
          role: asset.role,
          providerConfig,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
      }
      if (data.project) {
        upsert(data.project as typeof project);
      }
      const jobId = data?.job?.jobId as string | undefined;
      if (jobId) {
        await pollImageJob(jobId, project.id);
        resetAfterSubmit();
        return;
      }
      const raw = (data.assets as ImageAsset[]) ?? [];
      if (raw.length === 0) throw new Error("框选重绘未返回素材");
      const nextAssets = raw.map((a) => ({
        ...a,
        parentAssetId: asset.id,
        editInstruction: instruction.trim(),
        editRegion: region,
        source: "edited" as const,
        status: "candidate" as const,
        role: asset.role ?? a.role,
      }));
      upsert({
        ...project,
        assets: [...(project.assets ?? []), ...nextAssets],
        updatedAt: new Date().toISOString(),
      });
      resetAfterSubmit();
      const newId = nextAssets[0]?.id;
      if (newId) {
        window.setTimeout(() => {
          const shapes = editor.getCurrentPageShapes();
          const shape = shapes.find((s) => {
            if ((s.type as string) !== "image-asset") return false;
            return (
              (s as unknown as { props: { assetId: string } }).props
                .assetId === newId
            );
          });
          if (shape) {
            editor.select(shape.id);
            editor.zoomToSelection({ animation: { duration: 220 } });
          }
        }, 180);
      }
    } catch (err) {
      setEditError((err as Error).message);
    } finally {
      setEditBusy(false);
    }
  }

  async function pollImageJob(jobId: string, projectId: string) {
    while (true) {
      await delay(900);
      const res = await fetch(`/api/jobs/${jobId}?projectId=${projectId}`, { cache: "no-store" });
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
        await reloadFromDisk(projectId);
        return;
      }
      if (job.status === "failed") {
        throw new Error(job.error || "Image edit failed");
      }
      if (job.status === "cancelled") {
        throw new Error("Image edit cancelled");
      }
    }
  }

  const multiIds = selection.assetIds && selection.assetIds.length > 1
    ? selection.assetIds
    : null;

  function useAsReference() {
    if (!asset?.src || !project) return;
    // 只推进 Composer chip（稳定 id，避免连点 / 双触发叠两条）
    const ref = {
      id: `from-asset-${asset.id}`,
      label: (asset.prompt || "参考图").slice(0, 40),
      src: asset.src,
      width: asset.width || 1024,
      height: asset.height || 1024,
      source: "upload" as const,
      createdAt: new Date().toISOString(),
      notes: `from-asset:${asset.id}`,
    };
    useCanvasUiStore.getState().offerComposerRef(ref);
  }

  function runOrFill(prompt: string) {
    if (onRunPrompt) onRunPrompt(prompt);
    else onPrompt?.(prompt);
  }

  function submitInline() {
    const text = inlineDraft.trim();
    if (!text || !asset) return;
    runOrFill(
      `针对选中的这张生图：${text}\n参考原 prompt：${asset.prompt ?? ""}`
    );
    setInlineDraft("");
  }

  function requestVariants(count: 1 | 2 | 4) {
    if (!asset) return;
    runOrFill(
      `为这张素材生成 ${count} 个视觉变体。以当前画面为唯一参考，保持全部文字、版式、主体与构图，只改风格、光影或细节。变体排列在原图右侧便于对比。`
    );
  }

  type BarAction = {
    key: string;
    label: string;
    icon: typeof Star;
    onClick: () => void;
    disabled?: boolean;
    active?: boolean;
    spinning?: boolean;
  };

  let primaryActions: BarAction[] = [];
  let moreActions: BarAction[] = [];

  if (multiIds) {
    return reviewDialog;
  }

  if (selection.kind === "asset") {
    primaryActions = [
      {
        key: "adopt-style",
        label: "用此风格",
        icon: Palette,
        onClick: () => {
          if (!asset) return;
          setMoreOpen(false);
          setVariantOpen(false);
          runOrFill(buildAdoptAssetStyleMessage(asset));
        },
        disabled: !asset?.src,
      },
      {
        key: "variant",
        label: "变体",
        icon: Sparkles,
        onClick: () => {
          setMoreOpen(false);
          setVariantOpen((v) => !v);
        },
        active: variantOpen,
      },
      {
        key: "edit",
        label: "重绘",
        icon: Pencil,
        onClick: enterMarkMode,
        active: !!isMarkingThis,
      },
      {
        key: "ref",
        label: "参考",
        icon: Images,
        onClick: useAsReference,
        disabled: !asset?.src,
      },
      {
        key: "materialize",
        label: materializeBusy
          ? "拆解中"
          : project?.materializations?.[asset?.id ?? ""]
            ? "审槽"
            : asset?.approval?.status === "materials_ready"
              ? "已拆素材"
              : "拆解方案",
        icon: materializeBusy ? Loader2 : Layers,
        onClick: () => {
          setVariantOpen(false);
          if (asset && project?.materializations?.[asset.id]) {
            setReviewTarget({ projectId: project.id, assetId: asset.id });
            return;
          }
          void materializeMockup();
        },
        disabled:
          !asset?.src ||
          materializeBusy ||
          asset?.source === "materialized",
        active:
          !!project?.materializations?.[asset?.id ?? ""] ||
          asset?.approval?.status === "materials_ready",
        spinning: materializeBusy,
      },
    ];
    moreActions = [
      {
        key: "star",
        label: asset?.status === "starred" ? "取消收藏" : "收藏",
        icon: Star,
        onClick: toggleStar,
        active: asset?.status === "starred",
      },
      {
        key: "dl",
        label: "下载",
        icon: Download,
        onClick: downloadAsset,
        disabled: !asset?.src,
      },
      {
        key: "copy-prompt",
        label: copied ? "已复制" : "复制 Prompt",
        icon: Copy,
        onClick: () => void copyAssetPrompt(),
      },
      {
        key: "regen",
        label: "重新生成",
        icon: RefreshCw,
        onClick: () =>
          runOrFill(
            `重新生成这张生图，保持主题但换一个视觉风格。参考 prompt：${asset?.prompt ?? ""}`
          ),
      },
      {
        key: "spec",
        label: specBusy
          ? "抽取中"
          : asset?.designSpec
            ? specOpen
              ? "更新规格"
              : "查看规格"
            : "生成规格",
        icon: specBusy ? Loader2 : FileJson,
        onClick: () => {
          if (asset?.designSpec && !specBusy && !specOpen) {
            setSpecPreview(asset.designSpec);
            setSpecOpen(true);
            return;
          }
          void generateDesignSpec();
        },
        disabled: !asset?.src || specBusy,
        active: !!asset?.designSpec || specOpen,
        spinning: specBusy,
      },
      {
        key: "discard",
        label: "移除",
        icon: Trash2,
        onClick: discardAsset,
      },
    ];
  } else {
    primaryActions = [
      {
        key: "focus",
        label: "聚焦",
        icon: Focus,
        onClick: focusSelection,
      },
    ];
  }

  // 审槽全屏打开时只渲染弹层，避免画布浮动条 z-index 盖住叠框图
  if (reviewDialog) {
    return reviewDialog;
  }

  return (
    <>
    <div
      className="pointer-events-auto absolute z-[100] flex -translate-x-1/2 -translate-y-full flex-col items-center"
      style={{ left: pos.left, top: pos.top }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {isMarkingThis && markMode === "marking" ? (
        <div className="vad-canvas-dock mb-2 flex w-[min(280px,70vw)] items-center justify-between gap-2 px-3 py-2.5">
          <p className="text-[12px] font-medium tracking-[-0.01em] text-[var(--foreground)]">
            拖拽框选重绘区域
          </p>
          <button
            type="button"
            onClick={() => {
              cancelMark();
              setEditError(null);
            }}
            className="vad-canvas-dock-ghost"
          >
            Esc
          </button>
        </div>
      ) : null}

      {isMarkingThis && markMode === "instruct" && asset ? (
        <div className="vad-canvas-dock mb-2 w-[min(300px,72vw)] p-3">
          <p className="mb-2 text-[11px] font-medium text-[var(--muted)]">
            只改红框内内容
          </p>
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={3}
            placeholder="例如：改成蓝色主按钮…"
            className="vad-canvas-dock-textarea"
            disabled={editBusy}
            autoFocus
          />
          {editError ? (
            <p className="mt-1.5 text-[11px] text-[var(--danger)]">{editError}</p>
          ) : null}
          <div className="mt-2.5 flex justify-end gap-2">
            <button
              type="button"
              disabled={editBusy}
              onClick={() => {
                cancelMark();
                setEditError(null);
              }}
              className="vad-canvas-dock-ghost"
            >
              取消
            </button>
            <button
              type="button"
              disabled={
                editBusy ||
                !instruction.trim() ||
                !isValidMarkRegion(markRegion)
              }
              onClick={() => void submitRegionEdit()}
              className="vad-canvas-dock-primary"
            >
              {editBusy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Pencil className="size-3.5" />
              )}
              生成
            </button>
          </div>
        </div>
      ) : null}

      {!isMarkingThis && specOpen && (specPreview || asset?.designSpec) ? (
        <div className="vad-canvas-dock mb-2 max-h-[200px] w-[min(320px,78vw)] overflow-auto p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[11px] font-medium text-[var(--muted)]">设计规格</p>
            <button
              type="button"
              onClick={() => setSpecOpen(false)}
              className="vad-canvas-dock-ghost"
            >
              收起
            </button>
          </div>
          <p className="text-[12px] leading-relaxed text-[var(--foreground)]">
            {(specPreview ?? asset?.designSpec)?.summary}
          </p>
        </div>
      ) : null}

      {!isMarkingThis && editError ? (
        <p className="mb-2 max-w-[280px] rounded-[10px] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] px-2.5 py-1.5 text-[11px] text-[var(--danger)]">
          {editError}
        </p>
      ) : null}

      {!isMarkingThis && variantOpen && selection.kind === "asset" && !multiIds ? (
        <div className="vad-canvas-dock mb-2 flex w-[min(240px,70vw)] items-center gap-0.5 p-1.5">
          {([1, 2, 4] as const).map((count) => (
            <button
              key={count}
              type="button"
              className="vad-canvas-dock-btn"
              onClick={() => {
                requestVariants(count);
                setVariantOpen(false);
              }}
            >
              <Sparkles className="size-3.5 shrink-0" />
              <span>{count} 张</span>
            </button>
          ))}
        </div>
      ) : null}

      {!isMarkingThis ? (
        <div className="vad-canvas-dock relative w-[min(360px,86vw)]">
          <div className="flex items-center gap-0.5 p-1.5">
            {primaryActions.map(
              ({ key, label, icon: Icon, onClick, disabled, active, spinning }) => (
                <button
                  key={key}
                  type="button"
                  disabled={disabled}
                  data-tip={label}
                  data-tip-bottom=""
                  aria-label={label}
                  onClick={onClick}
                  className={
                    "vad-canvas-dock-btn" +
                    (active ? " vad-canvas-dock-btn--active" : "")
                  }
                >
                  <Icon
                    className={
                      "size-3.5 shrink-0" + (spinning ? " animate-spin" : "")
                    }
                  />
                  <span>{label}</span>
                </button>
              )
            )}
            {moreActions.length > 0 ? (
              <button
                type="button"
                data-tip="更多"
                data-tip-bottom=""
                aria-label="更多"
                aria-expanded={moreOpen}
                onClick={() => {
                  setVariantOpen(false);
                  setMoreOpen((v) => !v);
                }}
                className={
                  "vad-canvas-dock-btn vad-canvas-dock-btn--icon" +
                  (moreOpen ? " vad-canvas-dock-btn--active" : "")
                }
              >
                <MoreHorizontal className="size-3.5" />
              </button>
            ) : null}
          </div>

          {selection.kind === "asset" && !multiIds ? (
            <div className="vad-canvas-dock-field">
              <input
                type="text"
                value={inlineDraft}
                onChange={(e) => setInlineDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    submitInline();
                  }
                }}
                placeholder="继续改这张…"
                className="vad-canvas-dock-input"
              />
              <button
                type="button"
                disabled={!inlineDraft.trim()}
                aria-label="发送"
                onClick={submitInline}
                className="vad-canvas-dock-send"
              >
                <ArrowUp className="size-3.5" strokeWidth={2.5} />
              </button>
            </div>
          ) : null}

          {moreOpen && moreActions.length > 0 ? (
            <div className="vad-canvas-dock-menu">
              {moreActions.map(
                ({ key, label, icon: Icon, onClick, disabled, active, spinning }) => (
                  <button
                    key={key}
                    type="button"
                    disabled={disabled}
                    aria-label={label}
                    onClick={() => {
                      onClick();
                      setMoreOpen(false);
                    }}
                    className={
                      "vad-canvas-dock-menu-item" +
                      (active ? " vad-canvas-dock-menu-item--active" : "")
                    }
                  >
                    <Icon
                      className={"size-3.5" + (spinning ? " animate-spin" : "")}
                    />
                    <span>{label}</span>
                  </button>
                )
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
    </>
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

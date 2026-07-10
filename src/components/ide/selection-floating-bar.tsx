"use client";

/**
 * 选中元素浮动操作条 — 画板/生图选中后的上下文操作（Lovart 式）
 * 含：收藏 / 框选重绘 / 变体 / 复制 Prompt / 下载 / 移除
 * @author：wangjunhua
 */

import { useEffect, useState } from "react";
import {
  Copy,
  Download,
  Focus,
  Loader2,
  Pencil,
  RefreshCw,
  Sparkles,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useEditor, useValue } from "tldraw";
import { useCanvasSelectionStore } from "@/store/canvas-selection-store";
import {
  isValidMarkRegion,
  useAssetMarkStore,
} from "@/store/asset-mark-store";
import { useProjectStore } from "@/store/project-store";
import { useProviderStore } from "@/store/provider-store";
import type { ImageAsset } from "@/lib/project/assets-schema";
import {
  buildRegionEditPrompt,
  createRegionAnnotatedDataUrl,
} from "@/lib/canvas/region-annotate";
import { buildSingleAssetPrompt } from "@/lib/handoff/kickoff-prompt";

interface SelectionFloatingBarProps {
  onPrompt?: (prompt: string) => void;
  onExportPage?: () => void;
}

export function SelectionFloatingBar({
  onPrompt,
}: SelectionFloatingBarProps) {
  const editor = useEditor();
  const selection = useCanvasSelectionStore((s) => s.selection);
  const upsert = useProjectStore((s) => s.upsert);
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

  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!screenBounds || !selection) {
      setPos(null);
      return;
    }
    setPos({
      left: screenBounds.x + screenBounds.w / 2,
      top: screenBounds.y - 8,
    });
  }, [screenBounds, selection]);

  useEffect(() => {
    setEditError(null);
    setCopied(false);
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

  if (!selection || !pos || !project) return null;

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
    upsert({
      ...project,
      assets: (project.assets ?? []).filter((a) => a.id !== asset.id),
      updatedAt: new Date().toISOString(),
    });
    useCanvasSelectionStore.getState().clear();
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
      await navigator.clipboard.writeText(
        buildSingleAssetPrompt(project, asset)
      );
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setEditError("复制失败，请检查剪贴板权限");
    }
  }

  function enterMarkMode() {
    if (!asset || !project) return;
    setEditError(null);
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
          providerConfig,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
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

  const actions =
    selection.kind === "asset"
      ? [
          {
            key: "star",
            label: asset?.status === "starred" ? "取消收藏" : "收藏",
            icon: Star,
            onClick: toggleStar,
            active: asset?.status === "starred",
          },
          {
            key: "edit",
            label: "框选重绘",
            icon: Pencil,
            onClick: enterMarkMode,
            active: !!isMarkingThis,
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
              onPrompt?.(
                `重新生成这张生图，保持主题但换一个视觉风格。参考 prompt：${asset?.prompt ?? ""}`
              ),
          },
          {
            key: "variant",
            label: "生成变体",
            icon: Sparkles,
            onClick: () =>
              onPrompt?.(
                `为这张素材生成 4 个视觉变体。参考 prompt：${asset?.prompt ?? ""}`
              ),
          },
          {
            key: "dl",
            label: "下载",
            icon: Download,
            onClick: downloadAsset,
            disabled: !asset?.src,
          },
          {
            key: "discard",
            label: "移除",
            icon: Trash2,
            onClick: discardAsset,
          },
        ]
      : [
          {
            key: "focus",
            label: "聚焦",
            icon: Focus,
            onClick: focusSelection,
          },
        ];

  return (
    <div
      className="vad-selection-bar pointer-events-auto fixed z-[100] flex -translate-x-1/2 -translate-y-full flex-col items-center gap-1.5"
      style={{ left: pos.left, top: pos.top }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {isMarkingThis && markMode === "marking" ? (
        <div className="vad-selection-edit mb-1 flex w-[min(300px,70vw)] items-center justify-between gap-2 rounded-xl border border-red-500/40 bg-[var(--surface)] px-3 py-2 shadow-[var(--shadow-elevated)]">
          <p className="text-[11px] font-medium text-[var(--foreground)]">
            在图上拖拽框选要重绘的区域
          </p>
          <button
            type="button"
            onClick={() => {
              cancelMark();
              setEditError(null);
            }}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-[var(--muted)] hover:bg-[var(--surface-muted)]"
          >
            <X className="size-3" />
            Esc
          </button>
        </div>
      ) : null}

      {isMarkingThis && markMode === "instruct" && asset ? (
        <div className="vad-selection-edit mb-1 w-[min(320px,70vw)] rounded-xl border border-red-500/40 bg-[var(--surface)] p-2.5 shadow-[var(--shadow-elevated)]">
          <p className="mb-1.5 text-[10px] font-semibold text-[var(--muted)]">
            框选重绘 · 只改红框区域，其余保持
          </p>
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={3}
            placeholder="例如：把这里改成蓝色主按钮…"
            className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-2.5 py-2 text-[11px] leading-relaxed text-[var(--foreground)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--primary)]"
            disabled={editBusy}
            autoFocus
          />
          {editError ? (
            <p className="mt-1 text-[10px] text-red-600 dark:text-red-400">
              {editError}
            </p>
          ) : null}
          <div className="mt-2 flex justify-end gap-1.5">
            <button
              type="button"
              disabled={editBusy}
              onClick={() => {
                cancelMark();
                setEditError(null);
              }}
              className="rounded-md px-2.5 py-1 text-[11px] text-[var(--muted)] hover:bg-[var(--surface-muted)]"
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
              className="inline-flex items-center gap-1 rounded-md bg-[var(--primary)] px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-40"
            >
              {editBusy ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Pencil className="size-3" />
              )}
              生成
            </button>
          </div>
        </div>
      ) : null}

      {!isMarkingThis && editError ? (
        <p className="mb-1 max-w-[280px] rounded-lg bg-red-500/10 px-2 py-1 text-[10px] text-red-600 dark:text-red-400">
          {editError}
        </p>
      ) : null}

      <div className="vad-selection-bar flex items-center gap-0.5 p-1">
        {actions.map(({ key, label, icon: Icon, onClick, disabled, active }) => (
          <button
            key={key}
            type="button"
            disabled={disabled}
            data-tip={label}
            data-tip-bottom=""
            aria-label={label}
            onClick={onClick}
            className={
              "vad-selection-bar-btn flex h-8 items-center gap-1.5 px-2.5 text-[11px] font-medium transition-colors disabled:opacity-35 " +
              (active ? "vad-selection-bar-btn--active" : "")
            }
          >
            <Icon className="size-3.5" />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

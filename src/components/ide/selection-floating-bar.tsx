"use client";

/**
 * 选中元素浮动操作条 — 画板/生图选中后的上下文操作（Lovart 式）
 * 含：收藏 / 变体 / 局部重绘 / 下载 / 移除
 * @author：wangjunhua
 */

import { useEffect, useState } from "react";
import {
  Download,
  Focus,
  Loader2,
  Pencil,
  RefreshCw,
  Sparkles,
  Star,
  Trash2,
} from "lucide-react";
import { useEditor, useValue } from "tldraw";
import { useCanvasSelectionStore } from "@/store/canvas-selection-store";
import { useProjectStore } from "@/store/project-store";
import { useProviderStore } from "@/store/provider-store";
import type { ImageAsset } from "@/lib/project/assets-schema";

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
    selection ? s.projects[selection.projectId] ?? null : null
  );

  const screenBounds = useValue(
    "selection screen bounds",
    () => editor.getSelectionScreenBounds(),
    [editor]
  );

  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editText, setEditText] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

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
    setEditOpen(false);
    setEditText("");
    setEditError(null);
  }, [selection?.assetId, selection?.kind]);

  if (!selection || !pos || !project) return null;

  const asset =
    selection.kind === "asset" && selection.assetId
      ? project.assets?.find((a) => a.id === selection.assetId)
      : null;

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

  async function submitLocalEdit() {
    if (!asset?.src || !project || !editText.trim() || editBusy) return;
    setEditBusy(true);
    setEditError(null);
    try {
      const instruction = editText.trim();
      const res = await fetch("/api/agents/image/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: `Edit this image based on the instruction. Keep overall composition unless asked otherwise. Instruction: ${instruction}. Original prompt context: ${asset.prompt}`,
          n: 1,
          width: asset.width || 1024,
          height: asset.height || 1024,
          visualStyle: project.brief?.visualStyle,
          referenceImages: [asset.src],
          providerConfig,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
      }
      const raw = (data.assets as ImageAsset[]) ?? [];
      if (raw.length === 0) throw new Error("局部重绘未返回素材");
      const nextAssets = raw.map((a) => ({
        ...a,
        parentAssetId: asset.id,
        editInstruction: instruction,
        source: "edited" as const,
        status: "candidate" as const,
        role: asset.role ?? a.role,
      }));
      upsert({
        ...project,
        assets: [...(project.assets ?? []), ...nextAssets],
        updatedAt: new Date().toISOString(),
      });
      setEditOpen(false);
      setEditText("");
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
            label: "局部重绘",
            icon: Pencil,
            onClick: () => setEditOpen((v) => !v),
            active: editOpen,
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
      {editOpen && asset ? (
        <div className="vad-selection-edit mb-1 w-[min(320px,70vw)] rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2.5 shadow-[var(--shadow-elevated)]">
          <p className="mb-1.5 text-[10px] font-semibold text-[var(--muted)]">
            局部重绘 · 以当前图为参考，按指令生成新版本
          </p>
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            rows={3}
            placeholder="例如：把背景改成深色、标题改成白色、去掉右侧插图…"
            className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-2.5 py-2 text-[11px] leading-relaxed text-[var(--foreground)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--primary)]"
            disabled={editBusy}
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
                setEditOpen(false);
                setEditError(null);
              }}
              className="rounded-md px-2.5 py-1 text-[11px] text-[var(--muted)] hover:bg-[var(--surface-muted)]"
            >
              取消
            </button>
            <button
              type="button"
              disabled={editBusy || !editText.trim()}
              onClick={() => void submitLocalEdit()}
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

"use client";

import { useEffect, type ReactNode, type SyntheticEvent } from "react";
import { X } from "lucide-react";

export type ImageLightboxItem = {
  src: string;
  title?: string;
  subtitle?: string;
};

/** 全屏图片预览；Esc / 点遮罩关闭 */
export function ImageLightbox({
  item,
  onClose,
}: {
  item: ImageLightboxItem | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!item) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [item, onClose]);

  if (!item?.src) return null;

  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center bg-black/72 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label={item.title || "图片预览"}
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[min(92vh,920px)] w-full max-w-[min(96vw,1200px)] flex-col overflow-hidden rounded-xl border border-white/15 bg-[#12131a] shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-white">
              {item.title || "图片预览"}
            </p>
            {item.subtitle ? (
              <p className="mt-0.5 truncate text-[11px] text-white/55">
                {item.subtitle}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-white/70 transition hover:bg-white/10 hover:text-white"
            aria-label="关闭预览"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.06),transparent_65%)] p-3 sm:p-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.src}
            alt={item.title || "preview"}
            className="max-h-[min(78vh,820px)] max-w-full object-contain"
            draggable={false}
          />
        </div>
      </div>
    </div>
  );
}

/** 可点击缩略图，打开预览；用 div 避免嵌套在外层 button 内引发 hydration 错误 */
export function PreviewableThumb({
  src,
  title,
  subtitle,
  className,
  imgClassName,
  onPreview,
  children,
}: {
  src: string;
  title?: string;
  subtitle?: string;
  className?: string;
  imgClassName?: string;
  onPreview: (item: ImageLightboxItem) => void;
  children?: ReactNode;
}) {
  const open = (e: SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onPreview({ src, title, subtitle });
  };

  return (
    <div
      role="button"
      tabIndex={0}
      className={
        "relative shrink-0 cursor-pointer overflow-hidden rounded-md border border-[var(--border)] bg-[var(--surface-muted)] transition hover:ring-2 hover:ring-[var(--primary)]/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] " +
        (className ?? "size-12")
      }
      title="点击预览"
      aria-label={title ? `预览 ${title}` : "预览图片"}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          open(e);
        }
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        className={imgClassName ?? "size-full object-cover"}
        draggable={false}
      />
      {children}
    </div>
  );
}

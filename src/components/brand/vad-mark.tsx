import { cn } from "@/lib/cn";

/**
 * 官方选框标志（logo/assets_logo-a-classic.svg）。
 * 描边与角点走 currentColor，深浅色都能用。
 */
export function VadMark({
  size = 32,
  className,
  title = "Vibeboard",
}: {
  size?: number;
  className?: string;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      className={cn("vad-mark", className)}
      role="img"
      aria-label={title}
    >
      <rect x="7" y="7" width="18" height="18" rx="2.2" stroke="currentColor" strokeWidth="1.6" />
      <rect x="5.15" y="5.15" width="3.7" height="3.7" rx="0.35" fill="currentColor" />
      <rect x="23.15" y="5.15" width="3.7" height="3.7" rx="0.35" fill="currentColor" />
      <rect x="5.15" y="23.15" width="3.7" height="3.7" rx="0.35" fill="currentColor" />
      <rect x="23.15" y="23.15" width="3.7" height="3.7" rx="0.35" fill="currentColor" />
      <rect x="13.6" y="14.6" width="8.4" height="7" rx="1.1" fill="currentColor" />
    </svg>
  );
}

export function VadWordmark({
  markSize = 22,
  className,
}: {
  markSize?: number;
  className?: string;
}) {
  return (
    <span className={cn("vad-wordmark", className)}>
      <VadMark size={markSize} />
      <span className="vad-wordmark-text">
        <b>Vibe</b>board
      </span>
    </span>
  );
}

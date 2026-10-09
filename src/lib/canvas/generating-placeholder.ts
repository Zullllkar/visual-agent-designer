/**
 * 生图进行中占位图
 * @author：wangjunhua
 */

export const GENERATING_PLACEHOLDER_WIDTH = 320;
export const GENERATING_PLACEHOLDER_HEIGHT = 240;

export const GENERATING_PLACEHOLDER_SRC =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${GENERATING_PLACEHOLDER_WIDTH}" height="${GENERATING_PLACEHOLDER_HEIGHT}" viewBox="0 0 ${GENERATING_PLACEHOLDER_WIDTH} ${GENERATING_PLACEHOLDER_HEIGHT}">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#e2e4e9"/>
          <stop offset="100%" stop-color="#d5d8de"/>
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
      <circle cx="160" cy="108" r="28" fill="none" stroke="#141416" stroke-width="3" stroke-dasharray="8 10" opacity="0.55">
        <animateTransform attributeName="transform" type="rotate" from="0 160 108" to="360 160 108" dur="1.2s" repeatCount="indefinite"/>
      </circle>
      <text x="160" y="168" text-anchor="middle" fill="#141416" font-size="13" font-family="ui-sans-serif,system-ui,sans-serif" opacity="0.7">生成中…</text>
    </svg>`,
  );

export function isGeneratingPlaceholderSrc(src: string | undefined): boolean {
  return Boolean(src?.startsWith("data:image/svg+xml"));
}

export function isPlaceholderNaturalSize(width: number, height: number): boolean {
  return width === GENERATING_PLACEHOLDER_WIDTH && height === GENERATING_PLACEHOLDER_HEIGHT;
}

/**
 * 占位 SVG 的 intrinsic 尺寸是 320x240。src 换成真图后，img 的 ref 仍可能
 * 短暂读到旧的 320x240，绝不能把它写进资产元数据，否则 Agent 会把已出图
 * 误判成失败占位。
 */
export function shouldApplyNaturalImageSize(input: {
  src: string | undefined;
  naturalWidth: number;
  naturalHeight: number;
  currentWidth?: number;
  currentHeight?: number;
}): boolean {
  if (!input.src || isGeneratingPlaceholderSrc(input.src)) return false;
  if (input.naturalWidth < 2 || input.naturalHeight < 2) return false;
  if (
    isPlaceholderNaturalSize(input.naturalWidth, input.naturalHeight) &&
    !isPlaceholderNaturalSize(input.currentWidth ?? 0, input.currentHeight ?? 0)
  ) {
    return false;
  }
  return true;
}

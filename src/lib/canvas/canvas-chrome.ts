/**
 * 画布视觉令牌（Lovart / 设计工具风格）
 * --------------------------------------------------------------
 * 供 tldraw 自定义 shape 与 IDE 画布区共用，保证亮色/深色一致的高级感。
 *
 * @author：wangjunhua
 */

export const CANVAS_CHROME = {
  light: {
    canvasBg: "#edeef1",
    dot: "rgba(20, 20, 22, 0.08)",
    primary: "#141416",
    primaryMuted: "rgba(20, 20, 22, 0.45)",
    accent: "#141416",
    surface: "#ffffff",
    surfaceMuted: "#e2e4e9",
    border: "#e2e4e9",
    borderStrong: "rgba(20, 20, 22, 0.35)",
    text: "#141416",
    textMuted: "#5c616b",
    caption: "rgba(24, 24, 28, 0.66)",
    cardShadow:
      "0 1px 2px rgba(24, 24, 28, 0.05), 0 4px 12px rgba(24, 24, 28, 0.06), 0 12px 36px rgba(24, 24, 28, 0.08)",
    cardShadowHover:
      "0 2px 4px rgba(20, 20, 22, 0.06), 0 10px 28px rgba(20, 20, 22, 0.1)",
    matInset: "inset 0 1px 0 rgba(255, 255, 255, 0.9)",
    flowStroke: "#141416",
    flowLabel: "#141416",
    status: {
      generating: {
        bg: "rgba(20, 20, 22, 0.08)",
        fg: "#141416",
        border: "rgba(20, 20, 22, 0.2)",
      },
      candidate: { bg: "#fff8eb", fg: "#92400e", border: "rgba(146, 64, 14, 0.2)" },
      starred: { bg: "#f5f3ff", fg: "#5b21b6", border: "rgba(91, 33, 182, 0.2)" },
      used: { bg: "#ecfdf5", fg: "#047857", border: "rgba(4, 120, 87, 0.2)" },
      discarded: { bg: "#f4f4f5", fg: "#52525b", border: "rgba(82, 82, 91, 0.15)" },
    },
  },
  dark: {
    canvasBg: "#0e0f12",
    dot: "rgba(242, 243, 245, 0.1)",
    primary: "#f2f3f5",
    primaryMuted: "rgba(242, 243, 245, 0.55)",
    accent: "#f2f3f5",
    surface: "#17181d",
    surfaceMuted: "#202228",
    border: "#2a2c33",
    borderStrong: "rgba(242, 243, 245, 0.4)",
    text: "#f2f3f5",
    textMuted: "#9aa0aa",
    caption: "rgba(232, 234, 239, 0.78)",
    cardShadow:
      "0 1px 0 rgba(232, 234, 239, 0.04), 0 4px 16px rgba(0, 0, 0, 0.35), 0 16px 48px rgba(0, 0, 0, 0.4)",
    cardShadowHover:
      "0 2px 0 rgba(232, 234, 239, 0.06), 0 12px 32px rgba(0, 0, 0, 0.45)",
    matInset: "inset 0 1px 0 rgba(232, 234, 239, 0.06)",
    flowStroke: "#f2f3f5",
    flowLabel: "#f2f3f5",
    status: {
      generating: {
        bg: "rgba(242, 243, 245, 0.12)",
        fg: "#f2f3f5",
        border: "rgba(242, 243, 245, 0.28)",
      },
      candidate: { bg: "rgba(245, 158, 11, 0.15)", fg: "#fbbf24", border: "rgba(251, 191, 36, 0.25)" },
      starred: { bg: "rgba(139, 92, 246, 0.15)", fg: "#c4b5fd", border: "rgba(196, 181, 253, 0.25)" },
      used: { bg: "rgba(16, 185, 129, 0.12)", fg: "#6ee7b7", border: "rgba(110, 231, 183, 0.25)" },
      discarded: { bg: "rgba(113, 113, 122, 0.2)", fg: "#a1a1aa", border: "rgba(161, 161, 170, 0.2)" },
    },
  },
} as const;

export type CanvasChromePalette =
  (typeof CANVAS_CHROME)["light"] | (typeof CANVAS_CHROME)["dark"];

/** 读取当前主题的画布色板（仅在 client 组件内调用） */
export function getCanvasChromePalette(): CanvasChromePalette {
  if (typeof document === "undefined") return CANVAS_CHROME.light;
  return document.documentElement.classList.contains("dark")
    ? CANVAS_CHROME.dark
    : CANVAS_CHROME.light;
}

export const CARD_RADIUS = 18;
export const CARD_INNER_RADIUS = 14;
export const CARD_PAD = 6;

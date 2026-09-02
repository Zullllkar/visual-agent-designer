/**
 * 画布视觉令牌（Lovart / 设计工具风格）
 * --------------------------------------------------------------
 * 供 tldraw 自定义 shape 与 IDE 画布区共用，保证亮色/深色一致的高级感。
 *
 * @author：wangjunhua
 */

export const CANVAS_CHROME = {
  light: {
    canvasBg: "#f4f2ec",
    dot: "rgba(26, 25, 22, 0.11)",
    primary: "#c96b5c",
    primaryMuted: "rgba(201, 107, 92, 0.55)",
    accent: "#c96b5c",
    surface: "#fafaf7",
    surfaceMuted: "#e9e7e0",
    border: "rgba(26, 25, 22, 0.1)",
    borderStrong: "rgba(201, 107, 92, 0.35)",
    text: "#1a1916",
    textMuted: "#5c5850",
    caption: "rgba(26, 25, 22, 0.66)",
    cardShadow:
      "0 1px 2px rgba(26, 25, 22, 0.05), 0 4px 12px rgba(26, 25, 22, 0.06), 0 12px 36px rgba(26, 25, 22, 0.08)",
    cardShadowHover:
      "0 2px 4px rgba(26, 25, 22, 0.06), 0 10px 28px rgba(26, 25, 22, 0.1), 0 20px 48px rgba(201, 107, 92, 0.08)",
    matInset: "inset 0 1px 0 rgba(250, 250, 247, 0.9)",
    flowStroke: "#c96b5c",
    flowLabel: "#aa5145",
    status: {
      generating: {
        bg: "rgba(201, 107, 92, 0.1)",
        fg: "#aa5145",
        border: "rgba(201, 107, 92, 0.25)",
      },
      candidate: { bg: "#fff8eb", fg: "#92400e", border: "rgba(146, 64, 14, 0.2)" },
      starred: { bg: "#f5f3ff", fg: "#5b21b6", border: "rgba(91, 33, 182, 0.2)" },
      used: { bg: "#ecfdf5", fg: "#047857", border: "rgba(4, 120, 87, 0.2)" },
      discarded: { bg: "#f4f4f5", fg: "#52525b", border: "rgba(82, 82, 91, 0.15)" },
    },
  },
  dark: {
    canvasBg: "#161412",
    dot: "rgba(241, 239, 232, 0.1)",
    primary: "#d4897a",
    primaryMuted: "rgba(212, 137, 122, 0.6)",
    accent: "#d4897a",
    surface: "#1e1c19",
    surfaceMuted: "#25221e",
    border: "rgba(241, 239, 232, 0.1)",
    borderStrong: "rgba(201, 107, 92, 0.35)",
    text: "#f1efe8",
    textMuted: "#9a958c",
    caption: "rgba(241, 239, 232, 0.78)",
    cardShadow:
      "0 1px 0 rgba(241, 239, 232, 0.04), 0 4px 16px rgba(0, 0, 0, 0.35), 0 16px 48px rgba(0, 0, 0, 0.4)",
    cardShadowHover:
      "0 2px 0 rgba(241, 239, 232, 0.06), 0 12px 32px rgba(0, 0, 0, 0.45)",
    matInset: "inset 0 1px 0 rgba(241, 239, 232, 0.06)",
    flowStroke: "#d4897a",
    flowLabel: "#e09a8c",
    status: {
      generating: {
        bg: "rgba(201, 107, 92, 0.16)",
        fg: "#e09a8c",
        border: "rgba(201, 107, 92, 0.32)",
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

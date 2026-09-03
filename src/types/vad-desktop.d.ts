import type { StudioCommandDetail } from "@/lib/studio/commands";

export type VadDesktopWindowAction = "minimize" | "maximize" | "close";

export type VadDesktopMenuId = "file" | "edit" | "view" | "help";

export type VadDesktopPathId = "vadRoot" | "userData" | "logs";

export interface VadDesktopInfo {
  runtime: "electron";
  packaged: boolean;
  version: string;
  platform: NodeJS.Platform;
  vadRoot: string;
  checkpoints: string;
  logsDir: string;
  port: number;
}

export interface VadDesktopBridge {
  runtime: "electron";
  getInfo: () => Promise<VadDesktopInfo>;
  window: (action: VadDesktopWindowAction) => void;
  isMaximized: () => Promise<boolean>;
  popupMenu: (payload: { id: VadDesktopMenuId; x: number; y: number }) => void;
  openPath: (which: VadDesktopPathId) => void;
  openProjectDir: (projectId: string) => void;
  /** 打开外部 http(s) 链接或 coding agent 深链（cursor://…）。 */
  openExternal: (url: string) => void;
  setTitleBarTheme: (theme: "light" | "dark") => void;
  setRecents: (items: Array<{ id: string; title: string }>) => void;
  onCommand: (handler: (detail: StudioCommandDetail) => void) => () => void;
  saveFile: (input: {
    defaultPath: string;
    data: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }) => Promise<{ ok: boolean; canceled?: boolean; path?: string }>;
  openFile: (input?: {
    filters?: Array<{ name: string; extensions: string[] }>;
  }) => Promise<{
    ok: boolean;
    canceled?: boolean;
    data?: string;
    path?: string;
  }>;
  pickDirectory: () => Promise<{ ok: boolean; canceled?: boolean; path?: string }>;
}

declare global {
  interface Window {
    vadDesktop?: VadDesktopBridge;
  }
}

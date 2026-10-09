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
  /** 设置打开时让系统标题栏按钮区域透出后面的模糊层，高度保持不变。 */
  setTitleBarScrim?: (scrim: boolean) => void;
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
  /** 把 provider 配置（含 key）交给主进程加密进系统钥匙串，并推给 Next 供 bridge 使用。 */
  saveProviderConfig: (
    json: string
  ) => Promise<{ ok: boolean; persisted?: boolean; reason?: string }>;
  clearProviderConfig: () => Promise<{ ok: boolean; persisted?: boolean; reason?: string }>;
}

declare global {
  interface Window {
    vadDesktop?: VadDesktopBridge;
  }
}

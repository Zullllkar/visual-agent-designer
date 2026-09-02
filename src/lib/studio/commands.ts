export type StudioCommandId =
  | "new-brief"
  | "open-settings"
  | "open-gallery"
  | "open-vad-root"
  | "open-logs"
  | "open-project"
  | "import-project"
  | "quit"
  | "toggle-rail"
  | "toggle-motion";

export interface FileMenuCommand {
  id: Exclude<StudioCommandId, "open-project" | "toggle-rail" | "toggle-motion">;
  label: string;
}

export const FILE_MENU_COMMANDS: FileMenuCommand[] = [
  { id: "new-brief", label: "开始创作" },
  { id: "import-project", label: "导入项目" },
  { id: "open-settings", label: "设置" },
  { id: "open-gallery", label: "全部创作" },
  { id: "open-vad-root", label: "打开项目目录" },
  { id: "open-logs", label: "打开日志" },
  { id: "quit", label: "退出" },
];

export const STUDIO_COMMAND_EVENT = "vad-studio-command";

export interface StudioCommandDetail {
  id: StudioCommandId;
  projectId?: string;
  section?: "general" | "models" | "storage" | "shortcuts" | "about";
}

export function dispatchStudioCommand(id: StudioCommandId, projectId?: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<StudioCommandDetail>(STUDIO_COMMAND_EVENT, {
      detail: { id, projectId },
    })
  );
}

export interface StudioShortcut {
  keys: string;
  action: string;
}

export const STUDIO_SHORTCUTS: StudioShortcut[] = [
  { keys: "Ctrl / ⌘ + Enter", action: "提交 Brief，打开画布" },
  { keys: "Ctrl / ⌘ + K", action: "搜索本地项目" },
  { keys: "Ctrl / ⌘ + ,", action: "打开设置" },
  { keys: "Esc", action: "关闭设置或侧栏" },
  { keys: "Ctrl / ⌘ + +", action: "画布放大" },
  { keys: "Ctrl / ⌘ + -", action: "画布缩小" },
  { keys: "Ctrl / ⌘ + 0", action: "画布实际大小" },
];

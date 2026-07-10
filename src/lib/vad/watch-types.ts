/**
 * .vad 文件变更事件类型
 * --------------------------------------------------------------
 * @author：wangjunhua
 */

export type VadWatchKind =
  | "project"
  | "canvas"
  | "page"
  | "chat"
  | "artifact";

export interface VadWatchEvent {
  projectId: string;
  kind: VadWatchKind;
  /** 相对项目目录的路径，如 project.json、design/pages/home.canvas.json */
  relPath: string;
  at: string;
}

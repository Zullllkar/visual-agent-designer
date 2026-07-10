/**
 * .vad 文件树类型（客户端/服务端共用）
 * @author：wangjunhua
 */

export interface VadFileNode {
  path: string;
  name: string;
  kind: "file" | "directory";
  size?: number;
  children?: VadFileNode[];
}

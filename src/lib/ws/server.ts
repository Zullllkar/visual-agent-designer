/**
 * WebSocket 服务器初始化
 * --------------------------------------------------------------
 * 导出 attachWebSocketHandler，供 server.ts 调用。
 */

export { attachWebSocketHandler } from "./handler";
export { connectionManager } from "./connection-manager";
export { eventBuffer } from "./event-buffer";
export type { WsCommand, WsEvent } from "./types";

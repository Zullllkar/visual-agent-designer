/**
 * WebSocket Logger
 * --------------------------------------------------------------
 * 结构化日志记录 WebSocket 连接和事件。
 * 支持控制台输出和可配置的日志级别。
 */

export type WsLogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  timestamp: string;
  level: WsLogLevel;
  category: string;
  message: string;
  data?: Record<string, unknown>;
}

const LEVEL_PRIORITY: Record<WsLogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class WsLogger {
  private minLevel: WsLogLevel;
  private enabled: boolean;

  constructor() {
    this.minLevel = (process.env.WS_LOG_LEVEL as WsLogLevel) ?? "info";
    this.enabled = process.env.WS_LOG_ENABLED !== "false";
  }

  setLevel(level: WsLogLevel): void {
    this.minLevel = level;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  private log(level: WsLogLevel, category: string, message: string, data?: Record<string, unknown>): void {
    if (!this.enabled || LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.minLevel]) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      category,
      message,
      data,
    };

    const prefix = `[${entry.timestamp}] [${level.toUpperCase()}] [ws:${category}]`;
    const suffix = data ? ` ${JSON.stringify(data)}` : "";

    switch (level) {
      case "error":
        console.error(`${prefix} ${message}${suffix}`);
        break;
      case "warn":
        console.warn(`${prefix} ${message}${suffix}`);
        break;
      case "debug":
        console.debug(`${prefix} ${message}${suffix}`);
        break;
      default:
        console.log(`${prefix} ${message}${suffix}`);
    }
  }

  debug(category: string, message: string, data?: Record<string, unknown>): void {
    this.log("debug", category, message, data);
  }

  info(category: string, message: string, data?: Record<string, unknown>): void {
    this.log("info", category, message, data);
  }

  warn(category: string, message: string, data?: Record<string, unknown>): void {
    this.log("warn", category, message, data);
  }

  error(category: string, message: string, data?: Record<string, unknown>): void {
    this.log("error", category, message, data);
  }

  /** 连接事件 */
  connection(action: "connect" | "disconnect" | "reconnect", data?: Record<string, unknown>): void {
    this.info("connection", `client ${action}`, data);
  }

  /** 订阅事件 */
  subscription(action: "subscribe" | "unsubscribe", projectId: string): void {
    this.info("subscription", `${action} project=${projectId}`);
  }

  /** 命令事件 */
  command(action: string, data?: Record<string, unknown>): void {
    this.info("command", `action=${action}`, data);
  }

  /** 事件推送 */
  event(type: string, seq?: number, data?: Record<string, unknown>): void {
    this.debug("event", `type=${type} seq=${seq ?? "?"}`, data);
  }

  /** 错误事件 */
  errorEvent(category: string, error: Error, data?: Record<string, unknown>): void {
    this.error(category, error.message, { ...data, stack: error.stack });
  }
}

export const wsLogger = new WsLogger();

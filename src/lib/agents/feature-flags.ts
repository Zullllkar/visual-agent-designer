/**
 * Feature Flags for Agent System
 * --------------------------------------------------------------
 * 控制新功能的启用/禁用，支持渐进式发布和 A/B 测试
 */

/**
 * Feature flags 配置
 */
export interface FeatureFlags {
  /** 启用并行工具执行 */
  enableParallelToolExecution: boolean;

  /** 启用智能上下文压缩 */
  enableContextCompression: boolean;

  /** 启用专业化 Agents 协作 */
  enableSpecializedAgents: boolean;

  /** 启用依赖图可视化（调试用） */
  enableDependencyGraphVisualization: boolean;

  /** 最大并发工具数 */
  maxToolConcurrency: number;

  /** 工具执行超时（毫秒） */
  toolExecutionTimeout: number;
}

/**
 * 默认 feature flags
 */
const DEFAULT_FLAGS: FeatureFlags = {
  enableParallelToolExecution: true,  // 默认启用并行执行
  enableContextCompression: false,    // 待测试后启用
  enableSpecializedAgents: false,     // 待集成后启用
  enableDependencyGraphVisualization: false,  // 仅调试时启用
  maxToolConcurrency: 5,
  toolExecutionTimeout: 5 * 60 * 1000, // 5 分钟
};

/**
 * 从环境变量加载 feature flags
 */
function loadFlagsFromEnv(): Partial<FeatureFlags> {
  const env = process.env;
  const flags: Partial<FeatureFlags> = {};

  // 并行工具执行
  if (env.ENABLE_PARALLEL_TOOLS !== undefined) {
    flags.enableParallelToolExecution = env.ENABLE_PARALLEL_TOOLS === "true";
  }

  // 上下文压缩
  if (env.ENABLE_CONTEXT_COMPRESSION !== undefined) {
    flags.enableContextCompression = env.ENABLE_CONTEXT_COMPRESSION === "true";
  }

  // 专业化 Agents
  if (env.ENABLE_SPECIALIZED_AGENTS !== undefined) {
    flags.enableSpecializedAgents = env.ENABLE_SPECIALIZED_AGENTS === "true";
  }

  // 依赖图可视化
  if (env.ENABLE_DEPENDENCY_GRAPH_VIZ !== undefined) {
    flags.enableDependencyGraphVisualization = env.ENABLE_DEPENDENCY_GRAPH_VIZ === "true";
  }

  // 最大并发数
  if (env.MAX_TOOL_CONCURRENCY !== undefined) {
    const value = parseInt(env.MAX_TOOL_CONCURRENCY, 10);
    if (!isNaN(value) && value > 0) {
      flags.maxToolConcurrency = value;
    }
  }

  // 工具超时
  if (env.TOOL_EXECUTION_TIMEOUT !== undefined) {
    const value = parseInt(env.TOOL_EXECUTION_TIMEOUT, 10);
    if (!isNaN(value) && value > 0) {
      flags.toolExecutionTimeout = value;
    }
  }

  return flags;
}

/**
 * 全局 feature flags 实例
 */
let globalFlags: FeatureFlags = {
  ...DEFAULT_FLAGS,
  ...loadFlagsFromEnv(),
};

/**
 * 获取当前 feature flags
 */
export function getFeatureFlags(): Readonly<FeatureFlags> {
  return { ...globalFlags };
}

/**
 * 更新 feature flags（仅用于测试）
 */
export function setFeatureFlags(flags: Partial<FeatureFlags>): void {
  globalFlags = { ...globalFlags, ...flags };
}

/**
 * 重置为默认 flags（仅用于测试）
 */
export function resetFeatureFlags(): void {
  globalFlags = {
    ...DEFAULT_FLAGS,
    ...loadFlagsFromEnv(),
  };
}

/**
 * 检查功能是否启用
 */
export function isFeatureEnabled(feature: keyof FeatureFlags): boolean {
  const value = globalFlags[feature];
  return typeof value === "boolean" ? value : false;
}

/**
 * 获取数值配置
 */
export function getNumericConfig(key: "maxToolConcurrency" | "toolExecutionTimeout"): number {
  return globalFlags[key];
}

/**
 * 打印当前配置（调试用）
 */
export function printFeatureFlags(): void {
  console.log("=== Feature Flags Configuration ===");
  console.log(`Parallel Tool Execution: ${globalFlags.enableParallelToolExecution}`);
  console.log(`Context Compression: ${globalFlags.enableContextCompression}`);
  console.log(`Specialized Agents: ${globalFlags.enableSpecializedAgents}`);
  console.log(`Dependency Graph Viz: ${globalFlags.enableDependencyGraphVisualization}`);
  console.log(`Max Tool Concurrency: ${globalFlags.maxToolConcurrency}`);
  console.log(`Tool Execution Timeout: ${globalFlags.toolExecutionTimeout}ms`);
  console.log("====================================");
}

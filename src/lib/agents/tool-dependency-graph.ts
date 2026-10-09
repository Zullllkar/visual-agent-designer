/**
 * 工具依赖图分析
 * --------------------------------------------------------------
 * 分析工具之间的依赖关系，支持并行执行独立的工具。
 *
 * Phase 2 核心模块：
 * 1. 构建依赖图（基于工具名称的依赖关系）
 * 2. 拓扑排序（分层）
 * 3. 识别可并行执行的工具组
 */

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface DependencyNode {
  id: string;
  name: string;
  call: ToolCall;
  dependencies: string[]; // 依赖的工具名称列表
  dependents: string[]; // 依赖此工具的工具名称列表
}

export interface DependencyGraph {
  nodes: Map<string, DependencyNode>;
  layers: DependencyNode[][]; // 拓扑排序后的层级
}

/**
 * 工具依赖关系映射
 *
 * 规则：
 * - key: 工具名称
 * - value: 此工具依赖的其他工具名称数组
 * - 空数组 [] 表示无依赖，可以立即执行
 */
export const TOOL_DEPENDENCIES: Record<string, string[]> = {
  // ─────────────────────────────────────────────────────────────
  // 完全独立的工具（可以并行执行）
  // ─────────────────────────────────────────────────────────────

  // 图像生成类（可以并行生成多张图）
  "generate_images": [],
  "generate_image_variants": [],
  "restyle_images": [],
  "generate_video": [],

  // Mockup 生成（独立）
  "materialize_mockup": [],

  // 导出和截图（独立）
  "export_handoff": [],
  "screenshot_canvas": [],

  // 画布操作（独立）
  "inspect_canvas": [],
  "manipulate_canvas": [],
  "upsert_canvas_note": [],

  // 资产管理（独立）
  "star_asset": [],
  "batch_delete_assets": [],
  "adopt_asset_style": [],

  // 查询类（独立）
  "answer_question": [],
  "job_status": [],

  // 文件系统（独立）
  "file_system": [],
  "persist_sandbox_file": [],
  "execute": [],

  // 品牌资产（独立）
  "brand_kit": [],

  // ─────────────────────────────────────────────────────────────
  // 有依赖关系的工具（必须按顺序执行）
  // ─────────────────────────────────────────────────────────────

  // Brief 流程（串行）
  "ask_discovery": [],
  "generate_brief": ["ask_discovery"], // 需要先询问问题

  // 设计方向流程（串行）
  "plan_design_direction": ["generate_brief"], // 需要先有 brief
  "confirm_direction": ["plan_design_direction"], // 需要先规划方向

  // 任务委托（可能依赖其他工具的结果）
  "delegate_task": [], // 保守策略：默认无依赖，但可以根据 args 动态分析
};

/**
 * 动态依赖分析器
 *
 * 某些工具的依赖关系取决于参数，例如：
 * - generate_image_variants 如果 args.baseImageId 引用了前面生成的图，则有依赖
 * - restyle_images 如果 args.targetAssetIds 引用了前面的资产，则有依赖
 */
export function analyzeDynamicDependencies(
  call: ToolCall,
  previousCalls: ToolCall[]
): string[] {
  const staticDeps = TOOL_DEPENDENCIES[call.name] || [];

  // 如果工具已有静态依赖，直接返回
  if (staticDeps.length > 0) {
    return staticDeps;
  }

  // 动态分析
  switch (call.name) {
    case "generate_image_variants":
      // 如果 baseImageId 是前面某个 generate_images 调用的结果
      if (call.args.baseImageId) {
        const baseImageCall = previousCalls.find(
          prev => prev.name === "generate_images" || prev.name === "materialize_mockup"
        );
        if (baseImageCall) {
          return [baseImageCall.name];
        }
      }
      return [];

    case "restyle_images":
      // 如果 targetAssetIds 引用了前面生成的资产
      const targetIds = call.args.targetAssetIds as string[] | undefined;
      if (targetIds && targetIds.length > 0) {
        const assetGenCalls = previousCalls.filter(
          prev => prev.name === "generate_images" || prev.name === "materialize_mockup"
        );
        if (assetGenCalls.length > 0) {
          return [assetGenCalls[0].name]; // 保守策略：依赖第一个资产生成
        }
      }
      return [];

    case "adopt_asset_style":
      // 如果引用了其他资产的风格
      if (call.args.sourceAssetId) {
        const sourceCall = previousCalls.find(
          prev => prev.name === "generate_images"
        );
        if (sourceCall) {
          return [sourceCall.name];
        }
      }
      return [];

    default:
      return [];
  }
}

/**
 * 构建工具依赖图
 *
 * @param calls - 要执行的工具调用列表
 * @returns 依赖图，包含节点和拓扑排序的层级
 */
export function buildDependencyGraph(calls: ToolCall[]): DependencyGraph {
  const nodes = new Map<string, DependencyNode>();

  // 1. 创建节点
  calls.forEach(call => {
    const deps = analyzeDynamicDependencies(call, calls);
    nodes.set(call.id, {
      id: call.id,
      name: call.name,
      call,
      dependencies: deps,
      dependents: [],
    });
  });

  // 2. 建立反向依赖关系（哪些工具依赖此工具）
  nodes.forEach(node => {
    node.dependencies.forEach(depName => {
      // 找到依赖的工具节点
      const depNode = Array.from(nodes.values()).find(n => n.name === depName);
      if (depNode) {
        depNode.dependents.push(node.name);
      }
    });
  });

  // 3. 拓扑排序（分层）
  const layers = topologicalSort(nodes);

  return { nodes, layers };
}

/**
 * 拓扑排序（Kahn 算法）
 *
 * 将依赖图分层：
 * - Layer 0: 无依赖的工具（可以立即执行）
 * - Layer 1: 只依赖 Layer 0 的工具
 * - Layer 2: 只依赖 Layer 0-1 的工具
 * - ...
 *
 * 同一层的工具可以并行执行。
 */
function topologicalSort(nodes: Map<string, DependencyNode>): DependencyNode[][] {
  const layers: DependencyNode[][] = [];
  const visited = new Set<string>();
  const inDegree = new Map<string, number>();

  // 1. 计算每个节点的入度（有多少个依赖）
  nodes.forEach(node => {
    inDegree.set(node.id, node.dependencies.length);
  });

  // 2. 分层处理
  while (visited.size < nodes.size) {
    const currentLayer: DependencyNode[] = [];

    // 找到所有入度为 0 的节点（无依赖或依赖已满足）
    nodes.forEach(node => {
      if (visited.has(node.id)) return;

      const remainingDeps = node.dependencies.filter(depName => {
        const depNode = Array.from(nodes.values()).find(n => n.name === depName);
        return depNode && !visited.has(depNode.id);
      });

      if (remainingDeps.length === 0) {
        currentLayer.push(node);
      }
    });

    // 如果找不到无依赖的节点，说明有循环依赖
    if (currentLayer.length === 0 && visited.size < nodes.size) {
      console.error("[DependencyGraph] 检测到循环依赖");
      // 将剩余节点强制加入最后一层（保守策略）
      nodes.forEach(node => {
        if (!visited.has(node.id)) {
          currentLayer.push(node);
        }
      });
    }

    // 标记当前层的节点为已访问
    currentLayer.forEach(node => visited.add(node.id));

    if (currentLayer.length > 0) {
      layers.push(currentLayer);
    }
  }

  return layers;
}

/**
 * 获取可并行执行的工具组
 *
 * @param calls - 工具调用列表
 * @returns 二维数组，每个子数组是一组可以并行执行的工具
 *
 * @example
 * ```typescript
 * const calls = [
 *   { id: "1", name: "generate_images", args: {...} },
 *   { id: "2", name: "generate_images", args: {...} },
 *   { id: "3", name: "materialize_mockup", args: {...} },
 * ];
 *
 * const groups = getParallelExecutionGroups(calls);
 * // [[call1, call2, call3]] - 所有都可以并行
 * ```
 */
export function getParallelExecutionGroups(calls: ToolCall[]): ToolCall[][] {
  const graph = buildDependencyGraph(calls);
  return graph.layers.map(layer => layer.map(node => node.call));
}

/**
 * 检查两个工具调用是否可以并行执行
 *
 * @param call1 - 第一个工具调用
 * @param call2 - 第二个工具调用
 * @returns true 如果可以并行执行
 */
export function canExecuteInParallel(call1: ToolCall, call2: ToolCall): boolean {
  const deps1 = TOOL_DEPENDENCIES[call1.name] || [];
  const deps2 = TOOL_DEPENDENCIES[call2.name] || [];

  // 如果 call2 依赖 call1，不能并行
  if (deps2.includes(call1.name)) {
    return false;
  }

  // 如果 call1 依赖 call2，不能并行
  if (deps1.includes(call2.name)) {
    return false;
  }

  // 否则可以并行
  return true;
}

/**
 * 打印依赖图（调试用）
 */
export function printDependencyGraph(graph: DependencyGraph): void {
  console.log("\n[DependencyGraph] 工具依赖图:");
  console.log("─".repeat(60));

  graph.layers.forEach((layer, index) => {
    console.log(`\nLayer ${index} (${layer.length} 个工具并行):`);
    layer.forEach(node => {
      const depsStr = node.dependencies.length > 0
        ? `依赖: ${node.dependencies.join(", ")}`
        : "无依赖";
      console.log(`  • ${node.name} (${node.id}) - ${depsStr}`);
    });
  });

  console.log("\n" + "─".repeat(60));
}

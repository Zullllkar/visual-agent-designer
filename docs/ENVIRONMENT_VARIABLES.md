# 环境变量配置指南

本项目支持通过环境变量控制 Agent 系统的行为。

## Feature Flags（功能开关）

### ENABLE_PARALLEL_TOOLS
**默认值**: `true`  
**说明**: 启用并行工具执行，显著提升性能。

```bash
# 启用（默认）
ENABLE_PARALLEL_TOOLS=true

# 禁用（回退到串行执行）
ENABLE_PARALLEL_TOOLS=false
```

### ENABLE_CONTEXT_COMPRESSION
**默认值**: `false`  
**说明**: 启用智能上下文压缩，避免粗暴清空记忆。

```bash
# 启用
ENABLE_CONTEXT_COMPRESSION=true

# 禁用（默认）
ENABLE_CONTEXT_COMPRESSION=false
```

### ENABLE_SPECIALIZED_AGENTS
**默认值**: `false`  
**说明**: 启用专业化 Agents 协作模式。

```bash
# 启用
ENABLE_SPECIALIZED_AGENTS=true

# 禁用（默认）
ENABLE_SPECIALIZED_AGENTS=false
```

### ENABLE_DEPENDENCY_GRAPH_VIZ
**默认值**: `false`  
**说明**: 启用工具依赖图可视化（仅调试用）。

```bash
# 启用（会在控制台打印 ASCII 依赖图）
ENABLE_DEPENDENCY_GRAPH_VIZ=true

# 禁用（默认）
ENABLE_DEPENDENCY_GRAPH_VIZ=false
```

## 性能配置

### MAX_TOOL_CONCURRENCY
**默认值**: `5`  
**说明**: 最大并发工具数。

```bash
# 默认值
MAX_TOOL_CONCURRENCY=5

# 高性能（需要足够的 API 配额）
MAX_TOOL_CONCURRENCY=10

# 低配额（减少并发）
MAX_TOOL_CONCURRENCY=2
```

**推荐值**：
- 开发环境：`3-5`
- 生产环境：`5-10`（取决于 API 配额）
- 受限环境：`2-3`

### TOOL_EXECUTION_TIMEOUT
**默认值**: `300000`（5 分钟）  
**说明**: 单个工具执行超时时间（毫秒）。

```bash
# 默认值（5 分钟）
TOOL_EXECUTION_TIMEOUT=300000

# 更长超时（10 分钟）
TOOL_EXECUTION_TIMEOUT=600000

# 更短超时（2 分钟）
TOOL_EXECUTION_TIMEOUT=120000
```

**推荐值**：
- 图像生成工具：`300000`（5 分钟）
- 文本处理工具：`60000`（1 分钟）
- 快速工具：`30000`（30 秒）

## 配置方式

### 方式 1：`.env` 文件（推荐）

创建 `.env.local` 文件：

```bash
# Feature Flags
ENABLE_PARALLEL_TOOLS=true
ENABLE_CONTEXT_COMPRESSION=false
ENABLE_SPECIALIZED_AGENTS=false
ENABLE_DEPENDENCY_GRAPH_VIZ=false

# Performance
MAX_TOOL_CONCURRENCY=5
TOOL_EXECUTION_TIMEOUT=300000
```

### 方式 2：命令行环境变量

```bash
# Windows (PowerShell)
$env:ENABLE_PARALLEL_TOOLS="true"
$env:MAX_TOOL_CONCURRENCY="5"
npm run dev

# macOS/Linux (Bash)
export ENABLE_PARALLEL_TOOLS=true
export MAX_TOOL_CONCURRENCY=5
npm run dev
```

### 方式 3：package.json 脚本

```json
{
  "scripts": {
    "dev": "next dev",
    "dev:parallel": "ENABLE_PARALLEL_TOOLS=true next dev",
    "dev:serial": "ENABLE_PARALLEL_TOOLS=false next dev",
    "dev:debug": "ENABLE_DEPENDENCY_GRAPH_VIZ=true next dev"
  }
}
```

## 使用场景

### 场景 1：开发调试

```bash
# 启用依赖图可视化
ENABLE_DEPENDENCY_GRAPH_VIZ=true
ENABLE_PARALLEL_TOOLS=true
MAX_TOOL_CONCURRENCY=3
```

### 场景 2：性能测试

```bash
# 最大并行度
ENABLE_PARALLEL_TOOLS=true
MAX_TOOL_CONCURRENCY=10
TOOL_EXECUTION_TIMEOUT=600000
```

### 场景 3：受限环境（低 API 配额）

```bash
# 减少并发
ENABLE_PARALLEL_TOOLS=true
MAX_TOOL_CONCURRENCY=2
TOOL_EXECUTION_TIMEOUT=300000
```

### 场景 4：A/B 测试

```bash
# 版本 A（并行）
ENABLE_PARALLEL_TOOLS=true

# 版本 B（串行，对照组）
ENABLE_PARALLEL_TOOLS=false
```

### 场景 5：生产环境

```bash
# 稳定配置
ENABLE_PARALLEL_TOOLS=true
ENABLE_CONTEXT_COMPRESSION=true
ENABLE_SPECIALIZED_AGENTS=false
ENABLE_DEPENDENCY_GRAPH_VIZ=false
MAX_TOOL_CONCURRENCY=5
TOOL_EXECUTION_TIMEOUT=300000
```

## 性能影响

| 配置 | 串行模式 | 并行模式 (5) | 并行模式 (10) |
|------|---------|-------------|--------------|
| 5 张图像生成 | ~150s | ~30s | ~30s |
| 10 个独立工具 | ~100s | ~20s | ~10s |
| API 调用峰值 | 1 req/s | 5 req/s | 10 req/s |

## 故障排查

### 问题 1：工具还是串行执行

**检查**：
```bash
# 查看控制台日志
# 应该看到：[ParallelExecutor] 开始执行
```

**解决**：
```bash
# 确认环境变量生效
echo $ENABLE_PARALLEL_TOOLS  # macOS/Linux
echo $env:ENABLE_PARALLEL_TOOLS  # Windows

# 重启开发服务器
npm run dev
```

### 问题 2：工具频繁超时

**检查**：
```bash
# 查看日志
[ParallelExecutor] 超时: generate_images (toolu_xxx), 耗时: 300000ms
```

**解决**：
```bash
# 增加超时时间
TOOL_EXECUTION_TIMEOUT=600000
```

### 问题 3：API 配额超限

**检查**：
```bash
# 查看错误日志
Error: Rate limit exceeded
```

**解决**：
```bash
# 减少并发数
MAX_TOOL_CONCURRENCY=2
```

## 监控和日志

### 启用详细日志

```bash
# 开发环境
DEBUG=agents:* npm run dev

# 生产环境（使用日志级别）
LOG_LEVEL=debug npm start
```

### 查看性能指标

并行执行完成后，控制台会自动打印性能报告：

```
=== 并行执行性能报告 ===
项目: project-123
工具总数: 5
成功: 5 | 失败: 0 | 超时: 0
总耗时: 30123ms
平均耗时: 6024ms
最大并行度: 5
分层执行: 2 层
  Layer 0: 3 个工具, 耗时 15123ms
  Layer 1: 2 个工具, 耗时 15000ms

最慢的工具:
  generate_images: 15123ms (success)
  materialize_mockup: 15000ms (success)
========================
```

## 最佳实践

1. **开发环境**：启用 `ENABLE_DEPENDENCY_GRAPH_VIZ=true` 方便调试
2. **生产环境**：使用默认配置，稳定优先
3. **性能测试**：逐步增加 `MAX_TOOL_CONCURRENCY`，找到最优值
4. **监控**：定期检查性能报告，调整超时时间
5. **A/B 测试**：对比串行和并行的实际效果

## 相关文档

- [INTEGRATION_COMPLETE.md](./INTEGRATION_COMPLETE.md) - 集成完成报告
- [COMPLETE_PROJECT_REPORT.md](./COMPLETE_PROJECT_REPORT.md) - 完整技术报告
- [feature-flags.ts](./src/lib/agents/feature-flags.ts) - Feature Flags 实现
- [performance-monitor.ts](./src/lib/agents/performance-monitor.ts) - 性能监控实现

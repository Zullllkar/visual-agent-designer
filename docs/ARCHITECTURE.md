# Architecture

当前项目是一个本地优先的开源设计工具原型，目标是先跑通设计体验，而不是 SaaS 平台能力。

## Current Scope

```txt
Browser UI
  -> Local Agent Workflow
  -> Canvas JSON
  -> SVG Renderer
  -> PNG / JSON Export
```

当前没有后端、登录、数据库、订阅、云端存储。草稿保存在浏览器 `localStorage`。

## Agent Flow

当前 `generateDesign()` 里用本地 mock 实现了完整工作流：

```txt
Brief Agent
  解析产品或内容主题

Design Director Agent
  选择风格、调色板、视觉方向

Layout Agent
  生成产品 UI 或小红书图文的可编辑画布结构

Asset Agent
  预留图片模型生成入口

Review Agent
  预留质量评估入口
```

后续接入真实模型时，建议不要让图像模型直接生成全部 UI。更稳定的方式是：

- 图像模型生成背景、插画、产品视觉素材。
- 文字、按钮、卡片、布局由画布 JSON 渲染。
- Review Agent 检查结果是否符合 Brief、文字是否清晰、构图是否合理。

## Canvas Schema

当前画布节点在 `app.js` 内部定义，核心节点：

- `rect`
- `text`
- `image`
- `pill`
- `card`

每个节点包含：

- `id`
- `type`
- `x`
- `y`
- `width`
- `height`
- `fill`
- `color`
- `radius`
- `content`

后续建议把 schema 抽离成独立模块，例如：

```txt
src/schema/canvas.ts
src/renderer/svg-renderer.ts
src/agents/layout-agent.ts
src/providers/image-provider.ts
```

## Model Provider Boundary

建议后续统一抽象模型接口：

```ts
interface ImageModelProvider {
  generateImage(input: {
    prompt: string
    width: number
    height: number
    referenceImages?: string[]
  }): Promise<{
    imageUrl: string
    model: string
    cost?: number
  }>
}
```

可实现：

- `OpenAIImageProvider`
- `GeminiNanoBananaProvider`
- `FluxProvider`
- `ComfyUIProvider`

## Recommended Next Refactor

当原型验证有效后，可以迁移到：

```txt
Vite + React + TypeScript
  -> Zustand
  -> Konva or tldraw
  -> Local-first project files
  -> Optional FastAPI model proxy
```

这个阶段仍然可以保持开源和本地优先，只把模型 API key、图片生成、文件存储做成可选插件。

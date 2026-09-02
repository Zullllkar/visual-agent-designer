# 画布「+」派生空节点 实现计划

> **面向 AI 代理的工作者：** 按任务顺序实现；TDD；用户未要求勿 commit。

**目标：** 选中图片右侧 `+` → 空子节点 + 血缘连线 → Composer 带参考并聚焦  
**架构：** 纯函数造子资产；`image-asset-shape` 叠 `+`；复用 sync/link/Composer store  
**技术栈：** React、tldraw、Zustand、vitest

## 文件

| 文件 | 职责 |
|------|------|
| `src/lib/canvas/spawn-child-asset.ts` | 创建子占位资产并 patch project |
| `src/lib/canvas/spawn-child-asset.test.ts` | 单测 |
| `src/components/ide/image-asset-shape.tsx` | `+` 按钮、空节点文案、点击 spawn |
| `src/components/ide/tldraw-canvas.tsx` | 新子节点相对父/兄弟纵向错开（可选小改） |

## Task 1 — spawn 纯函数（TDD）

红：写测试期望 `spawnChildAsset` 追加 `parentAssetId`、空 `src`、`status: candidate`。  
绿：实现函数。  
验证：`pnpm exec vitest run src/lib/canvas/spawn-child-asset.test.ts`

## Task 2 — 节点 UI

- 选中且有 `src` 时右侧 `+`
- 点击：spawn → upsert → 选中子 shape → offerComposerRef + focus
- 无 `src`：显示「图片」空态，不显示 `+`

## Task 3 — 落点

新 `parentAssetId` 子节点若无 existing shape：父右 + 按已放置兄弟数纵向偏移。

## 验收

手测：点 `+` 见空节点与连线；Composer 有参考 chip 且聚焦。

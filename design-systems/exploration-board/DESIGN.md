---
name: exploration-board
description: 风格探索板：同一主体并排试方向，格子等大，差异一眼可分
atmosphere: comparative style board, locked subject, distinct treatments
version: "0.1.0"
author: vad
appliesTo: [style-board]
tokens:
  primary: "#3D4A3C"
  background: "#E8E2D6"
  surface: "#F3EEE4"
  accent: "#6F8F78"
  textPrimary: "#2A2A2A"
  textSecondary: "#6A655C"
  radius: 4
  fontSans: "Noto Sans SC, system-ui"
  fontMono: "IBM Plex Mono, monospace"
---

# Exploration Board Design System

## 1. Visual Theme & Atmosphere

这是方向研究，不是成片。同一主体、同一镜头，只换材质、配色、笔触。观感像工作室墙上的并排小稿，而不是四张无关海报。

## 2. Color Palette & Roles

| Role | Hex | 使用 |
|---|---|---|
| `background` | #E8E2D6 | 板底，让格子从底上浮起 |
| `surface` | #F3EEE4 | 单格底，可被各方向自己的色替换 |
| `primary` | #3D4A3C | 默认标签墨色 |
| `accent` | #6F8F78 | 仅默认探索用；各格应换成该方向的色 |
| `text-primary` | #2A2A2A | 格标签 ≤6 字 |
| `text-secondary` | #6A655C | 不要写段落说明 |

禁忌：四格共用同一套高饱和渐变。不要用仪表盘色墙。

## 3. Typography Rules

- 每格一个短标签，≤6 字
- 板标题可有一行，说明「同一主体 / 不同方向」
- 禁止每格里排卖点段落

## 4. Component Stylings

- **Tile**：等大矩形，间隙一致
- **Subject lock**：构图、镜头、主体锁定
- **Treatment**：材质 / 配色 / 笔触三选一作为变量，每格只强调一个差异轴更好

## 5. Layout Principles

- 默认 1600×900，3 格横排或 2×2
- 间隙 16–24，不要格子重叠
- 四格几乎一样等于失败

## 6. Depth & Elevation

- 板是平的。格子可用极轻分隔，不要每格一张大牌阴影
- 探索稿允许笔触未完成，不要假精修到成片

## 7. Do's and Don'ts

✅ 一眼能说出四格分别是什么方向
✅ 主体可识别、完整
✅ 明确这是探索，下一步再进正式目标

❌ 四张不同产品
❌ 最终战役精修
❌ HTML 情绪板网页、仪表盘

## 8. Responsive Behavior

主要是一张板。用户锁定某一格后：
- 不要继续在板上加第五格
- 下一张按选定方向出完整单图，换对应目标 Skill

## 9. Agent Prompt Guide

当 Agent 引用本设计系统时：
- prompt 写 style exploration board, same subject repeated, distinct treatments
- 把用户的三个词拆成互斥方向，不要同义反复
- 禁止 landing page、dashboard、final campaign polish

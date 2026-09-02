---
name: cinematic-concept
description: 游戏概念原画语言：剪影优先、世界锁材质、电影光，而不是软件界面
atmosphere: cinematic concept, silhouette-first, world-locked materials
version: "0.1.0"
author: vad
appliesTo: [game-art]
tokens:
  primary: "#D4A574"
  background: "#1A1410"
  surface: "#2A221C"
  accent: "#E8C9A0"
  textPrimary: "#F4EDE4"
  textSecondary: "#A89888"
  radius: 2
  fontSans: "Songti SC, Noto Serif SC, serif"
  fontMono: "IBM Plex Mono, monospace"
---

# Cinematic Concept Design System

## 1. Visual Theme & Atmosphere

电影概念图，不是产品界面。先看清剪影，再看材质和时代。光有方向（黄昏金、夜霓虹、水墨雾），空气里有尘或湿气。整体像能进美术包的关键帧，而不是可点击的 App。

## 2. Color Palette & Roles

| Role | Hex | 使用 |
|---|---|---|
| `primary` | #D4A574 | 主光、金属暖边、时代强调 |
| `accent` | #E8C9A0 | 高光、符文、旗面浅色 |
| `background` | #1A1410 | 深空间底，可随世界观改冷暖 |
| `surface` | #2A221C | 岩石、木、甲胄暗部 |
| `text-primary` | #F4EDE4 | 仅当画面必须有标题时 |
| `text-secondary` | #A89888 | 探索标签，不要当 UI 正文 |

禁忌：不用 Linear 紫、Vercel 青、Inter 界面灰作为面积色。不要霓虹 SaaS 渐变铺满天空。

## 3. Typography Rules

- 原画默认无字。必须有字时用宋体 / 衬线，少而大
- 标题最多一行，不排段落
- 禁止界面字号阶梯（14/16/12）冒充 HUD，除非 brief 明确要游戏内 UI

## 4. Component Stylings

- **立绘**：完整剪影，衣纹结构可读，武器不糊成色块
- **场景**：可走入的空间，地平线或建筑锚点明确
- **道具**：单件英雄道具，材质分层（金属 / 布 / 玉石）
- **图标装饰**：游戏内物件，不是后台导航 icon

## 5. Layout Principles

- 默认 16:9 关键帧（1280×720）
- 趣味中心偏黄金分割，主体不贴边裁掉手脚
- 留呼吸，但不要大块空白像落地页 Hero

## 6. Depth & Elevation

- 用大气透视和主光分层，不用卡片阴影
- 前景实、中景结构、远景简化
- 禁止玻璃拟态和 1px UI 描边

## 7. Do's and Don'ts

✅ 锁时代 / 门派 / 材质三件套
✅ 剪影一眼可识别
✅ 电影光或水墨气，选一种贯彻

❌ 假手机外壳、浏览器框、仪表盘卡片
❌ 卖点大字和 CTA 按钮
❌ 把山门画成官网首屏

## 8. Responsive Behavior

主场景是单张关键帧。需要立绘 / 场景 / 道具分张时：
- 同一世界观的光色和材质不换
- 不在一张图里拼四宫格说明书

## 9. Agent Prompt Guide

当 Agent 引用本设计系统时：
- 用英文 prompt 写 medium、light、silhouette，不要写 dashboard / Inter / landing
- 颜色跟世界观走，不要套 `primary` 紫
- 拒绝「做成 App 首页风格」除非用户明确要游戏 UI

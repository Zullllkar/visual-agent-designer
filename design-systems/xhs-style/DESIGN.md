---
name: xhs-style
description: 小红书风格：温暖明亮，钩子感强，强对比但不刺眼
atmosphere: warm bright, lifestyle, hook-driven
version: "0.1.0"
author: vad
appliesTo: [xhs]
tokens:
  primary: "#FF2442"
  background: "#FFF8F0"
  surface: "#FFFFFF"
  accent: "#FFB800"
  textPrimary: "#1F1F1F"
  textSecondary: "#666666"
  radius: 20
  fontSans: "PingFang SC, Noto Sans SC, system-ui"
  fontMono: "SF Mono, monospace"
---

# 小红书风格 Design System

## 1. Visual Theme & Atmosphere

温暖、生活化、有钩子感。浅米黄底色（#FFF8F0）替代纯白，让画面"软"一点。强对比标题文字，但用色上避开冷冰冰的工业感。整体像生活博主分享，而不是企业宣传。

## 2. Color Palette & Roles

| Role | Hex | 使用 |
|---|---|---|
| `primary` | #FF2442 | 小红书红，主标题 / 高亮文字 / CTA |
| `accent` | #FFB800 | 钩子角标 / 数字徽标 |
| `secondary-accent` | #FF8A65 | 暖橙，副标题强调 |
| `background` | #FFF8F0 | 米黄底色 |
| `surface` | #FFFFFF | 卡片 / 弹层 |
| `text-primary` | #1F1F1F | 主文字（不用纯黑，用近黑） |
| `text-secondary` | #666666 | 次级说明 |
| `divider` | #F0E8DC | 浅米色分割线 |

禁忌：不要用蓝色 / 紫色作为面积色（不"小红书"）。不用#000 纯黑文字（太硬）。

## 3. Typography Rules

- 主字：PingFang SC（含 fallback：Noto Sans SC, system-ui）
- 主标题：48-72px，weight 800-900，可加描边或彩色背景块
- 副标题：24-32px，weight 600
- 正文：14-16px，weight 400，line-height 1.7
- 角标 / 数字：16-20px，weight 700，配 accent 色块

## 4. Component Stylings

- **主标题块**：可用纯色背景 + 白字，或描边（黑边白底红字）增加力量感
- **角标**：小圆角 8-12，accent 黄底黑字，"干货" / "1" / "新" 等
- **CTA 按钮**：primary 红底白字，圆角 24，paddingY 14-18
- **卡片**：白底，圆角 20，softshadow（0 4 12 rgba(0,0,0,.04)）

## 5. Layout Principles

- 单图 1080×1440 竖版（小红书最佳）
- 主标题居中或左上对角线分布，不要均匀分布
- 视觉焦点必须存在（人 / 物 / 大文字），别只有图标和文本
- 边距 48-80px

## 6. Depth & Elevation

- 比 SaaS 设计系统更"立体"
- 卡片可有柔和阴影
- 文字可有浅描边或投影增强可读性

## 7. Do's and Don'ts

✅ 强钩子标题（数字、反差、利益点）
✅ 暖色为主
✅ 角标 + 大字 + 视觉焦点的"封面公式"

❌ 商务感 / 工业感色板
❌ 大段密集文字（超过 4 行就要分块）
❌ 深色背景（违反平台调性）

## 8. Responsive Behavior

主要场景是 1080×1440 单图。如果生成多图（轮播）：
- 同 series 保持背景色和字体一致
- 每张主标题不同但视觉系统一致
- 第一张是钩子，最后一张是引流 CTA

## 9. Agent Prompt Guide

当 Agent 引用本设计系统时：
- 标题写得"狠"一点：数字 / 反差 / 福利
- 颜色不要离开"小红书红 + 暖橙 + 米黄"三件套
- 必须有图像 hero（人物 / 产品 / 物品）
- 文案口吻自然，避免"我们"、"用户"等距离感词汇

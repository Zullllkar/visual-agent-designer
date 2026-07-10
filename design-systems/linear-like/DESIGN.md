---
name: linear-like
description: 借鉴 Linear / Vercel 的现代极简 SaaS 设计语言
atmosphere: minimal modern, restrained gradient, software-first
version: "0.1.0"
author: vad
appliesTo: [prototype, landing, mobile, dashboard]
tokens:
  primary: "#5E6AD2"
  background: "#0A0E1A"
  surface: "#1C1F2E"
  accent: "#A78BFA"
  textPrimary: "#FFFFFF"
  textSecondary: "#9CA3AF"
  radius: 8
  fontSans: "Inter, SF Pro Display, system-ui"
  fontMono: "JetBrains Mono, SF Mono, monospace"
---

# Linear-Like Design System

## 1. Visual Theme & Atmosphere

冷静、克制、软件第一。深色为主（#0A0E1A），辅以可选浅色场景。色块少而精，靠空间和字体层级建立秩序而不是装饰。整体观感像高效率的开发者工具，而不是消费级 App。

## 2. Color Palette & Roles

| Role | Hex | 使用 |
|---|---|---|
| `primary` | #5E6AD2 | 主 CTA、品牌强调 |
| `accent` | #A78BFA | 次级强调、徽标背景 |
| `background` | #0A0E1A | 页面底色（深色模式） |
| `surface` | #1C1F2E | 卡片 / 弹层底色 |
| `border` | #2A2E42 | 1px 描边 |
| `text-primary` | #FFFFFF | 主文字 |
| `text-secondary` | #9CA3AF | 次级说明文字 |
| `text-tertiary` | #6B7280 | 辅助 / 注释 |
| `success` | #10B981 | 状态成功 |
| `warning` | #F59E0B | 警告 |
| `danger` | #EF4444 | 错误 |

禁忌：不用饱和度过高的红 / 橙 / 黄作为面积色。不用渐变填充按钮（顶多用 2% 透明度的渐变 overlay）。

## 3. Typography Rules

- 主字 Inter / SF Pro Display
- 标题：32 / 48 / 64 / 96，weight 600-700，line-height 1.1
- 正文：14 / 16，weight 400，line-height 1.6
- 辅助：12，weight 400，opacity 60-80%
- 等宽字 JetBrains Mono 用于代码块、数字标签

## 4. Component Stylings

- **Button primary**: 圆角 8，padding 10-12px / 18-24px，颜色 primary，hover 加 8% 白色 overlay
- **Button secondary**: 透明底，1px border #2A2E42，hover surface
- **Card**: surface 底，1px border，radius 12，内部 padding 24
- **Input**: 透明底 + 1px border，focus 时 border primary
- **Badge**: 小圆角 4，padding 2-6px，半透明色背景

## 5. Layout Principles

- 8px 网格
- 关键内容居中或左对齐，不右对齐
- Hero 模块最大宽 1280px，居中
- 信息密度：宽松大气优先于挤
- 行间距：标题 1.1、正文 1.6

## 6. Depth & Elevation

- 几乎不用阴影；最多 1 层 0 1 2 0 rgba(0,0,0,.05)
- 用 border 和 hover 颜色变化代替 elevation

## 7. Do's and Don'ts

✅ 大量留白
✅ 单色块 + 1px 描边
✅ 渐变限制在文字（如 `bg-clip-text` 标题）

❌ 拟物化 / Glass / 强光泽
❌ 多种饱和色拼接
❌ 圆角过大（>16px）

## 8. Responsive Behavior

- ≥1280: 三列网格、Hero 大字
- 768-1280: 两列、字号缩 80%
- <768: 单列、CTA 全宽

## 9. Agent Prompt Guide

当 Agent 引用本设计系统时：
- 颜色用 token 名（如 `primary`、`surface`）而不是 hex
- 强调"克制""极简""开发者工具感"
- 拒绝"渐变填充按钮""拟物""仿水晶"等指令
- 首选深色场景；浅色场景需要明确说明

---
name: campaign-key
description: 品牌战役主视觉：一句卖点、戏剧光影、投放级安全边
atmosphere: campaign key visual, headline-first, dramatic light
version: "0.1.0"
author: vad
appliesTo: [promo-kv]
tokens:
  primary: "#111111"
  background: "#0B0B0B"
  surface: "#1A1A1A"
  accent: "#F2C14E"
  textPrimary: "#FFFFFF"
  textSecondary: "#C8C8C8"
  radius: 0
  fontSans: "Noto Sans SC, Helvetica Neue, sans-serif"
  fontMono: "IBM Plex Mono, monospace"
---

# Campaign Key Design System

## 1. Visual Theme & Atmosphere

投放主视觉，不是后台，也不是落地页线框。一张图只服务一句卖点。光可以戏剧或时装冷静，但必须有主次。观感像户外大牌或开屏，而不是软件截图。

## 2. Color Palette & Roles

| Role | Hex | 使用 |
|---|---|---|
| `primary` | #111111 | 深底或墨色标题块 |
| `accent` | #F2C14E | 卖点强调、日期、限量标记 |
| `background` | #0B0B0B | 默认深场；浅场需 brief 点名 |
| `surface` | #1A1A1A | 主体暗部、渐隐 |
| `text-primary` | #FFFFFF | 主标题 |
| `text-secondary` | #C8C8C8 | 品牌名 / 日期，远小于标题 |

禁忌：不用仪表盘蓝、不用多色图标栅格。面积色不超过三色加黑白。

## 3. Typography Rules

- 卖点句最大，中文优先无衬线或指定品牌字体
- 一行钩子，不做四行说明书
- 字距可收，但不能粘连；描边或色块保证在复杂背景上可读

## 4. Component Stylings

- **Headline lockup**：卖点 + 品牌名，层级差至少两级
- **Subject**：产品或人物占视觉主角，不被字挡住关键轮廓
- **Channel crop**：横版母版先成立，再派生 1:1 / 9:16，不硬拉伸

## 5. Layout Principles

- 默认 1920×1080
- 安全边约 6%，关键字不贴边、不进刘海区
- 视觉重量：图 70% / 字 30%，或按 brief 反转，但不要五五平分到发糊

## 6. Depth & Elevation

- 戏剧主光 + 轮廓光，或干净时尚平光，二选一
- 不要卡片 elevation，不要浏览器外框阴影

## 7. Do's and Don'ts

✅ 一句能喊出来的卖点
✅ 主体和字抢同一件事
✅ 多尺寸只改画幅不换主角

❌ 「点击查看」当标题
❌ App 界面组件拼贴
❌ 一张图里塞横竖三个画幅

## 8. Responsive Behavior

- 16:9 母版
- 1:1 收左右，保标题完整
- 9:16 收上下，主体上移，标题仍在安全区

## 9. Agent Prompt Guide

当 Agent 引用本设计系统时：
- prompt 写 campaign key visual, large headline, cinematic or editorial lighting
- 禁止 dashboard, wireframe, fake UI kit
- 卖点句必须出现在画面描述里，且是用户给的那句，不要发明第二句

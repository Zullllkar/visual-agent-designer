---
name: product-photo
description: 电商静物摄影语言：真实外形、准确材质、可换光影背景
atmosphere: studio product photo, true silhouette, accurate materials
version: "0.1.0"
author: vad
appliesTo: [product-shot]
tokens:
  primary: "#2C2C2C"
  background: "#FFFFFF"
  surface: "#F4F4F4"
  accent: "#C4A574"
  textPrimary: "#1A1A1A"
  textSecondary: "#6B6B6B"
  radius: 0
  fontSans: "Noto Sans SC, Helvetica Neue, sans-serif"
  fontMono: "IBM Plex Mono, monospace"
---

# Product Photo Design System

## 1. Visual Theme & Atmosphere

电商静物，不是海报，不是 App。外形以参考为准。白底干净、生活场景可信、材质特写紧。看起来能上架，而不是概念插画。

## 2. Color Palette & Roles

| Role | Hex | 使用 |
|---|---|---|
| `background` | #FFFFFF | 白底主图默认 |
| `surface` | #F4F4F4 | 浅灰无缝，避免纯白死白时可微灰 |
| `primary` | #2C2C2C | 仅当必须有小字时 |
| `accent` | #C4A574 | 暖接触影、木质场景点缀 |
| `text-primary` | #1A1A1A | 默认不要上字 |

禁忌：促销红条、满屏大字、价格标签盖住产品。不要发明第二款 SKU 的颜色。

## 3. Typography Rules

- 白底主图默认无字
- 生活场景若必须有包装上的真实印刷，按参考还原，不另加营销句
- 禁止 UI 字阶和按钮文案

## 4. Component Stylings

- **白底主图**：无缝底、真实剪影、轻微接触影，产品居中
- **生活场景**：桌面 / 手持可信，产品仍是唯一主角
- **材质特写**：紧裁真实材质，不换英雄外形

## 5. Layout Principles

- 默认 1024×1024
- 产品完整轮廓，不裁掉盖、嘴、按键
- 负空间均匀，不要贴边特写除非 shot=macro

## 6. Depth & Elevation

- 柔箱或窗光，材质高光按真实反射
- 接触影短而软，不要悬浮无影，也不要戏剧长影抢戏

## 7. Do's and Don'ts

✅ 光线和背景可改
✅ 开孔 / 按键 / 比例锁死
✅ 先要参考，没有参考就标明缺口

❌ 发明几何和额外按钮
❌ 九宫格说明书拼图
❌ 把产品拍成手机里的界面

## 8. Responsive Behavior

主输出是方图。需要横版详情头图时：
- 同一支产品、同一外形
- 只改场景和留白，不换 SKU

## 9. Agent Prompt Guide

当 Agent 引用本设计系统时：
- prompt 写 ecommerce product photograph, true silhouette, 50-85mm
- 明确 white seamless / lifestyle / macro
- 没有参考图时不要编造外形；先问实拍或三视图

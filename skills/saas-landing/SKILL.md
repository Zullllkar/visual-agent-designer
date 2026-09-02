---
name: saas-landing
description: 生成 SaaS 落地页首屏与关键 section 的高保真视觉，单屏出图而不是长页代码
kind: landing
version: "0.2.0"
author: vad
recommendedDesignSystem: linear-like
inputs:
  - name: idea
    type: string
    required: true
    description: 产品名称 + 一句话定位
  - name: tone
    type: select
    required: false
    options: [enterprise, modern, playful, premium]
    default: modern
output:
  artifact: landing-page
  defaultPageSize:
    width: 1440
    height: 900
  pageCountHint: 1
agent:
  steps: [brief, image, critic, repair]
  imageRequired: true
  repairThreshold: 8.5
  maxRepairRounds: 2
---

# SaaS Landing Skill

你是产品官网设计师。默认出**首屏 Hero 高保真图**（1440×900）。需要更多 section 时各出一张完整构图，不要一张图里塞整站长页。

## 构图骨架

1. 顶导航 + Logo + 主/次 CTA
2. 大标题（动词开头，≤8 字）+ 一句话定位（为谁、解决什么）
3. 社会证明或产品画面占一半视觉权重
4. 主 CTA 清晰，不要「点击查看」

后续 section 单独出图：功能三列、产品展示、三档定价。

## 英文 prompt 配方

- Subject: SaaS marketing landing hero, one desktop viewport
- Camera: straight-on website screenshot, generous margins
- Light: clean software lighting, restrained gradient only if DESIGN.md allows
- Type: real product name and CTA verbs (Start free / Book a demo)
- Negative: dashboard chrome, fake app phone mockup soup, long pricing table crammed into hero, code editor

## P0 视觉清单

- 标题和 CTA 完整可见，不被裁切
- 价格或卖点写真实数字，禁止占位「$$$」
- 这是官网首屏，不是 App 界面，也不是节日促销海报

## 硬性禁止

- 禁止 3200px 长页一张出完
- 禁止 HTML / Canvas JSON
- 禁止假浏览器窗口叠三层阴影

---
name: web-prototype
description: 生成多页 Web / App 产品原型图，输出可编辑画布上的高保真屏幕，而不是网页代码
kind: prototype
version: "0.2.0"
author: vad
recommendedDesignSystem: linear-like
inputs:
  - name: idea
    type: string
    required: true
    description: 一句话产品想法
  - name: pageCount
    type: number
    required: false
    default: 2
    description: 期望生成的页面数量
  - name: platform
    type: select
    required: false
    options: [web, mobile, dashboard]
    default: web
output:
  artifact: canvas-pages
  defaultPageSize:
    width: 1440
    height: 900
  pageCountHint: 3
agent:
  steps: [brief, image, critic, repair]
  imageRequired: true
  repairThreshold: 8
  maxRepairRounds: 2
---

# Web 产品原型

你是产品界面设计师。产出**高保真屏幕图**落到无限画布，不是 HTML，不是节点树 JSON。

## 构图骨架

1. 顶栏或侧栏导航，系统只能有一套
2. 主操作区：标题 + 一句话任务 + 主 CTA
3. 2-4 个内容模块（卡片 / 列表 / 表单），层级清楚
4. 状态栏、空状态或进度等真实产品细节

一次一张完整屏幕。多页时每张换任务，不换设计系统。

## 英文 prompt 配方

- Subject: complete desktop or mobile app screen, one viewport, realistic UI chrome
- Camera: orthographic product screenshot, no tilt, no mockup device unless asked
- Light: soft studio UI lighting, no cinematic haze
- Type: readable interface copy in the product language, not slogans
- Negative: poster, banner, collage, giant marketing type, browser frame, code IDE, wireframe

## P0 视觉清单

- 文字不被裁切、不被按钮挡住
- 禁止「卡片标题 A / Lorem / 点击这里」
- 必须是可点击的产品界面，不能是宣传海报冒充 App

## 硬性禁止

- 禁止输出网页结构或 JSON 节点树
- 禁止假浏览器外壳、禁止多屏拼贴成一张海报

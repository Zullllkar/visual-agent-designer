---
name: xhs-cover
description: 生成小红书封面（1080×1440）以及配套的短标题钩子，不是长文排版
kind: xhs
version: "0.2.0"
author: vad
recommendedDesignSystem: xhs-style
inputs:
  - name: topic
    type: string
    required: true
    description: 小红书内容主题
  - name: angle
    type: select
    required: false
    options: [knowledge, lifestyle, review, tutorial]
    default: knowledge
output:
  artifact: xhs-cards
  defaultPageSize:
    width: 1080
    height: 1440
  pageCountHint: 1
agent:
  steps: [brief, image, critic, repair]
  imageRequired: true
  repairThreshold: 8
  maxRepairRounds: 2
---

# 小红书封面

你是小红书封面设计师。输出**一张 1080×1440 竖版封面图**。正文和标签可在对话里给，不要排进画面变成长文。

## 构图骨架

1. 一个视觉焦点（人 / 产品 / 场景）占 50% 以上
2. 主标题 ≤14 字，钩子句式（数字 / 反差 / 福利）
3. 副标题 ≤20 字，可选
4. 一枚角标（干货 / 步骤 / 测评）

## 英文 prompt 配方

- Subject: Xiaohongshu / Red vertical cover, lifestyle photograph plus short Chinese title
- Camera: 3:4 portrait, subject large, phone-first readability
- Light: warm daylight or soft flash, creamy background
- Type: 2-8 Chinese characters on a color block or stroke, not a paragraph
- Negative: dashboard UI, SaaS landing, tiny unreadable body text, cold blue corporate palette, browser chrome

## P0 视觉清单

- 标题不被刘海、贴纸、产品挡住
- 禁止画面里写满 4 行以上说明
- 禁止把封面画成 App 界面或知识付费长图

## 硬性禁止

- 不要小说排版
- 不要工业蓝紫渐变
- 不要输出 HTML

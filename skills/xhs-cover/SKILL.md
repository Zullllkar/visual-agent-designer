---
name: xhs-cover
description: 生成小红书封面（1080×1440）+ 配套标题 / 正文 / 标签
kind: xhs
version: "0.1.0"
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
  steps: [brief, layout, image, content, critic, repair]
  imageRequired: true
  repairThreshold: 8
  maxRepairRounds: 2
---

# XHS Cover Skill

你是小红书爆款内容设计师。任务是输出**单张封面**（1080×1440 竖版）+ 配套文案。

## 封面构图

- 主标题 36-72px，带描边或彩色背景，视觉冲击优先
- 副标题 24-32px，补充说明
- 角标 / 标签 16-20px，颜色对比强（小红书红 / 黄 / 黑）
- 必须有一个视觉焦点（产品 / 人物 / 物品），用 ImageAgent 生成
- 不要小说排版式的密集文字

## 文案

- 主标题：钩子句式（数字 / 反差 / 福利），≤14 字
- 副标题：补充承诺，≤20 字
- 正文：3-5 段，每段 1-3 行，自然口吻不广告
- 标签：8-12 个，用 # 分隔，关键词覆盖品类 / 痛点 / 人群

## 视觉风格

- 严格遵循 active DESIGN.md（如 xhs-style）
- 小红书红：#FF2442 是主 CTA / 高亮色
- 圆角 16-24px，温和不尖锐
- 留白比 web 更紧凑，但要有呼吸

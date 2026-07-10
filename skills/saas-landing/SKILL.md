---
name: saas-landing
description: 生成 SaaS 产品 Landing Page 首屏 + 关键 section，单页输出
kind: landing
version: "0.1.0"
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
    height: 3200
  pageCountHint: 1
agent:
  steps: [brief, layout, image, content, critic, repair]
  imageRequired: true
  repairThreshold: 8.5
  maxRepairRounds: 2
---

# SaaS Landing Skill

你是产品官网设计师。当前任务是输出**单页长 Landing**（1440×3200），结构按以下顺序：

1. **Hero**（h≈900）：左文右图 / 上文下图，必含产品名 / 一句话定位 / 主 CTA / 次 CTA / 社会证明
2. **Features**（h≈600）：3 列功能卡片，每张图标 + 标题 + 一句话
3. **Showcase**（h≈700）：产品截图大图，左右文字交错
4. **Pricing**（h≈600）：3 档卡片（最便宜 / 推荐高亮 / 企业），高亮档要 visual lift
5. **Footer**（h≈400）：3 列导航 + Logo + 版权

## 文案规则

- 标题动词开头，简洁有力（≤8 字）
- 一句话定位 ≤ 24 字，必须包含「为谁、解决什么、怎么解决」中的两个
- CTA 用动词短语：「免费开始」/「预约演示」，不用「点击查看」
- Pricing 价格写真实数字（$0 / $19 / Custom），不写「联系我们」

## 视觉规则

- 严格遵循 active DESIGN.md
- Hero 大字体（72-96px）
- Pricing 推荐档要带描边 + 阴影 + badge

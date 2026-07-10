# 智能助手 · 产品规范

## 1. 产品概述

**原始想法**: ih

**定位**: 为个人用户提供高效信息处理的智能工具
**目标用户**: 个人用户
**平台**: app
**视觉风格**: Clean, minimal, dark mode with purple accents

### 核心功能

- 智能问答
- 任务提醒
- 知识整理

### 关键场景

- 日常信息查询
- 任务管理
- 学习辅助

## 2. 页面结构

**用户流**: 首次启动 → 主功能 → 设置

共 1 个页面：

### 2.1 SaaS Landing

- 尺寸: 1440 × 3200
- 视觉稿: `design/pages/home.svg`
- 结构: `design/pages/home.canvas.json`
- 主要元素:
  - Frame · 1280×840 fill transparent
  - Text · "智能助手" (96px / weight 700)
  - Text · "为个人用户提供高效信息处理的智能工具" (24px / weight 400)
  - Button · "免费开始" (180×56)
  - Button · "预约演示" (180×56)
  - Text · "已有 10,000+ 用户信赖" (14px / weight 400)
  - Image · 640×640 · prompt: "Clean, minimal, dark mode with purple a…"
  - Frame · 1280×600 fill transparent
  - Text · "核心功能" (48px / weight 700)
  - Card · "智能问答" / "快速获取精准答案，支持多轮对话，覆盖日常信息查询。"
  - Card · "任务提醒" / "智能管理待办事项，准时推送提醒，提升工作效率。"
  - Card · "知识整理" / "自动归纳学习内容，构建个人知识库，随时查阅。"
  - Frame · 1280×700 fill transparent
  - Text · "产品展示" (48px / weight 700)
  - Image · 560×500 · prompt: "Clean, minimal, dark mode with purple a…"
  - Text · "智能问答，即刻响应" (32px / weight 600)
  - Text · "基于先进AI模型，理解你的意图，提供准确、自然的回答。支持多轮…" (16px / weight 400)
  - Frame · 1280×600 fill transparent
  - Text · "定价方案" (48px / weight 700)
  - Card · "免费版" / "基础功能
每日50次问答
3个任务提醒
1GB知识存储"
  - Text · "$0" (32px / weight 700)
  - Card · "专业版" / "无限问答
无限任务提醒
10GB知识存储
优先支持"
  - Text · "$19" (32px / weight 700)
  - Card · "企业版" / "定制功能
无限使用
专属知识库
API接入"
  - Text · "Custom" (32px / weight 700)
  - Frame · 1280×160 fill transparent
  - Text · "智能助手" (24px / weight 700)
  - Text · "产品" (16px / weight 600)
  - Text · "功能" (14px / weight 400)
  - Text · "定价" (14px / weight 400)
  - Text · "关于" (14px / weight 400)
  - Text · "支持" (16px / weight 600)
  - Text · "帮助中心" (14px / weight 400)
  - Text · "联系客服" (14px / weight 400)
  - Text · "API文档" (14px / weight 400)
  - Text · "法律" (16px / weight 600)
  - Text · "隐私政策" (14px / weight 400)
  - Text · "服务条款" (14px / weight 400)
  - Text · "© 2025 智能助手. All rights reserve…" (12px / weight 400)

## 3. 实现要求

- 严格还原各页面 SVG 中的层级、文案、颜色、圆角、字号
- 文案使用 Canvas JSON 中的 content/title/body/label，不要自行改写
- 图片节点的 `src` 是设计期占位，落地时替换为真实素材或 CDN 资源
- 颜色 / 字号 / 间距优先引用 `design/tokens.json` 中的值
- 平台为 `app` 时建议 React Native / Flutter；`web` 时建议 Next.js + Tailwind
# 智能助手

> ih

**生成自 Vibeboard**。本目录是给 coding agent 的开发上下文包。

## 项目信息

- 产品名: 智能助手
- 定位: 为个人用户提供高效信息处理的智能工具
- 目标用户: 个人用户
- 平台: app
- 视觉风格: Clean, minimal, dark mode with purple accents
- 核心功能: 智能问答 / 任务提醒 / 知识整理

## 目录结构

```
design/
  project.json          # 完整项目数据
  tokens.json           # 设计 token
  pages/
    home.svg          # SaaS Landing 视觉稿（可直接打开预览）
    home.canvas.json  # SaaS Landing 结构化图层
prompts/                # 给不同 coding agent 的入口 prompt
SPEC.md                 # 详细规范
```

## 推荐使用方式

1. 在 Cursor / Claude Code / Codex 里打开本目录
2. 让 agent 读取 `SPEC.md` 与 `design/pages/*.svg`
3. 按 `prompts/<agent>-kickoff.md` 中的 prompt 启动开发

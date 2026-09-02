# Product

## Register

product

## Users

独立开发者与一人全栈团队。他们手头有一个产品想法，需要快速产出**可交付的视觉素材图**，并把图片、prompt 与设计上下文打包交给 Cursor / Claude Code / Codex 落地代码。使用场景：本地开发机、可插拔 LLM/生图 Provider、无需上传敏感 API Key 到云端。

## Product Purpose

Vibeboard把「产品想法 → Brief → 视觉方向 → 高保真图片素材 → Handoff 开发包」串成一条可追踪的本地优先流水线（对标 Lovart 式 ChatCanvas：Agent 在无限画布上产出成品视觉资产，而不是网页结构代码框）。

成功标准：用户能在 IDE 工作台内用 Agent 生成、迭代、收藏图片素材，并导出包含 **PNG/视觉资产、prompts、设计 token / Brief 上下文** 的 Handoff 包，供 coding agent 直接使用——**不以 Canvas JSON / 网页结构稿作为主交付物**。

## Brand Personality

锐利 · 高效 · 极客。工具感优先于装饰感；信息密度高但不混乱；像专业 IDE 而非营销落地页。首页可适度展示产品价值（brand 向），但 IDE / 画布 / 对话区始终以 product register 为准。

## Anti-references

- 紫蓝渐变 SaaS 模板风、Hero 大数字指标墙
- 千篇一律的奶油色/羊皮纸默认背景（Canvas Studio 使用冷灰 `#F5F5F7` 桌面 + 纯白面板，禁止滑回暖纸默认）
- 同质图标+标题+描述卡片网格、嵌套卡片
- 每节一个小号全大写 eyebrow（01 / 02 / ABOUT）
- 渐变文字、玻璃拟态装饰、bounce 动效
- Inter/Roboto 默认字体栈作为「设计感」替身
- **浏览器 chrome 网页结构框 / 可编辑 DOM 式页面 mock 作为主产物**（那是旧路径，已废弃）

## Design Principles

1. **本地优先、可交付**：每一张素材都应能下载或打进 Handoff，不做纯演示壳。
2. **工具诚实**：UI 像工作台，不像广告；状态、进度、错误要可读，不掩盖 Agent 流水线。
3. **极客效率**：键盘友好、信息分层清晰、减少无意义装饰与重复文案。
4. **设计服务于实现**：画布与生图是手段，**图片素材 + coding agent 上下文**是终点。
5. **双表面纪律**：首页（brand-leaning）可讲清价值；IDE（product）只做工作，不营销。

## Accessibility & Inclusion

目标 WCAG 2.1 AA。正文与背景对比度 ≥ 4.5:1；大号文字 ≥ 3:1。支持键盘操作与可见 focus。动效需提供 `prefers-reduced-motion` 降级。中英双语界面，文案避免营销黑话。

---
theme:
  name: "Canvas Studio"
  mode: "light-first"
  colors:
    background: "#F5F5F7"
    surface: "#FFFFFF"
    surfaceMuted: "#EEF0F3"
    border: "#E4E6EB"
    foreground: "#18181C"
    muted: "#6B7180"
    primary: "#6366F1"
    primaryStrong: "#4F52E0"
    success: "#16A34A"
    danger: "#DC2626"
  darkColors:
    background: "#131419"
    surface: "#1B1C23"
    surfaceMuted: "#20222A"
    border: "#2E3038"
    foreground: "#E8EAEF"
    muted: "#8D92A0"
    primary: "#818CF8"
  typography:
    sans: "'Inter Variable', ui-sans-serif, system-ui, 'PingFang SC', 'Microsoft YaHei', sans-serif"
    mono: "ui-monospace, 'Cascadia Code', 'JetBrains Mono', Consolas, monospace"
    baseSize: "15px"
    headingWeight: 600
    headingTracking: "-0.025em"
  rounded:
    sm: "8px"
    md: "10px"
    lg: "12px"
    xl: "16px"
  spacing:
    panelPadding: "16-20px"
    canvasGap: "24px"
---

# Visual Agent Designer · Canvas Studio 设计系统

## 1. Overview

参考 Lovart 式 AI 设计画布：**浅冷灰桌面 + 白色浮动画板 + 单一靛蓝 accent**。
亮色为默认主题（设计工具的主战场是看图，亮色底最不干扰画稿）；深色为石墨夜间副主题，共享同一套语义 token。

布局原则：左侧为窄工具栏（icon rail），中间是带点阵网格的无限画布，**AI Agent 对话栏固定在右侧**——这是与 Lovart（左侧聊天）刻意不同的本产品布局，禁止挪到左边。

## 2. Colors

- 桌面（画布底）：`#F5F5F7 → #EEF0F3` 微渐变，点阵 `rgba(24,24,28,0.08)`，20px 间距。
- 面板/画板：纯白 `#FFFFFF`，1px 边框 `#E4E6EB`，浮起感来自阴影而非描边加粗。
- Accent：靛蓝 `#6366F1`（hover `#4F52E0`），用于主按钮、选中态、链接、徽章、流程连线；占比 < 5%。
- 状态色：成功 `#16A34A`、危险 `#DC2626`、生成中复用靛蓝 soft（`rgba(99,102,241,0.10)`）。
- 深色模式：`#131419` 底 + `#1B1C23` 面板 + 亮靛蓝 `#818CF8`，对比逻辑与亮色一致。
- **禁止**：暖纸/奶油底、香槟金、信号绿（旧主题残余）、紫蓝大面积渐变背景。

## 3. Typography

- 全站 Inter Variable（@fontsource 自托管，中文回落系统栈）；标题 600 字重、`-0.025em` 字距；不再使用 serif。
- 界面读数（缩放百分比、计数）一律 `tabular-nums`。
- mono 仅用于代码、路径、token 值、画布坐标等机器语义内容，禁止全 UI 大写 mono 标签泛滥。
- 正文 15px / 1.55；画布内浮动卡片标题 12-13px / 600。

## 4. Elevation

- `--shadow-soft`：面板静置（0 1px 2px + 0 2px 8px，5% 黑）。
- `--shadow-elevated`：画布浮动画板 / 弹层（0 8px 30px，10% 黑）。
- `--shadow-glow`：输入聚焦 / 选中描边（靛蓝双层 ring）。
- 层级靠阴影 + 背景色差表达，不堆叠玻璃拟态模糊。

## 5. Components

- **主按钮**：靛蓝填充 + 白字，10px 圆角，hover 加深 + 抬升阴影（如「导出 Handoff」）。
- **次按钮 / chip**：白底 1px 边框，hover 浅灰底 + 靛蓝边。
- **画布浮动卡片**（`vad-canvas-chip`）：白底 12px 圆角 + elevated 阴影，承载色板/字体规范/交付包等画板。
- **设计规范卡**（`spec-card` shape）：色彩 token 行 + 字体样本 + 情绪关键词 chips，数据来自 `project.designContext`。
- **交付卡**（`handoff-card` shape）：交付物清单 + 靛蓝导出按钮，点击打开 Handoff 弹窗。
- **工具提示**：统一用 `data-tip` 自绘 tooltip（深色小浮层），禁止原生 title 灰框。
- **画布工具条**（`vad-canvas-toolbar`）：底部居中悬浮，白底毛玻璃，激活项靛蓝填充。
- **右侧 Agent 栏**：与画布同底色分区，消息气泡白底卡片，建议 chips 一排在输入框上方。
- **选中态**：tldraw selection 描边 1.5px 靛蓝。

## 6. Do's and Don'ts

- ✅ 让画稿成为页面里最显眼的东西，UI chrome 退后。
- ✅ accent 只给一个颜色（靛蓝），状态色克制使用。
- ✅ 圆角统一 8/10/12/16 四档，画板卡片用 12px。
- ❌ 不要暖色纸张底、serif 标题、香槟金（Kami 残余）。
- ❌ 不要信号绿 accent、全大写 mono 标签风（Graphite 残余）。
- ❌ 不要把 Agent 对话栏移到左侧；右侧布局是产品既定决策。

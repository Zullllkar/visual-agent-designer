# 视觉目标配方（首页 6 目标 + 分流工作流）

**日期：** 2026-08-18  
**状态：** 实现中  
**原则：** 抄 Open Design 的「先点目标再说话」，不抄他们的品类。画布 + 生图共用引擎，**配方按目标换**。

---

## 1. 目标

首页输入框上方增加目标按钮。用户点选后：

1. 占位符、示例、第一轮提问跟着变  
2. 画布默认画幅、分族、空状态跟着变  
3. 视觉方向库不是全站同一套形容词  
4. Agent 全程知道「用户在做哪类图」，提示词宪法按目标注入，禁止串味  

已定第一排 6 个：`界面视觉` `游戏原画` `宣传主视觉` `社媒封面` `产品图` `风格探索`。  
「更多」预留：`图标贴纸` `分镜动态`（本期只占位，不实现配方）。

## 2. 非目标

- 不增加幻灯 / 线框 HTML / 文档 / 网站复刻 / 音频  
- 不做成 6 套互不相通的工作台  
- 不把现有 3 个 skill 的 CanvasPage JSON 再救活  
- 本期不做 Electron、插件市场、162 个模板  

### 2.1 克制（明确不加）

配方用来换「在画什么」，不是再造一套法律。规则太多会把图画死。

本期 **只做**：6 个目标按钮、`targetId`、按目标换提问 / 方向库 / 一小段 prompt 宪法 / 画布默认尺寸与空状态、Agent 看见当前目标。

本期 **不做**（即使听起来聪明）：

- 资产空槽、一致性锚点、按目标 Critic 尺子、图内文字政策、换目标时的「身份层/交付层」拆分、附件区长说明  
- 为每个目标新增长 Keep 清单；现有 `avoid-poster` 仅留在界面  
- 硬闸只保留已经定过的：产品图没参考先问；界面不走海报宪法。其余靠方向卡和短宪法，让模型仍能发挥  

`promptContract` 建议不超过 8–10 行。方向卡是可选绑定，不是检查表。

---

## 3. 核心模型：Target Recipe

每个目标是一份**数据配方**，不是 if-else 散落在 prompt 里。运行时只认 `project.targetId`。

```text
targets/<id>/
  recipe.json          机器可读合同
  SKILL.md             给人看的工作流 + 英文 prompt 配方（注入 Agent）
  directions.json      本目标的方向卡（id / 色板 / 字体或渲染语言 / 禁止项）
```

`recipe.json` 最低字段：

| 字段 | 作用 |
|---|---|
| `id` / `label` | `ui-visual` / 界面视觉 |
| `goalSentence` | 写入 system：「用户目标 = 生产可给编码看的高保真屏幕图」 |
| `placeholder` / `examples` | 首页输入框 |
| `discovery` | 3–5 题 + 预填推断器 |
| `skipDiscoveryWhen` | 用户字已覆盖哪些槽即可不问 |
| `directionCards` | 本目标可选方向，**不是全站共用 7 个调性** |
| `canvas` | 默认尺寸、族（family）标题、空状态文案 |
| `promptContract` | 生图必须写入的英文 do / don't |
| `tools` | 允许 / 禁止（如 `materialize_mockup` 仅界面） |
| `handoff` | 包形态：code-kickoff / art-bible / media-pack / none |
| `keepRuleScope` | 哪些 Keep 规则对本目标生效 |

智能点：新增第 7 个目标 = 加一份配方，不改 Agent 主干。

---

## 4. 项目上要落下的状态

在 `ProjectFile` 增加（实现阶段再改 schema）：

```text
targetId: "game-art"
targetLocked: true          // 首页点选则为 true；推断则为 false，可被纠正
directionCardId?: "pixel-xianxia"
```

- `skillId` 与 `targetId` **对齐**：`game-art` ↔ `skills/game-art`。旧项目无 `targetId` 时，按 brief/平台推断，默认真 `ui-visual`，并在项目信息显示「未点选，已按界面处理」。  
- `designDirection.styleSourceAssetId` 仍表示「用此风格」锁的是哪张图；**不改变 targetId**。换风格 ≠ 换目标。  
- 项目信息增加「更换目标」，与「更换视觉方向」分开。换目标要二次确认：方向库、提问、宪法都换；已有图保留，新图按新配方。

---

## 5. 首页输入框

```text
[ 界面视觉 ] [ 游戏原画 ] [ 宣传主视觉 ] [ 社媒封面 ] [ 产品图 ] [ 风格探索 ]  [更多]
┌─────────────────────────────────────────────────────────────┐
│  占位符随选中目标变化                                         │
│  +附件     目标 pill（可再改）              [模型]  [发送]     │
└─────────────────────────────────────────────────────────────┘
示例 chips 也随目标变（健身 App / 仙侠门派 / 新品发布 KV …）
```

规则：

1. **必须先有目标才能发送。** 默认高亮「界面视觉」（与今天行为兼容），用户可改。  
2. 发送时 `createPlaceholderProject(..., { targetId })`，`HomeGenerateJob` 带上 `targetId`。  
3. 用户没点、只打字：仍用默认目标，但若文本强信号（「立绘」「KV」「小红书封面」）与默认冲突 → **进画布后第一张卡问「要不要改成游戏原画？」**，不要默默走错。这比首页强制先点更聪明，也不丢「随手粘贴就开干」。  
4. 不在首页做 URL 复刻框。界面视觉的占位是「哪一屏、给谁用」，不是「网站链接」。

---

## 6. Agent 怎么「知道用户在干什么」

每一轮 system 固定三段，**按目标门控**，不要把 6 份宪法全塞进去：

```text
## 稳定前缀（全目标共用）
身份、抗注入、工具表、Chat-first

## Goal（本项目）
goalSentence
targetId / directionCardId
本目标 tools 白名单
本目标 promptContract（10 行内）
本目标 Keep 规则

## 本轮变量
brief / 已绑方向卡 token / 参考图序位 / 用户原话
```

用户可见：右侧时间线顶部一条 **目标条**（「游戏原画 · 像素仙侠」），不是只写在模型脑子里。

`plan_design_direction` 必须输出 `directionCardId`（从本目标库选或「自定义」），`confirm_direction` 展示卡上的色/渲染/禁止项，不再只展示一段形容词。

`generate_images` 拼 prompt 顺序：

```text
[recipe.promptContract]
[direction card tokens / forbids]
[Keep rules in scope]
[用户主题 / brief]
[参考图：「第一张管配色、第二张管构图」]
```

界面目标继续注入 “not a poster”；游戏 / 宣传 **禁止** 注入这条。今天 `system-prompt.ts` 与 `image-generation-confirmation.ts` 的全站 UI 禁令，是串味的根因。

---

## 7. 六条配方（工作流差在哪）

共同骨架不变：需要时提问 → Brief（按目标裁剪字段）→ 方向卡确认 → 生图审批 → 画布迭代。  
**差的是每一步的内容，不是再造一条 pipeline。**

### 7.1 界面视觉 `ui-visual`

| 步 | 行为 |
|---|---|
| 问 | 平台、哪几屏、文案来源；有品牌则锁 token |
| 方向 | Linear / 编辑杂志 / 深色专业 / 游戏化 HUD（仍是「界面」） |
| 画布 | 一屏一张，可 materialize |
| 宪法 | 完整屏幕、可读字、单一导航；禁止促销拼贴 |
| 交付 | 现有 handoff + kickoff |
| 智能 | 用户说「再来一屏」扩写为：同平台、同方向卡、新 page role |

### 7.2 游戏原画 `game-art`

| 步 | 行为 |
|---|---|
| 问 | 资产种类（立绘/场景/道具/图标）、渲染语言、时代门派；**不问**「落地页还是 App」 |
| 方向 | 像素 / 厚涂 / 三渲二 / 水墨仙侠（与界面库隔离） |
| 画布 | Family：角色 / 场景 / 道具 分板；默认比例按资产种类 |
| 宪法 | 主体剪影、世界观一致；禁止 SaaS 首页、Inter 紫渐变 |
| 工具 | **关** `materialize_mockup`；开 spawn child、restyle、用此风格 |
| 交付 | 美术包：PNG + 每张用途 + 方向卡，不写 React kickoff |
| 智能 | 「再出两个弟子」= 同族派生，不新开界面项目 |

### 7.3 宣传主视觉 `promo-kv`

| 步 | 行为 |
|---|---|
| 问 | 渠道、一句卖点、必须上的字、安全区 |
| 方向 | 电影感 / 时尚大片 / 国潮海报 |
| 画布 | 主 KV + 自动 1:1 / 9:16 / 16:9 变体槽 |
| 宪法 | 允许大标题与戏剧光；禁止假 App 框、禁止「可点击界面」 |
| 交付 | 多尺寸套装 |
| 智能 | 渠道 pill 直接改画幅，不必重问方向 |

### 7.4 社媒封面 `social-cover`

| 步 | 行为 |
|---|---|
| 问 | 平台、钩子、要不要人脸/产品 |
| 方向 | 知识卡 / 开箱 / 生活方式（吸收现有 `xhs-cover`） |
| 画布 | 竖版单卡为主 |
| 宪法 | 少字、大焦点；禁止把长文排进图、禁止 dashboard |
| 交付 | 封面 + 标题/标签文本文件 |
| 智能 | 平台改了只换画幅和角标规范，主题保留 |

### 7.5 产品图 `product-shot`

| 步 | 行为 |
|---|---|
| 问 | **硬闸**：无实拍/三视图则停，出表单要图，不许纯文字脑补商品 |
| 方向 | 白底主图 / 生活场景 / 材质特写 |
| 画布 | 主图 / 卖点 / 场景三槽 |
| 宪法 | 外形以参考为准；可换光和场景，不可换结构 |
| 交付 | 电商三件套 |
| 智能 | 这是唯一「没图就拒绝生图」的目标 |

### 7.6 风格探索 `style-board`

| 步 | 行为 |
|---|---|
| 问 | 品类 + 三个词或参考图即可；**跳过**完整 Brief |
| 方向 | 本轮目的就是选方向，并排 4–6 张卡 |
| 画布 | 统一方图，便于「用此风格」 |
| 宪法 | 标明 draft；点「用此风格」后 **询问锁定到哪条目标**（默认猜：有角色→游戏，有 UI 壳→界面） |
| 交付 | 默认不打施工包 |
| 智能 | 这是漏斗入口，不是第六种「最终品类」 |

---

## 8. 比「各写一段 prompt」更智能的几件事

1. **目标漂移检测**  
   游戏项目里突然说「做个官网首页」：不要用游戏宪法硬画官网，也不要默默改 `targetId`。出一张小卡：「这是新目标还是同一世界观的宣传图？」用户选了再切配方。

2. **短指令只在本目标内扩写**  
   「再来三张」→ 内部 brief 带上 `targetId + directionCardId + 最近资产族`。界面扩成「再来三屏」；游戏扩成「同角色三角度」。

3. **Keep 规则按目标生效（只收窄，不新增长清单）**  
   现有 `avoid-poster` 只挂 `ui-visual`。不要为每个目标再造一套 Keep 目录。

4. **提问表按配方生成**  
   `buildDefaultDiscoveryForm` / `buildDirectionAdjustForm` 今天是全局游戏风选项。改成 `buildDiscoveryForm(targetId)`。更换视觉方向只改本目标的 mood/palette/render。

5. **方向卡可绑定**  
   Director 从本库挑卡或「自定义」。确认卡展示 token。生图 prompt 引用卡 id，模型少 improvise hex。

6. **参考图角色分三种**（仍是 Vibeboard 的图工作法）  
   约束源（抽 6 色）/ 生图 reference / 观察截图。产品图强制「约束源 + reference」；风格探索偏约束源。

7. **工具白名单**  
   界面才默认提 materialize；游戏提派生与分族；产品图提「缺参考就停」。减少 Agent 用错工具。

8. **画布空状态懂目标**  
   「还没有门派场景，描述一个镜头」vs「还没有首页，说一下主操作」。不要再统一「在右侧描述产品」。

---

## 9. 现有代码的对应改动（实现时，本期只对照）

| 现况 | 方案 |
|---|---|
| `createPlaceholderProject` 无目标 | 写入 `targetId` |
| `HomeGenerateJob` 只有 idea | 带 `targetId` |
| `discovery-gate` 全局题库 | 按 recipe.discovery |
| `plan_design_direction` 散文 | 输出 `directionCardId` + token |
| `buildSystemPrompt` 全站 UI 宪法 | Goal 段按目标注入一份 |
| `image-generation-confirmation` 写死「不要海报」 | 只在 `ui-visual` |
| `keep-rules` 全站 | `keepRuleScope` |
| 3 个 SKILL.md 仍写 Canvas JSON | 改写成 6 份视觉配方（xhs-cover → social-cover） |
| 项目信息只有换方向 | 加换目标 |
| 画布空状态统一文案 | `recipe.canvas.empty` |

两条路径（首页一键 / 项目内对话）**共用同一套 recipe 解析**，禁止 pipeline 走 prompt-stack、对话走另一套宪法。

---

## 10. 验收（实现后）

- 首页 6 个目标可点；占位符与示例随选中变化  
- 新建项目 `project.targetId` 正确；Agent 第一轮 Goal 段含该目标  
- 同一句话「像素仙侠门派」：选游戏 → 出概念图宪法；选界面 → 出 HUD/屏幕宪法；两边方向库不同  
- 游戏项目点「更换视觉方向」仍是像素/厚涂，不出现「现代极简落地页」默认题  
- 产品图无参考时停在要图，不生脑补商品  
- 风格探索点「用此风格」会问锁定到哪条目标  
- 旧项目无 targetId 仍能打开，按界面处理并标「未点选」  

## 11. 建议实现顺序（仍先不写代码）

1. `target` 类型 + 6 份 recipe 数据 + 单元测试（推断 / 门控 / 宪法拼接）  
2. 首页 chips + project 字段  
3. system / discovery / direction / generate 接 recipe  
4. 画布空状态与默认尺寸  
5. 项目信息换目标 + 漂移卡  

---

## 12. 修订

- 2026-08-18：首版。6 个首页目标已与用户口头确认；本文件待审查后才进入实现计划。
- 2026-08-18：§2.1 克制。用户确认不搞臃肿、不多加规则；砍掉资产槽 / 锚点 / 按目标 Critic / 图内文字政策等加码。
- 2026-08-18：开始实现。配方数据 + `targetId` + 首页 chips + Goal 段门控 + 按目标提问 / 空状态 / 更换目标。

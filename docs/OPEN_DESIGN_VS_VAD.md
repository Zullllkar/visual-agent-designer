# Open Design vs Vibeboard

> 对照对象：本地仓库 `open-design@90a34919`（`nexu-io/open-design`，2026-08 拉取）与当前 Vibeboard代码。
>
> 本文覆盖：产品定位、竞争判断、功能全景、**功能实现流程**、**用户指令如何加工并交给 agent**、**通过图片进行设计**、**怎么让 LLM 更符合用户想法**、**怎么打包成 PC 程序**、可学习点与明确不抄的边界。
>
> 更早的公开资料整理见 [`OPEN_DESIGN_RESEARCH.md`](./OPEN_DESIGN_RESEARCH.md)（2026-05，偏官方文档归纳）。本文以最新源码为准。

---

## 0. 一句话结论

两边抢的是同一类用户：会写代码、出不了视觉、想从一句话走到可落地设计，本地优先、BYOK。

产品赌注相反：

| | Open Design | Vibeboard |
|---|---|---|
| 设计师是谁 | 本机 coding agent CLI（Claude Code / Codex / Cursor Agent …） | 自己的 LLM + 图片模型 |
| 工件 | 可预览 HTML / JSX / Deck / 媒体文件 | 画布上的成品图 + 资产族 |
| 和 coding agent 的关系 | **它就是作者** | **它是下游读者**（handoff） |

不要把 Vibeboard 做成更弱的 Open Design。真正的威胁不是他们的幻灯片框架，而是他们已经把 **image / video / audio 做成一等 surface**。Vibeboard 该守住的是：并排比图、父子派生、拆素材、给施工队的 handoff。

---

## 1. 产品定位

### 1.1 Open Design

官方产品定义（实现也仍如此）：

> 一个 Web App，通过编排用户本机已安装的 code agent，把自然语言 brief 转成可预览、可导出、可继续编辑的设计 artifact。

核心哲学：

- 不拥有模型
- 不拥有 agent loop
- Skill / Design System / 插件都是文件，可版本管理
- HTML 是工具不是媒介：做 slides 要像幻灯设计师，做 app 要像交互设计师

规模（本次仓库统计）：

- 162 个 skill
- 153 套 design system
- 114 个 design-template
- 创建入口 6 个 tab：Prototype / Live Artifact / Deck / Template / Media / Other

### 1.2 Vibeboard

产品方案（[`PRODUCT_ARCHITECTURE_SPEC.md`](./PRODUCT_ARCHITECTURE_SPEC.md)）写明：

> 从产品想法到 UI 原型，再到 coding agent 可执行的开发上下文。输出是高保真视觉资产，不是 HTML mockup。

当前实现主路径已经进一步收敛成 Lovart 式：

> Brief → 视觉方向 → 独立生图素材（不再生成网页结构框）→ tldraw 画布 → handoff。

Skill 目录目前只有 3 个（`web-prototype` / `saas-landing` / `xhs-cover`），Design System 2 套。且这 3 个 skill 正文仍在规定 `CanvasPage` JSON，和生图主路径已经漂移。

### 1.3 关键边界（必须记住）

Open Design 明确不是 Figma 替代、不是自研 agent runtime。

Vibeboard 明确不是代码生成器、不是完整 Figma、第一阶段不做电商主图平台（但 OD 已经有 `ecommerce-image-workflow`）。

---

## 2. 竞争判断

### 2.1 会抢市场的点

| 重叠面 | 强度 | 说明 |
|---|---|---|
| 同一入口叙事 | 高 | 开发者、自然语言、本地优先、BYOK、再交给 coding agent |
| 原型 / Landing / 小红书 | 高 | OD 有 landing skills、`card-xiaohongshu`、114 个模板；Vibeboard 有画布图和 `xhs-cover` |
| 品牌 / Design System | 中 | 两边都把 `DESIGN.md` 注入 prompt；OD 还带 `tokens.css`、fixture、intent resolver |
| Discovery 先问再做 | 中 | 交互形态接近，协议不同（见 §5） |
| **媒体生成** | **正在升高** | OD 已把 image/video/audio 做成 exclusive surface，并有独立 `MEDIA_GENERATION_CONTRACT`。这会切到 Vibeboard 的生图主场 |
| 用参考图做设计 | 中高 | 两边都支持贴图；OD 用图当「视觉源再翻译成 HTML」，Vibeboard 用图当「生图模型的 reference」 |

### 2.2 不会正面撞车的点

| 维度 | Open Design | Vibeboard 应守住 |
|---|---|---|
| 迭代方式 | 改文件 + Inspect `data-od-id` + Tweaks 面板 | 选中形状、spawn child、family board |
| 预览 | iframe 里跑 HTML | 无限画布上的像素成品 |
| 导出 | HTML / PDF / PPTX / ZIP | PNG + prompt + tokens + kickoff |
| 扩展 | Skill 种子模板 + 插件市场 | 视觉 skill（构图 / 风格 / 拆图），不是 HTML 模板库 |
| 质量上限来源 | 种子 `template.html` + `layouts.md` + `checklist.md` | 图片模型 + 方向约束 + 画布比较 |

### 2.3 战略含义

- 对打 HTML 原型 = 死路。OD 在 agent adapter、Deck 固定框架、插件市场上已经是完整产品。
- 跟进媒体 surface 时，不要做成「也调一次 `od media generate`」。Vibeboard 的差异必须是：图出现在画布上、可派生、可拆、可打包给编码 agent。
- `materialize_mockup`（区域拆分、code vs 图）是 OD 没有的产品形状，应加码而不是丢掉。

---

## 3. 架构对照

```text
Open Design
  Browser / Electron
    → Next.js web（UI / 预览 / 解析 <question-form>）
    → Express daemon（权威：项目、prompt 组合、起 CLI、SSE）
    → RuntimeAgentDef 注册表
    → 本机 coding agent CLI（自己的 loop / 工具 / 权限）
    → 项目文件夹里的 HTML / 媒体
    → iframe 预览 / 导出

Vibeboard
  Browser
    → Next.js + 本地 server（Fastify / Next route）
    → 自己的 LangGraph ReAct loop + 工具表
    → LLM Provider + Image Provider（BYOK）
    → ProjectFile JSON + 本地资产
    → tldraw 画布
    → handoff ZIP
```

| 模块 | Open Design | Vibeboard |
|---|---|---|
| Agent loop | 不拥有，委托 CLI | 拥有，`createReactAgent` |
| Prompt 入口 | 唯一：`composeSystemPrompt` | 两套：`system-prompt.ts` + `prompt-stack.ts` |
| Skill | 文件 + 种子 + 清单 + 插件 | 3 个偏过时的 `SKILL.md` |
| Design System | DESIGN.md + tokens.css + fixture / intent map | DESIGN.md body 注入 |
| 状态 | SQLite + 项目文件夹 | ProjectFile JSON + `.vad/` |
| 适配 coding agent | 一等公民（探测 / spawn / 流式解析） | 只作为 handoff 下游 |
| 工具审批 | 交给 CLI 自己的 permission | `generate_images` 审批卡 + phase / budget |

OD 加一个新 CLI 是「丢一个 `RuntimeAgentDef` 对象」；Vibeboard 加一个能力是「注册一个 tool」。两边扩展点不同，不要互相抄错层。

---

## 4. 功能全景对比

| 能力 | Open Design | Vibeboard | 备注 |
|---|---|---|---|
| 自然语言 brief | 有 | 有 | |
| 结构化 Discovery | `<question-form>` host 协议 | `ask_discovery` 工具 | OD 更硬 |
| 视觉方向 | 内置方向库（OKLch + 字体 + 姿态）或 DESIGN.md | `plan_design_direction` LLM 散文 | OD 可绑定，Vibeboard 偏形容词 |
| 高保真 UI 图 | 媒体 surface / image-to-code 先出图 | **主路径** | Vibeboard 更强 |
| HTML 原型 | **主路径** | 不做 | 不要抄 |
| Deck / PPT | 固定框架 + 多种模板 | 无 | 不要抄 |
| 小红书卡片 | `card-xiaohongshu` skill | `xhs-cover` skill | 重叠 |
| 品牌抽取 | URL 真测量（DOM/CSS）+ 参考图分支 | brand kit 工具，偏手填 / LLM | OD 更真 |
| 网站复刻 | `web-clone`（Playwright + 真源码） | 无 | 非 Vibeboard 主业 |
| 参考图生图 | 附件路径喂给 CLI + 电商参考图 skill | Composer 粘贴 → 图片模型 reference | 见 §7 |
| 图生代码 | `image-to-code`：先出图再写 HTML | 无（我们出图本身就是交付） | 方向相反 |
| 画布比较 / 派生 | 无 tldraw | family board / spawn child | Vibeboard 护城河 |
| 局部修改 | Inspect `data-od-id` + 评论 | 选中素材 + restyle / 子节点 | |
| 自检 | skill `checklist.md` P0 + 五维评分 | critic 残留 + 审批卡 | OD prompt 侧更完整 |
| Memory | 个人记忆 + 短指令扩写 + verified rules | session-memory 较弱 | 该学 |
| 导出 / handoff | HTML/PDF/PPTX/ZIP | PNG + tokens + kickoff + materialize | 方向相反 |
| 插件市场 | 有 | 无 | 现阶段不必跟 |
| 协作 / 云同步 | daemon 内已有 collab 模块 | 无 | 第一阶段不做 |
| 偏好记忆 / 可验证规则 | 文件记忆 + 回合后抽取 + Keep 门 | checkpoint 会话恢复为主 | 见 §8 |
| 桌面安装包 | Electron + sidecar + NSIS/DMG/AppImage + 自动更新 | 仅有开发壳规格，未落地 | 见 §9 |

---

## 5. 功能实现流程

### 5.1 Open Design：从一句话到可预览产物

```text
用户打开 New Project
  → 选 Tab（Prototype / Deck / Media / …）
  → 选 Skill 或 Template、可选 Design System、填 metadata（平台 / 比例 / 模型）
  → 输入 brief（可带附件图）
      │
      ▼
Web 把会话交给 daemon
  → composeSystemPrompt（见 §6）
  → 按 RuntimeAgentDef 探测并 spawn CLI
  → 把 composed prompt 经 stdin / 文件 / argv 投喂
  → imagePaths 里附上用户上传图（校验在 upload 目录内、体积上限）
      │
      ▼
Coding Agent 自己的 loop
  ├─ 信息不够 → 输出短文 + <question-form> JSON → **停**
  │     Host 渲染表单 → 用户提交
  │     下一轮 user 消息以 `[form answers — discovery]` 开头
  ├─ 品牌 Branch A（规范 / 截图 / URL）→ Bash+Read 抽 brand-spec.md
  ├─ 品牌 Branch B → 自己从方向库绑 :root，不再二次问方向
  ├─ TodoWrite 计划（用户看到 Todos 卡）
  ├─ 先读 seed / layouts.md / checklist.md（skill preflight 硬插入）
  ├─ 复制 template.html，填真实文案
  ├─ P0 checklist 全过
  ├─ 五维自检（哲学 / 层级 / 执行 / 具体 / 克制），<3 分回修
  └─ 普通助手总结（文件系统模式禁止把源码丢进 <artifact>）
      │
      ▼
项目根出现 HTML / 媒体文件
  → 预览 iframe 自动渲染
  → 用户可 Inspect、Tweaks、评论局部
  → 导出 PDF / PPTX / ZIP
```

几个实现细节（源码级）：

1. **Web 不拥有业务权威。** `apps/web` 负责 UI、SSE 渲染、把 `<question-form>` 解析成 Questions UI。项目、文件、prompt、起 agent 全在 `apps/daemon`。
2. **Mode 和 Skill 不是 1:1。** UI tab 描述用户怎么开始；`SKILL.md` 的 `od.mode` 描述 daemon 怎么索引。选中「从模板开始」会替换该 tab 的默认 skill，不会自动叠默认 prototype skill。
3. **Ask / Plan / Design 是 sessionMode。** Ask 模式砍掉整份设计师宪章，只留轻对话 + 仍可带 memory / DS / skill。Plan 模式覆盖为只规划不写文件。
4. **Deck 框架钉在 prompt 最后。** 禁止 agent 自造缩放 / 翻页 / 打印 CSS。没有绑定 skill 的 deck 项目也会注入通用骨架。
5. **媒体 surface 换掉整个工作流。** 不再写 HTML。唯一合法出字节的方式是：

```bash
"$OD_NODE_BIN" "$OD_BIN" media generate \
  --project "$OD_PROJECT_ID" \
  --surface image|video|audio \
  --model <id> \
  --output <filename> \
  --prompt "<full prompt>"
```

daemon 写文件，FileViewer 自动显示。助手可见回复被压成一句（中文成功固定为「图片已生成」）。

### 5.2 Vibeboard：从一句话到画布资产

当前实际有 **两条路径**，这是和 OD 最大的结构差。

#### 路径 A · 对话（主交互）

```text
用户在项目里发消息（可粘贴参考图）
  → /api/chat 或 generate/stream
  → langgraph-agent.createVadAgent
  → system-prompt.ts 现场拼接 system
  → ReAct 按工具表行动：
        ask_discovery
        → generate_brief
        → plan_design_direction（应先口头确认）
        → generate_images（审批卡：Run / Cancel / Edit）
        → inspect_canvas / manipulate_canvas / restyle / materialize / export_handoff
  → 画布先出现 generating 占位，再原地填图
  → 用户选中、派生子节点、导出 handoff
```

#### 路径 B · 一键生成（首页 / brief launcher）

```text
一句话想法
  → generateProjectFromIdea
  → design-pipeline：
        BriefAgent
        → DesignDirectorAgent
        → ImagePlannerAgent
        → ImageExecutorAgent
  → 写入 ProjectFile + 资产
  → 打开画布
```

路径 B 的系统提示走另一套 `src/lib/skills/prompt-stack.ts`。Skill 文件仍在讲 Canvas JSON，pipeline 已经不生成网页结构页——**文档、skill、运行时三条线不一致**。

### 5.3 流程对照（同一用户故事）

用户说：「做个 AI 笔记 App 的首页，偏 Linear 风，要精致一点。」

| 步骤 | Open Design | Vibeboard |
|---|---|---|
| 1 入口 | Prototype tab + 可选 Linear-like DS | 空白项目聊天或一键生成 |
| 2 澄清 | 可能跳过表单（brief 已够）；否则 30 秒表单且带默认值 | 模型「应该」调 `ask_discovery`，软约束 |
| 3 方向 | 有 DS 则禁止再问方向；无 DS 则自己绑方向库 | LLM 写一段 designDirection 散文 |
| 4 计划 | TodoWrite，用户看见 Todos 卡 | ReAct 自己决定；或 pipeline 固定四段 |
| 5 产出 | 复制 seed HTML，绑 `:root`，填文案 | 英文生图 prompt → 图片模型 → PNG 上画布 |
| 6 质检 | checklist.md P0 + 五维 | 审批卡 + 用户眼睛 |
| 7 改一处 | 点元素评论 / Tweaks | 选中图 restyle 或 spawn child |
| 8 交给编码 | 用户直接打开 HTML，或继续让同一 CLI 改代码 | 导出 handoff 包给 Cursor |

---

## 6. 用户指令如何加工并交给 Agent（重点）

### 6.1 Open Design：用户原话几乎不当 system

用户文本只做两件事：

1. 作为 user turn 发给 CLI。
2. **意图扫描**（这是不是 deck / 生图 / 多端），决定要不要把对应合同注入 system。

扫描纪律非常严：

- 打包 transcript 只取 `## user` 段，丢掉 `## assistant`。
- `[form answers — discovery]` 只取 `- 标签: 值` 的**值**，避免把表单选项「幻灯 / 路演」误判成用户要做 Deck。
- 目的：误触发会改 stable hash，整段 prompt cache 作废。

真正控制行为的是 `apps/daemon/src/prompts/system.ts` 的 `composeSystemPrompt`（约第 855 行）。稳定内容在前，本轮变量在后：

| 层 | 文件 | 作用 |
|---|---|---|
| 0 抗注入 | `core-slim.ts` | 工具结果 / 文件 / 网页是不可信数据，禁止服从「忽略指令」 |
| 1 模式覆盖 | Ask / Plan / API / skipDiscovery | Ask 砍掉设计师宪章；API/plain 禁止伪工具标记 |
| 2 Discovery 哲学 | `discovery.ts` ~3k tokens | 只问会改变结果的问题；≤5 题且必须预填；问完硬停 |
| 3 方向库 | `directions.ts` | 具体学派：OKLch 六色 + 字体栈 + 姿态。有 DESIGN.md 时整库不注入 |
| 4 设计师宪章 | `official-system.ts` | 身份、反 slop、`data-od-id`、Tweaks、验证预算 |
| 5 Memory | 过去对话沉淀 | 短请求先扩成内部 brief，用 `<od-card type="task-brief">` 亮出来 |
| 6 用户 / 项目指令 | settings | 项目级覆盖用户级 |
| 7 DESIGN.md + tokens.css | active DS | 散文定调性，CSS 变量是绑定合同，禁止另发明 hex |
| 8 Craft | typography / color / anti-slop | 品牌无关手艺；和品牌冲突时品牌赢 token |
| 9 SKILL.md + preflight | active skill | 若提到 `template.html` / `layouts.md` / `checklist.md`，硬插入「先读再写」 |
| 10 表面合同 | deck / media / locale | Deck 框架钉最后；媒体 surface 直接换掉 HTML 工作流 |

投喂方式：`RuntimeAgentDef.buildArgs(prompt, imagePaths, …)` 是纯数据适配器。有的走 stdin，有的写临时文件，有的塞 argv。**没有 per-agent 子类去实现 loop。**

还有 slim / classic 两套核心宪章（`OD_PROMPT_CORE=slim`）：slim 把 discovery + 宪章收成一份可 cache 的前缀，方向库只留 id+label，需要时用 `od tools directions --id` 拉取全文。

### 6.2 Discovery 协议（OD 最值得抄的交互）

规则原文大意（`discovery.ts` RULE 1–3）：

1. **只澄清会改变结果的信息。** 新项目、空白字段本身不构成「必须问」。
2. 要问就：一句短引导 + 一个 `<question-form>`，然后 **stop**。不准 TodoWrite、不准写文件。
3. 每题预填默认值，用户可以零改提交。有限选项由 host 自动加「其他」。
4. 稳定 value 必须是英文 id：`pick_direction` / `brand_spec` / `reference_match`。
5. 用户下一句以 `[form answers — discovery]` 开头。有品牌/截图走 Branch A 抽取；否则 Branch B 自己绑方向，**禁止再弹一次方向选择**。
6. 然后 TodoWrite → 干活 → checklist → 五维。

Vibeboard 对应物是 `ask_discovery` 工具：问题塞进 `scratch.__discoveryQuestions`，SSE 发给前端。没有强制预填、没有「信息够就禁止调用」、没有稳定 id 分支、停手靠模型自觉。

### 6.3 Vibeboard：用户消息原样进 ReAct

```text
user message
  → LangGraph human turn（原文）
  → system = buildSystemPrompt(project, agentCtx, rulesPrompt)
        身份
        + 项目 JSON 摘要
        + 工具清单
        + discovery / direction 软规则
        + skill.body（若有）
        + brand kit
        + 生图硬规则
```

同时存在 `src/lib/skills/prompt-stack.ts`：给 Brief / Layout / Repair / Critic 用，拼的是「设计师身份 + SKILL.md + DESIGN.md + brief JSON + 技术 schema」。Layout/Repair 技术段已经和「不再生成网页结构」冲突。

缺失（相对 OD）：

- 抗注入段
- 意图门控（不用的合同不进 prompt）
- 用户级 / 项目级自定义指令分层
- form-answers 稳定协议
- 可绑定方向库
- 单一 composer

已有且 OD 没有的：

- 工具审批卡（尤其 `generate_images`）
- phase 闸门、agent-budget
- 生图占位先上画布

### 6.4 加工链路对照图

```text
OD:  用户字
       ├─(user turn)──────────────────────────► CLI
       └─(意图扫描，仅用户字)─► 决定注入哪些合同
                                    │
         metadata / locale / DS / skill / memory / craft
                                    │
                         composeSystemPrompt
                                    │
                    stdin / 文件 / argv + imagePaths
                                    ▼
                              本机 Agent CLI

Vibeboard: 用户字 ──► ReAct user turn
     project JSON + tools + skill ──► system-prompt.ts ──► 同一个 LLM
     参考图 ──► generate_images 内部收成 data URL ──► Image Provider
```

---

## 7. 通过图片进行设计（重点）

这是「用户丢一张图进来，系统怎么用它」的对照。两边都叫参考图，**用法几乎相反**。

### 7.1 Open Design 的图片设计：图是「视觉源」，代码是「翻译层」

OD 里「用图做设计」不是一条功能，而是 **5 条并行链路**。按用户意图分流。

#### 链路 A · 用户贴图 / 拖文件当参考（最常见）

实现：

1. 图进 Design Files 或 chat 上传目录。
2. `resolveSafePromptImagePaths`：必须落在 upload 目录内、必须是文件、有体积上限；过大进 `oversizedImages`。
3. `resolveSafeProjectAttachments`：项目内附件路径白名单。
4. `formatProjectAttachmentHint` 把附件编成编号列表塞进 **user prompt**（「用户说第一张附件时，对这个列表」）。
5. `imagePaths[]` 传给 `RuntimeAgentDef.buildArgs`。声明了 `supportsImagePaths` 的 CLI（如部分 ACP / Qoder `--attachment`）会把图真正喂给多模态模型；其它 CLI 至少能 `Read` 项目里的文件。

宪章要求（`official-system.ts`）：

> 用户粘贴或拖入的图，当作视觉参考：提取配色、布局、调性。不要承诺像素级复刻，除非用户明确要求。不要按 URL 把用户图嵌进 artifact，按路径复制或引用。

Discovery 的 `brand: reference_match` 走 Branch A：先定位附件/URL → 下载 CSS/截图 → `grep` 真 hex → 写成 `brand-spec.md`（六色 OKLch + 字体 + 3–5 条姿态）→ 一句话口述系统让用户便宜改方向 → 再 TodoWrite。

**这是「看图抽取约束，再生成 HTML」。图不进入图片模型当 reference（除非后面又走媒体命令）。**

#### 链路 B · image-to-code：自己先出图，再写成网站

Skill：`skills/image-to-code-skill/SKILL.md`。

强制顺序：

```text
生图（足够多、按 section 大图）
  → 深分析（色、字、间距、按钮、层级）
  → 从图像提取 design system
  → 最后才写前端
```

硬规则：

- 视觉任务禁止先自由编码。
- 图是 design source of truth，代码是 translation layer。
- 宁可多图也不要把整站压进一张看不清字的 collage。
- Codex 下默认 1 section = 1 张大图。
- 禁止从旧图 crop 出细节图，要重新生成同语言的清晰 section 图。
- 有一组基线旋钮：`DESIGN_VARIANCE=8`、`IMPLEMENTATION_CLARITY=9` 等。

这和 Vibeboard 完全反着：OD 用图当「中间稿」去提高 HTML 上限；Vibeboard 用图当「最终交付」。

#### 链路 C · 媒体 surface：图就是交付物

创建 Tab = Media → Image。

- 选模型、比例、可选 prompt-template（`prompt-templates/image`）。
- 不注入 DESIGN.md 管线（`modes.md` 写明媒体用 prompt template 而不是 interface token pipeline）。
- Agent 被 `MEDIA_GENERATION_CONTRACT` 钉死：禁止 `<artifact>` 里造二进制，必须 `od media generate`。
- 电商 skill `ecommerce-image-workflow`：**V1 强制要求用户上传产品实拍**。没有照片就停，不允许纯文字脑补商品。默认出三张：主图 / 卖点 / 场景，并写 `image-manifest.json` + gallery HTML。
- `fal-image-edit` / `venice-image-edit`：inpaint、去背、风格迁移（多为目录广告，完整工作流要装 upstream bundle）。

#### 链路 D · 网站复刻：截图是侦察证据，不是设计稿

Skill：`web-clone`。

- 第一动作永远是拿**真源码**，不信 AI 臆造的实现。
- 没源码才 Playwright 侦察：1440 / 768 / 390 三档截图 + JSON 进 `RECON/`。
- 「视觉复刻 / 内容爆改」才从侦察结果抽 `design-dna.json`（字体 / 色候选 / 特效信号）。
- 「忠实复刻」禁止用 DNA 稀释逐字节铁律。
- 截图在这里是 **recon 证据**，用来定复杂度 L1–L6 和路径，不是拿去给图片模型「仿一张」。

#### 链路 E · 品牌抽取：截图只是旁证，DOM/CSS 才是测量

Skill：`brand-extract`。

- 应用内 Browser tab 打开真站，用 `agent-browser` 测 DOM/CSS。
- 颜色按出现频率归七个语义角色；logo / 封面图按渲染尺寸过滤后落盘。
- 明确写：**从真页面测量，不要从记忆猜，也不要只靠截图。**
- 撞上 Cloudflare 等人机墙：停，发 `<question-form>` 让用户在 Browser 里过验证。
- daemon 会预填一份粗糙 `brand.html`，agent 写 `brand.json` 后 `od brand preview` 渐进替换，避免一上来全是骨架。

### 7.2 Vibeboard 的图片设计：图是「生图模型的输入」，画布是「工作台」

#### 用户怎么把图送进来

1. Composer 粘贴 / 拖拽：`composer-attachments.ts`，最多 3 张，单张 ≤ 2.5MB，写成 `project.references`（data URL）。
2. 消息里的 `【参考图】` / `【引用素材】`。
3. 点名已有画布资产（`from-asset-<id>`）。
4. `generate_images.referenceIds` 指定优先哪些。

#### 系统怎么用这些图

`collectProjectReferenceImages` 收齐后：

- `resolveReferenceImagesForModel` 把 `/api/assets` 或 http 收成 data URL。
- **直接传给 Image Provider**（Gemini / OpenAI 兼容接口的 reference images）。
- 同时 `appendReferenceStyleHint` 把风格提示写进英文 prompt。

也就是说：Vibeboard 的参考图是 **img2img / 多模态生图条件**，不是给 LLM 看完再写 HTML 的草图。

相关工具：

| 工具 | 图片角色 |
|---|---|
| `generate_images` | 新图；自动带上 references；审批后先 stage 占位再填 |
| `restyle_page_images` | 现有资产当父图，按指令换风格，父链保留 |
| spawn child（画布） | 选中节点派生，视觉上就是「从图再生图」 |
| `screenshot_canvas` | 给 LLM 看当前画布，属于观察而非生成 |
| `materialize_mockup` | 把一张 UI 图拆成区域 / 素材 / 代码边界 |

Vibeboard **没有**：

- 图 → HTML 的强制工作流
- 网站截图侦察包
- 「没产品实拍就拒绝出电商图」这种 input contract（产品边界也说第一阶段不做电商主图）
- 把附件编成「第一张 / 第二张」编号协议（目前靠 references 数组和模型自觉）

### 7.3 用图做设计：六种用户意图该谁接

| 用户意图 | Open Design 怎么接 | Vibeboard 应该怎么接 |
|---|---|---|
| 「按这张截图做个网站」 | 多模态 Read 图 + 抽 token + 写 HTML；或 image-to-code 先再生更清晰的 section 图再写 | **不要写成 HTML。** 把截图当 reference 生高保真 UI 图上画布，需要落地时走 handoff / materialize |
| 「按这个品牌站出一套规范」 | `brand-extract` 测真 DOM；或 Branch A 抽 brand-spec.md | 可学测量纪律；输出应是 brand kit + 后续生图约束，不是 `brand.html` |
| 「仿这个产品拍出主图」 | `ecommerce-image-workflow`，无实拍就停 | 若以后做，抄「无参考图就停」的 input contract，产物上画布 |
| 「这张草图 / napkin 变成界面」 | 宪章：当视觉参考，不承诺像素级 | 当 reference 生图；可加一步 LLM 描述草图结构再写入 prompt |
| 「把现有图换成另一种风格」 | fal-image-edit 或再 `media generate` | 已有 `restyle_page_images` + spawn child，应做成默认 |
| 「先看看长什么样再决定写不写代码」 | image-to-code 的中间图；或 Media tab | **这就是 Vibeboard 主场。** 图留在画布上比较，确认后再 handoff |

### 7.4 图片链路的本质差别

```text
OD 典型：
  用户图 ──► LLM 看懂 ──► 约束/HTML
  或：LLM 先调生图 ──► 再看自己生成的图 ──► 写成 HTML

Vibeboard 典型：
  用户图 ──► Image Provider（多模态 reference）──► 新 PNG ──► 画布
  用户字 ──► LLM 写英文 prompt ──► Image Provider ──► 新 PNG ──► 画布
```

对 Vibeboard 的启示不是去实现 image-to-code，而是：

1. **把「图作为约束」做硬。** OD 会从参考图抽出 hex / 字体 / 姿态写成文件再遵守。Vibeboard 现在主要把像素丢给生图模型，约束是软的。
2. **给附件编号协议。** 「按第二张的配色、第一张的布局」现在没有稳定映射。
3. **区分三种图：参考约束、生成交付、观察截图。** 不要都叫 reference。
4. **image-to-code 的「按 section 出可分析大图」** 可以反向用在 Vibeboard：复杂界面不要一张糊图，按模块出多张再在画布上拼 family。

---

## 8. 怎么让 LLM 更符合用户的想法

「符合用户想法」不是把 system prompt 写得更长。Open Design 把它拆成 **进场对齐、过程可改、事后沉淀** 三层，而且每一层都有 **UI 契约**，不只靠模型自觉。

### 8.1 Open Design 怎么做

可以看成一条漏斗：先减少猜测，再给用户便宜的改方向窗口，最后把纠正变成下次的硬约束。

```text
短指令 / 含糊 brief
  → metadata + Plugin inputs + Memory 静默补全
  → 不够才 <question-form>（预填、≤5、问完硬停）
  → 口述将用的系统（配色/字体/结构）——用户这时改最便宜
  → TodoWrite 计划可见
  → 绑定 DESIGN.md / 方向库 token（禁止 improvise hex）
  → 产出
  → Tweaks / 点选评论 / Design Jury
  → 回合结束后台抽取记忆
  → 用户纠正 → 规则提案（Keep / Edit / Discard）
  → 下一轮 prompt 自动带上 Profile + Verified rules
```

| 机制 | 它解决什么 | 实现要点 |
|---|---|---|
| 预填 Discovery | 用户懒得填完整 brief | 从当前请求、metadata、plugin inputs、memory **推断默认值**；用户可零改提交 |
| 跳过表单 | 问太多 = 不像懂你 | 只有「答案会改变方向/结构/交付」才问；已有字段当已回答事实 |
| 稳定 form-answers | 自由文本下一轮又猜 | `[form answers — discovery]` + 英文 id（`pick_direction` 等） |
| 方向库 / DESIGN.md | 模型爱回到 Inter + 紫渐变 | 具体 OKLch + 字体栈；有 DS 时禁止再问方向 |
| 先口述再动手 | 做错一整页才发现 | 宪章要求先说系统，给用户一次廉价 redirect |
| 用户级 / 项目级指令 | 「我永远要中文 / 这个项目用我们品牌」 | `userInstructions` 默认；`projectInstructions` 覆盖 |
| Intent gateway | 「再来一张首页」丢上下文 | 用 memory 把短句扩成内部 brief，发 `<od-card type="task-brief">` 再干活，不等确认 |
| 文件记忆 | 跨项目记住口味 | `<dataDir>/memory/`：`MEMORY.md` 索引 + 每条事实一个 md；类型含 user / rule / brand |
| 启发式 + LLM 抽取 | 用户不会每次说「记住」 | 回合结束后台跑：正则抓「记住/我喜欢」；小模型抓隐含偏好。**不阻塞本轮** |
| Verified rules + scorecard | 偏好是软的就会被忘掉 | 规则可检查；artifact 回合必须发 `<od-card type="verify-scorecard">`，daemon **程序化核对**，缺卡算失败 |
| 规则提案门 | 自动记忆会写错 | 纠正只 **提议**，用户 Keep 才落盘。注释/高亮也可蒸馏成规则（`memory-rules.ts`） |
| Tweaks 面板 | 微调不该重跑整 brief | 把主色、字号、暗色、布局变体做成页面旋钮 |
| Inspect + 评论 | 「就这个按钮大一点」 | `data-od-id` 稳定选择器；评论针对元素不是整页重说 |
| Design Jury | 自嗨偏离 brief | 五位评审（Designer/Critic/Brand/A11y/Copy）打分，低于阈值再修 |
| 意图门控 prompt | 无关合同干扰模型 | 不是 deck 就不注入 deck 框架；Ask 模式砍掉整份设计师宪章 |
| 抗注入 | 文件里的「忽略指令」带跑偏 | 工具结果/网页当数据，不当命令 |
| Locale | 中文用户拿到英文表单 | UI locale 覆盖：表单文案和产物文案跟界面语言 |

记忆抽取的模型选择（`memory-llm.ts`）是一条降级链：用户在 Memory 面板指定的小模型 → 当前 CLI 的 headless 一发 → BYOK → Haiku / gpt-4o-mini。Local-CLI 用户不必为了记忆再贴一次 key。

**核心洞察：** 他们不指望一次 prompt 就把用户想法「理解对」。他们把理解拆成 **可提交的默认值、可看见的计划、可点的纠正、可保存的规则**。LLM 负责填空，host 负责锁契约。

### 8.2 Vibeboard 现在有什么、缺什么

| 已有 | 作用 | 缺口 |
|---|---|---|
| `ask_discovery` | 空白项目先问 | 无预填、无「够了就禁问」、回答是自然语言 |
| `confirm_direction` | 方向确认卡 | 方向仍是散文，不是可绑定 token；模型可能跳过 |
| `generate_images` 审批卡 | 用户能改英文 prompt 再跑 | **这是最强的对齐点**，但发生在已经写完 prompt 之后 |
| `designContext` / brand kit | 跨轮带一点品牌 | 没有从参考图测量、没有 verified 检查 |
| `content-preferences` | 语调 / 语言 | 只影响文案指令，不影响构图/禁止海报感 |
| LangGraph checkpoint | 同一 thread 能续聊 | 不是「用户是谁 / 永远不要出主图风」的偏好记忆 |
| phase / budget | 限制乱调用 | 不解决「调用对了但图不像用户要的」 |

用户说「做个笔记 App 首页，精致一点」时，Vibeboard 常见失败不是没工具，而是：

1. 把 App UI 做成促销海报（system 里有文字禁令，但是软的）。
2. 短指令「再来三张」丢了平台 / 受众 / 已选方向。
3. 参考图只当像素，不抽「只要这种留白和这种蓝」。
4. 用户改了一句「不要这么花」——下一轮不一定还记得。

### 8.3 Vibeboard 应该怎么做

不要把 OD 的 HTML 评审团原样搬过来。要对齐的是 **同一套漏斗**，接到生图和画布上。

**进场（减少猜测）**

1. Discovery 预填 + 跳过 + `[form answers]` 稳定 id（与 §6.2 同一件事）。
2. 短指令先扩成内部 brief：从 project.brief、designDirection、brandKit、最近参考图补全；时间线亮一条「我按这些理解」卡，**默认继续**，用户能改。
3. 参考图先抽取 6 色 + 调性 + 禁止项，再进 `generate_images`（§7.4）。
4. 方向卡绑定：确认的是 token，不是一段形容词。

**过程（便宜改方向）**

5. **保留并做硬闸的审批卡。** OD 没有等价物这么适合生图。`confirm_direction` 通过之前禁止 `generate_images`；审批卡上除了 prompt，还要看得见：平台、方向卡 id、用了哪几张参考图。
6. 画布上的局部纠正就是对齐：选中一张说「这个再克制一点」→ spawn child / restyle，不要整页重 brief。
7. 项目级指令：「这个项目始终移动端、中文、不要插画风」。

**事后（沉淀成下次的硬约束）**

8. 回合结束后台抽记忆（不阻塞）。先启发式（「记住」「以后都」「不要再」），有 key 再上小模型。
9. 用户纠正升级为规则提案：「App 首页禁止促销海报构图」——Keep 后写入 project 或用户记忆，下一轮 system 当 **Verified rule**，生图前自检，违反则改 prompt 重出，而不是只写在 system 散文里。
10. Prompt 意图门控：纯问答不要把整份生图宪法塞进去（Ask 模式思想）。

建议的最小闭环（够用、能测）：

```text
用户消息
  → 扩写 brief 卡（可见、默许）
  → 需要时 discovery 表单
  → confirm_direction（绑定方向卡）
  → generate_images 审批（可改 prompt + 看见约束）
  → 出图
  → 用户纠正 → 规则提案 Keep
  → 写入记忆，下一轮强制遵守
```

`session-memory.ts` 继续只负责 thread checkpoint；新记忆应是独立的 markdown/JSON 偏好层，不要和 LangGraph checkpoint 搅在一起。

---

## 9. 怎么打包成 PC 程序

### 9.1 Open Design 怎么打包

他们把「开发时跑源码」和「用户装一个程序」分成两套拓扑，安装包不是给 Electron 塞进整个 monorepo。

**开发态**（`pnpm tools-dev`）：起 daemon + web sidecar，默认可再起 Electron 壳。端口是临时运输，不决定数据目录。

**安装包拓扑：**

```text
tools-pack <mac|win|linux> build
  → 打 web sidecar（Next 仍由 web 进程管，不把 Next 输出塞进 OD_RESOURCE_ROOT）
  → 打 daemon sidecar（产品权威：API / 文件 / 起 CLI）
  → apps/packaged = 很薄的 Electron 外壳
        1. 单实例、namespace 路径、splash
        2. startPackagedSidecars() 拉起 daemon + web
        3. 注册 od:// 指到内部 web
        4. 把窗口交给 @open-design/desktop/main
  → 安装器
        mac: .app / .dmg / .zip（可 --signed / --portable）
        win: electron-builder NSIS + 解压 dir 冒烟
        linux: AppImage；另有 --headless 不要 Electron
```

关键设计（`tools/pack/AGENTS.md`、`apps/packaged`）：

| 点 | 做法 | 为什么 |
|---|---|---|
| 三进程 | Electron 壳 + web sidecar + daemon sidecar | 业务不进渲染进程；关窗要能停一整组 |
| 路径用 namespace 不用端口 | `OD_DATA_DIR` / logs / cache / userData 按 channel 分 | 稳定版和 Beta 能并排装；端口每次都能变 |
| `--portable` | 发行包不把构建机 `.tmp/tools-pack/...` 写进配置 | 否则用户机器会去找你电脑上的路径 |
| 资源根 | `OD_RESOURCE_ROOT` 只放 daemon 只读资源（skills 等） | Next 产物归 web sidecar |
| Windows NSIS | 短 namespace（如 `rg`） | Next standalone 路径极深，长名字会撞 260 字符上限，装丢文件 |
| 自动更新 | `apps/desktop/src/main/updater.ts` 读 `releases.open-design.ai/<channel>/latest/metadata.json` | 校验 sha256；优先换 payload 再 relaunch；不行才跑安装器 |
| Channel 身份 | 稳定 / Beta / Prerelease / Preview 各用不同应用名和卸载键 | 更新不会装成两个「Open Design」 |
| Finder 无 PATH | 文档写明 GUI 启动看不到 Terminal 里的 `claude` | 他们依赖本机 CLI，这是打包后的真实痛点 |
| Headless | Linux 可只装 daemon、不起窗口 | 给服务器 / MCP，不是给设计师 |

`apps/desktop` 本身是窗口 + 更新 + 少量原生能力（截图、PDF、菜单），**不含**聊天和画布业务。`apps/packaged` 更薄，只负责「先把 sidecar 拉起来」。

生命周期命令是一等公民，不只是打 zip：

```text
tools-pack win build --to nsis
tools-pack win install | start | stop | logs | uninstall | cleanup
```

`stop` 必须校验 namespace / stamp / PID，避免杀掉别人的进程。

### 9.2 Vibeboard 现在到哪

- 运行时是 **自定义 `server.ts`**（Next + WebSocket），数据在仓库 `.vad/` 与 `.vad-data/`。
- 已有书面规格 [`docs/superpowers/specs/2026-08-09-electron-desktop-shell-design.md`](./superpowers/specs/2026-08-09-electron-desktop-shell-design.md)：**A 档开发壳**，`pnpm dev:desktop` 开窗，按需 spawn 现有 server；明确 **不做** 安装包 / 签名 / 自动更新 / 用户目录迁移。
- `package.json` 还没有 `electron`，仓库里也还没有 `desktop/`。规格已批准，代码未落地。
- 可选独立 daemon（`docs/DAEMON.md`）与打包不是同一件事。

Vibeboard 比 OD 简单的地方：不需要在安装包里探测用户的 Claude Code。更难的地方：自定义 server + WS，不能假装成纯静态 `web/out`。

### 9.3 Vibeboard 应该怎么做（分档，不要抄更新器宇宙）

对齐已批准规格，把「能给别人一个 exe」拆成三档。**不要**第一期就上 OD 那套 payload launcher / 双层 outer / 通道地板。

**A 档 · 开发壳（规格已有，先落地）**

```text
Electron Main (desktop/main.cjs)
  → 单实例
  → 探测 http://127.0.0.1:PORT
  → 没有服务则 spawn：pnpm exec tsx --import ./preload.cjs server.ts
  → loadURL
  → 关窗杀掉本轮拉起的子进程树（Windows 要杀进程树）
```

成功标准保持规格原文：Win/Mac `pnpm dev:desktop` 可用画布和聊天；浏览器 `pnpm dev` 不变。数据仍用仓库 `.vad/`。

**B 档 · 未签名安装包（第一个真正的「PC 程序」）**

学 OD 的骨架，砍掉复杂度：

```text
electron-builder
  Win: NSIS（另出 unpacked 供冒烟）
  Mac: dmg + zip
  资源：
    - 打包进 extraResources 的 Node 或使用 Electron 自带 Node 跑编译后的 server
    - next build 的 standalone 输出（需要先让自定义 server 吃 standalone）
    - 静态 public / 预加载
  数据：首次把根从 cwd/.vad 改到 app.getPath('userData')/vad
```

B 档必须先做的工程，不是美化安装界面：

1. **`next build` standalone + 自定义 `server.ts` 能在无仓库、无 pnpm 的机器上起来**（含 `ws`）。这是打包的真正 blocker。
2. 路径合同：安装目录只读；项目和 checkpoint 在 userData；日志单独目录。
3. 关窗停 Node 子进程，开机不要残留 3000 端口。
4. 短安装路径，避免 Win 260 限制（即使我们比 Next+daemon+skills 树更浅）。
5. `--portable` 思维：配置里禁止写构建机绝对路径。

**C 档 · 产品化（明确延期）**

- 代码签名、公证、SmartScreen。
- 自动更新：一个 `latest.yml` + sha256 足够；不要上 payload/outer 双包。
- 托盘、协议 `vad://`、多 channel 并排，等真有 Beta 用户再做。

| 不要从 OD 抄到 Vibeboard B 档的 | 原因 |
|---|---|
| 为每个 coding CLI 修 Finder PATH | 我们不 spawn 用户的 claude |
| launcher payload + 历史 outer 兼容桥 | 他们有版本包袱，我们还没有 |
| 稳定/Beta/Preview 四套应用名 | 一个产品名先够 |
| Design Jury 进安装包 | 那是 agent 质量，不是壳 |

**建议落地顺序：** A 档开发壳（几天级）→ 打通 standalone server 在干净目录跑起来 → B 档 NSIS/DMG 冒烟 → 再谈签名和更新。

---

## 10. 优秀处与建议

### 10.1 该学（接到 Vibeboard 自己的交付物上）

| 优先级 | 学什么 | 落到 Vibeboard 的形态 |
|---|---|---|
| P0 | 单一 Prompt Composer | 合并 `system-prompt.ts` 与 `prompt-stack.ts`。Skill 只描述视觉工作流，技术 schema 另附 |
| P0 | Skill = 种子 + 配方 + 清单 | 不要抄 HTML 种子。每个视觉 skill 配：构图骨架、英文 prompt 配方、P0 视觉清单（截断 / 占位文案 / 海报感冒充 App UI） |
| P0 | 可绑定方向库 | DesignDirector 输出改成选中一条方向卡（色板、字体、禁止项），生图 prompt 强制引用 |
| P0 | Discovery 当 Host 协议 | 预填、≤5 题、信息足够禁止调用、回答写成 `[form answers]` 稳定 id |
| P0 | 参考图抽取约束 | 用户贴图后先抽出 6 色 + 调性 + 禁止项，再进生图；不要只把像素丢给模型 |
| P1 | 意图门控 + 抗注入 | 生图合同只在真的要图时注入；文件内容不能劫持工具策略 |
| P1 | 先口述系统再动手 | `plan_design_direction` 之后短复述约束，硬闸确认再 `generate_images` |
| P1 | 附件编号 | 「第一张 / 第二张」映射到 `project.references` 稳定顺序 |
| P1 | Memory 扩写短指令 | 「再来一张首页」用沉淀偏好补全 audience / deliverable |
| P1 | 纠正 → 可验证规则 | 用户说「不要海报风」Keep 成规则，下一轮生图前检查，而不是只写进散文 system |
| P1 | 开发壳 Electron | 按已批准规格落地 `pnpm dev:desktop`，不改业务 |
| P2 | Slim / 稳定前缀 | composer 统一后再做 prompt cache |
| P2 | 未签名 NSIS/DMG | 先让 `server.ts` 在 standalone/无 pnpm 目录跑起来，再 electron-builder；不要抄双层更新器 |

### 10.2 明确不要抄

- 不要自建 coding-agent 编排（`RuntimeAgentDef` 那一层是 OD 的护城河，且与「我们不写实现代码」冲突）。
- 不要堆 162 个 HTML skill。先把现有 3 个改成图像配方。
- 不要把 Deck 固定框架、`<artifact>` HTML、插件市场当近期目标。
- 不要把 image-to-code 的「最后必须写成网站」搬过来。
- 不要第一期抄 Open Design 的 payload launcher / 多 channel 更新器 / Finder PATH 探测。Vibeboard 不 spawn 用户的 coding CLI。

### 10.3 Vibeboard 已经更好、应加码

- 无限画布上的成品图、family、失败清理。
- 图片模型从第一天就是一等公民（审批卡、占位、异步 job）。
- handoff 方向相反：`materialize_mockup` 把一张图拆给编码 agent。
- phase / budget / 工具风险分级，比「loop 全交给 CLI」更可控。缺的是 prompt 侧同等严谨。

### 10.4 建议的产品原则（先定原则，再改代码）

> Vibeboard 的 skill 产出「视觉约束 + 生图配方 + 画布操作」，永远不是 HTML 种子。
>
> 用户指令的加工顺序固定为：结构化 discovery 回答 → 绑定方向卡（可从参考图测量）→ 注入 DESIGN / skill / 清单 → 再进现有 ReAct 工具。
>
> 用户丢进来的图，先当约束源，再当生图 reference；需要给编码 agent 时走 handoff，而不是在 Vibeboard 里把图翻译成 HTML。
>
> 让 LLM 符合用户想法 = 默认值 + 可见计划 + 可点纠正 + 可保存规则，不是更长的 system prompt。PC 程序 = 先开发壳、再 standalone server、再 NSIS/DMG；更新器以后再说。

---

## 11. 关键源码索引

### Open Design

| 主题 | 路径 |
|---|---|
| Prompt 组合 | `open-design/apps/daemon/src/prompts/system.ts` |
| Discovery / 方向库 / 宪章 | `prompts/discovery.ts` · `directions.ts` · `official-system.ts` · `core-slim.ts` |
| 媒体合同 | `prompts/media-contract.ts` |
| 附件 / 图路径 | `apps/daemon/src/runtimes/chat-prompt-inputs.ts` |
| Agent 适配器 | `docs/agent-adapters.md` · `runtimes/defs/*.ts` |
| 模式 | `docs/modes.md` |
| Skill 协议 | `docs/skills-protocol.md` |
| 图→代码 | `skills/image-to-code-skill/SKILL.md` |
| 网站复刻 | `skills/web-clone/SKILL.md` |
| 品牌抽取 | `skills/brand-extract/SKILL.md` |
| 电商参考图 | `skills/ecommerce-image-workflow/SKILL.md` |
| 记忆 / 规则 | `apps/daemon/src/memory.ts` · `memory-llm.ts` · `memory-rules.ts` |
| Design Jury | `docs/critique-theater.md` |
| 打包编排 | `tools/pack/AGENTS.md` · `tools/pack/README.md` |
| Electron 外壳 | `apps/packaged/` · `apps/desktop/` |

### Vibeboard

| 主题 | 路径 |
|---|---|
| ReAct system | `src/lib/agents/system-prompt.ts` |
| 旧 Prompt Stack | `src/lib/skills/prompt-stack.ts` |
| 对话 agent | `src/lib/agents/langgraph-agent.ts` |
| 一键流水线 | `src/lib/agents/design-pipeline.ts` |
| Discovery 工具 | `src/lib/agents/tools/ask-discovery.ts` |
| 生图 | `src/lib/agents/tools/generate-images.ts` |
| 参考图收集 | `src/lib/agents/reference-images.ts` |
| 参考图转模型输入 | `src/lib/agents/resolve-reference-images.ts` |
| Composer 贴图 | `src/lib/chat/composer-attachments.ts` |
| 换风格 | `src/lib/agents/tools/restyle-images.ts` |
| 方向确认 | `src/lib/agents/tools/confirm-direction.ts` |
| 会话 checkpoint | `src/lib/agents/session-memory.ts` |
| 桌面壳规格 | `docs/superpowers/specs/2026-08-09-electron-desktop-shell-design.md` |

---

## 12. 修订

- 2026-08-16：首版。基于 `open-design@90a34919` 与当时 Vibeboard 工作区对照。未改产品代码。
- 2026-08-16：补 §8 让 LLM 符合用户想法（记忆 / 规则 / 漏斗）、§9 PC 打包（sidecar + NSIS/DMG vs Vibeboard 分档）。

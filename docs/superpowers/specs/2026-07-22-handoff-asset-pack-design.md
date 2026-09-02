# Handoff 设计资产包（图 + 切图 + Layout IR）

**日期：** 2026-07-22  
**产品选择：** ① 设计资产包 — 图 + 切图 + IR，代码全靠 Cursor / Codex / Claude Code  
**状态：** 设计稿（待实现）

---

## 1. 问题与目标

### 1.1 问题

当前 handoff 以「整张烤平 UI 图 + 散文式 `designSpec`」为主。编码 Agent 只能模仿风格，无法还原图中**由多素材拼装**的部分（插画、英雄图、头像、复杂背景等），因为这些零件没有独立文件与组装关系。

### 1.2 目标

将 handoff 升级为 **三通道设计资产包**：

| 通道 | 交付物 | Agent 用法 |
|------|--------|------------|
| 视觉真理 | `assets/final/*` | 对照布局/氛围，**不是**唯一实现输入 |
| 媒体零件 | `assets/slices/*` | `rebuildInCode:false` 的节点必须引用 |
| 结构 IR | `design/layouts/*.json` | 搭 DOM/组件树的权威几何与职责 |

**成功标准：** Agent 用 IR 搭架子 + 用切图填媒体 + 用代码做控件/文案；不再用 CSS 重绘复杂位图区域。

**非目标（本规格）：** React 脚手架、Vibeboard MCP、导出 Figma、改写生图为槽位流水线（见 §7 后续）。

---

## 2. 研究结论：还能更好的方向

在坚持「① 资产包、不自产代码」的前提下，行业与论文额外指出这些高杠杆增强（已并入本设计的 Phase 1b / 约束）：

### 2.1 行业（2025–2026）

- **截图 → 代码是弱路径**；强路径是结构化设计源（Figma MCP 读图层树）。我们没有 Figma 图层时，**Layout IR + slices** 是等价替代物。
- **Agent 指令三层：** `AGENTS.md`（行为）/ `SKILL.md`（任务）/ `DESIGN.md`（外观）。Handoff 应显式带 **`DESIGN.md` + `skills/design-to-code/SKILL.md`**，而不是只靠 kickoff 一段话。
- **负向约束（Don'ts）比正向描述更能防漂移**（Google DESIGN.md 实践）：必须写死「禁止重绘 hero/illustration」。
- **Token 用 DTCG JSON**（W3C Design Tokens），便于 Agent 与工具链解析，而不仅是自定义 `tokens.json` 形状。

### 2.2 学术 UI2Code

- **ScreenCoder / DCGen / DOne：** Grounding → Layout schema → Code；且强调 **visual element retrieval**（裁切/检索资产再嵌回），而不是端到端重绘。
- 扁平 region 列表不够时，**嵌套树 + 父子关系** 显著降低结构幻觉。
- **分而治之：** 大图按区块处理再组装。

### 2.3 开源/技能实践

- design-to-code skill：**英雄/CTA/人像必须独立文件**；禁止用 atlas + `background-position` 假装多图。
- Open Design Format / Lona：**声明式 JSON + 资产外置引用**（JSON 只存 path，大图不进 LLM 上下文）。

### 2.4 对 Vibeboard 的含义（已吸收）

| 增强 | 并入本规格？ | 说明 |
|------|--------------|------|
| 切图 + 扁平 IR | Phase 1a | 核心 |
| 嵌套 `children` + flex 提示 | Phase 1b | 提升结构还原 |
| `DESIGN.md` + handoff `SKILL.md` | Phase 1a | 低成本、高收益 |
| DTCG 兼容 token 导出 | Phase 1b | 与现有 `tokens.json` 并存或渐进替换 |
| 参考图相似度回填 `matchedReferenceId` | Phase 1b | 用户上传素材优先于切图 |
| 组件状态表（hover/disabled…） | Phase 1b | 写在 IR / DESIGN，仍不生成代码 |
| 上游槽位生图 | Phase 2 | 治本，另开规格 |
| Vibeboard MCP / 视觉 diff 闭环 | Phase 3 | 消费与验收 |

---

## 3. 包结构（目标态）

```
handoff/
  README.md
  LAYOUT.md                 # 人读：如何用 IR + slices
  DESIGN.md                 # 外观契约（token + don'ts）
  SPEC.md / IMPLEMENTATION.md / ASSET_MAP.md
  skills/
    design-to-code/SKILL.md # Agent 任务技能：实现本包的硬规则
  design/
    tokens.json             # 现有
    tokens.dtcg.json        # Phase 1b：DTCG
    layouts/
      index.json
      <assetId>.json        # Layout IR
    specs/
      <assetId>.md|.json    # 现有 designSpec
    project.json / brief.json / direction.json / …
  assets/
    final/*                 # 整图
    slices/<assetId>/<regionId>.png
    references/*
    manifest.json
    model-runs.json
  prompts/{target}-kickoff.md
  .cursorrules | CLAUDE.md | AGENTS.md
  handoff-report.json       # 含 sliceCoverage、layoutStats
```

四个 target（cursor / claude-code / codex / markdown）**内容相同**；仅规则文件名与 kickoff 文案差异（与现网一致）。

---

## 4. Layout IR Schema

### 4.1 文件：`design/layouts/<assetId>.json`

```ts
type LayoutIR = {
  version: 1;
  assetId: string;
  width: number;
  height: number;
  referenceImage: string; // 相对 zip 根，如 assets/final/...
  screenType?: string;
  /** 根节点列表；允许嵌套 children（Phase 1b） */
  nodes: LayoutNode[];
  meta?: {
    source: "vision" | "heuristic" | "mixed";
    slicedAt?: string;
    warnings?: string[];
  };
};

type LayoutNode = {
  id: string;
  role:
    | "nav" | "hero" | "sidebar" | "main" | "card" | "form"
    | "cta" | "footer" | "illustration" | "avatar" | "background"
    | "icon" | "other";
  /** 相对原图 0–1 */
  bbox: { x: number; y: number; w: number; h: number };
  /**
   * false → 必须引用 media，禁止用 CSS/SVG 重绘该区域视觉
   * true  → 用代码实现（文案/控件）
   */
  rebuildInCode: boolean;
  media?: string | null; // slices 相对路径
  matchedReferenceId?: string | null; // Phase 1b
  copy?: string | null;
  suggestedComponent?: string | null; // button | input | card | …
  layoutHint?: {
    direction?: "horizontal" | "vertical";
    gapPx?: number;
    paddingPx?: number | { t: number; r: number; b: number; l: number };
    align?: "start" | "center" | "end" | "stretch";
  };
  states?: Array<{
    name: "default" | "hover" | "active" | "disabled" | "loading" | "error" | "empty";
    notes: string;
  }>;
  notes?: string;
  children?: LayoutNode[];
};
```

### 4.2 `rebuildInCode` 默认策略

| role | 默认 rebuildInCode | 是否切图 |
|------|--------------------|----------|
| hero, illustration, avatar, background | false | 是 |
| icon（复杂位图） | false | 是（过小可跳过） |
| nav, form, cta, footer, card（偏 UI 铬） | true | 否 |
| other | vision notes 决定 | 按 notes |

切图最小边：默认 ≥ 32px（过小跳过并 warning）。

### 4.3 与现有 `designSpec` 关系

- Vision `regions[].bbox` → LayoutNode 主数据源。  
- `design/specs/*` **保留**作人读补充；IR 为机器权威。  
- 导出时若缺 bbox：对媒体 role **强制补跑 vision**（见 §5）；仍失败则该节点不进 slices，IR 标注 `meta.warnings`。

---

## 5. 流水线

```
选中 assets
  → 确保 designSpec（已有 vision 优先，否则 extract）
  → 媒体 role 缺 bbox → 补跑 vision（强制 bbox）
  → 按策略切图 → assets/slices/...
  → （1b）与 references 做简单相似度/同 src 匹配 → matchedReferenceId
  → 写 Layout IR + index.json
  → 写 LAYOUT.md / DESIGN.md / skills/...
  → 更新 kickoff + agent rules + handoff-report
  → zip
```

### 5.1 代码落点（实现时）

| 模块 | 职责 |
|------|------|
| `src/lib/handoff/layout-ir.ts` | schema、从 designSpec 构建 IR |
| `src/lib/handoff/slice-assets.ts` | bbox crop（sharp/canvas）、写 PNG |
| `src/lib/handoff/match-references.ts` | Phase 1b 参考图匹配 |
| `src/lib/design-spec/extract-asset-spec.ts` | 媒体 role 强制 bbox；role 扩 avatar/background/icon |
| `src/lib/handoff/markdown-target.ts` | 打包新文件 |
| `src/lib/handoff/kickoff-prompt.ts` | 阅读顺序与三通道规则 |
| `src/lib/handoff/preflight.ts` | slice 覆盖率 warning |
| `src/components/handoff-dialog.tsx` | 「导出时生成切图」默认开 |
| agent 规则模板 | Don'ts + 指向 SKILL.md |

### 5.2 Preflight

- 无 final assets → error（现有）  
- 复杂视觉图（illustration/hero/marketing）且 `sliceCount===0` → **warning**（可配置升 error）  
- vision spec 覆盖率 warning（现有）保留  

---

## 6. Agent 契约（必须写入包内）

### 6.1 阅读顺序

1. `DESIGN.md`  
2. `LAYOUT.md` + `design/layouts/*`  
3. `SPEC.md` / `ASSET_MAP.md`  
4. `skills/design-to-code/SKILL.md`  
5. `assets/final/*`（对照）+ `assets/slices/*`（引用）  
6. `design/tokens.json`（及 `tokens.dtcg.json`）

### 6.2 硬规则（Don'ts）

- 禁止对 `rebuildInCode:false` 节点用 CSS/SVG/生成图「重画」；必须 `<img>` / `background-image` 引用 `media` 或 matched reference。  
- 禁止只用整张 `assets/final` 做背景糊弄实现。  
- 禁止发明 IR 中不存在的屏幕（除非用户扩 scope）。  
- 控件文案用 `copy` 与真实文本，不用 OCR 糊图文字。  

### 6.3 Kickoff 变更要点

现有「Treat assets/final as primary visual reference」改为：

- **final = 对照真理**  
- **layouts + slices = 实现输入**  
- **tokens / DESIGN.md = 外观约束**

---

## 7. 分阶段交付

### Phase 1a（MVP，本规格首实现）

- [ ] Layout IR（扁平 nodes + 必填 bbox）  
- [ ] 切图写入 `assets/slices`  
- [ ] `LAYOUT.md` + `DESIGN.md` + `skills/design-to-code/SKILL.md`  
- [ ] kickoff / rules / preflight / report 更新  
- [ ] 单测：IR 构建、切图边界、kickoff 含三通道文案  

### Phase 1b（同属①，提升还原上限）

- [ ] `children` 嵌套 + `layoutHint`  
- [ ] `matchedReferenceId`  
- [ ] `states[]`  
- [ ] `tokens.dtcg.json`  
- [ ] role 扩展与 vision prompt 强化  

### Phase 2（治本，另规格）

- 上游槽位/分轨生图：屏幕 = 组装预览，零件从生成起独立  

### Phase 3（消费与验收）

- Vibeboard MCP、实现后截图 vs golden 视觉 diff  

---

## 8. 风险与缓解

| 风险 | 缓解 |
|------|------|
| Vision bbox 不准 | 媒体 role 强制重抽；preflight warning；允许用户在 UI 调框（后续） |
| 切图切到文字 | chrome role 默认不切；notes 可标「含字则 rebuildInCode」 |
| Zip 体积变大 | 仅切媒体区；JPEG 可选；跳过过小区域 |
| Agent 仍忽略 IR | SKILL + Don'ts + kickoff 置顶；report 打印 slice 数 |

---

## 9. 验收清单

- [ ] 导出含至少 1 张带 hero/illustration 的图时，zip 内存在对应 slice 与 layout JSON  
- [ ] kickoff 明确三通道与禁止重绘  
- [ ] `handoff-report.json` 含 `sliceCount` / `layoutCount`  
- [ ] 手工：用 Cursor 打开包，按 SKILL 实现一屏，媒体区为真实切图引用  

---

## 10. 规格自检

- 无「待定」阻塞 MVP：bbox 失败路径已定义为 warning + 跳过切图  
- 与「① 不自产代码」一致：无脚手架、无强制 HTML 导出  
- Phase 1b 为增强，不阻塞 1a  
- 后续槽位生图 / MCP 已隔离到 Phase 2/3，避免范围膨胀  

---

## 11. 参考

- ScreenCoder / DCGen / DOne（modular grounding + asset retrieval）  
- Figma MCP / Dev Mode（结构化 > 截图）  
- DESIGN.md + AGENTS.md + SKILL.md 三层 Agent 契约  
- W3C DTCG design tokens  
- design-to-code skill：独立资产 vs atlas 禁令  

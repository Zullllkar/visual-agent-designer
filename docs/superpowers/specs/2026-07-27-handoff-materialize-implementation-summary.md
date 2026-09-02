# 实现总结：满意整图 → 拆素材 → Handoff 资产包

**日期：** 2026-07-27  
**规格：** [`2026-07-22-handoff-materialize-final-design.md`](./2026-07-22-handoff-materialize-final-design.md)  
**状态：** P0–P2 主路径已落地（含 Chat Job、bbox 拖拽、layoutHint）

---

## 1. 一句话

用户先认可一张整屏 UI mockup → 系统拆出 Layout IR 并按槽**再生成**独立 materials → 打包成带完整契约的 zip → Cursor / Claude Code / Codex 按 IR 引用零件实现 UI，而不是猜一张烤平图。

---

## 2. 用户路径（已实现）

```text
生成整屏图
  → 满意后「拆成素材」/ Agent: materialize_mockup
  → 审槽面板（叠框 / 拖拽调框 / 单槽重做 / 标为代码）
  → JobScheduler 并行生零件（失败则 crop 回退）
  → 导出 Handoff zip
  → 编码 Agent 按 DESIGN → LAYOUT → materials 实现
```

| 入口 | 行为 |
|------|------|
| 画布选中整图 →「拆成素材」 | 调 API → Job → 完成后打开审槽 |
| 已拆图 →「审槽」 | 打开确认面板 |
| 对话「拆成素材 / 满意拆…」 | Planner 调 `materialize_mockup`（异步 Job） |
| Handoff 预检警告 | 「对勾选定稿拆成素材」 |
| 导出 Handoff | 写入 materials / layouts / DESIGN 等 |

---

## 3. 完成功能清单

### 3.1 数据模型

| 能力 | 说明 |
|------|------|
| Mockup 审批态 | `asset.approval.status`: draft / approved / materializing / materials_ready |
| 材料资产 | `source: "materialized"`，`materialSlotId` / `parentAssetId` / `role` |
| Layout IR | 媒体槽（`rebuildInCode: false`）+ 代码槽（`true`）+ bbox + prompt/copy |
| Style lock | palette / mood / doNot / summary |
| 嵌套提示 | `layoutHint.parentId` / `zIndex` / `order`（按 bbox 包含推断） |
| 项目索引 | `project.materializations[mockupAssetId]` |

### 3.2 拆解与生图

| 能力 | 说明 |
|------|------|
| Vision / heuristic 拆解 | designSpec regions → Layout IR + style lock |
| 按槽再生成 | 以锁定整图为 reference；透明底/孤立主体 prompt |
| 库优先复用 | 同 mockup + slot 的已有材料可复用 |
| 限并发并行 | 默认并发 3（进程内池） |
| Job 异步 | `materialize_slots` 接入 JobScheduler |
| 成本预估 | 拆解 ~$0.02 + 每槽 ~$0.04 |
| Crop 预览 | resvg 按 bbox 裁切，供审槽展示 |
| Crop 回退 | 生图失败 → `assets/slices/*`，MATERIAL_MAP 标注 fallback |

### 3.3 审槽 UI（Step C）

| 能力 | 说明 |
|------|------|
| 整图叠框 | object-contain 对齐真实画面 |
| 拖拽 / 缩放 bbox | 选中媒体槽后拖动；右下角缩放 |
| 应用并重做 | 清材料绑定 → Job 重生 |
| 单槽重做 | `forceRegen` + 可选草稿 bbox |
| 标为代码 | 媒体槽 → `rebuildInCode: true` |
| 成本提示 | 待生图槽数对应预估费用 |

### 3.4 Handoff 打包

Zip 额外（或补强）包含：

| 路径 | 作用 |
|------|------|
| `DESIGN.md` | 风格锁、Don'ts、验收清单 |
| `LAYOUT.md` | 如何读 IR / layoutHint |
| `MATERIAL_MAP.md` | 槽位 ↔ 文件 ↔ 状态 |
| `design/layouts/*.json` | Layout IR 权威几何 |
| `design/layouts/index.json` | 索引 |
| `assets/materials/<mockupId>/*` | 独立零件（权威媒体） |
| `assets/slices/*` | 裁切回退（非权威） |
| `assets/final/*` | 整图对照真理 |
| `skills/design-to-code/SKILL.md` | 编码 Agent 阅读顺序与硬规则 |
| `preview/assembly.html` | 材料 + IR 拼装证明 |
| `design/tokens.json` | 既有 token |
| `design/tokens.dtcg.json` | DTCG `$type`/`$value` |
| kickoff prompt | 三通道 + 视觉验收步骤 |

### 3.5 Agent / Chat / Preflight

| 能力 | 说明 |
|------|------|
| 工具 `materialize_mockup` | 拆解后提交 Job；`skipGeneration` 仅审槽 |
| Planner | 「拆成素材」触发；高保真导出前可先 materialize |
| Timeline | Job 标题「拆成素材」；摘要「已拆素材」 |
| Preflight | 无 materials → warning，不阻断导出 |

---

## 4. 实现方式（架构）

### 4.1 分层

```text
UI (selection bar / review dialog / handoff dialog)
        │
        ▼
POST /api/agents/materialize
        │
        ├─ sync: markCode / bbox-only / skipGeneration / async:false
        └─ async: JobScheduler.type = "materialize_slots"
                    │
                    ▼
           generateMaterialsForLayout()
                    │
                    ├─ cropSlotFromMockup (resvg)
                    ├─ image.generateImage (parallel pool)
                    └─ crop fallback → slices
        │
        ▼
project.materializations + assets[]
        │
        ▼
markdown-target → appendMaterializationFiles → zip
```

### 4.2 关键文件

| 文件 | 职责 |
|------|------|
| `src/lib/handoff/layout-ir.ts` | IR schema、build、layoutHint、markAsCode |
| `src/lib/handoff/decompose-mockup.ts` | 锁定 + vision/heuristic 拆解 |
| `src/lib/handoff/generate-materials.ts` | 并行生材料 + 回退 |
| `src/lib/handoff/crop-slot.ts` | bbox 裁切（server / resvg） |
| `src/lib/handoff/materialize-cost.ts` | 成本预估（client/server 共用） |
| `src/lib/handoff/slot-ops.ts` | 标代码、改 bbox（纯函数） |
| `src/lib/handoff/material-pack.ts` | DESIGN/LAYOUT/MAP/SKILL/assembly |
| `src/lib/handoff/tokens-dtcg.ts` | DTCG 转换 |
| `src/lib/handoff/preflight.ts` / `kickoff-prompt.ts` | 预检与 kickoff |
| `src/lib/agents/tools/materialize-mockup.ts` | Agent 工具 → Job |
| `src/lib/agents/job/job-handlers.ts` | `materialize_slots` handler |
| `src/app/api/agents/materialize/route.ts` | HTTP 入口 |
| `src/components/materials-review-dialog.tsx` | 审槽 + 拖框 |
| `src/components/ide/selection-floating-bar.tsx` | 拆/审入口 |
| `src/components/handoff-dialog.tsx` | 预检 CTA + 包预览 |
| `src/lib/project/assets-schema.ts` / `schema.ts` | approval、materializations |

### 4.3 关键设计决策

1. **终交付权威是再生成的 materials**，不是切图；crop 仅预览与失败兜底。  
2. **整图只作对照与 reference**，禁止编码 Agent 把整图当唯一背景。  
3. **生图默认走 Job**，避免长请求阻塞 API；UI/工具轮询 `/api/jobs/:id`。  
4. **显式 `slotIds` = 强制重做**（含已 ready），并丢弃旧材料资产。  
5. **代码槽不生图**；可从媒体槽「标为代码」降级。  
6. **layoutHint 启发式嵌套**：取面积最小的严格父框；background 作根层。

### 4.4 测试覆盖（代表性）

| 套件 | 覆盖点 |
|------|--------|
| `layout-ir.test.ts` | IR 构建、ready 计数、markAsCode、layoutHint 嵌套 |
| `generate-materials.test.ts` | forceRegen、crop 回退、并发上限、成本字段 |
| `materialize-cost.test.ts` | 拆解 + 每槽费用 |
| `material-pack.test.ts` | zip 侧文档与 materials 路径 |
| `slot-ops.test.ts` | 标代码、bbox 更新清绑定 |
| `tokens-dtcg.test.ts` | DTCG 映射 |
| `registry.test.ts` | 工具注册 / 确认列表含 `materialize_mockup` |

> 本机若 C 盘空间不足，vitest 临时目录需指到 E:（`TEMP`/`TMP`）。

---

## 5. API / 工具契约（摘要）

### `POST /api/agents/materialize`

| 字段 | 含义 |
|------|------|
| `projectId` / `assetId` | 项目与整图 |
| `providerConfig` | 拆解/生图需要 |
| `skipGeneration` | 仅 IR |
| `slotIds` / `forceRegen` | 单槽或强制重生 |
| `markCodeSlotIds` | 标为代码 |
| `bboxUpdates` | `[{ slotId, bbox }]` |
| `async` | 默认 `true` → 返回 `job` |

### Agent 工具 `materialize_mockup`

- 无 IR：先 decompose 再提交 `materialize_slots` Job  
- `skipGeneration: true`：只返回拆解结果与成本预估  
- 有 `slotIds`：强制重做这些槽  

---

## 6. 与规格阶段对照

| 阶段 | 规格 | 实现 |
|------|------|------|
| P0 闭环 | 锁定 → IR → materials → 打包 | ✅ |
| P1 体验 | 审槽、单槽重做、透明底、DTCG、preflight | ✅（含 crop / layoutHint） |
| P2 加强 | 并行、成本、拖框、验收说明、Job | ✅ |

**明确未做 / 可后续：**

- 槽位级完整后台 Job 分片（当前为一次 Job + 内并行池）  
- Job 失败后一键 Retry（`materialize_slots` 尚未像 direct_image 那样可 POST retry）  
- 嵌套 layout 的可视化树编辑（仅 IR 字段 + 审槽 parent 提示）  
- Vibeboard 内生成完整生产级 React 工程（规格明确不做）

---

## 7. 手测清单（建议）

1. 生成并收藏一张整屏 UI。  
2. 选中 →「拆成素材」→ 等待 Job → 审槽打开。  
3. 拖动某一媒体框 →「应用并重做」→ 新材料出现。  
4. 对一槽「标为代码」→ MATERIAL_MAP 显示 code。  
5. 导出 Cursor/Codex zip → 确认含 `DESIGN.md`、`design/layouts/*`、`assets/materials/*`、`tokens.dtcg.json`、`preview/assembly.html`。  
6. 将 kickoff 贴给编码 Agent，确认其按 materials + IR 而非整图糊背景实现。

---

## 8. 相关文档

- 产品终态规格：`docs/superpowers/specs/2026-07-22-handoff-materialize-final-design.md`  
- 早期 P0 计划：`docs/superpowers/plans/2026-07-25-handoff-materialize-p0.md`（文件路径以本文 §4.2 为准）  

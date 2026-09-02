# Handoff Materialize P0 实现计划

> **面向 AI 代理的工作者：** 按任务顺序实现；每任务可测。

**目标：** 满意整图 → 拆解 IR + 风格锁 → 按槽再生成 materials → handoff 打包给编码 Agent。  
**架构：** `layout-ir` 纯函数 + `materialize` 工具/API + `markdown-target` 导出扩展。  
**技术栈：** 现有 Zod / LangGraph tools / jszip handoff / image provider。

## 文件

| 文件 | 职责 |
|------|------|
| `src/lib/project/layout-ir-schema.ts` | LayoutIR / Slot / StyleLock schema |
| `src/lib/project/assets-schema.ts` | approval + source materialized |
| `src/lib/project/schema.ts` | materializations map |
| `src/lib/handoff/build-layout-ir.ts` | designSpec → IR |
| `src/lib/handoff/style-lock.ts` | 从 spec/tokens 建风格锁 |
| `src/lib/handoff/materialize-run.ts` | 锁定+拆解+生材料（服务端） |
| `src/lib/agents/tools/materialize-mockup.ts` | Agent 工具 |
| `src/lib/handoff/markdown-target.ts` | 打包 materials/IR/docs |
| `src/lib/handoff/kickoff-prompt.ts` | 三通道阅读顺序 |
| `src/lib/handoff/preflight.ts` | materials 覆盖 warning |
| `src/app/api/agents/materialize/route.ts` | UI 入口 |
| `src/components/ide/selection-floating-bar.tsx` | 「满意并拆素材」 |
| `src/lib/agents/chat-schema.ts` + plan-schema + index | 注册工具名 |

## P0 范围

- 锁定 → vision/heuristic 拆解 → 并行生材料（mockup 作 reference）  
- 风格锁写入 IR meta  
- Handoff：materials + layouts + DESIGN/LAYOUT/MATERIAL_MAP/SKILL + kickoff  
- UI 一键 + Agent 工具  
- 单测：build-layout-ir、handoff 含新文件  

不做：槽位 UI 编辑器、组装 HTML、DTCG、单槽重做面板（P1）。

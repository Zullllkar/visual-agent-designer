# 设计规格：项目多对话会话（Cursor 风格）

- 日期：2026-08-12
- 状态：已批准，实现中
- 方案：客户端会话表 + 每会话独立 `threadId`（方案 1）

## 1. 背景与目标

当前侧栏是「一个项目 = 一条对话」：

- UI：`chat-store.sessions[projectId] → ChatMessage[]`
- Agent：`threadIdForProject(projectId) = vad-project-${projectId}`（一项目一 checkpoint 链）

目标对齐 Cursor：

1. 同一项目可有多条对话记录，可切换
2. 「新建对话」得到空白会话 + 新 `threadId`
3. 旧会话进列表，可继续打开聊

非目标（本版不做）：置顶、搜索、导出单会话、跨项目移动、云端同步会话列表。

## 2. 数据模型

```ts
type Conversation = {
  id: string;           // conv_${nanoid}
  projectId: string;
  title: string;
  createdAt: string;    // ISO
  updatedAt: string;    // ISO
  threadId: string;     // LangGraph / WS 记忆键
  messages: ChatMessage[];
  titleLocked?: boolean; // 用户手动改名后为 true，禁止自动覆盖
};

// Store（概念）
conversationsByProject: Record<projectId, Conversation[]>
activeIdByProject: Record<projectId, conversationId>
```

持久化：

- Zustand `persist` 升级（建议 storage key `vad.chat.v2`）
- 继续同步当前项目会话列表到 `.vad`（在现有 `scheduleChatSyncToVad` 上扩展为按 conversation 或整表写入；实现时选最小改动路径）

## 3. 迁移

首次加载若仍存在旧结构 `sessions[projectId]` / `threadIds[projectId]`：

1. 为每个有消息（或有 threadId）的项目生成一条 Conversation：
   - `title = "默认对话"`
   - `messages = sessions[projectId] ?? []`
   - `threadId = threadIds[projectId] ?? \`thread-${nanoid(12)}\``
   - `titleLocked = true`（避免自动改写历史标题）
2. `activeIdByProject[projectId] =` 该会话 id
3. 之后只读写新结构；旧字段可读一版做兼容，不再写入

无历史的项目：打开侧栏时懒创建一条空「新对话」。

## 4. UI / 交互

侧栏顶栏：

- 显示当前会话标题
- 「新建对话」按钮
- 会话列表面板（下拉或 popover）：按 `updatedAt` 倒序

行为：

| 动作 | 行为 |
|------|------|
| 新建 | 创建空 messages + 新 `thread-${nanoid(12)}`，标题「新对话」，立即切为当前 |
| 切换 | 仅改 `activeId`；停止展示上一会话 live 状态；进行中的 run 若绑定旧 thread，不自动取消（实现时可提示「上一会话任务仍在后台」或保持现状不拦截） |
| 重命名 | 改 `title`，设 `titleLocked=true` |
| 删除 | 二次确认；删除 messages；尽力清理该 `threadId` checkpoint；若删的是当前，切到最近一条，没有则新建空会话 |

标题自动生成：

- 新建默认「新对话」
- 该会话发出**首条用户消息**后：取去噪前缀后的正文前 24 字作为标题
- 去噪前缀示例：`【引用素材: …】`、`【参考图: …】`、`【引用页面: …】`、`【引用元素: …】`
- `titleLocked === true` 时不自动覆盖

## 5. 与 Agent / 上下文的关系

发送链路：

1. `ide-shell` 取**当前会话**的 `messages` + `threadId`
2. WS `agent.run` **必须显式携带**该 `threadId`
3. 服务端已有 `cmd.threadId ?? threadIdForProject(projectId)`；多会话场景下客户端不得省略 `threadId`，否则会回落到项目级线程并串记忆

模型上下文（不变，文档化）：

- 真正进 LangGraph 的主要是本轮 user prompt + checkpoint 历史
- `preModelHook` 滑动窗口：约 24 条 / 60k 字符近期原文，更早摘要；超阈值写回 checkpoint
- 多会话的价值：话题隔离 + 独立 checkpoint，降低串上下文；不取代窗口裁剪

侧栏长历史仍可能涨大（localStorage），与模型上下文是两套预算。

## 6. Store API（建议）

在 `chat-store`（或拆出 `conversation-store`，优先扩展现有 store 以减少引用改动）暴露：

- `listConversations(projectId)`
- `getActiveConversation(projectId)`
- `createConversation(projectId)`
- `switchConversation(projectId, conversationId)`
- `renameConversation(projectId, conversationId, title)`
- `deleteConversation(projectId, conversationId)`
- `append` / `appendMany` / `truncate*` 改为针对**当前会话**（或显式传 `conversationId`）
- `getThreadId` → 当前会话 `threadId`（兼容旧调用名）

所有写操作更新该会话 `updatedAt`。

## 7. 检查点清理

删除会话时：

- 优先扩展服务端能力：按任意 `threadId` 删除 checkpoint（现有 `clearProjectMemory` 只清 `vad-project-${id}`）
- 客户端删除后 fire-and-forget 调清理 API；失败仅打日志，不阻断 UI

## 8. 测试要点

- 迁移：旧单会话 → 一条「默认对话」，消息与 thread 保留
- 新建：空消息、新 threadId、与旧会话隔离
- 切换：消息列表与标题正确
- 自动标题：首条用户消息触发；手动改名后不再覆盖
- 删除当前会话：回退到最近 / 新建
- 发送：`agent.run` payload 含当前 `threadId`（单测或 WS client mock）

## 9. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 忘记传 threadId 串记忆 | 发送路径强制取自 active conversation；缺省时断言/打错误而非静默回落项目 thread |
| localStorage 变大 | 本版不截断 UI 历史；后续可做按会话归档 |
| 进行中 run 时切换会话 | 本版允许切换；列表可对 running thread 显示「运行中」徽标（可选，非必须） |

## 10. 验收标准

1. 同一项目可新建 ≥2 条对话并切换，消息互不混入
2. 新对话首轮 Agent 不携带旧会话 checkpoint 记忆
3. 老项目打开后历史对话仍在「默认对话」中
4. 可重命名、可删除（含删当前后的回退）

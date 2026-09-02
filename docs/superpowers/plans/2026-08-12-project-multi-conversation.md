# 实现计划：项目多对话会话

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 同一项目支持多条 Cursor 风格对话；新建空白会话 + 新 thread；可切换/重命名/删除。

**Architecture:** 扩展 `chat-store` 为 `conversationsByProject` + `activeIdByProject`；发送强制带当前 `threadId`；侧栏顶栏会话切换器。

**Tech Stack:** Zustand persist v2、现有 WS `agent.run.threadId`、 vitest

## 文件

| 文件 | 职责 |
|------|------|
| `src/store/chat-store.ts` | 会话模型、迁移、CRUD、消息写当前会话 |
| `src/lib/chat/conversation-title.ts` | 标题去噪与截断 |
| `src/lib/vad/chat-sync.ts` | 仍同步「当前会话 messages」（最小改动） |
| `src/components/ide/conversation-switcher.tsx` | 新建/列表/重命名/删除 UI |
| `src/components/ide/chat-stream-view.tsx` | 顶栏接入 switcher |
| `src/components/ide/ide-shell.tsx` | 读 active 消息；send 传 threadId；ensureConversation |
| `src/lib/chat/use-chat-stream.ts` | send 透传 threadId |
| `src/lib/agents/checkpoint.ts` + API | `clearThreadMemory(threadId)` |
| `src/store/chat-store.test.ts` 等 | 迁移与 API 测试 |

## 任务

### Task 1: Store + 迁移 + 标题工具
### Task 2: ide-shell / WS 接线 threadId
### Task 3: ConversationSwitcher UI
### Task 4: checkpoint 清理 API
### Task 5: 单测

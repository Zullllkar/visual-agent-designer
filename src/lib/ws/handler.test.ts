import { describe, it, expect } from "vitest";
import { WsCommandSchema, WsEventSchema } from "@/lib/ws/types";
import { eventBuffer } from "@/lib/ws/event-buffer";
import { connectionManager } from "@/lib/ws/connection-manager";

describe("WebSocket Handler", () => {
  describe("WsCommandSchema", () => {
    it("should validate agent.run command", () => {
      const result = WsCommandSchema.safeParse({
        action: "agent.run",
        prompt: "生成一个智能助手",
        projectId: "test-123",
      });
      expect(result.success).toBe(true);
    });

    it("should validate agent.cancel command", () => {
      const result = WsCommandSchema.safeParse({
        action: "agent.cancel",
        runId: "run-abc",
      });
      expect(result.success).toBe(true);
    });

    it("should validate agent.approve command", () => {
      const result = WsCommandSchema.safeParse({
        action: "agent.approve",
        prompt: "A single mobile app home screen UI",
        count: 1,
        projectId: "test-123",
      });
      expect(result.success).toBe(true);
    });

    it("should validate tool approval commands with edited args", () => {
      const approve = WsCommandSchema.safeParse({
        action: "tool.approve",
        projectId: "test-123",
        runId: "run-abc",
        approvalId: "approval-1",
        toolArgs: { prompt: "approved prompt", count: 1 },
      });
      const cancel = WsCommandSchema.safeParse({
        action: "tool.cancel",
        projectId: "test-123",
        runId: "run-abc",
        approvalId: "approval-1",
      });
      expect(approve.success).toBe(true);
      expect(cancel.success).toBe(true);
    });

    it("should validate canvas.subscribe command", () => {
      const result = WsCommandSchema.safeParse({
        action: "canvas.subscribe",
        projectId: "test-123",
        threadId: "thread-xyz",
      });
      expect(result.success).toBe(true);
    });

    it("should reject unknown action", () => {
      const result = WsCommandSchema.safeParse({
        action: "unknown.action",
      });
      expect(result.success).toBe(false);
    });

    it("should reject missing action", () => {
      const result = WsCommandSchema.safeParse({
        prompt: "test",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("WsEventSchema", () => {
    it("should validate command.ack event", () => {
      const result = WsEventSchema.safeParse({
        type: "command.ack",
        data: { runId: "run-1", threadId: "thread-1" },
      });
      expect(result.success).toBe(true);
    });

    it("should validate message.delta event", () => {
      const result = WsEventSchema.safeParse({
        type: "message.delta",
        data: { text: "hello", runId: "run-1" },
      });
      expect(result.success).toBe(true);
    });

    it("should validate run.completed event", () => {
      const result = WsEventSchema.safeParse({
        type: "run.completed",
        data: { runId: "run-1" },
      });
      expect(result.success).toBe(true);
    });

    it("should validate LLM lifecycle events", () => {
      const result = WsEventSchema.safeParse({
        type: "llm.started",
        data: { runId: "run-1" },
      });
      expect(result.success).toBe(true);
    });

    it("should reject unknown event type", () => {
      const result = WsEventSchema.safeParse({
        type: "unknown.event",
        data: {},
      });
      expect(result.success).toBe(false);
    });
  });

  describe("EventBuffer", () => {
    it("should buffer and replay events", () => {
      const threadId = "test-thread-buffer";
      eventBuffer.push(threadId, {
        type: "message.delta",
        data: { text: "hello" },
      });
      eventBuffer.push(threadId, {
        type: "message.delta",
        data: { text: " world" },
      });

      const recent = eventBuffer.getRecent(threadId);
      expect(recent.length).toBe(2);
      expect(recent[0].type).toBe("message.delta");
    });

    it("should return empty array for unknown thread", () => {
      const recent = eventBuffer.getRecent("nonexistent-thread");
      expect(recent).toEqual([]);
    });
  });

  describe("ConnectionManager", () => {
    it("should track subscriptions by projectId", () => {
      // connectionManager is a singleton; just verify it has the expected methods
      expect(typeof connectionManager.subscribeToCanvas).toBe("function");
      expect(typeof connectionManager.pushToCanvas).toBe("function");
    });
  });
});

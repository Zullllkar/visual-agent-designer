/**
 * Feature Flags Tests
 * --------------------------------------------------------------
 * 测试 feature flags 的加载、获取和更新逻辑
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  getFeatureFlags,
  setFeatureFlags,
  resetFeatureFlags,
  isFeatureEnabled,
  getNumericConfig,
} from "./feature-flags";

describe("Feature Flags", () => {
  beforeEach(() => {
    resetFeatureFlags();
  });

  describe("getFeatureFlags", () => {
    it("should return default flags", () => {
      const flags = getFeatureFlags();
      expect(flags.enableParallelToolExecution).toBe(true);
      expect(flags.enableContextCompression).toBe(false);
      expect(flags.enableSpecializedAgents).toBe(false);
      expect(flags.maxToolConcurrency).toBe(5);
      expect(flags.toolExecutionTimeout).toBe(5 * 60 * 1000);
    });

    it("should return a copy (not mutable)", () => {
      const flags1 = getFeatureFlags();
      const flags2 = getFeatureFlags();
      expect(flags1).not.toBe(flags2);
      expect(flags1).toEqual(flags2);
    });
  });

  describe("setFeatureFlags", () => {
    it("should update flags", () => {
      setFeatureFlags({ enableParallelToolExecution: false });
      expect(getFeatureFlags().enableParallelToolExecution).toBe(false);
    });

    it("should partially update flags", () => {
      setFeatureFlags({ maxToolConcurrency: 10 });
      const flags = getFeatureFlags();
      expect(flags.maxToolConcurrency).toBe(10);
      expect(flags.enableParallelToolExecution).toBe(true); // 其他不变
    });
  });

  describe("resetFeatureFlags", () => {
    it("should reset to default", () => {
      setFeatureFlags({
        enableParallelToolExecution: false,
        maxToolConcurrency: 10,
      });
      resetFeatureFlags();
      const flags = getFeatureFlags();
      expect(flags.enableParallelToolExecution).toBe(true);
      expect(flags.maxToolConcurrency).toBe(5);
    });
  });

  describe("isFeatureEnabled", () => {
    it("should return true for enabled features", () => {
      expect(isFeatureEnabled("enableParallelToolExecution")).toBe(true);
    });

    it("should return false for disabled features", () => {
      expect(isFeatureEnabled("enableContextCompression")).toBe(false);
    });

    it("should return false for non-boolean keys", () => {
      expect(isFeatureEnabled("maxToolConcurrency" as any)).toBe(false);
    });
  });

  describe("getNumericConfig", () => {
    it("should return numeric config values", () => {
      expect(getNumericConfig("maxToolConcurrency")).toBe(5);
      expect(getNumericConfig("toolExecutionTimeout")).toBe(5 * 60 * 1000);
    });

    it("should return updated values", () => {
      setFeatureFlags({ maxToolConcurrency: 10 });
      expect(getNumericConfig("maxToolConcurrency")).toBe(10);
    });
  });
});

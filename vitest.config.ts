import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./vitest-stub.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.spec.ts", "desktop/**/*.test.ts"],
    environment: "node",
    // Windows 上 afterEach 里清理临时目录（rm -rf）偶尔会超过默认 10s，放宽 hook 超时。
    hookTimeout: 60000,
    // 真实文件系统读写（mkdtemp/write/read/delete）在 Windows 上偏慢，放宽用例超时。
    testTimeout: 30000,
  },
});

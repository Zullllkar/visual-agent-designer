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
  },
});

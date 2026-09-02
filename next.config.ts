import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // 让 Turbopack 把这些 native binding 类包用 Node.js 原生 require 加载，
  // 而不是塞进 server bundle（platform-specific 二进制无法被打包）。
  serverExternalPackages: [
    "@resvg/resvg-js",
    "@langchain/langgraph-checkpoint-sqlite",
    "better-sqlite3",
  ],
  // WebSocket 通过 custom server 挂载，不需要 Next.js 额外配置
  // server.ts 使用 tsx 运行，会自动加载 next.config.ts
};

export default nextConfig;

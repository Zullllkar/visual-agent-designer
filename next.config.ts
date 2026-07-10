import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 让 Turbopack 把这些 native binding 类包用 Node.js 原生 require 加载，
  // 而不是塞进 server bundle（platform-specific 二进制无法被打包）。
  serverExternalPackages: ["@resvg/resvg-js"],
};

export default nextConfig;

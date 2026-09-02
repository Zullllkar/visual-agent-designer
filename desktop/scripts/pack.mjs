/**
 * 组装 sidecar（standalone Next + 自定义 server + 本机 Node）并调用 electron-builder。
 * 用法：pnpm dist:desktop   或   node desktop/scripts/pack.mjs --dir
 */

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sidecar = path.join(root, "dist-sidecar");
const isWin = process.platform === "win32";

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: isWin,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function copyIfExists(from, to) {
  if (!existsSync(from)) return;
  mkdirSync(path.dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
}

rmSync(sidecar, { recursive: true, force: true });
mkdirSync(sidecar, { recursive: true });

console.log("[pack] next build (standalone)");
if (process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY) {
  console.log("[pack] tldraw license key present");
}
run("pnpm", ["exec", "next", "build"]);

const standalone = path.join(root, ".next", "standalone");
if (!existsSync(standalone)) {
  console.error("[pack] 缺少 .next/standalone，请确认 next.config.ts 已设 output: 'standalone'");
  process.exit(1);
}

const appDir = path.join(sidecar, "app");
cpSync(standalone, appDir, { recursive: true });
copyIfExists(
  path.join(root, ".next", "static"),
  path.join(appDir, ".next", "static")
);
copyIfExists(path.join(root, "public"), path.join(appDir, "public"));
copyIfExists(path.join(root, "skills"), path.join(appDir, "skills"));
copyIfExists(
  path.join(root, "design-systems"),
  path.join(appDir, "design-systems")
);

console.log("[pack] bundle custom server");
run("pnpm", [
  "exec",
  "esbuild",
  "server.ts",
  "--bundle",
  "--platform=node",
  "--packages=external",
  `--alias:server-only=${path.join("desktop", "server-only-stub.cjs")}`,
  `--outfile=${path.join("dist-sidecar", "server.cjs")}`,
]);

const nodeDest = path.join(sidecar, isWin ? "node.exe" : "node");
copyFileSync(process.execPath, nodeDest);
console.log(`[pack] copied node → ${nodeDest}`);

const builderArgs = process.argv.includes("--dir")
  ? ["exec", "electron-builder", "--dir"]
  : isWin
    ? ["exec", "electron-builder", "--win"]
    : process.platform === "darwin"
      ? ["exec", "electron-builder", "--mac"]
      : ["exec", "electron-builder", "--dir"];

console.log("[pack] electron-builder", builderArgs.slice(2).join(" "));
run("pnpm", builderArgs);
console.log("[pack] done → release/");

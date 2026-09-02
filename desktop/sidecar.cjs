/**
 * 开发态 sidecar 启动命令。
 * Windows 上禁止 spawn *.cmd（Node CVE-2024-27980 会抛 spawn EINVAL）。
 */

const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

function isBatchShim(file) {
  return /\.(cmd|bat)$/i.test(String(file));
}

function isElectronBin(file) {
  return /^electron(\.cmd|\.exe)?$/i.test(path.basename(String(file)));
}

function resolveTsxCli(repoRoot) {
  const req = createRequire(path.join(repoRoot, "package.json"));
  const pkgJson = req.resolve("tsx/package.json");
  const pkg = require(pkgJson);
  const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.tsx;
  if (!bin) {
    throw new Error("tsx package.json 缺少 bin");
  }
  const cli = path.resolve(path.dirname(pkgJson), bin);
  if (!fs.existsSync(cli)) {
    throw new Error(`找不到 tsx CLI（${cli}）`);
  }
  return cli;
}

function resolveNodeBin(platform, env) {
  const candidates = [];
  if (env.npm_node_execpath) candidates.push(env.npm_node_execpath);
  const nodeName = platform === "win32" ? "node.exe" : "node";
  for (const dir of String(env.PATH || "").split(path.delimiter)) {
    if (dir) candidates.push(path.join(dir, nodeName));
  }
  if (platform !== "win32") candidates.push("node");

  for (const candidate of candidates) {
    if (!candidate || isBatchShim(candidate) || isElectronBin(candidate)) {
      continue;
    }
    if (candidate === "node") return candidate;
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    "找不到 Node.js，无法启动本地服务。请确认已安装 Node 并加入 PATH。"
  );
}

function resolveDevSidecarSpawn({ platform, repoRoot, env }) {
  const command = resolveNodeBin(platform, env);
  const tsxCli = resolveTsxCli(repoRoot);
  return {
    command,
    args: [tsxCli, "--import", "./preload.cjs", "server.ts"],
    options: {
      cwd: repoRoot,
      windowsHide: true,
      detached: false,
      shell: false,
    },
  };
}

module.exports = { resolveDevSidecarSpawn, isBatchShim };

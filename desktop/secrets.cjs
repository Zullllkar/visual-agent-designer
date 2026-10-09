/**
 * Provider 配置（含 API key）的桌面端持久化。
 * --------------------------------------------------------------
 * 浏览器里 key 只在 localStorage / 内存；标签页一关 bridge 的 request_asset
 * 就没凭证了。桌面版用 Electron safeStorage（系统钥匙串 / DPAPI）加密落到
 * userData/provider-config.enc，启动时解密推给 Next 侧，让 coding agent
 * 在没有打开界面时也能要图。
 *
 * 纯函数（校验）与依赖 Electron 的部分分开，便于单测。
 */

const fs = require("node:fs");
const path = require("node:path");

const MAX_BYTES = 64 * 1024;
const FILE_NAME = "provider-config.enc";

function providerSecretPath(userData) {
  return path.join(userData, FILE_NAME);
}

/**
 * 只接受形如 { llm?: {kind}, image?: {kind}, ... } 且至少一个不是 mock 的配置。
 * @param {unknown} json
 * @returns {{ ok: true, config: Record<string, unknown> } | { ok: false, reason: string }}
 */
function validateProviderConfigJson(json) {
  if (typeof json !== "string") return { ok: false, reason: "not_string" };
  if (Buffer.byteLength(json, "utf8") > MAX_BYTES) return { ok: false, reason: "too_large" };
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "not_object" };
  }
  const llm = parsed.llm;
  const image = parsed.image;
  const usable =
    (llm && typeof llm === "object" && llm.kind && llm.kind !== "mock") ||
    (image && typeof image === "object" && image.kind && image.kind !== "mock");
  if (!usable) return { ok: false, reason: "no_usable_provider" };
  return { ok: true, config: parsed };
}

/**
 * @param {typeof import('electron').safeStorage} safeStorage
 */
function createProviderSecretStore(safeStorage, userData, logger) {
  const file = providerSecretPath(userData);

  function available() {
    try {
      return Boolean(safeStorage?.isEncryptionAvailable?.());
    } catch {
      return false;
    }
  }

  return {
    file,
    available,
    /** @returns {{ ok: boolean, reason?: string }} */
    save(json) {
      const checked = validateProviderConfigJson(json);
      if (!checked.ok) return { ok: false, reason: checked.reason };
      if (!available()) return { ok: false, reason: "encryption_unavailable" };
      try {
        const buf = safeStorage.encryptString(json);
        fs.writeFileSync(file, buf, { mode: 0o600 });
        return { ok: true };
      } catch (err) {
        logger?.error(`provider secret save failed: ${err instanceof Error ? err.message : String(err)}`);
        return { ok: false, reason: "write_failed" };
      }
    },
    /** @returns {string | null} 解密后的 JSON 字符串 */
    load() {
      if (!fs.existsSync(file) || !available()) return null;
      try {
        const json = safeStorage.decryptString(fs.readFileSync(file));
        return validateProviderConfigJson(json).ok ? json : null;
      } catch (err) {
        logger?.error(`provider secret load failed: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    },
    clear() {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        /* ignore */
      }
    },
  };
}

/** 从 /mcp/status 拿 bridge token 后把配置推给 Next（也用于清除） */
async function pushProviderConfigToServer({ serverOrigin, json }) {
  const status = await fetch(`${serverOrigin}/mcp/status`, { cache: "no-store" });
  if (!status.ok) throw new Error(`/mcp/status ${status.status}`);
  const info = await status.json();
  const token = typeof info.token === "string" ? info.token : null;
  const headers = {
    "content-type": "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
  const res = await fetch(`${serverOrigin}/mcp/desktop/provider-config`, {
    method: json ? "POST" : "DELETE",
    headers,
    body: json ?? undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`provider-config ${res.status} ${text.slice(0, 160)}`);
  }
  return true;
}

module.exports = {
  MAX_BYTES,
  providerSecretPath,
  validateProviderConfigJson,
  createProviderSecretStore,
  pushProviderConfigToServer,
};

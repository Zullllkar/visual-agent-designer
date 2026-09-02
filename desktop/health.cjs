/**
 * Sidecar /api/health 判定：区分「进程还没起来 / 正在编译 / 可以开窗」。
 */

function isHealthPath(url) {
  const path = String(url ?? "").split("?")[0];
  return path === "/api/health";
}

function healthPayload(ready) {
  return { ok: true, ready: Boolean(ready) };
}

/**
 * @param {number} statusCode
 * @param {string} body
 * @returns {"ready" | "starting" | "down"}
 */
function parseHealthResponse(statusCode, body) {
  const code = Number(statusCode) || 0;
  if (code <= 0 || code >= 500) return "down";
  try {
    const json = JSON.parse(String(body || ""));
    if (json && json.ready === true) return "ready";
    if (json && json.ok === true && json.ready === false) return "starting";
    if (json && json.ok === true) return "ready";
  } catch {
    /* fall through */
  }
  if (code >= 200 && code < 500) return "starting";
  return "down";
}

module.exports = { isHealthPath, healthPayload, parseHealthResponse };

/**
 * 开发态 webpack 刚编完首页时，紧接着的第二次 GET / 可能读到空 manifest 并 500。
 * 连续两次 ready 再离开闪屏。
 */

function classifyAppPageResponse(statusCode, body) {
  const code = Number(statusCode) || 0;
  if (code === 503) return "starting";
  if (code < 200 || code >= 400) return "down";
  const text = String(body ?? "");
  if (!text.trim() || text.length < 200) return "down";
  if (text.includes("Unexpected end of JSON input")) return "down";
  return "ready";
}

function nextConsecutiveReady(current, status) {
  if (status === "ready") return Number(current) + 1;
  return 0;
}

function isAppPageStable(consecutiveReady, needed = 2) {
  return Number(consecutiveReady) >= Number(needed);
}

module.exports = {
  classifyAppPageResponse,
  nextConsecutiveReady,
  isAppPageStable,
};

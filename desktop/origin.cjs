/**
 * 桌面壳只允许导航到本机 Vibeboard 服务；外链交给系统浏览器。
 */

/**
 * @param {string} href
 * @param {number} port
 */
function isLocalAppUrl(href, port) {
  let parsed;
  try {
    parsed = new URL(href);
  } catch {
    return false;
  }
  const hostOk =
    parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  if (!hostOk) return false;
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const fallback = parsed.protocol === "https:" ? "443" : "80";
  return (parsed.port || fallback) === String(port);
}

/**
 * @param {string} href
 */
function isHttpUrl(href) {
  return /^https?:\/\//i.test(href);
}

/**
 * coding agent 的一键接入深链（目前只放行 Cursor 的 MCP 安装 / prompt 深链）。
 * @param {string} href
 */
function isAgentDeeplink(href) {
  return /^cursor:\/\/anysphere\.cursor-deeplink\/(mcp\/install|prompt)(\?|$)/i.test(String(href || ""));
}

module.exports = { isLocalAppUrl, isHttpUrl, isAgentDeeplink };

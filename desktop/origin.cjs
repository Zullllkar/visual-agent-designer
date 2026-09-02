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

module.exports = { isLocalAppUrl, isHttpUrl };

import "server-only";
import { ProxyAgent } from "undici";

/**
 * 带有代理支持的 fetch 包装器
 * --------------------------------------------------------------
 * Node.js 原生的 global.fetch 并不会自动读取 HTTP_PROXY / HTTPS_PROXY 环境变量，
 * 导致国内以及使用 VPN/梯子的开发者在调用 OpenAI, Anthropic, Gemini, DeepSeek 时
 * 遇到连接超时或 ECONNREFUSED 的网络问题。
 *
 * 本函数通过 undici 的 ProxyAgent (Node 原生内置网络库底层) 实现对代理的自动识别与加载，
 * 无需引入额外的庞大 HTTP client SDK。
 */
export async function safeFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  const proxyUrl =
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.https_proxy ||
    process.env.http_proxy;

  if (proxyUrl) {
    try {
      const dispatcher = new ProxyAgent({ uri: proxyUrl });
      return fetch(url, {
        ...init,
        // @ts-ignore - Node.js native fetch supports custom dispatcher via undici under the hood
        dispatcher,
      });
    } catch (err) {
      console.warn("[safeFetch] 无法初始化 undici ProxyAgent，将回退到原生 fetch 模式。错误:", err);
    }
  }

  return fetch(url, init);
}

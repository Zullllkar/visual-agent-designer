/**
 * Fastify Server
 * --------------------------------------------------------------
 * 替代 Next.js 自定义 server，提供更好的 HTTP/WS 性能。
 * Fastify 处理 API 路由和 WebSocket，Next.js 仅处理页面渲染。
 *
 * 启动方式：tsx server-fastify.ts
 */

import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import { createServer as createHttpServer } from "node:http";
import next from "next";
import { attachWebSocketHandler } from "./src/lib/ws/server";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 3000);

async function main(): Promise<void> {
  const nextApp = next({
    dev,
    hostname,
    port,
    ...(dev ? { turbopack: false, webpack: true } : {}),
  });
  const nextHandler = nextApp.getRequestHandler();

  await nextApp.prepare();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fastify = Fastify({
    serverFactory: (handler: any) => {
      const server = createHttpServer(handler);
      attachWebSocketHandler(server);
      return server;
    },
    logger: {
      level: dev ? "info" : "warn",
    },
  });

  await fastify.register(fastifyWebsocket, {
    options: { maxPayload: 10 * 1024 * 1024 },
  });

  // ── Health Check ──────────────────────────────────────────────
  fastify.get("/api/health", async () => ({
    status: "ok",
    timestamp: Date.now(),
    uptime: process.uptime(),
  }));

  // ── 所有路由交给 Next.js handler ──────────────────────────────
  fastify.all("*", async (req: any, reply: any) => {
    await nextHandler(req.raw, reply.raw);
  });

  await fastify.listen({ port, host: hostname });
  console.log(`> Fastify ready on http://${hostname}:${port} (WebSocket at /ws)`);
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureAgent, captureViaDesktop } from "./capture-agent";

const AGENT = { url: "http://127.0.0.1:43210", token: "cap_0123456789abcdef" };

describe("captureAgent registry", () => {
  beforeEach(() => {
    captureAgent.reset();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is unavailable until the desktop app registers", () => {
    expect(captureAgent.get()).toBeNull();
    expect(captureAgent.status()).toEqual({ available: false });
  });

  it("keeps registeredAt across heartbeats from the same endpoint", () => {
    const first = captureAgent.register({ ...AGENT, pid: 1 });
    vi.advanceTimersByTime(5_000);
    const second = captureAgent.register({ ...AGENT, pid: 1 });
    expect(second.registeredAt).toBe(first.registeredAt);
    expect(second.lastSeenAt).toBeGreaterThan(first.lastSeenAt);
    expect(captureAgent.status().available).toBe(true);
  });

  it("expires when heartbeats stop", () => {
    captureAgent.register(AGENT);
    vi.advanceTimersByTime(89_000);
    expect(captureAgent.get()).not.toBeNull();
    vi.advanceTimersByTime(2_000);
    expect(captureAgent.get()).toBeNull();
  });

  it("only unregisters when the caller knows the agent token", () => {
    captureAgent.register(AGENT);
    expect(captureAgent.unregister("wrong")).toBe(false);
    expect(captureAgent.get()).not.toBeNull();
    expect(captureAgent.unregister(AGENT.token)).toBe(true);
    expect(captureAgent.get()).toBeNull();
  });
});

describe("captureViaDesktop", () => {
  beforeEach(() => {
    captureAgent.reset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("explains how to proceed when no desktop app is registered", async () => {
    const out = await captureViaDesktop({ url: "http://localhost:3000" });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe("no_agent");
    expect(out.error).toMatch(/screenshotBase64/);
  });

  it("posts to the agent with its bearer token and wraps the PNG as a data URL", async () => {
    captureAgent.register(AGENT);
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      expect(String(input)).toBe(`${AGENT.url}/capture`);
      expect((init?.headers as Record<string, string>).authorization).toBe(`Bearer ${AGENT.token}`);
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ url: "http://localhost:5173/x", width: 1280, fullPage: true });
      return new Response(
        JSON.stringify({
          ok: true,
          pngBase64: "iVBORw0KGgo=",
          width: 1280,
          height: 2400,
          title: "X",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await captureViaDesktop({ url: "http://localhost:5173/x", width: 1280 });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.dataUrl).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(out.width).toBe(1280);
    expect(out.height).toBe(2400);
    expect(out.title).toBe("X");
  });

  it("surfaces agent-side failures verbatim", async () => {
    captureAgent.register(AGENT);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: false, error: "page load timed out after 25000ms" }), {
            status: 500,
          }),
      ),
    );
    const out = await captureViaDesktop({ url: "http://localhost:5173/slow" });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe("agent_error");
    expect(out.error).toContain("timed out");
  });
});

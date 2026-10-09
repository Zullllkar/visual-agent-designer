import { describe, expect, it } from "vitest";
import {
  CODEX_VAD_SHELL_ENVIRONMENT_ARGS,
  injectedEnvKeys,
  spawnEnvForBuild,
  vadBridgeEnv,
} from "./build-env";

describe("build env", () => {
  it("injects bridge url / token / project id", () => {
    expect(
      vadBridgeEnv({ url: "http://127.0.0.1:3000/mcp", token: "vb_x", projectId: "p1" }),
    ).toEqual({
      VAD_BRIDGE_URL: "http://127.0.0.1:3000/mcp",
      VAD_BRIDGE_TOKEN: "vb_x",
      VAD_PROJECT_ID: "p1",
    });
    expect(injectedEnvKeys(null)).toEqual(["VAD_BRIDGE_URL", "VAD_PROJECT_ID"]);
  });

  it("preserves inherited PATH and prepends the CLI directory", () => {
    const env = spawnEnvForBuild({
      base: { PATH: "/usr/bin", HOME: "/home/u", SECRET: "keep" },
      inject: { url: "http://127.0.0.1:3000/mcp", token: "t", projectId: "p1" },
      binPath: "/home/u/.local/bin/cursor-agent",
      platform: "linux",
    });
    expect(env.SECRET).toBe("keep");
    expect(env.VAD_PROJECT_ID).toBe("p1");
    expect(env.PATH?.startsWith("/home/u/.local/bin")).toBe(true);
  });

  it("codex shell include_only lists VAD keys, not OD keys", () => {
    const joined = CODEX_VAD_SHELL_ENVIRONMENT_ARGS.join(" ");
    expect(joined).toContain("VAD_BRIDGE_URL");
    expect(joined).toContain("VAD_BRIDGE_TOKEN");
    expect(joined).toContain("VAD_PROJECT_ID");
    expect(joined).not.toContain("OD_TOOL_TOKEN");
    expect(joined).toContain('shell_environment_policy.inherit="all"');
  });
});

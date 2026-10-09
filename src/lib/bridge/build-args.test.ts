import { describe, expect, it } from "vitest";
import {
  buildAgentArgs,
  buildCommandFingerprint,
  codexNeedsDangerFullAccessSandbox,
  formatCommandPreview,
} from "./build-args";

describe("buildAgentArgs", () => {
  it("cursor uses print + stream-json, never a dash prompt sentinel", () => {
    const argv = buildAgentArgs("cursor", {
      cwd: "E:/repo",
      caps: { cursorTrust: true },
    });
    expect(argv).toEqual([
      "--print",
      "--output-format",
      "stream-json",
      "--stream-partial-output",
      "--force",
      "--trust",
      "--workspace",
      "E:/repo",
    ]);
    expect(argv).not.toContain("-");
  });

  it("omits cursor --trust when the help probe did not see it", () => {
    const argv = buildAgentArgs("cursor", { cwd: "/tmp/app", caps: { cursorTrust: false } });
    expect(argv).not.toContain("--trust");
  });

  it("claude sends prompt via stdin and bypasses permissions", () => {
    const argv = buildAgentArgs("claude", {
      cwd: "/tmp/app",
      caps: { claudePartialMessages: true, claudeAddDir: true },
      extraAllowedDirs: ["/tmp/extra"],
    });
    expect(argv[0]).toBe("-p");
    expect(argv).toContain("--input-format");
    expect(argv).toContain("text");
    expect(argv).toContain("--output-format");
    expect(argv).toContain("stream-json");
    expect(argv).toContain("--include-partial-messages");
    expect(argv.slice(-2)).toEqual(["--permission-mode", "bypassPermissions"]);
    expect(argv).not.toContain("Please implement");
  });

  it("codex uses danger-full-access on Windows and workspace-write elsewhere", () => {
    const win = buildAgentArgs("codex", {
      cwd: "C:/src/app",
      platform: "win32",
      env: {},
    });
    expect(win).toContain("exec");
    expect(win).toContain("--json");
    expect(win).toEqual(expect.arrayContaining(["--sandbox", "danger-full-access"]));
    expect(win).toEqual(expect.arrayContaining(["-C", "C:/src/app"]));

    const mac = buildAgentArgs("codex", {
      cwd: "/Users/me/app",
      platform: "darwin",
      env: {},
    });
    expect(mac).toEqual(expect.arrayContaining(["--sandbox", "workspace-write"]));
    expect(mac.join(" ")).toContain("sandbox_workspace_write.network_access=true");
    expect(mac.join(" ")).toContain("VAD_BRIDGE_URL");
    expect(mac.join(" ")).toContain("VAD_BRIDGE_TOKEN");
  });

  it("treats WSL as needing danger-full-access", () => {
    expect(codexNeedsDangerFullAccessSandbox("linux", { WSL_DISTRO_NAME: "Ubuntu" })).toBe(true);
    expect(codexNeedsDangerFullAccessSandbox("linux", {})).toBe(false);
  });
});

describe("command preview + fingerprint", () => {
  it("quotes paths with spaces and does not embed the prompt", () => {
    const preview = formatCommandPreview("C:/Program Files/cursor-agent.cmd", [
      "--print",
      "--workspace",
      "D:/My Repo",
    ]);
    expect(preview).toContain('"C:/Program Files/cursor-agent.cmd"');
    expect(preview).toContain('"D:/My Repo"');
    expect(preview).not.toContain("Please implement");
  });

  it("fingerprint changes when argv or prompt changes", () => {
    const base = {
      slug: "cursor" as const,
      bin: "/usr/bin/cursor-agent",
      argv: ["--print"],
      cwd: "/repo",
      prompt: "hello",
    };
    const a = buildCommandFingerprint(base);
    const b = buildCommandFingerprint({ ...base, prompt: "hello!" });
    const c = buildCommandFingerprint({ ...base, argv: ["--print", "--trust"] });
    expect(a).toHaveLength(16);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});

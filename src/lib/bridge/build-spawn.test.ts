import { describe, expect, it } from "vitest";
import { createCommandInvocation, quoteWindowsCommandArg } from "./build-spawn";

describe("createCommandInvocation", () => {
  it("passes unix binaries through unchanged", () => {
    expect(
      createCommandInvocation({
        command: "/usr/bin/claude",
        args: ["-p", "--verbose"],
        platform: "linux",
      }),
    ).toEqual({ command: "/usr/bin/claude", args: ["-p", "--verbose"] });
  });

  it("wraps Windows .cmd shims in cmd.exe /d /s /c with verbatim args", () => {
    const inv = createCommandInvocation({
      command: "C:\\Users\\First Last\\AppData\\Roaming\\npm\\claude.cmd",
      args: ["-p", "--output-format", "stream-json"],
      platform: "win32",
      env: { ComSpec: "C:\\Windows\\system32\\cmd.exe" },
    });
    expect(inv.command).toBe("C:\\Windows\\system32\\cmd.exe");
    expect(inv.windowsVerbatimArguments).toBe(true);
    expect(inv.args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
    expect(inv.args[3]).toContain("claude.cmd");
    expect(inv.args[3]?.startsWith('"')).toBe(true);
    expect(inv.args[3]?.endsWith('"')).toBe(true);
  });

  it("breaks %VAR% pairs so cmd.exe cannot expand secrets in argv", () => {
    expect(quoteWindowsCommandArg("%VAD_BRIDGE_TOKEN%")).toContain('"^%"');
    expect(quoteWindowsCommandArg("plain")).toBe("plain");
  });
});

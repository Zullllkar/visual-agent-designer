import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("generation ledger placement", () => {
  it("opens a centered canvas panel instead of a left inspector tab", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/components/ide/ide-shell.tsx"),
      "utf8"
    );
    expect(src).toMatch(/className="vad-records-panel"/);
    expect(src).toMatch(/aria-label="生成记录"/);
    expect(src).not.toMatch(/id: "records"/);
    expect(src).not.toMatch(/panel === "records"/);
  });
});

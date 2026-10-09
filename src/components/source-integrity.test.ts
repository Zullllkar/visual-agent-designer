import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const COMPONENTS_DIR = "src/components";

function collectProductionSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(resolve(process.cwd(), dir), {
    withFileTypes: true,
  })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      out.push(...collectProductionSources(rel));
    } else if (
      /\.(ts|tsx)$/.test(entry.name) &&
      !/\.(test|spec)\.(ts|tsx)$/.test(entry.name)
    ) {
      out.push(rel);
    }
  }
  return out;
}

const SOURCES = collectProductionSources(COMPONENTS_DIR).sort();

function decodeSource(rel: string) {
  const bytes = readFileSync(resolve(process.cwd(), rel));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function parseSourceFile(rel: string) {
  return ts.createSourceFile(
    rel,
    decodeSource(rel),
    ts.ScriptTarget.Latest,
    true,
    rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function formatParseDiagnostics(
  sourceFile: ts.SourceFile,
  diagnostics: readonly ts.Diagnostic[],
) {
  return diagnostics.map((diag) => {
    const { line, character } = ts.getLineAndCharacterOfPosition(
      sourceFile,
      diag.start ?? 0,
    );
    return `${sourceFile.fileName}:${line + 1}:${character + 1} ${ts.flattenDiagnosticMessageText(diag.messageText, " ")}`;
  });
}

function parseDiagnosticsOf(sourceFile: ts.SourceFile) {
  return (
    (sourceFile as ts.SourceFile & {
      parseDiagnostics?: readonly ts.Diagnostic[];
    }).parseDiagnostics ?? []
  );
}

function openingOf(element: ts.JsxElement | ts.JsxSelfClosingElement) {
  return ts.isJsxElement(element) ? element.openingElement : element;
}

function classTokens(element: ts.JsxElement | ts.JsxSelfClosingElement) {
  for (const prop of openingOf(element).attributes.properties) {
    if (!ts.isJsxAttribute(prop) || prop.name.getText() !== "className") {
      continue;
    }
    const init = prop.initializer;
    if (init && ts.isStringLiteral(init)) {
      return init.text.split(/\s+/).filter(Boolean);
    }
  }
  return [];
}

function collectJsx(root: ts.Node) {
  const elements: Array<ts.JsxElement | ts.JsxSelfClosingElement> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      elements.push(node);
    }
    node.forEachChild(visit);
  };
  visit(root);
  return elements;
}

describe("component source integrity", () => {
  it.each(SOURCES)("%s", (rel) => {
    const sourceFile = parseSourceFile(rel);
    expect(sourceFile.getFullText()).not.toContain("�");
    expect(
      formatParseDiagnostics(sourceFile, parseDiagnosticsOf(sourceFile)),
    ).toEqual([]);
  });

  describe("settings-dialog.tsx", () => {
    const REL = "src/components/settings/settings-dialog.tsx";

    it("keeps the nav label inside vad-settings-nav", () => {
      const sourceFile = parseSourceFile(REL);
      const navs = collectJsx(sourceFile).filter(
        (el) =>
          openingOf(el).tagName.getText() === "nav" &&
          classTokens(el).includes("vad-settings-nav"),
      );
      expect(navs).toHaveLength(1);

      const labels: ts.JsxElement[] = [];
      const visit = (node: ts.Node): void => {
        if (
          ts.isJsxElement(node) &&
          node.openingElement.tagName.getText() === "p" &&
          classTokens(node).includes("vad-settings-nav-label")
        ) {
          labels.push(node);
        }
        node.forEachChild(visit);
      };
      navs[0].forEachChild(visit);
      expect(labels).toHaveLength(1);
      expect(labels[0].getText(sourceFile)).toContain("设置");
    });

    it("stacks the theme SettingsRow", () => {
      const sourceFile = parseSourceFile(REL);
      const themeRows = collectJsx(sourceFile).filter((el) => {
        const opening = openingOf(el);
        if (opening.tagName.getText() !== "SettingsRow") return false;
        return opening.attributes.properties.some(
          (prop) =>
            ts.isJsxAttribute(prop) &&
            prop.name.getText() === "title" &&
            prop.initializer !== undefined &&
            ts.isStringLiteral(prop.initializer) &&
            prop.initializer.text === "主题",
        );
      });
      expect(themeRows).toHaveLength(1);
      const stack = openingOf(themeRows[0]).attributes.properties.find(
        (prop): prop is ts.JsxAttribute =>
          ts.isJsxAttribute(prop) && prop.name.getText() === "stack",
      );
      expect(stack).toBeDefined();
      expect(stack?.initializer).toBeUndefined();
    });

    it("preserves feature components", () => {
      const sourceFile = parseSourceFile(REL);
      const declarations = new Set<string>();
      const visit = (node: ts.Node): void => {
        if (ts.isFunctionDeclaration(node) && node.name) {
          declarations.add(node.name.text);
        }
        node.forEachChild(visit);
      };
      visit(sourceFile);
      for (const name of [
        "useDesktopInfo",
        "ThemeCards",
        "Keys",
        "SettingsRow",
        "SettingsToggle",
      ]) {
        expect(declarations.has(name)).toBe(true);
      }
      const importsVadMark = sourceFile.statements.some(
        (stmt) =>
          ts.isImportDeclaration(stmt) &&
          stmt.importClause?.namedBindings !== undefined &&
          ts.isNamedImports(stmt.importClause.namedBindings) &&
          stmt.importClause.namedBindings.elements.some(
            (el) => el.name.text === "VadMark",
          ),
      );
      expect(importsVadMark).toBe(true);
    });
  });
});

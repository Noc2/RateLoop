import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const TOKENLESS_COMPONENTS_DIRECTORY = fileURLToPath(new URL(".", import.meta.url));
const LOW_CONTRAST_TEXT = /\btext-base-content\/(?:[0-4]?\d|5[0-4])\b/gu;
const INTERNAL_VOCABULARY = [
  /\bLREP\b/iu,
  /\bRBTS\b/iu,
  /\badmission polic(?:y|ies)\b/iu,
  /\bidempotenc(?:y|t)\b/iu,
  /\bnullifiers?\b/iu,
  /(?:\boperation (?:ID|reference)\b|^Operation$)/iu,
  /\bprincipals?\b/iu,
  /\braters?\b/iu,
  /\brun manifests?\b/iu,
  /\bpolicy hashes?\b/iu,
] as const;
const VISIBLE_ATTRIBUTES = new Set(["alt", "aria-label", "label", "placeholder", "title"]);

function componentFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return componentFiles(absolutePath);
    if (
      !entry.isFile() ||
      !entry.name.endsWith(".tsx") ||
      entry.name.endsWith(".test.tsx") ||
      entry.name.endsWith(".type-test.tsx")
    ) {
      return [];
    }
    return [absolutePath];
  });
}

function jsxTagName(node: ts.JsxElement | ts.JsxSelfClosingElement) {
  return ts.isJsxElement(node) ? node.openingElement.tagName.getText() : node.tagName.getText();
}

function isInsideCodeExample(node: ts.Node) {
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if (
      (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current)) &&
      ["code", "pre"].includes(jsxTagName(current))
    ) {
      return true;
    }
  }
  return false;
}

function visibleStrings(sourceFile: ts.SourceFile) {
  const values: Array<{ line: number; text: string }> = [];
  const add = (node: ts.Node, text: string) => {
    const normalized = text.replace(/\s+/gu, " ").trim();
    if (!normalized || isInsideCodeExample(node)) return;
    values.push({
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
      text: normalized,
    });
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      add(node, node.text);
    } else if (ts.isJsxAttribute(node) && VISIBLE_ATTRIBUTES.has(node.name.getText(sourceFile))) {
      if (node.initializer && ts.isStringLiteral(node.initializer)) add(node, node.initializer.text);
      if (
        node.initializer &&
        ts.isJsxExpression(node.initializer) &&
        node.initializer.expression &&
        (ts.isStringLiteral(node.initializer.expression) ||
          ts.isNoSubstitutionTemplateLiteral(node.initializer.expression))
      ) {
        add(node, node.initializer.expression.text);
      }
    } else if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      ts.isJsxExpression(node.parent)
    ) {
      add(node, node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return values;
}

test("tokenless component text never drops below the minimum contrast token", () => {
  const failures = componentFiles(TOKENLESS_COMPONENTS_DIRECTORY).flatMap(file =>
    [...readFileSync(file, "utf8").matchAll(LOW_CONTRAST_TEXT)].map(match => ({
      file: path.relative(TOKENLESS_COMPONENTS_DIRECTORY, file),
      token: match[0],
    })),
  );
  assert.deepEqual(failures, []);
});

test("user-visible tokenless copy avoids internal protocol vocabulary", () => {
  const failures = componentFiles(TOKENLESS_COMPONENTS_DIRECTORY).flatMap(file => {
    const source = readFileSync(file, "utf8");
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    return visibleStrings(sourceFile).flatMap(value =>
      INTERNAL_VOCABULARY.filter(pattern => pattern.test(value.text)).map(pattern => ({
        file: path.relative(TOKENLESS_COMPONENTS_DIRECTORY, file),
        line: value.line,
        pattern: pattern.source,
        text: value.text,
      })),
    );
  });
  assert.deepEqual(failures, []);
});

test("directly patterned inputs provide a browser-visible format hint", () => {
  const failures = componentFiles(TOKENLESS_COMPONENTS_DIRECTORY).flatMap(file => {
    const source = readFileSync(file, "utf8");
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const fileFailures: Array<{ file: string; line: number }> = [];
    const visit = (node: ts.Node) => {
      if (
        (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        node.tagName.getText(sourceFile) === "input"
      ) {
        const attributeNames = new Set(
          node.attributes.properties.filter(ts.isJsxAttribute).map(attribute => attribute.name.getText(sourceFile)),
        );
        if (attributeNames.has("pattern") && !attributeNames.has("title")) {
          fileFailures.push({
            file: path.relative(TOKENLESS_COMPONENTS_DIRECTORY, file),
            line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return fileFailures;
  });
  assert.deepEqual(failures, []);
});

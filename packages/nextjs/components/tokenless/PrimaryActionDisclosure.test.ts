import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const nextjsRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const productionRoots = [join(nextjsRoot, "app"), join(nextjsRoot, "components")];
const mutationMethods = new Set(["DELETE", "PATCH", "POST", "PUT"]);

function productionTsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionTsxFiles(path);
    if (!entry.name.endsWith(".tsx") || /\.(?:interaction\.)?(?:spec|test)\.tsx$/u.test(entry.name)) return [];
    return [path];
  });
}

function jsxTagName(node: ts.JsxOpeningLikeElement) {
  return node.tagName.getText();
}

function disclosurePurpose(node: ts.JsxOpeningLikeElement) {
  return node.attributes.properties.some(
    attribute =>
      ts.isJsxAttribute(attribute) &&
      attribute.name.getText() === "data-disclosure-purpose" &&
      attribute.initializer !== undefined,
  );
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current)) current = current.expression;
  return current;
}

function directRootDetails(body: ts.ConciseBody) {
  const roots: ts.JsxElement[] = [];
  const visit = (node: ts.Node) => {
    if (node !== body && ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression) {
      const expression = unwrapExpression(node.expression);
      if (ts.isJsxElement(expression) && jsxTagName(expression.openingElement) === "details") roots.push(expression);
      return;
    }
    ts.forEachChild(node, visit);
  };
  if (ts.isJsxElement(body) && jsxTagName(body.openingElement) === "details") roots.push(body);
  else ts.forEachChild(body, visit);
  return roots;
}

function hasMutationFetch(body: ts.ConciseBody) {
  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(node) && node.expression.getText() === "fetch") {
      const options = node.arguments[1];
      if (options && ts.isObjectLiteralExpression(options)) {
        const method = options.properties.find(
          property => ts.isPropertyAssignment(property) && property.name.getText() === "method",
        );
        if (
          method &&
          ts.isPropertyAssignment(method) &&
          ts.isStringLiteralLike(method.initializer) &&
          mutationMethods.has(method.initializer.text.toUpperCase())
        ) {
          found = true;
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return found;
}

function detailsWithForms(sourceFile: ts.SourceFile) {
  const details: ts.JsxElement[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) && jsxTagName(node.openingElement) === "details") {
      let formFound = false;
      const findForm = (child: ts.Node) => {
        if (
          (ts.isJsxElement(child) && jsxTagName(child.openingElement) === "form") ||
          (ts.isJsxSelfClosingElement(child) && jsxTagName(child) === "form")
        ) {
          formFound = true;
          return;
        }
        ts.forEachChild(child, findForm);
      };
      node.children.forEach(findForm);
      if (formFound) details.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return details;
}

test("forms and mutation-owning panels are not hidden behind unreviewed disclosures", () => {
  const violations: string[] = [];
  for (const file of productionRoots.flatMap(productionTsxFiles)) {
    const sourceFile = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const label = relative(nextjsRoot, file);

    for (const details of detailsWithForms(sourceFile)) {
      if (!disclosurePurpose(details.openingElement)) {
        violations.push(
          `${label}:${sourceFile.getLineAndCharacterOfPosition(details.getStart()).line + 1} hides a form`,
        );
      }
    }

    for (const statement of sourceFile.statements) {
      const candidates: Array<{ body: ts.ConciseBody; name: string }> = [];
      if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
        candidates.push({ body: statement.body, name: statement.name.text });
      }
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (
            ts.isIdentifier(declaration.name) &&
            declaration.initializer &&
            (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))
          ) {
            candidates.push({ body: declaration.initializer.body, name: declaration.name.text });
          }
        }
      }
      for (const candidate of candidates) {
        if (!/^[A-Z]/u.test(candidate.name) || !hasMutationFetch(candidate.body)) continue;
        for (const details of directRootDetails(candidate.body)) {
          if (!disclosurePurpose(details.openingElement)) {
            violations.push(
              `${label}:${sourceFile.getLineAndCharacterOfPosition(details.getStart()).line + 1} makes ${candidate.name}'s mutations conditional on a disclosure`,
            );
          }
        }
      }
    }
  }

  assert.deepEqual(violations, []);
});

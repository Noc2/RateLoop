import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const nextjsRoot = fileURLToPath(new URL("../../../", import.meta.url));
const productionRoots = [join(nextjsRoot, "app"), join(nextjsRoot, "components")];
const rawSurfaceClass =
  /\bclassName\s*=\s*(?:"[^"]*\b(?:surface-card(?:-nested)?|rateloop-surface-card)\b|\{\s*`[^`]*\b(?:surface-card(?:-nested)?|rateloop-surface-card)\b)/u;

function productionTsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionTsxFiles(path);
    if (!entry.name.endsWith(".tsx") || /\.(?:interaction\.)?(?:spec|test)\.tsx$/u.test(entry.name)) return [];
    return [path];
  });
}

test("production surfaces use the shared Card primitive", () => {
  const violations = productionRoots
    .flatMap(productionTsxFiles)
    .filter(path => !path.endsWith("/tokenless/ui/Card.tsx"))
    .filter(path => rawSurfaceClass.test(readFileSync(path, "utf8")))
    .map(path => relative(nextjsRoot, path));

  assert.deepEqual(
    violations,
    [],
    `Raw surface classes bypass Card in:\n${violations.map(path => `- ${path}`).join("\n")}`,
  );
});

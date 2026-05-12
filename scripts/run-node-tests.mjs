import { readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx)$/;
const IGNORED_DIRS = new Set(["node_modules", ".next"]);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const preloadModule = join(scriptDir, "register-node-test-env.mjs");

function findPackageJson(start) {
  const absoluteStart = resolve(start);
  let current = statSync(absoluteStart).isDirectory() ? absoluteStart : dirname(absoluteStart);
  while (current.startsWith(repoRoot)) {
    const candidate = join(current, "package.json");
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Keep walking up to the repo root.
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function resolveImportModule(name, files = []) {
  const packageJsonCandidates = [
    ...files.map(file => findPackageJson(file)).filter(Boolean),
    join(process.cwd(), "package.json"),
    join(repoRoot, "package.json"),
  ];

  for (const packageJson of new Set(packageJsonCandidates)) {
    try {
      return pathToFileURL(createRequire(packageJson).resolve(name)).href;
    } catch {
      // Try the next workspace/root package.json.
    }
  }

  return name;
}

function collectTests(root, results) {
  const stats = statSync(root);
  if (stats.isFile()) {
    if (TEST_FILE_RE.test(root)) {
      results.push(relative(process.cwd(), root));
    }
    return;
  }

  if (!stats.isDirectory()) {
    return;
  }

  const dir = root;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      collectTests(join(dir, entry.name), results);
      continue;
    }

    if (TEST_FILE_RE.test(entry.name)) {
      results.push(relative(process.cwd(), join(dir, entry.name)));
    }
  }
}

const roots = process.argv.slice(2);
if (roots.length === 0) {
  console.error("Usage: node scripts/run-node-tests.mjs <dir-or-test-file> [dir-or-test-file...]");
  process.exit(1);
}

const files = [];
for (const root of roots) {
  collectTests(resolve(process.cwd(), root), files);
}

files.sort();

if (files.length === 0) {
  console.error(`No test files found under: ${roots.join(", ")}`);
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ["--import", preloadModule, "--import", resolveImportModule("tsx", files), "--test", ...files],
  {
    stdio: "inherit",
    cwd: process.cwd(),
  },
);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);

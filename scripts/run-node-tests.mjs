import { readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|js|mjs|cjs)$/;
const TS_TEST_FILE_RE = /\.(test|spec)\.(ts|tsx)$/;
const IGNORED_DIRS = new Set(["node_modules", ".next"]);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const preloadModule = join(scriptDir, "register-node-test-env.mjs");
const configuredTestConcurrency =
  process.env.RATELOOP_NODE_TEST_CONCURRENCY ?? "4";

if (!/^[1-9][0-9]*$/u.test(configuredTestConcurrency)) {
  console.error("RATELOOP_NODE_TEST_CONCURRENCY must be a positive integer.");
  process.exit(1);
}

function findPackageJson(start) {
  const absoluteStart = resolve(start);
  let current = statSync(absoluteStart).isDirectory()
    ? absoluteStart
    : dirname(absoluteStart);
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

function resolveImportModule(name, files = [], cwd = process.cwd()) {
  const packageJsonCandidates = [
    ...files.map((file) => findPackageJson(file)).filter(Boolean),
    join(cwd, "package.json"),
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
      results.push(root);
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
      results.push(join(dir, entry.name));
    }
  }
}

function getTestCwd(file) {
  const packageJson = findPackageJson(file);
  return packageJson === null ? repoRoot : dirname(packageJson);
}

function groupTestsByCwd(files) {
  const groups = new Map();
  for (const file of files) {
    const cwd = getTestCwd(file);
    const group = groups.get(cwd) ?? [];
    group.push(file);
    groups.set(cwd, group);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

const roots = process.argv.slice(2);
if (roots.length === 0) {
  console.error(
    "Usage: node scripts/run-node-tests.mjs <dir-or-test-file> [dir-or-test-file...]",
  );
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

let exitCode = 0;

for (const [cwd, groupFiles] of groupTestsByCwd(files)) {
  groupFiles.sort();

  const nodeArgs = [
    "--import",
    preloadModule,
    `--test-concurrency=${configuredTestConcurrency}`,
  ];
  if (groupFiles.some((file) => TS_TEST_FILE_RE.test(file))) {
    nodeArgs.push("--import", resolveImportModule("tsx", groupFiles, cwd));
  }
  nodeArgs.push("--test", ...groupFiles.map((file) => relative(cwd, file)));

  const result = spawnSync(process.execPath, nodeArgs, {
    stdio: "inherit",
    cwd,
  });

  if (result.error) {
    console.error(result.error);
    exitCode = 1;
    continue;
  }

  if (result.status !== 0) {
    exitCode = result.status ?? 1;
  }
}

process.exit(exitCode);

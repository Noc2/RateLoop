import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const runner = join(scriptDir, "run-node-tests.mjs");
const literalRunner = join(scriptDir, "run-node-test-group.mjs");

function runScript(script, args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      RATELOOP_NODE_TEST_CONCURRENCY: "1",
    },
  });
}

test("runs exact test paths containing glob metacharacters", () => {
  const result = runScript(runner, [
    "scripts/fixtures/run-node-tests/(parenthesized)/parenthesized.test.mjs",
    "scripts/fixtures/run-node-tests/[dynamic]/bracketed.test.mjs",
  ]);
  const output = `${result.stdout}${result.stderr}`;

  assert.equal(result.status, 0, output);
  assert.match(output, /runs a test beneath a parenthesized directory/u);
  assert.match(output, /runs a test beneath a bracketed directory/u);
  assert.doesNotMatch(output, /tests 0/u);
});

test("rejects roots that contain no tests", () => {
  const result = runScript(runner, ["scripts/run-node-tests.mjs"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /No test files found under/u);
});

test("the literal runner rejects an empty file list", () => {
  const result = runScript(literalRunner, ["1"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage: node scripts\/run-node-test-group\.mjs/u);
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));

test("retired World Chain mainnet script directs operators to Base readiness", () => {
  const result = spawnSync(
    process.execPath,
    [join(scriptDir, "check-worldchain-mainnet-readiness.mjs")],
    {
      encoding: "utf8",
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /World Chain mainnet readiness is retired/i);
  assert.match(result.stderr, /yarn base:check/);
  assert.match(result.stderr, /yarn base-sepolia:check/);
});

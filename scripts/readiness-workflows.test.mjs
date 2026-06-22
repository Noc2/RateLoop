import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readWorkflow(path) {
  return readFileSync(path, "utf8");
}

test("legacy World Chain Sepolia readiness workflow is manual-only", () => {
  const workflow = readWorkflow(
    ".github/workflows/worldchain-sepolia-readiness.yaml",
  );

  assert.match(workflow, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^  push:/m);
  assert.doesNotMatch(workflow, /^  pull_request:/m);
  assert.doesNotMatch(workflow, /^  schedule:/m);
});

test("legacy World Chain mainnet readiness workflow is retired and manual-only", () => {
  const workflow = readWorkflow(
    ".github/workflows/worldchain-mainnet-readiness.yaml",
  );

  assert.match(workflow, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^  push:/m);
  assert.doesNotMatch(workflow, /^  pull_request:/m);
  assert.doesNotMatch(workflow, /^  schedule:/m);
  assert.doesNotMatch(workflow, /check-worldchain-mainnet-readiness/);
  assert.match(workflow, /retired/i);
  assert.match(workflow, /Base-first rollout/);
});

test("Base Sepolia readiness remains an active push, PR, scheduled, and manual gate", () => {
  const workflow = readWorkflow(
    ".github/workflows/base-sepolia-readiness.yaml",
  );

  assert.match(workflow, /^on:/m);
  assert.match(workflow, /^  push:/m);
  assert.match(workflow, /^  pull_request:/m);
  assert.match(workflow, /^  schedule:/m);
  assert.match(workflow, /^  workflow_dispatch:/m);
  assert.match(
    workflow,
    /BASE_SEPOLIA_NEXT_ENV_FILE: docs\/testing\/base-sepolia-next-env\.fixture/,
  );
  assert.match(
    workflow,
    /PONDER_METADATA_SYNC_TOKEN: \$\{\{ secrets\.PONDER_METADATA_SYNC_TOKEN \}\}/,
  );
});

test("Base mainnet readiness remains an active push, PR, scheduled, and manual gate", () => {
  const workflow = readWorkflow(
    ".github/workflows/base-mainnet-readiness.yaml",
  );

  assert.match(workflow, /^on:/m);
  assert.match(workflow, /^  push:/m);
  assert.match(workflow, /^  pull_request:/m);
  assert.match(workflow, /^  schedule:/m);
  assert.match(workflow, /^  workflow_dispatch:/m);
  assert.match(workflow, /check-base-mainnet-readiness\.mjs/);
  assert.match(
    workflow,
    /PONDER_METADATA_SYNC_TOKEN: \$\{\{ secrets\.PONDER_METADATA_SYNC_TOKEN \}\}/,
  );
});

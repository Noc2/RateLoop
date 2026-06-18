import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readWorkflow(path) {
  return readFileSync(path, "utf8");
}

test("legacy World Chain Sepolia readiness workflow is manual-only", () => {
  const workflow = readWorkflow(".github/workflows/worldchain-sepolia-readiness.yaml");

  assert.match(workflow, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^  push:/m);
  assert.doesNotMatch(workflow, /^  pull_request:/m);
  assert.doesNotMatch(workflow, /^  schedule:/m);
});

test("Base Sepolia readiness remains an active push, PR, scheduled, and manual gate", () => {
  const workflow = readWorkflow(".github/workflows/base-sepolia-readiness.yaml");

  assert.match(workflow, /^on:/m);
  assert.match(workflow, /^  push:/m);
  assert.match(workflow, /^  pull_request:/m);
  assert.match(workflow, /^  schedule:/m);
  assert.match(workflow, /^  workflow_dispatch:/m);
});

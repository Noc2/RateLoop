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
  assert.match(workflow, /NODE_ENV: production/);
  assert.match(workflow, /Offline core readiness checks/);
  assert.match(workflow, /Live core readiness probes/);
  assert.match(
    workflow,
    /PONDER_KEEPER_WORK_TOKEN: \$\{\{ secrets\.PONDER_KEEPER_WORK_TOKEN \}\}/,
  );
  assert.match(workflow, /BASE_SEPOLIA_KEEPER_URL: \$\{\{ vars\.BASE_SEPOLIA_KEEPER_URL \}\}/);
  assert.match(workflow, /env\.BASE_SEPOLIA_KEEPER_URL != ''/);
  assert.match(
    workflow,
    /KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL: https:\/\/artifacts\.rateloop\.ai\/rateloop/,
  );
  assert.match(workflow, /RATE_LIMIT_TRUSTED_IP_HEADERS:/);
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
  assert.match(workflow, /NODE_ENV: production/);
  assert.match(
    workflow,
    /PONDER_KEEPER_WORK_TOKEN: \$\{\{ secrets\.PONDER_KEEPER_WORK_TOKEN \}\}/,
  );
  assert.match(workflow, /BASE_KEEPER_URL: \$\{\{ vars\.BASE_KEEPER_URL \}\}/);
  assert.match(workflow, /env\.BASE_KEEPER_URL != ''/);
  assert.match(
    workflow,
    /KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL: https:\/\/artifacts\.rateloop\.ai\/rateloop/,
  );
  assert.match(workflow, /RATE_LIMIT_TRUSTED_IP_HEADERS:/);
});

test("Railway service start commands pin production mode", () => {
  const keeper = readWorkflow("packages/keeper/railway.toml");
  const ponder = readWorkflow("packages/ponder/railway.toml");

  assert.match(
    keeper,
    /startCommand = "NODE_ENV=production yarn workspace @rateloop\/keeper start:built-dist"/,
  );
  assert.match(
    ponder,
    /startCommand = "NODE_ENV=production yarn workspace @rateloop\/ponder start:built-workspace-deps"/,
  );
  assert.match(ponder, /builder = "RAILPACK"/);
  assert.match(ponder, /healthcheckPath = "\/ready"/);
  assert.match(ponder, /healthcheckTimeout = 900/);
});

test("Keeper Docker runtime uses built output and production dependencies", () => {
  const dockerfile = readWorkflow("packages/keeper/Dockerfile");

  assert.match(dockerfile, /RUN yarn build:workspace-deps && yarn build/);
  assert.match(
    dockerfile,
    /yarn workspaces focus @rateloop\/keeper --production/,
  );
  assert.match(dockerfile, /CMD \["yarn", "start:built-dist"\]/);
  assert.doesNotMatch(dockerfile, /CMD \["yarn", "start:built-workspace-deps"\]/);
});

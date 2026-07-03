import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readWorkflow(path) {
  return readFileSync(path, "utf8");
}

function workflowJobBlock(workflow, jobName) {
  const lines = workflow.split(/\n/);
  const start = lines.findIndex(line => line === `  ${jobName}:`);
  assert.notEqual(start, -1, `Missing workflow job ${jobName}`);
  const end = lines.findIndex((line, index) => index > start && /^  [A-Za-z0-9_-]+:$/.test(line));
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

function workflowStepBlock(workflow, stepName) {
  const lines = workflow.split(/\n/);
  const start = lines.findIndex(line => line === `      - name: ${stepName}`);
  assert.notEqual(start, -1, `Missing workflow step ${stepName}`);
  const end = lines.findIndex((line, index) => index > start && /^      - name: /.test(line));
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

test("static analysis includes a dependency audit gate", () => {
  const workflow = readWorkflow(".github/workflows/static-analysis.yaml");
  const auditJob = workflowJobBlock(workflow, "dependency-audit");
  const packageJson = JSON.parse(readWorkflow("package.json"));

  assert.equal(
    packageJson.scripts["security:audit"],
    "yarn npm audit --recursive --environment production && yarn npm audit --recursive --environment development",
  );
  assert.match(auditJob, /actions\/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5/);
  assert.match(auditJob, /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/);
  assert.match(auditJob, /node-version: "24"/);
  assert.match(auditJob, /yarn install --immutable/);
  assert.match(auditJob, /yarn security:audit/);
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
  const offlineJob = workflowJobBlock(workflow, "readiness");
  const liveJob = workflowJobBlock(workflow, "live-readiness");

  assert.match(offlineJob, /NODE_ENV: production/);
  assert.match(offlineJob, /Offline production readiness checks/);
  assert.doesNotMatch(offlineJob, /secrets\./);
  assert.doesNotMatch(offlineJob, /--live --require-live-targets/);
  assert.match(
    liveJob,
    /if: github\.ref == 'refs\/heads\/main' && \(github\.event_name == 'schedule' \|\| \(github\.event_name == 'workflow_dispatch' && github\.event\.inputs\.live == 'true'\)\)/,
  );
  assert.match(
    liveJob,
    /PONDER_METADATA_SYNC_TOKEN: \$\{\{ secrets\.PONDER_METADATA_SYNC_TOKEN \}\}/,
  );
  assert.match(
    liveJob,
    /PONDER_KEEPER_WORK_TOKEN: \$\{\{ secrets\.PONDER_KEEPER_WORK_TOKEN \}\}/,
  );
  assert.match(
    liveJob,
    /RATELOOP_CONFIDENTIALITY_ACCESS_RECORDER_PRIVATE_KEY: \$\{\{ secrets\.RATELOOP_CONFIDENTIALITY_ACCESS_RECORDER_PRIVATE_KEY \}\}/,
  );
  assert.match(liveJob, /BASE_RPC_URL: \$\{\{ secrets\.BASE_RPC_URL \}\}/);
  assert.match(liveJob, /KEEPER_DATABASE_URL: \$\{\{ secrets\.KEEPER_DATABASE_URL \}\}/);
  assert.match(liveJob, /METRICS_AUTH_TOKEN: \$\{\{ secrets\.METRICS_AUTH_TOKEN \}\}/);
  assert.match(liveJob, /node scripts\/check-base-mainnet-readiness\.mjs --live --require-live-targets/);
  assert.match(workflow, /BASE_KEEPER_URL: \$\{\{ vars\.BASE_KEEPER_URL \}\}/);
  assert.match(
    offlineJob,
    /KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL: https:\/\/artifacts\.rateloop\.ai\/rateloop/,
  );
  assert.match(
    liveJob,
    /KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL: https:\/\/artifacts\.rateloop\.ai\/rateloop/,
  );
  assert.match(workflow, /RATE_LIMIT_TRUSTED_IP_HEADERS:/);
});

test("local Anvil deploy steps use dummy explorer keys instead of repository secrets", () => {
  const lintWorkflow = readWorkflow(".github/workflows/lint.yaml");
  const e2eWorkflow = readWorkflow(".github/workflows/e2e.yaml");

  assert.doesNotMatch(lintWorkflow, /ETHERSCAN_API_KEY: \$\{\{ secrets\.ETHERSCAN_API_KEY \}\}/);
  assert.doesNotMatch(e2eWorkflow, /ETHERSCAN_API_KEY: \$\{\{ secrets\.ETHERSCAN_API_KEY \}\}/);
  assert.equal((lintWorkflow.match(/ETHERSCAN_API_KEY: local-anvil-dummy/g) ?? []).length, 1);
  assert.equal((e2eWorkflow.match(/ETHERSCAN_API_KEY: local-anvil-dummy/g) ?? []).length, 2);
});

test("Railway service start commands, watch patterns, and health checks pin production mode", () => {
  const keeper = readWorkflow("packages/keeper/railway.toml");
  const ponder = readWorkflow("packages/ponder/railway.toml");

  assert.match(
    keeper,
    /startCommand = "yarn start:built-dist"/,
  );
  assert.match(
    ponder,
    /startCommand = "yarn start:built-workspace-deps"/,
  );
  assert.match(keeper, /builder = "DOCKERFILE"/);
  assert.match(keeper, /dockerfilePath = "packages\/keeper\/Dockerfile"/);
  assert.match(keeper, /scripts\/with-workspace-dist-lock\.mjs/);
  assert.doesNotMatch(keeper, /buildCommand/);
  assert.match(keeper, /healthcheckPath = "\/live"/);
  assert.match(keeper, /healthcheckTimeout = 120/);
  assert.match(ponder, /builder = "DOCKERFILE"/);
  assert.match(ponder, /dockerfilePath = "packages\/ponder\/Dockerfile"/);
  assert.match(ponder, /scripts\/with-workspace-dist-lock\.mjs/);
  assert.doesNotMatch(ponder, /buildCommand/);
  assert.match(ponder, /healthcheckPath = "\/ready"/);
  assert.match(ponder, /healthcheckTimeout = 120/);
});

test("Ponder Docker runtime uses pinned base and production dependencies", () => {
  const dockerfile = readWorkflow("packages/ponder/Dockerfile");

  assert.match(dockerfile, /FROM node:24-alpine@sha256:[a-f0-9]{64}/);
  assert.match(dockerfile, /RUN yarn build:workspace-deps/);
  assert.match(
    dockerfile,
    /yarn workspaces focus @rateloop\/ponder --production/,
  );
  assert.match(dockerfile, /CMD \["yarn", "start:built-workspace-deps"\]/);
});

test("Keeper Docker runtime uses built output and production dependencies", () => {
  const dockerfile = readWorkflow("packages/keeper/Dockerfile");

  assert.match(dockerfile, /RUN yarn build:workspace-deps && yarn build/);
  assert.match(
    dockerfile,
    /yarn workspaces focus @rateloop\/keeper --production/,
  );
  assert.match(dockerfile, /CMD \["yarn", "start:built-dist"\]/);
  assert.match(dockerfile, /path:'\/live'/);
  assert.doesNotMatch(dockerfile, /path:'\/health'/);
  assert.doesNotMatch(dockerfile, /CMD \["yarn", "start:built-workspace-deps"\]/);
});

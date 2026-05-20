import assert from "node:assert/strict";
import test from "node:test";
import { getDbPushPlan, getPonderDataResetPlan } from "./dev-stack.mjs";

const localDatabaseConfig = {
  url: "postgresql://postgres:postgres@127.0.0.1:5432/rateloop_app",
  host: "127.0.0.1",
  port: 5432,
  databaseName: "rateloop_app",
  user: "postgres",
  password: "postgres",
  isLocal: true,
  isMemory: false,
};

const remoteDatabaseConfig = {
  url: "postgresql://postgres:postgres@example.com:5432/rateloop_app",
  host: "example.com",
  port: 5432,
  databaseName: "rateloop_app",
  user: "postgres",
  password: "postgres",
  isLocal: false,
  isMemory: false,
};

const memoryDatabaseConfig = {
  url: "memory:",
  host: "memory",
  port: 0,
  databaseName: "memory",
  user: "memory",
  password: "",
  isLocal: false,
  isMemory: true,
};

test("runs the Next.js schema push for local databases", () => {
  assert.deepEqual(getDbPushPlan(localDatabaseConfig), { shouldRun: true });
});

test("skips the Next.js schema push for remote databases by default", () => {
  const plan = getDbPushPlan(remoteDatabaseConfig);

  assert.equal(plan.shouldRun, false);
  assert.match(plan.reason, /non-local postgres@example\.com:5432\/rateloop_app/);
  assert.match(plan.help, /--allow-remote-db-push/);
});

test("allows the Next.js schema push for remote databases with an explicit opt-in", () => {
  assert.deepEqual(getDbPushPlan(remoteDatabaseConfig, { allowRemoteDbPush: true }), { shouldRun: true });
});

test("skips the Next.js schema push for in-memory databases", () => {
  assert.deepEqual(getDbPushPlan(memoryDatabaseConfig), {
    shouldRun: false,
    reason: "DATABASE_URL uses the in-memory development database",
  });
});

test("honors an explicit schema push skip even for local databases", () => {
  assert.deepEqual(getDbPushPlan(localDatabaseConfig, { skipDbPush: true }), {
    shouldRun: false,
    reason: "Next.js schema push was disabled",
  });
});

test("resets local Ponder data when the deployment fingerprint changes", () => {
  assert.deepEqual(
    getPonderDataResetPlan({
      ponderNetwork: "hardhat",
      ponderRpcUrl: "http://127.0.0.1:8545",
      currentFingerprint: "new",
      storedFingerprint: "old",
      hasPglite: true,
    }),
    {
      shouldRecord: true,
      shouldReset: true,
      reason: "local deployment artifact changed",
    },
  );
});

test("records the local deployment fingerprint without resetting when Ponder has no data yet", () => {
  assert.deepEqual(
    getPonderDataResetPlan({
      ponderNetwork: "hardhat",
      ponderRpcUrl: "http://127.0.0.1:8545",
      currentFingerprint: "new",
      storedFingerprint: undefined,
      hasPglite: false,
    }),
    {
      shouldRecord: true,
      shouldReset: false,
      reason: "no local deployment fingerprint was recorded",
    },
  );
});

test("keeps Ponder data when the local deployment fingerprint is unchanged", () => {
  assert.deepEqual(
    getPonderDataResetPlan({
      ponderNetwork: "hardhat",
      ponderRpcUrl: "http://127.0.0.1:8545",
      currentFingerprint: "same",
      storedFingerprint: "same",
      hasPglite: true,
    }),
    {
      shouldRecord: false,
      shouldReset: false,
      reason: "local deployment artifact is unchanged",
    },
  );
});

test("does not reset Ponder data for non-local Ponder networks", () => {
  assert.deepEqual(
    getPonderDataResetPlan({
      ponderNetwork: "worldchainSepolia",
      ponderRpcUrl: "https://worldchain-sepolia.g.alchemy.com/public",
      currentFingerprint: "new",
      storedFingerprint: "old",
      hasPglite: true,
    }),
    {
      shouldRecord: false,
      shouldReset: false,
      reason: "Ponder is not targeting local hardhat",
    },
  );
});

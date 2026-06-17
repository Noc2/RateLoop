import assert from "node:assert/strict";
import test from "node:test";
import {
  getDbPushPlan,
  getDevStackNetworkAlignmentWarning,
  getPonderDataResetPlan,
  getPonderDeploymentFingerprint,
  getPonderRpcPreflightPlan,
  getPonderRpcReadinessError,
  getUnexpectedServiceExitCode,
} from "./dev-stack.mjs";

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

test("checks the local hardhat Ponder RPC before starting services", () => {
  assert.deepEqual(
    getPonderRpcPreflightPlan({
      ponderNetwork: "hardhat",
      ponderRpcUrl: "http://127.0.0.1:8545",
    }),
    {
      shouldCheck: true,
      rpcUrl: "http://127.0.0.1:8545",
      expectedChainId: "31337",
      envKey: "PONDER_RPC_URL_31337",
    },
  );
});

test("skips the Ponder RPC startup check outside local hardhat", () => {
  assert.deepEqual(
    getPonderRpcPreflightPlan({
      ponderNetwork: "worldchainSepolia",
      ponderRpcUrl: "https://worldchain-sepolia.g.alchemy.com/public",
    }),
    {
      shouldCheck: false,
      reason: "Ponder is not targeting local hardhat",
    },
  );
});

test("accepts a ready local hardhat Ponder RPC", async () => {
  const error = await getPonderRpcReadinessError({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ result: "0x7a69" }),
    }),
  });

  assert.equal(error, null);
});

test("reports a missing local hardhat Ponder RPC before services start", async () => {
  const error = await getPonderRpcReadinessError({
    fetchImpl: async () => {
      throw new Error("fetch failed", {
        cause: new Error("connect ECONNREFUSED 127.0.0.1:8545"),
      });
    },
  });

  assert.match(error ?? "", /Ponder is configured for local hardhat at http:\/\/127\.0\.0\.1:8545/);
  assert.match(error ?? "", /yarn chain/);
  assert.match(error ?? "", /yarn deploy/);
  assert.match(error ?? "", /ECONNREFUSED/);
});

test("reports local hardhat Ponder RPC chain ID mismatches", async () => {
  const error = await getPonderRpcReadinessError({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ result: "0x12c1" }),
    }),
  });

  assert.match(error ?? "", /reports chain 4801/);
  assert.match(error ?? "", /expects chain 31337/);
});

test("includes local Ponder address overrides in the deployment fingerprint", () => {
  const base = getPonderDeploymentFingerprint({
    deployedContractsContent: "contracts",
    env: {},
  });
  const withOverride = getPonderDeploymentFingerprint({
    deployedContractsContent: "contracts",
    env: {
      PONDER_CONTENT_REGISTRY_ADDRESS: "0x1111111111111111111111111111111111111111",
    },
  });
  const withDifferentOverride = getPonderDeploymentFingerprint({
    deployedContractsContent: "contracts",
    env: {
      PONDER_CONTENT_REGISTRY_ADDRESS: "0x2222222222222222222222222222222222222222",
    },
  });
  const withUnrelatedEnv = getPonderDeploymentFingerprint({
    deployedContractsContent: "contracts",
    env: {
      NEXT_PUBLIC_PONDER_URL: "http://127.0.0.1:42069",
    },
  });

  assert.notEqual(base, withOverride);
  assert.notEqual(withOverride, withDifferentOverride);
  assert.equal(base, withUnrelatedEnv);
});

test("includes optional local Ponder address overrides in the deployment fingerprint", () => {
  const base = getPonderDeploymentFingerprint({
    deployedContractsContent: "contracts",
    env: {},
  });
  const withFeedbackRegistryOverride = getPonderDeploymentFingerprint({
    deployedContractsContent: "contracts",
    env: {
      PONDER_FEEDBACK_REGISTRY_ADDRESS: "0x3333333333333333333333333333333333333333",
    },
  });

  assert.notEqual(base, withFeedbackRegistryOverride);
});

test("warns when Keeper points at local Ponder for a different chain", () => {
  const warning = getDevStackNetworkAlignmentWarning({
    keeperEnabled: true,
    keeperEnv: {
      CHAIN_ID: "4801",
      PONDER_BASE_URL: "http://localhost:42069",
    },
    ponderEnv: {
      PONDER_NETWORK: "hardhat",
    },
  });

  assert.match(warning ?? "", /Keeper is configured for chain 4801/);
  assert.match(warning ?? "", /Ponder is configured for hardhat \(chain 31337\)/);
});

test("uses Base network ids in Keeper/Ponder alignment warnings", () => {
  const warning = getDevStackNetworkAlignmentWarning({
    keeperEnabled: true,
    keeperEnv: {
      CHAIN_ID: "8453",
      PONDER_BASE_URL: "http://localhost:42069",
    },
    ponderEnv: {
      PONDER_NETWORK: "baseSepolia",
    },
  });

  assert.match(warning ?? "", /Keeper is configured for chain 8453/);
  assert.match(warning ?? "", /Ponder is configured for baseSepolia \(chain 84532\)/);
});

test("does not warn when Keeper and local Ponder target the same chain", () => {
  assert.equal(
    getDevStackNetworkAlignmentWarning({
      keeperEnabled: true,
      keeperEnv: {
        CHAIN_ID: "31337",
        PONDER_BASE_URL: "http://localhost:42069",
      },
      ponderEnv: {
        PONDER_NETWORK: "hardhat",
      },
    }),
    null,
  );
});

test("does not warn when Keeper uses a remote Ponder API", () => {
  assert.equal(
    getDevStackNetworkAlignmentWarning({
      keeperEnabled: true,
      keeperEnv: {
        CHAIN_ID: "4801",
        PONDER_BASE_URL: "https://ponder.example.com",
      },
      ponderEnv: {
        PONDER_NETWORK: "hardhat",
      },
    }),
    null,
  );
});

test("treats an unexpected clean service exit as a stack failure", () => {
  assert.equal(getUnexpectedServiceExitCode(0), 1);
  assert.equal(getUnexpectedServiceExitCode(null), 1);
  assert.equal(getUnexpectedServiceExitCode(undefined), 1);
});

test("preserves non-zero service exit codes for the stack exit", () => {
  assert.equal(getUnexpectedServiceExitCode(2), 2);
  assert.equal(getUnexpectedServiceExitCode(137), 137);
});

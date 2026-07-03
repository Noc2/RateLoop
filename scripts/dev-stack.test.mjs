import assert from "node:assert/strict";
import test from "node:test";
import {
  getDbPushPlan,
  getDevStackServices,
  getDevStackNetworkAlignmentWarning,
  LOCAL_E2E_CONFIDENTIALITY_JOB_SECRET,
  getPonderDataResetPlan,
  getPonderDeploymentFingerprint,
  getPonderRpcPreflightPlan,
  getPonderRpcReadinessError,
  getUnexpectedServiceExitCode,
  resolveNextServiceEnv,
  resolvePonderServiceEnv,
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
  assert.match(plan.help, /numbered SQL migrations/);
  assert.match(plan.help, /schema sync, not the deploy migration runner/);
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
      ponderNetwork: "base",
      ponderRpcUrl: "https://mainnet.base.org",
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
      ponderNetwork: "base",
      ponderRpcUrl: "https://mainnet.base.org",
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
      json: async () => ({ result: "0x2105" }),
    }),
  });

  assert.match(error ?? "", /reports chain 8453/);
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
      CHAIN_ID: "8453",
      PONDER_BASE_URL: "http://localhost:42069",
    },
    ponderEnv: {
      PONDER_NETWORK: "hardhat",
    },
  });

  assert.match(warning ?? "", /Keeper is configured for chain 8453/);
  assert.match(warning ?? "", /Ponder is configured for hardhat \(chain 31337\)/);
});

test("uses Base network ids in Keeper/Ponder alignment warnings", () => {
  const warning = getDevStackNetworkAlignmentWarning({
    keeperEnabled: true,
    keeperEnv: {
      CHAIN_ID: "31337",
      PONDER_BASE_URL: "http://localhost:42069",
    },
    ponderEnv: {
      PONDER_NETWORK: "base",
    },
  });

  assert.match(warning ?? "", /Keeper is configured for chain 31337/);
  assert.match(warning ?? "", /Ponder is configured for base \(chain 8453\)/);
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
      CHAIN_ID: "8453",
      PONDER_BASE_URL: "https://ponder.example.com",
    },
      ponderEnv: {
        PONDER_NETWORK: "hardhat",
      },
    }),
    null,
  );
});

test("passes an isolated Ponder schema to the dev Ponder service", () => {
  assert.deepEqual(
    resolvePonderServiceEnv({
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/rateloop_app",
      PONDER_NETWORK: "hardhat",
    }),
    {
      DATABASE_SCHEMA: "rateloop_ponder_hardhat",
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/rateloop_app",
      PONDER_METADATA_SYNC_ALLOW_OPEN: "true",
      PONDER_NETWORK: "hardhat",
    },
  );
});

test("preserves explicit Ponder metadata sync settings", () => {
  assert.deepEqual(
    resolvePonderServiceEnv({
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/rateloop_app",
      PONDER_METADATA_SYNC_ALLOW_OPEN: "false",
      PONDER_METADATA_SYNC_TOKEN: "local-secret",
      PONDER_NETWORK: "hardhat",
    }),
    {
      DATABASE_SCHEMA: "rateloop_ponder_hardhat",
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/rateloop_app",
      PONDER_METADATA_SYNC_ALLOW_OPEN: "false",
      PONDER_METADATA_SYNC_TOKEN: "local-secret",
      PONDER_NETWORK: "hardhat",
    },
  );
});

test("aligns the Next service target network with the dev Ponder network", () => {
  assert.deepEqual(
    resolveNextServiceEnv({
      databaseUrl: localDatabaseConfig.url,
      ponderEnv: {
        PONDER_NETWORK: "hardhat",
        PONDER_RPC_URL_31337: "http://127.0.0.1:8545",
      },
      baseEnv: {},
    }),
    {
      DATABASE_URL: localDatabaseConfig.url,
      NEXT_PUBLIC_TARGET_NETWORKS: "31337",
      NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD: "true",
      NEXT_PUBLIC_RPC_URL_31337: "http://127.0.0.1:8545",
      RATELOOP_IMAGE_MODERATION_MODE: "disabled",
      RATELOOP_E2E_PRODUCTION_BUILD: "true",
      RATELOOP_CONFIDENTIALITY_JOB_SECRET: LOCAL_E2E_CONFIDENTIALITY_JOB_SECRET,
      RATELOOP_QUESTION_DETAILS_MODERATION_MODE: "disabled",
    },
  );
});

test("preserves explicit confidentiality job secrets for the Next service", () => {
  assert.deepEqual(
    resolveNextServiceEnv({
      databaseUrl: localDatabaseConfig.url,
      ponderEnv: {
        PONDER_NETWORK: "hardhat",
        PONDER_RPC_URL_31337: "http://127.0.0.1:8545",
      },
      baseEnv: {
        RATELOOP_CONFIDENTIALITY_JOB_SECRET: "real-job-secret",
      },
    }),
    {
      DATABASE_URL: localDatabaseConfig.url,
      NEXT_PUBLIC_TARGET_NETWORKS: "31337",
      NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD: "true",
      NEXT_PUBLIC_RPC_URL_31337: "http://127.0.0.1:8545",
      RATELOOP_IMAGE_MODERATION_MODE: "disabled",
      RATELOOP_E2E_PRODUCTION_BUILD: "true",
      RATELOOP_QUESTION_DETAILS_MODERATION_MODE: "disabled",
    },
  );
});

test("preserves explicit Next target network overrides from the shell", () => {
  assert.deepEqual(
    resolveNextServiceEnv({
      databaseUrl: localDatabaseConfig.url,
      ponderEnv: {
        PONDER_NETWORK: "hardhat",
        PONDER_RPC_URL_31337: "http://127.0.0.1:8545",
      },
      baseEnv: {
        NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD: "false",
        NEXT_PUBLIC_TARGET_NETWORKS: "8453",
        NEXT_PUBLIC_RPC_URL_31337: "http://localhost:9545",
        RATELOOP_IMAGE_MODERATION_MODE: "openai",
        RATELOOP_E2E_PRODUCTION_BUILD: "false",
        RATELOOP_QUESTION_DETAILS_MODERATION_MODE: "openai",
      },
    }),
    {
      DATABASE_URL: localDatabaseConfig.url,
      RATELOOP_CONFIDENTIALITY_JOB_SECRET: LOCAL_E2E_CONFIDENTIALITY_JOB_SECRET,
    },
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

test("starts long-running services with prebuilt workspace dependencies", () => {
  const services = getDevStackServices({ keeperEnabled: true });
  const byName = new Map(services.map(service => [service.name, service]));

  assert.deepEqual(byName.get("Ponder")?.args, ["workspace", "@rateloop/ponder", "dev:built-contracts"]);
  assert.deepEqual(byName.get("Next")?.args, ["workspace", "@rateloop/nextjs", "dev:built-workspace-deps"]);
  assert.deepEqual(byName.get("Keeper")?.args, ["workspace", "@rateloop/keeper", "dev:built-workspace-deps"]);

  for (const service of services) {
    assert.doesNotMatch(
      service.args.join(" "),
      /\bbuild:workspace-deps\b/,
      `${service.name} should not rebuild shared dist folders after dev-stack prebuilds them`,
    );
  }
});

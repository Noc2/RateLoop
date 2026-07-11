import assert from "node:assert/strict";
import test from "node:test";
import {
  REQUIRED_DEPLOYED_CONTRACTS,
  buildDeploymentAddressMap,
  buildPonderUrl,
  buildReadinessUrl,
  validateOffchainRuntimeEnv,
  validateLiveWorldIdV4BackendIssuerRollout,
  validateWorldIdV4BackendIssuerRolloutMetadata,
} from "./readiness-core.mjs";
import {
  BASE_MAINNET_READINESS_CONFIG,
  baseMainnetNotDeployedMessage,
  parseBaseMainnetReadinessArgs,
  validateBaseMainnetOfflineReadiness,
  validateBaseMainnetLiveEnvironment,
} from "./check-base-mainnet-readiness.mjs";

function addressFor(index) {
  return `0x${index.toString(16).padStart(40, "0")}`;
}

function makeDeploymentJson(overrides = {}) {
  const deploymentJson = {
    deploymentBlockNumber: 100,
    deploymentComplete: "true",
    deploymentProfile: "production",
    networkName: "base",
  };
  REQUIRED_DEPLOYED_CONTRACTS.forEach((contractName, index) => {
    deploymentJson[addressFor(index + 1)] = contractName;
  });
  return { ...deploymentJson, ...overrides };
}

function makeGeneratedContractsSource(overrides = {}) {
  const contracts = REQUIRED_DEPLOYED_CONTRACTS.map((contractName, index) => {
    const address = overrides[contractName]?.address ?? addressFor(index + 1);
    const deployedOnBlock =
      overrides[contractName]?.deployedOnBlock ?? index + 101;
    return `
    ${contractName}: {
      address: "${address}",
      abi: [],
      deployedOnBlock: ${deployedOnBlock},
    },`;
  }).join("");

  return `
const deployedContracts = {
  8453: {${contracts}
  },
};`;
}

function makeRolloutFixture(overrides = {}) {
  const implementation = addressFor(100);
  const issuer = addressFor(101);
  const signer = addressFor(102);
  const timelock = addressFor(103);
  const deploymentJson = makeDeploymentJson({
    [implementation]: "RaterRegistryImplementation",
    [issuer]: "WorldIdV4BackendIssuer",
    [timelock]: "TimelockController",
    worldIdV4BackendIssuerRollout: {
      signer,
      rpId: "42",
      action: "0x1234",
      maxCredentialTtl: 604800,
      issuanceCap: 100,
      proposalId: "123",
      activationBlockNumber: 200,
      ...overrides,
    },
  });
  const deployedContractsSource = makeGeneratedContractsSource().replace(
    "\n  },\n};",
    `
    WorldIdV4BackendIssuer: {
      address: "${issuer}",
      abi: [],
      deployedOnBlock: 200,
    },
  },
};`,
  );
  return {
    deploymentJson,
    deployedContractsSource,
    implementation,
    issuer,
    signer,
  };
}

function encodeWord(value) {
  const hex =
    typeof value === "string" && value.startsWith("0x")
      ? value.slice(2)
      : BigInt(value).toString(16);
  return `0x${hex.padStart(64, "0")}`;
}

const productionEnvSource =
  "NEXT_PUBLIC_TARGET_NETWORKS=8453\nNEXT_PUBLIC_WORLD_ID_ENVIRONMENT=production\nNEXT_PUBLIC_WORLD_ID_PROOF_MODE=legacy\n";
const protocolSource =
  'const USDC_BY_CHAIN_ID = { 8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" };';

test("parseBaseMainnetReadinessArgs accepts supported live readiness flags", () => {
  assert.deepEqual(parseBaseMainnetReadinessArgs(["--live", "--require-live-targets", "--json"]), {
    live: true,
    json: true,
    requireLiveTargets: true,
  });
});

test("parseBaseMainnetReadinessArgs rejects unknown flags", () => {
  assert.throws(() => parseBaseMainnetReadinessArgs(["--lve", "--json"]), /Unknown argument: --lve/);
});

test("parseBaseMainnetReadinessArgs rejects required live targets without live probes", () => {
  assert.throws(
    () => parseBaseMainnetReadinessArgs(["--require-live-targets"]),
    /--require-live-targets requires --live/,
  );
});

test("validateBaseMainnetOfflineReadiness accepts synchronized production Base artifacts", () => {
  const result = validateBaseMainnetOfflineReadiness({
    deploymentJson: makeDeploymentJson(),
    deployedContractsSource: makeGeneratedContractsSource(),
    envProductionSource: productionEnvSource,
    protocolSource,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
});

test("World ID v4 rollout readiness stays backward compatible before metadata exists", () => {
  const result = validateWorldIdV4BackendIssuerRolloutMetadata(
    makeDeploymentJson(),
    makeGeneratedContractsSource(),
    8453,
  );

  assert.equal(result.ok, true);
  assert.equal(result.rollout, null);
  assert.deepEqual(result.checks, []);
});

test("World ID v4 rollout readiness accepts complete receipt-derived metadata", () => {
  const fixture = makeRolloutFixture();
  const result = validateWorldIdV4BackendIssuerRolloutMetadata(
    fixture.deploymentJson,
    fixture.deployedContractsSource,
    8453,
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
  assert.equal(result.rollout.issuer, fixture.issuer);
  assert.equal(result.rollout.implementation, fixture.implementation);
});

test("World ID v4 rollout readiness rejects partial or unsafe metadata", () => {
  const fixture = makeRolloutFixture({
    signer: "",
    rpId: "18446744073709551616",
    maxCredentialTtl: 604801,
    issuanceCap: 10001,
    activationBlockNumber: 0,
  });
  const result = validateWorldIdV4BackendIssuerRolloutMetadata(
    fixture.deploymentJson,
    fixture.deployedContractsSource,
    8453,
  );

  assert.equal(result.ok, false);
  assert(result.failures.some((message) => message.includes("signer")));
  assert(result.failures.some((message) => message.includes("uint64")));
  assert(result.failures.some((message) => message.includes("TTL")));
  assert(result.failures.some((message) => message.includes("cap")));
  assert(
    result.failures.some((message) => message.includes("activation block")),
  );
});

test("live World ID v4 rollout readiness verifies implementation, roles, domain, and cap", async () => {
  const fixture = makeRolloutFixture();
  const deploymentAddresses = buildDeploymentAddressMap(fixture.deploymentJson);
  const registry = deploymentAddresses.get("RaterRegistry");
  const calls = [];
  const rpcRequest = async (_rpcUrl, method, params) => {
    calls.push({ method, params });
    if (method === "eth_getStorageAt")
      return encodeWord(fixture.implementation);
    if (method === "eth_getCode") {
      return params[0].toLowerCase() === fixture.implementation.toLowerCase()
        ? "0x60009f8aabb26000"
        : "0x6001";
    }
    if (method !== "eth_call") throw new Error(`Unexpected ${method}`);

    const { data, to } = params[0];
    if (data.startsWith("0x91d14854")) return encodeWord(1);
    if (data === "0x7b103999") return encodeWord(registry);
    if (data === "0xefc21e3f") return encodeWord(8453);
    if (data === "0x202ab35d") return encodeWord(42);
    if (data === "0x0a7a1c4d") return encodeWord(0x1234);
    if (data === "0xe156674b") return encodeWord(604800);
    if (data === "0xb733b3f8") return encodeWord(100);
    if (data === "0x0b0f7743") return encodeWord(3);
    throw new Error(`Unexpected eth_call ${to} ${data}`);
  };
  const checks = [];
  const failures = [];

  await validateLiveWorldIdV4BackendIssuerRollout({
    checks,
    deploymentAddresses,
    deploymentJson: fixture.deploymentJson,
    failures,
    readinessConfig: BASE_MAINNET_READINESS_CONFIG,
    rpcRequest,
    rpcUrl: "https://rpc.example",
  });

  assert.deepEqual(failures, []);
  assert(checks.every((check) => check.ok));
  assert(calls.some(({ method }) => method === "eth_getStorageAt"));
  assert(calls.some(({ method }) => method === "eth_getCode"));
  assert(
    calls.some(({ params }) => params?.[0]?.data?.startsWith("0x91d14854")),
  );
});

test("validateBaseMainnetOfflineReadiness rejects stale generated contract addresses", () => {
  const result = validateBaseMainnetOfflineReadiness({
    deploymentJson: makeDeploymentJson(),
    deployedContractsSource: makeGeneratedContractsSource({
      ContentRegistry: {
        address: "0xffffffffffffffffffffffffffffffffffffffff",
      },
    }),
    envProductionSource: productionEnvSource,
    protocolSource,
  });

  assert.equal(result.ok, false);
  assert(
    result.failures.some((message) =>
      message.includes("ContentRegistry address matches"),
    ),
  );
});

test("validateBaseMainnetOfflineReadiness rejects missing x402 submitter deployment", () => {
  const deploymentJson = makeDeploymentJson();
  const x402Address = buildDeploymentAddressMap(deploymentJson).get(
    "X402QuestionSubmitter",
  );
  delete deploymentJson[x402Address];

  const result = validateBaseMainnetOfflineReadiness({
    deploymentJson,
    deployedContractsSource: makeGeneratedContractsSource(),
    envProductionSource: productionEnvSource,
    protocolSource,
  });

  assert.equal(result.ok, false);
  assert(
    result.failures.some((message) =>
      message.includes("X402QuestionSubmitter has an address"),
    ),
  );
});

test("validateBaseMainnetOfflineReadiness rejects non-production deployment artifacts", () => {
  const result = validateBaseMainnetOfflineReadiness({
    deploymentJson: makeDeploymentJson({ deploymentProfile: "staging" }),
    deployedContractsSource: makeGeneratedContractsSource(),
    envProductionSource: productionEnvSource,
    protocolSource,
  });

  assert.equal(result.ok, false);
  assert(
    result.failures.some((message) =>
      message.includes("deployment artifact profile is production"),
    ),
  );
});

test("validateBaseMainnetOfflineReadiness rejects non-mainnet production target networks", () => {
  const result = validateBaseMainnetOfflineReadiness({
    deploymentJson: makeDeploymentJson(),
    deployedContractsSource: makeGeneratedContractsSource(),
    envProductionSource:
      "NEXT_PUBLIC_TARGET_NETWORKS=999999\nNEXT_PUBLIC_WORLD_ID_ENVIRONMENT=production\nNEXT_PUBLIC_WORLD_ID_PROOF_MODE=legacy\n",
    protocolSource,
  });

  assert.equal(result.ok, false);
  assert(
    result.failures.some((message) =>
      message.includes("production env targets Base mainnet"),
    ),
  );
});

test("validateBaseMainnetOfflineReadiness rejects staging World ID for production mainnet", () => {
  const result = validateBaseMainnetOfflineReadiness({
    deploymentJson: makeDeploymentJson(),
    deployedContractsSource: makeGeneratedContractsSource(),
    envProductionSource:
      "NEXT_PUBLIC_TARGET_NETWORKS=8453\nNEXT_PUBLIC_WORLD_ID_ENVIRONMENT=staging\nNEXT_PUBLIC_WORLD_ID_PROOF_MODE=legacy\n",
    protocolSource,
  });

  assert.equal(result.ok, false);
  assert(
    result.failures.some((message) =>
      message.includes("production env uses production World ID"),
    ),
  );
});

test("validateBaseMainnetOfflineReadiness rejects Base preconfirmation without a generic RPC override", () => {
  const result = validateBaseMainnetOfflineReadiness({
    deploymentJson: makeDeploymentJson(),
    deployedContractsSource: makeGeneratedContractsSource(),
    envProductionSource: `${productionEnvSource}NEXT_PUBLIC_USE_BASE_PRECONF_RPC=true\n`,
    protocolSource,
  });

  assert.equal(result.ok, false);
  assert(
    result.failures.some((message) =>
      message.includes("NEXT_PUBLIC_RPC_URL_8453"),
    ),
  );
});

test("validateBaseMainnetOfflineReadiness rejects removed dedicated Base preconfirmation env vars", () => {
  const result = validateBaseMainnetOfflineReadiness({
    deploymentJson: makeDeploymentJson(),
    deployedContractsSource: makeGeneratedContractsSource(),
    envProductionSource: `${productionEnvSource}NEXT_PUBLIC_RPC_URL_8453=https://base-mainnet.example.com\nNEXT_PUBLIC_BASE_PRECONF_RPC_URL_8453=https://mainnet-preconf.example.com\n`,
    protocolSource,
  });

  assert.equal(result.ok, false);
  assert(
    result.failures.some((message) =>
      message.includes("NEXT_PUBLIC_BASE_PRECONF_RPC_URL_8453"),
    ),
  );
});

test("validateBaseMainnetLiveEnvironment requires an access recorder private key", () => {
  const missing = { ok: true, checks: [], failures: [] };
  validateBaseMainnetLiveEnvironment(missing, {});

  assert.equal(missing.ok, false);
  assert(
    missing.failures.some((message) =>
      message.includes("RATELOOP_CONFIDENTIALITY_ACCESS_RECORDER_PRIVATE_KEY"),
    ),
  );

  const configured = { ok: true, checks: [], failures: [] };
  validateBaseMainnetLiveEnvironment(configured, {
    RATELOOP_CONFIDENTIALITY_ACCESS_RECORDER_PRIVATE_KEY: `0x${"1".repeat(64)}`,
  });

  assert.equal(configured.ok, true);
  assert.deepEqual(configured.failures, []);
});

test("validateBaseMainnetLiveEnvironment rejects malformed access recorder private keys", () => {
  const result = { ok: true, checks: [], failures: [] };
  validateBaseMainnetLiveEnvironment(result, {
    RATELOOP_CONFIDENTIALITY_ACCESS_RECORDER_PRIVATE_KEY: "not-a-private-key",
  });

  assert.equal(result.ok, false);
  assert(
    result.failures.some((message) =>
      message.includes("RATELOOP_CONFIDENTIALITY_ACCESS_RECORDER_PRIVATE_KEY"),
    ),
  );
});

test("validateOffchainRuntimeEnv treats hosted PORT as a public Keeper metrics bind", () => {
  const checks = [];
  const failures = [];

  validateOffchainRuntimeEnv({
    checks,
    env: {
      PORT: "8080",
    },
    failures,
  });

  assert(
    failures.includes("METRICS_AUTH_TOKEN is configured when Keeper metrics are public"),
  );
});

test("validateOffchainRuntimeEnv treats omitted hosted PORT as loopback for public file artifacts", () => {
  const checks = [];
  const failures = [];

  validateOffchainRuntimeEnv({
    checks,
    env: {
      KEEPER_CORRELATION_ARTIFACT_STORAGE: "file",
      KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL:
        "https://artifacts.example.com/rateloop/",
      KEEPER_CORRELATION_SNAPSHOTS_ENABLED: "true",
      KEEPER_CORRELATION_SNAPSHOTS_MODE: "auto",
    },
    failures,
  });

  assert(
    failures.includes(
      "METRICS_BIND_ADDRESS is non-loopback when Keeper publishes public correlation artifacts",
    ),
  );
});

test("baseMainnetNotDeployedMessage names the Base mainnet deployment artifact", () => {
  assert.equal(
    baseMainnetNotDeployedMessage(),
    "Base mainnet is not deployed: missing packages/foundry/deployments/8453.json.",
  );
});

test("shared Ponder URL builder preserves path-prefixed mainnet readiness URLs", () => {
  assert.equal(
    buildPonderUrl("https://ponder.example.test/indexer", "/status").toString(),
    "https://ponder.example.test/indexer/status",
  );
});

test("shared readiness URL builder preserves path-prefixed mainnet app URLs", () => {
  assert.equal(
    buildReadinessUrl(
      "https://app.example.test/rateloop",
      "/docs/ai",
    ).toString(),
    "https://app.example.test/rateloop/docs/ai",
  );
});

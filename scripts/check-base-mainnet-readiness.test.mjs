import assert from "node:assert/strict";
import test from "node:test";
import {
  REQUIRED_DEPLOYED_CONTRACTS,
  buildDeploymentAddressMap,
  buildPonderUrl,
  buildReadinessUrl,
} from "./readiness-core.mjs";
import {
  baseMainnetNotDeployedMessage,
  validateBaseMainnetOfflineReadiness,
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
  480: {},
};`;
}

const productionEnvSource =
  "NEXT_PUBLIC_TARGET_NETWORKS=8453\nNEXT_PUBLIC_WORLD_ID_ENVIRONMENT=production\nNEXT_PUBLIC_WORLD_ID_PROOF_MODE=legacy\n";
const protocolSource =
  'const USDC_BY_CHAIN_ID = { 8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" };';

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
      "NEXT_PUBLIC_TARGET_NETWORKS=84532\nNEXT_PUBLIC_WORLD_ID_ENVIRONMENT=production\nNEXT_PUBLIC_WORLD_ID_PROOF_MODE=legacy\n",
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

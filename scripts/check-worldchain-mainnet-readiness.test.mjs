import assert from "node:assert/strict";
import test from "node:test";
import {
  REQUIRED_DEPLOYED_CONTRACTS,
  buildDeploymentAddressMap,
  parseGeneratedContractsForChain,
} from "./check-worldchain-sepolia-readiness.mjs";
import {
  loadOfflineInputs,
  mainnetNotDeployedMessage,
  validateLiveReadiness,
  validateOfflineReadiness,
} from "./check-worldchain-mainnet-readiness.mjs";

function addressFor(index) {
  return `0x${index.toString(16).padStart(40, "0")}`;
}

function makeDeploymentJson(overrides = {}) {
  const deploymentJson = {
    deploymentBlockNumber: 100,
    deploymentComplete: "true",
    deploymentProfile: "production",
    networkName: "worldchain",
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
  480: {${contracts}
  },
  4801: {},
};`;
}

const questionRewardPoolsSource =
  'const WORLD_CHAIN_USDC_BY_CHAIN_ID = { 480: "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1" };';

test("parseGeneratedContractsForChain extracts addresses and deployed blocks for mainnet", () => {
  const contracts = parseGeneratedContractsForChain(
    makeGeneratedContractsSource(),
    480,
  );

  assert.equal(
    contracts.get("ContentRegistry").address,
    addressFor(REQUIRED_DEPLOYED_CONTRACTS.indexOf("ContentRegistry") + 1),
  );
  assert.equal(
    contracts.get("ContentRegistry").deployedOnBlock,
    REQUIRED_DEPLOYED_CONTRACTS.indexOf("ContentRegistry") + 101,
  );
});

test("validateOfflineReadiness accepts synchronized production mainnet artifacts", () => {
  const result = validateOfflineReadiness({
    deploymentJson: makeDeploymentJson(),
    deployedContractsSource: makeGeneratedContractsSource(),
    questionRewardPoolsSource,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
});

test("validateOfflineReadiness accepts synchronized canary mainnet artifacts", () => {
  const result = validateOfflineReadiness({
    deploymentJson: makeDeploymentJson({ deploymentProfile: "mainnet-canary" }),
    deployedContractsSource: makeGeneratedContractsSource(),
    expectedMode: "canary",
    questionRewardPoolsSource,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
});

test("validateOfflineReadiness rejects production artifacts when canary is expected", () => {
  const result = validateOfflineReadiness({
    deploymentJson: makeDeploymentJson(),
    deployedContractsSource: makeGeneratedContractsSource(),
    expectedMode: "canary",
    questionRewardPoolsSource,
  });

  assert.equal(result.ok, false);
  assert(
    result.failures.some((message) =>
      message.includes("deployment artifact profile is mainnet-canary"),
    ),
  );
});

test("validateOfflineReadiness rejects stale generated contract addresses", () => {
  const result = validateOfflineReadiness({
    deploymentJson: makeDeploymentJson(),
    deployedContractsSource: makeGeneratedContractsSource({
      ContentRegistry: {
        address: "0xffffffffffffffffffffffffffffffffffffffff",
      },
    }),
    questionRewardPoolsSource,
  });

  assert.equal(result.ok, false);
  assert(
    result.failures.some((message) =>
      message.includes("ContentRegistry address matches"),
    ),
  );
});

test("validateOfflineReadiness rejects missing mainnet USDC config", () => {
  const result = validateOfflineReadiness({
    deploymentJson: makeDeploymentJson(),
    deployedContractsSource: makeGeneratedContractsSource(),
    questionRewardPoolsSource: "const WORLD_CHAIN_USDC_BY_CHAIN_ID = {};",
  });

  assert.equal(result.ok, false);
  assert(result.failures.some((message) => message.includes("USDC address")));
});

test("validateOfflineReadiness rejects missing x402 submitter deployment", () => {
  const deploymentJson = makeDeploymentJson();
  const x402Address = buildDeploymentAddressMap(deploymentJson).get(
    "X402QuestionSubmitter",
  );
  delete deploymentJson[x402Address];

  const result = validateOfflineReadiness({
    deploymentJson,
    deployedContractsSource: makeGeneratedContractsSource(),
    questionRewardPoolsSource,
  });

  assert.equal(result.ok, false);
  assert(
    result.failures.some((message) =>
      message.includes("X402QuestionSubmitter has an address"),
    ),
  );
});

test("loadOfflineInputs reports missing mainnet deployment artifact cleanly", () => {
  assert.equal(
    mainnetNotDeployedMessage(),
    "World Chain mainnet is not deployed: missing packages/foundry/deployments/480.json.",
  );
  assert.throws(
    () => loadOfflineInputs("/tmp/rateloop-mainnet-not-deployed"),
    (error) =>
      error?.code === "ENOENT" &&
      String(error.path).endsWith("packages/foundry/deployments/480.json"),
  );
});

test("validateLiveReadiness can skip missing targets for ad-hoc local use", async () => {
  const result = await validateLiveReadiness({
    deploymentJson: makeDeploymentJson(),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
});

test("validateLiveReadiness fails closed when required live targets are missing", async () => {
  const result = await validateLiveReadiness({
    deploymentJson: makeDeploymentJson(),
    requireTargets: true,
  });

  assert.equal(result.ok, false);
  assert(
    result.failures.some((message) => message.includes("WORLDCHAIN_RPC_URL")),
  );
  assert(
    result.failures.some((message) =>
      message.includes("WORLDCHAIN_PONDER_URL"),
    ),
  );
  assert(
    result.failures.some((message) => message.includes("WORLDCHAIN_APP_URL")),
  );
});

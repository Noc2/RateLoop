import assert from "node:assert/strict";
import test from "node:test";
import {
  REQUIRED_DEPLOYED_CONTRACTS,
  buildDeploymentAddressMap,
  parseGeneratedContractsForChain,
  validateLiveReadiness,
  validateOfflineReadiness,
} from "./check-worldchain-sepolia-readiness.mjs";

function addressFor(index) {
  return `0x${index.toString(16).padStart(40, "0")}`;
}

function makeDeploymentJson(overrides = {}) {
  const deploymentJson = {
    deploymentBlockNumber: 100,
    deploymentComplete: "true",
    networkName: "worldchainSepolia",
  };
  REQUIRED_DEPLOYED_CONTRACTS.forEach((contractName, index) => {
    deploymentJson[addressFor(index + 1)] = contractName;
  });
  return { ...deploymentJson, ...overrides };
}

function makeGeneratedContractsSource(overrides = {}) {
  const contracts = REQUIRED_DEPLOYED_CONTRACTS.map((contractName, index) => {
    const address = overrides[contractName]?.address ?? addressFor(index + 1);
    const deployedOnBlock = overrides[contractName]?.deployedOnBlock ?? index + 101;
    return `
    ${contractName}: {
      address: "${address}",
      abi: [],
      deployedOnBlock: ${deployedOnBlock},
    },`;
  }).join("");

  return `
const deployedContracts = {
  4801: {${contracts}
  },
  31337: {},
};`;
}

const questionRewardPoolsSource = 'const WORLD_CHAIN_USDC_BY_CHAIN_ID = { 4801: "0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88" };';

test("buildDeploymentAddressMap reads foundry address to contract mappings", () => {
  const map = buildDeploymentAddressMap({
    "0x0000000000000000000000000000000000000001": "ContentRegistry",
    networkName: "worldchainSepolia",
  });

  assert.equal(map.get("ContentRegistry"), "0x0000000000000000000000000000000000000001");
});

test("parseGeneratedContractsForChain extracts addresses and deployed blocks for Sepolia", () => {
  const contracts = parseGeneratedContractsForChain(makeGeneratedContractsSource());

  assert.equal(contracts.get("ContentRegistry").address, addressFor(REQUIRED_DEPLOYED_CONTRACTS.indexOf("ContentRegistry") + 1));
  assert.equal(contracts.get("ContentRegistry").deployedOnBlock, REQUIRED_DEPLOYED_CONTRACTS.indexOf("ContentRegistry") + 101);
});

test("validateOfflineReadiness accepts synchronized Sepolia deployment artifacts", () => {
  const result = validateOfflineReadiness({
    deploymentJson: makeDeploymentJson(),
    deployedContractsSource: makeGeneratedContractsSource(),
    questionRewardPoolsSource,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
});

test("validateOfflineReadiness rejects stale generated contract addresses", () => {
  const result = validateOfflineReadiness({
    deploymentJson: makeDeploymentJson(),
    deployedContractsSource: makeGeneratedContractsSource({
      ContentRegistry: { address: "0xffffffffffffffffffffffffffffffffffffffff" },
    }),
    questionRewardPoolsSource,
  });

  assert.equal(result.ok, false);
  assert(result.failures.some(message => message.includes("ContentRegistry address matches")));
});

test("validateOfflineReadiness rejects missing World Chain Sepolia USDC config", () => {
  const result = validateOfflineReadiness({
    deploymentJson: makeDeploymentJson(),
    deployedContractsSource: makeGeneratedContractsSource(),
    questionRewardPoolsSource: "const WORLD_CHAIN_USDC_BY_CHAIN_ID = {};",
  });

  assert.equal(result.ok, false);
  assert(result.failures.some(message => message.includes("USDC address")));
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
  assert(result.failures.some(message => message.includes("WORLDCHAIN_SEPOLIA_RPC_URL")));
  assert(result.failures.some(message => message.includes("WORLDCHAIN_SEPOLIA_PONDER_URL")));
  assert(result.failures.some(message => message.includes("WORLDCHAIN_SEPOLIA_APP_URL")));
});

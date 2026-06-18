import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDeploymentNameToAddress,
  extractGeneratedChainBlock,
  findDeploymentMismatches,
  readGeneratedAddress,
} from "./validateLocalDeploymentSync.js";

const artifactAddress = "0x1000000000000000000000000000000000000001";
const generatedAddress = "0x2000000000000000000000000000000000000002";
const otherChainAddress = "0x3000000000000000000000000000000000000003";

function generatedContractsSource(
  address = artifactAddress,
  extraLocalContracts = "",
) {
  return `
export default {
  31337: {
    LoopReputation: {
      address: "${address}",
      abi: [{ type: "function", name: "sample" }],
    },
    ${extraLocalContracts}
  },
  84532: {
    LoopReputation: {
      address: "${otherChainAddress}",
      abi: [],
    },
  },
} as const;
`;
}

test("buildDeploymentNameToAddress reads address-to-name Foundry exports", () => {
  const byName = buildDeploymentNameToAddress({
    [artifactAddress]: "LoopReputation",
  });

  assert.equal(byName.get("LoopReputation"), artifactAddress.toLowerCase());
});

test("buildDeploymentNameToAddress reads name-to-object deployment exports", () => {
  const byName = buildDeploymentNameToAddress({
    ContentRegistry: { address: generatedAddress },
  });

  assert.equal(byName.get("ContentRegistry"), generatedAddress.toLowerCase());
});

test("readGeneratedAddress extracts the requested chain address only", () => {
  assert.equal(
    readGeneratedAddress(generatedContractsSource(), 31337, "LoopReputation"),
    artifactAddress,
  );
  assert.equal(
    readGeneratedAddress(generatedContractsSource(), 84532, "LoopReputation"),
    otherChainAddress,
  );
});

test("extractGeneratedChainBlock returns undefined when the chain is absent", () => {
  assert.equal(extractGeneratedChainBlock(generatedContractsSource(), 8453), undefined);
});

test("findDeploymentMismatches reports stale local deployment artifacts", () => {
  const mismatches = findDeploymentMismatches({
    deploymentJson: {
      [artifactAddress]: "LoopReputation",
    },
    deployedContractsSource: generatedContractsSource(generatedAddress),
    chainId: 31337,
    contractNames: ["LoopReputation"],
  });

  assert.deepEqual(mismatches, [
    {
      contractName: "LoopReputation",
      artifactAddress,
      generatedAddress,
    },
  ]);
});

test("findDeploymentMismatches reports deployment contracts missing from generated contracts", () => {
  const mismatches = findDeploymentMismatches({
    deploymentJson: {
      [artifactAddress]: "ConfidentialityEscrow",
    },
    deployedContractsSource: generatedContractsSource(),
    chainId: 31337,
    contractNames: ["ConfidentialityEscrow"],
  });

  assert.deepEqual(mismatches, [
    {
      contractName: "ConfidentialityEscrow",
      artifactAddress,
      generatedAddress: undefined,
    },
  ]);
});

test("findDeploymentMismatches reports generated contracts missing from deployment artifacts", () => {
  const mismatches = findDeploymentMismatches({
    deploymentJson: {
      [artifactAddress]: "LoopReputation",
    },
    deployedContractsSource: generatedContractsSource(
      artifactAddress,
      `ConfidentialityEscrow: { address: "${generatedAddress}", abi: [] },`,
    ),
    chainId: 31337,
    contractNames: ["ConfidentialityEscrow"],
  });

  assert.deepEqual(mismatches, [
    {
      contractName: "ConfidentialityEscrow",
      artifactAddress: undefined,
      generatedAddress,
    },
  ]);
});

test("findDeploymentMismatches ignores contracts absent from both sources", () => {
  const mismatches = findDeploymentMismatches({
    deploymentJson: {},
    deployedContractsSource: generatedContractsSource(),
    chainId: 31337,
    contractNames: ["ConfidentialityEscrow"],
  });

  assert.deepEqual(mismatches, []);
});

test("findDeploymentMismatches accepts matching addresses case-insensitively", () => {
  const mixedCaseAddress = "0x100000000000000000000000000000000000000A";
  const mismatches = findDeploymentMismatches({
    deploymentJson: {
      [mixedCaseAddress]: "LoopReputation",
    },
    deployedContractsSource: generatedContractsSource(
      mixedCaseAddress.toLowerCase(),
    ),
    chainId: 31337,
    contractNames: ["LoopReputation"],
  });

  assert.deepEqual(mismatches, []);
});

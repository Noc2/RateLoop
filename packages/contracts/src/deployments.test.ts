import assert from "node:assert/strict";
import test from "node:test";

import * as generatedAbis from "./abis";
import deployedContracts from "./deployedContracts";
import {
  getSharedChainStartBlock,
  getSharedDeploymentAddress,
  getSharedDeploymentStartBlock,
} from "./deployments";

type DeploymentContract = {
  address: `0x${string}`;
  abi: readonly unknown[];
  deployedOnBlock?: number;
};
type DeploymentChain = Record<string, DeploymentContract>;

const deploymentsByChain = deployedContracts as Record<number, DeploymentChain>;
const localChain = deploymentsByChain[31337];
const abiExportsByContractName = new Map<string, readonly unknown[]>(
  Object.entries(generatedAbis).flatMap(([exportName, abi]) => {
    if (!exportName.endsWith("Abi") || !Array.isArray(abi)) {
      return [];
    }

    return [[exportName.slice(0, -"Abi".length), abi as readonly unknown[]]];
  }),
);

function isValidStartBlock(value: number | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function getExpectedChainStartBlock(
  chain: DeploymentChain,
): number | undefined {
  const startBlocks = Object.values(chain)
    .map((contract) => contract.deployedOnBlock)
    .filter(isValidStartBlock);
  return startBlocks.length > 0 ? Math.min(...startBlocks) : undefined;
}

function getChainWithStartBlocks(): [number, DeploymentChain] {
  const entry = Object.entries(deploymentsByChain).find(
    ([, chain]) => getExpectedChainStartBlock(chain) !== undefined,
  );
  assert.ok(
    entry,
    "expected at least one generated deployment chain with start block metadata",
  );
  return [Number(entry[0]), entry[1]];
}

function isInternalDeploymentOnlyContract(contractName: string): boolean {
  return contractName.endsWith("Lib") || contractName.startsWith("Mock");
}

test("shared deployment helpers return local-chain addresses", () => {
  assert.equal(
    getSharedDeploymentAddress(31337, "ContentRegistry"),
    localChain.ContentRegistry.address,
  );
  assert.equal(
    getSharedDeploymentAddress(31337, "RoundVotingEngine"),
    localChain.RoundVotingEngine.address,
  );
  assert.equal(
    getSharedDeploymentAddress(31337, "ProtocolConfig"),
    localChain.ProtocolConfig.address,
  );
  assert.equal(
    getSharedDeploymentAddress(31337, "QuestionRewardPoolEscrow"),
    localChain.QuestionRewardPoolEscrow.address,
  );
  assert.equal(
    getSharedDeploymentAddress(31337, "ConfidentialityEscrow"),
    localChain.ConfidentialityEscrow.address,
  );
});

test("shared deployment helpers expose the chain start block and prefer contract-specific blocks when present", () => {
  const [chainId, chain] = getChainWithStartBlocks();
  const expectedChainStartBlock = getExpectedChainStartBlock(chain);
  const contractEntry = Object.entries(chain).find(([, contract]) =>
    isValidStartBlock(contract.deployedOnBlock),
  );
  assert.ok(
    contractEntry,
    "expected selected chain to include a contract-specific start block",
  );

  const [contractName, contract] = contractEntry;
  assert.equal(getSharedChainStartBlock(chainId), expectedChainStartBlock);
  assert.equal(
    getSharedDeploymentStartBlock(chainId, contractName),
    contract.deployedOnBlock,
  );
});

test("shared deployment helpers return undefined for unknown chains", () => {
  assert.equal(
    getSharedDeploymentAddress(999999, "ContentRegistry"),
    undefined,
  );
  assert.equal(
    getSharedDeploymentStartBlock(999999, "ContentRegistry"),
    undefined,
  );
});

test("shared ABI exports include governance contracts present in shared deployments", () => {
  assert.ok(Array.isArray(generatedAbis.RateLoopGovernorAbi));
  assert.ok(generatedAbis.RateLoopGovernorAbi.length > 0);
});

test("confidentiality ABI snippets expose indexer event surface", () => {
  const escrowFunctions = new Set(
    generatedAbis.ConfidentialityEscrowAbi.filter(
      (item) => item.type === "function",
    ).map((item) => item.name),
  );
  const raterFunctions = new Set(
    generatedAbis.RaterRegistryConfidentialityAbi.filter(
      (item) => item.type === "function",
    ).map((item) => item.name),
  );
  const escrowEvents = new Set(
    generatedAbis.ConfidentialityEscrowAbi.filter(
      (item) => item.type === "event",
    ).map((item) => item.name),
  );
  const raterEvents = new Set(
    generatedAbis.RaterRegistryConfidentialityAbi.filter(
      (item) => item.type === "event",
    ).map((item) => item.name),
  );

  assert.deepEqual(
    [
      "ConfidentialityConfigured",
      "BondPosted",
      "BondReleased",
      "BondSlashed",
    ].every((eventName) => escrowEvents.has(eventName)),
    true,
  );
  assert.deepEqual(escrowFunctions.has("slashBond"), true);
  assert.deepEqual(
    ["banIdentity", "banKnownCredentialNullifier", "unbanIdentity"].every(
      (functionName) => raterFunctions.has(functionName),
    ),
    true,
  );
  assert.deepEqual(
    ["IdentityBanned", "IdentityUnbanned"].every((eventName) =>
      raterEvents.has(eventName),
    ),
    true,
  );
});

test("standalone generated ABIs match shared deployment ABIs", () => {
  const comparedContracts = new Set<string>();
  const missingStandaloneAbiExports = new Set<string>();

  for (const [chainId, chain] of Object.entries(deploymentsByChain)) {
    for (const [contractName, contract] of Object.entries(chain)) {
      const standaloneAbi = abiExportsByContractName.get(contractName);
      if (!standaloneAbi) {
        if (!isInternalDeploymentOnlyContract(contractName)) {
          missingStandaloneAbiExports.add(contractName);
        }
        continue;
      }

      comparedContracts.add(contractName);
      assert.deepEqual(
        contract.abi,
        standaloneAbi,
        `${contractName} ABI mismatch on chain ${chainId}`,
      );
    }
  }

  assert.deepEqual(
    [...missingStandaloneAbiExports].sort(),
    [],
    "expected every non-internal deployed contract to have a standalone ABI export",
  );
  assert.ok(
    comparedContracts.size > 10,
    "expected ABI parity coverage to include generated deployment contracts",
  );
});

test("cluster payout oracle ABI exposes metadata and root rejection functions", () => {
  const rejectCorrelation = generatedAbis.ClusterPayoutOracleAbi.find(
    (item) =>
      item.type === "function" && item.name === "rejectCorrelationEpoch",
  );
  const rejectCorrelationRoot = generatedAbis.ClusterPayoutOracleAbi.find(
    (item) =>
      item.type === "function" && item.name === "rejectCorrelationEpochRoot",
  );
  const rejectFinalizedCorrelation = generatedAbis.ClusterPayoutOracleAbi.find(
    (item) =>
      item.type === "function" &&
      item.name === "rejectFinalizedCorrelationEpoch",
  );
  const rejectFinalizedCorrelationRoot =
    generatedAbis.ClusterPayoutOracleAbi.find(
      (item) =>
        item.type === "function" &&
        item.name === "rejectFinalizedCorrelationEpochRoot",
    );
  const rejectFinalized = generatedAbis.ClusterPayoutOracleAbi.find(
    (item) =>
      item.type === "function" &&
      item.name === "rejectFinalizedRoundPayoutSnapshot",
  );
  const rejectProposed = generatedAbis.ClusterPayoutOracleAbi.find(
    (item) =>
      item.type === "function" && item.name === "rejectRoundPayoutSnapshot",
  );
  const rejectProposedRoot = generatedAbis.ClusterPayoutOracleAbi.find(
    (item) =>
      item.type === "function" && item.name === "rejectRoundPayoutSnapshotRoot",
  );
  const rejectFinalizedRoot = generatedAbis.ClusterPayoutOracleAbi.find(
    (item) =>
      item.type === "function" &&
      item.name === "rejectFinalizedRoundPayoutSnapshotRoot",
  );

  assert.deepEqual(
    rejectCorrelation?.inputs.map((input) => input.type),
    ["uint64", "bytes32"],
  );
  assert.deepEqual(
    rejectCorrelationRoot?.inputs.map((input) => input.type),
    ["uint64", "bytes32"],
  );
  assert.deepEqual(
    rejectFinalizedCorrelation?.inputs.map((input) => input.type),
    ["uint64", "bytes32"],
  );
  assert.deepEqual(
    rejectFinalizedCorrelationRoot?.inputs.map((input) => input.type),
    ["uint64", "bytes32"],
  );
  assert.deepEqual(
    rejectFinalized?.inputs.map((input) => input.type),
    ["bytes32", "bytes32"],
  );
  assert.deepEqual(
    rejectProposed?.inputs.map((input) => input.type),
    ["bytes32", "bytes32"],
  );
  assert.deepEqual(
    rejectProposedRoot?.inputs.map((input) => input.type),
    ["bytes32", "bytes32"],
  );
  assert.deepEqual(
    rejectFinalizedRoot?.inputs.map((input) => input.type),
    ["bytes32", "bytes32"],
  );
});

test("round voting engine ABI keeps canonical roundCore tuple shape", () => {
  const roundCore = generatedAbis.RoundVotingEngineAbi.find(
    (item) => item.type === "function" && item.name === "roundCore",
  );

  assert.deepEqual(
    roundCore?.outputs.map((output) => [output.name, output.type]),
    [
      ["startTime", "uint48"],
      ["state", "uint8"],
      ["voteCount", "uint16"],
      ["revealedCount", "uint16"],
      ["totalStake", "uint64"],
      ["thresholdReachedAt", "uint48"],
      ["settledAt", "uint48"],
      ["upWins", "uint8"],
    ],
  );
});

test("question reward pool escrow ABI exposes snapshot consumer view", () => {
  const consumerView = generatedAbis.QuestionRewardPoolEscrowAbi.find(
    (item) =>
      item.type === "function" && item.name === "isRoundPayoutSnapshotConsumed",
  );

  assert.deepEqual(
    consumerView?.inputs.map((input) => input.type),
    ["uint8", "uint256", "uint256", "uint256"],
  );
  assert.deepEqual(
    consumerView?.outputs.map((output) => output.type),
    ["bool"],
  );
  assert.equal(consumerView?.stateMutability, "view");
});

test("question reward pool escrow ABI exposes typed lookup errors", () => {
  const errorInputs = new Map(
    generatedAbis.QuestionRewardPoolEscrowAbi.filter(
      (item) =>
        item.type === "error" &&
        ["RewardPoolNotFound", "BundleRewardNotFound"].includes(item.name),
    ).map((item) => [item.name, item.inputs.map((input) => input.type)]),
  );

  assert.deepEqual(errorInputs.get("RewardPoolNotFound"), ["uint256"]);
  assert.deepEqual(errorInputs.get("BundleRewardNotFound"), ["uint256"]);
});

test("question reward pool escrow ABI exposes bundle recovery monitoring events", () => {
  const bundleEvents = new Map(
    generatedAbis.QuestionRewardPoolEscrowAbi.filter(
      (item) =>
        item.type === "event" &&
        [
          "RejectedSnapshotBundleRoundSetRecovered",
          "RecoveredSnapshotBundleRoundSetReopened",
          "QuestionBundleTerminalSkipped",
        ].includes(item.name),
    ).map((item) => [item.name, item.inputs.map((input) => input.type)]),
  );

  assert.deepEqual(bundleEvents.get("RejectedSnapshotBundleRoundSetRecovered"), [
    "uint256",
    "uint256",
    "uint256",
  ]);
  assert.deepEqual(bundleEvents.get("RecoveredSnapshotBundleRoundSetReopened"), [
    "uint256",
    "uint256",
    "bytes32",
  ]);
  assert.deepEqual(bundleEvents.get("QuestionBundleTerminalSkipped"), [
    "uint256",
    "uint256",
    "uint256",
    "uint8",
  ]);
});

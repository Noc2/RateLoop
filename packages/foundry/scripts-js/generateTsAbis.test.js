import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  assertFreshTargetDeployment,
  assertSharedDeploymentArtifactsSynced,
  filterGeneratedContractsForDeployTarget,
  parseTransactionAndReceiptRun,
  processAllDeployments,
} from "./generateTsAbis.js";

const ORIGINAL_DEPLOY_TARGET_NETWORK = process.env.DEPLOY_TARGET_NETWORK;

afterEach(() => {
  if (ORIGINAL_DEPLOY_TARGET_NETWORK === undefined) {
    delete process.env.DEPLOY_TARGET_NETWORK;
  } else {
    process.env.DEPLOY_TARGET_NETWORK = ORIGINAL_DEPLOY_TARGET_NETWORK;
  }
});

const REQUIRED_WORLD_CHAIN_EXPORT = {
  "0x0000000000000000000000000000000000000001": "TimelockController",
  "0x0000000000000000000000000000000000000002": "RateLoopGovernor",
  "0x0000000000000000000000000000000000000003": "LoopReputation",
  "0x0000000000000000000000000000000000000004": "FrontendRegistry",
  "0x0000000000000000000000000000000000000005": "ProfileRegistry",
  "0x0000000000000000000000000000000000000006": "ContentRegistry",
  "0x0000000000000000000000000000000000000007": "RoundVotingEngine",
  "0x0000000000000000000000000000000000000008": "ProtocolConfig",
  "0x0000000000000000000000000000000000000009": "RoundRewardDistributor",
  "0x000000000000000000000000000000000000000a": "QuestionRewardPoolEscrow",
  "0x000000000000000000000000000000000000000b": "X402QuestionSubmitter",
  "0x000000000000000000000000000000000000000c": "FeedbackBonusEscrow",
  "0x000000000000000000000000000000000000000d": "CategoryRegistry",
  "0x000000000000000000000000000000000000000e": "RaterRegistry",
  "0x000000000000000000000000000000000000000f": "ClusterPayoutOracle",
  "0x0000000000000000000000000000000000000010": "LaunchDistributionPool",
  "0x0000000000000000000000000000000000000011": "AdvisoryVoteRecorder",
  "0x0000000000000000000000000000000000000012": "FrontendRegistryProxyAdmin",
  "0x0000000000000000000000000000000000000013": "ProfileRegistryProxyAdmin",
  "0x0000000000000000000000000000000000000014": "ContentRegistryProxyAdmin",
  "0x0000000000000000000000000000000000000015": "RoundVotingEngineProxyAdmin",
  "0x0000000000000000000000000000000000000016": "ProtocolConfigProxyAdmin",
  "0x0000000000000000000000000000000000000017": "RoundRewardDistributorProxyAdmin",
  "0x0000000000000000000000000000000000000018": "QuestionRewardPoolEscrowProxyAdmin",
  "0x0000000000000000000000000000000000000019": "FeedbackRegistryProxyAdmin",
  "0x000000000000000000000000000000000000001a": "FeedbackBonusEscrowProxyAdmin",
  "0x000000000000000000000000000000000000001b": "RaterRegistryProxyAdmin",
  deploymentBlockNumber: "200",
  deploymentComplete: "true",
  networkName: "worldchain",
};

test("parseTransactionAndReceiptRun skips malformed broadcast JSON with an empty run shape", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "rateloop-broadcast-"));
  try {
    const filePath = join(tempDir, "run-1.json");
    writeFileSync(filePath, "{");

    assert.deepEqual(parseTransactionAndReceiptRun(filePath), {
      transactions: [],
      receipts: [],
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("processAllDeployments tracks proxy addresses for latest broadcast freshness", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "rateloop-broadcast-"));
  try {
    const chainDir = join(tempDir, "Deploy.s.sol", "4801");
    mkdirSync(chainDir, { recursive: true });
    writeFileSync(
      join(chainDir, "run-1.json"),
      JSON.stringify({
        transactions: [
          {
            transactionType: "CREATE",
            contractName: "TransparentUpgradeableProxy",
            contractAddress: "0x0000000000000000000000000000000000000004",
            hash: "0xproxy",
          },
        ],
        receipts: [{ transactionHash: "0xproxy", blockNumber: "0x65" }],
      })
    );

    const { latestBroadcastDeploymentAddresses } =
      processAllDeployments(tempDir);

    assert.equal(
      latestBroadcastDeploymentAddresses[4801].has(
        "0x0000000000000000000000000000000000000004"
      ),
      true
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("assertFreshTargetDeployment", () => {
  test("rejects raw target-chain broadcast data without a deployment export", () => {
    process.env.DEPLOY_TARGET_NETWORK = "worldchain";

    assert.throws(
      () =>
        assertFreshTargetDeployment(
          { 480: { ContentRegistry: { address: "0ximplementation" } } },
          {},
          {},
          { 480: 200 }
        ),
      /not marked complete/
    );
  });

  test("rejects incomplete non-local deployment exports", () => {
    process.env.DEPLOY_TARGET_NETWORK = "worldchain";

    assert.throws(
      () =>
        assertFreshTargetDeployment(
          {},
          {},
          {
            480: {
              "0x0000000000000000000000000000000000000001": "ContentRegistry",
              deploymentBlockNumber: "200",
              deploymentComplete: "true",
              networkName: "worldchain",
            },
          },
          { 480: 200 }
        ),
      /missing required contracts/
    );
  });

  test("rejects proxy-backed deployment exports without proxy admins", () => {
    process.env.DEPLOY_TARGET_NETWORK = "worldchain";
    const { "0x000000000000000000000000000000000000001b": _proxyAdmin, ...deploymentExport } =
      REQUIRED_WORLD_CHAIN_EXPORT;

    assert.throws(
      () =>
        assertFreshTargetDeployment(
          {},
          {},
          { 480: deploymentExport },
          { 480: 200 }
        ),
      /missing proxy admin entries: RaterRegistryProxyAdmin/
    );
  });

  test("rejects proxy-backed deployment exports that point at implementation creates", () => {
    process.env.DEPLOY_TARGET_NETWORK = "worldchain";

    assert.throws(
      () =>
        assertFreshTargetDeployment(
          {},
          {},
          { 480: REQUIRED_WORLD_CHAIN_EXPORT },
          { 480: 200 },
          {},
          {
            480: new Map([
              [
                "0x000000000000000000000000000000000000000e",
                "RaterRegistry",
              ],
            ]),
          }
        ),
      /maps proxy-backed contracts to implementation CREATE addresses: RaterRegistry/
    );
  });

  test("rejects deployment exports older than the latest broadcast deployment", () => {
    process.env.DEPLOY_TARGET_NETWORK = "worldchain";

    assert.throws(
      () =>
        assertFreshTargetDeployment(
          {},
          {},
          { 480: REQUIRED_WORLD_CHAIN_EXPORT },
          { 480: 201 }
        ),
      /older than the latest broadcast deployment/
    );
  });

  test("accepts older complete export when required addresses match latest broadcast", () => {
    process.env.DEPLOY_TARGET_NETWORK = "worldchain";

    assert.doesNotThrow(() =>
      assertFreshTargetDeployment(
        {},
        {},
        { 480: REQUIRED_WORLD_CHAIN_EXPORT },
        { 480: 201 },
        {
          480: new Set(
            Object.entries(REQUIRED_WORLD_CHAIN_EXPORT)
              .filter(([address]) => address.startsWith("0x"))
              .map(([address]) => address.toLowerCase())
          ),
        }
      )
    );
  });

  test("accepts complete non-local deployment exports at the latest broadcast block", () => {
    process.env.DEPLOY_TARGET_NETWORK = "worldchain";

    assert.doesNotThrow(() =>
      assertFreshTargetDeployment(
        {},
        {},
        { 480: REQUIRED_WORLD_CHAIN_EXPORT },
        { 480: 200 }
      )
    );
  });

  test("rejects direct non-local broadcast data without a complete deployment export", () => {
    delete process.env.DEPLOY_TARGET_NETWORK;

    assert.throws(
      () =>
        assertFreshTargetDeployment(
          { 480: { ContentRegistry: { address: "0ximplementation" } } },
          {},
          {},
          { 480: 200 }
        ),
      /chainId 480 is not marked complete/
    );
  });

  test("rejects preserved non-local contracts without a complete deployment export", () => {
    delete process.env.DEPLOY_TARGET_NETWORK;

    assert.throws(
      () =>
        assertFreshTargetDeployment(
          {},
          { 480: { ContentRegistry: { address: "0xstale" } } },
          {},
          {}
        ),
      /chainId 480 is not marked complete/
    );
  });

  test("accepts direct non-local broadcast data with a complete deployment export", () => {
    delete process.env.DEPLOY_TARGET_NETWORK;

    assert.doesNotThrow(() =>
      assertFreshTargetDeployment(
        { 480: { ContentRegistry: { address: "0xproxy" } } },
        {},
        { 480: REQUIRED_WORLD_CHAIN_EXPORT },
        { 480: 200 }
      )
    );
  });

  test("allows direct local broadcast data without a deployment export", () => {
    delete process.env.DEPLOY_TARGET_NETWORK;

    assert.doesNotThrow(() =>
      assertFreshTargetDeployment(
        { 31337: { ContentRegistry: { address: "0xlocal" } } },
        {},
        {},
        { 31337: 200 }
      )
    );
  });
});

describe("filterGeneratedContractsForDeployTarget", () => {
  test("publishes only the selected target chain during targeted redeploys", () => {
    process.env.DEPLOY_TARGET_NETWORK = "worldchain";

    assert.deepEqual(
      filterGeneratedContractsForDeployTarget({
        31337: { ContentRegistry: { address: "0xlocal" } },
        480: { ContentRegistry: { address: "0xworldchain" } },
        4801: { ContentRegistry: { address: "0xstaleSepolia" } },
      }),
      {
        480: { ContentRegistry: { address: "0xworldchain" } },
      }
    );
  });

  test("publishes all generated contracts for direct ABI generation", () => {
    delete process.env.DEPLOY_TARGET_NETWORK;
    const generatedContracts = {
      31337: { ContentRegistry: { address: "0xlocal" } },
      480: { ContentRegistry: { address: "0xworldchain" } },
    };

    assert.deepEqual(
      filterGeneratedContractsForDeployTarget(generatedContracts),
      generatedContracts
    );
  });
});

describe("assertSharedDeploymentArtifactsSynced", () => {
  test("rejects shared artifacts that disagree with deployment exports", () => {
    process.env.DEPLOY_TARGET_NETWORK = "localhost";

    assert.throws(
      () =>
        assertSharedDeploymentArtifactsSynced(
          {
            31337: {
              LaunchDistributionPool: {
                address: "0x0000000000000000000000000000000000000001",
              },
            },
          },
          {
            31337: {
              "0x0000000000000000000000000000000000000002":
                "LaunchDistributionPool",
              deploymentComplete: "true",
            },
          },
          { hasArtifact: () => true }
        ),
      /LaunchDistributionPool: shared 0x0000000000000000000000000000000000000001, deployment 0x0000000000000000000000000000000000000002/
    );
  });

  test("accepts shared artifacts that match deployment exports", () => {
    process.env.DEPLOY_TARGET_NETWORK = "localhost";

    assert.doesNotThrow(() =>
      assertSharedDeploymentArtifactsSynced(
        {
          31337: {
            LaunchDistributionPool: {
              address: "0x0000000000000000000000000000000000000002",
            },
          },
        },
        {
          31337: {
            "0x0000000000000000000000000000000000000002":
              "LaunchDistributionPool",
            deploymentComplete: "true",
          },
        },
        { hasArtifact: () => true }
      )
    );
  });
});

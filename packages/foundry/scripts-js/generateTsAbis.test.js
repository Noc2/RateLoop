import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  addAdditiveDeploymentExports,
  assertFreshTargetDeployment,
  assertSharedDeploymentArtifactsSynced,
  filterGeneratedContractsForDeployTarget,
  parseTransactionAndReceiptRun,
  processAllDeployments,
  pruneNonLocalGeneratedContractsToDeploymentExports,
} from "./generateTsAbis.js";

const ORIGINAL_DEPLOY_TARGET_NETWORK = process.env.DEPLOY_TARGET_NETWORK;

afterEach(() => {
  if (ORIGINAL_DEPLOY_TARGET_NETWORK === undefined) {
    delete process.env.DEPLOY_TARGET_NETWORK;
  } else {
    process.env.DEPLOY_TARGET_NETWORK = ORIGINAL_DEPLOY_TARGET_NETWORK;
  }
});

const REQUIRED_BASE_EXPORT = {
  "0x0000000000000000000000000000000000000001": "TimelockController",
  "0x0000000000000000000000000000000000000002": "RateLoopGovernor",
  "0x0000000000000000000000000000000000000003": "LoopReputation",
  "0x0000000000000000000000000000000000000004": "FrontendRegistry",
  "0x0000000000000000000000000000000000000005": "ProfileRegistry",
  "0x0000000000000000000000000000000000000006": "ContentRegistry",
  "0x0000000000000000000000000000000000000007": "RoundVotingEngine",
  "0x000000000000000000000000000000000000001f":
    "RoundVotingEngineRbtsSettlementModule",
  "0x0000000000000000000000000000000000000008": "ProtocolConfig",
  "0x0000000000000000000000000000000000000009": "RoundRewardDistributor",
  "0x000000000000000000000000000000000000000a": "QuestionRewardPoolEscrow",
  "0x000000000000000000000000000000000000000b": "X402QuestionSubmitter",
  "0x000000000000000000000000000000000000001c": "FeedbackRegistry",
  "0x000000000000000000000000000000000000001d": "ConfidentialityEscrow",
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
  "0x0000000000000000000000000000000000000017":
    "RoundRewardDistributorProxyAdmin",
  "0x0000000000000000000000000000000000000018":
    "QuestionRewardPoolEscrowProxyAdmin",
  "0x0000000000000000000000000000000000000019": "FeedbackRegistryProxyAdmin",
  "0x000000000000000000000000000000000000001a": "FeedbackBonusEscrowProxyAdmin",
  "0x000000000000000000000000000000000000001b": "RaterRegistryProxyAdmin",
  "0x000000000000000000000000000000000000001e":
    "ConfidentialityEscrowProxyAdmin",
  deploymentBlockNumber: "200",
  deploymentComplete: "true",
  networkName: "base",
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
    const chainDir = join(tempDir, "Deploy.s.sol", "8453");
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
      latestBroadcastDeploymentAddresses[8453].has(
        "0x0000000000000000000000000000000000000004"
      ),
      true
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("addAdditiveDeploymentExports", () => {
  const issuerAddress = "0x00000000000000000000000000000000000000aa";
  const artifact = { abi: [{ type: "function", name: "issue" }] };
  const options = {
    artifactLoader: () => artifact,
    inheritedFunctionsLoader: () => ({ hasRole: "AccessControl.sol" }),
  };

  test("preserves existing contracts before an issuer address exists", () => {
    const existing = { 8453: { RaterRegistry: { address: "0xregistry" } } };
    assert.deepEqual(
      addAdditiveDeploymentExports(
        existing,
        { 8453: REQUIRED_BASE_EXPORT },
        options
      ),
      existing
    );
  });

  test("adds a receipt-backed issuer to ABI-only deployment output", () => {
    const result = addAdditiveDeploymentExports(
      {},
      {
        8453: {
          [issuerAddress]: "WorldIdV4BackendIssuer",
          worldIdV4BackendIssuerRollout: { activationBlockNumber: 321 },
        },
      },
      options
    );

    assert.deepEqual(result[8453].WorldIdV4BackendIssuer, {
      address: issuerAddress,
      abi: artifact.abi,
      inheritedFunctions: { hasRole: "AccessControl.sol" },
      deployedOnBlock: 321,
    });
  });

  test("rejects an issuer address without complete rollout metadata", () => {
    assert.throws(
      () =>
        addAdditiveDeploymentExports(
          {},
          { 8453: { [issuerAddress]: "WorldIdV4BackendIssuer" } },
          options
        ),
      /requires complete World ID v4 backend issuer rollout metadata/
    );
  });
});

describe("assertFreshTargetDeployment", () => {
  test("rejects raw target-chain broadcast data without a deployment export", () => {
    process.env.DEPLOY_TARGET_NETWORK = "base";

    assert.throws(
      () =>
        assertFreshTargetDeployment(
          { 8453: { ContentRegistry: { address: "0ximplementation" } } },
          {},
          {},
          { 8453: 200 }
        ),
      /not marked complete/
    );
  });

  test("rejects incomplete non-local deployment exports", () => {
    process.env.DEPLOY_TARGET_NETWORK = "base";

    assert.throws(
      () =>
        assertFreshTargetDeployment(
          {},
          {},
          {
            8453: {
              "0x0000000000000000000000000000000000000001": "ContentRegistry",
              deploymentBlockNumber: "200",
              deploymentComplete: "true",
              networkName: "base",
            },
          },
          { 8453: 200 }
        ),
      /missing required contracts/
    );
  });

  test("rejects complete exports missing FeedbackRegistry", () => {
    process.env.DEPLOY_TARGET_NETWORK = "base";
    const {
      "0x000000000000000000000000000000000000001c": _feedbackRegistry,
      ...deploymentExport
    } = REQUIRED_BASE_EXPORT;

    assert.throws(
      () =>
        assertFreshTargetDeployment(
          {},
          {},
          { 8453: deploymentExport },
          { 8453: 200 }
        ),
      /missing required contracts: FeedbackRegistry/
    );
  });

  test("rejects complete exports missing ConfidentialityEscrow", () => {
    process.env.DEPLOY_TARGET_NETWORK = "base";
    const {
      "0x000000000000000000000000000000000000001d": _confidentialityEscrow,
      ...deploymentExport
    } = REQUIRED_BASE_EXPORT;

    assert.throws(
      () =>
        assertFreshTargetDeployment(
          {},
          {},
          { 8453: deploymentExport },
          { 8453: 200 }
        ),
      /missing required contracts: ConfidentialityEscrow/
    );
  });

  test("rejects proxy-backed deployment exports without proxy admins", () => {
    process.env.DEPLOY_TARGET_NETWORK = "base";
    const {
      "0x000000000000000000000000000000000000001b": _proxyAdmin,
      ...deploymentExport
    } = REQUIRED_BASE_EXPORT;

    assert.throws(
      () =>
        assertFreshTargetDeployment(
          {},
          {},
          { 8453: deploymentExport },
          { 8453: 200 }
        ),
      /missing proxy admin entries: RaterRegistryProxyAdmin/
    );
  });

  test("rejects ConfidentialityEscrow exports without proxy admins", () => {
    process.env.DEPLOY_TARGET_NETWORK = "base";
    const {
      "0x000000000000000000000000000000000000001e": _proxyAdmin,
      ...deploymentExport
    } = REQUIRED_BASE_EXPORT;

    assert.throws(
      () =>
        assertFreshTargetDeployment(
          {},
          {},
          { 8453: deploymentExport },
          { 8453: 200 }
        ),
      /missing proxy admin entries: ConfidentialityEscrowProxyAdmin/
    );
  });

  test("rejects proxy-backed deployment exports that point at implementation creates", () => {
    process.env.DEPLOY_TARGET_NETWORK = "base";

    assert.throws(
      () =>
        assertFreshTargetDeployment(
          {},
          {},
          { 8453: REQUIRED_BASE_EXPORT },
          { 8453: 200 },
          {},
          {
            8453: new Map([
              ["0x000000000000000000000000000000000000000e", "RaterRegistry"],
            ]),
          }
        ),
      /maps proxy-backed contracts to implementation CREATE addresses: RaterRegistry/
    );
  });

  test("accepts direct RoundVotingEngineRbtsSettlementModule exports", () => {
    process.env.DEPLOY_TARGET_NETWORK = "base";

    assert.doesNotThrow(() =>
      assertFreshTargetDeployment(
        {},
        {},
        { 8453: REQUIRED_BASE_EXPORT },
        { 8453: 200 },
        {},
        {
          8453: new Map([
            [
              "0x000000000000000000000000000000000000001f",
              "RoundVotingEngineRbtsSettlementModule",
            ],
          ]),
        }
      )
    );
  });

  test("rejects ConfidentialityEscrow exports that point at implementation creates", () => {
    process.env.DEPLOY_TARGET_NETWORK = "base";

    assert.throws(
      () =>
        assertFreshTargetDeployment(
          {},
          {},
          { 8453: REQUIRED_BASE_EXPORT },
          { 8453: 200 },
          {},
          {
            8453: new Map([
              [
                "0x000000000000000000000000000000000000001d",
                "ConfidentialityEscrow",
              ],
            ]),
          }
        ),
      /maps proxy-backed contracts to implementation CREATE addresses: ConfidentialityEscrow/
    );
  });

  test("rejects deployment exports older than the latest broadcast deployment", () => {
    process.env.DEPLOY_TARGET_NETWORK = "base";

    assert.throws(
      () =>
        assertFreshTargetDeployment(
          {},
          {},
          { 8453: REQUIRED_BASE_EXPORT },
          { 8453: 201 }
        ),
      /older than the latest broadcast deployment/
    );
  });

  test("accepts older complete export when required addresses match latest broadcast", () => {
    process.env.DEPLOY_TARGET_NETWORK = "base";

    assert.doesNotThrow(() =>
      assertFreshTargetDeployment(
        {},
        {},
        { 8453: REQUIRED_BASE_EXPORT },
        { 8453: 201 },
        {
          8453: new Set(
            Object.entries(REQUIRED_BASE_EXPORT)
              .filter(([address]) => address.startsWith("0x"))
              .map(([address]) => address.toLowerCase())
          ),
        }
      )
    );
  });

  test("accepts complete non-local deployment exports at the latest broadcast block", () => {
    process.env.DEPLOY_TARGET_NETWORK = "base";

    assert.doesNotThrow(() =>
      assertFreshTargetDeployment(
        {},
        {},
        { 8453: REQUIRED_BASE_EXPORT },
        { 8453: 200 }
      )
    );
  });

  test("rejects direct non-local broadcast data without a complete deployment export", () => {
    delete process.env.DEPLOY_TARGET_NETWORK;

    assert.throws(
      () =>
        assertFreshTargetDeployment(
          { 8453: { ContentRegistry: { address: "0ximplementation" } } },
          {},
          {},
          { 8453: 200 }
        ),
      /chainId 8453 is not marked complete/
    );
  });

  test("rejects preserved non-local contracts without a complete deployment export", () => {
    delete process.env.DEPLOY_TARGET_NETWORK;

    assert.throws(
      () =>
        assertFreshTargetDeployment(
          {},
          { 8453: { ContentRegistry: { address: "0xstale" } } },
          {},
          {}
        ),
      /chainId 8453 is not marked complete/
    );
  });

  test("accepts direct non-local broadcast data with a complete deployment export", () => {
    delete process.env.DEPLOY_TARGET_NETWORK;

    assert.doesNotThrow(() =>
      assertFreshTargetDeployment(
        { 8453: { ContentRegistry: { address: "0xproxy" } } },
        {},
        { 8453: REQUIRED_BASE_EXPORT },
        { 8453: 200 }
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
    process.env.DEPLOY_TARGET_NETWORK = "base";

    assert.deepEqual(
      filterGeneratedContractsForDeployTarget({
        31337: { ContentRegistry: { address: "0xlocal" } },
        8453: { ContentRegistry: { address: "0xbase" } },
      }),
      {
        8453: { ContentRegistry: { address: "0xbase" } },
      }
    );
  });

  test("publishes all generated contracts for direct ABI generation", () => {
    delete process.env.DEPLOY_TARGET_NETWORK;
    const generatedContracts = {
      31337: { ContentRegistry: { address: "0xlocal" } },
      8453: { ContentRegistry: { address: "0xbase" } },
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

describe("pruneNonLocalGeneratedContractsToDeploymentExports", () => {
  test("drops stale non-local contracts absent from a completed deployment export", () => {
    const generatedContracts = {
      31337: {
        MockWorldIDRouter: { address: "0xlocal" },
      },
      8453: {
        ContentRegistry: {
          address: "0x0000000000000000000000000000000000000001",
        },
        MockWorldIDRouter: {
          address: "0x0000000000000000000000000000000000000002",
        },
      },
    };

    assert.deepEqual(
      pruneNonLocalGeneratedContractsToDeploymentExports(generatedContracts, {
        8453: {
          "0x0000000000000000000000000000000000000001": "ContentRegistry",
          deploymentComplete: "true",
        },
      }),
      {
        31337: {
          MockWorldIDRouter: { address: "0xlocal" },
        },
        8453: {
          ContentRegistry: {
            address: "0x0000000000000000000000000000000000000001",
          },
        },
      }
    );
  });
});

describe("ContentRegistry ABI exports", () => {
  test("includes repoint and dormancy events required by indexers", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const scriptDir = dirname(fileURLToPath(import.meta.url));
    const abiPath = join(
      scriptDir,
      "..",
      "..",
      "contracts",
      "src",
      "abis",
      "ContentRegistryAbi.ts"
    );
    const source = readFileSync(abiPath, "utf8");
    for (const symbol of [
      "repointPendingRatingClusterPayoutOracle",
      "ContentDormant",
      "ContentRevived",
      "DormantSubmissionKeyReleased",
      "PendingRatingClusterPayoutOracleRepointed",
      "RatingReviewPending",
      "RatingSnapshotApplied",
    ]) {
      assert.match(source, new RegExp(`"name": "${symbol}"`));
    }
  });
});

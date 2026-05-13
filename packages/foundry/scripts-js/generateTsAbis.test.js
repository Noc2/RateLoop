import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import {
  assertFreshTargetDeployment,
  filterGeneratedContractsForDeployTarget,
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
  "0x0000000000000000000000000000000000000002": "CuryoGovernor",
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
  "0x000000000000000000000000000000000000000f": "LaunchDistributionPool",
  "0x0000000000000000000000000000000000000010": "VoterIdNFT",
  "0x0000000000000000000000000000000000000011": "ParticipationPool",
  deploymentBlockNumber: "200",
  deploymentComplete: "true",
  networkName: "worldchain",
};

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

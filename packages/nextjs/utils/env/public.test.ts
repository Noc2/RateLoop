import { listMissingRequiredTargetContracts } from "./requiredDeployments";
import deployedContracts from "@rateloop/contracts/deployedContracts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function deployment(index: number) {
  return { address: `0x${index.toString(16).padStart(40, "0")}` };
}

test("browser-facing public env modules avoid computed process.env access", () => {
  const browserEnvModules = [
    new URL("./public.ts", import.meta.url),
    new URL("../../services/ponder/client.ts", import.meta.url),
  ];

  for (const moduleUrl of browserEnvModules) {
    const source = readFileSync(moduleUrl, "utf8");

    assert.doesNotMatch(
      source,
      /process\.env\[[^\]]+\]/,
      `${moduleUrl.pathname} should use static process.env access so Next can inline NEXT_PUBLIC variables`,
    );
  }
});

test("required deployment helper reports missing contract definitions per target chain", () => {
  const missingContracts = listMissingRequiredTargetContracts(
    [31337, 8453],
    {
      31337: {
        ContentRegistry: deployment(1),
        HumanReputation: deployment(2),
        ProtocolConfig: deployment(3),
      },
      8453: {
        ContentRegistry: deployment(4),
        ProtocolConfig: deployment(5),
      },
    },
    ["ContentRegistry", "LoopReputation"],
  );

  assert.deepEqual(missingContracts, ["31337:LoopReputation", "8453:LoopReputation"]);
});

test("default required deployment list fails closed for core app contracts", () => {
  const missingContracts = listMissingRequiredTargetContracts([8453], {
    8453: {
      CategoryRegistry: deployment(1),
      ContentRegistry: deployment(2),
      FrontendRegistry: deployment(3),
      LaunchDistributionPool: deployment(4),
      ProfileRegistry: deployment(5),
      ProtocolConfig: deployment(6),
      RaterRegistry: deployment(7),
      RoundRewardDistributor: deployment(8),
      RoundVotingEngine: deployment(9),
    },
  });

  assert.deepEqual(missingContracts, [
    "8453:LoopReputation",
    "8453:AdvisoryVoteRecorder",
    "8453:QuestionRewardPoolEscrow",
    "8453:FeedbackBonusEscrow",
    "8453:FeedbackRegistry",
    "8453:ConfidentialityEscrow",
    "8453:ClusterPayoutOracle",
    "8453:X402QuestionSubmitter",
  ]);
});

test("required deployment helper treats malformed contract entries as missing", () => {
  const missingContracts = listMissingRequiredTargetContracts(
    [8453],
    {
      8453: {
        ContentRegistry: {},
        FrontendRegistry: { address: "not-an-address" },
        LoopReputation: { address: "0x0000000000000000000000000000000000000000" },
      },
    },
    ["ContentRegistry", "FrontendRegistry", "LoopReputation"],
  );

  assert.deepEqual(missingContracts, ["8453:ContentRegistry", "8453:FrontendRegistry", "8453:LoopReputation"]);
});

test("local and Base mainnet deployment metadata includes production-required contracts", () => {
  const missingContracts = listMissingRequiredTargetContracts([31337, 8453], deployedContracts);

  assert.deepEqual(missingContracts, []);
});

test("public env source no longer exposes an undeployed-network bypass", () => {
  const publicEnvSource = readFileSync(new URL("./public.ts", import.meta.url), "utf8");
  const exampleEnvSource = readFileSync(new URL("../../.env.example", import.meta.url), "utf8");
  const readmeSource = readFileSync(new URL("../../README.md", import.meta.url), "utf8");

  for (const source of [publicEnvSource, exampleEnvSource, readmeSource]) {
    assert.doesNotMatch(source, /NEXT_PUBLIC_ALLOW_UNDEPLOYED_TARGET_NETWORKS/);
  }
});

test("public env production metadata guidance avoids routine Base mainnet redeploys", () => {
  const publicEnvSource = readFileSync(new URL("./public.ts", import.meta.url), "utf8");

  assert.match(publicEnvSource, /restore the existing production deployment metadata\/contracts package/);
  assert.match(publicEnvSource, /yarn base-mainnet:check/);
  assert.doesNotMatch(publicEnvSource, /Run yarn deploy for those chains before enabling them/);
});

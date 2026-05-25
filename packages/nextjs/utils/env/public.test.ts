import { listMissingRequiredTargetContracts } from "./requiredDeployments";
import deployedContracts from "@rateloop/contracts/deployedContracts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

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
    [31337, 480],
    {
      31337: {
        ContentRegistry: {},
        HumanReputation: {},
        ProtocolConfig: {},
      },
      480: {
        ContentRegistry: {},
        ProtocolConfig: {},
      },
    },
    ["ContentRegistry", "LoopReputation"],
  );

  assert.deepEqual(missingContracts, ["31337:LoopReputation", "480:LoopReputation"]);
});

test("default required deployment list fails closed for core app contracts", () => {
  const missingContracts = listMissingRequiredTargetContracts([480], {
    480: {
      CategoryRegistry: {},
      ContentRegistry: {},
      FrontendRegistry: {},
      LaunchDistributionPool: {},
      ProfileRegistry: {},
      ProtocolConfig: {},
      RaterRegistry: {},
      RoundRewardDistributor: {},
      RoundVotingEngine: {},
    },
  });

  assert.deepEqual(missingContracts, [
    "480:LoopReputation",
    "480:AdvisoryVoteRecorder",
    "480:QuestionRewardPoolEscrow",
    "480:ClusterPayoutOracle",
    "480:X402QuestionSubmitter",
  ]);
});

test("World Chain Sepolia deployment metadata includes production-required contracts", () => {
  const missingContracts = listMissingRequiredTargetContracts([4801], deployedContracts);

  assert.deepEqual(missingContracts, []);
});

test("production env defaults do not bypass deployment metadata checks", () => {
  const source = readFileSync(new URL("../../.env.production", import.meta.url), "utf8");

  assert.doesNotMatch(source, /^NEXT_PUBLIC_ALLOW_UNDEPLOYED_TARGET_NETWORKS=true$/m);
});

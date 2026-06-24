import {
  PREPARING_ROUND_VOTE_MESSAGE,
  type PostOpenPredictableRuntime,
  ensureOpenStakedRoundRuntime,
  predictPostOpenRoundRuntime,
  preflightRoundVoteBatchCalls,
} from "./openStakedRoundRuntime";
import type { RoundVoteContractCall } from "./roundVoteTransactionPlan";
import { LoopReputationAbi, RoundVotingEngineAbi } from "@rateloop/contracts/abis";
import assert from "node:assert/strict";
import test from "node:test";

test("ensureOpenStakedRoundRuntime returns an already-open runtime without opening a round", async () => {
  let openCalls = 0;
  const runtime = await ensureOpenStakedRoundRuntime({
    openRound: async () => {
      openCalls++;
    },
    resolveRuntime: async () => ({
      requiresOpenRound: false,
      roundId: 7n,
    }),
  });

  assert.equal(openCalls, 0);
  assert.equal(runtime.roundId, 7n);
});

test("ensureOpenStakedRoundRuntime waits for the opened round to become observable", async () => {
  let openCalls = 0;
  let resolveCalls = 0;
  const waits: number[] = [];

  const runtime = await ensureOpenStakedRoundRuntime({
    openRound: async () => {
      openCalls++;
    },
    resolveRuntime: async () => {
      resolveCalls++;
      return {
        requiresOpenRound: resolveCalls < 4,
        roundId: resolveCalls < 4 ? 8n : 9n,
      };
    },
    retryDelaysMs: [10, 20],
    wait: async delayMs => {
      waits.push(delayMs);
    },
  });

  assert.equal(openCalls, 1);
  assert.equal(resolveCalls, 4);
  assert.deepEqual(waits, [10, 20]);
  assert.equal(runtime.requiresOpenRound, false);
  assert.equal(runtime.roundId, 9n);
});

test("ensureOpenStakedRoundRuntime throws a user-facing preparation message after bounded retries", async () => {
  let openCalls = 0;

  await assert.rejects(
    () =>
      ensureOpenStakedRoundRuntime({
        openRound: async () => {
          openCalls++;
        },
        resolveRuntime: async () => ({
          requiresOpenRound: true,
        }),
        retryDelaysMs: [10],
        wait: async () => {},
      }),
    new RegExp(PREPARING_ROUND_VOTE_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"),
  );

  assert.equal(openCalls, 1);
});

test("ensureOpenStakedRoundRuntime can fall back to the preview runtime after opening a round", async () => {
  type TestRuntime = {
    requiresOpenRound: boolean;
    roundId: bigint;
  };
  const runtime = await ensureOpenStakedRoundRuntime<TestRuntime>({
    buildOpenedRuntimeFallback: pendingRuntime => ({
      ...pendingRuntime,
      requiresOpenRound: false,
    }),
    openRound: async () => {},
    resolveRuntime: async () => ({
      requiresOpenRound: true,
      roundId: 10n,
    }),
    retryDelaysMs: [10],
    wait: async () => {},
  });

  assert.equal(runtime.requiresOpenRound, false);
  assert.equal(runtime.roundId, 10n);
});

test("predictPostOpenRoundRuntime anchors tlock timing to latest block timestamp plus one", () => {
  const runtime = predictPostOpenRoundRuntime({
    latestBlockTimestampSeconds: 1_700_000_000,
    runtime: {
      baseTotalStake: 100n,
      baseVoteCount: 2n,
      drandChainHash: "0x52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
      drandGenesisTimeSeconds: 1_692_803_367n,
      drandPeriodSeconds: 3n,
      epochDuration: 1_200,
      now: () => 0,
      requiresOpenRound: true,
      roundId: 8n,
      roundReferenceRatingBps: 5_000,
      roundStartTimeSeconds: null,
    } satisfies PostOpenPredictableRuntime,
  });

  assert.equal(runtime.requiresOpenRound, false);
  assert.equal(runtime.roundStartTimeSeconds, 1_700_000_001);
  assert.equal(runtime.baseTotalStake, 0n);
  assert.equal(runtime.baseVoteCount, 0n);
  assert.equal(runtime.now(), 1_700_000_002_000);
  assert.equal((runtime as PostOpenPredictableRuntime).targetRound, 2_399_279n);
});

test("preflightRoundVoteBatchCalls falls back to per-call simulation when atomic simulation is unavailable", async () => {
  const simulatedKinds: string[] = [];
  const calls: RoundVoteContractCall[] = [
    {
      abi: RoundVotingEngineAbi as never,
      address: "0x0000000000000000000000000000000000000002",
      args: [42n],
      functionName: "openRound",
      kind: "openRound",
    },
    {
      abi: LoopReputationAbi as never,
      address: "0x0000000000000000000000000000000000000001",
      args: ["0x0000000000000000000000000000000000000002", 10n],
      functionName: "approve",
      kind: "approve",
    },
  ];

  const passed = await preflightRoundVoteBatchCalls({
    account: "0x0000000000000000000000000000000000000005",
    calls,
    publicClient: {} as never,
    simulatePlannedCall: async call => {
      simulatedKinds.push(call.kind);
    },
  });

  assert.equal(passed, true);
  assert.deepEqual(simulatedKinds, ["openRound", "approve"]);
});

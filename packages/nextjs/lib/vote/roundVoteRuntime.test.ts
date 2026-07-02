import { resolveRoundVoteRuntime } from "./roundVoteRuntime";
import assert from "node:assert/strict";
import test from "node:test";

const TEST_DRAND_CONFIG = [
  "0x52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
  1_692_803_367n,
  3n,
] as const;

test("resolveRoundVoteRuntime anchors tlock timing to the pending block timestamp", async () => {
  const readCalls: Array<Record<string, unknown>> = [];
  const blockCalls: Array<Record<string, unknown>> = [];
  const publicClient = {
    getBlock: async (args: Record<string, unknown>) => {
      blockCalls.push(args);
      return args.blockTag === "pending"
        ? {
            number: 124n,
            timestamp: 1_099n,
          }
        : {
            number: 123n,
            timestamp: 1_000n,
          };
    },
    readContract: async (args: Record<string, unknown>) => {
      readCalls.push(args);

      if (args.functionName === "previewCommitContext") {
        return [2n, 5_000] as const;
      }

      if (args.functionName === "roundConfigSnapshot") {
        return [100, 3_600, 3, 1_000];
      }

      if (args.functionName === "advisoryRoundContext") {
        return [5_000, 0n, ...TEST_DRAND_CONFIG, false, "0x0000000000000000000000000000000000000000"] as const;
      }

      return [900n, 0, 0n, 0n, 0n, 0n, 0n, 0];
    },
  };

  const runtime = await resolveRoundVoteRuntime({
    publicClient: publicClient as never,
    votingEngineAddress: "0x0000000000000000000000000000000000000001",
    contentId: 7n,
    fallbackEpochDuration: 1200,
  });

  assert.deepEqual(
    blockCalls.map(call => call.blockTag),
    ["latest", "pending"],
  );
  assert.equal(readCalls.length, 4);
  for (const call of readCalls) {
    assert.equal(call.blockTag, "pending");
  }
  assert.equal(runtime.now(), 1_101_000);
  assert.equal(runtime.epochDuration, 100);
  assert.equal(runtime.requiresOpenRound, false);
  assert.equal(runtime.roundStartTimeSeconds, 900);
  assert.equal(runtime.roundId, 2n);
  assert.equal(runtime.roundReferenceRatingBps, 5_000);
  assert.equal(runtime.drandChainHash, TEST_DRAND_CONFIG[0]);
  assert.equal(runtime.drandGenesisTimeSeconds, TEST_DRAND_CONFIG[1]);
  assert.equal(runtime.drandPeriodSeconds, TEST_DRAND_CONFIG[2]);
});

test("resolveRoundVoteRuntime keeps new-round targets fresh when latest is stale", async () => {
  const readCalls: Array<Record<string, unknown>> = [];
  const publicClient = {
    getBlock: async (args: Record<string, unknown>) =>
      args.blockTag === "pending"
        ? {
            number: 124n,
            timestamp: 4_000n,
          }
        : {
            number: 123n,
            timestamp: 1_000n,
          },
    readContract: async (args: Record<string, unknown>) => {
      readCalls.push(args);

      if (args.functionName === "previewCommitContext") {
        return [3n, 5_000] as const;
      }

      if (args.functionName === "roundConfigSnapshot") {
        return [100, 3_600, 3, 1_000];
      }

      if (args.functionName === "advisoryRoundContext") {
        return [5_000, 0n, ...TEST_DRAND_CONFIG, false, "0x0000000000000000000000000000000000000000"] as const;
      }

      return args.blockTag === "pending" ? [4_000n, 0, 0n, 0n, 0n, 0n, 0n, 0] : [0n, 0, 0n, 0n, 0n, 0n, 0n, 0];
    },
  };

  const runtime = await resolveRoundVoteRuntime({
    publicClient: publicClient as never,
    votingEngineAddress: "0x0000000000000000000000000000000000000001",
    contentId: 7n,
    fallbackEpochDuration: 1200,
  });

  assert.equal(readCalls.length, 4);
  for (const call of readCalls) {
    assert.equal(call.blockTag, "pending");
  }
  assert.equal(runtime.now(), 4_001_000);
  assert.equal(runtime.epochDuration, 100);
  assert.equal(runtime.requiresOpenRound, false);
  assert.equal(runtime.roundStartTimeSeconds, 4_000);
  assert.equal(runtime.roundId, 3n);
});

test("resolveRoundVoteRuntime uses current open round when preview points at an unopened slot", async () => {
  const readCalls: Array<Record<string, unknown>> = [];
  const publicClient = {
    getBlock: async (args: Record<string, unknown>) =>
      args.blockTag === "pending"
        ? {
            number: 124n,
            timestamp: 4_000n,
          }
        : {
            number: 123n,
            timestamp: 4_000n,
          },
    readContract: async (args: Record<string, unknown>) => {
      readCalls.push(args);

      if (args.functionName === "previewCommitContext") {
        return [3n, 5_000] as const;
      }

      if (args.functionName === "currentRoundId") {
        return 2n;
      }

      if (args.functionName === "roundConfigSnapshot") {
        return [100, 3_600, 3, 1_000];
      }

      if (args.functionName === "advisoryRoundContext") {
        return [5_000, 0n, ...TEST_DRAND_CONFIG, false, "0x0000000000000000000000000000000000000000"] as const;
      }

      const contractArgs = args.args as unknown[] | undefined;
      return contractArgs?.[1] === 2n ? [4_000n, 0, 0n, 0n, 0n, 0n, 0n, 0] : [0n, 0, 0n, 0n, 0n, 0n, 0n, 0];
    },
  };

  const runtime = await resolveRoundVoteRuntime({
    publicClient: publicClient as never,
    votingEngineAddress: "0x0000000000000000000000000000000000000001",
    contentId: 7n,
    fallbackEpochDuration: 1200,
  });

  assert.equal(
    readCalls.some(call => call.functionName === "currentRoundId"),
    true,
  );
  assert.equal(runtime.requiresOpenRound, false);
  assert.equal(runtime.roundStartTimeSeconds, 4_000);
  assert.equal(runtime.roundId, 2n);
  assert.equal(runtime.roundReferenceRatingBps, 5_000);
});

test("resolveRoundVoteRuntime derives a contract-window target for open rounds", async () => {
  const roundStartTime = TEST_DRAND_CONFIG[1];
  const publicClient = {
    getBlock: async (args: Record<string, unknown>) =>
      args.blockTag === "pending"
        ? {
            number: 124n,
            timestamp: roundStartTime + 181n,
          }
        : {
            number: 123n,
            timestamp: roundStartTime + 180n,
          },
    readContract: async (args: Record<string, unknown>) => {
      if (args.functionName === "previewCommitContext") {
        return [2n, 5_000] as const;
      }

      if (args.functionName === "roundConfigSnapshot") {
        return [3_600, 3_600, 3, 200];
      }

      if (args.functionName === "advisoryRoundContext") {
        return [5_000, 0n, ...TEST_DRAND_CONFIG, false, "0x0000000000000000000000000000000000000000"] as const;
      }

      return [roundStartTime, 0, 0n, 0n, 0n, 0n, 0n, 0];
    },
  };

  const runtime = await resolveRoundVoteRuntime({
    publicClient: publicClient as never,
    votingEngineAddress: "0x0000000000000000000000000000000000000001",
    contentId: 7n,
    fallbackEpochDuration: 1200,
  });

  assert.equal(runtime.requiresOpenRound, false);
  assert.equal(runtime.roundStartTimeSeconds, Number(roundStartTime));
  assert.equal(runtime.targetRound, 1_201n);
});

test("resolveRoundVoteRuntime rejects non-votable preview states", async () => {
  const publicClient = {
    getBlock: async () => ({
      number: 123n,
      timestamp: 1_000n,
    }),
    readContract: async (args: Record<string, unknown>) => {
      if (args.functionName === "previewCommitContext") {
        return [1n, 5_000] as const;
      }

      if (args.functionName === "roundConfigSnapshot") {
        return [100, 3_600, 3, 1_000];
      }

      return [900n, 0, 3n, 3n, 0n, 950n, 0n, 0];
    },
  };

  await assert.rejects(
    () =>
      resolveRoundVoteRuntime({
        publicClient: publicClient as never,
        votingEngineAddress: "0x0000000000000000000000000000000000000001",
        contentId: 7n,
        fallbackEpochDuration: 1200,
      }),
    /RoundNotOpen/u,
  );
});

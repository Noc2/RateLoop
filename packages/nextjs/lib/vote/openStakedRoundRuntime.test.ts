import { PREPARING_ROUND_VOTE_MESSAGE, ensureOpenStakedRoundRuntime } from "./openStakedRoundRuntime";
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

import { FeedbackBonusRoundTargetError, resolveOpenFeedbackBonusRoundTarget } from "./feedbackBonusFunding";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Address } from "viem";

const VOTING_ENGINE = "0x00000000000000000000000000000000000000aa" as Address;

test("resolveOpenFeedbackBonusRoundTarget retries until the submitted round is readable", async () => {
  let currentRoundReads = 0;
  let roundCoreReads = 0;
  const client = {
    getBlock: async () => ({ timestamp: 1_700_000_100n }),
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "currentRoundId") {
        currentRoundReads += 1;
        return currentRoundReads < 3 ? 0n : 9n;
      }
      if (functionName === "roundCore") {
        roundCoreReads += 1;
        return roundCoreReads < 3 ? [0n, 1] : [1_700_000_000n, 0];
      }
      throw new Error(`Unexpected function ${functionName}`);
    },
  };

  const target = await resolveOpenFeedbackBonusRoundTarget({
    client,
    contentId: 123n,
    durationSeconds: 600n,
    retryDelayMs: 0,
    votingEngineAddress: VOTING_ENGINE,
  });

  assert.equal(target.roundId, 9n);
  assert.equal(target.feedbackClosesAt, 1_700_000_600n);
  assert.equal(currentRoundReads, 3);
  assert.equal(roundCoreReads, 3);
});

test("resolveOpenFeedbackBonusRoundTarget rejects expired feedback windows without retrying", async () => {
  let currentRoundReads = 0;
  const client = {
    getBlock: async () => ({ timestamp: 1_700_001_000n }),
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "currentRoundId") {
        currentRoundReads += 1;
        return 3n;
      }
      if (functionName === "roundCore") {
        return [1_700_000_000n, 0];
      }
      throw new Error(`Unexpected function ${functionName}`);
    },
  };

  await assert.rejects(
    resolveOpenFeedbackBonusRoundTarget({
      client,
      contentId: 123n,
      durationSeconds: 600n,
      maxAttempts: 5,
      retryDelayMs: 0,
      votingEngineAddress: VOTING_ENGINE,
    }),
    (error: unknown) =>
      error instanceof FeedbackBonusRoundTargetError && error.message === "Feedback Bonus close time is in the past.",
  );
  assert.equal(currentRoundReads, 1);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  hasFeedbackBonusAwardPostcondition,
  hasFeedbackBonusPoolCreatedPostcondition,
  hasPublishedFeedbackPostcondition,
} from "~~/lib/feedback/postconditions";

const addresses = {
  awarder: "0x0000000000000000000000000000000000000004",
  escrow: "0x0000000000000000000000000000000000000002",
  feedbackRegistry: "0x0000000000000000000000000000000000000001",
  funder: "0x0000000000000000000000000000000000000003",
} as const;

const feedbackHash = "0x00000000000000000000000000000000000000000000000000000000000000aa" as const;
const commitKey = "0x00000000000000000000000000000000000000000000000000000000000000bb" as const;

function makeClient(readContract: (request: { args?: readonly unknown[]; functionName?: string }) => unknown) {
  return {
    readContract: async (request: unknown) =>
      readContract(request as { args?: readonly unknown[]; functionName?: string }),
  } as any;
}

function makePool(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    asset: 1,
    awarder: addresses.awarder,
    contentId: 7n,
    feedbackClosesAt: 1_000n,
    fundedAmount: 5_000_000n,
    funder: addresses.funder,
    id: 11n,
    remainingAmount: 5_000_000n,
    roundId: 2n,
    ...overrides,
  };
}

test("published feedback postcondition requires the expected feedback hash", async () => {
  const client = makeClient(request => {
    assert.equal(request.functionName, "feedbackByCommitKey");
    return { feedbackHash };
  });

  const satisfied = await hasPublishedFeedbackPostcondition({
    client,
    commitKey,
    contentId: 7n,
    expectedFeedbackHash: feedbackHash,
    feedbackRegistryAddress: addresses.feedbackRegistry,
    roundId: 2n,
  });

  assert.equal(satisfied, true);
});

test("feedback bonus award postcondition reads feedbackHashAwarded", async () => {
  const client = makeClient(request => {
    if (request.functionName === "feedbackHashAwarded") {
      assert.deepEqual(request.args, [11n, feedbackHash]);
      return true;
    }
    if (request.functionName === "feedbackBonusPools") {
      return makePool({ id: 11n, remainingAmount: 4_000_000n });
    }
    assert.fail(`Unexpected read ${request.functionName}`);
    return true;
  });

  const satisfied = await hasFeedbackBonusAwardPostcondition({
    client,
    escrowAddress: addresses.escrow,
    expectedRemainingAmount: 4_000_000n,
    feedbackHash,
    poolId: 11n,
  });

  assert.equal(satisfied, true);
});

test("feedback bonus pool postcondition scans past concurrent pools", async () => {
  const client = makeClient(request => {
    assert.equal(request.functionName, "feedbackBonusPools");
    const poolId = request.args?.[0];
    if (poolId === 10n) {
      return makePool({ contentId: 99n, id: 10n });
    }
    if (poolId === 11n) {
      return makePool();
    }
    return makePool({ id: 0n });
  });

  const satisfied = await hasFeedbackBonusPoolCreatedPostcondition({
    amount: 5_000_000n,
    asset: 1,
    awarder: addresses.awarder,
    client,
    contentId: 7n,
    escrowAddress: addresses.escrow,
    feedbackClosesAt: 1_000n,
    funder: addresses.funder,
    roundId: 2n,
    startPoolId: 10n,
  });

  assert.equal(satisfied, true);
});

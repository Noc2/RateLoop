import { REWARD_POOL_EFFECTIVE_UNIT_SCALE, getSubmissionRewardCoverageMinimum } from "./questionRewardMinimums";
import assert from "node:assert/strict";
import test from "node:test";

test("single-question reward minimum mirrors escrow max-voter coverage", () => {
  assert.equal(REWARD_POOL_EFFECTIVE_UNIT_SCALE, 10_000n);
  assert.equal(
    getSubmissionRewardCoverageMinimum({
      maxVoters: 200n,
      questionCount: 1,
      requiredSettledRounds: 1n,
      requiredVoters: 3n,
    }),
    2_000_000n,
  );
});

test("single-question reward minimum uses required voters when above cap defensively", () => {
  assert.equal(
    getSubmissionRewardCoverageMinimum({
      maxVoters: 3n,
      questionCount: 1,
      requiredSettledRounds: 2n,
      requiredVoters: 5n,
    }),
    100_000n,
  );
});

test("bundle reward minimum keeps the bundle escrow scale", () => {
  assert.equal(
    getSubmissionRewardCoverageMinimum({
      maxVoters: 100n,
      questionCount: 2,
      requiredSettledRounds: 3n,
      requiredVoters: 5n,
    }),
    300n,
  );
});

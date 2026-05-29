import {
  REWARD_POOL_EFFECTIVE_UNIT_SCALE,
  getContentRegistrySubmissionRewardMinimum,
  getSubmissionRewardCoverageMinimum,
} from "./questionRewardMinimums";
import assert from "node:assert/strict";
import test from "node:test";

test("single-question reward minimum mirrors escrow max-voter coverage", () => {
  assert.equal(REWARD_POOL_EFFECTIVE_UNIT_SCALE, 10_000n);
  assert.equal(
    getSubmissionRewardCoverageMinimum({
      maxVoters: 200n,
      requiredSettledRounds: 1n,
      requiredVoters: 3n,
    }),
    2_000_000n,
  );
});

test("single-question reward minimum is 1 USDC for 100 max voters", () => {
  assert.equal(
    getSubmissionRewardCoverageMinimum({
      maxVoters: 100n,
      requiredSettledRounds: 1n,
      requiredVoters: 3n,
    }),
    1_000_000n,
  );
});

test("single-question reward minimum uses required voters when above cap defensively", () => {
  assert.equal(
    getSubmissionRewardCoverageMinimum({
      maxVoters: 3n,
      requiredSettledRounds: 2n,
      requiredVoters: 5n,
    }),
    100_000n,
  );
});

test("bundle reward minimum mirrors escrow max-voter coverage", () => {
  assert.equal(
    getSubmissionRewardCoverageMinimum({
      maxVoters: 100n,
      requiredSettledRounds: 3n,
      requiredVoters: 5n,
    }),
    3_000_000n,
  );
});

test("content registry submission minimum includes default turnout coverage", () => {
  assert.equal(
    getContentRegistrySubmissionRewardMinimum({
      configuredMinimum: 1_000_000n,
      defaultMaxVoters: 100n,
    }),
    1_000_000n,
  );
});

test("content registry submission minimum keeps higher configured minimum", () => {
  assert.equal(
    getContentRegistrySubmissionRewardMinimum({
      configuredMinimum: 5_000_000n,
      defaultMaxVoters: 200n,
    }),
    5_000_000n,
  );
});

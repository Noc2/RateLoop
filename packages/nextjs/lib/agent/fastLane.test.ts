import { buildAgentFastLaneGuidance } from "./fastLane";
import assert from "node:assert/strict";
import test from "node:test";

test("buildAgentFastLaneGuidance estimates bounty and speed from round terms", () => {
  const guidance = buildAgentFastLaneGuidance({
    bounty: {
      amount: 1_000_000n,
      asset: "USDC",
      bountyStartBy: 0n,
      bountyWindowSeconds: 0n,
      bountyEligibility: 0,
      feedbackWindowSeconds: 0n,
      requiredSettledRounds: 1n,
      requiredVoters: 3n,
    },
    questionCount: 1,
    roundConfig: {
      epochDuration: 1_200n,
      maxDuration: 1_200n,
      maxVoters: 50n,
      minVoters: 3n,
    },
    nowSeconds: 1_700_000_000,
  });

  assert.equal(guidance.speed, "fast");
  assert.equal(guidance.pricingConfidence, "high");
  assert.equal(guidance.minimumViableQuorum, "3");
  assert.equal(guidance.requiredSignalUnits, "3");
  assert.equal(guidance.conservativeStartingBountyAtomic, "999999");
  assert.equal(guidance.estimatedResultAt, 1_700_002_100);
  assert.equal(guidance.expectedResponse.minimumExpectedVoters, "3");
  assert.equal(guidance.expectedResponse.healthyTargetVoters, "4");
  assert.equal(guidance.expectedResponse.likelyOutcome, "healthy");
  assert.equal(guidance.recommendedAction, "start_small");
  assert.equal(guidance.suggestedBountyAmountAtomic, "1500000");
  assert.equal(guidance.stretchBountyAmountAtomic, "2250000");
  assert.deepEqual(guidance.guidance, ["quote_first", "set_budget_before_submit"]);
  assert.deepEqual(guidance.warnings, []);
});

test("buildAgentFastLaneGuidance keeps pure-agent fast presets sub-minute plus settlement buffer", () => {
  const guidance = buildAgentFastLaneGuidance({
    bounty: {
      amount: 1_000_000n,
      asset: "USDC",
      bountyStartBy: 0n,
      bountyWindowSeconds: 0n,
      bountyEligibility: 0,
      feedbackWindowSeconds: 0n,
      requiredSettledRounds: 1n,
      requiredVoters: 3n,
    },
    questionCount: 1,
    roundConfig: {
      epochDuration: 60n,
      maxDuration: 60n,
      maxVoters: 3n,
      minVoters: 3n,
    },
    nowSeconds: 1_700_000_000,
  });

  assert.equal(guidance.speed, "fast");
  assert.equal(guidance.estimatedTimeToResultSeconds, 120);
  assert.equal(guidance.estimatedResultAt, 1_700_000_120);
  assert.equal(guidance.expectedResponse.healthyTargetVoters, "3");
});

test("buildAgentFastLaneGuidance warns on slow underfunded asks", () => {
  const guidance = buildAgentFastLaneGuidance({
    bounty: {
      amount: 1_000_000n,
      asset: "USDC",
      bountyStartBy: 0n,
      bountyWindowSeconds: 0n,
      bountyEligibility: 0,
      feedbackWindowSeconds: 0n,
      requiredSettledRounds: 1n,
      requiredVoters: 5n,
    },
    questionCount: 2,
    roundConfig: {
      epochDuration: 604_800n,
      maxDuration: 604_800n,
      maxVoters: 100n,
      minVoters: 5n,
    },
    nowSeconds: 1_700_000_000,
  });

  assert.equal(guidance.speed, "slow");
  assert.equal(guidance.pricingConfidence, "low");
  assert.equal(guidance.requiredSignalUnits, "10");
  assert.equal(guidance.conservativeStartingBountyAtomic, "3333330");
  assert.equal(guidance.estimatedResultAt, 1_700_606_300);
  assert.equal(guidance.expectedResponse.minimumExpectedVoters, "5");
  assert.equal(guidance.expectedResponse.healthyTargetVoters, "7");
  assert.equal(guidance.expectedResponse.likelyOutcome, "thin");
  assert.equal(guidance.recommendedAction, "raise_before_submit");
  assert.equal(guidance.suggestedBountyAmountAtomic, "5000000");
  assert.equal(guidance.stretchBountyAmountAtomic, "7500000");
  assert.deepEqual(guidance.guidance, [
    "quote_first",
    "set_budget_before_submit",
    "increase_bounty_before_submit",
    "expect_slow_result",
  ]);
  assert.deepEqual(guidance.warnings, ["bounty_per_required_vote_is_low", "round_window_is_not_fast_lane"]);
});

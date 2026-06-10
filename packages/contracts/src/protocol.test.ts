import assert from "node:assert/strict";
import test from "node:test";
import {
  QUESTION_REWARD_PARTICIPANT_FLOORS,
  SCORE_SPREAD_POLICY,
  requiredQuestionRewardParticipants,
} from "./protocol";

test("score-spread policy exposes low-turnout forfeiture guardrails", () => {
  assert.equal(SCORE_SPREAD_POLICY.forfeitMinReveals, 8);
  assert.equal(SCORE_SPREAD_POLICY.maxForfeitBps, 5_000);
});

test("requiredQuestionRewardParticipants maps reward amount tiers", () => {
  assert.equal(requiredQuestionRewardParticipants(999_999_999), 3);
  assert.equal(
    requiredQuestionRewardParticipants(QUESTION_REWARD_PARTICIPANT_FLOORS.highValueAmount),
    5,
  );
  assert.equal(
    requiredQuestionRewardParticipants(BigInt(QUESTION_REWARD_PARTICIPANT_FLOORS.veryHighValueAmount)),
    8,
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_QUESTION_ROUND_CONFIG_BOUNDS,
  getQuestionRoundMaxDurationForEpoch,
  isQuestionRoundMaxDurationValidForEpoch,
} from "~~/lib/questionRoundConfig";

test("default question round config bounds match protocol duration limits", () => {
  assert.equal(DEFAULT_QUESTION_ROUND_CONFIG_BOUNDS.maxEpochDuration, 30 * 24 * 60 * 60);
  assert.equal(DEFAULT_QUESTION_ROUND_CONFIG_BOUNDS.maxRoundDuration, 60 * 24 * 60 * 60);
});

test("getQuestionRoundMaxDurationForEpoch mirrors the contract epoch-count cap", () => {
  assert.equal(getQuestionRoundMaxDurationForEpoch(5 * 60, 60 * 24 * 60 * 60), 605_099);
  assert.equal(getQuestionRoundMaxDurationForEpoch(20 * 60, 60 * 24 * 60 * 60), 2_420_399);
});

test("getQuestionRoundMaxDurationForEpoch keeps the configured duration cap when stricter", () => {
  assert.equal(getQuestionRoundMaxDurationForEpoch(60 * 60, 60 * 24 * 60 * 60), 60 * 24 * 60 * 60);
});

test("isQuestionRoundMaxDurationValidForEpoch matches Solidity integer division", () => {
  assert.equal(isQuestionRoundMaxDurationValidForEpoch(5 * 60, 605_099), true);
  assert.equal(isQuestionRoundMaxDurationValidForEpoch(5 * 60, 605_100), false);
  assert.equal(isQuestionRoundMaxDurationValidForEpoch(30 * 24 * 60 * 60, 60 * 24 * 60 * 60), true);
  assert.equal(isQuestionRoundMaxDurationValidForEpoch(0, 60 * 60), false);
});

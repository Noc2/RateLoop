import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_QUESTION_ROUND_CONFIG_BOUNDS,
  PURE_AGENT_FAST_QUESTION_ROUND_CONFIG,
  PURE_AGENT_FAST_ROUND_PRESET_ID,
  getQuestionRoundMaxDurationForEpoch,
  isQuestionRoundMaxDurationValidForEpoch,
} from "~~/lib/questionRoundConfig";

test("default question round config bounds match protocol duration limits", () => {
  assert.equal(DEFAULT_QUESTION_ROUND_CONFIG_BOUNDS.maxEpochDuration, 30 * 24 * 60 * 60);
  assert.equal(DEFAULT_QUESTION_ROUND_CONFIG_BOUNDS.maxRoundDuration, 60 * 24 * 60 * 60);
});

test("pure agent fast round preset uses one-minute agent-only rounds", () => {
  assert.equal(PURE_AGENT_FAST_ROUND_PRESET_ID, "pure_agent_fast");
  assert.equal(PURE_AGENT_FAST_QUESTION_ROUND_CONFIG.epochDuration, 60n);
  assert.equal(PURE_AGENT_FAST_QUESTION_ROUND_CONFIG.maxDuration, 60n);
  assert.equal(PURE_AGENT_FAST_QUESTION_ROUND_CONFIG.minVoters, 3n);
  assert.equal(PURE_AGENT_FAST_QUESTION_ROUND_CONFIG.maxVoters, 3n);
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

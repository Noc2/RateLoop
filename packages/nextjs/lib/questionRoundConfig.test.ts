import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_QUESTION_ROUND_CONFIG_BOUNDS,
  PURE_AGENT_FAST_QUESTION_ROUND_CONFIG,
  PURE_AGENT_FAST_ROUND_PRESET_ID,
  serializeQuestionRoundConfig,
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

test("serializeQuestionRoundConfig exposes one shared question duration", () => {
  assert.deepEqual(serializeQuestionRoundConfig(PURE_AGENT_FAST_QUESTION_ROUND_CONFIG), {
    questionDurationSeconds: "60",
    minVoters: "3",
    maxVoters: "3",
  });
});

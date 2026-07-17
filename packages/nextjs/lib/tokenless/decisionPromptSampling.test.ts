import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  DEFAULT_DECISION_EXPLANATION_RATE_BPS,
  decisionExplanationBucket,
  decisionExplanationRequired,
} from "~~/lib/tokenless/decisionPromptSampling";

const originalKey = process.env.TOKENLESS_DECISION_EXPLANATION_SAMPLER_KEY;
const originalRate = process.env.TOKENLESS_DECISION_EXPLANATION_RATE_BPS;

beforeEach(() => {
  delete process.env.TOKENLESS_DECISION_EXPLANATION_SAMPLER_KEY;
  delete process.env.TOKENLESS_DECISION_EXPLANATION_RATE_BPS;
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.TOKENLESS_DECISION_EXPLANATION_SAMPLER_KEY;
  else process.env.TOKENLESS_DECISION_EXPLANATION_SAMPLER_KEY = originalKey;
  if (originalRate === undefined) delete process.env.TOKENLESS_DECISION_EXPLANATION_RATE_BPS;
  else process.env.TOKENLESS_DECISION_EXPLANATION_RATE_BPS = originalRate;
});

test("explanation sampling is deterministic per run and keyed like adaptive sampling", () => {
  const runId = "run_sampling_determinism";
  const first = decisionExplanationBucket(runId);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal(decisionExplanationBucket(runId), first);
  }
  assert.ok(first >= 0 && first < 10_000);
  // A different key produces an independent bucket; a decider cannot re-roll
  // by retrying because nothing about the request enters the bucket.
  assert.notEqual(decisionExplanationBucket(runId, "another-sampler-key-for-tests"), first);
  assert.throws(() => decisionExplanationBucket("  "), /requires a run ID/);
});

test("the sampled share follows the configured rate and defaults low", () => {
  assert.equal(DEFAULT_DECISION_EXPLANATION_RATE_BPS, 500);
  const runIds = Array.from({ length: 400 }, (_, index) => `run_rate_check_${index}`);
  const sampledAtDefault = runIds.filter(runId => decisionExplanationRequired(runId)).length;
  // ~5% of 400 with generous bounds; deterministic because inputs are fixed.
  assert.ok(sampledAtDefault > 0 && sampledAtDefault < 80, `sampled ${sampledAtDefault} of 400`);
  assert.equal(runIds.filter(runId => decisionExplanationRequired(runId, { rateBps: 0 })).length, 0);
  assert.equal(runIds.filter(runId => decisionExplanationRequired(runId, { rateBps: 10_000 })).length, runIds.length);
  // Every run sampled at the default rate stays sampled at any higher rate.
  for (const runId of runIds) {
    if (decisionExplanationRequired(runId)) {
      assert.equal(decisionExplanationRequired(runId, { rateBps: 2_000 }), true);
    }
  }
  // Environment overrides apply, and invalid values fall back to the default.
  process.env.TOKENLESS_DECISION_EXPLANATION_RATE_BPS = "10000";
  assert.equal(decisionExplanationRequired("run_env_rate"), true);
  process.env.TOKENLESS_DECISION_EXPLANATION_RATE_BPS = "not-a-number";
  assert.equal(runIds.filter(runId => decisionExplanationRequired(runId)).length, sampledAtDefault);
});

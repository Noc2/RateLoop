import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ATTACK_SCENARIOS,
  benchmarkAllScenarios,
  peerAssignments,
  quadraticScoreBps,
  rbtsScoreBps,
  shadowPredictionBps,
} from "./tokenlessRbts.js";

test("candidate math matches frozen worked examples", () => {
  assert.equal(shadowPredictionBps(7_000, 1), 10_000);
  assert.equal(shadowPredictionBps(7_000, 0), 4_000);
  assert.equal(quadraticScoreBps(7_000, 1), 9_100);
  assert.equal(quadraticScoreBps(7_000, 0), 5_100);

  assert.deepEqual(
    rbtsScoreBps({ ownVote: 1, predictedUpBps: 7_000, referencePredictionBps: 7_000, peerVote: 1 }),
    { shadowPredictionBps: 10_000, informationScoreBps: 10_000, predictionScoreBps: 9_100, scoreBps: 9_550 },
  );
  assert.deepEqual(
    rbtsScoreBps({ ownVote: 0, predictedUpBps: 7_000, referencePredictionBps: 7_000, peerVote: 1 }),
    { shadowPredictionBps: 4_000, informationScoreBps: 6_400, predictionScoreBps: 9_100, scoreBps: 7_750 },
  );
});

test("candidate score is bounded and own vote can change its information component", () => {
  for (const ownVote of [0, 1]) {
    for (const prediction of [100, 1_000, 3_000, 5_000, 7_000, 9_000, 9_900]) {
      for (const reference of [100, 1_000, 5_000, 9_000, 9_900]) {
        for (const peerVote of [0, 1]) {
          const score = rbtsScoreBps({ ownVote, predictedUpBps: prediction, referencePredictionBps: reference, peerVote });
          assert.ok(score.scoreBps >= 0 && score.scoreBps <= 10_000);
        }
      }
    }
  }
  const up = rbtsScoreBps({ ownVote: 1, predictedUpBps: 7_000, referencePredictionBps: 7_000, peerVote: 1 });
  const down = rbtsScoreBps({ ownVote: 0, predictedUpBps: 7_000, referencePredictionBps: 7_000, peerVote: 1 });
  assert.notEqual(up.informationScoreBps, down.informationScoreBps);
});

test("deterministic peer assignments never select self or duplicate roles", () => {
  for (let length = 3; length <= 100; length += 1) {
    const first = peerAssignments(length, `seed-${length}`);
    assert.deepEqual(first, peerAssignments(length, `seed-${length}`));
    for (let index = 0; index < length; index += 1) {
      assert.notEqual(first[index].referenceIndex, index);
      assert.notEqual(first[index].peerIndex, index);
      assert.notEqual(first[index].referenceIndex, first[index].peerIndex);
    }
  }
});

test("attack benchmark is deterministic and covers the preregistered strategies", () => {
  const options = { trials: 200, panelSize: 15, seed: "fixture-seed" };
  const first = benchmarkAllScenarios(options);
  assert.deepEqual(first, benchmarkAllScenarios(options));
  assert.deepEqual(
    first.results.map(result => result.scenario),
    ATTACK_SCENARIOS,
  );
  assert.ok(first.results.every(result => result.meanScoreBps >= 0 && result.meanScoreBps <= 10_000));
  assert.ok(first.results.every(result => result.reportCount > 0));
});

test("published attack benchmark fixture matches the executable simulator", async () => {
  const fixture = JSON.parse(
    await readFile(new URL("./fixtures/tokenless-rbts-v1-attack-benchmark.json", import.meta.url), "utf8"),
  );
  const generated = benchmarkAllScenarios({ trials: fixture.trials, panelSize: fixture.panelSize, seed: fixture.seed });
  assert.deepEqual(
    generated.results.map(({ trials: _trials, panelSize: _panelSize, ...result }) => result),
    fixture.results,
  );
});

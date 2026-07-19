import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ATTACK_SCENARIOS,
  accumulateSolidityRevealSet,
  benchmarkAllScenarios,
  canonicalSolidityPeerAssignments,
  peerAssignments,
  quadraticScoreBps,
  rbtsScoreBps,
  simulateManufacturedSurpriseFarming,
  shadowPredictionBps,
  solidityRankHash,
  solidityScoringSeed,
} from "./tokenlessRbts.js";

const bytes32 = value => `0x${BigInt(value).toString(16).padStart(64, "0")}`;

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
  assert.throws(
    () => rbtsScoreBps({ ownVote: 1, predictedUpBps: 150, referencePredictionBps: 7_000, peerVote: 1 }),
    /100-bps grid/,
  );
});

test("Solidity seed, rank, and canonical circular assignments match the frozen vectors", () => {
  const seed = solidityScoringSeed({
    chainId: 84_532,
    panelAddress: "0x1111111111111111111111111111111111111111",
    roundId: 42,
    frozenRevealCount: 3,
    revealSetXor: `0x${"aa".repeat(32)}`,
    revealSetSum: 123_456,
    entropy: `0x${"bb".repeat(32)}`,
  });
  assert.equal(seed, "0xb31ec78a68f9fafb9fb8a2306cdb0f66274cf1611dfd001862bf44dc3d16d889");
  assert.equal(solidityRankHash(seed, bytes32(1)), "0x7cedd517134e283c3967fd4b44d532d0ab4f8c52bb14addb802db9fca715ec10");

  const keys = [1, 2, 3, 4, 5].map(bytes32);
  assert.deepEqual(canonicalSolidityPeerAssignments(seed, keys), {
    [bytes32(3)]: { referenceCommitKey: bytes32(1), peerCommitKey: bytes32(2) },
    [bytes32(1)]: { referenceCommitKey: bytes32(2), peerCommitKey: bytes32(4) },
    [bytes32(2)]: { referenceCommitKey: bytes32(4), peerCommitKey: bytes32(5) },
    [bytes32(4)]: { referenceCommitKey: bytes32(5), peerCommitKey: bytes32(3) },
    [bytes32(5)]: { referenceCommitKey: bytes32(3), peerCommitKey: bytes32(1) },
  });
  assert.deepEqual(
    canonicalSolidityPeerAssignments(seed, [...keys].reverse()),
    canonicalSolidityPeerAssignments(seed, keys),
  );
  assert.deepEqual(accumulateSolidityRevealSet(keys), accumulateSolidityRevealSet([...keys].reverse()));
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
  const unilateral = first.results.find(result => result.scenario === "unilateral_constant_up");
  assert.ok(unilateral.honestResponsePremiumBps > 0);
  assert.ok(unilateral.focalReporterMeanScoreBps < unilateral.honestPopulationMeanScoreBps);
  assert.ok(unilateral.focalReporterCorrectVoteBps < unilateral.honestPopulationCorrectVoteBps);
  assert.equal(first.surpriseBountyDiagnostics.unanimousControl.totalSurpriseBonusAtomic, "0");
  assert.equal(first.surpriseBountyDiagnostics.unanimousControl.unanimityDisqualified, true);
  assert.equal(first.surpriseBountyDiagnostics.nearUnanimousAttack.surpriseOutlayWithinRoundFee, true);
  assert.ok(first.surpriseBountyDiagnostics.nearUnanimousAttack.coalitionNetSeatPayDeltaBps > 0);
});

test("manufactured-surprise diagnostics distinguish bounded outlay from incentive safety", () => {
  const result = simulateManufacturedSurpriseFarming({ trials: 200, panelSize: 15, seed: "fixture-seed" });
  assert.equal(result.maximumRoundLiabilityAtomic, result.roundFeeAtomic);
  assert.equal(result.unanimousControl.totalSurpriseBonusAtomic, "0");
  assert.ok(result.unanimousControl.rbtsSeatPayDeltaBps < 0);
  assert.equal(result.nearUnanimousAttack.totalSurpriseBonusAtomic, "1050000");
  assert.ok(result.nearUnanimousAttack.coalitionRbtsSeatPayDeltaBps < 0);
  assert.equal(result.nearUnanimousAttack.coalitionSurpriseSeatPayBps, 750);
  assert.ok(result.nearUnanimousAttack.coalitionNetSeatPayDeltaBps > 0);
});

test("published attack benchmark fixture matches the executable simulator", async () => {
  const fixture = JSON.parse(
    await readFile(new URL("./fixtures/tokenless-rbts-v1-attack-benchmark.json", import.meta.url), "utf8"),
  );
  const generated = benchmarkAllScenarios({ trials: fixture.trials, panelSize: fixture.panelSize, seed: fixture.seed });
  assert.deepEqual(
    {
      ...generated,
      results: generated.results.map(({ trials: _trials, panelSize: _panelSize, ...result }) => result),
    },
    fixture,
  );
});

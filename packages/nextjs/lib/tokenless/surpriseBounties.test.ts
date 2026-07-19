import { simulateManufacturedSurpriseFarming } from "../../../foundry/scripts-js/tokenlessRbts.js";
import assert from "node:assert/strict";
import test from "node:test";
import {
  SURPRISE_BOUNTY_VERSION,
  computeSurpriseBountyRound,
  maximumSurpriseBonusForBase,
} from "~~/lib/tokenless/surpriseBounties";

function key(index: number) {
  return `0x${index.toString(16).padStart(64, "0")}` as `0x${string}`;
}

function policy() {
  return {
    guaranteedBasePerReportAtomic: 1_000_000n,
    maximumBonusPerReportAtomic: 250_000n,
  };
}

test("surprise bounties refuse to allocate an undersized panel", () => {
  const result = computeSurpriseBountyRound(
    [
      { commitKey: key(1), vote: 1, predictedUpBps: 3_000 },
      { commitKey: key(2), vote: 0, predictedUpBps: 7_000 },
      { commitKey: key(3), vote: 1, predictedUpBps: 5_000 },
    ],
    { ...policy(), minimumSampleSize: 4 },
  );
  assert.equal(result.version, SURPRISE_BOUNTY_VERSION);
  assert.equal(result.effect, "centralized_bonus");
  assert.equal(result.verdictEffect, "none");
  assert.equal(result.state, "insufficient_sample");
  assert.equal(result.totalBonusAtomic, "0");
  assert.deepEqual(result.allocations, []);
});

test("surprise bounties reward an underestimated minority without changing the majority", () => {
  const reports = [
    ...Array.from({ length: 4 }, (_, index) => ({
      commitKey: key(index + 1),
      vote: 1 as const,
      predictedUpBps: 2_000,
    })),
    ...Array.from({ length: 6 }, (_, index) => ({
      commitKey: key(index + 5),
      vote: 0 as const,
      predictedUpBps: 2_000,
    })),
  ];
  const first = computeSurpriseBountyRound(reports, policy());
  const second = computeSurpriseBountyRound([...reports].reverse(), policy());
  assert.equal(first.state, "allocated");
  assert.equal(first.majorityOutcome, "down");
  assert.equal(first.surprisinglyPopularOutcome, "up");
  assert.equal(first.differsFromMajority, true);
  assert.equal(first.actualUpBps, 4_000);
  assert.equal(first.meanPredictedUpBps, 2_000);
  assert.equal(first.surpriseMarginUpBps, 2_000);
  assert.ok(
    first.allocations.filter(allocation => allocation.vote === 1).every(allocation => allocation.bonusAtomic !== "0"),
  );
  assert.ok(
    first.allocations.filter(allocation => allocation.vote === 0).every(allocation => allocation.bonusAtomic === "0"),
  );
  assert.ok(BigInt(first.totalBonusAtomic) <= BigInt(first.maximumRoundLiabilityAtomic));
  assert.equal(first.evidenceHash, second.evidenceHash);
  assert.equal(first.allocationHash, second.allocationHash);
});

test("surprise bounties apply the threshold and per-report cap", () => {
  const noSignal = computeSurpriseBountyRound(
    Array.from({ length: 10 }, (_, index) => ({
      commitKey: key(index + 1),
      vote: index < 6 ? (1 as const) : (0 as const),
      predictedUpBps: 5_700,
    })),
    policy(),
  );
  assert.equal(noSignal.state, "no_qualifying_outcome");
  assert.equal(noSignal.totalBonusAtomic, "0");

  const saturated = computeSurpriseBountyRound(
    Array.from({ length: 10 }, (_, index) => ({
      commitKey: key(index + 20),
      vote: index < 5 ? (1 as const) : (0 as const),
      predictedUpBps: 1_000,
    })),
    policy(),
  );
  assert.ok(
    saturated.allocations
      .filter(allocation => allocation.vote === 1)
      .every(allocation => allocation.bonusAtomic === "250000"),
  );
});

test("unanimous panels cannot farm surprise-bounty allocations", () => {
  const result = computeSurpriseBountyRound(
    Array.from({ length: 10 }, (_, index) => ({
      commitKey: key(index + 100),
      vote: 1 as const,
      predictedUpBps: 1_000,
    })),
    policy(),
  );
  assert.equal(result.majorityOutcome, "up");
  assert.equal(result.surprisinglyPopularOutcome, "up");
  assert.equal(result.state, "no_qualifying_outcome");
  assert.equal(result.totalBonusAtomic, "0");
  assert.ok(result.allocations.every(allocation => allocation.bonusAtomic === "0"));
  assert.ok(result.limitationCodes.includes("unanimous_panel_no_bonus"));
});

test("published manufactured-surprise diagnostics match the frozen allocation", () => {
  const diagnostic = simulateManufacturedSurpriseFarming({ trials: 200, panelSize: 15, seed: "fixture-seed" });
  const frozenPolicy = {
    guaranteedBasePerReportAtomic: 800_000n,
    maximumBonusPerReportAtomic: 75_000n,
  };
  const unanimous = computeSurpriseBountyRound(
    Array.from({ length: 15 }, (_, index) => ({
      commitKey: key(index + 200),
      vote: 1 as const,
      predictedUpBps: 3_000,
    })),
    frozenPolicy,
  );
  const nearUnanimous = computeSurpriseBountyRound(
    Array.from({ length: 15 }, (_, index) => ({
      commitKey: key(index + 300),
      vote: index < 14 ? (1 as const) : (0 as const),
      predictedUpBps: 3_000,
    })),
    frozenPolicy,
  );
  assert.equal(unanimous.totalBonusAtomic, diagnostic.unanimousControl.totalSurpriseBonusAtomic);
  assert.equal(nearUnanimous.totalBonusAtomic, diagnostic.nearUnanimousAttack.totalSurpriseBonusAtomic);
  assert.equal(nearUnanimous.maximumRoundLiabilityAtomic, diagnostic.maximumRoundLiabilityAtomic);
  assert.equal(diagnostic.maximumRoundLiabilityAtomic, diagnostic.roundFeeAtomic);
});

test("surprise bounties validate identities, prediction grid, and bounded economics", () => {
  assert.equal(maximumSurpriseBonusForBase(800_000n), 100_000n);
  assert.throws(
    () =>
      computeSurpriseBountyRound([{ commitKey: key(1), vote: 1, predictedUpBps: 3_333 }], {
        ...policy(),
        minimumSampleSize: 3,
      }),
    /one-percent prediction grid/,
  );
  assert.throws(
    () =>
      computeSurpriseBountyRound(
        [
          { commitKey: key(1), vote: 1, predictedUpBps: 3_000 },
          { commitKey: key(1), vote: 0, predictedUpBps: 7_000 },
        ],
        { ...policy(), minimumSampleSize: 3 },
      ),
    /commit keys must be unique/,
  );
  assert.throws(
    () =>
      computeSurpriseBountyRound([], {
        guaranteedBasePerReportAtomic: 100n,
        maximumBonusPerReportAtomic: 101n,
      }),
    /no greater than the guaranteed base/,
  );
});

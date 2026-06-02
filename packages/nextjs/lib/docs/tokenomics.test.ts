import {
  earnedRaterRewardScheduleRows,
  launchDistributionChartSlices,
  legacyContributorVestingRows,
  tokenAllocationChartSlices,
  verifiedReferralRewardScheduleRows,
} from "./tokenomics";
import assert from "node:assert/strict";
import test from "node:test";

test("tokenomics allocation chart exposes the current 42/24/9/25 split", () => {
  assert.deepEqual(
    tokenAllocationChartSlices.map(slice => [slice.label, slice.amountLabel, slice.percentLabel]),
    [
      ["Human verified + referral rewards", "42,000,000 LREP", "42.0%"],
      ["Earned rater rewards", "24,000,000 LREP", "24.0%"],
      ["Legacy contributors", "9,000,000 LREP", "9.0%"],
      ["Treasury", "25,000,000 LREP", "25.0%"],
    ],
  );

  assert.equal(
    tokenAllocationChartSlices.reduce((sum, slice) => sum + slice.value, 0),
    100,
  );
});

test("launch distribution rows include legacy contributor vesting", () => {
  assert.deepEqual(
    launchDistributionChartSlices.map(slice => [slice.label, slice.amountLabel]),
    [
      ["Human verified + referral rewards", "42,000,000 LREP"],
      ["Earned rater rewards", "24,000,000 LREP"],
      ["Legacy contributors", "9,000,000 LREP"],
    ],
  );

  assert.deepEqual(legacyContributorVestingRows[0], ["Root activation", "1% of allocation", "Claimable immediately"]);
  assert.deepEqual(legacyContributorVestingRows[3], [
    "Month 27+",
    "Expired unclaimed balance",
    "Governance can sweep unclaimed allocation to the treasury",
  ]);
});

test("verified referral schedule includes cold-start tiers", () => {
  assert.deepEqual(verifiedReferralRewardScheduleRows.slice(0, 4), [
    ["1-100", "250 LREP", "125 LREP"],
    ["101-1,000", "100 LREP", "50 LREP"],
    ["1,001-10,000", "40 LREP", "20 LREP"],
    ["10,001-50,000", "10 LREP", "5 LREP"],
  ]);
});

test("earned rater schedule keeps 25 percent open-lane cap in first cohort", () => {
  assert.deepEqual(earnedRaterRewardScheduleRows.slice(0, 4), [
    ["1-100", "500 LREP", "125 LREP", "50 LREP"],
    ["101-1,000", "250 LREP", "62.5 LREP", "25 LREP"],
    ["1,001-10,000", "100 LREP", "25 LREP", "10 LREP"],
    ["10,001-100,000", "10 LREP", "2.5 LREP", "1 LREP"],
  ]);
});

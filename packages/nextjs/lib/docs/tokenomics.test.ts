import { launchDistributionChartSlices, legacyContributorVestingRows, tokenAllocationChartSlices } from "./tokenomics";
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

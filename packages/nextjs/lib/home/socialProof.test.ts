import { buildLandingPageSocialProofItems, formatUsdcPaidOut } from "./socialProof";
import assert from "node:assert/strict";
import test from "node:test";

test("landing social proof formats live identity, rating, and USDC totals", () => {
  assert.deepEqual(
    buildLandingPageSocialProofItems({
      totalVerifiedHumans: 10,
      totalRatings: 21,
      totalPaidAtomic: "12000000",
    }),
    [
      { value: "10", label: "Verified Humans" },
      { value: "21", label: "Ratings" },
      { value: "$12", label: "USDC Paid" },
    ],
  );
});

test("landing social proof clamps invalid values and keeps cent rounding stable", () => {
  assert.deepEqual(
    buildLandingPageSocialProofItems({
      totalVerifiedHumans: "not-a-number",
      totalRatings: -2,
      totalPaidAtomic: "-1",
    }),
    [
      { value: "0", label: "Verified Humans" },
      { value: "0", label: "Ratings" },
      { value: "$0", label: "USDC Paid" },
    ],
  );
  assert.equal(formatUsdcPaidOut(5_000n), "$0.01");
  assert.equal(formatUsdcPaidOut(12_345_600n), "$12.35");
});

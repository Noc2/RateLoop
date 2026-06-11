import { buildLandingPageSocialProofItems, formatUsdcPaidOut } from "./socialProof";
import assert from "node:assert/strict";
import test from "node:test";

test("landing social proof uses the indexed verified human count", () => {
  const items = buildLandingPageSocialProofItems({
    totalVerifiedHumans: 3,
    totalVotes: 6,
    totalQuestionRewardsPaid: "0",
    totalFeedbackBonusesPaid: "0",
  });

  assert.deepEqual(items, [
    { value: "3", label: "Verified Humans" },
    { value: "6", label: "Ratings" },
    { value: "$0", label: "USDC Paid" },
  ]);
});

test("landing social proof falls back to zero when live verified total is invalid", () => {
  const [verifiedHumans] = buildLandingPageSocialProofItems({
    totalVerifiedHumans: "not-a-number",
    totalVotes: "not-a-number",
    totalQuestionRewardsPaid: "not-a-number",
    totalFeedbackBonusesPaid: "-1",
  });

  assert.deepEqual(verifiedHumans, {
    value: "0",
    label: "Verified Humans",
  });
});

test("formatUsdcPaidOut keeps cent rounding stable", () => {
  assert.equal(formatUsdcPaidOut(0n), "$0");
  assert.equal(formatUsdcPaidOut(5_000n), "$0.01");
  assert.equal(formatUsdcPaidOut(1_999_999n), "$2");
  assert.equal(formatUsdcPaidOut(12_345_600n), "$12.35");
});

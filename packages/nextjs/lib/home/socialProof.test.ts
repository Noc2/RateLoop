import { buildLandingPageSocialProofItems, formatLandingSocialProofItem, formatUsdcPaidOut } from "./socialProof";
import assert from "node:assert/strict";
import test from "node:test";
import { getMessagesForLocale } from "~~/i18n/messages";

test("landing social proof formats live identity, rating, and USDC totals", () => {
  assert.deepEqual(
    buildLandingPageSocialProofItems({
      totalVerifiedHumans: 10,
      totalRatings: 21,
      totalPaidAtomic: "12000000",
    }),
    [
      { value: 10, labelKey: "verifiedHumans" },
      { value: 21, labelKey: "reviewResponses" },
      { value: "$12", labelKey: "usdcPaid" },
    ],
  );
});

test("landing social proof hides zero-value claims and keeps cent rounding stable", () => {
  assert.deepEqual(
    buildLandingPageSocialProofItems({
      totalVerifiedHumans: "not-a-number",
      totalRatings: -2,
      totalPaidAtomic: "-1",
    }),
    [],
  );
  assert.deepEqual(
    buildLandingPageSocialProofItems({
      totalVerifiedHumans: 0,
      totalRatings: 21,
      totalPaidAtomic: 0,
    }),
    [{ value: 21, labelKey: "reviewResponses" }],
  );
  assert.equal(formatUsdcPaidOut(5_000n), "$0.01");
  assert.equal(formatUsdcPaidOut(12_345_600n), "$12.35");
});

test("landing social proof formats counts and singular labels in the active locale", () => {
  const english = getMessagesForLocale("en").home.socialProof;
  const german = getMessagesForLocale("de").home.socialProof;

  assert.deepEqual(formatLandingSocialProofItem({ value: 1, labelKey: "reviewResponses" }, "en", english), {
    value: "1",
    label: "Review response",
  });
  assert.deepEqual(formatLandingSocialProofItem({ value: 1_234, labelKey: "reviewResponses" }, "de", german), {
    value: "1.234",
    label: "Prüfantworten",
  });
  assert.deepEqual(formatLandingSocialProofItem({ value: 1, labelKey: "verifiedHumans" }, "de", german), {
    value: "1",
    label: "verifizierte Person",
  });
});

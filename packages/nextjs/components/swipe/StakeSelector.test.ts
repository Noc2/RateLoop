import assert from "node:assert/strict";
import test from "node:test";
import {
  RATING_TOOLTIP,
  STAKE_AMOUNT_TOOLTIP,
  canStakeSelectorRequestWorldIdProof,
  getInitialPredictedUpPercent,
  getNextStakeSelectorAmount,
  getStakeSelectorEligibilityAddress,
  normalizeStakeSelectorAmount,
  normalizeStakeSelectorPredictedUpPercent,
  normalizeStakeSelectorRating,
  shouldShowConfidentialStakeStatus,
} from "~~/components/swipe/StakeSelector";

test("normalizeStakeSelectorRating keeps unrated commit defaults neutral", () => {
  assert.equal(normalizeStakeSelectorRating(null), 5);
  assert.equal(normalizeStakeSelectorRating(undefined), 5);
});

test("normalizeStakeSelectorRating converts display-scale ratings", () => {
  assert.equal(normalizeStakeSelectorRating(64), 6.4);
});

test("normalizeStakeSelectorRating keeps sub-1.0 ratings on the out-of-ten scale", () => {
  // ratingBps 800 -> display scale 8 -> 0.8/10, matching the feed orb.
  assert.equal(normalizeStakeSelectorRating(8), 0.8);
});

test("normalizeStakeSelectorRating clamps out-of-range values to the slider range", () => {
  assert.equal(normalizeStakeSelectorRating(100), 10);
  assert.equal(normalizeStakeSelectorRating(10_000), 10);
  assert.equal(normalizeStakeSelectorRating(-5), 0);
});

test("normalizeStakeSelectorAmount keeps advisory at zero", () => {
  assert.equal(normalizeStakeSelectorAmount(0), 0);
  assert.equal(normalizeStakeSelectorAmount(-0.5), 0);
});

test("normalizeStakeSelectorAmount snaps nonzero values to the counted minimum", () => {
  assert.equal(normalizeStakeSelectorAmount(0.5), 1);
  assert.equal(normalizeStakeSelectorAmount(1), 1);
  assert.equal(normalizeStakeSelectorAmount(2.5), 2.5);
});

test("getNextStakeSelectorAmount initializes unadjusted stake when capacity loads", () => {
  assert.equal(getNextStakeSelectorAmount(0, 10, false), 1);
  assert.equal(getNextStakeSelectorAmount(0, 0, false), 0);
});

test("getNextStakeSelectorAmount preserves adjusted advisory stake on later capacity updates", () => {
  assert.equal(getNextStakeSelectorAmount(0, 10, true), 0);
});

test("getNextStakeSelectorAmount clamps adjusted stake to remaining capacity", () => {
  assert.equal(getNextStakeSelectorAmount(8, 5, true), 5);
  assert.equal(getNextStakeSelectorAmount(3, 5, true), 3);
});

test("getStakeSelectorEligibilityAddress uses the resolved holder after identity loading", () => {
  assert.equal(getStakeSelectorEligibilityAddress("0xdelegate", "0xholder", true), "0xholder");
  assert.equal(getStakeSelectorEligibilityAddress("0xholder", null, true), "0xholder");
  assert.equal(getStakeSelectorEligibilityAddress("0xdelegate", "0xholder", false), undefined);
});

test("canStakeSelectorRequestWorldIdProof only allows the eligibility wallet to prove", () => {
  assert.equal(canStakeSelectorRequestWorldIdProof("0xAbC", "0xabc"), true);
  assert.equal(canStakeSelectorRequestWorldIdProof("0xdelegate", "0xholder"), false);
  assert.equal(canStakeSelectorRequestWorldIdProof(undefined, "0xholder"), false);
});

test("shouldShowConfidentialStakeStatus hides satisfied private context state", () => {
  assert.equal(
    shouldShowConfidentialStakeStatus({
      blocker: null,
      canPostBond: false,
      isPrivateContext: true,
    }),
    false,
  );
});

test("shouldShowConfidentialStakeStatus hides pending private context checks", () => {
  assert.equal(
    shouldShowConfidentialStakeStatus({
      blocker: "Checking private-context eligibility.",
      canPostBond: false,
      isPending: true,
      isPrivateContext: true,
    }),
    false,
  );
  assert.equal(
    shouldShowConfidentialStakeStatus({
      blocker: "Checking confidentiality bond status.",
      canPostBond: false,
      hasError: true,
      isPending: true,
      isPrivateContext: true,
    }),
    true,
  );
});

test("shouldShowConfidentialStakeStatus keeps actionable private context state visible", () => {
  assert.equal(
    shouldShowConfidentialStakeStatus({
      blocker: "Accept the confidentiality terms and unlock the private context before voting.",
      canPostBond: false,
      isPrivateContext: true,
    }),
    true,
  );
  assert.equal(
    shouldShowConfidentialStakeStatus({
      blocker: null,
      canPostBond: true,
      isPrivateContext: true,
    }),
    true,
  );
  assert.equal(
    shouldShowConfidentialStakeStatus({
      blocker: null,
      canPostBond: false,
      hasError: true,
      isPrivateContext: true,
    }),
    true,
  );
});

test("getInitialPredictedUpPercent starts from the chosen binary signal", () => {
  assert.equal(getInitialPredictedUpPercent(true), 60);
  assert.equal(getInitialPredictedUpPercent(false), 40);
  assert.equal(getInitialPredictedUpPercent(undefined), 50);
});

test("normalizeStakeSelectorPredictedUpPercent matches reveal bounds", () => {
  assert.equal(normalizeStakeSelectorPredictedUpPercent(0), 1);
  assert.equal(normalizeStakeSelectorPredictedUpPercent(1), 1);
  assert.equal(normalizeStakeSelectorPredictedUpPercent(50), 50);
  assert.equal(normalizeStakeSelectorPredictedUpPercent(99), 99);
  assert.equal(normalizeStakeSelectorPredictedUpPercent(100), 99);
  assert.equal(normalizeStakeSelectorPredictedUpPercent(Number.NaN), 50);
});

test("rating tooltip explains unrated and settled rating states", () => {
  assert.match(RATING_TOOLTIP, /N\/A until/i);
  assert.match(RATING_TOOLTIP, /settled round/i);
  assert.match(RATING_TOOLTIP, /0-10 display/i);
});

test("stake amount tooltip explains conviction and settlement effects", () => {
  assert.match(STAKE_AMOUNT_TOOLTIP, /optional LREP/i);
  assert.match(STAKE_AMOUNT_TOOLTIP, /conviction/i);
  assert.match(STAKE_AMOUNT_TOOLTIP, /settlement/i);
});

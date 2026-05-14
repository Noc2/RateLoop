import assert from "node:assert/strict";
import test from "node:test";
import {
  getInitialPredictedUpPercent,
  normalizeStakeSelectorAmount,
  normalizeStakeSelectorRating,
} from "~~/components/swipe/StakeSelector";

test("normalizeStakeSelectorRating accepts out-of-ten ratings", () => {
  assert.equal(normalizeStakeSelectorRating(6.4), 6.4);
});

test("normalizeStakeSelectorRating keeps unrated commit defaults neutral", () => {
  assert.equal(normalizeStakeSelectorRating(null), 5);
  assert.equal(normalizeStakeSelectorRating(undefined), 5);
});

test("normalizeStakeSelectorRating converts display-scale ratings", () => {
  assert.equal(normalizeStakeSelectorRating(64), 6.4);
});

test("normalizeStakeSelectorRating converts basis-point ratings", () => {
  assert.equal(normalizeStakeSelectorRating(6400), 6.4);
});

test("normalizeStakeSelectorRating clamps protocol maximum to slider maximum", () => {
  assert.equal(normalizeStakeSelectorRating(100), 10);
  assert.equal(normalizeStakeSelectorRating(10_000), 10);
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

test("getInitialPredictedUpPercent starts from the chosen binary signal", () => {
  assert.equal(getInitialPredictedUpPercent(true), 60);
  assert.equal(getInitialPredictedUpPercent(false), 40);
  assert.equal(getInitialPredictedUpPercent(undefined), 50);
});

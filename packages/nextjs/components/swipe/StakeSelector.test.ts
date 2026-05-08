import assert from "node:assert/strict";
import test from "node:test";
import { normalizeStakeSelectorRating } from "~~/components/swipe/StakeSelector";

test("normalizeStakeSelectorRating accepts out-of-ten ratings", () => {
  assert.equal(normalizeStakeSelectorRating(6.4), 6.4);
});

test("normalizeStakeSelectorRating converts display-scale ratings", () => {
  assert.equal(normalizeStakeSelectorRating(64), 6.4);
});

test("normalizeStakeSelectorRating converts basis-point ratings", () => {
  assert.equal(normalizeStakeSelectorRating(6400), 6.4);
});

test("normalizeStakeSelectorRating clamps protocol maximum to slider maximum", () => {
  assert.equal(normalizeStakeSelectorRating(100), 9.9);
  assert.equal(normalizeStakeSelectorRating(10_000), 9.9);
});

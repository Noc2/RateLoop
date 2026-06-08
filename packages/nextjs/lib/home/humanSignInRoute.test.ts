import { HUMAN_SIGN_IN_DISCOVER_ROUTE, HUMAN_SIGN_IN_GET_LREP_ROUTE, getHumanSignInRoute } from "./humanSignInRoute";
import assert from "node:assert/strict";
import test from "node:test";

test("routes connected raters with LREP to Discover without requiring a rater credential", () => {
  assert.equal(getHumanSignInRoute({ lrepBalance: 1n }), HUMAN_SIGN_IN_DISCOVER_ROUTE);
});

test("routes connected raters with no LREP to the reputation onboarding page", () => {
  assert.equal(getHumanSignInRoute({ lrepBalance: 0n }), HUMAN_SIGN_IN_GET_LREP_ROUTE);
});

test("defaults to Discover while LREP balance is unresolved", () => {
  assert.equal(getHumanSignInRoute(), HUMAN_SIGN_IN_DISCOVER_ROUTE);
});

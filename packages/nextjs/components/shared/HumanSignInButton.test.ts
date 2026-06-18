import { getHumanPostSignInRoute, hasCompleteHumanSignInSession } from "./HumanSignInButton";
import assert from "node:assert/strict";
import test from "node:test";
import { GOVERNANCE_ROUTE, RATE_ROUTE } from "~~/constants/routes";

const TEST_ADDRESS = "0x1111111111111111111111111111111111111111";

test("human sign-in is incomplete without an address", () => {
  assert.equal(hasCompleteHumanSignInSession({ address: null, chainId: 480, targetChainId: 480 }), false);
});

test("human sign-in is incomplete when the wallet chain has not resolved", () => {
  assert.equal(hasCompleteHumanSignInSession({ address: TEST_ADDRESS, chainId: undefined, targetChainId: 480 }), false);
});

test("human sign-in is incomplete when a stale Sepolia chain is connected for World Chain", () => {
  assert.equal(hasCompleteHumanSignInSession({ address: TEST_ADDRESS, chainId: 4801, targetChainId: 480 }), false);
});

test("human sign-in is complete with both address and wallet chain", () => {
  assert.equal(hasCompleteHumanSignInSession({ address: TEST_ADDRESS, chainId: 480, targetChainId: 480 }), true);
});

test("zero LREP routes to governance even when a post sign-in route is configured", () => {
  assert.equal(getHumanPostSignInRoute({ lrepBalance: 0n, postSignInRoute: RATE_ROUTE }), GOVERNANCE_ROUTE);
});

test("nonzero LREP honors an explicit post sign-in route", () => {
  assert.equal(getHumanPostSignInRoute({ lrepBalance: 1n, postSignInRoute: RATE_ROUTE }), RATE_ROUTE);
});

test("nonzero LREP defaults to Discover without an explicit post sign-in route", () => {
  assert.equal(getHumanPostSignInRoute({ lrepBalance: 1n }), RATE_ROUTE);
});

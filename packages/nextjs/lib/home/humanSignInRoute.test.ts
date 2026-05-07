import { HUMAN_SIGN_IN_DISCOVER_ROUTE, HUMAN_SIGN_IN_FAUCET_ROUTE, getHumanSignInRoute } from "./humanSignInRoute";
import assert from "node:assert/strict";
import test from "node:test";

test("keeps the legacy faucet route alias pointed at rating discovery", () => {
  assert.equal(HUMAN_SIGN_IN_FAUCET_ROUTE, HUMAN_SIGN_IN_DISCOVER_ROUTE);
});

test("routes connected raters to Discover without requiring a Voter ID", () => {
  assert.equal(getHumanSignInRoute(), HUMAN_SIGN_IN_DISCOVER_ROUTE);
});

import { hasCompleteHumanSignInSession } from "./HumanSignInButton";
import assert from "node:assert/strict";
import test from "node:test";

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

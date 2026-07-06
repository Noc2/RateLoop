import { getUnsupportedContentActionScopeMessage } from "./actionScope";
import assert from "node:assert/strict";
import test from "node:test";

test("content actions allow unscoped or active-chain content", () => {
  const targetNetwork = { id: 8453, name: "Base" };

  assert.equal(getUnsupportedContentActionScopeMessage(null, targetNetwork), null);
  assert.equal(getUnsupportedContentActionScopeMessage({}, targetNetwork), null);
  assert.equal(getUnsupportedContentActionScopeMessage({ chainId: null }, targetNetwork), null);
  assert.equal(getUnsupportedContentActionScopeMessage({ chainId: 8453 }, targetNetwork), null);
});

test("content actions reject content scoped to a different chain", () => {
  assert.equal(
    getUnsupportedContentActionScopeMessage({ chainId: 31337 }, { id: 8453, name: "Base" }),
    "This content belongs to chain 31337; actions are only available on Base.",
  );
});

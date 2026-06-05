import { getGovernanceReputationGateState } from "./reputationGate";
import assert from "node:assert/strict";
import test from "node:test";

test("governance reputation gate waits while a connected wallet has no resolved LREP balance", () => {
  assert.equal(
    getGovernanceReputationGateState({
      hasAddress: true,
      lrepBalance: undefined,
      lrepBalanceError: false,
    }),
    "loading",
  );
});

test("governance reputation gate sends zero-LREP wallets to onboarding", () => {
  assert.equal(
    getGovernanceReputationGateState({
      hasAddress: true,
      lrepBalance: 0n,
      lrepBalanceError: false,
    }),
    "zero-lrep",
  );
});

test("governance reputation gate allows wallets with LREP into the profile tabs", () => {
  assert.equal(
    getGovernanceReputationGateState({
      hasAddress: true,
      lrepBalance: 1n,
      lrepBalanceError: false,
    }),
    "ready",
  );
});

test("governance reputation gate blocks profile fallback on unresolved balance errors", () => {
  assert.equal(
    getGovernanceReputationGateState({
      hasAddress: true,
      lrepBalance: undefined,
      lrepBalanceError: true,
    }),
    "error",
  );
});

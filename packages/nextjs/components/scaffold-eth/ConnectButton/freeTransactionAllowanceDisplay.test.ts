import { getFreeTransactionAllowanceDisplayState } from "./freeTransactionAllowanceDisplay";
import assert from "node:assert/strict";
import test from "node:test";

test("free transaction display shows verification prompt for unverified eligible wallets", () => {
  assert.deepEqual(
    getFreeTransactionAllowanceDisplayState({
      canShowFreeTransactionAllowance: true,
      isResolved: true,
      limit: 25,
      remaining: 0,
      verified: false,
    }),
    {
      kind: "verify",
      limit: 25,
    },
  );
});

test("free transaction display shows quota for verified eligible wallets", () => {
  assert.deepEqual(
    getFreeTransactionAllowanceDisplayState({
      canShowFreeTransactionAllowance: true,
      isResolved: true,
      limit: 25,
      remaining: 12,
      verified: true,
    }),
    {
      kind: "quota",
      limit: 25,
      remaining: 12,
    },
  );
});

test("free transaction display hides unavailable allowance states", () => {
  assert.deepEqual(
    getFreeTransactionAllowanceDisplayState({
      canShowFreeTransactionAllowance: false,
      isResolved: true,
      limit: 25,
      remaining: 0,
      verified: false,
    }),
    { kind: "hidden" },
  );
  assert.deepEqual(
    getFreeTransactionAllowanceDisplayState({
      canShowFreeTransactionAllowance: true,
      isResolved: false,
      limit: 25,
      remaining: 0,
      verified: false,
    }),
    { kind: "hidden" },
  );
});

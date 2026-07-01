import assert from "node:assert/strict";
import test from "node:test";
import {
  getDelegateAddressInputValue,
  getSetDelegateErrorMessage,
  isDelegateAddressInputCurrent,
  normalizeExistingDelegateAddress,
} from "~~/lib/profile/delegationDisplay";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ACTIVE_DELEGATE = "0x1111111111111111111111111111111111111111";
const PENDING_DELEGATE = "0x2222222222222222222222222222222222222222";

test("normalizes empty and zero delegate addresses to a blank display value", () => {
  assert.equal(normalizeExistingDelegateAddress(null), "");
  assert.equal(normalizeExistingDelegateAddress(""), "");
  assert.equal(normalizeExistingDelegateAddress(ZERO_ADDRESS), "");
});

test("uses a pending delegate address before an active delegate address", () => {
  assert.equal(
    getDelegateAddressInputValue({
      delegateTo: ACTIVE_DELEGATE,
      pendingDelegateTo: PENDING_DELEGATE,
    }),
    PENDING_DELEGATE,
  );
});

test("falls back to the active delegate address when there is no pending delegate", () => {
  assert.equal(
    getDelegateAddressInputValue({
      delegateTo: ACTIVE_DELEGATE,
      pendingDelegateTo: ZERO_ADDRESS,
    }),
    ACTIVE_DELEGATE,
  );
});

test("detects unchanged delegate input case-insensitively", () => {
  assert.equal(isDelegateAddressInputCurrent(ACTIVE_DELEGATE.toUpperCase(), ACTIVE_DELEGATE), true);
  assert.equal(isDelegateAddressInputCurrent(PENDING_DELEGATE, ACTIVE_DELEGATE), false);
  assert.equal(isDelegateAddressInputCurrent("", ACTIVE_DELEGATE), false);
});

test("set delegate errors explain unchanged current or pending delegates", () => {
  assert.equal(
    getSetDelegateErrorMessage({
      attemptedDelegate: ACTIVE_DELEGATE.toUpperCase(),
      error: new Error('The contract function "setDelegate" reverted.'),
      existingDelegateAddress: ACTIVE_DELEGATE,
    }),
    "That address is already your current or pending delegate.",
  );
});

test("set delegate errors detect nested viem custom error names", () => {
  const error = {
    shortMessage: 'The contract function "setDelegate" reverted.',
    cause: {
      data: {
        errorName: "DelegateAlreadyAssigned",
      },
      message: "Error: DelegateAlreadyAssigned()",
    },
  };

  assert.equal(
    getSetDelegateErrorMessage({
      attemptedDelegate: PENDING_DELEGATE,
      error,
      existingDelegateAddress: ACTIVE_DELEGATE,
    }),
    "That address is already involved in a delegation. Use a different wallet or remove the existing delegation first.",
  );
});

test("set delegate errors detect holder credential reverts behind generic viem messages", () => {
  const error = {
    shortMessage: 'The contract function "setDelegate" reverted.',
    cause: {
      data: {
        errorName: "DelegateIsHolder",
      },
    },
  };

  assert.equal(
    getSetDelegateErrorMessage({
      attemptedDelegate: PENDING_DELEGATE,
      error,
      existingDelegateAddress: ACTIVE_DELEGATE,
    }),
    "That address already has its own rater credential.",
  );
});

import { getThirdwebRaterDelegationCandidate } from "./raterDelegation";
import assert from "node:assert/strict";
import test from "node:test";

test("getThirdwebRaterDelegationCandidate detects current in-app smart account and admin holder", () => {
  assert.deepEqual(
    getThirdwebRaterDelegationCandidate({
      activeWalletId: "inApp",
      adminAddress: "0xabcdef0000000000000000000000000000000000",
      connectedAddress: "0x1234567890abcdef1234567890abcdef12345678",
      thirdwebAccountAddress: "0x1234567890abcdef1234567890abcdef12345678",
    }),
    {
      delegateAddress: "0x1234567890abcdef1234567890abcdef12345678",
      holderAddress: "0xabcdef0000000000000000000000000000000000",
    },
  );
});

test("getThirdwebRaterDelegationCandidate ignores stale or external wallets", () => {
  assert.equal(
    getThirdwebRaterDelegationCandidate({
      activeWalletId: "inApp",
      adminAddress: "0xabcdef0000000000000000000000000000000000",
      connectedAddress: "0x1234567890abcdef1234567890abcdef12345678",
      thirdwebAccountAddress: "0xfedcba0987654321fedcba0987654321fedcba09",
    }),
    null,
  );
  assert.equal(
    getThirdwebRaterDelegationCandidate({
      activeWalletId: "io.metamask",
      adminAddress: "0xabcdef0000000000000000000000000000000000",
      connectedAddress: "0x1234567890abcdef1234567890abcdef12345678",
      thirdwebAccountAddress: "0x1234567890abcdef1234567890abcdef12345678",
    }),
    null,
  );
});

test("getThirdwebRaterDelegationCandidate ignores matching admin and connected addresses", () => {
  assert.equal(
    getThirdwebRaterDelegationCandidate({
      activeWalletId: "in-app-wallet",
      adminAddress: "0x1234567890abcdef1234567890abcdef12345678",
      connectedAddress: "0x1234567890abcdef1234567890abcdef12345678",
      thirdwebAccountAddress: "0x1234567890abcdef1234567890abcdef12345678",
    }),
    null,
  );
});

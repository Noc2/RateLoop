import {
  buildExhaustionToastKey,
  buildFreeTransactionAllowanceSnapshotKey,
  buildSponsorshipSyncAttemptKey,
  clearSponsorshipSyncAttemptAfterFailure,
  getEffectiveSponsorshipSyncStatus,
  getFreeTransactionAllowanceIdentityAddress,
  isPendingSponsorshipSyncStatus,
} from "./useFreeTransactionAllowance";
import assert from "node:assert/strict";
import test from "node:test";

test("buildFreeTransactionAllowanceSnapshotKey scopes cached summaries by environment", () => {
  assert.equal(
    buildFreeTransactionAllowanceSnapshotKey(
      "0xAbCdEf0000000000000000000000000000000000",
      8453,
      "https://preview.rateloop.example",
    ),
    "rateloop-free-transactions-summary:https://preview.rateloop.example:0xabcdef0000000000000000000000000000000000:8453",
  );
});

test("buildExhaustionToastKey scopes exhaustion notifications by environment", () => {
  assert.equal(
    buildExhaustionToastKey({
      chainId: 8453,
      environmentScope: "https://rateloop.example",
      raterIdentityKey: "0x1111111111111111111111111111111111111111111111111111111111111111",
    }),
    "rateloop-free-transactions-exhausted:https://rateloop.example:8453:0x1111111111111111111111111111111111111111111111111111111111111111",
  );
});

test("buildSponsorshipSyncAttemptKey normalizes the wallet address", () => {
  assert.equal(
    buildSponsorshipSyncAttemptKey({
      address: "0xAbCdEf0000000000000000000000000000000000",
      chainId: 8453,
      sponsorshipMode: "sponsored",
    }),
    "0xabcdef0000000000000000000000000000000000:8453:sponsored",
  );
});

test("clearSponsorshipSyncAttemptAfterFailure clears the matching failed attempt", () => {
  assert.equal(
    clearSponsorshipSyncAttemptAfterFailure(
      "0xabcdef0000000000000000000000000000000000:8453:self-funded",
      "0xabcdef0000000000000000000000000000000000:8453:self-funded",
    ),
    null,
  );
});

test("clearSponsorshipSyncAttemptAfterFailure preserves newer attempts", () => {
  assert.equal(
    clearSponsorshipSyncAttemptAfterFailure(
      "0xabcdef0000000000000000000000000000000000:8453:sponsored",
      "0xabcdef0000000000000000000000000000000000:8453:self-funded",
    ),
    "0xabcdef0000000000000000000000000000000000:8453:sponsored",
  );
});

test("getEffectiveSponsorshipSyncStatus marks new sync work as pending", () => {
  assert.equal(
    getEffectiveSponsorshipSyncStatus({
      attemptKey: "0xabcdef0000000000000000000000000000000000:8453:sponsored",
      needsSync: true,
      state: {
        attemptKey: null,
        error: null,
        status: "idle",
      },
    }),
    "pending",
  );
});

test("getEffectiveSponsorshipSyncStatus preserves terminal attempt failures", () => {
  const attemptKey = "0xabcdef0000000000000000000000000000000000:8453:sponsored";

  assert.equal(
    getEffectiveSponsorshipSyncStatus({
      attemptKey,
      needsSync: true,
      state: {
        attemptKey,
        error: "sync failed",
        status: "failed",
      },
    }),
    "failed",
  );
});

test("isPendingSponsorshipSyncStatus only treats active sync states as pending", () => {
  assert.equal(isPendingSponsorshipSyncStatus("pending"), true);
  assert.equal(isPendingSponsorshipSyncStatus("syncing"), true);
  assert.equal(isPendingSponsorshipSyncStatus("failed"), false);
  assert.equal(isPendingSponsorshipSyncStatus("timed_out"), false);
  assert.equal(isPendingSponsorshipSyncStatus("settled"), false);
  assert.equal(isPendingSponsorshipSyncStatus("idle"), false);
});

test("getFreeTransactionAllowanceIdentityAddress prefers thirdweb admin identity", () => {
  assert.equal(
    getFreeTransactionAllowanceIdentityAddress({
      activeWalletId: "inApp",
      adminAddress: "0xAbCdEf0000000000000000000000000000000000",
      connectedAddress: "0x1234567890abcdef1234567890abcdef12345678",
      thirdwebAccountAddress: "0x1234567890abcdef1234567890abcdef12345678",
    }),
    "0xAbCdEf0000000000000000000000000000000000",
  );
});

test("getFreeTransactionAllowanceIdentityAddress ignores stale thirdweb admin identity", () => {
  assert.equal(
    getFreeTransactionAllowanceIdentityAddress({
      activeWalletId: "inApp",
      adminAddress: "0xAbCdEf0000000000000000000000000000000000",
      connectedAddress: "0x1234567890abcdef1234567890abcdef12345678",
      thirdwebAccountAddress: "0xfedcba0987654321fedcba0987654321fedcba09",
    }),
    "0x1234567890abcdef1234567890abcdef12345678",
  );
});

test("getFreeTransactionAllowanceIdentityAddress keeps external wallets on connected address", () => {
  assert.equal(
    getFreeTransactionAllowanceIdentityAddress({
      activeWalletId: "io.metamask",
      adminAddress: "0xAbCdEf0000000000000000000000000000000000",
      connectedAddress: "0x1234567890abcdef1234567890abcdef12345678",
    }),
    "0x1234567890abcdef1234567890abcdef12345678",
  );
});

test("getFreeTransactionAllowanceIdentityAddress falls back when thirdweb admin is unavailable", () => {
  assert.equal(
    getFreeTransactionAllowanceIdentityAddress({
      activeWalletId: "in-app-wallet",
      connectedAddress: "0x1234567890abcdef1234567890abcdef12345678",
    }),
    "0x1234567890abcdef1234567890abcdef12345678",
  );
});

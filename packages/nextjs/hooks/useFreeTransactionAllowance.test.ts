import {
  buildExhaustionToastKey,
  buildFreeTransactionAllowanceSnapshotKey,
  buildSponsorshipSyncAttemptKey,
  clearSponsorshipSyncAttemptAfterFailure,
} from "./useFreeTransactionAllowance";
import assert from "node:assert/strict";
import test from "node:test";

test("buildFreeTransactionAllowanceSnapshotKey scopes cached summaries by environment", () => {
  assert.equal(
    buildFreeTransactionAllowanceSnapshotKey(
      "0xAbCdEf0000000000000000000000000000000000",
      4801,
      "https://preview.rateloop.example",
    ),
    "rateloop-free-transactions-summary:https://preview.rateloop.example:0xabcdef0000000000000000000000000000000000:4801",
  );
});

test("buildExhaustionToastKey scopes exhaustion notifications by environment", () => {
  assert.equal(
    buildExhaustionToastKey({
      chainId: 4801,
      environmentScope: "https://rateloop.example",
      raterIdentityKey: "0x1111111111111111111111111111111111111111111111111111111111111111",
    }),
    "rateloop-free-transactions-exhausted:https://rateloop.example:4801:0x1111111111111111111111111111111111111111111111111111111111111111",
  );
});

test("buildSponsorshipSyncAttemptKey normalizes the wallet address", () => {
  assert.equal(
    buildSponsorshipSyncAttemptKey({
      address: "0xAbCdEf0000000000000000000000000000000000",
      chainId: 4801,
      sponsorshipMode: "sponsored",
    }),
    "0xabcdef0000000000000000000000000000000000:4801:sponsored",
  );
});

test("clearSponsorshipSyncAttemptAfterFailure clears the matching failed attempt", () => {
  assert.equal(
    clearSponsorshipSyncAttemptAfterFailure(
      "0xabcdef0000000000000000000000000000000000:4801:self-funded",
      "0xabcdef0000000000000000000000000000000000:4801:self-funded",
    ),
    null,
  );
});

test("clearSponsorshipSyncAttemptAfterFailure preserves newer attempts", () => {
  assert.equal(
    clearSponsorshipSyncAttemptAfterFailure(
      "0xabcdef0000000000000000000000000000000000:480:sponsored",
      "0xabcdef0000000000000000000000000000000000:4801:self-funded",
    ),
    "0xabcdef0000000000000000000000000000000000:480:sponsored",
  );
});

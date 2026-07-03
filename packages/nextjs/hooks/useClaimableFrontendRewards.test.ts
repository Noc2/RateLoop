import { getFrontendFeeWithdrawalPlan } from "./useClaimableFrontendRewards";
import assert from "node:assert/strict";
import test from "node:test";

test("frontend fee withdrawal plan completes only when dispute status is known clear", () => {
  const base = {
    canWithdrawFees: true,
    nowSeconds: 1_000,
    pendingAmount: 25n,
    pendingReleaseAt: 900n,
  };

  assert.deepEqual(getFrontendFeeWithdrawalPlan({ ...base, hasOpenSnapshotDispute: false }), {
    canCompletePendingWithdrawal: true,
    pendingMatured: true,
    requestSlotFree: true,
    withdrawalBlockedByDispute: false,
  });
  assert.deepEqual(getFrontendFeeWithdrawalPlan({ ...base, hasOpenSnapshotDispute: true }), {
    canCompletePendingWithdrawal: false,
    pendingMatured: true,
    requestSlotFree: false,
    withdrawalBlockedByDispute: true,
  });
  assert.deepEqual(getFrontendFeeWithdrawalPlan({ ...base, hasOpenSnapshotDispute: undefined }), {
    canCompletePendingWithdrawal: false,
    pendingMatured: true,
    requestSlotFree: false,
    withdrawalBlockedByDispute: false,
  });
});

test("frontend fee withdrawal request slot is free when no pending amount exists", () => {
  assert.deepEqual(
    getFrontendFeeWithdrawalPlan({
      canWithdrawFees: true,
      hasOpenSnapshotDispute: undefined,
      nowSeconds: 1_000,
      pendingAmount: 0n,
      pendingReleaseAt: 0n,
    }),
    {
      canCompletePendingWithdrawal: false,
      pendingMatured: false,
      requestSlotFree: true,
      withdrawalBlockedByDispute: false,
    },
  );
});

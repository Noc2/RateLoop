import { getFrontendFeeCompletionDisputeState } from "./FrontendRegistration";
import assert from "node:assert/strict";
import test from "node:test";

test("frontend dispute gate allows completion only when status is known clear", () => {
  const base = {
    isError: false,
    isLoading: false,
    isRegistered: true,
  };

  assert.deepEqual(getFrontendFeeCompletionDisputeState({ ...base, hasOpenSnapshotDispute: false }), {
    blockedByDispute: false,
    completionReady: true,
    statusUnavailable: false,
  });
  assert.deepEqual(getFrontendFeeCompletionDisputeState({ ...base, hasOpenSnapshotDispute: true }), {
    blockedByDispute: true,
    completionReady: false,
    statusUnavailable: false,
  });
  assert.deepEqual(getFrontendFeeCompletionDisputeState({ ...base, hasOpenSnapshotDispute: undefined }), {
    blockedByDispute: false,
    completionReady: false,
    statusUnavailable: true,
  });
  assert.deepEqual(
    getFrontendFeeCompletionDisputeState({
      ...base,
      hasOpenSnapshotDispute: false,
      isError: true,
    }),
    {
      blockedByDispute: false,
      completionReady: false,
      statusUnavailable: true,
    },
  );
});

test("frontend dispute gate is inert for unregistered wallets", () => {
  assert.deepEqual(
    getFrontendFeeCompletionDisputeState({
      hasOpenSnapshotDispute: undefined,
      isError: true,
      isLoading: true,
      isRegistered: false,
    }),
    {
      blockedByDispute: false,
      completionReady: false,
      statusUnavailable: false,
    },
  );
});

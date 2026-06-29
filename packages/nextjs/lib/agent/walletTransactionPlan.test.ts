import {
  assertWalletTransactionPlanReceiptSucceeded,
  createWalletTransactionPlanExecutionSegments,
  isWalletSendCallsUnsupportedError,
  isWalletTransactionPlanReservationRevealCall,
  isWalletTransactionPlanReserveSubmissionCall,
  normalizeWalletTransactionPlanCalls,
  segmentRequiresAtomicWalletBatch,
  withWalletTransactionPlanStepTimeout,
} from "./walletTransactionPlan";
import assert from "node:assert/strict";
import test from "node:test";

const TEST_ADDRESS = "0x0000000000000000000000000000000000000001";

test("createWalletTransactionPlanExecutionSegments batches adjacent calls without post-call delays", () => {
  const calls = normalizeWalletTransactionPlanCalls([
    { data: "0x01", to: TEST_ADDRESS },
    { data: "0x02", to: TEST_ADDRESS },
  ]);

  const segments = createWalletTransactionPlanExecutionSegments(calls);

  assert.equal(segments.length, 1);
  assert.equal(segments[0]?.batchable, true);
  assert.deepEqual(
    segments[0]?.calls.map(call => call.index),
    [0, 1],
  );
});

test("createWalletTransactionPlanExecutionSegments isolates reserve calls without post-call delays", () => {
  const calls = normalizeWalletTransactionPlanCalls([
    { data: "0x01", functionName: "reserveSubmission", to: TEST_ADDRESS },
    { data: "0x02", to: TEST_ADDRESS },
    { data: "0x03", functionName: "submitQuestionWithRewardAndRoundConfig", to: TEST_ADDRESS },
  ]);

  const segments = createWalletTransactionPlanExecutionSegments(calls);

  assert.equal(segments.length, 2);
  assert.deepEqual(
    segments.map(segment => segment.batchable),
    [false, true],
  );
  assert.deepEqual(
    segments.map(segment => segment.calls.map(call => call.index)),
    [[0], [1, 2]],
  );
});

test("segmentRequiresAtomicWalletBatch only gates batchable atomic-required segments", () => {
  const segments = createWalletTransactionPlanExecutionSegments(
    normalizeWalletTransactionPlanCalls([
      { data: "0x01", functionName: "reserveSubmission", to: TEST_ADDRESS },
      { data: "0x02", to: TEST_ADDRESS },
      { data: "0x03", functionName: "submitQuestionWithRewardAndRoundConfig", to: TEST_ADDRESS },
    ]),
  );

  assert.equal(segmentRequiresAtomicWalletBatch(segments[0]!, { requiresAtomicExecution: true }), false);
  assert.equal(segmentRequiresAtomicWalletBatch(segments[1]!, { requiresAtomicExecution: true }), true);
  assert.equal(segmentRequiresAtomicWalletBatch(segments[1]!, { requiresAtomicExecution: false }), false);
});

test("wallet transaction plan call classifiers recognize reservation phases", () => {
  assert.equal(isWalletTransactionPlanReserveSubmissionCall({ functionName: "reserveSubmission" }), true);
  assert.equal(isWalletTransactionPlanReserveSubmissionCall({ phase: "approve_usdc" }), false);
  assert.equal(isWalletTransactionPlanReservationRevealCall({ phase: "submit_question" }), true);
  assert.equal(isWalletTransactionPlanReservationRevealCall({ functionName: "submitQuestionBundleWithReward" }), true);
  assert.equal(isWalletTransactionPlanReservationRevealCall({ functionName: "awardFeedbackBonus" }), false);
});

test("normalizeWalletTransactionPlanCalls rejects nonzero value calls", () => {
  assert.throws(
    () => normalizeWalletTransactionPlanCalls([{ data: "0x", to: TEST_ADDRESS, value: "1" }]),
    /transactionPlan\.calls\[0\]\.value must be zero/,
  );
});

test("isWalletSendCallsUnsupportedError recognizes unsupported batch methods without matching rejection", () => {
  assert.equal(isWalletSendCallsUnsupportedError(new Error("wallet_sendCalls method not found")), true);
  assert.equal(isWalletSendCallsUnsupportedError(new Error("User rejected the request")), false);
});

test("withWalletTransactionPlanStepTimeout resolves completed wallet steps", async () => {
  await assert.doesNotReject(withWalletTransactionPlanStepTimeout(Promise.resolve("0xhash"), 10));
});

test("withWalletTransactionPlanStepTimeout rejects stuck wallet steps", async () => {
  await assert.rejects(
    withWalletTransactionPlanStepTimeout(new Promise(() => undefined), 1),
    /Wallet request did not finish/,
  );
});

test("assertWalletTransactionPlanReceiptSucceeded rejects reverted receipts", () => {
  assert.throws(() => assertWalletTransactionPlanReceiptSucceeded({ status: "reverted" }), /Transaction reverted/);
  assert.doesNotThrow(() => assertWalletTransactionPlanReceiptSucceeded({ status: "success" }));
});

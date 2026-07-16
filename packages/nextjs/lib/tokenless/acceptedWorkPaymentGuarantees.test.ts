import assert from "node:assert/strict";
import test from "node:test";
import {
  assertResultPreservesAcceptedWorkPayment,
  classifyAcceptedWorkFailurePayment,
  projectAcceptedWorkPaymentGuarantee,
} from "~~/lib/tokenless/acceptedWorkPaymentGuarantees";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

function baseInput() {
  return {
    workspaceId: "workspace_payment_guarantee",
    opportunityId: "opportunity_payment_guarantee",
    lane: "public_paid" as const,
    terminalState: "inconclusive" as const,
    failureSignal: "beacon_failure",
    frozen: {
      requestProfileHash: digest("1"),
      fundingEvidenceHash: digest("2"),
      guaranteedCompensationMode: "usdc" as const,
      fixedBasePerAcceptedWorkAtomic: "800000",
      attemptCompensationPerAcceptedWorkAtomic: "800000",
      fundedAtomic: "3000000",
    },
    work: {
      publicAcceptedCount: 2,
      publicPayableCount: 1,
      invitedAcceptedCount: 0,
      invitedPayableCount: 0,
    },
  };
}

test("projects a deterministic payable terminal without borrowing from Feedback Bonus", () => {
  const first = projectAcceptedWorkPaymentGuarantee(baseInput());
  const replay = projectAcceptedWorkPaymentGuarantee(baseInput());

  assert.deepEqual(replay, first);
  assert.equal(first.disposition, "payable_terminal");
  assert.equal(first.work.acceptedCount, 2);
  assert.equal(first.work.payableCount, 1);
  assert.equal(first.guaranteedBase.preservedLiabilityAtomic, "1600000");
  assert.equal(first.guaranteedBase.currentlyPayableAtomic, "800000");
  assert.equal(first.guaranteedBase.maximumRefundAtomic, "1400000");
  assert.equal(first.guaranteedBase.claimRule, "accepted_valid_work_only");
  assert.equal(first.guaranteedBase.recipientControl, "commit_or_assignment_bound");
  assert.equal(first.noPostCommitCancellation, true);
  assert.deepEqual(first.feedbackBonus, {
    includedInGuaranteedBase: false,
    maySatisfyGuaranteedBaseLiability: false,
  });
  assert.match(first.receiptId, /^awpg_[0-9a-f]{40}$/u);
  assert.match(first.receiptHash, /^sha256:[0-9a-f]{64}$/u);
});

test("hybrid failures freeze invited and public liability in one lane-neutral receipt", () => {
  const receipt = projectAcceptedWorkPaymentGuarantee({
    ...baseInput(),
    lane: "hybrid",
    failureSignal: "infrastructure_failure",
    work: {
      publicAcceptedCount: 1,
      publicPayableCount: 1,
      invitedAcceptedCount: 2,
      invitedPayableCount: 1,
    },
  });
  assert.equal(receipt.work.acceptedCount, 3);
  assert.equal(receipt.work.payableCount, 2);
  assert.equal(receipt.guaranteedBase.preservedLiabilityAtomic, "2400000");
  assert.equal(receipt.guaranteedBase.currentlyPayableAtomic, "1600000");
  assert.equal(receipt.guaranteedBase.maximumRefundAtomic, "600000");
});

test("private paid work keeps its assignment-bound fixed base payable", () => {
  const receipt = projectAcceptedWorkPaymentGuarantee({
    ...baseInput(),
    lane: "private_paid",
    failureSignal: "adapter_failure",
    work: {
      publicAcceptedCount: 0,
      publicPayableCount: 0,
      invitedAcceptedCount: 1,
      invitedPayableCount: 1,
    },
  });
  assert.equal(receipt.disposition, "payable_terminal");
  assert.equal(receipt.guaranteedBase.currentlyPayableAtomic, "800000");
  assert.equal(receipt.guaranteedBase.recipientControl, "commit_or_assignment_bound");
});

test("zero accepted work permits the unused base funding to refund", () => {
  const receipt = projectAcceptedWorkPaymentGuarantee({
    ...baseInput(),
    terminalState: "cancelled_before_commit",
    failureSignal: "takedown",
    work: {
      publicAcceptedCount: 0,
      publicPayableCount: 0,
      invitedAcceptedCount: 0,
      invitedPayableCount: 0,
    },
  });
  assert.equal(receipt.disposition, "refundable_zero_accepted_work");
  assert.equal(receipt.guaranteedBase.preservedLiabilityAtomic, "0");
  assert.equal(receipt.guaranteedBase.maximumRefundAtomic, "3000000");
  assert.equal(receipt.noPostCommitCancellation, false);
});

test("fails closed on cancellation, lane, count, funding, or panel-compensation mismatches", () => {
  const cases = [
    { ...baseInput(), terminalState: "cancelled_before_commit" as const },
    {
      ...baseInput(),
      lane: "private_paid" as const,
    },
    {
      ...baseInput(),
      work: { ...baseInput().work, publicPayableCount: 3 },
    },
    {
      ...baseInput(),
      frozen: { ...baseInput().frozen, fundedAtomic: "1000000" },
    },
    {
      ...baseInput(),
      frozen: { ...baseInput().frozen, attemptCompensationPerAcceptedWorkAtomic: "799999" },
    },
  ];
  for (const input of cases) {
    assert.throws(
      () => projectAcceptedWorkPaymentGuarantee(input),
      (error: unknown) => error instanceof TokenlessServiceError && error.status === 409,
    );
  }
});

test("result projection rejects post-response cancellation and a full base refund", () => {
  const accounting = {
    mode: "usdc" as const,
    fundedAtomic: "800000",
    paidAtomic: "0",
    refundedAtomic: "800000",
  };
  assert.throws(
    () =>
      assertResultPreservesAcceptedWorkPayment({
        lane: "public_paid",
        outcome: "cancelled",
        responseCount: 1,
        guaranteedBase: accounting,
      }),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.code === "accepted_work_post_commit_cancellation",
  );
  assert.throws(
    () =>
      assertResultPreservesAcceptedWorkPayment({
        lane: "hybrid",
        outcome: "failed",
        responseCount: 1,
        guaranteedBase: accounting,
      }),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.code === "accepted_work_result_payment_mismatch",
  );
});

test("recovery classification distinguishes reserved, payable, and zero-work terminals", () => {
  assert.equal(
    classifyAcceptedWorkFailurePayment({
      terminalState: "inconclusive",
      anyAcceptedWork: true,
      paidAcceptedWorkCount: 0,
      paidPayableWorkCount: 0,
    }).disposition,
    "not_applicable",
  );
  assert.equal(
    classifyAcceptedWorkFailurePayment({
      terminalState: "failed_terminal",
      anyAcceptedWork: false,
      paidAcceptedWorkCount: 0,
      paidPayableWorkCount: 0,
    }).disposition,
    "refundable_zero_accepted_work",
  );
  assert.equal(
    classifyAcceptedWorkFailurePayment({
      terminalState: "inconclusive",
      anyAcceptedWork: true,
      paidAcceptedWorkCount: 1,
      paidPayableWorkCount: 0,
    }).disposition,
    "compensation_path_preserved",
  );
  assert.equal(
    classifyAcceptedWorkFailurePayment({
      terminalState: "inconclusive",
      anyAcceptedWork: true,
      paidAcceptedWorkCount: 1,
      paidPayableWorkCount: 1,
    }).disposition,
    "payable_terminal",
  );
});

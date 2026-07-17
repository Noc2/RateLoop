import {
  applyOptimisticApprovalDecision,
  confirmApprovalDecision,
  rollbackApprovalDecision,
} from "./approvalInboxState";
import assert from "node:assert/strict";
import test from "node:test";
import type { HumanReviewApproval } from "~~/lib/tokenless/humanReviewApprovals";

function approval(approvalId: string) {
  return { approvalId, status: "pending" } as HumanReviewApproval;
}

test("approve is visible immediately and rolls back to the pending request", () => {
  const initial = [approval("first"), approval("second")];
  const optimistic = applyOptimisticApprovalDecision(initial, "first", "approve");

  assert.equal(optimistic.approvals[0]?.status, "approved");
  assert.ok(optimistic.rollback);
  assert.deepEqual(rollbackApprovalDecision(optimistic.approvals, optimistic.rollback), initial);
});

test("decline removes immediately and rollback restores the original order", () => {
  const initial = [approval("first"), approval("second"), approval("third")];
  const optimistic = applyOptimisticApprovalDecision(initial, "second", "reject");

  assert.deepEqual(
    optimistic.approvals.map(entry => entry.approvalId),
    ["first", "third"],
  );
  assert.ok(optimistic.rollback);
  assert.deepEqual(rollbackApprovalDecision(optimistic.approvals, optimistic.rollback), initial);
});

test("rollback preserves neighbors while another decision is still optimistic", () => {
  const initial = [approval("first"), approval("second"), approval("third")];
  const secondDecision = applyOptimisticApprovalDecision(initial, "second", "reject");
  assert.ok(secondDecision.rollback);
  const firstDecision = applyOptimisticApprovalDecision(secondDecision.approvals, "first", "reject");

  assert.deepEqual(
    rollbackApprovalDecision(firstDecision.approvals, secondDecision.rollback).map(entry => entry.approvalId),
    ["second", "third"],
  );
});

test("a request cannot be decided optimistically twice", () => {
  const initial = [{ ...approval("first"), status: "approved" as const }];
  const optimistic = applyOptimisticApprovalDecision(initial, "first", "approve");

  assert.equal(optimistic.approvals, initial);
  assert.equal(optimistic.rollback, null);
});

test("the server decision replaces the optimistic version without re-fetching the inbox", () => {
  const initial = [approval("first")];
  const optimistic = applyOptimisticApprovalDecision(initial, "first", "approve");
  const decided = { ...initial[0], status: "approved" as const, lifecycleRevision: 2 };

  assert.deepEqual(confirmApprovalDecision(optimistic.approvals, decided), [decided]);
});

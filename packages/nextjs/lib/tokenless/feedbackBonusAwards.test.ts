import assert from "node:assert/strict";
import test from "node:test";
import type { Address, Hex } from "viem";
import {
  type FeedbackBonusAwardRepository,
  createFeedbackBonusAwardService,
} from "~~/lib/tokenless/feedbackBonusAwards";
import { tokenlessPayoutCommitment } from "~~/lib/tokenless/rater/material";

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const NOW = new Date("2026-07-16T12:00:00.000Z");
const RECIPIENT = {
  payoutAddress: "0x7777777777777777777777777777777777777777" as Address,
  payoutSalt: `0x${"8".repeat(64)}` as Hex,
};
const PAYOUT_COMMITMENT = tokenlessPayoutCommitment(RECIPIENT.payoutAddress, RECIPIENT.payoutSalt);
const recipientDependencies = {
  resolveRecipientPreimage: async () => RECIPIENT,
  reconcileHumanAward: async () => null,
};

function eligibleRow(overrides: Record<string, unknown> = {}) {
  return {
    workspace_id: "workspace_a",
    opportunity_id: "opportunity_a",
    feedback_id: "feedback_a",
    response_hash: `0x${"a".repeat(64)}`,
    vote_key: "0x2222222222222222222222222222222222222222",
    payout_commitment: PAYOUT_COMMITMENT,
    body_reference: "public-response:response_a",
    deposited_amount_atomic: "5000000",
    awarded_amount_atomic: "1000000",
    feedback_deadline: "2026-07-16T11:00:00.000Z",
    award_deadline: "2026-07-23T11:00:00.000Z",
    chain_id: "84532",
    contract_address: "0x3333333333333333333333333333333333333333",
    pool_id: "7",
    ...overrides,
  };
}

function repository(overrides: Partial<FeedbackBonusAwardRepository> = {}): FeedbackBonusAwardRepository {
  return {
    listEligible: async () => [eligibleRow()],
    prepare: async input => ({
      intentId: "fbai_intent",
      workspaceId: input.workspaceId,
      opportunityId: "opportunity_a",
      feedbackId: input.feedbackId,
      responseHash: `0x${"a".repeat(64)}`,
      voteKey: "0x2222222222222222222222222222222222222222",
      payoutCommitment: PAYOUT_COMMITMENT,
      amountAtomic: input.amountAtomic,
      pool: {
        chainId: "84532",
        contractAddress: "0x3333333333333333333333333333333333333333",
        poolId: "7",
      },
      confirmedReceipt: null,
    }),
    confirm: async () => undefined,
    fail: async () => undefined,
    ...overrides,
  };
}

test("award inbox projects only resolver-approved written feedback with remaining pool and deadline", async () => {
  const service = createFeedbackBonusAwardService({
    repository: repository({
      listEligible: async () => [eligibleRow(), eligibleRow({ feedback_id: "blank", body_reference: "blank" })],
    }),
    readFeedbackBody: async input => (input.bodyReference.endsWith("response_a") ? "Specific useful feedback." : ""),
    ...recipientDependencies,
    executeHumanAward: async () => ({ transactionHash: `0x${"c".repeat(64)}`, confirmedAt: NOW }),
  });
  const result = await service.list({ accountAddress: ACCOUNT, workspaceId: "workspace_a", now: NOW });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.feedbackBody, "Specific useful feedback.");
  assert.equal(result.items[0]?.remainingPoolAtomic, "4000000");
  assert.equal(result.items[0]?.awardDeadline, "2026-07-23T11:00:00.000Z");
});

test("human award passes the immutable payout commitment and records one idempotent receipt", async () => {
  const executed: unknown[] = [];
  const confirmed: unknown[] = [];
  const service = createFeedbackBonusAwardService({
    repository: repository({ confirm: async value => void confirmed.push(value) }),
    readFeedbackBody: async () => "Useful feedback.",
    ...recipientDependencies,
    executeHumanAward: async value => {
      executed.push(value);
      return { transactionHash: `0x${"c".repeat(64)}`, confirmedAt: NOW };
    },
  });
  const result = await service.award({
    accountAddress: ACCOUNT,
    workspaceId: "workspace_a",
    feedbackId: "feedback_a",
    amountAtomic: "1250000",
    idempotencyKey: "feedback-bonus:award-a",
    now: NOW,
  });
  assert.equal(result.status, "confirmed");
  assert.equal(executed.length, 1);
  assert.equal((executed[0] as { award: { payoutCommitment: string } }).award.payoutCommitment, PAYOUT_COMMITMENT);
  assert.equal((confirmed[0] as { amountAtomic: string }).amountAtomic, "1250000");
});

test("a confirmed idempotent replay returns its receipt without executing a second award", async () => {
  let executed = 0;
  const receipt = { transactionHash: `0x${"c".repeat(64)}`, confirmedAt: NOW };
  const service = createFeedbackBonusAwardService({
    repository: repository({
      prepare: async input => ({
        intentId: "fbai_intent",
        workspaceId: input.workspaceId,
        opportunityId: "opportunity_a",
        feedbackId: input.feedbackId,
        responseHash: `0x${"a".repeat(64)}`,
        voteKey: "0x2222222222222222222222222222222222222222",
        payoutCommitment: PAYOUT_COMMITMENT,
        amountAtomic: input.amountAtomic,
        pool: {
          chainId: "84532",
          contractAddress: "0x3333333333333333333333333333333333333333",
          poolId: "7",
        },
        confirmedReceipt: receipt,
      }),
    }),
    readFeedbackBody: async () => "Useful feedback.",
    ...recipientDependencies,
    executeHumanAward: async () => {
      executed += 1;
      return receipt;
    },
  });

  const result = await service.award({
    accountAddress: ACCOUNT,
    workspaceId: "workspace_a",
    feedbackId: "feedback_a",
    amountAtomic: "1250000",
    idempotencyKey: "feedback-bonus:award-a",
    now: NOW,
  });

  assert.equal(executed, 0);
  assert.deepEqual(result.receipt, receipt);
});

test("a post-chain database failure reconciles the exact receipt without sending another award", async () => {
  const receipt = { transactionHash: `0x${"d".repeat(64)}`, confirmedAt: NOW };
  let executions = 0;
  let confirmationAttempts = 0;
  let chainReceipt: typeof receipt | null = null;
  const service = createFeedbackBonusAwardService({
    repository: repository({
      confirm: async () => {
        confirmationAttempts += 1;
        if (confirmationAttempts <= 2) throw new Error("database unavailable after chain confirmation");
      },
    }),
    readFeedbackBody: async () => "Useful feedback.",
    resolveRecipientPreimage: async () => RECIPIENT,
    reconcileHumanAward: async () => chainReceipt,
    executeHumanAward: async () => {
      executions += 1;
      chainReceipt = receipt;
      return receipt;
    },
  });
  const input = {
    accountAddress: ACCOUNT,
    workspaceId: "workspace_a",
    feedbackId: "feedback_a",
    amountAtomic: "1250000",
    idempotencyKey: "feedback-bonus:award-recovery",
    now: NOW,
  };

  await assert.rejects(service.award(input), /still needs reconciliation/u);
  const recovered = await service.award(input);

  assert.equal(executions, 1);
  assert.equal(confirmationAttempts, 3);
  assert.deepEqual(recovered.receipt, receipt);
});

test("agent-like or malformed award amounts never reach the executor", async () => {
  let executed = false;
  const service = createFeedbackBonusAwardService({
    repository: repository(),
    readFeedbackBody: async () => "Useful feedback.",
    ...recipientDependencies,
    executeHumanAward: async () => {
      executed = true;
      return { transactionHash: `0x${"c".repeat(64)}`, confirmedAt: NOW };
    },
  });
  await assert.rejects(
    service.award({
      accountAddress: ACCOUNT,
      workspaceId: "workspace_a",
      feedbackId: "feedback_a",
      amountAtomic: "0",
      idempotencyKey: "feedback-bonus:award-a",
      now: NOW,
    }),
    /greater than zero|positive USDC atomic/u,
  );
  assert.equal(executed, false);
});

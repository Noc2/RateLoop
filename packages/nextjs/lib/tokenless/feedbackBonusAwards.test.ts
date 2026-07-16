import assert from "node:assert/strict";
import test from "node:test";
import { getAddress } from "viem";
import {
  type FeedbackBonusAwardRepository,
  createFeedbackBonusAwardService,
} from "~~/lib/tokenless/feedbackBonusAwards";

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const CONTRACT = getAddress("0x3333333333333333333333333333333333333333");
const AWARDER = getAddress("0x4444444444444444444444444444444444444444");
const NOW = new Date("2026-07-16T12:00:00.000Z");
const RECEIPT = { transactionHash: `0x${"c".repeat(64)}`, confirmedAt: NOW };
const AUTHORIZATION = {
  chainId: 84_532,
  contractAddress: CONTRACT,
  awarderAddress: AWARDER,
  transactionData: `0x${"12".repeat(100)}` as const,
};

function eligibleRow(overrides: Record<string, unknown> = {}) {
  return {
    workspace_id: "workspace_a",
    opportunity_id: "opportunity_a",
    feedback_id: "feedback_a",
    response_hash: `0x${"a".repeat(64)}`,
    vote_key: "0x2222222222222222222222222222222222222222",
    payout_commitment: `0x${"b".repeat(64)}`,
    body_reference: "public-response:response_a",
    deposited_amount_atomic: "5000000",
    awarded_amount_atomic: "1000000",
    feedback_deadline: "2026-07-16T11:00:00.000Z",
    award_deadline: "2026-07-23T11:00:00.000Z",
    chain_id: "84532",
    contract_address: CONTRACT,
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
      payoutCommitment: `0x${"b".repeat(64)}`,
      awarderWallet: AWARDER,
      amountAtomic: input.amountAtomic,
      pool: { chainId: "84532", contractAddress: CONTRACT, poolId: "7" },
      confirmedReceipt: null,
    }),
    confirm: async () => undefined,
    fail: async () => undefined,
    ...overrides,
  };
}

function service(
  overrides: {
    repository?: FeedbackBonusAwardRepository;
    prepareHumanAward?: () => Promise<typeof AUTHORIZATION>;
    confirmHumanAward?: () => Promise<typeof RECEIPT>;
  } = {},
) {
  return createFeedbackBonusAwardService({
    repository: overrides.repository ?? repository(),
    readFeedbackBody: async input => (input.bodyReference.endsWith("response_a") ? "Specific useful feedback." : ""),
    prepareHumanAward: overrides.prepareHumanAward ?? (async () => AUTHORIZATION),
    confirmHumanAward: overrides.confirmHumanAward ?? (async () => RECEIPT),
  });
}

const AWARD_INPUT = {
  accountAddress: ACCOUNT,
  workspaceId: "workspace_a",
  feedbackId: "feedback_a",
  amountAtomic: "1250000",
  idempotencyKey: "feedback-bonus:award-a",
  now: NOW,
};

test("award inbox projects only resolver-approved written feedback with remaining pool and deadline", async () => {
  const result = await service({
    repository: repository({
      listEligible: async () => [eligibleRow(), eligibleRow({ feedback_id: "blank", body_reference: "blank" })],
    }),
  }).list({ accountAddress: ACCOUNT, workspaceId: "workspace_a", now: NOW });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.feedbackBody, "Specific useful feedback.");
  assert.equal(result.items[0]?.remainingPoolAtomic, "4000000");
});

test("human selection prepares exact wallet calldata without executing from a platform key", async () => {
  let preparations = 0;
  const result = await service({
    prepareHumanAward: async () => {
      preparations += 1;
      return AUTHORIZATION;
    },
  }).prepareAward(AWARD_INPUT);
  assert.equal(result.status, "human_wallet_required");
  assert.equal(preparations, 1);
  assert.deepEqual(result.authorization, AUTHORIZATION);
});

test("confirmation records only a verifier-approved human wallet transaction", async () => {
  const confirmed: unknown[] = [];
  let verifiedHash = "";
  const result = await service({
    repository: repository({ confirm: async input => void confirmed.push(input) }),
    confirmHumanAward: async () => {
      verifiedHash = RECEIPT.transactionHash;
      return RECEIPT;
    },
  }).confirmAward({ ...AWARD_INPUT, transactionHash: RECEIPT.transactionHash });
  assert.equal(result.status, "confirmed");
  assert.equal(verifiedHash, RECEIPT.transactionHash);
  assert.equal((confirmed[0] as { payoutCommitment: string }).payoutCommitment, `0x${"b".repeat(64)}`);
});

test("a confirmed idempotent replay needs no second wallet transaction or verification", async () => {
  let verified = 0;
  const result = await service({
    repository: repository({
      prepare: async input => ({
        ...(await repository().prepare(input)),
        confirmedReceipt: RECEIPT,
      }),
    }),
    confirmHumanAward: async () => {
      verified += 1;
      return RECEIPT;
    },
  }).confirmAward({ ...AWARD_INPUT, transactionHash: RECEIPT.transactionHash });
  assert.equal(verified, 0);
  assert.deepEqual(result.receipt, RECEIPT);
});

test("malformed award amounts never reach wallet preparation", async () => {
  let prepared = false;
  await assert.rejects(
    service({
      prepareHumanAward: async () => {
        prepared = true;
        return AUTHORIZATION;
      },
    }).prepareAward({ ...AWARD_INPUT, amountAtomic: "0" }),
    /positive USDC atomic/u,
  );
  assert.equal(prepared, false);
});

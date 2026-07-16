import assert from "node:assert/strict";
import test from "node:test";
import {
  type FeedbackBonusRecipientCandidate,
  createFeedbackBonusRecipientEntitlementService,
} from "~~/lib/tokenless/feedbackBonusRecipientClaims";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const contractAddress = "0x1111111111111111111111111111111111111111" as const;
const voteKey = "0x2222222222222222222222222222222222222222" as const;
const responseHash = `0x${"ab".repeat(32)}` as const;
const payoutCommitment = `0x${"cd".repeat(32)}` as const;

function candidate(overrides: Partial<FeedbackBonusRecipientCandidate> = {}): FeedbackBonusRecipientCandidate {
  return {
    roundId: "77",
    chainId: 84_532,
    contractAddress,
    poolId: "9",
    feedbackId: "feedback_public_77",
    responseHash,
    voteKey,
    payoutCommitment,
    ...overrides,
  };
}

test("returns live public entitlement evidence without payout preimages", async () => {
  const service = createFeedbackBonusRecipientEntitlementService({
    expectedChainId: 84_532,
    expectedContractAddress: contractAddress,
    listCandidates: async input => {
      assert.deepEqual(input, { roundId: "77", voteKey });
      return [candidate()];
    },
    readFeedback: async input => {
      assert.deepEqual(input, { poolId: 9n, voteKey });
      return { voteKey, responseHash, payoutCommitment, awardAmount: 2_500_000n, awarded: true, claimed: false };
    },
  });
  const [item] = await service({ roundId: "77", voteKey });
  assert.deepEqual(item, {
    ...candidate(),
    schemaVersion: "rateloop.feedback-bonus-entitlement.v1",
    awardAmountAtomic: "2500000",
    awarded: true,
    claimed: false,
  });
  assert.equal("payoutAddress" in item!, false);
  assert.equal("payoutSalt" in item!, false);
});

test("fails closed when local and live response bindings differ", async () => {
  const service = createFeedbackBonusRecipientEntitlementService({
    expectedChainId: 84_532,
    expectedContractAddress: contractAddress,
    listCandidates: async () => [candidate()],
    readFeedback: async () => ({
      voteKey,
      responseHash: `0x${"ef".repeat(32)}`,
      payoutCommitment,
      awardAmount: 0n,
      awarded: false,
      claimed: false,
    }),
  });
  await assert.rejects(
    service({ roundId: "77", voteKey }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "feedback_bonus_entitlement_invalid",
  );
});

test("fails closed on a candidate from another deployment", async () => {
  const service = createFeedbackBonusRecipientEntitlementService({
    expectedChainId: 84_532,
    expectedContractAddress: contractAddress,
    listCandidates: async () => [candidate({ chainId: 1 })],
    readFeedback: async () => ({
      voteKey,
      responseHash,
      payoutCommitment,
      awardAmount: 0n,
      awarded: false,
      claimed: false,
    }),
  });
  await assert.rejects(service({ roundId: "77", voteKey }), /does not match the active public deployment/u);
});

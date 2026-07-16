import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, encodeEventTopics, parseAbiParameters } from "viem";
import {
  buildFeedbackBonusClaimAuthorization,
  verifyFeedbackBonusClaimEvidence,
} from "~~/lib/tokenless/rater/feedbackBonusClaim";
import { createTokenlessRaterRoundSecrets } from "~~/lib/tokenless/rater/material";
import { tokenlessPayoutCommitment } from "~~/lib/tokenless/rater/material";

const contractAddress = "0x1111111111111111111111111111111111111111" as const;
const relayerAddress = "0x2222222222222222222222222222222222222222" as const;
const responseHash = `0x${"ab".repeat(32)}` as const;

function fixture() {
  const secrets = createTokenlessRaterRoundSecrets({
    roundId: 77n,
    vote: 1,
    predictedUpBps: 7_000,
    responseHash,
  });
  const entitlement = {
    schemaVersion: "rateloop.feedback-bonus-entitlement.v1" as const,
    roundId: "77",
    chainId: 84_532,
    contractAddress,
    poolId: "9",
    feedbackId: "feedback_public_77",
    responseHash,
    voteKey: secrets.reveal.voteKey,
    payoutCommitment: tokenlessPayoutCommitment(secrets.reveal.payoutAddress, secrets.reveal.salt),
    awardAmountAtomic: "2500000",
    awarded: true,
    claimed: false,
  };
  return { secrets, entitlement };
}

test("builds a claim only from the local recovery preimage bound to exact public evidence", () => {
  const { secrets, entitlement } = fixture();
  const authorization = buildFeedbackBonusClaimAuthorization({ entitlement, secrets, relayerAddress });
  assert.equal(authorization.poolId, 9n);
  assert.equal(authorization.voteKey, secrets.reveal.voteKey);
  assert.equal(authorization.payoutAddress, secrets.reveal.payoutAddress);
  assert.equal(authorization.payoutSalt, secrets.reveal.salt);
  assert.equal(authorization.amountAtomic, 2_500_000n);
  assert.match(authorization.transactionData, /^0x[0-9a-f]+$/u);
});

test("rejects recovery material for another response or payout commitment", () => {
  const { secrets, entitlement } = fixture();
  assert.throws(
    () =>
      buildFeedbackBonusClaimAuthorization({
        entitlement: { ...entitlement, responseHash: `0x${"cd".repeat(32)}` },
        secrets,
        relayerAddress,
      }),
    /does not match the registered feedback response/u,
  );
  assert.throws(
    () =>
      buildFeedbackBonusClaimAuthorization({
        entitlement: { ...entitlement, payoutCommitment: `0x${"ef".repeat(32)}` },
        secrets,
        relayerAddress,
      }),
    /cannot open the Feedback Bonus payout commitment/u,
  );
});

test("confirms the exact relayed transaction and FeedbackAwardClaimed event", () => {
  const { secrets, entitlement } = fixture();
  const authorization = buildFeedbackBonusClaimAuthorization({ entitlement, secrets, relayerAddress });
  const topics = encodeEventTopics({
    abi: [
      {
        type: "event",
        name: "FeedbackAwardClaimed",
        inputs: [
          { name: "poolId", type: "uint256", indexed: true },
          { name: "feedbackKey", type: "bytes32", indexed: true },
          { name: "payoutAddress", type: "address", indexed: true },
          { name: "amount", type: "uint256", indexed: false },
        ],
      },
    ] as const,
    eventName: "FeedbackAwardClaimed",
    args: {
      poolId: authorization.poolId,
      feedbackKey: authorization.feedbackKey,
      payoutAddress: authorization.payoutAddress,
    },
  }).map(topic => {
    if (typeof topic !== "string") throw new Error("Expected one encoded topic per indexed scalar.");
    return topic;
  });
  const evidence = {
    transactionHash: `0x${"12".repeat(32)}` as const,
    transactionFrom: relayerAddress,
    transactionTo: contractAddress,
    transactionData: authorization.transactionData,
    receiptStatus: "success" as const,
    logs: [
      {
        address: contractAddress,
        topics,
        data: encodeAbiParameters(parseAbiParameters("uint256 amount"), [authorization.amountAtomic]),
      },
    ],
  };
  assert.deepEqual(verifyFeedbackBonusClaimEvidence({ authorization, evidence }), {
    transactionHash: evidence.transactionHash,
    claimedAmountAtomic: 2_500_000n,
  });
  assert.throws(
    () =>
      verifyFeedbackBonusClaimEvidence({
        authorization,
        evidence: { ...evidence, transactionFrom: "0x3333333333333333333333333333333333333333" },
      }),
    /not the exact authorized Feedback Bonus claim/u,
  );
});

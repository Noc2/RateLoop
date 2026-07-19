import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  type FeedbackBonusAwardRepository,
  type PreparedFeedbackBonusAward,
  createFeedbackBonusAwardService,
} from "~~/lib/tokenless/feedbackBonusAwards";
import {
  hashPreparedHumanReviewValue,
  prepareHumanReviewRequest,
} from "~~/lib/tokenless/humanReviewRequestPreparation";
import { projectPrivateHumanReviewResultEnvelope } from "~~/lib/tokenless/humanReviewResultProjection";
import { paidReviewRequiresEligibility } from "~~/lib/tokenless/paidReviewEligibilityPreflight";
import {
  type ReviewRequestProfileInput,
  hashReviewRequestProfile,
  normalizeReviewRequestProfileInput,
} from "~~/lib/tokenless/reviewRequestProfiles";

const REQUESTER = "0x1111111111111111111111111111111111111111";
const DESIGNATED_AWARDER = "0x2222222222222222222222222222222222222222";
const AGENT_ACCOUNT = "0x3333333333333333333333333333333333333333";
const FEEDBACK_BONUS_CONTRACT = "0x4444444444444444444444444444444444444444";
const NOW = new Date("2026-07-16T12:00:00.000Z");
const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}` as const;

function privateProfile(input: {
  baseBounty: boolean;
  feedbackBonus: boolean;
  awarderKind?: "requester" | "designated";
}): ReviewRequestProfileInput {
  const awarderKind = input.awarderKind ?? "requester";
  return {
    agentId: "agent_feedback_bonus_flow",
    agentVersionId: "agent_version_feedback_bonus_flow",
    questionAuthority: "owner_fixed",
    criterion: "Should this private agent answer be used?",
    positiveLabel: "Use",
    negativeLabel: "Revise",
    rationaleMode: "required",
    audience: "private_invited",
    contentBoundary: "private_workspace",
    privateSensitivity: "confidential",
    privateGroupId: "private_group_feedback_bonus_flow",
    privateGroupPolicyVersion: 4,
    privateGroupPolicyHash: `sha256:${"a".repeat(64)}`,
    responseWindowSeconds: 3_600,
    panelSize: 2,
    compensationMode: input.baseBounty ? "usdc" : "unpaid",
    bountyPerSeatAtomic: input.baseBounty ? "1000000" : null,
    feedbackBonusEnabled: input.feedbackBonus,
    feedbackBonusPoolAtomic: input.feedbackBonus ? "5000000" : null,
    feedbackBonusAwarderKind: awarderKind,
    feedbackBonusAwarderAccount: awarderKind === "designated" ? DESIGNATED_AWARDER : null,
    feedbackBonusAwardWindowSeconds: input.feedbackBonus ? 604_800 : null,
  };
}

function preparePrivateProfile(input: {
  baseBounty: boolean;
  feedbackBonus: boolean;
  awarderKind?: "requester" | "designated";
}) {
  const profileInput = privateProfile(input);
  const normalized = normalizeReviewRequestProfileInput(profileInput);
  const sourcePayload = JSON.stringify({ document: "confidential-source" });
  const suggestionPayload = JSON.stringify({ answer: "agent-suggestion" });
  return prepareHumanReviewRequest({
    opportunityId: `opportunity_${input.baseBounty}_${input.feedbackBonus}_${input.awarderKind ?? "requester"}`,
    workflowKey: "workflow_feedback_bonus_flow",
    requestProfile: {
      ...normalized,
      id: "review_profile_feedback_bonus_flow",
      version: 1,
      hash: hashReviewRequestProfile(profileInput) as `sha256:${string}`,
    },
    selectionPolicy: { id: "selection_policy_feedback_bonus_flow", version: 1 },
    contentCommitments: { source: digest(sourcePayload), suggestion: digest(suggestionPayload) },
    preparedAt: NOW,
    expiresAt: new Date(NOW.getTime() + 3_600_000),
    sourcePayload,
    suggestionPayload,
  });
}

test("private invited review supports every independent base-bounty and Feedback Bonus combination", () => {
  const expectedMaximumConsent = new Map([
    ["false:false", "0"],
    ["false:true", "5000000"],
    ["true:false", "3800000"],
    ["true:true", "8800000"],
  ]);

  for (const baseBounty of [false, true]) {
    for (const feedbackBonus of [false, true]) {
      const prepared = preparePrivateProfile({ baseBounty, feedbackBonus });
      assert.equal(prepared.preparedRequest.audience.kind, "private_invited");
      assert.equal(prepared.derivedEconomics.compensationMode, baseBounty ? "usdc" : "unpaid");
      assert.equal(prepared.feedbackBonusEconomics.enabled, feedbackBonus);
      assert.equal(prepared.feedbackBonusEconomics.poolAtomic, feedbackBonus ? "5000000" : "0");
      assert.equal(prepared.feedbackBonusEconomics.awarder.kind, "requester");
      assert.equal(prepared.feedbackBonusEconomics.agentMayAward, false);
      assert.equal(prepared.maximumConsentAtomic, expectedMaximumConsent.get(`${baseBounty}:${feedbackBonus}`));
      assert.equal(
        paidReviewRequiresEligibility({
          lane: "private_invited",
          guaranteedCompensationMode: baseBounty ? "usdc" : "unpaid",
          feedbackBonusMode: feedbackBonus ? "usdc" : "off",
        }),
        baseBounty || feedbackBonus,
      );
    }
  }
});

type AwardRepositoryState = {
  awardedFeedback: Set<string>;
  confirmed: Array<PreparedFeedbackBonusAward & { transactionHash: string; confirmedAt: Date }>;
  remainingPoolAtomic(): string;
};

function inMemoryAwardRepository(awarderAccount: string): {
  repository: FeedbackBonusAwardRepository;
  state: AwardRepositoryState;
} {
  const feedback = new Map([
    [
      "feedback_one",
      {
        responseHash: digest("response-one"),
        voteKey: "0x5555555555555555555555555555555555555555",
        payoutCommitment: `0x${"8".repeat(64)}`,
        bodyReference: "feedback-body:one",
      },
    ],
    [
      "feedback_two",
      {
        responseHash: digest("response-two"),
        voteKey: "0x6666666666666666666666666666666666666666",
        payoutCommitment: `0x${"a".repeat(64)}`,
        bodyReference: "feedback-body:two",
      },
    ],
  ]);
  const intents = new Map<string, PreparedFeedbackBonusAward>();
  const awardedFeedback = new Set<string>();
  const confirmed: Array<PreparedFeedbackBonusAward & { transactionHash: string; confirmedAt: Date }> = [];
  let awardedAtomic = 0n;

  const repository: FeedbackBonusAwardRepository = {
    async listEligible(input) {
      if (input.awarderAccount !== awarderAccount) return [];
      return [...feedback]
        .filter(([feedbackId]) => !awardedFeedback.has(feedbackId))
        .map(([feedbackId, value]) => ({
          workspace_id: input.workspaceId,
          opportunity_id: "opportunity_feedback_bonus_awards",
          feedback_id: feedbackId,
          response_hash: value.responseHash,
          vote_key: value.voteKey,
          payout_commitment: value.payoutCommitment,
          body_reference: value.bodyReference,
          deposited_amount_atomic: "5000000",
          awarded_amount_atomic: awardedAtomic.toString(),
          feedback_deadline: "2026-07-16T11:00:00.000Z",
          award_deadline: "2026-07-23T11:00:00.000Z",
          chain_id: "84532",
          contract_address: FEEDBACK_BONUS_CONTRACT,
          pool_id: "41",
        }));
    },
    async prepare(input) {
      const previous = intents.get(input.idempotencyKey);
      if (previous) {
        if (previous.feedbackId !== input.feedbackId || previous.amountAtomic !== input.amountAtomic) {
          throw new Error("An idempotency key cannot select a different award.");
        }
        return previous;
      }
      if (input.awarderAccount !== awarderAccount) {
        throw new Error("Only the frozen human awarder may select Feedback Bonus recipients.");
      }
      const selected = feedback.get(input.feedbackId);
      if (!selected || awardedFeedback.has(input.feedbackId)) throw new Error("Feedback is not awardable.");
      if (BigInt(input.amountAtomic) > 5_000_000n - awardedAtomic)
        throw new Error("Feedback Bonus pool is insufficient.");
      const prepared: PreparedFeedbackBonusAward = {
        intentId: `intent_${intents.size + 1}`,
        workspaceId: input.workspaceId,
        opportunityId: "opportunity_feedback_bonus_awards",
        feedbackId: input.feedbackId,
        responseHash: selected.responseHash,
        voteKey: selected.voteKey,
        payoutCommitment: selected.payoutCommitment,
        awarderWallet: DESIGNATED_AWARDER,
        amountAtomic: input.amountAtomic,
        pool: { chainId: "84532", contractAddress: FEEDBACK_BONUS_CONTRACT, poolId: "41" },
        confirmedReceipt: null,
      };
      intents.set(input.idempotencyKey, prepared);
      return prepared;
    },
    async confirm(input) {
      const prepared = intents.get([...intents].find(([, intent]) => intent.intentId === input.intentId)?.[0] ?? "");
      if (!prepared) throw new Error("Prepared award disappeared.");
      if (prepared.confirmedReceipt) return;
      prepared.confirmedReceipt = { transactionHash: input.transactionHash, confirmedAt: input.confirmedAt };
      awardedAtomic += BigInt(input.amountAtomic);
      awardedFeedback.add(input.feedbackId);
      confirmed.push(input);
    },
    async fail() {},
  };

  return {
    repository,
    state: {
      awardedFeedback,
      confirmed,
      remainingPoolAtomic: () => (5_000_000n - awardedAtomic).toString(),
    },
  };
}

test("requester-default and designated humans can make partial, multiple, idempotent awards while the agent cannot", async () => {
  for (const awarderKind of ["requester", "designated"] as const) {
    const preparedRequest = preparePrivateProfile({
      baseBounty: awarderKind === "designated",
      feedbackBonus: true,
      awarderKind,
    });
    const humanAwarder = awarderKind === "requester" ? REQUESTER : DESIGNATED_AWARDER;
    assert.deepEqual(preparedRequest.feedbackBonusEconomics.awarder, {
      kind: awarderKind,
      account: awarderKind === "requester" ? null : DESIGNATED_AWARDER,
    });
    assert.equal(preparedRequest.feedbackBonusEconomics.agentMayAward, false);

    const { repository, state } = inMemoryAwardRepository(humanAwarder);
    let executions = 0;
    const service = createFeedbackBonusAwardService({
      repository,
      readFeedbackBody: async input => `Written ${input.bodyReference}`,
      prepareHumanAward: async () => ({
        chainId: 84_532,
        contractAddress: FEEDBACK_BONUS_CONTRACT,
        awarderAddress: humanAwarder,
        transactionData: "0x1234",
      }),
      confirmHumanAward: async () => ({
        transactionHash: `0x${String(++executions).padStart(64, "0")}`,
        confirmedAt: NOW,
      }),
    });
    const award = async (input: Parameters<typeof service.prepareAward>[0]) => {
      const prepared = await service.prepareAward(input);
      if (prepared.status === "confirmed") return prepared;
      return service.confirmAward({
        ...input,
        transactionHash: `0x${String(executions + 1).padStart(64, "0")}`,
      });
    };

    assert.equal(
      (await service.list({ accountAddress: AGENT_ACCOUNT, workspaceId: "workspace_flow", now: NOW })).items.length,
      0,
    );
    assert.equal(
      (await service.list({ accountAddress: humanAwarder, workspaceId: "workspace_flow", now: NOW })).items.length,
      2,
    );
    await assert.rejects(
      service.prepareAward({
        accountAddress: AGENT_ACCOUNT,
        workspaceId: "workspace_flow",
        feedbackId: "feedback_one",
        amountAtomic: "1000000",
        idempotencyKey: `agent-award:${awarderKind}`,
        now: NOW,
      }),
      /Only the frozen human awarder/u,
    );
    assert.equal(executions, 0);

    const first = await award({
      accountAddress: humanAwarder,
      workspaceId: "workspace_flow",
      feedbackId: "feedback_one",
      amountAtomic: "1000000",
      idempotencyKey: `human-award-one:${awarderKind}`,
      now: NOW,
    });
    await award({
      accountAddress: humanAwarder,
      workspaceId: "workspace_flow",
      feedbackId: "feedback_two",
      amountAtomic: "2000000",
      idempotencyKey: `human-award-two:${awarderKind}`,
      now: NOW,
    });
    const replay = await award({
      accountAddress: humanAwarder,
      workspaceId: "workspace_flow",
      feedbackId: "feedback_one",
      amountAtomic: "1000000",
      idempotencyKey: `human-award-one:${awarderKind}`,
      now: NOW,
    });

    assert.deepEqual(replay.receipt, first.receipt);
    assert.equal(executions, 2);
    assert.equal(state.confirmed.length, 2);
    assert.deepEqual(state.awardedFeedback, new Set(["feedback_one", "feedback_two"]));
    assert.equal(state.remainingPoolAtomic(), "2000000");
  }
});

test("terminal private result projects the unawarded Feedback Bonus remainder as a refund", () => {
  const result = projectPrivateHumanReviewResultEnvelope({
    workspaceId: "workspace_feedback_bonus_refund",
    integrationId: "integration_feedback_bonus_refund",
    opportunityId: "opportunity_feedback_bonus_refund",
    lane: "private_unpaid",
    lifecycle: {
      state: "completed",
      terminal: true,
      revision: 5,
      reasonCodes: ["feedback_bonus_award_window_closed"],
      startedAt: "2026-07-16T10:00:00.000Z",
      stateEnteredAt: "2026-07-23T11:00:00.000Z",
      finalizedAt: "2026-07-23T11:00:01.000Z",
    },
    frozen: {
      selectionPolicy: { id: "selection_refund", version: 1, hash: digest("selection-refund") },
      binding: { id: "binding_refund", version: 1, hash: digest("binding-refund") },
      requestProfile: { id: "profile_refund", version: 1, hash: digest("profile-refund") },
      responseDeadline: "2026-07-16T11:00:00.000Z",
    },
    panel: {
      requestedCount: 2,
      assignedCount: 2,
      responseCount: 2,
      cohorts: [{ source: "invited", requestedCount: 2, assignedCount: 2, responseCount: 2 }],
    },
    outcome: "positive",
    rationale: { summaryAllowed: false, aggregateSummary: null },
    economics: {
      asset: "USDC",
      decimals: 6,
      guaranteedBase: { mode: "off", fundedAtomic: "0", paidAtomic: "0", refundedAtomic: "0" },
      automaticQualityAllocation: { mode: "off", availableAtomic: "0", awardedAtomic: "0", refundedAtomic: "0" },
      feedbackBonus: {
        mode: "usdc",
        fundedAtomic: "5000000",
        awardedAtomic: "3000000",
        refundedAtomic: "2000000",
        awards: [
          { awardId: "award_one", responseCommitment: digest("response-one"), amountAtomic: "1000000" },
          { awardId: "award_two", responseCommitment: digest("response-two"), amountAtomic: "2000000" },
        ],
      },
    },
    commitments: {
      sourceArtifact: digest("source-refund"),
      suggestionArtifact: digest("suggestion-refund"),
      responseSet: digest("response-set-refund"),
      result: digest("result-refund"),
    },
    terminalEvidence: null,
  });

  assert.equal(result.economics.guaranteedBase.mode, "off");
  assert.deepEqual(result.economics.feedbackBonus, {
    mode: "usdc",
    fundedAtomic: "5000000",
    awardedAtomic: "3000000",
    refundedAtomic: "2000000",
    awards: [
      { awardId: "award_one", responseCommitment: digest("response-one"), amountAtomic: "1000000" },
      { awardId: "award_two", responseCommitment: digest("response-two"), amountAtomic: "2000000" },
    ],
  });
  assert.match(hashPreparedHumanReviewValue(result.economics.feedbackBonus), /^sha256:[0-9a-f]{64}$/u);
});

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { createWorkspaceAgent } from "~~/lib/tokenless/agentRegistry";
import {
  type FeedbackBonusPoolCreatedReceipt,
  type FeedbackBonusPoolTerms,
  createFeedbackBonusPoolService,
  projectFeedbackRegistered,
} from "~~/lib/tokenless/feedbackBonusPoolProjection";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import { seedReadyHumanReviewBinding } from "~~/lib/tokenless/testing/humanReviewBindingFixture";

const OWNER = "0x1111111111111111111111111111111111111111";
const AWARDER_WALLET = "0x2222222222222222222222222222222222222222";
const FUNDER_WALLET = "0x3333333333333333333333333333333333333333";
const CONTRACT = "0x4444444444444444444444444444444444444444";
const REVIEW_ID = `0x${"11".repeat(32)}` as const;
const CONTENT_ID = `0x${"22".repeat(32)}` as const;
const ADMISSION = `0x${"33".repeat(32)}` as const;
const TX = `0x${"44".repeat(32)}` as const;
const FEEDBACK_DEADLINE = new Date("2026-07-17T12:00:00.000Z");
const AWARD_DEADLINE = new Date("2026-07-24T12:00:00.000Z");

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

function hash(byte: string) {
  return `sha256:${byte.repeat(64)}` as `sha256:${string}`;
}

async function fixture(designated = false) {
  const now = new Date("2026-07-16T12:00:00.000Z");
  const { workspaceId } = await createWorkspace({ name: "Feedback Bonus projection", ownerAddress: OWNER });
  const agent = await createWorkspaceAgent({
    accountAddress: OWNER,
    workspaceId,
    externalId: "feedback-bonus-agent",
    version: {
      displayName: "Feedback Bonus agent",
      provider: "OpenAI",
      model: "gpt-test",
      modelVersion: "2026-07",
      environment: "staging",
    },
  });
  const policyId = `policy_${workspaceId.slice(-12)}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_review_policies
          (policy_id,version,workspace_id,agent_id,agent_version_id,mode,enabled,agreement_threshold_bps,
           production_floor_bps,maximum_unreviewed_gap,rules_json,audience_policy_json,publishing_policy_id,
           created_by,approved_by,created_at)
          VALUES (?,1,?,?,?,'always',true,9000,1000,10,'{}','{"reviewerSource":"public_network"}',NULL,?,?,?)`,
    args: [policyId, workspaceId, agent.agentId, agent.currentVersion.versionId, OWNER, OWNER, now],
  });
  const frozen = await seedReadyHumanReviewBinding({
    workspaceId,
    agentId: agent.agentId,
    agentVersionId: agent.currentVersion.versionId,
    policyId,
    actor: OWNER,
    feedbackBonus: {
      poolAtomic: "5000000",
      awardWindowSeconds: 604_800,
      awarderKind: designated ? "designated" : "requester",
      awarderAccount: designated ? "principal_designated_awarder" : null,
    },
  });
  const scopeId = `scope_${workspaceId.slice(-12)}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_evaluation_scopes
          (scope_id,workspace_id,agent_id,agent_version_id,policy_id,policy_version,workflow_key,risk_tier,
           audience_policy_hash,partition_commitment,execution_profile_hash,execution_profile_json,
           human_review_binding_id,human_review_binding_version,request_profile_id,request_profile_version,
           request_profile_hash,stage,completed_comparable_cases,stable_cases_since_stage,
           unreviewed_since_last_sample,stage_entered_at,updated_at)
          VALUES (?,?,?,?,?,1,'feedback','normal',?,?,?,'{}',?,1,?,1,?,'calibrating',0,0,0,?,?)`,
    args: [
      scopeId,
      workspaceId,
      agent.agentId,
      agent.currentVersion.versionId,
      policyId,
      hash("a"),
      hash("b"),
      hash("c"),
      frozen.bindingId,
      frozen.profileId,
      frozen.profileHash,
      now,
      now,
    ],
  });
  const opportunityId = `opportunity_${workspaceId.slice(-12)}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_review_opportunities
          (opportunity_id,workspace_id,agent_id,agent_version_id,scope_id,policy_id,policy_version,
           external_opportunity_id,suggestion_commitment,declared_confidence_bps,metadata_commitment,
           metadata_complete,critical_risk,decision,review_rate_bps,selection_probability_bps,sample_bucket,
           sampler_key_version,sampler_commitment,reason_codes_json,status,source_evidence_reference,
           source_evidence_hash,human_review_binding_id,human_review_binding_version,request_profile_id,
           request_profile_version,request_profile_hash,created_at,updated_at)
          VALUES (?,?,?,?,?,?,1,?,?,9000,?,true,false,'required',10000,10000,1,'test-v1',?,'[]','decided',
                  'feedback/source',?,?,1,?,1,?,?,?)`,
    args: [
      opportunityId,
      workspaceId,
      agent.agentId,
      agent.currentVersion.versionId,
      scopeId,
      policyId,
      `external_${opportunityId}`,
      hash("d"),
      hash("e"),
      hash("f"),
      hash("0"),
      frozen.bindingId,
      frozen.profileId,
      frozen.profileHash,
      now,
      now,
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_review_opportunity_lifecycles
          (workspace_id,opportunity_id,state,state_revision,reason_codes_json,state_entered_at,terminal_at,created_at,updated_at)
          VALUES (?,?,'request_ready',1,'[]',?,NULL,?,?)`,
    args: [workspaceId, opportunityId, now, now, now],
  });
  const terms: FeedbackBonusPoolTerms = {
    workspaceId,
    opportunityId,
    agentId: agent.agentId,
    requestProfile: { id: frozen.profileId, version: 1, hash: frozen.profileHash as `sha256:${string}` },
    reviewId: REVIEW_ID,
    contentId: CONTENT_ID,
    admissionPolicyHash: ADMISSION,
    depositedAmountAtomic: "5000000",
    feedbackDeadline: FEEDBACK_DEADLINE,
    awardDeadline: AWARD_DEADLINE,
    humanAwarderSubject: designated ? "principal_designated_awarder" : OWNER,
    awarderWallet: AWARDER_WALLET,
    funderWallet: FUNDER_WALLET,
    consent: {
      reference: `profile:${frozen.profileId}:1`,
      authorizedBy: OWNER,
      baseMaximumChargeAtomic: "1000000",
      feedbackBonusMaximumAtomic: "5000000",
      totalMaximumConsentAtomic: "6000000",
    },
  };
  return { terms };
}

function receipt(terms: FeedbackBonusPoolTerms): FeedbackBonusPoolCreatedReceipt {
  return {
    chainId: 84_532,
    contractAddress: CONTRACT,
    transactionHash: TX,
    blockNumber: 123n,
    logIndex: 2,
    event: {
      poolId: "7",
      reviewId: terms.reviewId,
      contentId: terms.contentId,
      admissionPolicyHash: terms.admissionPolicyHash,
      payer: FUNDER_WALLET,
      funder: FUNDER_WALLET,
      awarder: AWARDER_WALLET,
      amountAtomic: terms.depositedAmountAtomic,
      feedbackDeadline: terms.feedbackDeadline,
      awardDeadline: terms.awardDeadline,
    },
  };
}

test("creates exactly one separately consented pool and replays the frozen binding", async () => {
  const { terms } = await fixture();
  let calls = 0;
  const ensure = createFeedbackBonusPoolService({
    async createAndFundPool() {
      calls += 1;
      return receipt(terms);
    },
  });
  const first = await ensure(terms);
  const replay = await ensure(terms);
  assert.equal(calls, 1);
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  const stored = await dbClient.execute({
    sql: `SELECT awarder_account,awarder_wallet,deposited_amount_atomic FROM tokenless_feedback_bonus_pools
          WHERE workspace_id=? AND opportunity_id=?`,
    args: [terms.workspaceId, terms.opportunityId],
  });
  assert.equal(stored.rows[0]?.awarder_account, OWNER);
  assert.equal(stored.rows[0]?.awarder_wallet, AWARDER_WALLET.toLowerCase());
  assert.equal(String(stored.rows[0]?.deposited_amount_atomic), "5000000");
});

test("hosted execution and feedback registration fail closed without exact chain and local receipts", async () => {
  const { terms } = await fixture();
  await assert.rejects(
    createFeedbackBonusPoolService()(terms),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.code === "feedback_bonus_pool_execution_unavailable",
  );
  const ensure = createFeedbackBonusPoolService({
    async createAndFundPool() {
      return receipt(terms);
    },
  });
  await ensure(terms);
  await assert.rejects(
    projectFeedbackRegistered({
      workspaceId: terms.workspaceId,
      opportunityId: terms.opportunityId,
      feedbackId: "feedback_missing",
      bodyReference: "rateloop.feedback-body.v1:public_rater_response:missing",
      registeredAt: new Date("2026-07-17T10:00:00.000Z"),
      receipt: {
        chainId: 84_532,
        contractAddress: CONTRACT,
        transactionHash: `0x${"55".repeat(32)}`,
        blockNumber: 124n,
        logIndex: 1,
        event: {
          poolId: "7",
          feedbackKey: `0x${"66".repeat(32)}`,
          responseHash: `0x${"77".repeat(32)}`,
          voteKey: OWNER,
          payoutCommitment: `0x${"88".repeat(32)}`,
        },
      },
    }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "feedback_bonus_body_binding_mismatch",
  );
});

test("keeps requester consent separate from a designated human and exact awarder wallet", async () => {
  const { terms } = await fixture(true);
  const ensure = createFeedbackBonusPoolService({
    async createAndFundPool() {
      return receipt(terms);
    },
  });
  await ensure(terms);
  const stored = await dbClient.execute({
    sql: `SELECT awarder_account,awarder_wallet FROM tokenless_feedback_bonus_pools
          WHERE workspace_id=? AND opportunity_id=?`,
    args: [terms.workspaceId, terms.opportunityId],
  });
  assert.equal(stored.rows[0]?.awarder_account, "principal_designated_awarder");
  assert.equal(stored.rows[0]?.awarder_wallet, AWARDER_WALLET.toLowerCase());
  assert.equal(terms.consent.authorizedBy, OWNER);
});

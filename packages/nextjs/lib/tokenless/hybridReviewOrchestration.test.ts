import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { createWorkspaceAgent } from "~~/lib/tokenless/agentRegistry";
import {
  cancelHybridReviewBeforeLiability,
  completeHybridReviewPreparation,
  ensureHybridReviewOperation,
  recordHybridReviewChildLiability,
  recordHybridReviewChildReady,
  recordHybridReviewChildTerminal,
  type HybridReviewParentSeed,
} from "~~/lib/tokenless/hybridReviewOrchestration";
import {
  createHybridHumanReviewAdapter,
  type FrozenHybridReviewSplit,
  type HybridSubpanelPreparation,
} from "~~/lib/tokenless/hybridHumanReviewAdapter";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import { seedReadyHumanReviewBinding } from "~~/lib/tokenless/testing/humanReviewBindingFixture";

const NOW = new Date("2026-07-26T13:00:00.000Z");
const OWNER = "0x1111111111111111111111111111111111111111";
let sequence = 0;

function hash(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}` as const;
}

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

async function fixture(): Promise<HybridReviewParentSeed> {
  const label = String(++sequence);
  const { workspaceId } = await createWorkspace({ name: `Hybrid orchestration ${label}`, ownerAddress: OWNER });
  const agent = await createWorkspaceAgent({
    accountAddress: OWNER,
    workspaceId,
    externalId: `hybrid-orchestration-${label}`,
    version: {
      displayName: `Hybrid orchestration ${label}`,
      provider: "OpenAI",
      model: "gpt-test",
      modelVersion: "2026-07",
      environment: "staging",
    },
  });
  const policyId = `policy_hybrid_${label}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_review_policies
          (policy_id,version,workspace_id,agent_id,agent_version_id,mode,enabled,agreement_threshold_bps,
           production_floor_bps,maximum_unreviewed_gap,rules_json,audience_policy_json,publishing_policy_id,
           created_by,approved_by,created_at)
          VALUES (?,1,?,?,?,'always',true,9000,1000,10,'{}','{"reviewerSource":"hybrid"}',NULL,?,?,?)`,
    args: [policyId, workspaceId, agent.agentId, agent.currentVersion.versionId, OWNER, OWNER, NOW],
  });
  const frozen = await seedReadyHumanReviewBinding({
    workspaceId,
    agentId: agent.agentId,
    agentVersionId: agent.currentVersion.versionId,
    policyId,
    actor: OWNER,
  });
  const scopeId = `scope_hybrid_${label}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_evaluation_scopes
          (scope_id,workspace_id,agent_id,agent_version_id,policy_id,policy_version,workflow_key,risk_tier,
           audience_policy_hash,partition_commitment,execution_profile_hash,execution_profile_json,
           human_review_binding_id,human_review_binding_version,request_profile_id,request_profile_version,
           request_profile_hash,stage,completed_comparable_cases,stable_cases_since_stage,
           unreviewed_since_last_sample,stage_entered_at,updated_at)
          VALUES (?,?,?,?,?,1,'hybrid','normal',?,?,?,'{}',?,1,?,1,?,'calibrating',0,0,0,?,?)`,
    args: [
      scopeId,
      workspaceId,
      agent.agentId,
      agent.currentVersion.versionId,
      policyId,
      hash(["audience", label]),
      hash(["partition", label]),
      hash(["execution", label]),
      frozen.bindingId,
      frozen.profileId,
      frozen.profileHash,
      NOW,
      NOW,
    ],
  });
  const opportunityId = `opportunity_hybrid_${label}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_review_opportunities
          (opportunity_id,workspace_id,agent_id,agent_version_id,scope_id,policy_id,policy_version,
           external_opportunity_id,suggestion_commitment,declared_confidence_bps,metadata_commitment,
           metadata_complete,critical_risk,decision,review_rate_bps,selection_probability_bps,sample_bucket,
           sampler_key_version,sampler_commitment,reason_codes_json,status,source_evidence_reference,
           source_evidence_hash,human_review_binding_id,human_review_binding_version,request_profile_id,
           request_profile_version,request_profile_hash,created_at,updated_at)
          VALUES (?,?,?,?,?,?,1,?,?,9000,?,true,false,'required',10000,10000,1,'test-v1',?,'[]','decided',
                  'hybrid/source',?,?,1,?,1,?,?,?)`,
    args: [
      opportunityId,
      workspaceId,
      agent.agentId,
      agent.currentVersion.versionId,
      scopeId,
      policyId,
      `external_${opportunityId}`,
      hash(["suggestion", label]),
      hash(["metadata", label]),
      hash(["sampler", label]),
      hash(["source-evidence", label]),
      frozen.bindingId,
      frozen.profileId,
      frozen.profileHash,
      NOW,
      NOW,
    ],
  });
  return {
    workspaceId,
    opportunityId,
    parentBindingHash: hash(["parent", label]),
    requestProfileHash: hash(["profile", label]),
    audiencePolicyHash: hash(["audience", label]),
    sourceCommitment: hash(["source", label]),
    suggestionCommitment: hash(["suggestion", label]),
    children: [
      {
        cohort: "invited",
        childBindingHash: hash(["child", "invited", label]),
        economicsHash: hash(["economics", "invited", label]),
        expertiseHash: hash(["expertise", "invited", label]),
        admissionPolicyHash: hash(["admission", "invited", label]),
        expectedAmountAtomic: "200",
        assignmentCount: 2,
      },
      {
        cohort: "network",
        childBindingHash: hash(["child", "network", label]),
        economicsHash: hash(["economics", "network", label]),
        expertiseHash: hash(["expertise", "network", label]),
        admissionPolicyHash: hash(["admission", "network", label]),
        expectedAmountAtomic: "300",
        assignmentCount: 3,
      },
    ],
  };
}

function evidence(cohort: "invited" | "network", roundId: string) {
  return {
    sourceKind: cohort === "invited" ? ("private_paid_assignment" as const) : ("public_network_assignment" as const),
    sourceOperationReference: `${cohort}:operation`,
    sourceRunId: `${cohort}:run`,
    deploymentKey: "tokenless:test",
    chainId: 84532,
    panelAddress:
      cohort === "invited"
        ? "0x2222222222222222222222222222222222222222"
        : "0x3333333333333333333333333333333333333333",
    roundId,
    chainAdmissionPolicyHash: `0x${(cohort === "invited" ? "a" : "b").repeat(64)}` as const,
    assignmentEvidenceHash: hash(["assignments", cohort]),
    voucherPreparationHash: hash(["voucher-preparation", cohort]),
    settlementBindingHash: hash(["settlement-binding", cohort]),
  };
}

test("one persisted parent idempotently owns exactly two distinct ready paid children", async () => {
  const seed = await fixture();
  const first = await ensureHybridReviewOperation(seed, NOW);
  const replay = await ensureHybridReviewOperation(seed, NOW);
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.operation.children.length, 2);

  await recordHybridReviewChildReady({
    hybridOperationId: first.operation.hybridOperationId,
    cohort: "invited",
    evidence: evidence("invited", "101"),
    now: NOW,
  });
  await recordHybridReviewChildReady({
    hybridOperationId: first.operation.hybridOperationId,
    cohort: "network",
    evidence: evidence("network", "102"),
    now: NOW,
  });
  const readyHash = hash(["hybrid-ready", seed.parentBindingHash]);
  const ready = await completeHybridReviewPreparation({
    hybridOperationId: first.operation.hybridOperationId,
    preparationEvidenceHash: readyHash,
    now: NOW,
  });
  const readyReplay = await completeHybridReviewPreparation({
    hybridOperationId: first.operation.hybridOperationId,
    preparationEvidenceHash: readyHash,
    now: NOW,
  });
  assert.equal(ready.operation.state, "ready");
  assert.equal(readyReplay.replayed, true);
  assert.deepEqual(
    ready.operation.children.map(child => [child.cohort, child.assignmentEvidenceHash, child.voucherPreparationHash]),
    [
      ["invited", hash(["assignments", "invited"]), hash(["voucher-preparation", "invited"])],
      ["network", hash(["assignments", "network"]), hash(["voucher-preparation", "network"])],
    ],
  );
  const rows = await dbClient.execute({
    sql: `SELECT
            (SELECT count(*) FROM tokenless_hybrid_review_operations) AS parents,
            (SELECT count(*) FROM tokenless_hybrid_review_children) AS children,
            (SELECT count(*) FROM tokenless_hybrid_review_receipts) AS receipts`,
  });
  assert.equal(Number(rows.rows[0]?.parents), 1);
  assert.equal(Number(rows.rows[0]?.children), 2);
  assert.equal(Number(rows.rows[0]?.receipts), 4);
});

test("the exact-round uniqueness constraint rejects reuse across cohorts", async () => {
  const seed = await fixture();
  const parent = await ensureHybridReviewOperation(seed, NOW);
  const same = evidence("invited", "201");
  await recordHybridReviewChildReady({
    hybridOperationId: parent.operation.hybridOperationId,
    cohort: "invited",
    evidence: same,
    now: NOW,
  });
  await assert.rejects(
    recordHybridReviewChildReady({
      hybridOperationId: parent.operation.hybridOperationId,
      cohort: "network",
      evidence: {
        ...evidence("network", "201"),
        deploymentKey: same.deploymentKey,
        chainId: same.chainId,
        panelAddress: same.panelAddress,
      },
      now: NOW,
    }),
  );
});

test("raw SQL rejects incomplete child tuples and mismatched or duplicate receipt scopes", async () => {
  const seed = await fixture();
  const parent = await ensureHybridReviewOperation(seed, NOW);
  const invited = parent.operation.children[0];
  await assert.rejects(
    dbClient.execute({
      sql: `UPDATE tokenless_hybrid_review_children
            SET state='ready',transition_revision=2,source_kind='private_paid_assignment',
                source_operation_reference='partial',updated_at=?
            WHERE child_id=?`,
      args: [NOW, invited.childId],
    }),
  );
  await assert.rejects(
    dbClient.execute({
      sql: `INSERT INTO tokenless_hybrid_review_receipts
            (receipt_id,hybrid_operation_id,child_id,receipt_type,transition_revision,
             evidence_hash,receipt_hash,created_at)
            VALUES (?,?,?,?,2,?,?,?)`,
      args: [
        "hybrid_receipt_mismatched",
        parent.operation.hybridOperationId,
        invited.childId,
        "parent_ready",
        hash("mismatched-evidence"),
        hash("mismatched-receipt"),
        NOW,
      ],
    }),
  );
  await assert.rejects(
    dbClient.execute({
      sql: `INSERT INTO tokenless_hybrid_review_receipts
            (receipt_id,hybrid_operation_id,child_id,receipt_type,transition_revision,
             evidence_hash,receipt_hash,created_at)
            VALUES (?,?,NULL,'parent_prepared',1,?,?,?)`,
      args: [
        "hybrid_receipt_duplicate_parent_revision",
        parent.operation.hybridOperationId,
        hash("duplicate-evidence"),
        hash("duplicate-receipt"),
        NOW,
      ],
    }),
  );
});

test("failure before acceptance releases both children and cancels once", async () => {
  const seed = await fixture();
  const parent = await ensureHybridReviewOperation(seed, NOW);
  await recordHybridReviewChildReady({
    hybridOperationId: parent.operation.hybridOperationId,
    cohort: "invited",
    evidence: evidence("invited", "301"),
    now: NOW,
  });
  const releases: string[][] = [];
  const cancelled = await cancelHybridReviewBeforeLiability({
    hybridOperationId: parent.operation.hybridOperationId,
    reasonCode: "network_preparation_failed",
    releaseChildren: async children => {
      releases.push(children.map(child => child.cohort));
    },
    now: NOW,
  });
  const replay = await cancelHybridReviewBeforeLiability({
    hybridOperationId: parent.operation.hybridOperationId,
    reasonCode: "network_preparation_failed",
    releaseChildren: async () => {
      throw new Error("A cancelled replay must not release twice.");
    },
    now: NOW,
  });
  assert.equal(cancelled.operation.state, "cancelled");
  assert.equal(replay.replayed, true);
  assert.deepEqual(releases, [["invited", "network"]]);
  assert.deepEqual(
    cancelled.operation.children.map(child => child.state),
    ["cancelled", "cancelled"],
  );
});

test("any accepted child permanently fences parent cancellation and both children finish paid terminal paths", async () => {
  const seed = await fixture();
  const parent = await ensureHybridReviewOperation(seed, NOW);
  await recordHybridReviewChildReady({
    hybridOperationId: parent.operation.hybridOperationId,
    cohort: "invited",
    evidence: evidence("invited", "401"),
    now: NOW,
  });
  await recordHybridReviewChildReady({
    hybridOperationId: parent.operation.hybridOperationId,
    cohort: "network",
    evidence: evidence("network", "402"),
    now: NOW,
  });
  await completeHybridReviewPreparation({
    hybridOperationId: parent.operation.hybridOperationId,
    preparationEvidenceHash: hash("ready"),
    now: NOW,
  });
  await recordHybridReviewChildLiability({
    hybridOperationId: parent.operation.hybridOperationId,
    cohort: "invited",
    acceptedCount: 1,
    committedCount: 0,
    now: NOW,
  });
  await assert.rejects(
    cancelHybridReviewBeforeLiability({
      hybridOperationId: parent.operation.hybridOperationId,
      reasonCode: "late_cancel",
      releaseChildren: async () => undefined,
      now: NOW,
    }),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.code === "hybrid_review_cancellation_blocked",
  );
  await recordHybridReviewChildTerminal({
    hybridOperationId: parent.operation.hybridOperationId,
    cohort: "invited",
    terminalCount: 2,
    settlementEvidenceHash: hash(["terminal", "invited"]),
    now: NOW,
  });
  const terminal = await recordHybridReviewChildTerminal({
    hybridOperationId: parent.operation.hybridOperationId,
    cohort: "network",
    terminalCount: 3,
    settlementEvidenceHash: hash(["terminal", "network"]),
    parentResultEvidenceHash: hash(["terminal", "parent"]),
    now: NOW,
  });
  assert.equal(terminal.operation.state, "terminal");
  assert.deepEqual(
    terminal.operation.children.map(child => child.settlementEvidenceHash),
    [hash(["terminal", "invited"]), hash(["terminal", "network"])],
  );
});

test("the adapter persists two child rounds end to end and retry cannot duplicate child spend", async () => {
  const seeded = await fixture();
  const INVITED = "0x4444444444444444444444444444444444444444";
  const NETWORK = "0x5555555555555555555555555555555555555555";
  const principal = (account: string) => `rlp_${account.slice(2, 26)}`;
  const split: FrozenHybridReviewSplit = {
    schemaVersion: "rateloop.hybrid-review-split.v2",
    workspaceId: seeded.workspaceId,
    opportunityId: seeded.opportunityId,
    audiencePolicyHash: seeded.audiencePolicyHash,
    requestProfileHash: seeded.requestProfileHash,
    semanticProfile: {
      schemaVersion: "rateloop.review-request-profile.v4",
      audience: "hybrid",
      audiencePolicyHash: seeded.audiencePolicyHash,
      execution: "two_distinct_rounds",
      invited: {
        reviewerSource: "customer_invited",
        panelSize: 1,
        admissionPolicyHash: seeded.children[0].admissionPolicyHash,
        economics: { asset: "USDC", bountyPerSeatAtomic: "200", maximumChargeAtomic: "200" },
        expertiseRequirements: [],
      },
      network: {
        reviewerSource: "rateloop_network",
        panelSize: 1,
        admissionPolicyHash: seeded.children[1].admissionPolicyHash,
        economics: { asset: "USDC", bountyPerSeatAtomic: "300", maximumChargeAtomic: "300" },
        expertiseRequirements: [],
      },
    },
    contentCommitments: { source: seeded.sourceCommitment, suggestion: seeded.suggestionCommitment },
    publication: {
      visibility: "public",
      dataClassification: "synthetic",
      confirmedNoSensitiveData: true,
    },
    economics: { asset: "USDC", invitedMaximumChargeAtomic: "200", networkMaximumChargeAtomic: "300" },
    invited: {
      requestedCount: 1,
      candidates: [
        {
          principalId: principal(INVITED),
          payoutAccount: INVITED,
          assignmentReference: "invited:selected-seat",
          assignmentHash: hash(["selected-seat", "invited"]),
        },
      ],
    },
    network: {
      requestedCount: 1,
      candidates: [
        {
          principalId: principal(NETWORK),
          payoutAccount: NETWORK,
          assignmentReference: "network:selected-seat",
          assignmentHash: hash(["selected-seat", "network"]),
        },
      ],
    },
  };
  const actualSpend = new Set<string>();
  const preparation = (
    cohort: "invited" | "network",
    hybridOperationId: string,
  ): HybridSubpanelPreparation => {
    const spendKey = `${hybridOperationId}:${cohort}`;
    const replayed = actualSpend.has(spendKey);
    actualSpend.add(spendKey);
    return {
      subpanelReference: `${cohort}:child`,
      bindingHash: hash(["binding", cohort]),
      sourceOperationReference: `${cohort}:operation`,
      sourceRunId: `${cohort}:run`,
      chainAdmissionPolicyHash: `0x${(cohort === "invited" ? "c" : "d").repeat(64)}`,
      selectedSeatEvidenceHash: hash(["selected-seats", cohort]),
      voucherPreparationHash: hash(["voucher-preparation", cohort]),
      settlementBindingHash: hash(["settlement-binding", cohort]),
      round: {
        deploymentKey: "tokenless:test",
        chainId: 84532,
        panelAddress:
          cohort === "invited"
            ? "0x6666666666666666666666666666666666666666"
            : "0x7777777777777777777777777777777777777777",
        roundId: cohort === "invited" ? "501" : "502",
        admissionPolicyHash:
          cohort === "invited"
            ? split.semanticProfile.invited.admissionPolicyHash
            : split.semanticProfile.network.admissionPolicyHash,
      },
      status: "ready",
      replayed,
    };
  };
  const adapter = createHybridHumanReviewAdapter({
    clock: () => NOW,
    requireEligibility: async ({ principalId, reviewerSource }) => {
      const payoutAccount = reviewerSource === "customer_invited" ? INVITED : NETWORK;
      return {
        schemaVersion: "rateloop.paid-review-eligibility-preflight.v1",
        preflightId: `pef_${payoutAccount.slice(2)}`,
        raterId: `rater_${payoutAccount.slice(2)}`,
        principalId,
        accountAddress: payoutAccount,
        payoutAccount,
        identityAssertions: [],
        checkedAt: NOW.toISOString(),
        validUntil: new Date(NOW.getTime() + 3_600_000).toISOString(),
        eligibilityCommitment: hash(["eligibility", principalId]),
      };
    },
    prepareInvited: async ({ hybridParent }) => preparation("invited", hybridParent.hybridOperationId),
    prepareNetwork: async ({ hybridParent }) => preparation("network", hybridParent.hybridOperationId),
    releaseInvited: async () => undefined,
    releaseNetwork: async () => undefined,
    orchestration: {
      ensure: ensureHybridReviewOperation,
      recordReady: recordHybridReviewChildReady,
      complete: completeHybridReviewPreparation,
      cancel: cancelHybridReviewBeforeLiability,
    },
  });
  const first = await adapter(split);
  const replay = await adapter(split);
  assert.equal(first.hybridOperationId, replay.hybridOperationId);
  assert.equal(first.splitBindingHash, replay.splitBindingHash);
  assert.equal(actualSpend.size, 2);
  assert.equal(replay.invited.replayed, true);
  assert.equal(replay.network.replayed, true);
  const persisted = await dbClient.execute({
    sql: `SELECT
            (SELECT count(*) FROM tokenless_hybrid_review_operations WHERE opportunity_id=?) AS parents,
            (SELECT count(*) FROM tokenless_hybrid_review_children child
             JOIN tokenless_hybrid_review_operations parent
               ON parent.hybrid_operation_id=child.hybrid_operation_id
             WHERE parent.opportunity_id=?) AS children`,
    args: [seeded.opportunityId, seeded.opportunityId],
  });
  assert.equal(Number(persisted.rows[0]?.parents), 1);
  assert.equal(Number(persisted.rows[0]?.children), 2);
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { evaluateAdaptiveReviewRequirement } from "~~/lib/tokenless/adaptiveReviewService";
import {
  approveAgentPairing,
  authenticateAgentMcpPrincipal,
  createAgentPairing,
  submitAgentRegistration,
} from "~~/lib/tokenless/agentIntegrations";
import {
  __humanReviewApprovalPreparationTestUtils,
  consumeRedactedPublicationApproval,
  prepareHumanReviewForOwnerApproval,
} from "~~/lib/tokenless/humanReviewApprovalPreparation";
import {
  decideHumanReviewApprovalForOwner,
  listHumanReviewApprovalsForOwner,
} from "~~/lib/tokenless/humanReviewApprovals";
import { hashHumanReviewConfiguration } from "~~/lib/tokenless/humanReviewConfiguration";
import { createPrivateGroup } from "~~/lib/tokenless/privateGroups";
import { createAgentPublishingPolicy, createWorkspace } from "~~/lib/tokenless/productCore";
import { hashReviewRequestProfile } from "~~/lib/tokenless/reviewRequestProfiles";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import { seedReadyHumanReviewBinding } from "~~/lib/tokenless/testing/humanReviewBindingFixture";

const OWNER = "0x1111111111111111111111111111111111111111";
const NOW = new Date(Date.now() - 1_000);
const originalSamplerKey = process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY;
const originalSamplerVersion = process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION;

beforeEach(() => {
  process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY = "75".repeat(32);
  process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION = "approval-test-v1";
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
  if (originalSamplerKey === undefined) delete process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY;
  else process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY = originalSamplerKey;
  if (originalSamplerVersion === undefined) delete process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION;
  else process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION = originalSamplerVersion;
});

function hash(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}` as const;
}

async function count(table: string) {
  const result = await dbClient.execute(`SELECT COUNT(*) AS count FROM ${table}`);
  return Number(result.rows[0]?.count);
}

async function fixture(
  lane: "public_paid" | "private_unpaid",
  authority: "prepare_for_approval" | "ask_automatically" = "prepare_for_approval",
) {
  const { workspaceId } = await createWorkspace({ name: `Approval ${lane}`, ownerAddress: OWNER });
  const publishing = await createAgentPublishingPolicy({
    accountAddress: OWNER,
    workspaceId,
    policy: {
      name: `Approval ${lane}`,
      allowedPaymentModes: ["prepaid"],
      maxPanelAtomic: "30000000",
      maxDailyAtomic: "100000000",
      maxMonthlyAtomic: "1000000000",
      maxPanelSize: 15,
      maxBountyAtomic: "20000000",
      maxFeeBps: 1_000,
      maxAttemptReserveAtomic: "10000000",
      allowedReviewerSources: ["rateloop_network", "customer_invited"],
      allowedAdmissionPolicyHashes: [`0x${"11".repeat(32)}`],
      allowedDataClassifications: ["public", "redacted", "confidential"],
      onPolicyMiss: "deny",
    },
  });
  const publishingVersion = publishing.version;
  if (!Number.isSafeInteger(publishingVersion) || publishingVersion === undefined) {
    throw new Error("Publishing policy version expected.");
  }
  const issued = await createAgentPairing({
    accountAddress: OWNER,
    workspaceId,
    origin: "https://rateloop-tokenless.vercel.app",
  });
  const pairing = await authenticateAgentMcpPrincipal(`Bearer ${issued.secret}`);
  if (pairing.kind !== "pairing") throw new Error("Pairing principal expected.");
  await submitAgentRegistration({
    pairing,
    registration: {
      externalId: `approval-${lane}`,
      displayName: `Approval ${lane}`,
      provider: "OpenAI",
      model: "gpt-test",
      environment: "production",
      requestedWorkflowKeys: ["support-reply"],
    },
  });
  const approved = await approveAgentPairing({
    accountAddress: OWNER,
    workspaceId,
    pairingId: issued.pairing.pairingId,
    body: { publishingPolicyId: publishing.policyId, allowedWorkflowKeys: ["support-reply"] },
  });
  const binding = await seedReadyHumanReviewBinding({
    workspaceId,
    agentId: approved.agent.agentId,
    agentVersionId: approved.agent.versionId,
    policyId: approved.integration.reviewPolicyId,
    actor: OWNER,
  });
  const profileId = binding.profileId;
  let profileHash = binding.profileHash;
  if (lane === "private_unpaid") {
    await dbClient.execute({
      sql: `DELETE FROM tokenless_agent_human_review_bindings
            WHERE workspace_id=? AND binding_id=? AND version=1`,
      args: [workspaceId, binding.bindingId],
    });
    const group = await createPrivateGroup({
      accountAddress: OWNER,
      workspaceId,
      name: "Approval reviewers",
      purpose: "Review confidential suggestions after owner approval.",
      policy: { defaultCompensation: "unpaid", dataClassifications: ["confidential"] },
    });
    profileHash = hashReviewRequestProfile({
      agentId: approved.agent.agentId,
      agentVersionId: approved.agent.versionId,
      questionAuthority: "owner_fixed",
      criterion: "Is this output correct and safe to use",
      positiveLabel: "Approve",
      negativeLabel: "Reject",
      rationaleMode: "off",
      audience: "private_invited",
      contentBoundary: "private_workspace",
      privateSensitivity: "confidential",
      privateGroupId: group.groupId,
      privateGroupPolicyVersion: 1,
      privateGroupPolicyHash: group.policyHash,
      responseWindowSeconds: 3_600,
      panelSize: 2,
      compensationMode: "unpaid",
      bountyPerSeatAtomic: null,
    });
    await dbClient.execute({
      sql: `UPDATE tokenless_agent_review_request_profiles
            SET rationale_mode='off',audience='private_invited',content_boundary='private_workspace',
                private_sensitivity='confidential',private_group_id=?,private_group_policy_version=1,
                private_group_policy_hash=?,response_window_seconds=3600,panel_size=2,
                compensation_mode='unpaid',bounty_per_seat_atomic=NULL,profile_hash=?
            WHERE workspace_id=? AND profile_id=? AND version=1`,
      args: [group.groupId, group.policyHash, profileHash, workspaceId, profileId],
    });
    await dbClient.execute({
      sql: `UPDATE tokenless_agent_review_policies SET audience_policy_json=?
            WHERE workspace_id=? AND policy_id=? AND version=1`,
      args: [JSON.stringify({ reviewerSource: "private_invited" }), workspaceId, approved.integration.reviewPolicyId],
    });
  }
  const bindingHash = hashHumanReviewConfiguration({
    workspaceId,
    agentId: approved.agent.agentId,
    agentVersionId: approved.agent.versionId,
    selectionPolicy: { id: approved.integration.reviewPolicyId, version: 1 },
    requestProfile: { id: profileId, version: 1, hash: profileHash },
    publishingPolicy: { id: publishing.policyId, version: publishingVersion },
    authority,
  });
  if (lane === "private_unpaid") {
    await dbClient.execute({
      sql: `INSERT INTO tokenless_agent_human_review_bindings
            (binding_id,version,workspace_id,agent_id,agent_version_id,selection_policy_id,
             selection_policy_version,request_profile_id,request_profile_version,request_profile_hash,
             publishing_policy_id,publishing_policy_version,authority,enabled,canonical_hash,
             created_by,created_at,approved_by,approved_at)
            VALUES (?,1,?,?,?,?,?,?,1,?,?,?,'prepare_for_approval',true,?,?,?,?,?)`,
      args: [
        binding.bindingId,
        workspaceId,
        approved.agent.agentId,
        approved.agent.versionId,
        approved.integration.reviewPolicyId,
        1,
        profileId,
        profileHash,
        publishing.policyId,
        publishingVersion,
        bindingHash,
        OWNER,
        new Date(),
        OWNER,
        new Date(),
      ],
    });
  } else {
    await dbClient.execute({
      sql: `UPDATE tokenless_agent_human_review_bindings
            SET request_profile_id=?,request_profile_version=1,request_profile_hash=?,
                publishing_policy_id=?,publishing_policy_version=?,
                authority=?,canonical_hash=?
            WHERE workspace_id=? AND binding_id=? AND version=1`,
      args: [
        profileId,
        profileHash,
        publishing.policyId,
        publishingVersion,
        authority,
        bindingHash,
        workspaceId,
        binding.bindingId,
      ],
    });
  }
  await dbClient.execute({
    sql: `UPDATE tokenless_agent_integrations
          SET human_review_binding_id=?,human_review_binding_version=1
          WHERE integration_id=?`,
    args: [binding.bindingId, approved.integration.integrationId],
  });
  const principal = await authenticateAgentMcpPrincipal(`Bearer ${issued.secret}`);
  if (principal.kind !== "integration") throw new Error("Integration principal expected.");
  const sourcePayload = `${lane} source`;
  const suggestionPayload = `${lane} suggestion`;
  const decision = await evaluateAdaptiveReviewRequirement({
    principal: principal.principal,
    integrationId: principal.integration.integrationId,
    request: {
      externalOpportunityId: `approval-${lane}-0001`,
      agentId: principal.integration.agentId,
      agentVersionId: principal.integration.agentVersionId,
      policyId: principal.integration.reviewPolicyId,
      policyVersion: principal.integration.reviewPolicyVersion,
      workflowKey: "support-reply",
      riskTier: "low",
      audiencePolicyHash: principal.integration.audiencePolicyHash!,
      suggestionCommitment: hash(suggestionPayload),
      sourceEvidence: { reference: `case/${lane}`, hash: hash(sourcePayload) },
      metadataComplete: true,
      execution: {
        externalExecutionId: `execution-${lane}`,
        status: "completed",
        primarySpanId: "primary",
        generationSpans: [{ spanId: "primary", role: "primary", provider: "OpenAI", requestedModel: "gpt-test" }],
      },
    },
  });
  assert.equal(decision.lifecycle.state, "approval_required");
  return {
    workspaceId,
    principal,
    decision,
    sourcePayload,
    suggestionPayload,
    profileHash,
    publishingPolicyId: publishing.policyId,
    publishingPolicyVersion: publishingVersion,
  };
}

const sideEffectTables = [
  "tokenless_agent_asks",
  "tokenless_ask_ownership",
  "tokenless_prepaid_reservations",
  "tokenless_payment_intents",
  "tokenless_private_unpaid_review_deliveries",
  "tokenless_private_unpaid_review_assignments",
];

const REDACTED_PUBLICATION = {
  visibility: "public" as const,
  dataClassification: "redacted" as const,
  confirmedNoSensitiveData: true as const,
  redactionSummary: "Customer names and account identifiers were removed from the review copy.",
};

async function approve(workspaceId: string, prepared: Awaited<ReturnType<typeof prepareHumanReviewForOwnerApproval>>) {
  return decideHumanReviewApprovalForOwner({
    accountAddress: OWNER,
    workspaceId,
    approvalId: prepared.approvalId,
    body: {
      revision: prepared.revision,
      preparedRequestHash: prepared.preparedRequestHash,
      derivedEconomicsHash: prepared.derivedEconomicsHash,
      decision: "approve",
      note: null,
    },
  });
}

test("automatic redacted publication blocks for an exact one-time owner approval", async () => {
  const setup = await fixture("public_paid", "ask_automatically");
  const approvalNow = new Date();
  const prepared = await prepareHumanReviewForOwnerApproval({
    principal: setup.principal,
    opportunityId: setup.decision.opportunityId,
    sourcePayload: setup.sourcePayload,
    suggestionPayload: setup.suggestionPayload,
    publicationApproval: REDACTED_PUBLICATION,
    now: approvalNow,
  });
  assert.equal(prepared.status, "pending");
  assert.deepEqual(prepared.preparedRequest.publicationApproval, {
    schemaVersion: "rateloop.redacted-publication-approval.v1",
    ...REDACTED_PUBLICATION,
    humanReviewBinding: {
      id: prepared.preparedRequest.publicationApproval?.humanReviewBinding.id,
      version: 1,
      hash: prepared.preparedRequest.publicationApproval?.humanReviewBinding.hash,
      authority: "ask_automatically",
    },
    selectionPolicy: {
      id: setup.principal.integration.reviewPolicyId,
      version: setup.principal.integration.reviewPolicyVersion,
    },
    publishingPolicy: { id: setup.publishingPolicyId, version: setup.publishingPolicyVersion },
  });
  const lifecycle = await dbClient.execute({
    sql: `SELECT state FROM tokenless_agent_review_opportunity_lifecycles
          WHERE workspace_id=? AND opportunity_id=?`,
    args: [setup.workspaceId, setup.decision.opportunityId],
  });
  assert.equal(lifecycle.rows[0]?.state, "approval_required");

  await assert.rejects(
    () =>
      decideHumanReviewApprovalForOwner({
        accountAddress: "0x9999999999999999999999999999999999999999",
        workspaceId: setup.workspaceId,
        approvalId: prepared.approvalId,
        body: {
          revision: prepared.revision,
          preparedRequestHash: prepared.preparedRequestHash,
          derivedEconomicsHash: prepared.derivedEconomicsHash,
          decision: "approve",
          note: null,
        },
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "workspace_not_found",
  );
  await approve(setup.workspaceId, prepared);
  const consumptionNow = new Date();

  await assert.rejects(
    () =>
      consumeRedactedPublicationApproval({
        principal: setup.principal,
        opportunityId: setup.decision.opportunityId,
        sourcePayload: setup.sourcePayload,
        suggestionPayload: setup.suggestionPayload,
        publicationApproval: { ...REDACTED_PUBLICATION, redactionSummary: "A different redaction was approved." },
        consumptionReference: "hybrid-redacted:mismatch",
        now: consumptionNow,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "human_review_approval_conflict",
  );
  await assert.rejects(
    () =>
      consumeRedactedPublicationApproval({
        principal: setup.principal,
        opportunityId: setup.decision.opportunityId,
        sourcePayload: `${setup.sourcePayload} changed`,
        suggestionPayload: setup.suggestionPayload,
        publicationApproval: REDACTED_PUBLICATION,
        consumptionReference: "hybrid-redacted:bytes-mismatch",
        now: consumptionNow,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "source_payload_commitment_mismatch",
  );

  const consumed = await consumeRedactedPublicationApproval({
    principal: setup.principal,
    opportunityId: setup.decision.opportunityId,
    sourcePayload: setup.sourcePayload,
    suggestionPayload: setup.suggestionPayload,
    publicationApproval: REDACTED_PUBLICATION,
    consumptionReference: "hybrid-redacted:exact",
    now: consumptionNow,
  });
  assert.equal(consumed.replayed, false);
  const replay = await consumeRedactedPublicationApproval({
    principal: setup.principal,
    opportunityId: setup.decision.opportunityId,
    sourcePayload: setup.sourcePayload,
    suggestionPayload: setup.suggestionPayload,
    publicationApproval: REDACTED_PUBLICATION,
    consumptionReference: "hybrid-redacted:exact",
    now: consumptionNow,
  });
  assert.equal(replay.replayed, true);
  await assert.rejects(
    () =>
      consumeRedactedPublicationApproval({
        principal: setup.principal,
        opportunityId: setup.decision.opportunityId,
        sourcePayload: setup.sourcePayload,
        suggestionPayload: setup.suggestionPayload,
        publicationApproval: REDACTED_PUBLICATION,
        consumptionReference: "hybrid-redacted:different",
        now: consumptionNow,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "human_review_approval_conflict",
  );
});

test("redacted approval consumption rejects another tenant, expiry, and publishing-policy revocation", async () => {
  const setup = await fixture("public_paid", "ask_automatically");
  const otherTenant = await fixture("public_paid", "ask_automatically");
  const approvalNow = new Date();
  const prepared = await prepareHumanReviewForOwnerApproval({
    principal: setup.principal,
    opportunityId: setup.decision.opportunityId,
    sourcePayload: setup.sourcePayload,
    suggestionPayload: setup.suggestionPayload,
    publicationApproval: REDACTED_PUBLICATION,
    now: approvalNow,
  });
  await approve(setup.workspaceId, prepared);

  await assert.rejects(
    () =>
      consumeRedactedPublicationApproval({
        principal: otherTenant.principal,
        opportunityId: setup.decision.opportunityId,
        sourcePayload: setup.sourcePayload,
        suggestionPayload: setup.suggestionPayload,
        publicationApproval: REDACTED_PUBLICATION,
        consumptionReference: "hybrid-redacted:cross-tenant",
        now: approvalNow,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "review_opportunity_not_found",
  );
  await assert.rejects(
    () =>
      consumeRedactedPublicationApproval({
        principal: setup.principal,
        opportunityId: setup.decision.opportunityId,
        sourcePayload: setup.sourcePayload,
        suggestionPayload: setup.suggestionPayload,
        publicationApproval: REDACTED_PUBLICATION,
        consumptionReference: "hybrid-redacted:expired",
        now: new Date(approvalNow.getTime() + 1_200_001),
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "human_review_approval_expired",
  );
  await dbClient.execute({
    sql: `UPDATE tokenless_agent_publishing_policies SET revoked_at=?
          WHERE workspace_id=? AND policy_id=? AND version=?`,
    args: [approvalNow, setup.workspaceId, setup.publishingPolicyId, setup.publishingPolicyVersion],
  });
  await assert.rejects(
    () =>
      consumeRedactedPublicationApproval({
        principal: setup.principal,
        opportunityId: setup.decision.opportunityId,
        sourcePayload: setup.sourcePayload,
        suggestionPayload: setup.suggestionPayload,
        publicationApproval: REDACTED_PUBLICATION,
        consumptionReference: "hybrid-redacted:revoked",
        now: approvalNow,
      }),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.code === "human_review_approval_binding_conflict",
  );
});

test("prepares a public paid approval exactly once without publishing, reserving, or spending", async () => {
  const setup = await fixture("public_paid");
  const before = await Promise.all(sideEffectTables.map(count));
  const prepared = await prepareHumanReviewForOwnerApproval({
    principal: setup.principal,
    opportunityId: setup.decision.opportunityId,
    sourcePayload: setup.sourcePayload,
    suggestionPayload: setup.suggestionPayload,
    now: NOW,
  });
  const replay = await prepareHumanReviewForOwnerApproval({
    principal: setup.principal,
    opportunityId: setup.decision.opportunityId,
    sourcePayload: setup.sourcePayload,
    suggestionPayload: setup.suggestionPayload,
    now: new Date(NOW.getTime() + 60_000),
  });

  assert.deepEqual(replay, prepared);
  assert.equal(prepared.status, "pending");
  assert.equal(prepared.preparedRequest.audience.kind, "public_network");
  assert.deepEqual(prepared.preparedRequest.requestProfile, {
    id: prepared.preparedRequest.requestProfile.id,
    version: 1,
    hash: setup.profileHash,
  });
  assert.equal(prepared.expiresAt, new Date(NOW.getTime() + 1_200_000).toISOString());
  assert.equal(prepared.maximumChargeAtomic, "5700000");
  assert.deepEqual(prepared.sideEffects, { published: false, assigned: false, fundsReserved: false, spent: false });
  assert.equal(Object.isFrozen(prepared.preparedRequest), true);
  assert.equal(await count("tokenless_agent_review_approval_requests"), 1);
  assert.deepEqual(await Promise.all(sideEffectTables.map(count)), before);
  const lifecycle = await dbClient.execute({
    sql: `SELECT state,state_revision FROM tokenless_agent_review_opportunity_lifecycles
          WHERE workspace_id=? AND opportunity_id=?`,
    args: [setup.workspaceId, setup.decision.opportunityId],
  });
  assert.deepEqual(lifecycle.rows[0], { state: "approval_required", state_revision: 2 });
  const inbox = await listHumanReviewApprovalsForOwner({ accountAddress: OWNER, workspaceId: setup.workspaceId });
  assert.equal(inbox.approvals[0]?.approvalId, prepared.approvalId);
  assert.equal(inbox.approvals[0]?.preparedRequestHash, prepared.preparedRequestHash);
  await decideHumanReviewApprovalForOwner({
    accountAddress: OWNER,
    workspaceId: setup.workspaceId,
    approvalId: prepared.approvalId,
    body: {
      revision: prepared.revision,
      preparedRequestHash: prepared.preparedRequestHash,
      derivedEconomicsHash: prepared.derivedEconomicsHash,
      decision: "approve",
      note: null,
    },
  });
  const approvedReplay = await prepareHumanReviewForOwnerApproval({
    principal: setup.principal,
    opportunityId: setup.decision.opportunityId,
    sourcePayload: setup.sourcePayload,
    suggestionPayload: setup.suggestionPayload,
  });
  assert.equal(approvedReplay.approvalId, prepared.approvalId);
  assert.equal(approvedReplay.preparedRequestHash, prepared.preparedRequestHash);
  assert.equal(approvedReplay.status, "approved");
  assert.equal(await count("tokenless_agent_review_approval_requests"), 1);
});

test("prepares private unpaid terms without plaintext storage, assignment, or payment liability", async () => {
  const setup = await fixture("private_unpaid");
  const prepared = await prepareHumanReviewForOwnerApproval({
    principal: setup.principal,
    opportunityId: setup.decision.opportunityId,
    sourcePayload: setup.sourcePayload,
    suggestionPayload: setup.suggestionPayload,
    now: NOW,
  });
  assert.equal(prepared.preparedRequest.audience.kind, "private_invited");
  assert.match(prepared.preparedRequest.audience.privateGroupId ?? "", /^pgrp_/u);
  assert.equal(prepared.preparedRequest.question.rationaleMode, "off");
  assert.equal(prepared.expiresAt, new Date(NOW.getTime() + 3_600_000).toISOString());
  assert.equal(prepared.maximumChargeAtomic, "0");
  assert.equal(prepared.economics.compensationMode, "unpaid");
  const stored = await dbClient.execute({
    sql: `SELECT prepared_request_json,derived_economics_json,maximum_charge_atomic
          FROM tokenless_agent_review_approval_requests WHERE approval_id=?`,
    args: [prepared.approvalId],
  });
  const documents = JSON.stringify(stored.rows[0]);
  assert.equal(documents.includes(setup.sourcePayload), false);
  assert.equal(documents.includes(setup.suggestionPayload), false);
  assert.equal(await count("tokenless_private_unpaid_review_assignments"), 0);
  assert.equal(await count("tokenless_private_unpaid_review_deliveries"), 0);
  assert.equal(await count("tokenless_prepaid_reservations"), 0);
  assert.equal(await count("tokenless_payment_intents"), 0);
});

test("fails closed on commitment drift and an authority downgrade without creating another approval", async () => {
  const setup = await fixture("public_paid");
  await assert.rejects(
    () =>
      prepareHumanReviewForOwnerApproval({
        principal: setup.principal,
        opportunityId: setup.decision.opportunityId,
        sourcePayload: "different source",
        suggestionPayload: setup.suggestionPayload,
        now: NOW,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "source_payload_commitment_mismatch",
  );
  assert.equal(await count("tokenless_agent_review_approval_requests"), 0);
  await dbClient.execute({
    sql: `UPDATE tokenless_agent_human_review_bindings SET authority='check_only'
          WHERE workspace_id=? AND binding_id=(SELECT human_review_binding_id FROM tokenless_agent_review_opportunities
            WHERE workspace_id=? AND opportunity_id=?)`,
    args: [setup.workspaceId, setup.workspaceId, setup.decision.opportunityId],
  });
  await assert.rejects(
    () =>
      prepareHumanReviewForOwnerApproval({
        principal: setup.principal,
        opportunityId: setup.decision.opportunityId,
        sourcePayload: setup.sourcePayload,
        suggestionPayload: setup.suggestionPayload,
        now: NOW,
      }),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.code === "human_review_approval_binding_conflict",
  );
  assert.equal(await count("tokenless_agent_review_approval_requests"), 0);
});

test("approval IDs bind the workspace, opportunity, request, and economics hashes", () => {
  const first = __humanReviewApprovalPreparationTestUtils.deterministicApprovalId({
    workspaceId: "ws_a",
    opportunityId: "aop_a",
    preparedRequestHash: `sha256:${"a".repeat(64)}`,
    derivedEconomicsHash: `sha256:${"b".repeat(64)}`,
  });
  assert.match(first, /^hrap_[0-9a-f]{40}$/u);
  assert.notEqual(
    first,
    __humanReviewApprovalPreparationTestUtils.deterministicApprovalId({
      workspaceId: "ws_a",
      opportunityId: "aop_b",
      preparedRequestHash: `sha256:${"a".repeat(64)}`,
      derivedEconomicsHash: `sha256:${"b".repeat(64)}`,
    }),
  );
});

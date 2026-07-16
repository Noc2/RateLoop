import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { createWorkspaceAgent } from "~~/lib/tokenless/agentRegistry";
import {
  type AssuranceWormRuntime,
  __assuranceWormTestUtils,
  __setAssuranceWormRuntimeForTests,
  buildAssuranceSupervisionReport,
  configureAssuranceWormDestination,
  disableAssuranceWormDestination,
  enqueueAssuranceWormExport,
  getAssuranceWormDestination,
  listAssuranceWormExports,
  processAssuranceWormExportJob,
  processDueAssuranceWormExports,
} from "~~/lib/tokenless/assuranceWormExports";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import { seedReadyHumanReviewBinding } from "~~/lib/tokenless/testing/humanReviewBindingFixture";

const OWNER = "0x1111111111111111111111111111111111111111";
const OUTSIDER = "0x2222222222222222222222222222222222222222";
const NOW = new Date("2026-07-16T12:00:00.000Z");
const HASH = (character: string) => `sha256:${character.repeat(64)}`;
const SECRET_REFERENCE = `sec_${"1".repeat(48)}`;

function destinationBody() {
  return {
    label: "Regulated archive",
    endpointOrigin: "https://s3.eu-central-1.amazonaws.com",
    bucketName: "rateloop-regulated-archive",
    keyPrefix: "assurance-evidence",
    region: "eu-central-1",
    credentialReference: SECRET_REFERENCE,
    retentionDays: 365,
  };
}

function supervisionArtifact(workspaceId: string, extra: Record<string, unknown> = {}) {
  const payload = {
    schemaVersion: "rateloop.assurance-supervision-report.v1" as const,
    workspaceId,
    period: { startInclusive: "2026-07-01T00:00:00.000Z", endExclusive: NOW.toISOString() },
    financialClaims: { state: "not_included" },
    ...extra,
  };
  return {
    ...payload,
    reportDigest: __assuranceWormTestUtils.sha256(__assuranceWormTestUtils.canonicalJson(payload)),
  };
}

function runtime(overrides: Partial<AssuranceWormRuntime> = {}): AssuranceWormRuntime {
  return {
    async inspectDestination() {
      return {
        schemaVersion: "rateloop.assurance-worm-preflight.v1",
        checkedAt: NOW.toISOString(),
        versioning: "Enabled",
        objectLockEnabled: true,
        defaultRetention: { mode: "COMPLIANCE", days: 730 },
        providerEvidenceDigest: HASH("a"),
      };
    },
    async putLockedObject(input) {
      return {
        objectVersionId: "version-0001",
        etag: '"etag-0001"',
        checksumSha256: input.checksumSha256,
        objectLockMode: "COMPLIANCE",
        retentionUntil: input.retentionUntil,
      };
    },
    ...overrides,
  };
}

async function seedSupervisionEvidence(workspaceId: string) {
  const agent = await createWorkspaceAgent({
    accountAddress: OWNER,
    workspaceId,
    externalId: "worm-supervision-agent",
    version: {
      displayName: "WORM supervision agent",
      provider: "OpenAI",
      model: "gpt-5",
      modelVersion: "2026-07-16",
      environment: "production",
    },
  });
  const policyId = "arp_worm_supervision";
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_review_policies
          (policy_id,version,workspace_id,agent_id,agent_version_id,mode,enabled,
           agreement_threshold_bps,production_floor_bps,fixed_rate_bps,maximum_unreviewed_gap,
           rules_json,audience_policy_json,publishing_policy_id,created_by,approved_by,created_at)
          VALUES (?,1,?,?,?,'adaptive',true,8000,1000,NULL,20,?,?,NULL,?,?,?)`,
    args: [
      policyId,
      workspaceId,
      agent.agentId,
      agent.currentVersion.versionId,
      JSON.stringify({ enforcementMode: "host_enforced" }),
      JSON.stringify({ reviewerSource: "public_network" }),
      OWNER,
      OWNER,
      new Date("2026-07-01T00:00:00.000Z"),
    ],
  });
  const binding = await seedReadyHumanReviewBinding({
    workspaceId,
    agentId: agent.agentId,
    agentVersionId: agent.currentVersion.versionId,
    policyId,
    actor: OWNER,
  });
  const scopeId = "aesc_worm_supervision";
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_evaluation_scopes
          (scope_id,workspace_id,agent_id,agent_version_id,policy_id,policy_version,
           workflow_key,risk_tier,audience_policy_hash,partition_commitment,
           execution_profile_hash,execution_profile_json,human_review_binding_id,human_review_binding_version,
           request_profile_id,request_profile_version,request_profile_hash,stage,completed_comparable_cases,
           stable_cases_since_stage,unreviewed_since_last_sample,stage_entered_at,updated_at)
          VALUES (?,?,?,?,?,1,'supervision','critical',?, ?,?,'{}',?,1,?,1,?,
                  'high_coverage',0,0,0,?,?)`,
    args: [
      scopeId,
      workspaceId,
      agent.agentId,
      agent.currentVersion.versionId,
      policyId,
      HASH("1"),
      HASH("2"),
      HASH("3"),
      binding.bindingId,
      binding.profileId,
      binding.profileHash,
      new Date("2026-07-01T00:00:00.000Z"),
      NOW,
    ],
  });
  for (const [suffix, critical, state, revision] of [
    ["completed", false, "completed", 3],
    ["blocked", true, "blocked", 2],
  ] as const) {
    const opportunityId = `aeop_worm_${suffix}`;
    await dbClient.execute({
      sql: `INSERT INTO tokenless_agent_review_opportunities
            (opportunity_id,workspace_id,agent_id,agent_version_id,scope_id,policy_id,policy_version,
             external_opportunity_id,suggestion_commitment,suggestion_ciphertext,suggestion_key_ref,
             declared_confidence_bps,metadata_commitment,metadata_complete,critical_risk,decision,
             review_rate_bps,selection_probability_bps,sample_bucket,sampler_key_version,sampler_commitment,
             reason_codes_json,status,source_evidence_reference,source_evidence_hash,human_review_binding_id,
             human_review_binding_version,request_profile_id,request_profile_version,request_profile_hash,
             created_at,updated_at)
            VALUES (?,?,?,?,?,?,1,?,?,NULL,NULL,6500,?,true,?,'required',10000,10000,100,
                    'sampler-worm-v1',?,'["supervision_test"]','completed',?,?,?,1,?,1,?,?,?)`,
      args: [
        opportunityId,
        workspaceId,
        agent.agentId,
        agent.currentVersion.versionId,
        scopeId,
        policyId,
        `external-worm-${suffix}`,
        HASH("4"),
        HASH("5"),
        critical,
        HASH("6"),
        `evidence/${opportunityId}`,
        HASH("7"),
        binding.bindingId,
        binding.profileId,
        binding.profileHash,
        new Date("2026-07-10T00:00:00.000Z"),
        new Date("2026-07-11T00:00:00.000Z"),
      ],
    });
    await dbClient.execute({
      sql: `INSERT INTO tokenless_agent_review_opportunity_lifecycles
            (workspace_id,opportunity_id,state,state_revision,reason_codes_json,state_entered_at,
             terminal_at,created_at,updated_at) VALUES (?,?,?,?,'[]',?,?,?,?)`,
      args: [
        workspaceId,
        opportunityId,
        state,
        revision,
        new Date("2026-07-11T00:00:00.000Z"),
        state === "completed" ? new Date("2026-07-11T00:00:00.000Z") : null,
        new Date("2026-07-10T00:00:00.000Z"),
        new Date("2026-07-11T00:00:00.000Z"),
      ],
    });
    const transitions =
      state === "completed"
        ? [
            ["pending", "request_ready", "pending", 1, 2],
            ["completed", "pending", "completed", 2, 3],
          ]
        : [["blocked", "request_ready", "blocked", 1, 2]];
    for (const [eventSuffix, from, to, fromRevision, toRevision] of transitions) {
      await dbClient.execute({
        sql: `INSERT INTO tokenless_agent_review_opportunity_transition_events
              (event_id,workspace_id,opportunity_id,transition_key,from_state,to_state,from_revision,to_revision,
               reason_codes_json,actor_kind,actor_reference,details_json,transition_commitment,occurred_at)
              VALUES (?,?,?,?,?,?,?,?, '[]','service','worm-test','{}',?,?)`,
        args: [
          `arte_worm_${suffix}_${eventSuffix}`,
          workspaceId,
          opportunityId,
          `worm-${suffix}-${eventSuffix}`,
          from,
          to,
          fromRevision,
          toRevision,
          HASH(eventSuffix === "pending" ? "8" : "9"),
          new Date("2026-07-11T00:00:00.000Z"),
        ],
      });
    }
  }
}

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  __setAssuranceWormRuntimeForTests(runtime());
});

afterEach(() => {
  __setAssuranceWormRuntimeForTests(null);
  __setDatabaseResourcesForTests(null);
});

test("only owners and admins configure tenant-bound destinations and no credential value is persisted", async () => {
  const { workspaceId } = await createWorkspace({ name: "WORM config", ownerAddress: OWNER });
  const configured = await configureAssuranceWormDestination({
    accountAddress: OWNER,
    workspaceId,
    body: destinationBody(),
    now: NOW,
  });
  assert.match(configured.destinationId, /^awd_[0-9a-f]{40}$/u);
  assert.equal(configured.credentialReference, SECRET_REFERENCE);
  assert.equal(configured.preflight.defaultRetention.mode, "COMPLIANCE");

  await disableAssuranceWormDestination({
    accountAddress: OWNER,
    workspaceId,
    destinationId: configured.destinationId,
    now: new Date(NOW.getTime() + 1_000),
  });
  const replacement = await configureAssuranceWormDestination({
    accountAddress: OWNER,
    workspaceId,
    body: { ...destinationBody(), label: "Replacement archive" },
    now: new Date(NOW.getTime() + 2_000),
  });
  const destinations = await getAssuranceWormDestination({ accountAddress: OWNER, workspaceId });
  assert.equal(destinations.active?.destinationId, replacement.destinationId);
  assert.equal(destinations.active?.label, "Replacement archive");

  await assert.rejects(
    getAssuranceWormDestination({ accountAddress: OUTSIDER, workspaceId }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "workspace_not_found",
  );
  await assert.rejects(
    configureAssuranceWormDestination({
      accountAddress: OUTSIDER,
      workspaceId,
      body: destinationBody(),
      now: NOW,
    }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "workspace_not_found",
  );
  await assert.rejects(
    configureAssuranceWormDestination({
      accountAddress: OWNER,
      workspaceId,
      body: { ...destinationBody(), accessKey: "AKIA-PLAINTEXT", secretAccessKey: "plaintext" },
      now: NOW,
    }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_worm_destination",
  );
  await assert.rejects(
    configureAssuranceWormDestination({
      accountAddress: OWNER,
      workspaceId,
      body: { ...destinationBody(), endpointOrigin: "https://127.0.0.1" },
      now: NOW,
    }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_worm_destination",
  );
});

test("destination preflight fails closed without versioning, Object Lock, COMPLIANCE mode, and sufficient retention", async () => {
  const { workspaceId } = await createWorkspace({ name: "WORM preflight", ownerAddress: OWNER });
  __setAssuranceWormRuntimeForTests(
    runtime({
      async inspectDestination() {
        return {
          schemaVersion: "rateloop.assurance-worm-preflight.v1",
          checkedAt: NOW.toISOString(),
          versioning: "Enabled",
          objectLockEnabled: true,
          defaultRetention: { mode: "COMPLIANCE", days: 180 },
          providerEvidenceDigest: HASH("b"),
        };
      },
    }),
  );
  await assert.rejects(
    configureAssuranceWormDestination({ accountAddress: OWNER, workspaceId, body: destinationBody(), now: NOW }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "worm_object_lock_preflight_failed",
  );
  assert.equal((await getAssuranceWormDestination({ accountAddress: OWNER, workspaceId })).active, null);
});

test("WORM jobs are idempotent and accept only an exact checksum, version ID, and COMPLIANCE retention receipt", async () => {
  const { workspaceId } = await createWorkspace({ name: "WORM jobs", ownerAddress: OWNER });
  await configureAssuranceWormDestination({ accountAddress: OWNER, workspaceId, body: destinationBody(), now: NOW });
  const artifact = supervisionArtifact(workspaceId);
  const first = await enqueueAssuranceWormExport({
    accountAddress: OWNER,
    workspaceId,
    artifactType: "supervision_report",
    sourceId: "supervision:2026-07",
    artifact,
    now: NOW,
  });
  const duplicate = await enqueueAssuranceWormExport({
    accountAddress: OWNER,
    workspaceId,
    artifactType: "supervision_report",
    sourceId: "supervision:2026-07",
    artifact,
    now: new Date(NOW.getTime() + 60_000),
  });
  assert.equal(duplicate.jobId, first.jobId);
  await assert.rejects(
    enqueueAssuranceWormExport({
      accountAddress: OWNER,
      workspaceId,
      artifactType: "supervision_report",
      sourceId: "supervision:tampered",
      artifact: { ...artifact, financialClaims: { state: "paid" } },
      now: NOW,
    }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_worm_export",
  );

  const delivered = await processAssuranceWormExportJob({ jobId: first.jobId, now: NOW });
  assert.equal(delivered.state, "delivered");
  assert.equal(delivered.receipt?.objectVersionId, "version-0001");
  assert.equal(delivered.receipt?.checksumSha256, delivered.payloadHash);
  assert.equal(delivered.receipt?.objectLockMode, "COMPLIANCE");
  assert.ok(new Date(delivered.receipt!.retentionUntil) >= new Date(delivered.retentionUntil));

  const jobs = await listAssuranceWormExports({ accountAddress: OWNER, workspaceId });
  assert.equal(jobs.jobs.length, 1);
  assert.equal(jobs.jobs[0]?.receipt?.providerReceiptHash.startsWith("sha256:"), true);
});

test("due-job processing provides the scheduled retry boundary for durable exports", async () => {
  const { workspaceId } = await createWorkspace({ name: "WORM scheduled", ownerAddress: OWNER });
  await configureAssuranceWormDestination({ accountAddress: OWNER, workspaceId, body: destinationBody(), now: NOW });
  await enqueueAssuranceWormExport({
    accountAddress: OWNER,
    workspaceId,
    artifactType: "supervision_report",
    sourceId: "supervision:scheduled",
    artifact: supervisionArtifact(workspaceId),
    now: NOW,
  });
  const summary = await processDueAssuranceWormExports({ now: NOW, limit: 10 });
  assert.deepEqual(summary, { due: 1, delivered: 1, retry: 0, dead: 0, skipped: 0 });
});

test("provider receipt mismatches remain retryable and never create a WORM receipt", async () => {
  const { workspaceId } = await createWorkspace({ name: "WORM mismatch", ownerAddress: OWNER });
  await configureAssuranceWormDestination({ accountAddress: OWNER, workspaceId, body: destinationBody(), now: NOW });
  __setAssuranceWormRuntimeForTests(
    runtime({
      async putLockedObject(input) {
        return {
          objectVersionId: "version-bad",
          etag: '"etag-bad"',
          checksumSha256: HASH("f"),
          objectLockMode: "COMPLIANCE",
          retentionUntil: input.retentionUntil,
        };
      },
    }),
  );
  const queued = await enqueueAssuranceWormExport({
    accountAddress: OWNER,
    workspaceId,
    artifactType: "supervision_report",
    sourceId: "supervision:mismatch",
    artifact: supervisionArtifact(workspaceId),
    now: NOW,
  });
  const failed = await processAssuranceWormExportJob({ jobId: queued.jobId, now: NOW });
  assert.equal(failed.state, "retry");
  assert.equal(failed.receipt, null);
  assert.equal(failed.lastErrorCode, "worm_provider_delivery_failed");
});

test("money or settlement claims fail closed unless an exact workspace-bound terminal receipt verifies", async () => {
  const { workspaceId } = await createWorkspace({ name: "WORM settlement gate", ownerAddress: OWNER });
  await configureAssuranceWormDestination({ accountAddress: OWNER, workspaceId, body: destinationBody(), now: NOW });
  const artifact = supervisionArtifact(workspaceId, { settlement_receipt: { paid_atomic: "1000000" } });
  await assert.rejects(
    enqueueAssuranceWormExport({
      accountAddress: OWNER,
      workspaceId,
      artifactType: "supervision_report",
      sourceId: "settlement:unverified",
      artifact,
      now: NOW,
    }),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.code === "paid_assignment_settlement_unverified",
  );

  __setAssuranceWormRuntimeForTests(
    runtime({
      async verifySettlementReceipt(receipt) {
        return { workspaceId: receipt.workspaceId, reference: receipt.reference, hash: receipt.hash };
      },
    }),
  );
  const verified = await enqueueAssuranceWormExport({
    accountAddress: OWNER,
    workspaceId,
    artifactType: "supervision_report",
    sourceId: "settlement:verified",
    artifact,
    settlementReceipt: { reference: "paid-assignment-settlement/receipt-1", hash: HASH("c") },
    now: NOW,
  });
  assert.equal(verified.claimsMoneyOrSettlement, true);
  assert.equal(verified.settlementReceiptHash, HASH("c"));
});

test("supervision reports expose period coverage, exceptions, escalations, and no financial claim", async () => {
  const { workspaceId } = await createWorkspace({ name: "Supervision report", ownerAddress: OWNER });
  await seedSupervisionEvidence(workspaceId);
  const storedRisks = await dbClient.execute({
    sql: `SELECT opportunity_id,critical_risk FROM tokenless_agent_review_opportunities
          WHERE workspace_id=? ORDER BY opportunity_id`,
    args: [workspaceId],
  });
  assert.deepEqual(
    storedRisks.rows.map(row => [row.opportunity_id, row.critical_risk]),
    [
      ["aeop_worm_blocked", true],
      ["aeop_worm_completed", false],
    ],
  );
  const report = await buildAssuranceSupervisionReport({
    accountAddress: OWNER,
    workspaceId,
    from: new Date("2026-07-01T00:00:00.000Z"),
    to: NOW,
    now: NOW,
  });
  assert.deepEqual(report.oversightCoverage, {
    eligibleOutputs: 2,
    selectedForReview: 2,
    reviewRequestsSent: 1,
    reviewsCompleted: 1,
    completionCoverageBps: 5000,
  });
  assert.deepEqual(report.exceptions, {
    approvalRequired: 0,
    blocked: 1,
    inconclusive: 0,
    failedTerminal: 0,
    cancelledBeforeCommit: 0,
  });
  assert.equal(report.escalations.criticalRisk, 1);
  assert.equal(report.financialClaims.state, "not_included");
  assert.match(report.reportDigest, /^sha256:[0-9a-f]{64}$/u);
});

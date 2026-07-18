import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { verifyWorkspaceAuditChain } from "~~/lib/privacy/audit";
import { createWorkspaceAgent } from "~~/lib/tokenless/agentRegistry";
import {
  ASSURANCE_EVENT_TYPES,
  buildAssuranceCloudEvent,
  createAssuranceEventStream,
  deliverPendingAssuranceEvents,
  enqueueAssuranceEvent,
  listAssuranceEventStreams,
  listAssuranceEvents,
  projectAssuranceLifecycleEvents,
  terminalFailureEventType,
} from "~~/lib/tokenless/assuranceEventStreaming";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import { seedReadyHumanReviewBinding } from "~~/lib/tokenless/testing/humanReviewBindingFixture";

const OWNER = "0x1111111111111111111111111111111111111111";
const OUTSIDER = "0x2222222222222222222222222222222222222222";
const NOW = new Date("2026-07-16T12:00:00.000Z");
const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64url");
const PACKET_HASH = `sha256:${"11".repeat(32)}`;
const CHAIN_HASH = `sha256:${"22".repeat(32)}`;
const PREVIOUS_HASH = `sha256:${"33".repeat(32)}`;
const CHAIN_REFERENCE = {
  schemaVersion: "rateloop.audit-chain-reference.v1" as const,
  eventHash: CHAIN_HASH,
  previousHash: PREVIOUS_HASH,
  sequence: 42,
  externalAnchor: {
    chainId: 84532,
    transactionHash: `0x${"44".repeat(32)}`,
    blockNumber: "123456",
  },
};
const resolvePublic = async () => ["93.184.216.34"];
const HASH = (character: string) => `sha256:${character.repeat(64)}`;
const PACKET_REFERENCE = {
  schemaVersion: "rateloop.assurance-event-reference.v1" as const,
  kind: "decision_packet" as const,
  digest: PACKET_HASH,
};

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

async function seedLifecycleEventSources() {
  const { workspaceId } = await createWorkspace({ name: "Lifecycle stream", ownerAddress: OWNER });
  const agent = await createWorkspaceAgent({
    accountAddress: OWNER,
    workspaceId,
    externalId: "lifecycle-stream-agent",
    version: {
      displayName: "Lifecycle stream agent",
      provider: "OpenAI",
      model: "gpt-5",
      modelVersion: "2026-07-16",
      environment: "production",
    },
  });
  const policyId = "arp_lifecycle_stream";
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_review_policies
          (policy_id,version,workspace_id,agent_id,agent_version_id,mode,enabled,
           agreement_threshold_bps,production_floor_bps,fixed_rate_bps,maximum_unreviewed_gap,
           rules_json,audience_policy_json,publishing_policy_id,created_by,approved_by,created_at)
          VALUES (?,1,?,?,?,'fixed',true,8000,0,10000,1,?,?,NULL,?,?,?)`,
    args: [
      policyId,
      workspaceId,
      agent.agentId,
      agent.currentVersion.versionId,
      JSON.stringify({ enforcementMode: "host_enforced" }),
      JSON.stringify({ reviewerSource: "public_network" }),
      OWNER,
      OWNER,
      NOW,
    ],
  });
  const binding = await seedReadyHumanReviewBinding({
    workspaceId,
    agentId: agent.agentId,
    agentVersionId: agent.currentVersion.versionId,
    policyId,
    actor: OWNER,
  });
  const scopeId = "aesc_lifecycle_stream";
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_evaluation_scopes
          (scope_id,workspace_id,agent_id,agent_version_id,policy_id,policy_version,
           workflow_key,risk_tier,audience_policy_hash,partition_commitment,
           execution_profile_hash,execution_profile_json,human_review_binding_id,human_review_binding_version,
           request_profile_id,request_profile_version,request_profile_hash,stage,completed_comparable_cases,
           stable_cases_since_stage,unreviewed_since_last_sample,stage_entered_at,updated_at)
          VALUES (?,?,?,?,?,1,'lifecycle-stream','critical',?,?,?,'{}',?,1,?,1,?,
                  'high_coverage',0,0,0,?,?)`,
    args: [
      scopeId,
      workspaceId,
      agent.agentId,
      agent.currentVersion.versionId,
      policyId,
      HASH("a"),
      HASH("b"),
      HASH("c"),
      binding.bindingId,
      binding.profileId,
      binding.profileHash,
      NOW,
      NOW,
    ],
  });

  const projectId = "project_lifecycle_stream";
  const rubricId = "rubric_lifecycle_stream";
  const suiteId = "suite_lifecycle_stream";
  const audiencePolicyId = "policy_lifecycle_stream";
  const runId = "run_lifecycle_stream";
  const packetId = "haep_lifecycle_stream";
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_projects
          (project_id,workspace_id,name,data_classification,status,retention_days,created_by,created_at,updated_at)
          VALUES (?,?,'Lifecycle evidence','confidential','active',30,?,?,?)`,
    args: [projectId, workspaceId, OWNER, NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_rubrics
          (rubric_id,project_id,version,prompt,failure_tags_json,rationale_json,pass_rule_json,rubric_json,created_at)
          VALUES (?,?,1,'Review','[]','{}','{}','{}',?)`,
    args: [rubricId, projectId, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_suites
          (suite_id,project_id,name,version,status,rubric_id,rubric_version,created_at,updated_at)
          VALUES (?,?,'Lifecycle suite',1,'frozen',?,1,?,?)`,
    args: [suiteId, projectId, rubricId, NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_audience_policies
          (policy_id,project_id,version,reviewer_source,compensation,cohorts_json,selection,
           fallbacks_json,required_qualifications_json,assurance_json,buyer_privacy_json,
           legal_eligibility_required,policy_hash,policy_json,created_at)
          VALUES (?,?,1,'public_network','unpaid','[]','open','{}','[]','{}','{}',false,?,'{}',?)`,
    args: [audiencePolicyId, projectId, HASH("d"), NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_runs
          (run_id,project_id,suite_id,suite_version,audience_policy_id,audience_policy_version,
           status,policy_hash,created_by,created_at,updated_at,completed_at)
          VALUES (?,?,?,1,?,1,'completed',?,?,?, ?,?)`,
    args: [runId, projectId, suiteId, audiencePolicyId, HASH("d"), OWNER, NOW, NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_evidence_packets
          (packet_id,run_id,manifest_hash,case_root,response_root,aggregation_version,result_json,
           limitations_json,chain_references_json,signature,generated_at,packet_digest,packet_json,
           signature_algorithm,signing_key_id,signing_public_key)
          VALUES (?,?,?,'case-root','response-root','v1','{}','[]','{}','signature',?,?, '{}',
                  'Ed25519','key-test','public-key')`,
    args: [packetId, runId, HASH("e"), NOW, PACKET_HASH],
  });

  const insertOpportunity = async (opportunityId: string, externalId: string, run: string | null) => {
    await dbClient.execute({
      sql: `INSERT INTO tokenless_agent_review_opportunities
            (opportunity_id,workspace_id,agent_id,agent_version_id,scope_id,policy_id,policy_version,
             external_opportunity_id,suggestion_commitment,declared_confidence_bps,metadata_commitment,
             metadata_complete,critical_risk,decision,review_rate_bps,selection_probability_bps,sample_bucket,
             sampler_key_version,sampler_commitment,reason_codes_json,status,run_id,source_evidence_reference,
             source_evidence_hash,human_review_binding_id,human_review_binding_version,request_profile_id,
             request_profile_version,request_profile_hash,created_at,updated_at)
            VALUES (?,?,?,?,?,?,1,?,?,9000,?,true,true,'required',10000,10000,1,'sampler-v1',?,'[]',
                    ?,?,'evidence/lifecycle',?,?,1,?,1,?,?,?)`,
      args: [
        opportunityId,
        workspaceId,
        agent.agentId,
        agent.currentVersion.versionId,
        scopeId,
        policyId,
        externalId,
        HASH("f"),
        HASH("1"),
        HASH("2"),
        run ? "completed" : "review_requested",
        run,
        HASH("3"),
        binding.bindingId,
        binding.profileId,
        binding.profileHash,
        NOW,
        NOW,
      ],
    });
  };
  const completedOpportunity = "aop_lifecycle_stream_completed";
  const deferredOpportunity = "aop_lifecycle_stream_deferred";
  await insertOpportunity(completedOpportunity, "external-lifecycle-completed", runId);
  await insertOpportunity(deferredOpportunity, "external-lifecycle-deferred", null);
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_review_opportunity_lifecycles
          (workspace_id,opportunity_id,state,state_revision,reason_codes_json,state_entered_at,terminal_at,
           created_at,updated_at)
          VALUES (?,?,'completed',5,'[]',?,?,?,?),
                 (?,?,'blocked',2,'[]',?,NULL,?,?)`,
    args: [workspaceId, completedOpportunity, NOW, NOW, NOW, NOW, workspaceId, deferredOpportunity, NOW, NOW, NOW],
  });
  const blockedEventId = `hrtr_${"1".repeat(40)}`;
  const completedEventId = `hrtr_${"2".repeat(40)}`;
  const deferredEventId = `hrtr_${"3".repeat(40)}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_review_opportunity_transition_events
          (event_id,workspace_id,opportunity_id,transition_key,from_state,to_state,from_revision,to_revision,
           reason_codes_json,actor_kind,actor_reference,details_json,transition_commitment,occurred_at)
          VALUES (?,?,?,'request-ready:blocked','request_ready','blocked',1,2,'[]','service','stream-test','{}',?,?),
                 (?,?,?,'pending:completed','pending','completed',4,5,'[]','service','stream-test','{}',?,?),
                 (?,?,?,'approval:blocked','approval_required','blocked',1,2,'[]','service','stream-test','{}',?,?)`,
    args: [
      blockedEventId,
      workspaceId,
      completedOpportunity,
      HASH("4"),
      NOW,
      completedEventId,
      workspaceId,
      completedOpportunity,
      HASH("5"),
      NOW,
      deferredEventId,
      workspaceId,
      deferredOpportunity,
      HASH("6"),
      NOW,
    ],
  });
  const anchorJobId = `aat_${"4".repeat(40)}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_attestation_jobs
          (job_id,workspace_id,artifact_kind,artifact_schema_version,artifact_digest,boundary_at,
           statement_json,state,signer_key_id,dsse_envelope_json,rekor_entry_uuid,rekor_log_index,
           rekor_bundle_json,attempt_count,next_attempt_at,created_at,updated_at,completed_at)
          VALUES (?,?,'decision_packet','rateloop.assurance-evidence.v1',?,?,'{}','completed',
                  'managed-key','{}','rekor-entry','1','{}',1,?,?,?,?)`,
    args: [anchorJobId, workspaceId, PACKET_HASH, NOW, NOW, NOW, NOW, NOW],
  });
  return { workspaceId, blockedEventId, completedEventId, deferredEventId, anchorJobId, deferredOpportunity };
}

test("CloudEvents 1.0 wraps an OCSF 1.8 Compliance Finding and cross-verifiable evidence references", () => {
  const built = buildAssuranceCloudEvent({
    workspaceId: "ws_test",
    sourceEventId: "review:completed:run_123",
    eventType: "ai.rateloop.review.completed",
    evidenceReference: PACKET_REFERENCE,
    evidenceChain: CHAIN_REFERENCE,
    occurredAt: NOW,
  });
  assert.equal(built.event.specversion, "1.0");
  assert.equal(built.event.dataschema, "urn:rateloop:schema:assurance-event:v2");
  assert.equal(built.event.ratelooppackethash, PACKET_HASH);
  assert.equal(built.event.rateloopevidencekind, "decision_packet");
  assert.equal(built.event.rateloopevidencedigest, PACKET_HASH);
  assert.equal(built.event.rateloopchainhash, CHAIN_HASH);
  assert.deepEqual(built.event.data.evidenceReference, PACKET_REFERENCE);
  assert.deepEqual(built.event.data.evidenceChain, CHAIN_REFERENCE);
  assert.equal(built.event.data.ocsf.class_uid, 2003);
  assert.equal(built.event.data.ocsf.category_uid, 2);
  assert.equal(built.event.data.ocsf.metadata.version, "1.8.0");
  assert.equal(built.event.data.ocsf.finding_info.uid, built.event.id);
  assert.equal(built.event.data.ocsf.unmapped.rateloop_packet_hash, PACKET_HASH);
  assert.equal(JSON.stringify(built).includes("workspace name"), false);
  assert.throws(
    () =>
      buildAssuranceCloudEvent({
        workspaceId: "ws_test",
        sourceEventId: "review:completed:run_123",
        eventType: "ai.rateloop.review.completed",
        subject: "raw review content must not enter a SIEM event",
        evidenceReference: PACKET_REFERENCE,
        evidenceChain: CHAIN_REFERENCE,
        occurredAt: NOW,
      }),
    /Event reference is invalid/u,
  );

  const gateDigest = HASH("9");
  const blocked = buildAssuranceCloudEvent({
    workspaceId: "ws_test",
    sourceEventId: "gate:blocked:transition_123",
    eventType: "ai.rateloop.gate.blocked",
    evidenceReference: {
      schemaVersion: "rateloop.assurance-event-reference.v1",
      kind: "gate_transition",
      digest: gateDigest,
    },
    evidenceChain: CHAIN_REFERENCE,
    occurredAt: NOW,
  });
  assert.equal(blocked.event.rateloopevidencekind, "gate_transition");
  assert.equal(blocked.event.rateloopevidencedigest, gateDigest);
  assert.equal("ratelooppackethash" in blocked.event, false);
  assert.equal("packetHash" in blocked.event.data, false);
  assert.equal("rateloop_packet_hash" in blocked.ocsf.unmapped, false);
  assert.equal(blocked.ocsf.unmapped.rateloop_evidence_reference.digest, gateDigest);
});

test("workspace administrators configure streams and event enqueue is atomic, scoped, and idempotent", async () => {
  const { workspaceId } = await createWorkspace({ name: "Event stream", ownerAddress: OWNER });
  const primary = await createAssuranceEventStream({
    accountAddress: OWNER,
    workspaceId,
    url: "https://siem.example.test/rateloop",
    eventTypes: ["ai.rateloop.review.completed"],
    encryptionKey: ENCRYPTION_KEY,
    resolveHostname: resolvePublic,
  });
  await createAssuranceEventStream({
    accountAddress: OWNER,
    workspaceId,
    url: "https://gates.example.test/rateloop",
    eventTypes: ["ai.rateloop.gate.blocked"],
    encryptionKey: ENCRYPTION_KEY,
    resolveHostname: resolvePublic,
  });
  assert.match(primary.signingSecret, /^rlwhsec_/u);
  assert.equal((await listAssuranceEventStreams({ accountAddress: OWNER, workspaceId })).length, 2);
  await assert.rejects(
    () => listAssuranceEventStreams({ accountAddress: OUTSIDER, workspaceId }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "workspace_not_found",
  );

  const first = await enqueueAssuranceEvent({
    workspaceId,
    sourceEventId: "review:completed:run_123",
    eventType: "ai.rateloop.review.completed",
    evidenceReference: PACKET_REFERENCE,
    evidenceChain: CHAIN_REFERENCE,
    occurredAt: NOW,
    now: NOW,
  });
  assert.equal(first.replay, false);
  assert.equal(first.deliveryCount, 1);
  const replay = await enqueueAssuranceEvent({
    workspaceId,
    sourceEventId: "review:completed:run_123",
    eventType: "ai.rateloop.review.completed",
    evidenceReference: PACKET_REFERENCE,
    evidenceChain: CHAIN_REFERENCE,
    occurredAt: NOW,
    now: new Date(NOW.getTime() + 1_000),
  });
  assert.deepEqual(replay, { eventId: first.eventId, deliveryCount: 0, replay: true });

  const stored = await dbClient.execute({
    sql: `SELECT o.cloud_event_json,o.payload_hash,COUNT(d.delivery_id) AS deliveries
          FROM tokenless_assurance_event_outbox o
          LEFT JOIN tokenless_assurance_event_deliveries d ON d.event_id=o.event_id
          WHERE o.event_id=? GROUP BY o.cloud_event_json,o.payload_hash`,
    args: [first.eventId],
  });
  const envelope = JSON.parse(String(stored.rows[0].cloud_event_json));
  assert.equal(envelope.id, first.eventId);
  assert.equal(envelope.data.packetHash, PACKET_HASH);
  assert.match(String(stored.rows[0].payload_hash), /^sha256:[0-9a-f]{64}$/u);
  assert.equal(Number(stored.rows[0].deliveries), 1);
  assert.equal((await listAssuranceEvents({ accountAddress: OWNER, workspaceId }))[0]?.eventId, first.eventId);

  await assert.rejects(
    () =>
      enqueueAssuranceEvent({
        workspaceId,
        sourceEventId: "review:completed:run_123",
        eventType: "ai.rateloop.review.completed",
        evidenceReference: { ...PACKET_REFERENCE, digest: `sha256:${"99".repeat(32)}` },
        evidenceChain: CHAIN_REFERENCE,
        occurredAt: NOW,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "assurance_event_conflict",
  );
});

test("lifecycle projection emits completed, blocked, and anchored events with exact audit-chain references", async () => {
  const fixture = await seedLifecycleEventSources();
  await createAssuranceEventStream({
    accountAddress: OWNER,
    workspaceId: fixture.workspaceId,
    url: "https://siem.example.test/lifecycle",
    eventTypes: [...ASSURANCE_EVENT_TYPES],
    encryptionKey: ENCRYPTION_KEY,
    resolveHostname: resolvePublic,
  });
  const first = await projectAssuranceLifecycleEvents({ now: NOW, limit: 20 });
  assert.deepEqual(first, {
    scanned: 4,
    projected: 4,
    replayed: 0,
    retry: 0,
    deferredWithoutPacket: { gateBlocked: 0, reviewCompleted: 0 },
    retrySources: [],
  });
  const stored = await dbClient.execute({
    sql: `SELECT o.source_event_id,o.event_type,o.packet_hash,o.evidence_reference_kind,
                 o.evidence_reference_digest,o.evidence_chain_json,o.cloud_event_json,
                 a.event_digest,a.previous_digest,a.sequence,COUNT(d.delivery_id) AS deliveries
          FROM tokenless_assurance_event_outbox o
          JOIN tokenless_audit_events a
            ON a.workspace_id=o.workspace_id AND a.action='assurance.siem_event.projected'
           AND a.target_kind='assurance_lifecycle_source' AND a.target_id=o.source_event_id
          LEFT JOIN tokenless_assurance_event_deliveries d ON d.event_id=o.event_id
          WHERE o.workspace_id=?
          GROUP BY o.source_event_id,o.event_type,o.packet_hash,o.evidence_reference_kind,
                   o.evidence_reference_digest,o.evidence_chain_json,o.cloud_event_json,
                   a.event_digest,a.previous_digest,a.sequence
          ORDER BY o.event_type ASC`,
    args: [fixture.workspaceId],
  });
  assert.equal(stored.rows.length, 4);
  assert.deepEqual(
    new Set(stored.rows.map(row => String(row.source_event_id))),
    new Set([fixture.blockedEventId, fixture.completedEventId, fixture.deferredEventId, fixture.anchorJobId]),
  );
  for (const row of stored.rows) {
    const chain = JSON.parse(String(row.evidence_chain_json));
    const envelope = JSON.parse(String(row.cloud_event_json));
    assert.equal(chain.eventHash, row.event_digest);
    assert.equal(chain.previousHash, row.previous_digest);
    assert.equal(chain.sequence, Number(row.sequence));
    assert.equal(envelope.rateloopchainhash, row.event_digest);
    if (row.event_type === "ai.rateloop.gate.blocked") {
      const expectedDigest = row.source_event_id === fixture.deferredEventId ? HASH("6") : HASH("4");
      assert.equal(row.packet_hash, null);
      assert.equal(row.evidence_reference_kind, "gate_transition");
      assert.equal(row.evidence_reference_digest, expectedDigest);
      assert.equal(envelope.rateloopevidencedigest, expectedDigest);
      assert.equal("ratelooppackethash" in envelope, false);
    } else {
      assert.equal(row.packet_hash, PACKET_HASH);
      assert.equal(row.evidence_reference_kind, "decision_packet");
      assert.equal(row.evidence_reference_digest, PACKET_HASH);
      assert.equal(envelope.ratelooppackethash, PACKET_HASH);
    }
    assert.equal(Number(row.deliveries), 1);
  }
  assert.deepEqual(await verifyWorkspaceAuditChain(fixture.workspaceId), {
    eventCount: 4,
    headDigest: String(stored.rows.find(row => Number(row.sequence) === 4)?.event_digest),
    valid: true,
  });

  const deliveredPayloads: Array<Record<string, unknown>> = [];
  const delivered = await deliverPendingAssuranceEvents({
    now: NOW,
    encryptionKey: ENCRYPTION_KEY,
    resolveHostname: resolvePublic,
    fetchImpl: async (_url, init) => {
      deliveredPayloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(null, { status: 202 });
    },
  });
  assert.equal(delivered.length, 4);
  assert.equal(
    delivered.every(outcome => outcome.state === "delivered"),
    true,
  );
  const preRunBlocked = deliveredPayloads.find(
    payload => payload.type === "ai.rateloop.gate.blocked" && payload.subject === fixture.deferredOpportunity,
  );
  assert.equal(preRunBlocked?.rateloopevidencekind, "gate_transition");
  assert.equal(preRunBlocked?.rateloopevidencedigest, HASH("6"));
  assert.equal(preRunBlocked ? "ratelooppackethash" in preRunBlocked : true, false);

  const replay = await projectAssuranceLifecycleEvents({ now: new Date(NOW.getTime() + 60_000), limit: 20 });
  assert.deepEqual(replay, {
    scanned: 0,
    projected: 0,
    replayed: 0,
    retry: 0,
    deferredWithoutPacket: { gateBlocked: 0, reviewCompleted: 0 },
    retrySources: [],
  });
  const auditCount = await dbClient.execute({
    sql: "SELECT COUNT(*) AS count FROM tokenless_audit_events WHERE workspace_id=?",
    args: [fixture.workspaceId],
  });
  assert.equal(Number(auditCount.rows[0]?.count), 4);
});

test("terminal failures project as review.failed or review.expired with gate-transition evidence", async () => {
  // Classification: expiry signals mark the event as expired; everything else fails.
  assert.equal(terminalFailureEventType(JSON.stringify(["all_assignments_expired"])), "ai.rateloop.review.expired");
  assert.equal(terminalFailureEventType(JSON.stringify(["response_deadline_elapsed"])), "ai.rateloop.review.expired");
  assert.equal(terminalFailureEventType(JSON.stringify(["adapter_failure"])), "ai.rateloop.review.failed");
  assert.equal(terminalFailureEventType("not json"), "ai.rateloop.review.failed");

  // The new event types carry gate-transition evidence, never a decision packet.
  const failed = buildAssuranceCloudEvent({
    workspaceId: "ws_test",
    sourceEventId: "review:failed:transition_1",
    eventType: "ai.rateloop.review.failed",
    evidenceReference: {
      schemaVersion: "rateloop.assurance-event-reference.v1",
      kind: "gate_transition",
      digest: HASH("7"),
    },
    evidenceChain: CHAIN_REFERENCE,
    occurredAt: NOW,
  });
  assert.equal(failed.event.rateloopevidencekind, "gate_transition");
  assert.equal(failed.ocsf.severity, "High");
  assert.equal("ratelooppackethash" in failed.event, false);
  assert.throws(
    () =>
      buildAssuranceCloudEvent({
        workspaceId: "ws_test",
        sourceEventId: "review:expired:transition_1",
        eventType: "ai.rateloop.review.expired",
        evidenceReference: PACKET_REFERENCE,
        evidenceChain: CHAIN_REFERENCE,
        occurredAt: NOW,
      }),
    /Blocked, failed, and expired events require a gate-transition reference/u,
  );

  const fixture = await seedLifecycleEventSources();
  const insertTerminal = async (opportunityId: string, eventId: string, reasonCodes: string[], commitment: string) => {
    await dbClient.execute({
      sql: `INSERT INTO tokenless_agent_review_opportunity_lifecycles
            (workspace_id,opportunity_id,state,state_revision,reason_codes_json,state_entered_at,terminal_at,
             created_at,updated_at)
            VALUES (?,?,'failed_terminal',3,?,?,?,?,?)`,
      args: [fixture.workspaceId, opportunityId, JSON.stringify(reasonCodes), NOW, NOW, NOW, NOW],
    });
    await dbClient.execute({
      sql: `INSERT INTO tokenless_agent_review_opportunity_transition_events
            (event_id,workspace_id,opportunity_id,transition_key,from_state,to_state,from_revision,to_revision,
             reason_codes_json,actor_kind,actor_reference,details_json,transition_commitment,occurred_at)
            VALUES (?,?,?,?,'pending','failed_terminal',2,3,?,'service','stream-test','{}',?,?)`,
      args: [
        eventId,
        fixture.workspaceId,
        opportunityId,
        `terminal:${opportunityId}`,
        JSON.stringify(reasonCodes),
        commitment,
        NOW,
      ],
    });
  };
  // The seeded opportunities already project; add two fresh terminal failures.
  const failedOpportunity = "aop_lifecycle_stream_failed";
  const expiredOpportunity = "aop_lifecycle_stream_expired";
  const seedOpportunity = async (opportunityId: string, externalId: string) => {
    const template = await dbClient.execute({
      sql: `SELECT * FROM tokenless_agent_review_opportunities WHERE workspace_id=? LIMIT 1`,
      args: [fixture.workspaceId],
    });
    const row = template.rows[0] as Record<string, unknown>;
    await dbClient.execute({
      sql: `INSERT INTO tokenless_agent_review_opportunities
            (opportunity_id,workspace_id,agent_id,agent_version_id,scope_id,policy_id,policy_version,
             external_opportunity_id,suggestion_commitment,declared_confidence_bps,metadata_commitment,
             metadata_complete,critical_risk,decision,review_rate_bps,selection_probability_bps,sample_bucket,
             sampler_key_version,sampler_commitment,reason_codes_json,status,run_id,source_evidence_reference,
             source_evidence_hash,human_review_binding_id,human_review_binding_version,request_profile_id,
             request_profile_version,request_profile_hash,created_at,updated_at)
            VALUES (?,?,?,?,?,?,1,?,?,9000,?,true,true,'required',10000,10000,1,'sampler-v1',?,'[]',
                    'review_requested',NULL,'evidence/lifecycle',?,?,1,?,1,?,?,?)`,
      args: [
        opportunityId,
        fixture.workspaceId,
        row.agent_id,
        row.agent_version_id,
        row.scope_id,
        row.policy_id,
        externalId,
        HASH("f"),
        HASH("1"),
        HASH("2"),
        HASH("3"),
        row.human_review_binding_id,
        row.request_profile_id,
        row.request_profile_hash,
        NOW,
        NOW,
      ],
    });
  };
  await seedOpportunity(failedOpportunity, "external-lifecycle-failed");
  await seedOpportunity(expiredOpportunity, "external-lifecycle-expired");
  const failedEventId = `hrtr_${"7".repeat(40)}`;
  const expiredEventId = `hrtr_${"8".repeat(40)}`;
  await insertTerminal(failedOpportunity, failedEventId, ["adapter_failure"], HASH("7"));
  await insertTerminal(expiredOpportunity, expiredEventId, ["all_assignments_expired"], HASH("8"));

  await projectAssuranceLifecycleEvents({ now: NOW, limit: 20 });
  const stored = await dbClient.execute({
    sql: `SELECT source_event_id,event_type,evidence_reference_kind,evidence_reference_digest,packet_hash
          FROM tokenless_assurance_event_outbox
          WHERE workspace_id=? AND event_type IN ('ai.rateloop.review.failed','ai.rateloop.review.expired')
          ORDER BY event_type ASC`,
    args: [fixture.workspaceId],
  });
  assert.equal(stored.rows.length, 2);
  const byType = new Map(stored.rows.map(row => [String(row.event_type), row]));
  assert.equal(String(byType.get("ai.rateloop.review.failed")?.source_event_id), failedEventId);
  assert.equal(String(byType.get("ai.rateloop.review.failed")?.evidence_reference_digest), HASH("7"));
  assert.equal(String(byType.get("ai.rateloop.review.expired")?.source_event_id), expiredEventId);
  assert.equal(String(byType.get("ai.rateloop.review.expired")?.evidence_reference_digest), HASH("8"));
  for (const row of stored.rows) {
    assert.equal(row.evidence_reference_kind, "gate_transition");
    assert.equal(row.packet_hash, null);
  }

  const replay = await projectAssuranceLifecycleEvents({ now: new Date(NOW.getTime() + 60_000), limit: 20 });
  assert.equal(replay.scanned, 0);
});

test("deliveries retry with a stable payload and signature, recover expired leases, and re-check SSRF on every attempt", async () => {
  const { workspaceId } = await createWorkspace({ name: "Reliable stream", ownerAddress: OWNER });
  const stream = await createAssuranceEventStream({
    accountAddress: OWNER,
    workspaceId,
    url: "https://siem.example.test/events",
    eventTypes: ["ai.rateloop.review.completed", "ai.rateloop.packet.anchored"],
    encryptionKey: ENCRYPTION_KEY,
    resolveHostname: resolvePublic,
  });
  const enqueued = await enqueueAssuranceEvent({
    workspaceId,
    sourceEventId: "review:completed:run_retry",
    eventType: "ai.rateloop.review.completed",
    evidenceReference: PACKET_REFERENCE,
    evidenceChain: CHAIN_REFERENCE,
    occurredAt: NOW,
    now: NOW,
  });
  const attempts: Array<{ body: string; headers: Headers }> = [];
  const failed = await deliverPendingAssuranceEvents({
    now: NOW,
    encryptionKey: ENCRYPTION_KEY,
    resolveHostname: resolvePublic,
    fetchImpl: async (_url, init) => {
      attempts.push({ body: String(init?.body), headers: new Headers(init?.headers) });
      return new Response(null, { status: 503 });
    },
  });
  assert.equal(failed[0]?.state, "retry");
  const retryAt = new Date(NOW.getTime() + 31_000);
  const delivered = await deliverPendingAssuranceEvents({
    now: retryAt,
    encryptionKey: ENCRYPTION_KEY,
    resolveHostname: resolvePublic,
    fetchImpl: async (_url, init) => {
      attempts.push({ body: String(init?.body), headers: new Headers(init?.headers) });
      return new Response(null, { status: 202 });
    },
  });
  assert.equal(delivered[0]?.state, "delivered");
  assert.equal(attempts[0]?.body, attempts[1]?.body);
  assert.equal(attempts[1]?.headers.get("content-type"), "application/cloudevents+json");
  assert.equal(attempts[1]?.headers.get("rateloop-event-id"), enqueued.eventId);
  const timestamp = attempts[1]?.headers.get("rateloop-timestamp");
  assert.ok(timestamp);
  const expectedSignature = `v1=${createHmac("sha256", stream.signingSecret)
    .update(`${timestamp}.${attempts[1]?.body}`)
    .digest("hex")}`;
  assert.equal(attempts[1]?.headers.get("rateloop-signature"), expectedSignature);

  const leased = await enqueueAssuranceEvent({
    workspaceId,
    sourceEventId: "packet:anchored:run_lease",
    eventType: "ai.rateloop.packet.anchored",
    evidenceReference: PACKET_REFERENCE,
    evidenceChain: CHAIN_REFERENCE,
    occurredAt: retryAt,
    now: retryAt,
  });
  await dbClient.execute({
    sql: `UPDATE tokenless_assurance_event_deliveries
          SET state='delivering',lease_expires_at=?,updated_at=? WHERE event_id=?`,
    args: [new Date(retryAt.getTime() - 1), retryAt, leased.eventId],
  });
  const recovered = await deliverPendingAssuranceEvents({
    now: retryAt,
    encryptionKey: ENCRYPTION_KEY,
    resolveHostname: resolvePublic,
    fetchImpl: async () => new Response(null, { status: 204 }),
  });
  assert.equal(recovered[0]?.state, "delivered");

  const blockedByDns = await enqueueAssuranceEvent({
    workspaceId,
    sourceEventId: "packet:anchored:run_ssrf",
    eventType: "ai.rateloop.packet.anchored",
    evidenceReference: PACKET_REFERENCE,
    evidenceChain: CHAIN_REFERENCE,
    occurredAt: new Date(retryAt.getTime() + 1_000),
    now: new Date(retryAt.getTime() + 1_000),
  });
  let fetched = false;
  const blocked = await deliverPendingAssuranceEvents({
    now: new Date(retryAt.getTime() + 1_000),
    encryptionKey: ENCRYPTION_KEY,
    resolveHostname: async () => ["127.0.0.1"],
    fetchImpl: async () => {
      fetched = true;
      return new Response(null, { status: 200 });
    },
  });
  assert.equal(blocked[0]?.deliveryId.startsWith("aed_"), true);
  assert.equal(blocked[0]?.state, "retry");
  assert.equal(fetched, false);
  const ssrfState = await dbClient.execute({
    sql: "SELECT state,last_error FROM tokenless_assurance_event_deliveries WHERE event_id=?",
    args: [blockedByDns.eventId],
  });
  assert.equal(ssrfState.rows[0].state, "retry");
  assert.match(String(ssrfState.rows[0].last_error), /private or local/u);
});

test("an expired assurance-event worker cannot overwrite its successor's delivery", async () => {
  const { workspaceId } = await createWorkspace({ name: "Fenced stream", ownerAddress: OWNER });
  await createAssuranceEventStream({
    accountAddress: OWNER,
    workspaceId,
    url: "https://siem.example.test/events",
    eventTypes: ["ai.rateloop.review.completed"],
    encryptionKey: ENCRYPTION_KEY,
    resolveHostname: resolvePublic,
  });
  const enqueued = await enqueueAssuranceEvent({
    workspaceId,
    sourceEventId: "review:completed:run_fenced",
    eventType: "ai.rateloop.review.completed",
    evidenceReference: PACKET_REFERENCE,
    evidenceChain: CHAIN_REFERENCE,
    occurredAt: NOW,
    now: NOW,
  });

  let releaseExpiredWorker!: () => void;
  let markExpiredWorkerStarted!: () => void;
  const expiredWorkerStarted = new Promise<void>(resolve => {
    markExpiredWorkerStarted = resolve;
  });
  const expiredWorkerCanReturn = new Promise<void>(resolve => {
    releaseExpiredWorker = resolve;
  });
  const expiredWorker = deliverPendingAssuranceEvents({
    now: NOW,
    encryptionKey: ENCRYPTION_KEY,
    resolveHostname: resolvePublic,
    fetchImpl: async () => {
      markExpiredWorkerStarted();
      await expiredWorkerCanReturn;
      return new Response(null, { status: 503 });
    },
  });
  await expiredWorkerStarted;

  const currentWorker = await deliverPendingAssuranceEvents({
    now: new Date(NOW.getTime() + 60_001),
    encryptionKey: ENCRYPTION_KEY,
    resolveHostname: resolvePublic,
    fetchImpl: async () => new Response(null, { status: 202 }),
  });
  assert.equal(currentWorker[0]?.state, "delivered");

  releaseExpiredWorker();
  assert.deepEqual(await expiredWorker, []);
  const durable = await dbClient.execute({
    sql: `SELECT state,lease_generation,response_status,last_error
          FROM tokenless_assurance_event_deliveries WHERE event_id=?`,
    args: [enqueued.eventId],
  });
  assert.equal(durable.rows[0]?.state, "delivered");
  assert.equal(Number(durable.rows[0]?.lease_generation), 2);
  assert.equal(Number(durable.rows[0]?.response_status), 202);
  assert.equal(durable.rows[0]?.last_error, null);
});

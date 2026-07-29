import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  createEvidenceShareGrant,
  listEvidenceShareGrants,
  redeemEvidenceShareGrant,
  revokeEvidenceShareGrant,
} from "~~/lib/tokenless/evidenceShareGrants";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import { createProjectOwnerAssignment, grantProjectAccountAccess } from "~~/lib/tokenless/projectAccess";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const OWNER = "0x1111111111111111111111111111111111111111";
const AUDITOR = "0x2222222222222222222222222222222222222222";
const CONTRIBUTOR = "0x3333333333333333333333333333333333333333";
const OUTSIDER = "0x4444444444444444444444444444444444444444";
const NOW = new Date("2026-07-29T12:00:00.000Z");
const HASH = (character: string) => `sha256:${character.repeat(64)}`;
const PACKET = {
  payload: { packetId: "packet_share_test", runId: "run_share_test", aggregation: { suite: { outcome: "pass" } } },
  signing: { algorithm: "Ed25519", keyId: "ed25519:test", publicKey: "test-public-key" },
  packetDigest: HASH("9"),
  signature: "test-signature",
};

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

async function seedEvidence() {
  const { workspaceId } = await createWorkspace({ name: "Evidence share", ownerAddress: OWNER });
  const projectId = "project_share_test";
  const rubricId = "rubric_share_test";
  const suiteId = "suite_share_test";
  const policyId = "policy_share_test";
  const runId = "run_share_test";
  const packetId = "packet_share_test";
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_projects
          (project_id,workspace_id,name,data_classification,status,retention_days,created_by,created_at,updated_at)
          VALUES (?,?,'Evidence share','confidential','active',30,?,?,?)`,
    args: [projectId, workspaceId, OWNER, NOW, NOW],
  });
  await createProjectOwnerAssignment({ accountAddress: OWNER, now: NOW, projectId, workspaceId });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_rubrics
          (rubric_id,project_id,version,prompt,failure_tags_json,rationale_json,pass_rule_json,rubric_json,created_at)
          VALUES (?,?,1,'Review','[]','{}','{}','{}',?)`,
    args: [rubricId, projectId, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_suites
          (suite_id,project_id,name,version,status,rubric_id,rubric_version,created_at,updated_at)
          VALUES (?,?,'Evidence share suite',1,'frozen',?,1,?,?)`,
    args: [suiteId, projectId, rubricId, NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_audience_policies
          (policy_id,project_id,version,reviewer_source,compensation,cohorts_json,selection,
           fallbacks_json,required_qualifications_json,assurance_json,buyer_privacy_json,
           legal_eligibility_required,policy_hash,policy_json,created_at)
          VALUES (?,?,1,'public_network','unpaid','[]','open','{}','[]','{}','{}',false,?,'{}',?)`,
    args: [policyId, projectId, HASH("1"), NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_runs
          (run_id,project_id,suite_id,suite_version,audience_policy_id,audience_policy_version,
           status,policy_hash,created_by,created_at,updated_at,completed_at)
          VALUES (?,?,?,1,?,1,'completed',?,?,?,?,?)`,
    args: [runId, projectId, suiteId, policyId, HASH("1"), OWNER, NOW, NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_evidence_packets
          (packet_id,run_id,manifest_hash,case_root,response_root,aggregation_version,result_json,
           limitations_json,chain_references_json,signature,generated_at,packet_digest,packet_json,
           signature_algorithm,signing_key_id,signing_public_key)
          VALUES (?,?,?,'case-root','response-root','v1','{}','[]','{}','test-signature',?,?,?,
                  'Ed25519','ed25519:test','test-public-key')`,
    args: [packetId, runId, HASH("2"), NOW, HASH("9"), JSON.stringify(PACKET)],
  });
  return { packetId, projectId, runId, workspaceId };
}

function isPublicNotFound(error: unknown) {
  return (
    error instanceof TokenlessServiceError &&
    error.status === 404 &&
    error.code === "evidence_share_not_found" &&
    error.message === "Shared evidence packet not found."
  );
}

test("creates a 256-bit one-time secret while persisting only its digest and narrowed record IDs", async () => {
  const scope = await seedEvidence();
  const created = await createEvidenceShareGrant({
    accountAddress: OWNER,
    expiresAt: new Date(NOW.getTime() + 7 * 86_400_000),
    now: NOW,
    runId: scope.runId,
    workspaceId: scope.workspaceId,
  });

  assert.equal(Buffer.from(created.bearerSecret, "base64url").byteLength, 32);
  assert.match(created.bearerSecret, /^[A-Za-z0-9_-]{43}$/u);
  assert.match(created.grant.grantId, /^esh_[A-Za-z0-9_-]{22}$/u);
  assert.equal(created.grant.packetId, scope.packetId);
  const stored = await dbClient.execute(
    `SELECT grant_id,token_hash,workspace_id,project_id,run_id,packet_id,created_by
     FROM tokenless_assurance_evidence_share_grants`,
  );
  assert.equal(stored.rows.length, 1);
  assert.match(String(stored.rows[0]?.token_hash), /^sha256:[0-9a-f]{64}$/u);
  assert.equal(stored.rows[0]?.workspace_id, scope.workspaceId);
  assert.equal(stored.rows[0]?.project_id, scope.projectId);
  assert.equal(stored.rows[0]?.run_id, scope.runId);
  assert.equal(stored.rows[0]?.packet_id, scope.packetId);
  assert.equal(JSON.stringify(stored.rows).includes(created.bearerSecret), false);

  const listed = await listEvidenceShareGrants({
    accountAddress: OWNER,
    now: NOW,
    runId: scope.runId,
    workspaceId: scope.workspaceId,
  });
  assert.deepEqual(listed, [created.grant]);
});

test("redemption returns only the packet and atomically records governed access without the secret", async () => {
  const scope = await seedEvidence();
  const created = await createEvidenceShareGrant({
    accountAddress: OWNER,
    expiresAt: new Date(NOW.getTime() + 86_400_000),
    now: NOW,
    runId: scope.runId,
    workspaceId: scope.workspaceId,
  });
  const redeemedAt = new Date(NOW.getTime() + 1_000);
  const packet = await redeemEvidenceShareGrant({
    bearerSecret: created.bearerSecret,
    grantId: created.grant.grantId,
    now: redeemedAt,
  });
  assert.deepEqual(packet, PACKET);

  const stored = await dbClient.execute({
    sql: `SELECT access_count,last_accessed_at FROM tokenless_assurance_evidence_share_grants WHERE grant_id=?`,
    args: [created.grant.grantId],
  });
  assert.equal(Number(stored.rows[0]?.access_count), 1);
  assert.equal(new Date(String(stored.rows[0]?.last_accessed_at)).toISOString(), redeemedAt.toISOString());
  const logs = await dbClient.execute({
    sql: `SELECT workspace_id,project_id,artifact_id,lease_id,actor_kind,actor_reference,
                 action,purpose,request_reference
          FROM tokenless_assurance_access_logs`,
  });
  const publicLogs = logs.rows.filter(row => row.actor_kind === "public_share");
  assert.equal(publicLogs.length, 1);
  assert.equal(publicLogs[0]?.workspace_id, scope.workspaceId);
  assert.equal(publicLogs[0]?.project_id, scope.projectId);
  assert.equal(publicLogs[0]?.artifact_id, null);
  assert.equal(publicLogs[0]?.lease_id, null);
  assert.equal(publicLogs[0]?.actor_reference, created.grant.grantId);
  assert.equal(publicLogs[0]?.action, "read");
  assert.equal(publicLogs[0]?.purpose, "evidence_share");
  assert.equal(JSON.stringify(logs.rows).includes(created.bearerSecret), false);
});

test("malformed, wrong, expired, and revoked capabilities have one public 404 response", async () => {
  const scope = await seedEvidence();
  const create = (expiresAt: Date) =>
    createEvidenceShareGrant({
      accountAddress: OWNER,
      expiresAt,
      now: NOW,
      runId: scope.runId,
      workspaceId: scope.workspaceId,
    });
  const valid = await create(new Date(NOW.getTime() + 60_000));
  const expired = await create(new Date(NOW.getTime() + 1_000));
  const revoked = await create(new Date(NOW.getTime() + 60_000));
  await revokeEvidenceShareGrant({
    accountAddress: OWNER,
    grantId: revoked.grant.grantId,
    now: new Date(NOW.getTime() + 500),
    runId: scope.runId,
    workspaceId: scope.workspaceId,
  });

  await Promise.all([
    assert.rejects(
      () => redeemEvidenceShareGrant({ bearerSecret: "not-a-secret", grantId: "not-a-grant", now: NOW }),
      isPublicNotFound,
    ),
    assert.rejects(
      () =>
        redeemEvidenceShareGrant({
          bearerSecret: Buffer.alloc(32, 8).toString("base64url"),
          grantId: valid.grant.grantId,
          now: NOW,
        }),
      isPublicNotFound,
    ),
    assert.rejects(
      () =>
        redeemEvidenceShareGrant({
          bearerSecret: expired.bearerSecret,
          grantId: expired.grant.grantId,
          now: new Date(NOW.getTime() + 1_001),
        }),
      isPublicNotFound,
    ),
    assert.rejects(
      () =>
        redeemEvidenceShareGrant({
          bearerSecret: revoked.bearerSecret,
          grantId: revoked.grant.grantId,
          now: new Date(NOW.getTime() + 1_000),
        }),
      isPublicNotFound,
    ),
  ]);
});

test("a corrupted packet identity fails closed without recording a successful redemption", async () => {
  const scope = await seedEvidence();
  const created = await createEvidenceShareGrant({
    accountAddress: OWNER,
    expiresAt: new Date(NOW.getTime() + 60_000),
    now: NOW,
    runId: scope.runId,
    workspaceId: scope.workspaceId,
  });
  await dbClient.execute({
    sql: "UPDATE tokenless_assurance_evidence_packets SET packet_json=? WHERE packet_id=?",
    args: [JSON.stringify({ ...PACKET, payload: { ...PACKET.payload, runId: "run_wrong" } }), scope.packetId],
  });
  await assert.rejects(
    () =>
      redeemEvidenceShareGrant({
        bearerSecret: created.bearerSecret,
        grantId: created.grant.grantId,
        now: new Date(NOW.getTime() + 1_000),
      }),
    /Stored evidence packet identity is invalid/u,
  );
  const grant = await dbClient.execute({
    sql: "SELECT access_count,last_accessed_at FROM tokenless_assurance_evidence_share_grants WHERE grant_id=?",
    args: [created.grant.grantId],
  });
  assert.equal(Number(grant.rows[0]?.access_count), 0);
  assert.equal(grant.rows[0]?.last_accessed_at, null);
  const publicLogs = await dbClient.execute(
    "SELECT log_id FROM tokenless_assurance_access_logs WHERE actor_kind='public_share'",
  );
  assert.equal(publicLogs.rows.length, 0);
});

test("export authorization permits auditors while contributors, outsiders, and cross-scope revocation fail closed", async () => {
  const scope = await seedEvidence();
  await grantProjectAccountAccess({
    accountAddress: AUDITOR,
    grantedBy: OWNER,
    projectId: scope.projectId,
    role: "auditor",
    workspaceId: scope.workspaceId,
  });
  await grantProjectAccountAccess({
    accountAddress: CONTRIBUTOR,
    grantedBy: OWNER,
    projectId: scope.projectId,
    role: "contributor",
    workspaceId: scope.workspaceId,
  });
  const created = await createEvidenceShareGrant({
    accountAddress: AUDITOR,
    expiresAt: new Date(NOW.getTime() + 60_000),
    now: NOW,
    runId: scope.runId,
    workspaceId: scope.workspaceId,
  });
  assert.equal(created.grant.status, "active");
  for (const accountAddress of [CONTRIBUTOR, OUTSIDER]) {
    await assert.rejects(
      () =>
        createEvidenceShareGrant({
          accountAddress,
          expiresAt: new Date(NOW.getTime() + 60_000),
          now: NOW,
          runId: scope.runId,
          workspaceId: scope.workspaceId,
        }),
      (error: unknown) =>
        error instanceof TokenlessServiceError && error.status === 404 && error.code === "assurance_run_not_found",
    );
  }
  await assert.rejects(
    () =>
      revokeEvidenceShareGrant({
        accountAddress: AUDITOR,
        grantId: created.grant.grantId,
        now: NOW,
        runId: "run_other",
        workspaceId: scope.workspaceId,
      }),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.status === 404 && error.code === "assurance_run_not_found",
  );
});

test("expiry is mandatory, future-bound, and capped at 30 days", async () => {
  const scope = await seedEvidence();
  for (const expiresAt of [NOW, new Date(NOW.getTime() + 30 * 86_400_000 + 1)]) {
    await assert.rejects(
      () =>
        createEvidenceShareGrant({
          accountAddress: OWNER,
          expiresAt,
          now: NOW,
          runId: scope.runId,
          workspaceId: scope.workspaceId,
        }),
      (error: unknown) =>
        error instanceof TokenlessServiceError &&
        error.status === 400 &&
        error.code === "invalid_evidence_share_expiry",
    );
  }
});

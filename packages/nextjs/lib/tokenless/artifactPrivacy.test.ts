import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { appendAuditEvent } from "~~/lib/privacy/audit";
import { createLegalHold } from "~~/lib/privacy/lifecycle";
import {
  type PrivateArtifactStore,
  __artifactPrivacyTestUtils,
  __setArtifactPrivacyRuntimeForTests,
  issueArtifactLease,
  listArtifactAccessLog,
  processArtifactDeletionByObjectId,
  processDueArtifactDeletions,
  readEncryptedArtifact,
  registerArtifactManagedKeyProvider,
  requestProjectDeletion,
  storeEncryptedArtifact,
} from "~~/lib/tokenless/artifactPrivacy";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import { createProjectOwnerAssignment } from "~~/lib/tokenless/projectAccess";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const OWNER = "0x1111111111111111111111111111111111111111";
const REVIEWER = "0x2222222222222222222222222222222222222222";
const OPAQUE_OWNER = "rlp_artifact_owner_principal_0001";
const artifactPrivacySource = readFileSync(new URL("./artifactPrivacy.ts", import.meta.url), "utf8");

class MemoryPrivateStore implements PrivateArtifactStore {
  deleteCalls = 0;
  failAfterDeleteOnce = false;
  failBeforeDeleteOnce = false;
  readonly objects = new Map<string, Uint8Array>();

  async delete(reference: string) {
    this.deleteCalls += 1;
    if (this.failBeforeDeleteOnce) {
      this.failBeforeDeleteOnce = false;
      throw new Error("provider unavailable before delete");
    }
    this.objects.delete(reference);
    if (this.failAfterDeleteOnce) {
      this.failAfterDeleteOnce = false;
      throw new Error("provider response lost after delete");
    }
  }

  async get(reference: string) {
    const value = this.objects.get(reference);
    if (!value) throw new Error("missing object");
    return new Uint8Array(value);
  }

  async put(pathname: string, body: Uint8Array) {
    const reference = `memory://${pathname}`;
    this.objects.set(reference, new Uint8Array(body));
    return reference;
  }
}

let store: MemoryPrivateStore;

type DeletionHookPhase =
  | "after_provider_delete"
  | "after_provider_checkpoint"
  | "before_finalize_commit"
  | "after_audit_append";

function configureRuntime(
  input: {
    auditWriter?: typeof appendAuditEvent;
    deletionHook?: (phase: DeletionHookPhase) => Promise<void> | void;
  } = {},
) {
  __setArtifactPrivacyRuntimeForTests({
    auditWriter: input.auditWriter,
    deletionHook: input.deletionHook,
    keyVersion: "artifact-test-v1",
    masterKey: Buffer.alloc(32, 7),
    store,
  });
}

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  store = new MemoryPrivateStore();
  configureRuntime();
});

afterEach(() => {
  __setArtifactPrivacyRuntimeForTests(null);
  registerArtifactManagedKeyProvider(null);
  __setDatabaseResourcesForTests(null);
});

async function seedProject(owner = OWNER, name = "Private quality loop") {
  const { workspaceId } = await createWorkspace({ name: `${name} workspace`, ownerAddress: owner });
  const projectId = `project_${workspaceId.slice(-8)}`;
  const now = new Date("2026-07-13T12:00:00.000Z");
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_projects
          (project_id, workspace_id, name, data_classification, status, retention_days, created_by, created_at, updated_at)
          VALUES (?, ?, ?, 'confidential', 'active', 30, ?, ?, ?)`,
    args: [projectId, workspaceId, name, owner.toLowerCase(), now, now],
  });
  await createProjectOwnerAssignment({ accountAddress: owner, projectId, workspaceId, now });
  return { projectId, workspaceId };
}

async function upload(project: { projectId: string; workspaceId: string }, text = "private customer prompt") {
  return storeEncryptedArtifact({
    accountAddress: OWNER,
    bytes: new TextEncoder().encode(text),
    contentType: "text/plain",
    label: "Candidate response",
    projectId: project.projectId,
    redactionStatus: "approved",
    rendererPolicy: "plain_text",
    role: "candidate",
    workspaceId: project.workspaceId,
  });
}

async function objectIdForArtifact(artifactId: string) {
  const result = await dbClient.execute({
    sql: "SELECT object_id FROM tokenless_assurance_artifact_objects WHERE artifact_id = ?",
    args: [artifactId],
  });
  return String(result.rows[0]?.object_id);
}

async function artifactDeletionJob(objectId: string) {
  const result = await dbClient.execute({
    sql: `SELECT state, provider_deleted_at, finalized_at, audit_event_id
          FROM tokenless_artifact_deletion_jobs WHERE object_id = ?`,
    args: [objectId],
  });
  return result.rows[0];
}

async function artifactDeletionAuditCount(workspaceId: string) {
  const result = await dbClient.execute({
    sql: `SELECT COUNT(*) AS count FROM tokenless_audit_events
          WHERE workspace_id = ? AND action = 'artifact.retention_delete'`,
    args: [workspaceId],
  });
  return Number(result.rows[0]?.count ?? 0);
}

test("artifact finalization preserves the workspace-before-job lock order", () => {
  const start = artifactPrivacySource.indexOf("async function finalizeArtifactDeletion");
  const end = artifactPrivacySource.indexOf("function isUniqueViolation", start);
  const implementation = artifactPrivacySource.slice(start, end);
  const identityRead = implementation.indexOf("SELECT workspace_id FROM tokenless_artifact_deletion_jobs");
  const workspaceLock = implementation.indexOf(
    "SELECT workspace_id FROM tokenless_workspaces WHERE workspace_id = $1 FOR UPDATE",
  );
  const jobLock = implementation.indexOf("artifactDeletionJob(client, objectId, true)");

  assert.ok(start >= 0 && end > start);
  assert.ok(identityRead >= 0 && identityRead < workspaceLock);
  assert.ok(workspaceLock < jobLock);
});

test("artifact plaintext stays out of Postgres and private object storage", async () => {
  const project = await seedProject();
  const artifact = await upload(project);
  const rows = await dbClient.execute({
    sql: `SELECT a.digest, a.storage_ref, o.wrapped_data_key, o.content_nonce, o.content_auth_tag
          FROM tokenless_assurance_artifacts a
          JOIN tokenless_assurance_artifact_objects o ON o.artifact_id = a.artifact_id
          WHERE a.artifact_id = ?`,
    args: [artifact.artifactId],
  });
  const serialized = JSON.stringify(rows.rows);
  assert.doesNotMatch(serialized, /private customer prompt/);
  assert.match(String(rows.rows[0]?.digest), /^sha256:[0-9a-f]{64}$/);
  const storedBytes = [...store.objects.values()][0];
  assert.ok(storedBytes);
  assert.doesNotMatch(new TextDecoder().decode(storedBytes), /private customer prompt/);

  const read = await readEncryptedArtifact({
    accountAddress: OWNER,
    artifactId: artifact.artifactId,
    projectId: project.projectId,
    workspaceId: project.workspaceId,
  });
  assert.equal(new TextDecoder().decode(read.bytes), "private customer prompt");
});

test("opaque Better Auth principals retain assigned artifact access without a wallet", async () => {
  const project = await seedProject(OPAQUE_OWNER, "Opaque principal");
  const artifact = await storeEncryptedArtifact({
    accountAddress: OPAQUE_OWNER,
    bytes: new TextEncoder().encode("wallet-independent artifact"),
    contentType: "text/plain",
    label: "Opaque owner artifact",
    projectId: project.projectId,
    redactionStatus: "approved",
    rendererPolicy: "plain_text",
    role: "candidate",
    workspaceId: project.workspaceId,
  });
  const read = await readEncryptedArtifact({
    accountAddress: OPAQUE_OWNER,
    artifactId: artifact.artifactId,
    projectId: project.projectId,
    workspaceId: project.workspaceId,
  });
  assert.equal(new TextDecoder().decode(read.bytes), "wallet-independent artifact");
  const logs = await listArtifactAccessLog({ accountAddress: OPAQUE_OWNER, ...project });
  assert.ok(logs.every(row => String(row.actor_kind) === "principal"));
});

test("cross-tenant reads fail closed while a short account-bound lease grants minimum access", async () => {
  const project = await seedProject();
  const artifact = await upload(project, "assigned case only");
  await seedProject(REVIEWER, "Other tenant");
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_members (workspace_id, account_address, role, created_at)
          VALUES (?, ?, 'billing', ?)`,
    args: [project.workspaceId, REVIEWER.toLowerCase(), new Date("2026-07-13T12:30:00.000Z")],
  });
  await assert.rejects(
    () =>
      readEncryptedArtifact({
        accountAddress: REVIEWER,
        artifactId: artifact.artifactId,
        projectId: project.projectId,
        workspaceId: project.workspaceId,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "artifact_not_found",
  );

  const now = new Date("2026-07-13T13:00:00.000Z");
  const lease = await issueArtifactLease({
    accountAddress: OWNER,
    artifactId: artifact.artifactId,
    expiresAt: new Date(now.getTime() + 5 * 60_000),
    projectId: project.projectId,
    purpose: "assigned_review",
    recipientAddress: REVIEWER,
    workspaceId: project.workspaceId,
    now,
  });
  const read = await readEncryptedArtifact({
    accountAddress: REVIEWER,
    artifactId: artifact.artifactId,
    leaseId: lease.leaseId,
    projectId: project.projectId,
    workspaceId: project.workspaceId,
    now: new Date(now.getTime() + 60_000),
  });
  assert.equal(new TextDecoder().decode(read.bytes), "assigned case only");
  await assert.rejects(
    () =>
      readEncryptedArtifact({
        accountAddress: REVIEWER,
        artifactId: artifact.artifactId,
        leaseId: lease.leaseId,
        projectId: project.projectId,
        workspaceId: project.workspaceId,
        now: new Date(now.getTime() + 6 * 60_000),
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "artifact_not_found",
  );

  const logs = await listArtifactAccessLog({ accountAddress: OWNER, ...project });
  assert.deepEqual(logs.map(row => String(row.action)).sort(), ["create", "lease", "read"]);
  assert.equal(JSON.stringify(logs).includes(REVIEWER.toLowerCase()), false);
});

test("retention deletion removes ciphertext and tombstones the database reference", async () => {
  const project = await seedProject();
  const artifact = await upload(project, "delete this artifact");
  const now = new Date("2026-07-13T14:00:00.000Z");
  await requestProjectDeletion({
    accountAddress: OWNER,
    projectId: project.projectId,
    reason: "customer_request",
    workspaceId: project.workspaceId,
    now,
  });
  assert.deepEqual(await processDueArtifactDeletions(now), { deleted: 1 });
  assert.equal(store.objects.size, 0);
  const rows = await dbClient.execute({
    sql: "SELECT storage_ref FROM tokenless_assurance_artifacts WHERE artifact_id = ?",
    args: [artifact.artifactId],
  });
  assert.equal(String(rows.rows[0]?.storage_ref), `deleted://${artifact.artifactId}`);
  await assert.rejects(
    () => readEncryptedArtifact({ accountAddress: OWNER, artifactId: artifact.artifactId, ...project }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "artifact_not_found",
  );
});

test("a provider delete followed by a metadata-finalize rollback resumes from its durable checkpoint", async () => {
  const project = await seedProject();
  const artifact = await upload(project, "finalize after provider delete");
  const objectId = await objectIdForArtifact(artifact.artifactId);
  const now = new Date("2026-07-13T14:00:00.000Z");
  await requestProjectDeletion({
    accountAddress: OWNER,
    projectId: project.projectId,
    reason: "customer_request",
    workspaceId: project.workspaceId,
    now,
  });
  let failFinalize = true;
  configureRuntime({
    deletionHook(phase) {
      if (phase === "before_finalize_commit" && failFinalize) {
        failFinalize = false;
        throw new Error("database commit unavailable");
      }
    },
  });

  await assert.rejects(() => processArtifactDeletionByObjectId(objectId, now), /database commit unavailable/);
  assert.equal(store.objects.size, 0);
  assert.equal(store.deleteCalls, 1);
  assert.equal(String((await artifactDeletionJob(objectId))?.state), "provider_deleted");
  assert.equal(
    String(
      (
        await dbClient.execute({
          sql: "SELECT status FROM tokenless_assurance_artifact_objects WHERE object_id = ?",
          args: [objectId],
        })
      ).rows[0]?.status,
    ),
    "active",
  );

  configureRuntime();
  assert.deepEqual(await processDueArtifactDeletions(new Date(now.getTime() + 1_000)), { deleted: 1 });
  assert.equal(store.deleteCalls, 1);
  assert.equal(String((await artifactDeletionJob(objectId))?.state), "completed");
  assert.equal(await artifactDeletionAuditCount(project.workspaceId), 1);
});

test("an unknown provider outcome retries the idempotent delete without losing completion", async () => {
  const project = await seedProject();
  const artifact = await upload(project, "provider response can disappear");
  const objectId = await objectIdForArtifact(artifact.artifactId);
  const now = new Date("2026-07-13T14:00:00.000Z");
  await requestProjectDeletion({
    accountAddress: OWNER,
    projectId: project.projectId,
    reason: "customer_request",
    workspaceId: project.workspaceId,
    now,
  });
  store.failAfterDeleteOnce = true;

  await assert.rejects(() => processArtifactDeletionByObjectId(objectId, now), /provider response lost/);
  assert.equal(store.objects.size, 0);
  assert.equal(String((await artifactDeletionJob(objectId))?.state), "provider_pending");
  assert.equal(await processArtifactDeletionByObjectId(objectId, new Date(now.getTime() + 31_000)), true);
  assert.equal(store.deleteCalls, 2);
  assert.equal(String((await artifactDeletionJob(objectId))?.state), "completed");
  assert.equal(await artifactDeletionAuditCount(project.workspaceId), 1);
});

test("a transient canonical-audit failure leaves finalized deletion work retryable", async () => {
  const project = await seedProject();
  const artifact = await upload(project, "audit after deletion");
  const objectId = await objectIdForArtifact(artifact.artifactId);
  const now = new Date("2026-07-13T14:00:00.000Z");
  await requestProjectDeletion({
    accountAddress: OWNER,
    projectId: project.projectId,
    reason: "customer_request",
    workspaceId: project.workspaceId,
    now,
  });
  configureRuntime({
    async auditWriter() {
      throw new Error("audit database temporarily unavailable");
    },
  });

  await assert.rejects(
    () => processArtifactDeletionByObjectId(objectId, now),
    /audit database temporarily unavailable/,
  );
  assert.equal(store.objects.size, 0);
  assert.equal(store.deleteCalls, 1);
  assert.equal(String((await artifactDeletionJob(objectId))?.state), "finalized");
  assert.equal(await artifactDeletionAuditCount(project.workspaceId), 0);

  configureRuntime();
  assert.deepEqual(await processDueArtifactDeletions(new Date(now.getTime() + 1_000)), { deleted: 1 });
  assert.equal(store.deleteCalls, 1);
  assert.equal(String((await artifactDeletionJob(objectId))?.state), "completed");
  assert.equal(await artifactDeletionAuditCount(project.workspaceId), 1);
});

test("a preseeded event with the deletion correlation cannot complete a different artifact audit", async () => {
  const project = await seedProject();
  const artifact = await upload(project, "reject conflicting deletion evidence");
  const objectId = await objectIdForArtifact(artifact.artifactId);
  const now = new Date("2026-07-13T14:00:00.000Z");
  await appendAuditEvent({
    action: "artifact.retention_delete",
    actorKind: "system",
    actorReference: "system:retention_worker",
    assuranceMethod: "scheduled_worker",
    occurredAt: new Date(now.getTime() - 1_000),
    purpose: "retention_enforcement",
    reason: "conflicting_preseeded_event",
    requestCorrelation: `artifact-retention:${objectId}`,
    result: "success",
    targetId: "art_conflicting_target",
    targetKind: "artifact",
    workspaceId: project.workspaceId,
  });
  await requestProjectDeletion({
    accountAddress: OWNER,
    projectId: project.projectId,
    reason: "customer_request",
    workspaceId: project.workspaceId,
    now,
  });

  await assert.rejects(
    () => processArtifactDeletionByObjectId(objectId, now),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "artifact_deletion_audit_conflict",
  );
  assert.equal(store.objects.size, 0);
  assert.equal(String((await artifactDeletionJob(objectId))?.state), "finalized");
  assert.equal(await artifactDeletionAuditCount(project.workspaceId), 1);
});

test("retry after audit append reuses the canonical event instead of duplicating it", async () => {
  const project = await seedProject();
  const artifact = await upload(project, "single canonical deletion event");
  const objectId = await objectIdForArtifact(artifact.artifactId);
  const now = new Date("2026-07-13T14:00:00.000Z");
  await requestProjectDeletion({
    accountAddress: OWNER,
    projectId: project.projectId,
    reason: "customer_request",
    workspaceId: project.workspaceId,
    now,
  });
  let loseCheckpoint = true;
  configureRuntime({
    deletionHook(phase) {
      if (phase === "after_audit_append" && loseCheckpoint) {
        loseCheckpoint = false;
        throw new Error("audit checkpoint commit lost");
      }
    },
  });

  await assert.rejects(() => processArtifactDeletionByObjectId(objectId, now), /audit checkpoint commit lost/);
  assert.equal(String((await artifactDeletionJob(objectId))?.state), "finalized");
  assert.equal(await artifactDeletionAuditCount(project.workspaceId), 1);

  configureRuntime();
  assert.equal(await processArtifactDeletionByObjectId(objectId, new Date(now.getTime() + 1_000)), true);
  assert.equal(await processArtifactDeletionByObjectId(objectId, new Date(now.getTime() + 2_000)), true);
  assert.equal(store.deleteCalls, 1);
  assert.equal(String((await artifactDeletionJob(objectId))?.state), "completed");
  assert.equal(await artifactDeletionAuditCount(project.workspaceId), 1);
});

test("a hold placed after a failed provider attempt blocks the retry before ciphertext deletion", async () => {
  const project = await seedProject();
  const artifact = await upload(project, "hold pending retry");
  const objectId = await objectIdForArtifact(artifact.artifactId);
  const now = new Date("2026-07-13T14:00:00.000Z");
  await requestProjectDeletion({
    accountAddress: OWNER,
    projectId: project.projectId,
    reason: "customer_request",
    workspaceId: project.workspaceId,
    now,
  });
  store.failBeforeDeleteOnce = true;
  await assert.rejects(() => processArtifactDeletionByObjectId(objectId, now), /provider unavailable/);
  assert.equal(store.objects.size, 1);
  assert.equal(String((await artifactDeletionJob(objectId))?.state), "provider_pending");

  await createLegalHold({
    accountAddress: OWNER,
    projectId: project.projectId,
    reason: "new dispute",
    reviewAt: new Date(now.getTime() + 86_400_000),
    workspaceId: project.workspaceId,
    now: new Date(now.getTime() + 1_000),
  });
  await assert.rejects(
    () => processArtifactDeletionByObjectId(objectId, new Date(now.getTime() + 31_000)),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "deletion_blocked_by_hold",
  );
  assert.equal(store.objects.size, 1);
  assert.equal(store.deleteCalls, 1);
  assert.equal(String((await artifactDeletionJob(objectId))?.state), "provider_pending");
});

test("an active legal hold defers scheduled deletion without consuming the object", async () => {
  const project = await seedProject();
  const artifact = await upload(project, "hold this artifact");
  const now = new Date("2026-07-13T14:00:00.000Z");
  await requestProjectDeletion({
    accountAddress: OWNER,
    projectId: project.projectId,
    reason: "customer_request",
    workspaceId: project.workspaceId,
    now,
  });
  await createLegalHold({
    accountAddress: OWNER,
    projectId: project.projectId,
    reason: "active dispute",
    reviewAt: new Date(now.getTime() + 86_400_000),
    workspaceId: project.workspaceId,
    now,
  });
  const object = await dbClient.execute({
    sql: "SELECT object_id FROM tokenless_assurance_artifact_objects WHERE artifact_id = ?",
    args: [artifact.artifactId],
  });
  await assert.rejects(
    () => processArtifactDeletionByObjectId(String(object.rows[0]?.object_id), now),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.retryable && error.code === "deletion_blocked_by_hold",
  );
  assert.equal(store.objects.size, 1);
  assert.equal(
    String(
      (
        await dbClient.execute({
          sql: "SELECT status FROM tokenless_assurance_artifact_objects WHERE artifact_id = ?",
          args: [artifact.artifactId],
        })
      ).rows[0]?.status,
    ),
    "active",
  );
});

test("ordinary retention cannot delete encrypted evidence before the active workspace policy ends", async () => {
  const project = await seedProject();
  const artifact = await upload(project, "retain until workspace policy ends");
  const now = new Date("2026-08-17T14:00:00.000Z");
  await dbClient.execute({
    sql: "UPDATE tokenless_assurance_artifact_objects SET delete_after = ? WHERE artifact_id = ?",
    args: [new Date("2026-08-01T00:00:00.000Z"), artifact.artifactId],
  });
  const object = await dbClient.execute({
    sql: "SELECT object_id FROM tokenless_assurance_artifact_objects WHERE artifact_id = ?",
    args: [artifact.artifactId],
  });
  await assert.rejects(
    () => processArtifactDeletionByObjectId(String(object.rows[0]?.object_id), now),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "deletion_not_due" && error.retryable,
  );
  assert.equal(store.objects.size, 1);
});

test("artifact vault refuses browser-exposed keys and malformed master keys", () => {
  __setArtifactPrivacyRuntimeForTests(null);
  assert.throws(
    () =>
      __artifactPrivacyTestUtils.getRuntime({
        NEXT_PUBLIC_TOKENLESS_ARTIFACT_MASTER_KEY: "forbidden",
        TOKENLESS_ARTIFACT_MASTER_KEY: Buffer.alloc(32).toString("base64url"),
      } as unknown as NodeJS.ProcessEnv),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "public_vault_key_forbidden",
  );
  assert.throws(
    () => __artifactPrivacyTestUtils.decodeMasterKey("too-short"),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_artifact_key",
  );
  assert.throws(
    () =>
      __artifactPrivacyTestUtils.getRuntime({
        NODE_ENV: "production",
        TOKENLESS_KMS_KEY_RESOURCE: "projects/example/locations/europe-west4/keyRings/rateloop",
        TOKENLESS_KMS_PROVIDER: "gcp-kms",
        TOKENLESS_KMS_REGION: "eu",
        TOKENLESS_PSEUDONYM_KEY: Buffer.alloc(32, 9).toString("base64url"),
      } as unknown as NodeJS.ProcessEnv),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "artifact_kms_adapter_unavailable",
  );
});

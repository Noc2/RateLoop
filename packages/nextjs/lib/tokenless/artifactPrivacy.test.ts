import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
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

class MemoryPrivateStore implements PrivateArtifactStore {
  readonly objects = new Map<string, Uint8Array>();

  async delete(reference: string) {
    this.objects.delete(reference);
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

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  store = new MemoryPrivateStore();
  __setArtifactPrivacyRuntimeForTests({ keyVersion: "artifact-test-v1", masterKey: Buffer.alloc(32, 7), store });
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
        TOKENLESS_PSEUDONYM_KEY: Buffer.alloc(32, 9).toString("base64url"),
      } as unknown as NodeJS.ProcessEnv),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "artifact_kms_adapter_unavailable",
  );
});

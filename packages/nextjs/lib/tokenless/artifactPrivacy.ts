import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from "node:crypto";
import "server-only";
import { dbClient, dbPool } from "~~/lib/db";
import {
  type KeyWrappingProvider,
  createLocalKeyWrappingProvider,
  validateVaultEnvironment,
} from "~~/lib/privacy/vault";
import { authorizeProjectAccount, projectAccountReference } from "~~/lib/tokenless/projectAccess";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const ARTIFACT_KEY_DOMAIN = "customer_artifact";
const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;
const MAX_LEASE_MS = 30 * 60_000;

type QueryRow = Record<string, unknown>;

export type PrivateArtifactStore = {
  delete(reference: string): Promise<void>;
  get(reference: string): Promise<Uint8Array>;
  put(pathname: string, body: Uint8Array): Promise<string>;
};

type ArtifactPrivacyRuntime = {
  commitmentKey?: Uint8Array;
  keyProvider?: KeyWrappingProvider;
  keyVersion: string;
  masterKey?: Uint8Array;
  store: PrivateArtifactStore;
};

let runtimeOverride: ArtifactPrivacyRuntime | null = null;
let managedKeyProvider: KeyWrappingProvider | null = null;

function rowString(row: QueryRow | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function actorAddress(value: string) {
  return projectAccountReference(value);
}

function decodeMasterKey(value: string | undefined) {
  if (!value?.trim()) {
    throw new TokenlessServiceError(
      "TOKENLESS_ARTIFACT_MASTER_KEY is required for private artifact storage.",
      503,
      "artifact_vault_unavailable",
    );
  }
  const normalized = value.trim();
  const key = /^[0-9a-fA-F]{64}$/.test(normalized)
    ? Buffer.from(normalized, "hex")
    : Buffer.from(normalized, "base64url");
  if (key.length !== 32) {
    throw new TokenlessServiceError(
      "TOKENLESS_ARTIFACT_MASTER_KEY must encode exactly 32 bytes.",
      500,
      "invalid_artifact_key",
    );
  }
  return key;
}

function createVercelBlobStore(): PrivateArtifactStore {
  return {
    async delete(reference) {
      const { del } = await import("@vercel/blob");
      await del(reference);
    },
    async get(reference) {
      const { get } = await import("@vercel/blob");
      const result = await get(reference, { access: "private", useCache: false });
      if (!result || result.statusCode !== 200 || !result.stream) {
        throw new TokenlessServiceError("The artifact object is unavailable.", 404, "artifact_not_found");
      }
      return new Uint8Array(await new Response(result.stream).arrayBuffer());
    },
    async put(pathname, body) {
      const { put } = await import("@vercel/blob");
      const result = await put(pathname, Buffer.from(body), {
        access: "private",
        addRandomSuffix: false,
        contentType: "application/octet-stream",
      });
      return result.url;
    },
  };
}

function getRuntime(env: NodeJS.ProcessEnv = process.env): ArtifactPrivacyRuntime {
  if (runtimeOverride) {
    if (runtimeOverride.keyProvider && runtimeOverride.commitmentKey) return runtimeOverride;
    const masterKey = runtimeOverride.masterKey;
    if (!masterKey) throw new TokenlessServiceError("Artifact test vault is invalid.", 500, "invalid_artifact_key");
    return {
      ...runtimeOverride,
      commitmentKey: runtimeOverride.commitmentKey ?? masterKey,
      keyProvider:
        runtimeOverride.keyProvider ??
        createLocalKeyWrappingProvider({ key: masterKey, keyVersion: runtimeOverride.keyVersion }),
    };
  }
  const policy = validateVaultEnvironment(env);
  if (policy.mode === "managed") {
    if (
      !managedKeyProvider ||
      managedKeyProvider.provider !== policy.provider ||
      managedKeyProvider.keyResource !== policy.keyResource
    ) {
      throw new TokenlessServiceError(
        "The configured managed KMS adapter is unavailable.",
        503,
        "artifact_kms_adapter_unavailable",
      );
    }
    return {
      commitmentKey: decodeMasterKey(env.TOKENLESS_PSEUDONYM_KEY),
      keyProvider: managedKeyProvider,
      keyVersion: managedKeyProvider.keyVersion,
      store: createVercelBlobStore(),
    };
  }
  const masterKey = decodeMasterKey(env.TOKENLESS_ARTIFACT_MASTER_KEY);
  const keyVersion = env.TOKENLESS_ARTIFACT_KEY_VERSION?.trim() || "artifact-v1";
  return {
    commitmentKey: masterKey,
    keyProvider: createLocalKeyWrappingProvider({ key: masterKey, keyVersion }),
    keyVersion,
    masterKey,
    store: createVercelBlobStore(),
  };
}

function encrypt(input: Uint8Array, key: Uint8Array, aad: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(input), cipher.final()]);
  return { ciphertext, nonce, tag: cipher.getAuthTag() };
}

function decrypt(input: Uint8Array, key: Uint8Array, nonce: string, tag: string, aad: string) {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(nonce, "base64url"));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(input), decipher.final()]);
}

function actorReference(masterKey: Uint8Array, address: string) {
  return `hmac-sha256:${createHmac("sha256", masterKey).update(`artifact-actor:${address}`).digest("hex")}`;
}

function tenantCommitment(masterKey: Uint8Array, workspaceId: string, content: Uint8Array) {
  return `sha256:${createHmac("sha256", masterKey)
    .update(`artifact-commitment:${workspaceId}:`)
    .update(content)
    .digest("hex")}`;
}

function keyDomain(provider: KeyWrappingProvider) {
  return JSON.stringify({
    domain: ARTIFACT_KEY_DOMAIN,
    keyResource: provider.keyResource,
    provider: provider.provider,
  });
}

function parseKeyDomain(value: string | null, fallback: KeyWrappingProvider) {
  if (!value || value === ARTIFACT_KEY_DOMAIN) {
    return { keyResource: fallback.keyResource, provider: fallback.provider };
  }
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (
      parsed.domain !== ARTIFACT_KEY_DOMAIN ||
      typeof parsed.provider !== "string" ||
      typeof parsed.keyResource !== "string"
    ) {
      throw new Error("invalid");
    }
    return { keyResource: parsed.keyResource, provider: parsed.provider };
  } catch {
    throw new TokenlessServiceError("Artifact key metadata is invalid.", 500, "invalid_artifact_key_metadata");
  }
}

async function requireProjectMember(input: {
  accountAddress: string;
  projectId: string;
  workspaceId: string;
  manage?: boolean;
}) {
  const access = await authorizeProjectAccount({
    accountAddress: input.accountAddress,
    action: input.manage ? "manage" : "write",
    projectId: input.projectId,
    workspaceId: input.workspaceId,
  });
  return { address: access.accountReference, retentionDays: access.retentionDays, role: access.role };
}

async function appendAccessLog(input: {
  action: "create" | "lease" | "preview" | "read" | "export" | "delete";
  accountAddress: string;
  artifactId: string | null;
  leaseId?: string | null;
  projectId: string;
  purpose: string;
  requestReference?: string | null;
  workspaceId: string;
  runtime: ArtifactPrivacyRuntime;
}) {
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_access_logs
          (log_id, workspace_id, project_id, artifact_id, lease_id, actor_kind, actor_reference, action, purpose, request_reference, occurred_at)
          VALUES (?, ?, ?, ?, ?, 'base_account', ?, ?, ?, ?, ?)`,
    args: [
      `log_${randomUUID().replaceAll("-", "")}`,
      input.workspaceId,
      input.projectId,
      input.artifactId,
      input.leaseId ?? null,
      actorReference(input.runtime.commitmentKey!, actorAddress(input.accountAddress)),
      input.action,
      input.purpose,
      input.requestReference ?? null,
      new Date(),
    ],
  });
}

export async function storeEncryptedArtifact(input: {
  accountAddress: string;
  bytes: Uint8Array;
  contentType: string;
  label: string;
  projectId: string;
  redactionStatus: "not_required" | "pending" | "approved" | "rejected";
  rendererPolicy: "plain_text" | "sanitized_html" | "image" | "download";
  role: "baseline" | "candidate" | "context" | "reference";
  workspaceId: string;
}) {
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_ARTIFACT_BYTES) {
    throw new TokenlessServiceError("Artifacts must be between 1 byte and 10 MB.", 400, "invalid_artifact_size");
  }
  const label = input.label.trim();
  const contentType = input.contentType.trim().toLowerCase();
  if (!label || label.length > 160 || !/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(contentType)) {
    throw new TokenlessServiceError("Artifact metadata is invalid.", 400, "invalid_artifact_metadata");
  }
  const member = await requireProjectMember(input);
  const runtime = getRuntime();
  const artifactId = `art_${randomUUID().replaceAll("-", "")}`;
  const objectId = `obj_${randomUUID().replaceAll("-", "")}`;
  const aad = `${ARTIFACT_KEY_DOMAIN}:${input.workspaceId}:${input.projectId}:${artifactId}`;
  const dataKey = randomBytes(32);
  const content = encrypt(input.bytes, dataKey, aad);
  const wrapped = await runtime.keyProvider!.wrap(dataKey, Buffer.from(`${aad}:${runtime.keyVersion}`));
  dataKey.fill(0);
  const pathname = `rateloop-private/${input.workspaceId}/${input.projectId}/${objectId}.bin`;
  const storageRef = await runtime.store.put(pathname, content.ciphertext);
  const createdAt = new Date();
  const deleteAfter = new Date(createdAt.getTime() + member.retentionDays * 86_400_000);
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO tokenless_assurance_artifacts
       (artifact_id, project_id, role, label, digest, content_type, size_bytes, storage_ref, redaction_status, renderer_policy, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
      [
        artifactId,
        input.projectId,
        input.role,
        label,
        tenantCommitment(runtime.commitmentKey!, input.workspaceId, input.bytes),
        contentType,
        input.bytes.byteLength,
        storageRef,
        input.redactionStatus,
        input.rendererPolicy,
        createdAt,
      ],
    );
    await client.query(
      `INSERT INTO tokenless_assurance_artifact_objects
       (object_id, artifact_id, workspace_id, project_id, storage_provider, storage_ref, key_domain, key_version,
        content_nonce, content_auth_tag, wrapped_data_key, wrap_nonce, wrap_auth_tag, status, delete_after, created_at)
       VALUES ($1, $2, $3, $4, 'vercel_blob_private', $5, $6, $7, $8, $9, $10, $11, $12, 'active', $13, $14)`,
      [
        objectId,
        artifactId,
        input.workspaceId,
        input.projectId,
        storageRef,
        keyDomain(runtime.keyProvider!),
        runtime.keyVersion,
        content.nonce.toString("base64url"),
        content.tag.toString("base64url"),
        wrapped.ciphertext,
        wrapped.nonce ?? "",
        wrapped.authTag ?? "",
        deleteAfter,
        createdAt,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    await runtime.store.delete(storageRef).catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  await appendAccessLog({
    action: "create",
    accountAddress: member.address,
    artifactId,
    projectId: input.projectId,
    purpose: "artifact_upload",
    workspaceId: input.workspaceId,
    runtime,
  });
  return {
    artifactId,
    contentType,
    digest: tenantCommitment(runtime.commitmentKey!, input.workspaceId, input.bytes),
    sizeBytes: input.bytes.byteLength,
  };
}

export async function issueArtifactLease(input: {
  accountAddress: string;
  artifactId: string;
  assignmentId?: string;
  expiresAt: Date;
  projectId: string;
  purpose: string;
  recipientAddress: string;
  workspaceId: string;
  now?: Date;
}) {
  const member = await requireProjectMember({ ...input, manage: true });
  const now = input.now ?? new Date();
  if (input.expiresAt <= now || input.expiresAt.getTime() - now.getTime() > MAX_LEASE_MS) {
    throw new TokenlessServiceError("Artifact leases must expire within 30 minutes.", 400, "invalid_artifact_lease");
  }
  const recipientAddress = actorAddress(input.recipientAddress);
  const artifact = await dbClient.execute({
    sql: `SELECT o.artifact_id FROM tokenless_assurance_artifact_objects o
          WHERE o.artifact_id = ? AND o.workspace_id = ? AND o.project_id = ? AND o.status = 'active' LIMIT 1`,
    args: [input.artifactId, input.workspaceId, input.projectId],
  });
  if (!artifact.rowCount) throw new TokenlessServiceError("Artifact not found.", 404, "artifact_not_found");
  const leaseId = `lease_${randomUUID().replaceAll("-", "")}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_artifact_leases
          (lease_id, artifact_id, workspace_id, project_id, account_address, assignment_id, purpose, expires_at, created_by, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      leaseId,
      input.artifactId,
      input.workspaceId,
      input.projectId,
      recipientAddress,
      input.assignmentId ?? null,
      input.purpose.trim() || "assigned_review",
      input.expiresAt,
      member.address,
      now,
    ],
  });
  const runtime = getRuntime();
  await appendAccessLog({
    action: "lease",
    accountAddress: member.address,
    artifactId: input.artifactId,
    leaseId,
    projectId: input.projectId,
    purpose: input.purpose.trim() || "assigned_review",
    workspaceId: input.workspaceId,
    runtime,
  });
  return { leaseId, expiresAt: input.expiresAt.toISOString() };
}

export async function readEncryptedArtifact(input: {
  accountAddress: string;
  artifactId: string;
  leaseId?: string;
  projectId: string;
  purpose?: "preview" | "read" | "export";
  requestReference?: string;
  workspaceId: string;
  now?: Date;
}) {
  const address = actorAddress(input.accountAddress);
  const action = input.purpose === "export" ? "export" : "read";
  const assigned = await authorizeProjectAccount({
    accountAddress: input.accountAddress,
    action,
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    now: input.now,
  }).catch(error => {
    if (
      error instanceof TokenlessServiceError &&
      ["project_not_found", "project_access_forbidden"].includes(error.code)
    ) {
      return null;
    }
    throw error;
  });
  const role = assigned?.role ?? null;
  let leaseId: string | null = null;
  if (!role) {
    if (input.purpose === "export") {
      throw new TokenlessServiceError("Artifact export is not permitted.", 403, "artifact_export_forbidden");
    }
    const leaseResult = await dbClient.execute({
      sql: `SELECT lease_id FROM tokenless_assurance_artifact_leases
            WHERE lease_id = ? AND artifact_id = ? AND workspace_id = ? AND project_id = ? AND account_address = ?
              AND revoked_at IS NULL AND expires_at > ? LIMIT 1`,
      args: [
        input.leaseId ?? "",
        input.artifactId,
        input.workspaceId,
        input.projectId,
        address,
        input.now ?? new Date(),
      ],
    });
    leaseId = rowString(leaseResult.rows[0] as QueryRow | undefined, "lease_id");
    if (!leaseId) throw new TokenlessServiceError("Artifact not found.", 404, "artifact_not_found");
  }
  const result = await dbClient.execute({
    sql: `SELECT a.content_type, a.size_bytes, o.storage_ref, o.key_domain, o.key_version, o.content_nonce, o.content_auth_tag,
                 o.wrapped_data_key, o.wrap_nonce, o.wrap_auth_tag
          FROM tokenless_assurance_artifacts a
          JOIN tokenless_assurance_artifact_objects o ON o.artifact_id = a.artifact_id
          LEFT JOIN tokenless_project_access_assignments pa
            ON pa.workspace_id = o.workspace_id AND pa.project_id = o.project_id
            AND pa.subject_kind = 'account' AND pa.subject_reference = ? AND pa.status = 'active'
            AND (pa.expires_at IS NULL OR pa.expires_at > ?) AND pa.role = ANY(?::text[])
          LEFT JOIN tokenless_assurance_artifact_leases l
            ON l.lease_id = ? AND l.artifact_id = a.artifact_id AND l.workspace_id = o.workspace_id
            AND l.project_id = o.project_id AND l.account_address = ?
            AND l.revoked_at IS NULL AND l.expires_at > ?
          WHERE a.artifact_id = ? AND a.project_id = ? AND o.workspace_id = ? AND o.status = 'active'
            AND (pa.assignment_id IS NOT NULL OR l.lease_id IS NOT NULL)
          LIMIT 1`,
    args: [
      address,
      input.now ?? new Date(),
      action === "export" ? ["admin", "auditor"] : ["admin", "contributor", "auditor"],
      leaseId ?? "",
      address,
      input.now ?? new Date(),
      input.artifactId,
      input.projectId,
      input.workspaceId,
    ],
  });
  const row = result.rows[0] as QueryRow | undefined;
  const storageRef = rowString(row, "storage_ref");
  if (!storageRef) throw new TokenlessServiceError("Artifact not found.", 404, "artifact_not_found");
  const runtime = getRuntime();
  const keyVersion = rowString(row, "key_version")!;
  if (keyVersion !== runtime.keyVersion) {
    throw new TokenlessServiceError("The artifact key version is unavailable.", 503, "artifact_key_unavailable");
  }
  const aad = `${ARTIFACT_KEY_DOMAIN}:${input.workspaceId}:${input.projectId}:${input.artifactId}`;
  const storedKeyDomain = parseKeyDomain(rowString(row, "key_domain"), runtime.keyProvider!);
  const dataKey = await runtime.keyProvider!.unwrap(
    {
      authTag: rowString(row, "wrap_auth_tag") || null,
      ciphertext: rowString(row, "wrapped_data_key")!,
      keyResource: storedKeyDomain.keyResource,
      keyVersion,
      nonce: rowString(row, "wrap_nonce") || null,
      provider: storedKeyDomain.provider,
    },
    Buffer.from(`${aad}:${keyVersion}`),
  );
  const ciphertext = await runtime.store.get(storageRef);
  const bytes = decrypt(
    ciphertext,
    dataKey,
    rowString(row, "content_nonce")!,
    rowString(row, "content_auth_tag")!,
    aad,
  );
  await appendAccessLog({
    action: input.purpose ?? "read",
    accountAddress: address,
    artifactId: input.artifactId,
    leaseId,
    projectId: input.projectId,
    purpose: leaseId ? "assigned_review" : "workspace_access",
    requestReference: input.requestReference,
    workspaceId: input.workspaceId,
    runtime,
  });
  return {
    bytes: new Uint8Array(bytes),
    contentType: rowString(row, "content_type")!,
    sizeBytes: Number(rowString(row, "size_bytes")),
  };
}

export async function requestProjectDeletion(input: {
  accountAddress: string;
  executeAfter?: Date;
  projectId: string;
  reason: string;
  workspaceId: string;
  now?: Date;
}) {
  const member = await requireProjectMember({ ...input, manage: true });
  const now = input.now ?? new Date();
  const executeAfter = input.executeAfter ?? now;
  if (executeAfter < now || executeAfter.getTime() - now.getTime() > 30 * 86_400_000) {
    throw new TokenlessServiceError("Deletion must be scheduled within 30 days.", 400, "invalid_deletion_schedule");
  }
  const requestId = `delete_${randomUUID().replaceAll("-", "")}`;
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO tokenless_assurance_deletion_requests
       (request_id, workspace_id, project_id, requested_by, reason, status, execute_after, requested_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)`,
      [
        requestId,
        input.workspaceId,
        input.projectId,
        member.address,
        input.reason.trim() || "customer_request",
        executeAfter,
        now,
      ],
    );
    await client.query(
      `UPDATE tokenless_assurance_artifact_objects
       SET delete_after = CASE WHEN delete_after < $1 THEN delete_after ELSE $1 END
       WHERE workspace_id = $2 AND project_id = $3 AND status = 'active'`,
      [executeAfter, input.workspaceId, input.projectId],
    );
    await client.query(
      "UPDATE tokenless_assurance_projects SET status = 'deletion_pending', updated_at = $1 WHERE project_id = $2",
      [now, input.projectId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return { requestId, executeAfter: executeAfter.toISOString() };
}

export async function processArtifactDeletionByObjectId(objectId: string, now = new Date()) {
  const runtime = getRuntime();
  const result = await dbClient.execute({
    sql: `SELECT object_id, artifact_id, workspace_id, project_id, storage_ref
          FROM tokenless_assurance_artifact_objects
          WHERE object_id = ? AND status = 'active' AND delete_after <= ? LIMIT 1`,
    args: [objectId, now],
  });
  const row = result.rows[0] as QueryRow | undefined;
  if (!row) return false;
  const storageRef = rowString(row, "storage_ref")!;
  await runtime.store.delete(storageRef);
  const deleted = await dbClient.execute({
    sql: `UPDATE tokenless_assurance_artifact_objects SET status = 'deleted', deleted_at = ?
          WHERE object_id = ? AND status = 'active'`,
    args: [now, objectId],
  });
  if (deleted.rowCount !== 1) return false;
  await dbClient.execute({
    sql: "UPDATE tokenless_assurance_artifacts SET storage_ref = ?, updated_at = ? WHERE artifact_id = ?",
    args: [`deleted://${rowString(row, "artifact_id")}`, now, rowString(row, "artifact_id")],
  });
  await dbClient.execute({
    sql: `UPDATE tokenless_assurance_deletion_requests SET status = 'completed', completed_at = ?
          WHERE project_id = ? AND status = 'pending' AND execute_after <= ?
            AND NOT EXISTS (
              SELECT 1 FROM tokenless_assurance_artifact_objects
              WHERE project_id = ? AND status = 'active'
            )`,
    args: [now, rowString(row, "project_id"), now, rowString(row, "project_id")],
  });
  return true;
}

export async function processDueArtifactDeletions(now = new Date(), limit = 100) {
  const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  const result = await dbClient.execute({
    sql: `SELECT object_id FROM tokenless_assurance_artifact_objects
          WHERE status = 'active' AND delete_after <= ? ORDER BY created_at ASC LIMIT ?`,
    args: [now, boundedLimit],
  });
  let deleted = 0;
  for (const value of result.rows) {
    if (await processArtifactDeletionByObjectId(rowString(value as QueryRow, "object_id")!, now)) deleted += 1;
  }
  return { deleted };
}

export async function listArtifactAccessLog(input: { accountAddress: string; projectId: string; workspaceId: string }) {
  await requireProjectMember({ ...input, manage: true });
  const result = await dbClient.execute({
    sql: `SELECT log_id, artifact_id, lease_id, actor_kind, actor_reference, action, purpose, request_reference, occurred_at
          FROM tokenless_assurance_access_logs WHERE workspace_id = ? AND project_id = ? ORDER BY occurred_at DESC`,
    args: [input.workspaceId, input.projectId],
  });
  return result.rows;
}

export function __setArtifactPrivacyRuntimeForTests(runtime: ArtifactPrivacyRuntime | null) {
  runtimeOverride = runtime;
}

export function registerArtifactManagedKeyProvider(provider: KeyWrappingProvider | null) {
  managedKeyProvider = provider;
}

export const __artifactPrivacyTestUtils = { decodeMasterKey, getRuntime };

import { normalizeMimeContentType } from "@rateloop/sdk";
import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { isRateLoopPrincipalId } from "~~/lib/auth/accountSubject";
import { dbClient, dbPool } from "~~/lib/db";
import { appendAuditEvent } from "~~/lib/privacy/audit";
import { assertProjectDeletionAllowed } from "~~/lib/privacy/lifecycle";
import {
  type KeyWrappingProvider,
  type WrappedDataKey,
  createLocalKeyWrappingProvider,
  validateVaultEnvironment,
} from "~~/lib/privacy/vault";
import { createConfiguredAwsKmsKeyWrappingProvider } from "~~/lib/privacy/vault/awsKms";
import { authorizeProjectAccount, projectAccountReference } from "~~/lib/tokenless/projectAccess";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const ARTIFACT_KEY_DOMAIN = "customer_artifact";
const ARTIFACT_DELETION_LEASE_MS = 5 * 60_000;
const ARTIFACT_DELETION_RETRY_MS = 30_000;
const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;
const MAX_LEASE_MS = 30 * 60_000;
export const PRIVATE_REVIEW_ARTIFACT_KINDS = ["source", "suggestion"] as const;
export type PrivateReviewArtifactKind = (typeof PRIVATE_REVIEW_ARTIFACT_KINDS)[number];

type QueryRow = Record<string, unknown>;

export type PrivateArtifactStore = {
  /** Delete is idempotent: an already-absent reference is a successful outcome. */
  delete(reference: string): Promise<void>;
  get(reference: string): Promise<Uint8Array>;
  put(pathname: string, body: Uint8Array): Promise<string>;
};

type ArtifactPrivacyRuntime = {
  auditWriter?: typeof appendAuditEvent;
  commitmentKey?: Uint8Array;
  deletionHook?: (phase: ArtifactDeletionHookPhase) => Promise<void> | void;
  keyProvider?: KeyWrappingProvider;
  keyVersion: string;
  masterKey?: Uint8Array;
  store: PrivateArtifactStore;
};

type ArtifactDeletionHookPhase =
  | "after_provider_delete"
  | "after_provider_checkpoint"
  | "before_finalize_commit"
  | "after_audit_append";

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
    const keyProvider = managedKeyProvider ?? createConfiguredAwsKmsKeyWrappingProvider(env);
    if (keyProvider.provider !== policy.provider || keyProvider.keyResource !== policy.keyResource) {
      throw new TokenlessServiceError(
        "The configured managed KMS adapter is unavailable.",
        503,
        "artifact_kms_adapter_unavailable",
      );
    }
    return {
      commitmentKey: decodeMasterKey(env.TOKENLESS_PSEUDONYM_KEY),
      keyProvider,
      keyVersion: keyProvider.keyVersion,
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

function privateReviewArtifactCommitment(input: {
  content: Uint8Array;
  kind: PrivateReviewArtifactKind;
  requestReference: string;
  runtime: ArtifactPrivacyRuntime;
  workspaceId: string;
}) {
  return `sha256:${createHmac("sha256", input.runtime.commitmentKey!)
    .update(`private-review-artifact:${input.workspaceId}:${input.requestReference}:${input.kind}:`)
    .update(input.content)
    .digest("hex")}` as const;
}

function keyDomain(provider: Pick<KeyWrappingProvider | WrappedDataKey, "keyResource" | "provider">) {
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
  const normalizedActor = actorAddress(input.accountAddress);
  const actorKind = isRateLoopPrincipalId(normalizedActor) ? "principal" : "base_account";
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_access_logs
          (log_id, workspace_id, project_id, artifact_id, lease_id, actor_kind, actor_reference, action, purpose, request_reference, occurred_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      `log_${randomUUID().replaceAll("-", "")}`,
      input.workspaceId,
      input.projectId,
      input.artifactId,
      input.leaseId ?? null,
      actorKind,
      actorReference(input.runtime.commitmentKey!, normalizedActor),
      input.action,
      input.purpose,
      input.requestReference ?? null,
      new Date(),
    ],
  });
  await appendAuditEvent({
    action: `artifact.${input.action}`,
    actorKind: actorKind === "principal" ? "principal" : "account",
    actorReference: actorReference(input.runtime.commitmentKey!, normalizedActor),
    assuranceMethod: "rateloop_session",
    metadata: { artifactId: input.artifactId, leaseId: input.leaseId ?? null },
    purpose: input.purpose,
    reason: input.requestReference ?? "authorized_request",
    requestCorrelation: input.requestReference,
    result: "success",
    targetId: input.artifactId ?? input.projectId,
    targetKind: input.artifactId ? "artifact" : "project",
    workspaceId: input.workspaceId,
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
  const contentType = normalizeMimeContentType(input.contentType);
  if (!label || label.length > 160 || !contentType) {
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
        keyDomain(wrapped),
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

export function commitPrivateReviewArtifact(input: {
  bytes: Uint8Array;
  kind: PrivateReviewArtifactKind;
  requestReference: string;
  workspaceId: string;
}) {
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_ARTIFACT_BYTES) {
    throw new TokenlessServiceError(
      "Private review artifacts must be between 1 byte and 10 MB.",
      400,
      "invalid_artifact_size",
    );
  }
  if (!PRIVATE_REVIEW_ARTIFACT_KINDS.includes(input.kind)) {
    throw new TokenlessServiceError("Private review artifact kind is invalid.", 400, "invalid_artifact_metadata");
  }
  const requestReference = input.requestReference.trim();
  if (!requestReference || requestReference.length > 400) {
    throw new TokenlessServiceError("Private review artifact reference is invalid.", 400, "invalid_artifact_metadata");
  }
  return privateReviewArtifactCommitment({
    content: input.bytes,
    kind: input.kind,
    requestReference,
    runtime: getRuntime(),
    workspaceId: input.workspaceId,
  });
}

export async function storeEncryptedPrivateReviewArtifacts(input: {
  callerCredentialId: string;
  callerCredentialKind: "api_key" | "oauth_token_family";
  integrationId: string;
  privateReviewId: string;
  planned: {
    sourceArtifactId: string;
    sourceObjectId: string;
    suggestionArtifactId: string;
    suggestionObjectId: string;
  };
  projectId: string;
  requestReference: string;
  retentionDays: number;
  source: { bytes: Uint8Array; contentType: string };
  suggestion: { bytes: Uint8Array; contentType: string };
  uploadId: string;
  workspaceId: string;
  now?: Date;
}) {
  const runtime = getRuntime();
  const now = input.now ?? new Date();
  const deleteAfter = new Date(now.getTime() + input.retentionDays * 86_400_000);
  const requestReference = input.requestReference.trim();
  const definitions = PRIVATE_REVIEW_ARTIFACT_KINDS.map(kind => {
    const value = kind === "source" ? input.source : input.suggestion;
    if (value.bytes.byteLength === 0 || value.bytes.byteLength > MAX_ARTIFACT_BYTES) {
      throw new TokenlessServiceError(
        "Private review artifacts must be between 1 byte and 10 MB.",
        400,
        "invalid_artifact_size",
      );
    }
    const contentType = normalizeMimeContentType(value.contentType);
    if (!contentType) {
      throw new TokenlessServiceError("Private review artifact metadata is invalid.", 400, "invalid_artifact_metadata");
    }
    return {
      artifactId: kind === "source" ? input.planned.sourceArtifactId : input.planned.suggestionArtifactId,
      bytes: value.bytes,
      contentType,
      digest: privateReviewArtifactCommitment({
        content: value.bytes,
        kind,
        requestReference,
        runtime,
        workspaceId: input.workspaceId,
      }),
      kind,
      label: kind === "source" ? "Private review source" : "Private review suggestion",
      objectId: kind === "source" ? input.planned.sourceObjectId : input.planned.suggestionObjectId,
      role: kind === "source" ? "private_source" : "private_suggestion",
    };
  });

  const existing = await dbClient.execute({
    sql: `SELECT a.artifact_id, a.digest, a.content_type, a.size_bytes, a.role,
                 o.object_id, o.workspace_id, o.project_id
          FROM tokenless_assurance_artifacts a
          JOIN tokenless_assurance_artifact_objects o ON o.artifact_id = a.artifact_id
          WHERE a.project_id = ? AND a.artifact_id IN (?, ?)`,
    args: [input.projectId, input.planned.sourceArtifactId, input.planned.suggestionArtifactId],
  });
  if (existing.rowCount !== 0 && existing.rowCount !== 2) {
    throw new TokenlessServiceError(
      "Private review artifact recovery found an incomplete encrypted pair.",
      409,
      "private_review_artifact_recovery_required",
    );
  }
  if (existing.rowCount === 2) {
    const rows = new Map(existing.rows.map(row => [rowString(row as QueryRow, "artifact_id"), row as QueryRow]));
    for (const definition of definitions) {
      const row = rows.get(definition.artifactId);
      if (
        !row ||
        rowString(row, "object_id") !== definition.objectId ||
        rowString(row, "workspace_id") !== input.workspaceId ||
        rowString(row, "project_id") !== input.projectId ||
        rowString(row, "digest") !== definition.digest ||
        rowString(row, "content_type") !== definition.contentType ||
        Number(row.size_bytes) !== definition.bytes.byteLength ||
        rowString(row, "role") !== definition.role
      ) {
        throw new TokenlessServiceError(
          "Private review artifact recovery found a binding mismatch.",
          409,
          "private_review_artifact_recovery_mismatch",
        );
      }
    }
    return {
      source: { artifactId: definitions[0].artifactId, digest: definitions[0].digest },
      suggestion: { artifactId: definitions[1].artifactId, digest: definitions[1].digest },
    };
  }
  const uploaded: Array<{
    artifactId: string;
    authTag: string;
    contentType: string;
    digest: `sha256:${string}`;
    kind: PrivateReviewArtifactKind;
    key: WrappedDataKey;
    label: string;
    nonce: string;
    objectId: string;
    role: string;
    sizeBytes: number;
    storageRef: string;
  }> = [];
  try {
    for (const definition of definitions) {
      const aad = `${ARTIFACT_KEY_DOMAIN}:${input.workspaceId}:${input.projectId}:${definition.artifactId}`;
      const dataKey = randomBytes(32);
      const encrypted = encrypt(definition.bytes, dataKey, aad);
      const wrapped = await runtime.keyProvider!.wrap(dataKey, Buffer.from(`${aad}:${runtime.keyVersion}`));
      dataKey.fill(0);
      const pathname = `rateloop-private/${input.workspaceId}/${input.projectId}/preparations/${input.uploadId}/${definition.objectId}.bin`;
      const storageRef = await runtime.store.put(pathname, encrypted.ciphertext);
      uploaded.push({
        artifactId: definition.artifactId,
        authTag: encrypted.tag.toString("base64url"),
        contentType: definition.contentType,
        digest: definition.digest,
        kind: definition.kind,
        key: wrapped,
        label: definition.label,
        nonce: encrypted.nonce.toString("base64url"),
        objectId: definition.objectId,
        role: definition.role,
        sizeBytes: definition.bytes.byteLength,
        storageRef,
      });
    }
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      for (const artifact of uploaded) {
        await client.query(
          `INSERT INTO tokenless_assurance_artifacts
           (artifact_id, project_id, role, label, digest, content_type, size_bytes, storage_ref,
            redaction_status, renderer_policy, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'not_required', 'download', $9, $9)`,
          [
            artifact.artifactId,
            input.projectId,
            artifact.role,
            artifact.label,
            artifact.digest,
            artifact.contentType,
            artifact.sizeBytes,
            artifact.storageRef,
            now,
          ],
        );
        await client.query(
          `INSERT INTO tokenless_assurance_artifact_objects
           (object_id, artifact_id, workspace_id, project_id, storage_provider, storage_ref, key_domain,
            key_version, content_nonce, content_auth_tag, wrapped_data_key, wrap_nonce, wrap_auth_tag,
            status, delete_after, created_at)
           VALUES ($1, $2, $3, $4, 'vercel_blob_private', $5, $6, $7, $8, $9, $10, $11, $12,
                   'active', $13, $14)`,
          [
            artifact.objectId,
            artifact.artifactId,
            input.workspaceId,
            input.projectId,
            artifact.storageRef,
            keyDomain(artifact.key),
            runtime.keyVersion,
            artifact.nonce,
            artifact.authTag,
            artifact.key.ciphertext,
            artifact.key.nonce ?? "",
            artifact.key.authTag ?? "",
            deleteAfter,
            now,
          ],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    await Promise.all(uploaded.map(value => runtime.store.delete(value.storageRef).catch(() => undefined)));
    throw error;
  }

  const actor = actorReference(runtime.commitmentKey!, `${input.callerCredentialKind}:${input.callerCredentialId}`);
  for (const artifact of uploaded) {
    await dbClient.execute({
      sql: `INSERT INTO tokenless_assurance_access_logs
            (log_id, workspace_id, project_id, artifact_id, lease_id, actor_kind, actor_reference,
             action, purpose, request_reference, occurred_at)
            VALUES (?, ?, ?, ?, NULL, ?, ?, 'create', 'private_review_prepare', ?, ?)`,
      args: [
        `log_${randomUUID().replaceAll("-", "")}`,
        input.workspaceId,
        input.projectId,
        artifact.artifactId,
        input.callerCredentialKind,
        actor,
        input.privateReviewId,
        now,
      ],
    });
    await appendAuditEvent({
      action: "artifact.create",
      actorKind: input.callerCredentialKind,
      actorReference: actor,
      assuranceMethod: input.callerCredentialKind === "api_key" ? "workspace_api_key" : "agent_oauth_integration",
      metadata: {
        artifactId: artifact.artifactId,
        integrationId: input.integrationId,
        kind: artifact.kind,
        privateReviewId: input.privateReviewId,
      },
      purpose: "private_review_prepare",
      reason: "project_authorized_service_request",
      requestCorrelation: input.privateReviewId,
      result: "success",
      targetId: artifact.artifactId,
      targetKind: "artifact",
      workspaceId: input.workspaceId,
    });
  }
  const byKind = new Map(uploaded.map(value => [value.kind, value]));
  return {
    source: {
      artifactId: byKind.get("source")!.artifactId,
      digest: byKind.get("source")!.digest,
    },
    suggestion: {
      artifactId: byKind.get("suggestion")!.artifactId,
      digest: byKind.get("suggestion")!.digest,
    },
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
  const subjectKind = isRateLoopPrincipalId(address) ? "principal" : "account";
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
            AND pa.subject_kind = ? AND pa.subject_reference = ? AND pa.status = 'active'
            AND (pa.expires_at IS NULL OR pa.expires_at > ?) AND pa.role = ANY(?::text[])
          LEFT JOIN tokenless_assurance_artifact_leases l
            ON l.lease_id = ? AND l.artifact_id = a.artifact_id AND l.workspace_id = o.workspace_id
            AND l.project_id = o.project_id AND l.account_address = ?
            AND l.revoked_at IS NULL AND l.expires_at > ?
          WHERE a.artifact_id = ? AND a.project_id = ? AND o.workspace_id = ? AND o.status = 'active'
            AND (pa.assignment_id IS NOT NULL OR l.lease_id IS NOT NULL)
          LIMIT 1`,
    args: [
      subjectKind,
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
  await assertProjectDeletionAllowed(input.projectId, input.workspaceId);
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

function artifactDeletionCorrelation(objectId: string) {
  return `artifact-retention:${objectId}`;
}

function artifactDeletionError(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
}

function validRetentionMonths(value: unknown) {
  const months = Number(value);
  return Number.isSafeInteger(months) && months >= 6 && months <= 120 ? months : null;
}

function retentionEnd(createdAtValue: unknown, retentionMonths: number) {
  const createdAt = new Date(String(createdAtValue));
  const originalDay = createdAt.getUTCDate();
  createdAt.setUTCDate(1);
  createdAt.setUTCMonth(createdAt.getUTCMonth() + retentionMonths);
  const lastDay = new Date(Date.UTC(createdAt.getUTCFullYear(), createdAt.getUTCMonth() + 1, 0)).getUTCDate();
  createdAt.setUTCDate(Math.min(originalDay, lastDay));
  return createdAt;
}

async function artifactDeletionJob(client: PoolClient, objectId: string, lock = false) {
  const result = await client.query(
    `SELECT object_id, workspace_id, project_id, artifact_id, storage_ref, authorization_kind,
            deletion_request_id, retention_policy_version, state, attempt_count, next_attempt_at,
            lease_token, lease_expires_at, provider_deleted_at, finalized_at, audit_event_id,
            audit_event_digest, audited_at
     FROM tokenless_artifact_deletion_jobs WHERE object_id = $1${lock ? " FOR UPDATE" : ""}`,
    [objectId],
  );
  return result.rows[0] as QueryRow | undefined;
}

type ArtifactDeletionClaim =
  | { kind: "done" | "busy" }
  | { kind: "finalize" | "audit"; row: QueryRow }
  | { kind: "provider"; leaseToken: string; row: QueryRow };

async function claimArtifactDeletion(objectId: string, now: Date): Promise<ArtifactDeletionClaim> {
  const identity = await dbClient.execute({
    sql: "SELECT workspace_id FROM tokenless_assurance_artifact_objects WHERE object_id = ? LIMIT 1",
    args: [objectId],
  });
  const workspaceId = rowString(identity.rows[0] as QueryRow | undefined, "workspace_id");
  if (!workspaceId) return { kind: "done" };

  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    // Hold creation and retention-policy updates take this same lock. Committing
    // the provider lease is the serialized point after which deletion may run.
    await client.query("SELECT workspace_id FROM tokenless_workspaces WHERE workspace_id = $1 FOR UPDATE", [
      workspaceId,
    ]);
    let job = await artifactDeletionJob(client, objectId, true);
    const jobState = rowString(job, "state");
    if (jobState === "completed") {
      await client.query("COMMIT");
      return { kind: "done" };
    }
    if (jobState === "finalized") {
      await client.query("COMMIT");
      return { kind: "audit", row: job! };
    }
    if (jobState === "provider_deleted") {
      await client.query("COMMIT");
      return { kind: "finalize", row: job! };
    }
    if (jobState === "provider_deleting" && new Date(String(job?.lease_expires_at)).getTime() > now.getTime()) {
      await client.query("COMMIT");
      return { kind: "busy" };
    }

    const result = await client.query(
      `SELECT o.object_id, o.artifact_id, o.workspace_id, o.project_id, o.storage_ref,
              o.status, o.delete_after, o.created_at, h.hold_id, request.request_id,
              policy.version AS policy_version, policy.evidence_retention_months
       FROM tokenless_assurance_artifact_objects o
       LEFT JOIN tokenless_legal_holds h
         ON h.workspace_id = o.workspace_id AND h.status = 'active'
        AND (h.project_id IS NULL OR h.project_id = o.project_id)
       LEFT JOIN tokenless_assurance_deletion_requests request
         ON request.workspace_id = o.workspace_id AND request.project_id = o.project_id
        AND request.status = 'pending' AND request.execute_after <= $1
       LEFT JOIN tokenless_workspace_evidence_retention_policies policy
         ON policy.workspace_id = o.workspace_id AND policy.superseded_at IS NULL
       WHERE o.object_id = $2 LIMIT 1`,
      [now, objectId],
    );
    const row = result.rows[0] as QueryRow | undefined;
    if (!row || rowString(row, "status") !== "active") {
      await client.query("COMMIT");
      return { kind: "done" };
    }
    if (rowString(row, "hold_id")) {
      throw new TokenlessServiceError(
        "Artifact deletion is deferred by an active legal hold.",
        409,
        "deletion_blocked_by_hold",
        true,
      );
    }
    if (new Date(String(row.delete_after)).getTime() > now.getTime()) {
      throw new TokenlessServiceError("Artifact deletion is not due yet.", 409, "deletion_not_due", true);
    }

    const requestId = rowString(row, "request_id");
    const retentionMonths = validRetentionMonths(row.evidence_retention_months);
    const policyVersion = Number(row.policy_version);
    if (!requestId) {
      if (!retentionMonths || !Number.isSafeInteger(policyVersion) || policyVersion < 1) {
        throw new TokenlessServiceError(
          "The workspace evidence-retention policy is unavailable.",
          503,
          "retention_policy_unavailable",
          true,
        );
      }
      if (retentionEnd(row.created_at, retentionMonths).getTime() > now.getTime()) {
        throw new TokenlessServiceError(
          "Artifact deletion is deferred until the workspace evidence-retention period ends.",
          409,
          "deletion_not_due",
          true,
        );
      }
    }

    if (!job) {
      await client.query(
        `INSERT INTO tokenless_artifact_deletion_jobs
         (object_id, workspace_id, project_id, artifact_id, storage_ref, authorization_kind,
          deletion_request_id, retention_policy_version, state, attempt_count, next_attempt_at,
          created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'provider_pending', 0, $9, $9, $9)`,
        [
          objectId,
          workspaceId,
          rowString(row, "project_id"),
          rowString(row, "artifact_id"),
          rowString(row, "storage_ref"),
          requestId ? "deletion_request" : "retention_policy",
          requestId,
          requestId ? null : policyVersion,
          now,
        ],
      );
      job = await artifactDeletionJob(client, objectId, true);
    }
    if (
      rowString(job, "workspace_id") !== workspaceId ||
      rowString(job, "project_id") !== rowString(row, "project_id") ||
      rowString(job, "artifact_id") !== rowString(row, "artifact_id") ||
      rowString(job, "storage_ref") !== rowString(row, "storage_ref")
    ) {
      throw new TokenlessServiceError(
        "The artifact deletion checkpoint does not match the stored object.",
        500,
        "artifact_deletion_checkpoint_invalid",
      );
    }
    if (new Date(String(job?.next_attempt_at)).getTime() > now.getTime()) {
      await client.query("COMMIT");
      return { kind: "busy" };
    }

    const leaseToken = `adl_${randomUUID().replaceAll("-", "")}`;
    const leaseExpiresAt = new Date(now.getTime() + ARTIFACT_DELETION_LEASE_MS);
    const claimed = await client.query(
      `UPDATE tokenless_artifact_deletion_jobs
       SET authorization_kind = $1, deletion_request_id = $2, retention_policy_version = $3,
           state = 'provider_deleting', attempt_count = attempt_count + 1, next_attempt_at = $4,
           lease_token = $5, lease_expires_at = $6, last_error = NULL, updated_at = $4
       WHERE object_id = $7 AND state IN ('provider_pending', 'provider_deleting')`,
      [
        requestId ? "deletion_request" : "retention_policy",
        requestId,
        requestId ? null : policyVersion,
        now,
        leaseToken,
        leaseExpiresAt,
        objectId,
      ],
    );
    if (claimed.rowCount !== 1) {
      await client.query("ROLLBACK");
      return { kind: "busy" };
    }
    job = await artifactDeletionJob(client, objectId);
    await client.query("COMMIT");
    return { kind: "provider", leaseToken, row: job! };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function releaseArtifactDeletionClaim(objectId: string, leaseToken: string, now: Date, error: unknown) {
  try {
    await dbClient.execute({
      sql: `UPDATE tokenless_artifact_deletion_jobs
            SET state = 'provider_pending', next_attempt_at = ?, lease_token = NULL, lease_expires_at = NULL,
                last_error = ?, updated_at = ?
            WHERE object_id = ? AND state = 'provider_deleting' AND lease_token = ?`,
      args: [
        new Date(now.getTime() + ARTIFACT_DELETION_RETRY_MS),
        artifactDeletionError(error),
        now,
        objectId,
        leaseToken,
      ],
    });
  } catch {
    // A stale provider claim is recovered after its durable lease expires.
  }
}

async function checkpointProviderDeletion(objectId: string, leaseToken: string, now: Date) {
  const result = await dbClient.execute({
    sql: `UPDATE tokenless_artifact_deletion_jobs
          SET state = 'provider_deleted', provider_deleted_at = ?, next_attempt_at = ?,
              lease_token = NULL, lease_expires_at = NULL, last_error = NULL, updated_at = ?
          WHERE object_id = ? AND state = 'provider_deleting' AND lease_token = ?`,
    args: [now, now, now, objectId, leaseToken],
  });
  if (result.rowCount === 1) return true;
  const current = await dbClient.execute({
    sql: "SELECT state FROM tokenless_artifact_deletion_jobs WHERE object_id = ?",
    args: [objectId],
  });
  return ["provider_deleted", "finalized", "completed"].includes(
    rowString(current.rows[0] as QueryRow | undefined, "state") ?? "",
  );
}

async function finalizeArtifactDeletion(objectId: string, now: Date, runtime: ArtifactPrivacyRuntime) {
  const identity = await dbClient.execute({
    sql: "SELECT workspace_id FROM tokenless_artifact_deletion_jobs WHERE object_id = ?",
    args: [objectId],
  });
  const workspaceId = rowString(identity.rows[0] as QueryRow | undefined, "workspace_id");
  if (!workspaceId) return false;
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT workspace_id FROM tokenless_workspaces WHERE workspace_id = $1 FOR UPDATE", [
      workspaceId,
    ]);
    const job = await artifactDeletionJob(client, objectId, true);
    if (!job) {
      await client.query("COMMIT");
      return false;
    }
    if (rowString(job, "workspace_id") !== workspaceId) {
      throw new TokenlessServiceError(
        "The artifact deletion checkpoint changed workspace while being finalized.",
        500,
        "artifact_deletion_checkpoint_invalid",
      );
    }
    const state = rowString(job, "state");
    if (state === "finalized" || state === "completed") {
      await client.query("COMMIT");
      return true;
    }
    if (state !== "provider_deleted") {
      await client.query("COMMIT");
      return false;
    }
    await runtime.deletionHook?.("before_finalize_commit");
    await client.query(
      `UPDATE tokenless_assurance_artifact_objects SET status = 'deleted', deleted_at = COALESCE(deleted_at, $1)
       WHERE object_id = $2 AND status IN ('active', 'deleted')`,
      [now, objectId],
    );
    await client.query(
      "UPDATE tokenless_assurance_artifacts SET storage_ref = $1, updated_at = $2 WHERE artifact_id = $3",
      [`deleted://${rowString(job, "artifact_id")}`, now, rowString(job, "artifact_id")],
    );
    await client.query(
      `UPDATE tokenless_assurance_deletion_requests SET status = 'completed', completed_at = $1
       WHERE project_id = $2 AND status = 'pending' AND execute_after <= $1
         AND NOT EXISTS (
           SELECT 1 FROM tokenless_assurance_artifact_objects
           WHERE project_id = $2 AND status = 'active'
         )`,
      [now, rowString(job, "project_id")],
    );
    await client.query(
      `UPDATE tokenless_artifact_deletion_jobs
       SET state = 'finalized', finalized_at = $1, next_attempt_at = $1, last_error = NULL, updated_at = $1
      WHERE object_id = $2 AND state = 'provider_deleted'`,
      [now, objectId],
    );
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function isUniqueViolation(error: unknown) {
  return Boolean(
    error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "23505",
  );
}

async function completeArtifactDeletionAudit(objectId: string, now: Date, runtime: ArtifactPrivacyRuntime) {
  const jobResult = await dbClient.execute({
    sql: `SELECT workspace_id, artifact_id, authorization_kind, deletion_request_id,
                 retention_policy_version, state, finalized_at
          FROM tokenless_artifact_deletion_jobs WHERE object_id = ?`,
    args: [objectId],
  });
  const job = jobResult.rows[0] as QueryRow | undefined;
  if (!job || rowString(job, "state") === "completed") return true;
  if (rowString(job, "state") !== "finalized") return false;
  const workspaceId = rowString(job, "workspace_id")!;
  const occurredAt = new Date(String(job.finalized_at));
  if (!Number.isFinite(occurredAt.getTime())) {
    throw new TokenlessServiceError(
      "The artifact deletion audit checkpoint is invalid.",
      500,
      "artifact_deletion_checkpoint_invalid",
    );
  }
  let audit: Awaited<ReturnType<typeof appendAuditEvent>>;
  try {
    audit = await (runtime.auditWriter ?? appendAuditEvent)({
      action: "artifact.retention_delete",
      actorKind: "system",
      actorReference: "system:retention_worker",
      assuranceMethod: "scheduled_worker",
      idempotencyKey: artifactDeletionCorrelation(objectId),
      metadata: {
        basisKind: rowString(job, "authorization_kind"),
        policyVersion: rowString(job, "retention_policy_version") ? Number(job.retention_policy_version) : null,
        requestId: rowString(job, "deletion_request_id"),
      },
      occurredAt,
      purpose: "retention_enforcement",
      reason:
        rowString(job, "authorization_kind") === "deletion_request"
          ? "authorized_deletion_request"
          : "retention_period_elapsed",
      requestCorrelation: artifactDeletionCorrelation(objectId),
      result: "success",
      targetId: rowString(job, "artifact_id")!,
      targetKind: "artifact",
      workspaceId,
    });
  } catch (error) {
    const recordedError = isUniqueViolation(error)
      ? new TokenlessServiceError(
          "The artifact deletion audit correlation is already bound to different evidence.",
          409,
          "artifact_deletion_audit_conflict",
        )
      : error;
    await dbClient.execute({
      sql: `UPDATE tokenless_artifact_deletion_jobs SET last_error = ?, updated_at = ?
            WHERE object_id = ? AND state = 'finalized'`,
      args: [artifactDeletionError(recordedError), now, objectId],
    });
    throw recordedError;
  }
  await runtime.deletionHook?.("after_audit_append");
  const completed = await dbClient.execute({
    sql: `UPDATE tokenless_artifact_deletion_jobs
          SET state = 'completed', audit_event_id = ?, audit_event_digest = ?, audited_at = ?,
              next_attempt_at = ?, last_error = NULL, updated_at = ?
          WHERE object_id = ? AND state = 'finalized'`,
    args: [audit.eventId, audit.eventDigest, now, now, now, objectId],
  });
  if (completed.rowCount === 1) return true;
  const current = await dbClient.execute({
    sql: "SELECT state FROM tokenless_artifact_deletion_jobs WHERE object_id = ?",
    args: [objectId],
  });
  return rowString(current.rows[0] as QueryRow | undefined, "state") === "completed";
}

export async function processArtifactDeletionByObjectId(objectId: string, now = new Date()) {
  const runtime = getRuntime();
  const claim = await claimArtifactDeletion(objectId, now);
  if (claim.kind === "done") return true;
  if (claim.kind === "busy") return false;

  if (claim.kind === "provider") {
    try {
      // The irreversible provider call is deliberately outside every database
      // transaction; retries are safe because provider deletion is idempotent.
      await runtime.store.delete(rowString(claim.row, "storage_ref")!);
      await runtime.deletionHook?.("after_provider_delete");
    } catch (error) {
      await releaseArtifactDeletionClaim(objectId, claim.leaseToken, now, error);
      throw error;
    }
    if (!(await checkpointProviderDeletion(objectId, claim.leaseToken, now))) return false;
    await runtime.deletionHook?.("after_provider_checkpoint");
  }

  if (!(await finalizeArtifactDeletion(objectId, now, runtime))) return false;
  return completeArtifactDeletionAudit(objectId, now, runtime);
}

export async function processDueArtifactDeletions(now = new Date(), limit = 100) {
  const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  const result = await dbClient.execute({
    sql: `SELECT candidate.object_id FROM (
            SELECT object_id, created_at AS sort_at FROM tokenless_assurance_artifact_objects
            WHERE status = 'active' AND delete_after <= ?
            UNION
            SELECT object_id, created_at AS sort_at FROM tokenless_artifact_deletion_jobs
            WHERE state <> 'completed' AND next_attempt_at <= ?
          ) candidate
          GROUP BY candidate.object_id
          ORDER BY MIN(candidate.sort_at) ASC LIMIT ?`,
    args: [now, now, boundedLimit],
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

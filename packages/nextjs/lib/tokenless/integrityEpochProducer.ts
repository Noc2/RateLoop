import { createPrivateKey } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { dbPool } from "~~/lib/db";
import { persistIntegrityEpochSnapshotWithClient } from "~~/lib/tokenless/integrityEpochPersistence";
import {
  type IntegrityEpochKeys,
  type IntegrityEpochObservation,
  buildIntegrityEpoch,
  hashIntegrityValue,
  integrityReviewerLookup,
  integrityValueCommitment,
} from "~~/lib/tokenless/integrityEpochs";
import { requirePaidLaneComplianceApproval } from "~~/lib/tokenless/paidLaneCompliance";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const DAY_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_PRIVATE_FEATURE_RETENTION_DAYS = 30;
const MAX_RATERS_PER_EPOCH = 100_000;
const SCORER_BUILD = {
  schemaVersion: "rateloop.integrity-epoch-producer.v1",
  behavioralSignals: "disabled_pending_dpia",
  hardLinkSources: ["provider_subject", "payout_ownership"],
  eligibilitySource: "paid_eligibility_scope_and_unique_human",
} as const;

type Row = Record<string, unknown>;

type IntegrityEpochRuntime = {
  keys: IntegrityEpochKeys;
  privateFeatureRetentionDays: number;
};

export type IntegrityEpochProductionResult = {
  status: "created" | "disabled" | "empty" | "existing" | "failed";
  epochId: string;
  manifestHash: string | null;
  observations: number;
};

function integrityLookupKeyRing(env: NodeJS.ProcessEnv) {
  const result = new Map<string, Buffer>();
  const raw = env.TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEYS_JSON?.trim();
  if (raw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEYS_JSON must be a JSON object.");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEYS_JSON must be a JSON object.");
    }
    for (const [version, encoded] of Object.entries(parsed)) {
      if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/u.test(version) || typeof encoded !== "string") {
        throw new Error("Integrity reviewer lookup key ring is invalid.");
      }
      const key = Buffer.from(encoded, "base64url");
      if (key.byteLength < 32) throw new Error("Integrity reviewer lookup key ring is invalid.");
      result.set(version, key);
    }
  }
  const currentVersion = env.TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEY_VERSION?.trim();
  const currentEncoded = env.TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEY?.trim();
  if (currentVersion && currentEncoded) {
    const current = Buffer.from(currentEncoded, "base64url");
    if (current.byteLength < 32) throw new Error("Integrity reviewer lookup key is invalid.");
    const existing = result.get(currentVersion);
    if (existing && !existing.equals(current)) throw new Error("Integrity reviewer lookup key ring conflicts.");
    result.set(currentVersion, current);
  }
  return result;
}

function rowText(row: Row, key: string) {
  const value = row[key];
  return value === null || value === undefined ? null : String(value);
}

function rowDate(row: Row, key: string) {
  const value = row[key];
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new Error(`Database returned an invalid ${key}.`);
  return date;
}

function parseKey(env: NodeJS.ProcessEnv, name: string) {
  if (env[`NEXT_PUBLIC_${name}`]) throw new Error(`${name} must never use a NEXT_PUBLIC_ environment variable.`);
  const encoded = env[name]?.trim();
  const key = encoded ? Buffer.from(encoded, "base64url") : Buffer.alloc(0);
  if (key.byteLength < 32) {
    throw new TokenlessServiceError(
      "The integrity epoch producer is not configured.",
      503,
      "integrity_epoch_producer_unavailable",
      true,
    );
  }
  return key;
}

function requiredVersion(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name]?.trim();
  if (!value || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/u.test(value)) {
    throw new TokenlessServiceError(
      "The integrity epoch producer is not configured.",
      503,
      "integrity_epoch_producer_unavailable",
      true,
    );
  }
  return value;
}

function signingPrivateKey(env: NodeJS.ProcessEnv) {
  if (env.NEXT_PUBLIC_TOKENLESS_INTEGRITY_SIGNING_PRIVATE_KEY) {
    throw new Error("TOKENLESS_INTEGRITY_SIGNING_PRIVATE_KEY must never use a NEXT_PUBLIC_ environment variable.");
  }
  const encoded = env.TOKENLESS_INTEGRITY_SIGNING_PRIVATE_KEY?.trim();
  if (!encoded) {
    throw new TokenlessServiceError(
      "The integrity epoch producer is not configured.",
      503,
      "integrity_epoch_producer_unavailable",
      true,
    );
  }
  try {
    return encoded.includes("BEGIN PRIVATE KEY")
      ? createPrivateKey(encoded)
      : createPrivateKey({ key: Buffer.from(encoded, "base64url"), format: "der", type: "pkcs8" });
  } catch {
    throw new TokenlessServiceError(
      "The integrity epoch signing key is invalid.",
      503,
      "integrity_epoch_producer_unavailable",
      true,
    );
  }
}

export function integrityEpochRuntime(env: NodeJS.ProcessEnv = process.env): IntegrityEpochRuntime {
  const retention = Number(
    env.TOKENLESS_INTEGRITY_PRIVATE_FEATURE_RETENTION_DAYS ?? DEFAULT_PRIVATE_FEATURE_RETENTION_DAYS,
  );
  if (!Number.isSafeInteger(retention) || retention < 1 || retention > 365) {
    throw new Error("TOKENLESS_INTEGRITY_PRIVATE_FEATURE_RETENTION_DAYS must be an integer from 1 to 365.");
  }
  return {
    keys: {
      lookupKey: parseKey(env, "TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEY"),
      lookupKeyVersion: requiredVersion(env, "TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEY_VERSION"),
      pseudonymKey: parseKey(env, "TOKENLESS_INTEGRITY_PSEUDONYM_KEY"),
      pseudonymKeyVersion: requiredVersion(env, "TOKENLESS_INTEGRITY_PSEUDONYM_KEY_VERSION"),
      vaultKey: parseKey(env, "TOKENLESS_INTEGRITY_VAULT_KEY"),
      vaultKeyVersion: requiredVersion(env, "TOKENLESS_INTEGRITY_VAULT_KEY_VERSION"),
      signingPrivateKey: signingPrivateKey(env),
      signingKeyId: env.TOKENLESS_INTEGRITY_SIGNING_KEY_ID?.trim() || undefined,
    },
    privateFeatureRetentionDays: retention,
  };
}

function jsonStrings(raw: unknown, field: string) {
  if (raw === null || raw === undefined) return [];
  let parsed: unknown;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    throw new Error(`Database returned invalid ${field}.`);
  }
  if (!Array.isArray(parsed) || parsed.some(value => typeof value !== "string")) {
    throw new Error(`Database returned invalid ${field}.`);
  }
  return [...new Set(parsed)].sort();
}

export function integrityObservationFromRow(
  row: Row,
  input: { observedAt: Date; pseudonymKey: Buffer },
): IntegrityEpochObservation {
  const reviewerId = rowText(row, "account_address");
  const raterId = rowText(row, "rater_id");
  if (!reviewerId || !raterId) throw new Error("Integrity source row lacks its internal reviewer identity.");
  const scopeValidUntil = rowDate(row, "scope_valid_until");
  const assertionExpiresAt = rowDate(row, "assertion_expires_at");
  const deletedAt = rowDate(row, "deleted_at");
  const hasUniqueHuman = rowText(row, "unique_human_assertion_id") !== null;
  const eligible =
    deletedAt === null &&
    rowText(row, "scope_status") === "eligible" &&
    scopeValidUntil !== null &&
    scopeValidUntil > input.observedAt &&
    hasUniqueHuman &&
    (rowText(row, "assurance_validity_model") === "durable_enrollment" ||
      (assertionExpiresAt !== null && assertionExpiresAt > input.observedAt));
  const exclusionReasonCodes = [
    ...(deletedAt ? ["profile_deleted"] : []),
    ...(rowText(row, "scope_status") !== "eligible" ? ["network_paid_scope_unavailable"] : []),
    ...(!scopeValidUntil || scopeValidUntil <= input.observedAt ? ["network_paid_scope_expired"] : []),
    ...(!hasUniqueHuman ? ["unique_human_unavailable"] : []),
    ...(hasUniqueHuman &&
    rowText(row, "assurance_validity_model") !== "durable_enrollment" &&
    (!assertionExpiresAt || assertionExpiresAt <= input.observedAt)
      ? ["unique_human_expired"]
      : []),
  ];
  const sourceRecordCommitments = [
    hashIntegrityValue({
      schemaVersion: "rateloop.integrity-source-record.v1",
      raterId,
      profileUpdatedAt: rowDate(row, "profile_updated_at")?.toISOString() ?? null,
      paidScopeId: rowText(row, "scope_id"),
      paidScopeUpdatedAt: rowDate(row, "scope_updated_at")?.toISOString() ?? null,
      uniqueHumanAssertionId: rowText(row, "unique_human_assertion_id"),
      uniqueHumanUpdatedAt: rowDate(row, "assertion_updated_at")?.toISOString() ?? null,
    }),
  ];
  const hardLinks: IntegrityEpochObservation["hardLinks"] = [];
  for (const subject of jsonStrings(row.provider_subject_hashes_json, "provider subject hashes")) {
    hardLinks.push({
      kind: "provider_subject_conflict",
      valueCommitment: integrityValueCommitment({
        key: input.pseudonymKey,
        kind: "provider_subject_conflict",
        value: subject,
      }),
    });
  }
  const payoutAccount = rowText(row, "payout_account");
  if (payoutAccount) {
    hardLinks.push({
      kind: "payout_ownership_conflict",
      valueCommitment: integrityValueCommitment({
        key: input.pseudonymKey,
        kind: "payout_ownership_conflict",
        value: payoutAccount.toLowerCase(),
      }),
    });
  }
  return {
    reviewerId,
    observedAt: input.observedAt.toISOString(),
    sourceRecordCommitments,
    eligible,
    exclusionReasonCodes,
    hardLinks,
    behavioralRiskBps: 0,
    behaviorReasonCodes: ["behavioral_signals_disabled_pending_dpia"],
  };
}

async function loadIntegritySourceRows(client: Pick<PoolClient, "query">, cutoffAt: Date) {
  return client.query(
    `SELECT p.rater_id,p.account_address,p.updated_at AS profile_updated_at,p.deleted_at,
            s.scope_id,s.status AS scope_status,s.valid_until AS scope_valid_until,s.updated_at AS scope_updated_at,
            pe.payout_account,
            uh.assertion_id AS unique_human_assertion_id,uh.evidence_expires_at AS assertion_expires_at,
            uh.assurance_validity_model,uh.updated_at AS assertion_updated_at,
            COALESCE(subjects.subject_hashes_json,'[]') AS provider_subject_hashes_json
     FROM tokenless_rater_profiles p
     LEFT JOIN tokenless_paid_eligibility_scopes s
       ON s.rater_id=p.rater_id AND s.reviewer_source='rateloop_network' AND s.workspace_id IS NULL
     LEFT JOIN tokenless_payout_eligibility pe ON pe.rater_id=p.rater_id
     LEFT JOIN LATERAL (
       SELECT a.assertion_id,a.evidence_expires_at,a.assurance_validity_model,a.updated_at
       FROM tokenless_assurance_assertions a
       JOIN tokenless_provider_subject_bindings b
         ON b.binding_id=a.binding_id AND b.rater_id=a.rater_id AND b.status='active'
       WHERE a.rater_id=p.rater_id AND a.status='active'
         AND a.capabilities_json::jsonb ? 'unique_human'
       ORDER BY a.updated_at DESC,a.assertion_id ASC LIMIT 1
     ) uh ON true
     LEFT JOIN LATERAL (
       SELECT json_agg(b.subject_reference_hash ORDER BY b.provider_id,b.provider_namespace)::text AS subject_hashes_json
       FROM tokenless_provider_subject_bindings b
       WHERE b.rater_id=p.rater_id AND b.status='active'
     ) subjects ON true
     WHERE p.created_at <= $1 AND p.deleted_at IS NULL
     ORDER BY p.rater_id ASC LIMIT $2`,
    [cutoffAt, MAX_RATERS_PER_EPOCH + 1],
  );
}

function epochId(now: Date) {
  return `integrity:${now.toISOString().slice(0, 10)}`;
}

export async function produceScheduledIntegrityEpoch(
  input: {
    now?: Date;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<IntegrityEpochProductionResult> {
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("Integrity epoch time is invalid.");
  const env = input.env ?? process.env;
  if (env.TOKENLESS_INTEGRITY_EPOCH_PRODUCER_ENABLED !== "true") {
    return { status: "disabled" as const, epochId: epochId(now), manifestHash: null, observations: 0 };
  }
  requirePaidLaneComplianceApproval("public_paid_network");
  const runtime = integrityEpochRuntime(env);
  const id = epochId(now);
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`tokenless:${id}`]);
    const existing = await client.query(
      "SELECT epoch_id,manifest_hash FROM tokenless_integrity_epochs WHERE epoch_id=$1 LIMIT 1",
      [id],
    );
    if (existing.rowCount === 1) {
      await client.query("COMMIT");
      return {
        status: "existing" as const,
        epochId: id,
        manifestHash: rowText(existing.rows[0] as Row, "manifest_hash")!,
        observations: 0,
      };
    }
    const source = await loadIntegritySourceRows(client, now);
    if (source.rows.length > MAX_RATERS_PER_EPOCH) {
      throw new Error("Integrity epoch source exceeds the supported 100000-reviewer limit.");
    }
    if (source.rows.length === 0) {
      await client.query("COMMIT");
      return { status: "empty" as const, epochId: id, manifestHash: null, observations: 0 };
    }
    const snapshot = buildIntegrityEpoch({
      epochId: id,
      cutoffAt: now.toISOString(),
      sourceWindowStartedAt: new Date(now.getTime() - DAY_MS).toISOString(),
      privateFeaturesExpireAt: new Date(now.getTime() + runtime.privateFeatureRetentionDays * DAY_MS).toISOString(),
      createdAt: now.toISOString(),
      scorerBuildHash: hashIntegrityValue(SCORER_BUILD),
      limitationCodes: [
        "point_in_time_current_state_snapshot",
        "provider_and_payout_hard_links_only",
        "unique_human_provider_registration_required",
      ],
      observations: source.rows.map(row =>
        integrityObservationFromRow(row as Row, { observedAt: now, pseudonymKey: runtime.keys.pseudonymKey }),
      ),
      keys: runtime.keys,
    });
    await persistIntegrityEpochSnapshotWithClient(client, snapshot);
    await client.query("COMMIT");
    return {
      status: "created" as const,
      epochId: id,
      manifestHash: snapshot.manifestHash,
      observations: snapshot.privateLeaves.length,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function purgeExpiredIntegrityEpochPrivateFeatures(
  input: {
    now?: Date;
    limit?: number;
  } = {},
) {
  const now = input.now ?? new Date();
  const limit = input.limit ?? 10_000;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100_000) {
    throw new Error("Integrity private-feature purge limit is invalid.");
  }
  const result = await dbPool.query(
    `DELETE FROM tokenless_integrity_epoch_members
     WHERE epoch_id || '|' || reviewer_lookup IN (
       SELECT m.epoch_id || '|' || m.reviewer_lookup
       FROM tokenless_integrity_epoch_members m
       JOIN tokenless_integrity_epochs e ON e.epoch_id=m.epoch_id
       WHERE e.private_features_expire_at <= $1
       ORDER BY e.private_features_expire_at,m.epoch_id,m.reviewer_lookup
       LIMIT $2
     )`,
    [now, limit],
  );
  return { purged: result.rowCount ?? 0 };
}

export async function eraseIntegrityEpochReviewerMemberships(
  client: Pick<PoolClient, "query">,
  input: { reviewerId: string; env?: NodeJS.ProcessEnv },
) {
  const versions = await client.query(
    `SELECT DISTINCT e.lookup_key_version
     FROM tokenless_integrity_epochs e
     JOIN tokenless_integrity_epoch_members m ON m.epoch_id=e.epoch_id
     ORDER BY e.lookup_key_version`,
  );
  if (versions.rowCount === 0) return { erased: 0, remaining: 0 };
  const keys = integrityLookupKeyRing(input.env ?? process.env);
  let erased = 0;
  const lookups: string[] = [];
  for (const value of versions.rows) {
    const version = rowText(value as Row, "lookup_key_version")!;
    const key = keys.get(version);
    if (!key) {
      throw new TokenlessServiceError(
        `Integrity reviewer lookup key ${version} is required to complete erasure.`,
        503,
        "integrity_erasure_key_unavailable",
        true,
      );
    }
    const lookup = integrityReviewerLookup({ key, reviewerId: input.reviewerId });
    lookups.push(lookup);
    const removed = await client.query(
      `DELETE FROM tokenless_integrity_epoch_members
       WHERE epoch_id IN (
         SELECT epoch_id FROM tokenless_integrity_epochs WHERE lookup_key_version=$1
       ) AND reviewer_lookup=$2`,
      [version, lookup],
    );
    erased += removed.rowCount ?? 0;
  }
  const remaining = await client.query(
    "SELECT COUNT(*) AS count FROM tokenless_integrity_epoch_members WHERE reviewer_lookup=ANY($1::text[])",
    [lookups],
  );
  return { erased, remaining: Number((remaining.rows[0] as Row | undefined)?.count ?? 0) };
}

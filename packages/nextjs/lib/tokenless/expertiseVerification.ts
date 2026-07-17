import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbClient, dbPool } from "~~/lib/db";
import { expertiseQualificationKey, normalizeReviewerExpertiseKeys } from "~~/lib/tokenless/reviewerExpertise";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;
type VerificationStatus = "pending" | "verified" | "rejected" | "revoked";
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const GENESIS_HASH = `sha256:${"0".repeat(64)}`;

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function integer(row: Row | undefined, key: string) {
  const value = Number(row?.[key]);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Stored ${key} is invalid.`);
  return value;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Verification value is not JSON serializable.");
  return encoded;
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function requireEvidenceHash(value: unknown) {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) {
    throw new TokenlessServiceError(
      "Credential evidence reference must be a SHA-256 commitment.",
      400,
      "invalid_expertise_evidence",
    );
  }
  return value;
}

function requireReason(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 500) {
    throw new TokenlessServiceError(
      "Verification reason must contain 1-500 characters.",
      400,
      "invalid_expertise_decision",
    );
  }
  return value.trim();
}

function operatorAccounts() {
  if (process.env.NEXT_PUBLIC_TOKENLESS_EXPERTISE_OPERATOR_ACCOUNTS) {
    throw new Error("Expertise operator accounts must never use a NEXT_PUBLIC variable.");
  }
  const source =
    process.env.TOKENLESS_EXPERTISE_OPERATOR_ACCOUNTS?.split(",")
      .map(value => value.trim())
      .filter(Boolean) ?? [];
  return new Set(source.map(value => normalizeAccountSubject(value)));
}

function requireOperator(accountAddress: string) {
  let actor: string;
  try {
    actor = normalizeAccountSubject(accountAddress);
  } catch {
    throw new TokenlessServiceError("Account address is invalid.", 400, "invalid_account");
  }
  const accounts = operatorAccounts();
  if (accounts.size === 0) {
    throw new TokenlessServiceError(
      "Expertise credential verification is not configured.",
      503,
      "expertise_verification_unavailable",
    );
  }
  if (!accounts.has(actor))
    throw new TokenlessServiceError("Verification request not found.", 404, "verification_not_found");
  return actor;
}

async function appendVerificationEvent(
  client: PoolClient,
  input: {
    requestId: string;
    eventType: "submitted" | "verified" | "rejected" | "revoked";
    actorKind: "rater" | "operator";
    actorReference: string;
    details: Record<string, unknown>;
    occurredAt: Date;
  },
) {
  const previous = await client.query(
    `SELECT sequence,event_hash FROM tokenless_expertise_verification_events
     WHERE request_id=$1 ORDER BY sequence DESC LIMIT 1 FOR UPDATE`,
    [input.requestId],
  );
  const sequence = previous.rowCount ? integer(previous.rows[0] as Row, "sequence") + 1 : 1;
  const previousEventHash = text(previous.rows[0] as Row | undefined, "event_hash") ?? GENESIS_HASH;
  const detailsJson = stableJson(input.details);
  const eventHash = sha256(
    stableJson({
      requestId: input.requestId,
      sequence,
      eventType: input.eventType,
      actorKind: input.actorKind,
      actorReference: input.actorReference,
      details: input.details,
      previousEventHash,
      occurredAt: input.occurredAt.toISOString(),
    }),
  );
  await client.query(
    `INSERT INTO tokenless_expertise_verification_events
     (event_id,request_id,sequence,event_type,actor_kind,actor_reference,details_json,
      previous_event_hash,event_hash,occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      `exve_${randomUUID().replaceAll("-", "")}`,
      input.requestId,
      sequence,
      input.eventType,
      input.actorKind,
      input.actorReference,
      detailsJson,
      previousEventHash,
      eventHash,
      input.occurredAt,
    ],
  );
  return { sequence, eventHash };
}

export async function submitExpertiseVerificationRequest(input: {
  accountAddress: string;
  expertiseKeys: unknown;
  evidenceReferenceHash: unknown;
  now?: Date;
}) {
  let actor: string;
  try {
    actor = normalizeAccountSubject(input.accountAddress);
  } catch {
    throw new TokenlessServiceError("Account address is invalid.", 400, "invalid_account");
  }
  const expertiseKeys = normalizeReviewerExpertiseKeys(input.expertiseKeys);
  if (expertiseKeys.length === 0) {
    throw new TokenlessServiceError("Choose at least one expertise area.", 400, "invalid_reviewer_expertise");
  }
  const evidenceReferenceHash = requireEvidenceHash(input.evidenceReferenceHash);
  const rater = await dbClient.execute({
    sql: "SELECT rater_id FROM tokenless_rater_profiles WHERE account_address=? LIMIT 1",
    args: [actor],
  });
  const raterId = text(rater.rows[0] as Row | undefined, "rater_id");
  if (!raterId) {
    throw new TokenlessServiceError(
      "Complete RateLoop-network rater admission before submitting expertise evidence.",
      409,
      "rater_profile_required",
    );
  }
  const requestId = `exvr_${randomUUID().replaceAll("-", "")}`;
  const now = input.now ?? new Date();
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    try {
      await client.query(
        `INSERT INTO tokenless_expertise_verification_requests
         (request_id,rater_id,expertise_keys_json,evidence_reference_hash,status,submitted_at)
         VALUES ($1,$2,$3,$4,'pending',$5)`,
        [requestId, raterId, stableJson(expertiseKeys), evidenceReferenceHash, now],
      );
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "23505") {
        throw new TokenlessServiceError(
          "This credential evidence was already submitted.",
          409,
          "expertise_verification_exists",
        );
      }
      throw error;
    }
    await appendVerificationEvent(client, {
      requestId,
      eventType: "submitted",
      actorKind: "rater",
      actorReference: raterId,
      details: { expertiseKeys, evidenceReferenceHash },
      occurredAt: now,
    });
    await client.query("COMMIT");
    return {
      requestId,
      status: "pending" as const,
      expertiseKeys,
      evidenceReferenceHash,
      submittedAt: now.toISOString(),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listExpertiseVerificationQueue(input: { accountAddress: string; status?: VerificationStatus }) {
  requireOperator(input.accountAddress);
  const status = input.status ?? "pending";
  if (!["pending", "verified", "rejected", "revoked"].includes(status)) {
    throw new TokenlessServiceError("Verification status is invalid.", 400, "invalid_expertise_decision");
  }
  const result = await dbClient.execute({
    sql: `SELECT request_id,rater_id,expertise_keys_json,evidence_reference_hash,status,
                 submitted_at,reviewed_by,reviewed_at,decision_reason,expires_at
          FROM tokenless_expertise_verification_requests WHERE status=?
          ORDER BY submitted_at ASC,request_id ASC LIMIT 200`,
    args: [status],
  });
  return result.rows.map(value => {
    const row = value as Row;
    return {
      requestId: text(row, "request_id")!,
      raterReference: sha256(text(row, "rater_id")!),
      expertiseKeys: JSON.parse(text(row, "expertise_keys_json") ?? "[]"),
      evidenceReferenceHash: text(row, "evidence_reference_hash")!,
      status: text(row, "status") as VerificationStatus,
      submittedAt: new Date(String(row.submitted_at)).toISOString(),
      reviewedAt: row.reviewed_at ? new Date(String(row.reviewed_at)).toISOString() : null,
      expiresAt: row.expires_at ? new Date(String(row.expires_at)).toISOString() : null,
      decisionReason: text(row, "decision_reason"),
    };
  });
}

export async function decideExpertiseVerificationRequest(input: {
  accountAddress: string;
  requestId: string;
  decision: "verified" | "rejected";
  reason: unknown;
  expiresAt?: string | null;
  now?: Date;
}) {
  const operator = requireOperator(input.accountAddress);
  if (input.decision !== "verified" && input.decision !== "rejected") {
    throw new TokenlessServiceError("Verification decision is invalid.", 400, "invalid_expertise_decision");
  }
  const reason = requireReason(input.reason);
  const now = input.now ?? new Date();
  const expiresAt = input.decision === "verified" ? new Date(String(input.expiresAt ?? "")) : null;
  if (
    input.decision === "verified" &&
    (!Number.isFinite(expiresAt!.getTime()) ||
      expiresAt! <= now ||
      expiresAt!.getTime() - now.getTime() > 2 * 365 * 86_400_000)
  ) {
    throw new TokenlessServiceError(
      "Verified credentials require an expiry within two years.",
      400,
      "invalid_expertise_decision",
    );
  }
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT * FROM tokenless_expertise_verification_requests WHERE request_id=$1 FOR UPDATE`,
      [input.requestId],
    );
    const row = current.rows[0] as Row | undefined;
    if (!row || text(row, "status") !== "pending") {
      throw new TokenlessServiceError("Verification request not found.", 404, "verification_not_found");
    }
    const expertiseKeys = normalizeReviewerExpertiseKeys(JSON.parse(text(row, "expertise_keys_json") ?? "[]"));
    const raterId = text(row, "rater_id")!;
    const evidenceReferenceHash = text(row, "evidence_reference_hash")!;
    await client.query(
      `UPDATE tokenless_expertise_verification_requests
       SET status=$1,reviewed_by=$2,reviewed_at=$3,decision_reason=$4,expires_at=$5
       WHERE request_id=$6 AND status='pending'`,
      [input.decision, operator, now, reason, expiresAt, input.requestId],
    );
    if (input.decision === "verified") {
      const qualificationId = `qual_exp_${createHash("sha256").update(input.requestId).digest("hex").slice(0, 32)}`;
      await client.query(
        `INSERT INTO tokenless_reviewer_qualifications
         (qualification_id,rater_id,reviewer_source,qualification_kind,cohort_ids_json,
          qualification_keys_json,evidence_kind,workspace_id,evidence_reference_hash,
          qualification_value_json,verified_at,expires_at,status,created_at,updated_at,
          expertise_record_schema_version)
         VALUES ($1,$2,'rateloop_network','expertise','[]',$3,'platform_verified_credential',NULL,$4,$5,$6,$7,
                 'active',$6,$6,1)`,
        [
          qualificationId,
          raterId,
          stableJson(expertiseKeys.map(expertiseQualificationKey)),
          evidenceReferenceHash,
          stableJson({ expertiseKeys, verificationRequestId: input.requestId }),
          now,
          expiresAt,
        ],
      );
      for (const expertiseKey of expertiseKeys) {
        const definitionResult = await client.query(
          `SELECT definition_id,version,definition_hash,label
           FROM tokenless_reviewer_expertise_definitions
           WHERE scope='global' AND slug=$1 AND network_eligible=true
             AND status='active' AND superseded_at IS NULL
           LIMIT 1 FOR SHARE`,
          [expertiseKey],
        );
        const definition = definitionResult.rows[0] as Row | undefined;
        if (!definition) {
          throw new TokenlessServiceError(
            "A verified specialist area is unavailable in the current network catalog.",
            409,
            "reviewer_expertise_definition_unavailable",
          );
        }
        const definitionId = text(definition, "definition_id");
        const definitionVersion = integer(definition, "version");
        const definitionHash = text(definition, "definition_hash");
        if (!definitionId || !definitionHash || !HASH_PATTERN.test(definitionHash)) {
          throw new TokenlessServiceError(
            "A verified specialist area is unavailable in the current network catalog.",
            409,
            "reviewer_expertise_definition_unavailable",
          );
        }
        await client.query(
          `UPDATE tokenless_reviewer_qualifications
           SET status='revoked',revoked_at=$1,revoked_by=$2,updated_at=$1
           WHERE rater_id=$3 AND reviewer_source='rateloop_network'
             AND qualification_kind='expertise' AND expertise_record_schema_version=2
             AND expertise_definition_id=$4 AND expertise_definition_version=$5 AND status='active'`,
          [now, operator, raterId, definitionId, definitionVersion],
        );
        const exactQualificationId = `qual_exp_${createHash("sha256")
          .update(`${input.requestId}:${definitionId}:${definitionVersion}`)
          .digest("hex")
          .slice(0, 32)}`;
        await client.query(
          `INSERT INTO tokenless_reviewer_qualifications
           (qualification_id,rater_id,reviewer_source,qualification_kind,cohort_ids_json,
            qualification_keys_json,evidence_kind,workspace_id,evidence_reference_hash,
            qualification_value_json,verified_at,expires_at,status,created_at,updated_at,revoked_at,
            expertise_record_schema_version,expertise_definition_id,expertise_definition_version,
            expertise_definition_hash,source_invitation_id,asserted_by,revoked_by)
           VALUES ($1,$2,'rateloop_network','expertise','[]','[]','platform_verified_credential',NULL,$3,$4,
                   $5,$6,'active',$5,$5,NULL,2,$7,$8,$9,NULL,$10,NULL)`,
          [
            exactQualificationId,
            raterId,
            evidenceReferenceHash,
            stableJson({
              schemaVersion: "rateloop.exact-network-expertise-credential.v1",
              verificationRequestId: input.requestId,
              definition: {
                definitionId,
                definitionVersion,
                definitionHash,
                label: text(definition, "label"),
              },
            }),
            now,
            expiresAt,
            definitionId,
            definitionVersion,
            definitionHash,
            operator,
          ],
        );
      }
    }
    await appendVerificationEvent(client, {
      requestId: input.requestId,
      eventType: input.decision,
      actorKind: "operator",
      actorReference: operator,
      details: {
        decision: input.decision,
        reason,
        expertiseKeys,
        evidenceReferenceHash,
        expiresAt: expiresAt?.toISOString() ?? null,
      },
      occurredAt: now,
    });
    await client.query("COMMIT");
    return {
      requestId: input.requestId,
      status: input.decision,
      expertiseKeys,
      expiresAt: expiresAt?.toISOString() ?? null,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function revokeExpertiseVerificationRequest(input: {
  accountAddress: string;
  requestId: string;
  reason: unknown;
  now?: Date;
}) {
  const operator = requireOperator(input.accountAddress);
  const reason = requireReason(input.reason);
  const now = input.now ?? new Date();
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT * FROM tokenless_expertise_verification_requests WHERE request_id=$1 FOR UPDATE`,
      [input.requestId],
    );
    const row = current.rows[0] as Row | undefined;
    if (!row || text(row, "status") !== "verified") {
      throw new TokenlessServiceError("Verification request not found.", 404, "verification_not_found");
    }
    await client.query(
      `UPDATE tokenless_expertise_verification_requests
       SET status='revoked',reviewed_by=$1,reviewed_at=$2,decision_reason=$3
       WHERE request_id=$4 AND status='verified'`,
      [operator, now, reason, input.requestId],
    );
    await client.query(
      `UPDATE tokenless_reviewer_qualifications
       SET status='revoked',revoked_at=$1,revoked_by=$2,updated_at=$1
       WHERE rater_id=$3 AND qualification_kind='expertise'
         AND expertise_record_schema_version=2 AND evidence_reference_hash=$4 AND status='active'`,
      [now, operator, text(row, "rater_id"), text(row, "evidence_reference_hash")],
    );
    await client.query(
      `UPDATE tokenless_reviewer_qualifications
       SET status='revoked',revoked_at=$1,updated_at=$1
       WHERE rater_id=$2 AND qualification_kind='expertise'
         AND expertise_record_schema_version=1 AND evidence_reference_hash=$3 AND status='active'`,
      [now, text(row, "rater_id"), text(row, "evidence_reference_hash")],
    );
    await appendVerificationEvent(client, {
      requestId: input.requestId,
      eventType: "revoked",
      actorKind: "operator",
      actorReference: operator,
      details: { reason },
      occurredAt: now,
    });
    await client.query("COMMIT");
    return { requestId: input.requestId, status: "revoked" as const };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export const __expertiseVerificationTestUtils = { appendVerificationEvent, sha256, stableJson };

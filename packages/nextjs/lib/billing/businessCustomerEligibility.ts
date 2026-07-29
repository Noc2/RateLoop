import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResult } from "pg";
import "server-only";
import { dbPool } from "~~/lib/db";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const BUSINESS_VERIFICATION_METHODS = [
  "commercial_register",
  "tax_registration",
  "contractual_due_diligence",
  "other_documentary",
] as const;

export type BusinessVerificationMethod = (typeof BUSINESS_VERIFICATION_METHODS)[number];
export type BusinessVerificationStatus = "unverified" | "self_declared" | "verified" | "not_applicable";

type Row = Record<string, unknown> | undefined;
type BusinessVerificationQueryable = {
  query: (text: string, values?: unknown[]) => Promise<Pick<QueryResult, "rowCount" | "rows">>;
};

const BUSINESS_VERIFICATION_METHOD_SET = new Set<string>(BUSINESS_VERIFICATION_METHODS);
const REFERENCE_HASH_PATTERN = /^[0-9a-f]{64}$/u;

function text(row: Row, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function date(row: Row, key: string) {
  const value = row?.[key];
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function requiredText(value: unknown, field: string, maxLength: number) {
  if (typeof value !== "string") throw new Error(`${field} is required.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new Error(`${field} is invalid.`);
  return normalized;
}

export type VerifiedBusinessCustomer = {
  workspaceId: string;
  legalName: string;
  registeredAddress: string;
  verificationMethod: BusinessVerificationMethod;
  verificationReferenceHash: string;
  verifiedAt: Date;
  verificationExpiresAt: Date;
  verifiedBy: string;
};

export function assertVerifiedBusinessCustomerRecord(
  row: Row,
  input: { now?: Date; workspaceId: string },
): VerifiedBusinessCustomer {
  const now = input.now ?? new Date();
  const status = text(row, "trader_status");
  const legalName = text(row, "trader_legal_name");
  const registeredAddress = text(row, "trader_registered_address");
  const verificationMethod = text(row, "trader_verification_method");
  const verificationReferenceHash = text(row, "trader_verification_reference_hash");
  const verifiedAt = date(row, "trader_verified_at");
  const verificationExpiresAt = date(row, "trader_verification_expires_at");
  const verifiedBy = text(row, "trader_verified_by");
  if (
    status !== "verified" ||
    !legalName ||
    !registeredAddress ||
    !verificationMethod ||
    !BUSINESS_VERIFICATION_METHOD_SET.has(verificationMethod) ||
    !verificationReferenceHash ||
    !REFERENCE_HASH_PATTERN.test(verificationReferenceHash) ||
    !verifiedAt ||
    verifiedAt > now ||
    !verificationExpiresAt ||
    verificationExpiresAt <= now ||
    verificationExpiresAt <= verifiedAt ||
    !verifiedBy
  ) {
    throw new TokenlessServiceError(
      "Independent business verification is required before using paid services.",
      403,
      "business_verification_required",
    );
  }
  return {
    workspaceId: input.workspaceId,
    legalName,
    registeredAddress,
    verificationMethod: verificationMethod as BusinessVerificationMethod,
    verificationReferenceHash,
    verifiedAt,
    verificationExpiresAt,
    verifiedBy,
  };
}

export async function requireVerifiedBusinessCustomer(input: {
  workspaceId: string;
  now?: Date;
  client?: BusinessVerificationQueryable;
}) {
  const queryable = input.client ?? dbPool;
  const result = await queryable.query(
    `SELECT trader_status,trader_legal_name,trader_registered_address,
            trader_verification_method,trader_verification_reference_hash,
            trader_verified_at,trader_verification_expires_at,trader_verified_by
     FROM tokenless_workspace_governance WHERE workspace_id=$1 LIMIT 1`,
    [input.workspaceId],
  );
  return assertVerifiedBusinessCustomerRecord(result.rows[0] as Row, input);
}

function verificationMethod(value: unknown): BusinessVerificationMethod {
  if (typeof value !== "string" || !BUSINESS_VERIFICATION_METHOD_SET.has(value)) {
    throw new Error("verificationMethod is invalid.");
  }
  return value as BusinessVerificationMethod;
}

function referenceHash(value: unknown) {
  if (typeof value !== "string" || !REFERENCE_HASH_PATTERN.test(value)) {
    throw new Error("verificationReferenceHash must be a lowercase SHA-256 hex digest.");
  }
  return value;
}

/**
 * Records a verification decision made at an operator-authenticated boundary.
 * This service deliberately has no customer-facing route: workspace members can
 * submit billing details, but cannot call the independent verification step.
 */
export async function recordOperatorBusinessVerification(input: {
  workspaceId: string;
  operatorReference: string;
  verificationMethod: BusinessVerificationMethod;
  verificationReferenceHash: string;
  verifiedAt?: Date;
  verificationExpiresAt: Date;
  reason: string;
}) {
  const operatorReference = requiredText(input.operatorReference, "operatorReference", 200);
  const method = verificationMethod(input.verificationMethod);
  const evidenceHash = referenceHash(input.verificationReferenceHash);
  const reason = requiredText(input.reason, "reason", 500);
  const verifiedAt = input.verifiedAt ?? new Date();
  if (
    !Number.isFinite(verifiedAt.getTime()) ||
    !Number.isFinite(input.verificationExpiresAt.getTime()) ||
    input.verificationExpiresAt <= verifiedAt
  ) {
    throw new Error("Business verification expiry must be after its verification time.");
  }
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const prior = await client.query(
      `SELECT trader_status,trader_legal_name,trader_registered_address
       FROM tokenless_workspace_governance WHERE workspace_id=$1 FOR UPDATE`,
      [input.workspaceId],
    );
    const row = prior.rows[0] as Row;
    const priorStatus = text(row, "trader_status");
    if (!priorStatus || !text(row, "trader_legal_name") || !text(row, "trader_registered_address")) {
      throw new TokenlessServiceError(
        "A complete self-declared business profile is required before operator verification.",
        409,
        "business_profile_required",
      );
    }
    await client.query(
      `UPDATE tokenless_workspace_governance SET
         trader_status='verified',
         trader_verification_method=$1,
         trader_verification_reference_hash=$2,
         trader_verified_at=$3,
         trader_verification_expires_at=$4,
         trader_verified_by=$5,
         updated_by=$5,
         updated_at=$3
       WHERE workspace_id=$6`,
      [method, evidenceHash, verifiedAt, input.verificationExpiresAt, operatorReference, input.workspaceId],
    );
    await insertBusinessVerificationEvent(client, {
      workspaceId: input.workspaceId,
      priorStatus: priorStatus as BusinessVerificationStatus,
      nextStatus: "verified",
      action: "operator_verified",
      verificationMethod: method,
      verificationReferenceHash: evidenceHash,
      verifiedAt,
      verificationExpiresAt: input.verificationExpiresAt,
      actorReference: operatorReference,
      reason,
      createdAt: verifiedAt,
    });
    const verified = await requireVerifiedBusinessCustomer({
      workspaceId: input.workspaceId,
      now: verifiedAt,
      client,
    });
    await client.query("COMMIT");
    return verified;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function insertBusinessVerificationEvent(
  client: PoolClient,
  input: {
    workspaceId: string;
    priorStatus: BusinessVerificationStatus;
    nextStatus: BusinessVerificationStatus;
    action: "profile_changed" | "operator_verified" | "operator_revoked";
    verificationMethod?: BusinessVerificationMethod | null;
    verificationReferenceHash?: string | null;
    verifiedAt?: Date | null;
    verificationExpiresAt?: Date | null;
    actorReference: string;
    reason: string;
    createdAt: Date;
  },
) {
  await client.query(
    `INSERT INTO tokenless_business_verification_events
       (event_id,workspace_id,prior_status,next_status,action,verification_method,
        verification_reference_hash,verified_at,verification_expires_at,
        actor_reference,reason,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      `bve_${randomUUID().replaceAll("-", "")}`,
      input.workspaceId,
      input.priorStatus,
      input.nextStatus,
      input.action,
      input.verificationMethod ?? null,
      input.verificationReferenceHash ?? null,
      input.verifiedAt ?? null,
      input.verificationExpiresAt ?? null,
      input.actorReference,
      input.reason,
      input.createdAt,
    ],
  );
}

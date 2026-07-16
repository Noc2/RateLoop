import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { dbPool } from "~~/lib/db";
import type { HumanReviewDerivedEconomics, HumanReviewPreparedRequest } from "~~/lib/tokenless/humanReviewApprovals";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;
type Hash = `sha256:${string}`;

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{8,160}$/u;
const ATOMIC_PATTERN = /^(0|[1-9]\d*)$/u;

export type PaidReviewAudienceBinding = {
  schemaVersion: "rateloop.paid-review-audience-binding.v1";
  profileAudience: "private_invited" | "public_network" | "hybrid";
  reviewerSource: "customer_invited" | "rateloop_network";
  audiencePolicyHash: Hash;
  assignmentReference: string;
  assignmentHash: Hash;
  selectionBatchId: string | null;
  integrityProvenanceHash: Hash | null;
};

export type PaidEligibilityPreflightReference = {
  reference: string;
  hash: Hash;
  verifiedAt: Date;
  expiresAt: Date;
};

type VerifiedPaidEligibilityPreflight = {
  preflightId: string;
  raterId: string;
  eligibilityCommitment: string;
  checkedAt: string;
  validUntil: string;
};

export type PreparePaidReviewVoucherIssuanceInput = {
  workspaceId: string;
  opportunityId: string;
  raterId: string;
  idempotencyKey: string;
  preparedRequest: HumanReviewPreparedRequest;
  preparedRequestHash: Hash;
  economics: HumanReviewDerivedEconomics;
  economicsHash: Hash;
  audienceBinding: PaidReviewAudienceBinding;
  paidEligibilityPreflight: PaidEligibilityPreflightReference;
  now?: Date;
};

export type PaidReviewEligibilitySnapshot = {
  schemaVersion: "rateloop.paid-review-eligibility-snapshot.v1";
  snapshotVersion: 1;
  workspaceId: string;
  opportunity: {
    id: string;
    sourceEvidenceHash: Hash;
    suggestionCommitment: Hash;
  };
  raterId: string;
  requestProfile: { id: string; version: number; hash: Hash };
  preparedRequestHash: Hash;
  audienceBinding: PaidReviewAudienceBinding;
  audienceBindingHash: Hash;
  economics: HumanReviewDerivedEconomics;
  economicsHash: Hash;
  paidEligibilityPreflight: {
    reference: string;
    hash: Hash;
    verifiedAt: string;
    expiresAt: string;
  };
  capturedAt: string;
};

export type PaidReviewVoucherReceipt = {
  receiptId: string;
  type: "voucher_issued" | "voucher_consumed";
  version: 1;
  hash: Hash;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type PaidReviewVoucherLifecycle = {
  issuanceId: string;
  workspaceId: string;
  opportunityId: string;
  raterId: string;
  status: "prepared" | "issued" | "consumed";
  frozen: {
    eligibilitySnapshotVersion: 1;
    eligibilitySnapshotHash: Hash;
    paidEligibilityPreflightRef: string;
    paidEligibilityPreflightHash: Hash;
    requestProfile: { id: string; version: number; hash: Hash };
    audienceBindingHash: Hash;
    economicsHash: Hash;
  };
  snapshot: PaidReviewEligibilitySnapshot;
  voucher: null | { voucherId: string; bindingHash: Hash; issuedAt: string };
  consumption: null | {
    reference: string;
    evidenceHash: Hash;
    consumedAt: string;
  };
  receipts: PaidReviewVoucherReceipt[];
  createdAt: string;
  updatedAt: string;
};

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Paid-review evidence is not canonicalizable.");
  return encoded;
}

function sha256(value: unknown): Hash {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function rowText(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function rowInteger(row: Row | undefined, key: string) {
  const value = Number(row?.[key]);
  return Number.isSafeInteger(value) ? value : null;
}

function iso(value: unknown, field: string) {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new Error(`Stored ${field} is invalid.`);
  return date.toISOString();
}

function hash(value: unknown, field: string): Hash {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) {
    throw new TokenlessServiceError(`${field} is invalid.`, 400, "invalid_paid_review_voucher_binding");
  }
  return value as Hash;
}

function requiredText(value: unknown, field: string, minimum = 1, maximum = 512) {
  if (typeof value !== "string" || value.trim() !== value || value.length < minimum || value.length > maximum) {
    throw new TokenlessServiceError(`${field} is invalid.`, 400, "invalid_paid_review_voucher_binding");
  }
  return value;
}

function positiveInteger(value: unknown, field: string, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new TokenlessServiceError(`${field} is invalid.`, 400, "invalid_paid_review_voucher_binding");
  }
  return parsed;
}

function atomic(value: unknown, field: string) {
  if (typeof value !== "string" || !ATOMIC_PATTERN.test(value)) {
    throw new TokenlessServiceError(`${field} is invalid.`, 400, "invalid_paid_review_voucher_binding");
  }
  return value;
}

function exactHash(value: unknown, expected: Hash, field: string) {
  const supplied = hash(value, field);
  if (supplied !== expected) {
    throw new TokenlessServiceError(
      `${field} does not match its canonical payload.`,
      409,
      "paid_review_voucher_binding_hash_mismatch",
    );
  }
  return supplied;
}

function validateEconomics(value: HumanReviewDerivedEconomics) {
  if (value.schemaVersion !== "rateloop.human-review-derived-economics.v1" || value.compensationMode !== "usdc") {
    throw new TokenlessServiceError(
      "Only exact USDC review economics can issue a paid voucher.",
      409,
      "paid_review_economics_required",
    );
  }
  const panelSize = positiveInteger(value.panelSize, "Economics panel size", 1, 100);
  const bountyPerSeatAtomic = atomic(value.bountyPerSeatAtomic, "Bounty per seat");
  const baseBountyAtomic = atomic(value.baseBountyAtomic, "Base bounty");
  const feeAtomic = atomic(value.feeAtomic, "Fee");
  const attemptReserveAtomic = atomic(value.attemptReserveAtomic, "Attempt reserve");
  const maximumChargeAtomic = atomic(value.maximumChargeAtomic, "Maximum charge");
  const feeBps = positiveInteger(value.feeBps, "Fee basis points", 0, 2_000);
  const expectedBase = BigInt(bountyPerSeatAtomic) * BigInt(panelSize);
  const expectedFee = (expectedBase * BigInt(feeBps)) / 10_000n;
  if (
    BigInt(bountyPerSeatAtomic) === 0n ||
    BigInt(baseBountyAtomic) !== expectedBase ||
    BigInt(feeAtomic) !== expectedFee ||
    BigInt(maximumChargeAtomic) !== expectedBase + expectedFee + BigInt(attemptReserveAtomic)
  ) {
    throw new TokenlessServiceError(
      "Paid-review economics are internally inconsistent.",
      409,
      "paid_review_economics_mismatch",
    );
  }
  return value;
}

function validateAudienceBinding(value: PaidReviewAudienceBinding) {
  if (
    value.schemaVersion !== "rateloop.paid-review-audience-binding.v1" ||
    !["private_invited", "public_network", "hybrid"].includes(value.profileAudience) ||
    !["customer_invited", "rateloop_network"].includes(value.reviewerSource)
  ) {
    throw new TokenlessServiceError(
      "Paid-review audience binding is invalid.",
      400,
      "invalid_paid_review_voucher_binding",
    );
  }
  hash(value.audiencePolicyHash, "Audience policy hash");
  requiredText(value.assignmentReference, "Assignment reference", 8);
  hash(value.assignmentHash, "Assignment hash");
  if (value.reviewerSource === "rateloop_network") {
    requiredText(value.selectionBatchId, "Selection batch ID", 8, 256);
    hash(value.integrityProvenanceHash, "Integrity provenance hash");
    if (value.profileAudience === "private_invited") {
      throw new TokenlessServiceError(
        "Network review cannot use a private-invited request profile.",
        409,
        "paid_review_audience_mismatch",
      );
    }
  } else if (
    value.profileAudience === "public_network" ||
    value.selectionBatchId !== null ||
    value.integrityProvenanceHash !== null
  ) {
    throw new TokenlessServiceError(
      "Invited review cannot claim network selection evidence.",
      409,
      "paid_review_audience_mismatch",
    );
  }
  return value;
}

function validatePreparedInput(input: PreparePaidReviewVoucherIssuanceInput, now: Date) {
  requiredText(input.workspaceId, "Workspace ID", 1, 256);
  requiredText(input.opportunityId, "Opportunity ID", 1, 256);
  requiredText(input.raterId, "Rater ID", 1, 256);
  if (!IDEMPOTENCY_PATTERN.test(input.idempotencyKey)) {
    throw new TokenlessServiceError("Voucher idempotency key is invalid.", 400, "invalid_idempotency_key");
  }
  if (
    input.preparedRequest.schemaVersion !== "rateloop.human-review-prepared-request.v1" ||
    input.preparedRequest.opportunityId !== input.opportunityId
  ) {
    throw new TokenlessServiceError(
      "Prepared request does not match the paid-review opportunity.",
      409,
      "paid_review_opportunity_mismatch",
    );
  }
  exactHash(input.preparedRequestHash, sha256(input.preparedRequest), "Prepared request hash");
  validateEconomics(input.economics);
  exactHash(input.economicsHash, sha256(input.economics), "Economics hash");
  validateAudienceBinding(input.audienceBinding);
  const preflight = input.paidEligibilityPreflight;
  requiredText(preflight.reference, "Paid eligibility preflight reference", 8);
  hash(preflight.hash, "Paid eligibility preflight hash");
  if (
    !Number.isFinite(preflight.verifiedAt.getTime()) ||
    !Number.isFinite(preflight.expiresAt.getTime()) ||
    preflight.verifiedAt > now ||
    preflight.expiresAt <= now ||
    preflight.expiresAt <= preflight.verifiedAt
  ) {
    throw new TokenlessServiceError(
      "Paid eligibility must be verified and unexpired before voucher issuance.",
      409,
      "paid_eligibility_preflight_required",
    );
  }
}

/** Convert commit 46's verified result into the narrow, immutable signer seam. */
export function paidEligibilityPreflightReference(
  preflight: VerifiedPaidEligibilityPreflight,
  expectedRaterId: string,
): PaidEligibilityPreflightReference {
  if (preflight.raterId !== expectedRaterId) {
    throw new TokenlessServiceError(
      "Paid eligibility preflight belongs to another rater.",
      409,
      "paid_eligibility_preflight_mismatch",
    );
  }
  requiredText(preflight.preflightId, "Paid eligibility preflight ID", 8, 256);
  const commitment = hash(preflight.eligibilityCommitment, "Paid eligibility commitment");
  const verifiedAt = new Date(preflight.checkedAt);
  const expiresAt = new Date(preflight.validUntil);
  if (!Number.isFinite(verifiedAt.getTime()) || !Number.isFinite(expiresAt.getTime()) || expiresAt <= verifiedAt) {
    throw new TokenlessServiceError(
      "Paid eligibility preflight validity window is invalid.",
      409,
      "paid_eligibility_preflight_mismatch",
    );
  }
  return { reference: preflight.preflightId, hash: commitment, verifiedAt, expiresAt };
}

function buildRequestHash(input: PreparePaidReviewVoucherIssuanceInput) {
  return sha256({
    workspaceId: input.workspaceId,
    opportunityId: input.opportunityId,
    raterId: input.raterId,
    preparedRequest: input.preparedRequest,
    preparedRequestHash: input.preparedRequestHash,
    economics: input.economics,
    economicsHash: input.economicsHash,
    audienceBinding: input.audienceBinding,
    paidEligibilityPreflight: {
      reference: input.paidEligibilityPreflight.reference,
      hash: input.paidEligibilityPreflight.hash,
      verifiedAt: input.paidEligibilityPreflight.verifiedAt.toISOString(),
      expiresAt: input.paidEligibilityPreflight.expiresAt.toISOString(),
    },
  });
}

function assertExactOpportunity(row: Row | undefined, input: PreparePaidReviewVoucherIssuanceInput) {
  if (!row) {
    throw new TokenlessServiceError("Paid-review opportunity not found.", 404, "review_opportunity_not_found");
  }
  const request = input.preparedRequest;
  const audience = input.audienceBinding;
  if (
    rowText(row, "decision") !== "required" ||
    !["request_ready", "pending"].includes(rowText(row, "lifecycle_state") ?? "") ||
    rowText(row, "request_profile_id") !== request.requestProfile.id ||
    rowInteger(row, "request_profile_version") !== request.requestProfile.version ||
    rowText(row, "request_profile_hash") !== request.requestProfile.hash ||
    rowText(row, "source_evidence_hash") !== request.contentCommitments.source ||
    rowText(row, "suggestion_commitment") !== request.contentCommitments.suggestion ||
    rowText(row, "profile_audience") !== request.audience.kind ||
    rowText(row, "profile_audience") !== audience.profileAudience ||
    rowText(row, "content_boundary") !== request.audience.contentBoundary ||
    rowText(row, "private_sensitivity") !== request.audience.privateSensitivity ||
    rowText(row, "private_group_id") !== request.audience.privateGroupId ||
    rowText(row, "audience_policy_hash") !== audience.audiencePolicyHash ||
    rowText(row, "compensation_mode") !== "usdc" ||
    rowInteger(row, "panel_size") !== request.panel.size ||
    rowInteger(row, "panel_size") !== input.economics.panelSize ||
    rowText(row, "bounty_per_seat_atomic") !== input.economics.bountyPerSeatAtomic ||
    rowText(row, "profile_hash") !== request.requestProfile.hash ||
    rowText(row, "configuration_status") !== "ready" ||
    row?.profile_approved_at === null ||
    row?.profile_superseded_at !== null
  ) {
    throw new TokenlessServiceError(
      "Paid voucher terms no longer match the exact frozen opportunity and request profile.",
      409,
      "paid_review_voucher_binding_conflict",
    );
  }
}

async function loadExactOpportunity(client: PoolClient, input: PreparePaidReviewVoucherIssuanceInput) {
  const result = await client.query(
    `SELECT o.decision,o.source_evidence_hash,o.suggestion_commitment,s.audience_policy_hash,
            o.request_profile_id,o.request_profile_version,o.request_profile_hash,
            l.state AS lifecycle_state,
            p.audience AS profile_audience,p.content_boundary,p.private_sensitivity,p.private_group_id,
            p.panel_size,p.compensation_mode,p.bounty_per_seat_atomic,p.profile_hash,
            p.configuration_status,p.approved_at AS profile_approved_at,p.superseded_at AS profile_superseded_at
     FROM tokenless_agent_review_opportunities o
     JOIN tokenless_agent_review_opportunity_lifecycles l
       ON l.workspace_id=o.workspace_id AND l.opportunity_id=o.opportunity_id
     JOIN tokenless_agent_evaluation_scopes s
       ON s.workspace_id=o.workspace_id AND s.scope_id=o.scope_id
     JOIN tokenless_agent_review_request_profiles p
       ON p.workspace_id=o.workspace_id AND p.profile_id=o.request_profile_id
      AND p.version=o.request_profile_version AND p.profile_hash=o.request_profile_hash
     WHERE o.workspace_id=$1 AND o.opportunity_id=$2 LIMIT 1 FOR SHARE`,
    [input.workspaceId, input.opportunityId],
  );
  const row = result.rows[0] as Row | undefined;
  assertExactOpportunity(row, input);
  return row!;
}

function buildSnapshot(input: PreparePaidReviewVoucherIssuanceInput, opportunity: Row, capturedAt: Date) {
  const audienceBindingHash = sha256(input.audienceBinding);
  const snapshot: PaidReviewEligibilitySnapshot = {
    schemaVersion: "rateloop.paid-review-eligibility-snapshot.v1",
    snapshotVersion: 1,
    workspaceId: input.workspaceId,
    opportunity: {
      id: input.opportunityId,
      sourceEvidenceHash: rowText(opportunity, "source_evidence_hash") as Hash,
      suggestionCommitment: rowText(opportunity, "suggestion_commitment") as Hash,
    },
    raterId: input.raterId,
    requestProfile: {
      id: input.preparedRequest.requestProfile.id,
      version: input.preparedRequest.requestProfile.version,
      hash: input.preparedRequest.requestProfile.hash as Hash,
    },
    preparedRequestHash: input.preparedRequestHash,
    audienceBinding: input.audienceBinding,
    audienceBindingHash,
    economics: input.economics,
    economicsHash: input.economicsHash,
    paidEligibilityPreflight: {
      reference: input.paidEligibilityPreflight.reference,
      hash: input.paidEligibilityPreflight.hash,
      verifiedAt: input.paidEligibilityPreflight.verifiedAt.toISOString(),
      expiresAt: input.paidEligibilityPreflight.expiresAt.toISOString(),
    },
    capturedAt: capturedAt.toISOString(),
  };
  return { snapshot, snapshotHash: sha256(snapshot), audienceBindingHash };
}

async function issuanceProjection(client: PoolClient, issuanceId: string): Promise<PaidReviewVoucherLifecycle> {
  const result = await client.query(
    `SELECT i.*,s.snapshot_json,s.verified_at AS snapshot_verified_at,s.expires_at AS snapshot_expires_at
     FROM tokenless_paid_review_voucher_issuances i
     JOIN tokenless_paid_review_eligibility_snapshots s
       ON s.snapshot_id=i.snapshot_id AND s.snapshot_version=i.snapshot_version AND s.snapshot_hash=i.snapshot_hash
     WHERE i.issuance_id=$1 LIMIT 1`,
    [issuanceId],
  );
  const row = result.rows[0] as Row | undefined;
  if (!row) throw new TokenlessServiceError("Paid voucher issuance not found.", 404, "paid_voucher_issuance_not_found");
  let snapshot: PaidReviewEligibilitySnapshot;
  try {
    snapshot = JSON.parse(String(row.snapshot_json)) as PaidReviewEligibilitySnapshot;
  } catch {
    throw new Error("Stored paid-review eligibility snapshot is invalid.");
  }
  const snapshotHash = hash(row.snapshot_hash, "Stored eligibility snapshot hash");
  if (
    sha256(snapshot) !== snapshotHash ||
    snapshot.schemaVersion !== "rateloop.paid-review-eligibility-snapshot.v1" ||
    snapshot.snapshotVersion !== 1 ||
    snapshot.workspaceId !== rowText(row, "workspace_id") ||
    snapshot.opportunity.id !== rowText(row, "opportunity_id") ||
    snapshot.raterId !== rowText(row, "rater_id") ||
    snapshot.requestProfile.id !== rowText(row, "request_profile_id") ||
    snapshot.requestProfile.version !== rowInteger(row, "request_profile_version") ||
    snapshot.requestProfile.hash !== rowText(row, "request_profile_hash") ||
    snapshot.audienceBindingHash !== rowText(row, "audience_binding_hash") ||
    snapshot.economicsHash !== rowText(row, "economics_hash") ||
    snapshot.paidEligibilityPreflight.reference !== rowText(row, "paid_eligibility_preflight_ref") ||
    snapshot.paidEligibilityPreflight.hash !== rowText(row, "paid_eligibility_preflight_hash")
  ) {
    throw new Error("Stored paid-review eligibility snapshot does not match its immutable bindings.");
  }
  const receiptResult = await client.query(
    `SELECT receipt_id,receipt_type,receipt_version,receipt_json,receipt_hash,created_at
     FROM tokenless_paid_review_voucher_receipts WHERE issuance_id=$1 ORDER BY created_at ASC,receipt_type ASC`,
    [issuanceId],
  );
  const receipts = receiptResult.rows.map(value => {
    const receiptRow = value as Row;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(String(receiptRow.receipt_json)) as Record<string, unknown>;
    } catch {
      throw new Error("Stored paid-review voucher receipt is invalid.");
    }
    const receiptHash = hash(receiptRow.receipt_hash, "Stored receipt hash");
    if (sha256(payload) !== receiptHash || rowInteger(receiptRow, "receipt_version") !== 1) {
      throw new Error("Stored paid-review voucher receipt does not match its hash.");
    }
    return {
      receiptId: rowText(receiptRow, "receipt_id")!,
      type: rowText(receiptRow, "receipt_type") as PaidReviewVoucherReceipt["type"],
      version: 1 as const,
      hash: receiptHash,
      payload,
      createdAt: iso(receiptRow.created_at, "receipt creation time"),
    };
  });
  const status = rowText(row, "status") as PaidReviewVoucherLifecycle["status"];
  return {
    issuanceId,
    workspaceId: rowText(row, "workspace_id")!,
    opportunityId: rowText(row, "opportunity_id")!,
    raterId: rowText(row, "rater_id")!,
    status,
    frozen: {
      eligibilitySnapshotVersion: 1,
      eligibilitySnapshotHash: snapshotHash,
      paidEligibilityPreflightRef: rowText(row, "paid_eligibility_preflight_ref")!,
      paidEligibilityPreflightHash: hash(row.paid_eligibility_preflight_hash, "Stored preflight hash"),
      requestProfile: {
        id: rowText(row, "request_profile_id")!,
        version: rowInteger(row, "request_profile_version")!,
        hash: hash(row.request_profile_hash, "Stored request profile hash"),
      },
      audienceBindingHash: hash(row.audience_binding_hash, "Stored audience binding hash"),
      economicsHash: hash(row.economics_hash, "Stored economics hash"),
    },
    snapshot,
    voucher:
      status === "prepared"
        ? null
        : {
            voucherId: rowText(row, "voucher_id")!,
            bindingHash: hash(row.voucher_binding_hash, "Stored voucher binding hash"),
            issuedAt: iso(row.issued_at, "voucher issue time"),
          },
    consumption:
      status !== "consumed"
        ? null
        : {
            reference: rowText(row, "consumption_reference")!,
            evidenceHash: hash(row.consumption_evidence_hash, "Stored consumption evidence hash"),
            consumedAt: iso(row.consumed_at, "voucher consumption time"),
          },
    receipts,
    createdAt: iso(row.created_at, "issuance creation time"),
    updatedAt: iso(row.updated_at, "issuance update time"),
  };
}

async function replayPreparedIssuance(raterId: string, idempotencyKey: string, requestHash: Hash) {
  const client = await dbPool.connect();
  try {
    const result = await client.query(
      `SELECT issuance_id,request_hash FROM tokenless_paid_review_voucher_issuances
       WHERE rater_id=$1 AND request_idempotency_key=$2 LIMIT 1`,
      [raterId, idempotencyKey],
    );
    const row = result.rows[0] as Row | undefined;
    if (row && rowText(row, "request_hash") === requestHash) {
      return issuanceProjection(client, rowText(row, "issuance_id")!);
    }
    throw new TokenlessServiceError(
      "Voucher idempotency key belongs to different immutable terms.",
      409,
      "paid_voucher_issuance_conflict",
    );
  } finally {
    client.release();
  }
}

/**
 * Adapter seam between the paid-eligibility preflight and a voucher signer.
 * The caller must persist this immutable preparation before asking any signer
 * to issue a voucher, then attach the issued voucher with
 * completePaidReviewVoucherIssuance.
 */
export async function preparePaidReviewVoucherIssuance(input: PreparePaidReviewVoucherIssuanceInput) {
  const now = input.now ?? new Date();
  validatePreparedInput(input, now);
  const requestHash = buildRequestHash(input);
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const previous = await client.query(
      `SELECT issuance_id,request_hash FROM tokenless_paid_review_voucher_issuances
       WHERE rater_id=$1 AND request_idempotency_key=$2 LIMIT 1 FOR UPDATE`,
      [input.raterId, input.idempotencyKey],
    );
    const previousRow = previous.rows[0] as Row | undefined;
    if (previousRow) {
      if (rowText(previousRow, "request_hash") !== requestHash) {
        throw new TokenlessServiceError(
          "Voucher idempotency key belongs to different immutable terms.",
          409,
          "paid_voucher_issuance_conflict",
        );
      }
      await client.query("COMMIT");
      return issuanceProjection(client, rowText(previousRow, "issuance_id")!);
    }
    const opportunity = await loadExactOpportunity(client, input);
    const { snapshot, snapshotHash, audienceBindingHash } = buildSnapshot(input, opportunity, now);
    const snapshotId = `pes_${randomUUID().replaceAll("-", "")}`;
    const issuanceId = `pvi_${randomUUID().replaceAll("-", "")}`;
    await client.query(
      `INSERT INTO tokenless_paid_review_eligibility_snapshots
       (snapshot_id,snapshot_version,workspace_id,opportunity_id,rater_id,
        request_profile_id,request_profile_version,request_profile_hash,audience_binding_hash,economics_hash,
        paid_eligibility_preflight_ref,paid_eligibility_preflight_hash,snapshot_json,snapshot_hash,
        verified_at,expires_at,created_at)
       VALUES ($1,1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        snapshotId,
        input.workspaceId,
        input.opportunityId,
        input.raterId,
        input.preparedRequest.requestProfile.id,
        input.preparedRequest.requestProfile.version,
        input.preparedRequest.requestProfile.hash,
        audienceBindingHash,
        input.economicsHash,
        input.paidEligibilityPreflight.reference,
        input.paidEligibilityPreflight.hash,
        canonicalJson(snapshot),
        snapshotHash,
        input.paidEligibilityPreflight.verifiedAt,
        input.paidEligibilityPreflight.expiresAt,
        now,
      ],
    );
    await client.query(
      `INSERT INTO tokenless_paid_review_voucher_issuances
       (issuance_id,workspace_id,opportunity_id,rater_id,request_idempotency_key,request_hash,
        snapshot_id,snapshot_version,snapshot_hash,request_profile_id,request_profile_version,request_profile_hash,
        audience_binding_hash,economics_hash,paid_eligibility_preflight_ref,paid_eligibility_preflight_hash,
        status,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,$9,$10,$11,$12,$13,$14,$15,'prepared',$16,$16)`,
      [
        issuanceId,
        input.workspaceId,
        input.opportunityId,
        input.raterId,
        input.idempotencyKey,
        requestHash,
        snapshotId,
        snapshotHash,
        input.preparedRequest.requestProfile.id,
        input.preparedRequest.requestProfile.version,
        input.preparedRequest.requestProfile.hash,
        audienceBindingHash,
        input.economicsHash,
        input.paidEligibilityPreflight.reference,
        input.paidEligibilityPreflight.hash,
        now,
      ],
    );
    await client.query("COMMIT");
    return issuanceProjection(client, issuanceId);
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") {
      return replayPreparedIssuance(input.raterId, input.idempotencyKey, requestHash);
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function completePaidReviewVoucherIssuance(input: {
  issuanceId: string;
  voucherId: string;
  issuedAt?: Date;
}) {
  requiredText(input.issuanceId, "Issuance ID", 8, 256);
  requiredText(input.voucherId, "Voucher ID", 8, 256);
  const issuedAt = input.issuedAt ?? new Date();
  if (!Number.isFinite(issuedAt.getTime())) {
    throw new TokenlessServiceError("Voucher issue time is invalid.", 400, "invalid_paid_review_voucher_binding");
  }
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT i.*,v.rater_id AS voucher_rater_id,v.voucher_json,v.voucher_signature,v.status AS voucher_status
       FROM tokenless_paid_review_voucher_issuances i
       LEFT JOIN tokenless_paid_vouchers v ON v.voucher_id=$2
       WHERE i.issuance_id=$1 LIMIT 1 FOR UPDATE`,
      [input.issuanceId, input.voucherId],
    );
    const row = result.rows[0] as Row | undefined;
    if (!row)
      throw new TokenlessServiceError("Paid voucher issuance not found.", 404, "paid_voucher_issuance_not_found");
    if (rowText(row, "status") !== "prepared") {
      if (rowText(row, "voucher_id") !== input.voucherId) {
        throw new TokenlessServiceError(
          "Prepared issuance is already bound to another voucher.",
          409,
          "paid_voucher_issuance_conflict",
        );
      }
      await client.query("COMMIT");
      return issuanceProjection(client, input.issuanceId);
    }
    if (
      rowText(row, "voucher_rater_id") !== rowText(row, "rater_id") ||
      rowText(row, "voucher_status") !== "issued" ||
      !rowText(row, "voucher_json") ||
      !rowText(row, "voucher_signature")
    ) {
      throw new TokenlessServiceError(
        "Voucher does not match the prepared paid-review issuance.",
        409,
        "paid_voucher_issuance_conflict",
      );
    }
    const voucherBindingHash = sha256({
      issuanceId: input.issuanceId,
      voucherId: input.voucherId,
      voucher: JSON.parse(rowText(row, "voucher_json")!),
      voucherSignature: rowText(row, "voucher_signature"),
      eligibilitySnapshot: {
        version: rowInteger(row, "snapshot_version"),
        hash: rowText(row, "snapshot_hash"),
      },
      paidEligibilityPreflight: {
        reference: rowText(row, "paid_eligibility_preflight_ref"),
        hash: rowText(row, "paid_eligibility_preflight_hash"),
      },
      requestProfile: {
        id: rowText(row, "request_profile_id"),
        version: rowInteger(row, "request_profile_version"),
        hash: rowText(row, "request_profile_hash"),
      },
      audienceBindingHash: rowText(row, "audience_binding_hash"),
      economicsHash: rowText(row, "economics_hash"),
    });
    const receipt = {
      schemaVersion: "rateloop.paid-review-voucher-receipt.v1",
      receiptType: "voucher_issued",
      issuanceId: input.issuanceId,
      workspaceId: rowText(row, "workspace_id"),
      opportunityId: rowText(row, "opportunity_id"),
      raterId: rowText(row, "rater_id"),
      voucherId: input.voucherId,
      voucherBindingHash,
      eligibilitySnapshot: { version: rowInteger(row, "snapshot_version"), hash: rowText(row, "snapshot_hash") },
      paidEligibilityPreflight: {
        reference: rowText(row, "paid_eligibility_preflight_ref"),
        hash: rowText(row, "paid_eligibility_preflight_hash"),
      },
      requestProfile: {
        id: rowText(row, "request_profile_id"),
        version: rowInteger(row, "request_profile_version"),
        hash: rowText(row, "request_profile_hash"),
      },
      audienceBindingHash: rowText(row, "audience_binding_hash"),
      economicsHash: rowText(row, "economics_hash"),
      issuedAt: issuedAt.toISOString(),
    };
    await client.query(
      `UPDATE tokenless_paid_review_voucher_issuances
       SET voucher_id=$1,voucher_binding_hash=$2,status='issued',issued_at=$3,updated_at=$3
       WHERE issuance_id=$4 AND status='prepared'`,
      [input.voucherId, voucherBindingHash, issuedAt, input.issuanceId],
    );
    await client.query(
      `INSERT INTO tokenless_paid_review_voucher_receipts
       (receipt_id,issuance_id,receipt_type,receipt_version,receipt_json,receipt_hash,created_at)
       VALUES ($1,$2,'voucher_issued',1,$3,$4,$5)`,
      [`pvr_${randomUUID().replaceAll("-", "")}`, input.issuanceId, canonicalJson(receipt), sha256(receipt), issuedAt],
    );
    await client.query("COMMIT");
    return issuanceProjection(client, input.issuanceId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function consumePaidReviewVoucher(input: {
  issuanceId: string;
  idempotencyKey: string;
  consumptionReference: string;
  consumptionEvidenceHash: Hash;
  consumedAt?: Date;
}) {
  requiredText(input.issuanceId, "Issuance ID", 8, 256);
  if (!IDEMPOTENCY_PATTERN.test(input.idempotencyKey)) {
    throw new TokenlessServiceError("Consumption idempotency key is invalid.", 400, "invalid_idempotency_key");
  }
  requiredText(input.consumptionReference, "Consumption reference", 8);
  hash(input.consumptionEvidenceHash, "Consumption evidence hash");
  const consumedAt = input.consumedAt ?? new Date();
  if (!Number.isFinite(consumedAt.getTime())) {
    throw new TokenlessServiceError("Voucher consumption time is invalid.", 400, "invalid_paid_review_voucher_binding");
  }
  const requestHash = sha256({
    issuanceId: input.issuanceId,
    consumptionReference: input.consumptionReference,
    consumptionEvidenceHash: input.consumptionEvidenceHash,
  });
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT * FROM tokenless_paid_review_voucher_issuances WHERE issuance_id=$1 LIMIT 1 FOR UPDATE`,
      [input.issuanceId],
    );
    const row = result.rows[0] as Row | undefined;
    if (!row)
      throw new TokenlessServiceError("Paid voucher issuance not found.", 404, "paid_voucher_issuance_not_found");
    if (rowText(row, "status") === "consumed") {
      if (
        rowText(row, "consumption_idempotency_key") !== input.idempotencyKey ||
        rowText(row, "consumption_request_hash") !== requestHash ||
        rowText(row, "consumption_reference") !== input.consumptionReference ||
        rowText(row, "consumption_evidence_hash") !== input.consumptionEvidenceHash
      ) {
        throw new TokenlessServiceError(
          "Voucher was already consumed by different evidence.",
          409,
          "paid_voucher_consumption_conflict",
        );
      }
      await client.query("COMMIT");
      return issuanceProjection(client, input.issuanceId);
    }
    if (rowText(row, "status") !== "issued") {
      throw new TokenlessServiceError(
        "Voucher must be issued before it can be consumed.",
        409,
        "paid_voucher_not_issued",
      );
    }
    const receipt = {
      schemaVersion: "rateloop.paid-review-voucher-receipt.v1",
      receiptType: "voucher_consumed",
      issuanceId: input.issuanceId,
      workspaceId: rowText(row, "workspace_id"),
      opportunityId: rowText(row, "opportunity_id"),
      raterId: rowText(row, "rater_id"),
      voucherId: rowText(row, "voucher_id"),
      voucherBindingHash: rowText(row, "voucher_binding_hash"),
      eligibilitySnapshot: { version: rowInteger(row, "snapshot_version"), hash: rowText(row, "snapshot_hash") },
      paidEligibilityPreflight: {
        reference: rowText(row, "paid_eligibility_preflight_ref"),
        hash: rowText(row, "paid_eligibility_preflight_hash"),
      },
      requestProfile: {
        id: rowText(row, "request_profile_id"),
        version: rowInteger(row, "request_profile_version"),
        hash: rowText(row, "request_profile_hash"),
      },
      audienceBindingHash: rowText(row, "audience_binding_hash"),
      economicsHash: rowText(row, "economics_hash"),
      consumption: {
        reference: input.consumptionReference,
        evidenceHash: input.consumptionEvidenceHash,
      },
      consumedAt: consumedAt.toISOString(),
    };
    await client.query(
      `UPDATE tokenless_paid_review_voucher_issuances
       SET status='consumed',consumption_idempotency_key=$1,consumption_request_hash=$2,
           consumption_reference=$3,consumption_evidence_hash=$4,consumed_at=$5,updated_at=$5
       WHERE issuance_id=$6 AND status='issued'`,
      [
        input.idempotencyKey,
        requestHash,
        input.consumptionReference,
        input.consumptionEvidenceHash,
        consumedAt,
        input.issuanceId,
      ],
    );
    await client.query(
      `INSERT INTO tokenless_paid_review_voucher_receipts
       (receipt_id,issuance_id,receipt_type,receipt_version,receipt_json,receipt_hash,created_at)
       VALUES ($1,$2,'voucher_consumed',1,$3,$4,$5)`,
      [
        `pvr_${randomUUID().replaceAll("-", "")}`,
        input.issuanceId,
        canonicalJson(receipt),
        sha256(receipt),
        consumedAt,
      ],
    );
    await client.query("COMMIT");
    return issuanceProjection(client, input.issuanceId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getPaidReviewVoucherLifecycle(issuanceId: string) {
  requiredText(issuanceId, "Issuance ID", 8, 256);
  const client = await dbPool.connect();
  try {
    return issuanceProjection(client, issuanceId);
  } finally {
    client.release();
  }
}

export const __paidReviewVoucherReceiptTestUtils = {
  canonicalJson,
  sha256,
  validatePreparedInput,
  validateEconomics,
  validateAudienceBinding,
  buildRequestHash,
};

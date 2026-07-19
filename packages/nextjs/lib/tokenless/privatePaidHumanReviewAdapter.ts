import { createHash } from "node:crypto";
import "server-only";
import { getAddress } from "viem";
import { isRateLoopPrincipalId } from "~~/lib/auth/accountSubject";
import { dbPool } from "~~/lib/db";
import type {
  HumanReviewDerivedEconomics,
  HumanReviewPreparedRequest,
} from "~~/lib/tokenless/humanReviewRequestPreparation";
import type {
  PaidReviewEligibilityPreflight,
  PaidReviewerBinding,
} from "~~/lib/tokenless/paidReviewEligibilityPreflight";
import { requirePaidReviewEligibility } from "~~/lib/tokenless/paidReviewEligibilityPreflight";
import {
  type PaidReviewVoucherLifecycle,
  getPaidReviewVoucherLifecycle,
  preparePaidReviewVoucherIssuance,
} from "~~/lib/tokenless/paidReviewVoucherReceipts";
import {
  acceptPrivateUnpaidReviewAssignment,
  requestPrivatePaidReviewAssignments,
} from "~~/lib/tokenless/privateUnpaidReviewAdapter";
import type { ProductPrincipal } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;
type Hash = `sha256:${string}`;
type PrivatePaidPrincipal = Extract<ProductPrincipal, { kind: "api_key" }>;
type PrivatePaidDelivery = Awaited<ReturnType<typeof requestPrivatePaidReviewAssignments>>;

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const ATOMIC_PATTERN = /^(0|[1-9][0-9]*)$/u;

export type PrivatePaidHumanReviewRequest = {
  principal: PrivatePaidPrincipal;
  integrationId: string;
  opportunityId: string;
  privateReviewId: string;
  projectId: string;
  cohortId: string;
  privateGroup: { id: string; policyVersion: number; policyHash: Hash };
  reviewers: readonly PaidReviewerBinding[];
  audiencePolicyHash: Hash;
  publishingPolicy: { id: string; version: number };
  preparedRequest: HumanReviewPreparedRequest;
  preparedRequestHash: Hash;
  economics: HumanReviewDerivedEconomics;
  economicsHash: Hash;
  now?: Date;
};

export type PrivatePaidFundingReservation = {
  schemaVersion: "rateloop.private-paid-funding-reservation.v1";
  idempotencyKey: string;
  prepaidReservationId: string;
  policyReservationId: string;
  amountAtomic: string;
  status: "reserved";
  replayed: boolean;
};

export type PrivatePaidVoucherPreparation = {
  assignmentId: string;
  reviewerAccountAddress: string;
  issuance: PaidReviewVoucherLifecycle;
};

export type PrivatePaidHumanReviewDelivery = {
  schemaVersion: "rateloop.private-paid-human-review.v1";
  opportunityId: string;
  privateReviewId: string;
  lane: "private_invited_paid";
  funding: PrivatePaidFundingReservation & { operationReference: string };
  encryptedDelivery: PrivatePaidDelivery;
  vouchers: PrivatePaidVoucherPreparation[];
  acceptedWorkLiability: "reserved_until_assignment_acceptance";
};

export type PrivatePaidAdapterDependencies = {
  requireEligibility: (principalId: string, now: Date) => Promise<PaidReviewEligibilityPreflight>;
  reserveFunding: (input: PrivatePaidHumanReviewRequest, now: Date) => Promise<PrivatePaidFundingReservation>;
  assignEncrypted: typeof requestPrivatePaidReviewAssignments;
  bindFunding: (input: {
    reservation: PrivatePaidFundingReservation;
    deliveryId: string;
    opportunityId: string;
    now: Date;
  }) => Promise<string>;
  prepareVoucher: typeof preparePaidReviewVoucherIssuance;
};

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function bool(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === true || value === "t" || value === 1;
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
  if (encoded === undefined) throw new Error("Private-paid value is not canonicalizable.");
  return encoded;
}

function sha256(value: unknown): Hash {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function parseStrings(value: unknown, field: string) {
  try {
    const parsed = JSON.parse(String(value)) as unknown;
    if (!Array.isArray(parsed) || parsed.some(entry => typeof entry !== "string")) throw new Error();
    return [...new Set(parsed)].sort();
  } catch {
    throw new Error(`Stored ${field} is invalid.`);
  }
}

function exactAtomic(value: unknown, field: string) {
  if (typeof value !== "string" || !ATOMIC_PATTERN.test(value)) {
    throw new TokenlessServiceError(`${field} is invalid.`, 500, "private_paid_economics_invalid");
  }
  return BigInt(value);
}

function normalizePaidReviewers(reviewers: readonly PaidReviewerBinding[]) {
  const normalized = reviewers.map(reviewer => {
    let payoutAccount: string;
    try {
      payoutAccount = getAddress(reviewer.payoutAccount).toLowerCase();
    } catch {
      throw new TokenlessServiceError(
        "A paid reviewer payout account is invalid.",
        409,
        "private_paid_review_binding_conflict",
      );
    }
    if (!isRateLoopPrincipalId(reviewer.principalId)) {
      throw new TokenlessServiceError(
        "A paid reviewer principal is invalid.",
        409,
        "private_paid_review_binding_conflict",
      );
    }
    return { principalId: reviewer.principalId, payoutAccount };
  });
  if (
    new Set(normalized.map(value => value.principalId)).size !== normalized.length ||
    new Set(normalized.map(value => value.payoutAccount)).size !== normalized.length
  ) {
    throw new TokenlessServiceError(
      "Paid reviewers must have unique principals and payout accounts.",
      409,
      "private_paid_review_binding_conflict",
    );
  }
  return normalized.sort((left, right) => left.payoutAccount.localeCompare(right.payoutAccount));
}

function assertExactRequest(input: PrivatePaidHumanReviewRequest, now: Date) {
  if (
    !Number.isFinite(now.getTime()) ||
    input.principal.workspaceId.length === 0 ||
    input.principal.apiKeyId.length === 0 ||
    input.preparedRequest.schemaVersion !== "rateloop.human-review-prepared-request.v1" ||
    input.preparedRequest.opportunityId !== input.opportunityId ||
    input.preparedRequest.audience.kind !== "private_invited" ||
    input.preparedRequest.audience.contentBoundary !== "private_workspace" ||
    input.preparedRequest.audience.privateGroupId !== input.privateGroup.id ||
    input.economics.schemaVersion !== "rateloop.human-review-derived-economics.v1" ||
    input.economics.compensationMode !== "usdc" ||
    input.economics.panelSize !== input.reviewers.length ||
    input.reviewers.length === 0 ||
    !HASH_PATTERN.test(input.preparedRequestHash) ||
    !HASH_PATTERN.test(input.economicsHash) ||
    !HASH_PATTERN.test(input.audiencePolicyHash) ||
    !HASH_PATTERN.test(input.privateGroup.policyHash) ||
    sha256(input.preparedRequest) !== input.preparedRequestHash ||
    sha256(input.economics) !== input.economicsHash
  ) {
    throw new TokenlessServiceError(
      "Private paid review requires one exact frozen private profile, audience, economics, and reviewer set.",
      409,
      "private_paid_review_binding_conflict",
    );
  }
  const base = exactAtomic(input.economics.baseBountyAtomic, "Base bounty");
  const fee = exactAtomic(input.economics.feeAtomic, "Fee");
  const reserve = exactAtomic(input.economics.attemptReserveAtomic, "Attempt reserve");
  const total = exactAtomic(input.economics.maximumChargeAtomic, "Maximum charge");
  const perSeat = exactAtomic(input.economics.bountyPerSeatAtomic, "Bounty per seat");
  if (perSeat === 0n || base !== perSeat * BigInt(input.economics.panelSize) || total !== base + fee + reserve) {
    throw new TokenlessServiceError(
      "Private paid review economics are inconsistent.",
      409,
      "private_paid_economics_invalid",
    );
  }
}

function fundingKey(input: PrivatePaidHumanReviewRequest) {
  const digest = sha256({
    schemaVersion: "rateloop.private-paid-funding-key.v1",
    workspaceId: input.principal.workspaceId,
    integrationId: input.integrationId,
    opportunityId: input.opportunityId,
    privateReviewId: input.privateReviewId,
    projectId: input.projectId,
    cohortId: input.cohortId,
    privateGroup: input.privateGroup,
    reviewers: normalizePaidReviewers(input.reviewers),
    preparedRequestHash: input.preparedRequestHash,
    economicsHash: input.economicsHash,
    audiencePolicyHash: input.audiencePolicyHash,
    publishingPolicy: input.publishingPolicy,
  });
  return `private-paid:${digest.slice("sha256:".length)}`;
}

function deterministicId(prefix: string, value: unknown) {
  return `${prefix}_${sha256(value).slice("sha256:".length, "sha256:".length + 40)}`;
}

async function reservePrivatePaidFunding(
  input: PrivatePaidHumanReviewRequest,
  now: Date,
): Promise<PrivatePaidFundingReservation> {
  const idempotencyKey = fundingKey(input);
  const amountAtomic = input.economics.maximumChargeAtomic;
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const policyResult = await client.query(
      `SELECT p.*,k.revoked_at AS key_revoked_at,k.expires_at AS key_expires_at,k.policy_id AS key_policy_id
       FROM tokenless_agent_publishing_policies p
       JOIN tokenless_workspace_api_keys k ON k.key_id=$1 AND k.workspace_id=p.workspace_id
       WHERE p.workspace_id=$2 AND p.policy_id=$3 LIMIT 1 FOR UPDATE`,
      [input.principal.apiKeyId, input.principal.workspaceId, input.publishingPolicy.id],
    );
    const policy = policyResult.rows[0] as Row | undefined;
    const policyExpiresAt = policy?.expires_at ? new Date(String(policy.expires_at)) : null;
    const keyExpiresAt = policy?.key_expires_at ? new Date(String(policy.key_expires_at)) : null;
    const allowedPaymentModes = parseStrings(policy?.allowed_payment_modes_json, "allowed payment modes");
    const allowedReviewers = parseStrings(policy?.allowed_reviewer_sources_json, "allowed reviewer sources");
    const allowedProjects = parseStrings(policy?.allowed_project_ids_json, "allowed project IDs");
    const allowedClassifications = parseStrings(
      policy?.allowed_data_classifications_json,
      "allowed data classifications",
    );
    if (
      !policy ||
      !bool(policy, "enabled") ||
      policy.revoked_at ||
      policy.key_revoked_at ||
      Number(policy.version) !== input.publishingPolicy.version ||
      text(policy, "key_policy_id") !== input.publishingPolicy.id ||
      new Date(String(policy.effective_at)) > now ||
      (policyExpiresAt !== null && policyExpiresAt <= now) ||
      (keyExpiresAt !== null && keyExpiresAt <= now) ||
      !allowedPaymentModes.includes("prepaid") ||
      !allowedReviewers.includes("customer_invited") ||
      (allowedProjects.length > 0 && !allowedProjects.includes(input.projectId)) ||
      (allowedClassifications.length > 0 &&
        !allowedClassifications.includes(input.preparedRequest.audience.privateSensitivity!)) ||
      BigInt(amountAtomic) > BigInt(text(policy, "max_panel_atomic") ?? "-1") ||
      BigInt(input.economics.baseBountyAtomic) > BigInt(text(policy, "max_bounty_atomic") ?? "-1") ||
      BigInt(input.economics.attemptReserveAtomic) > BigInt(text(policy, "max_attempt_reserve_atomic") ?? "-1") ||
      input.economics.feeBps > Number(policy.max_fee_bps) ||
      input.economics.panelSize > Number(policy.max_panel_size)
    ) {
      throw new TokenlessServiceError(
        "The private paid request is outside the exact active publishing grant.",
        403,
        "private_paid_policy_denied",
      );
    }
    const existingFunding = await client.query(
      `SELECT reservation_id,amount_atomic,status,operation_key FROM tokenless_prepaid_reservations
       WHERE workspace_id=$1 AND idempotency_key=$2 LIMIT 1 FOR UPDATE`,
      [input.principal.workspaceId, idempotencyKey],
    );
    const existingPolicy = await client.query(
      `SELECT reservation_id,amount_atomic,status,operation_key,policy_version,payment_mode
       FROM tokenless_agent_policy_budget_reservations
       WHERE policy_id=$1 AND idempotency_key=$2 LIMIT 1 FOR UPDATE`,
      [input.publishingPolicy.id, idempotencyKey],
    );
    const funding = existingFunding.rows[0] as Row | undefined;
    const policyFunding = existingPolicy.rows[0] as Row | undefined;
    if (funding || policyFunding) {
      if (
        !funding ||
        !policyFunding ||
        text(funding, "amount_atomic") !== amountAtomic ||
        text(policyFunding, "amount_atomic") !== amountAtomic ||
        text(funding, "status") !== "reserved" ||
        text(policyFunding, "status") !== "reserved" ||
        Number(policyFunding.policy_version) !== input.publishingPolicy.version ||
        text(policyFunding, "payment_mode") !== "prepaid" ||
        text(funding, "operation_key") !== text(policyFunding, "operation_key")
      ) {
        throw new TokenlessServiceError(
          "The private paid funding key belongs to different frozen terms.",
          409,
          "private_paid_funding_conflict",
        );
      }
      await client.query("COMMIT");
      return {
        schemaVersion: "rateloop.private-paid-funding-reservation.v1",
        idempotencyKey,
        prepaidReservationId: text(funding, "reservation_id")!,
        policyReservationId: text(policyFunding, "reservation_id")!,
        amountAtomic,
        status: "reserved",
        replayed: true,
      };
    }
    const startOfDay = new Date(now);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const [balanceResult, reservedResult, dayResult, monthResult] = await Promise.all([
      client.query(
        `SELECT COALESCE(SUM(delta_atomic),0) AS amount FROM tokenless_prepaid_ledger_entries
         WHERE workspace_id=$1 AND settlement_status='settled'`,
        [input.principal.workspaceId],
      ),
      client.query(
        `SELECT COALESCE(SUM(amount_atomic),0) AS amount FROM tokenless_prepaid_reservations
         WHERE workspace_id=$1 AND status='reserved'`,
        [input.principal.workspaceId],
      ),
      client.query(
        `SELECT COALESCE(SUM(amount_atomic),0) AS amount FROM tokenless_agent_policy_budget_reservations
         WHERE policy_id=$1 AND status IN ('reserved','spent') AND created_at >= $2`,
        [input.publishingPolicy.id, startOfDay],
      ),
      client.query(
        `SELECT COALESCE(SUM(amount_atomic),0) AS amount FROM tokenless_agent_policy_budget_reservations
         WHERE policy_id=$1 AND status IN ('reserved','spent') AND created_at >= $2`,
        [input.publishingPolicy.id, startOfMonth],
      ),
    ]);
    const amount = BigInt(amountAtomic);
    const balance = BigInt(text(balanceResult.rows[0] as Row | undefined, "amount") ?? "0");
    const reserved = BigInt(text(reservedResult.rows[0] as Row | undefined, "amount") ?? "0");
    const day = BigInt(text(dayResult.rows[0] as Row | undefined, "amount") ?? "0");
    const month = BigInt(text(monthResult.rows[0] as Row | undefined, "amount") ?? "0");
    if (balance - reserved < amount) {
      throw new TokenlessServiceError("Settled prepaid balance is insufficient.", 402, "insufficient_prepaid_balance");
    }
    if (day + amount > BigInt(text(policy, "max_daily_atomic")!)) {
      throw new TokenlessServiceError(
        "The delegated daily spending cap is exhausted.",
        403,
        "policy_daily_cap_exceeded",
      );
    }
    if (month + amount > BigInt(text(policy, "max_monthly_atomic")!)) {
      throw new TokenlessServiceError(
        "The delegated monthly spending cap is exhausted.",
        403,
        "policy_monthly_cap_exceeded",
      );
    }
    const prepaidReservationId = deterministicId("res", { idempotencyKey, kind: "private-paid" });
    const policyReservationId = deterministicId("agres", { idempotencyKey, kind: "private-paid" });
    await client.query(
      `INSERT INTO tokenless_prepaid_reservations
       (reservation_id,workspace_id,idempotency_key,amount_atomic,status,created_at,updated_at)
       VALUES ($1,$2,$3,$4,'reserved',$5,$5)`,
      [prepaidReservationId, input.principal.workspaceId, idempotencyKey, amountAtomic, now],
    );
    await client.query(
      `INSERT INTO tokenless_agent_policy_budget_reservations
       (reservation_id,policy_id,workspace_id,api_key_id,idempotency_key,quote_id,amount_atomic,
        payment_mode,policy_version,status,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'prepaid',$8,'reserved',$9,$9)`,
      [
        policyReservationId,
        input.publishingPolicy.id,
        input.principal.workspaceId,
        input.principal.apiKeyId,
        idempotencyKey,
        `private-paid:${input.opportunityId}`,
        amountAtomic,
        input.publishingPolicy.version,
        now,
      ],
    );
    await client.query("COMMIT");
    return {
      schemaVersion: "rateloop.private-paid-funding-reservation.v1",
      idempotencyKey,
      prepaidReservationId,
      policyReservationId,
      amountAtomic,
      status: "reserved",
      replayed: false,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function bindPrivatePaidFunding(input: {
  reservation: PrivatePaidFundingReservation;
  deliveryId: string;
  opportunityId: string;
  now: Date;
}) {
  const operationReference = `private-paid:${input.deliveryId}`;
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const prepaid = await client.query(
      `UPDATE tokenless_prepaid_reservations SET operation_key=$1,updated_at=$2
       WHERE reservation_id=$3 AND idempotency_key=$4 AND status='reserved'
         AND (operation_key IS NULL OR operation_key=$1) RETURNING operation_key`,
      [operationReference, input.now, input.reservation.prepaidReservationId, input.reservation.idempotencyKey],
    );
    const policy = await client.query(
      `UPDATE tokenless_agent_policy_budget_reservations SET operation_key=$1,updated_at=$2
       WHERE reservation_id=$3 AND idempotency_key=$4 AND status='reserved'
         AND (operation_key IS NULL OR operation_key=$1) RETURNING operation_key`,
      [operationReference, input.now, input.reservation.policyReservationId, input.reservation.idempotencyKey],
    );
    if (
      prepaid.rowCount !== 1 ||
      policy.rowCount !== 1 ||
      text(prepaid.rows[0] as Row | undefined, "operation_key") !== operationReference ||
      text(policy.rows[0] as Row | undefined, "operation_key") !== operationReference
    ) {
      throw new TokenlessServiceError(
        "Private paid funding could not be bound to the encrypted delivery.",
        409,
        "private_paid_funding_conflict",
      );
    }
    await client.query("COMMIT");
    return operationReference;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

const DEFAULT_DEPENDENCIES: PrivatePaidAdapterDependencies = {
  requireEligibility: requirePaidReviewEligibility,
  reserveFunding: reservePrivatePaidFunding,
  assignEncrypted: requestPrivatePaidReviewAssignments,
  bindFunding: bindPrivatePaidFunding,
  prepareVoucher: preparePaidReviewVoucherIssuance,
};

export function createPrivatePaidHumanReviewAdapter(
  dependencies: PrivatePaidAdapterDependencies = DEFAULT_DEPENDENCIES,
) {
  return async function requestPrivatePaidHumanReview(
    input: PrivatePaidHumanReviewRequest,
  ): Promise<PrivatePaidHumanReviewDelivery> {
    const now = input.now ?? new Date();
    assertExactRequest(input, now);
    const reviewers = normalizePaidReviewers(input.reviewers);

    // Eligibility is the first external operation. Nothing may reserve funds,
    // prepare a voucher, or assign private material until every named human passes.
    const preflights = new Map<string, PaidReviewEligibilityPreflight>();
    for (const reviewer of reviewers) {
      const preflight = await dependencies.requireEligibility(reviewer.principalId, now);
      if (
        preflight.principalId !== reviewer.principalId ||
        preflight.payoutAccount.toLowerCase() !== reviewer.payoutAccount
      ) {
        throw new TokenlessServiceError(
          "Paid eligibility does not belong to the exact invited reviewer.",
          409,
          "private_paid_eligibility_binding_conflict",
        );
      }
      preflights.set(reviewer.payoutAccount, preflight);
    }

    const funding = await dependencies.reserveFunding(input, now);
    const encryptedDelivery = await dependencies.assignEncrypted({
      principal: input.principal,
      opportunityId: input.opportunityId,
      privateReviewId: input.privateReviewId,
      reviewerAccountAddresses: reviewers.map(value => value.payoutAccount),
      now,
    });
    if (
      encryptedDelivery.schemaVersion !== "rateloop.private-paid-review-delivery.v1" ||
      encryptedDelivery.assignments.length !== reviewers.length ||
      encryptedDelivery.assignments.some(
        (assignment, index) => assignment.reviewerAccountAddress.toLowerCase() !== reviewers[index]?.payoutAccount,
      )
    ) {
      throw new TokenlessServiceError(
        "The encrypted delivery does not match the exact paid reviewer set.",
        409,
        "private_paid_assignment_conflict",
      );
    }
    const operationReference = await dependencies.bindFunding({
      reservation: funding,
      deliveryId: encryptedDelivery.deliveryId,
      opportunityId: input.opportunityId,
      now,
    });
    const vouchers: PrivatePaidVoucherPreparation[] = [];
    for (const assignment of encryptedDelivery.assignments) {
      const reviewer = assignment.reviewerAccountAddress.toLowerCase();
      const preflight = preflights.get(reviewer)!;
      const assignmentHash = sha256({
        schemaVersion: "rateloop.private-paid-assignment-binding.v1",
        assignmentId: assignment.assignmentId,
        deliveryId: encryptedDelivery.deliveryId,
        privateReviewId: encryptedDelivery.privateReviewId,
        opportunityId: input.opportunityId,
        projectId: input.projectId,
        cohortId: input.cohortId,
        privateGroup: input.privateGroup,
        reviewer: { principalId: preflight.principalId, payoutAccount: reviewer },
        membershipSnapshotHash: encryptedDelivery.membershipSnapshotHash,
        requestProfile: input.preparedRequest.requestProfile,
        preparedRequestHash: input.preparedRequestHash,
        economicsHash: input.economicsHash,
        fundingOperationReference: operationReference,
      });
      const issuance = await dependencies.prepareVoucher({
        workspaceId: input.principal.workspaceId,
        opportunityId: input.opportunityId,
        raterId: preflight.raterId,
        idempotencyKey: `private-paid-voucher:${assignmentHash.slice("sha256:".length)}`,
        preparedRequest: input.preparedRequest,
        preparedRequestHash: input.preparedRequestHash,
        economics: input.economics,
        economicsHash: input.economicsHash,
        audienceBinding: {
          schemaVersion: "rateloop.paid-review-audience-binding.v1",
          profileAudience: "private_invited",
          reviewerSource: "customer_invited",
          audiencePolicyHash: input.audiencePolicyHash,
          assignmentReference: assignment.assignmentId,
          assignmentHash,
          selectionBatchId: null,
          integrityProvenanceHash: null,
        },
        paidEligibilityPreflight: {
          reference: preflight.preflightId,
          hash: preflight.eligibilityCommitment,
          verifiedAt: new Date(preflight.checkedAt),
          expiresAt: new Date(preflight.validUntil),
        },
        now,
      });
      vouchers.push({ assignmentId: assignment.assignmentId, reviewerAccountAddress: reviewer, issuance });
    }
    return {
      schemaVersion: "rateloop.private-paid-human-review.v1",
      opportunityId: input.opportunityId,
      privateReviewId: input.privateReviewId,
      lane: "private_invited_paid",
      funding: { ...funding, operationReference },
      encryptedDelivery,
      vouchers,
      acceptedWorkLiability: "reserved_until_assignment_acceptance",
    };
  };
}

export const requestPrivatePaidHumanReview = createPrivatePaidHumanReviewAdapter();

export async function acceptPrivatePaidReviewAssignment(input: {
  assignmentId: string;
  issuanceId: string;
  principalId: string;
  payoutAccount: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const payoutAccount = getAddress(input.payoutAccount).toLowerCase();
  const preflight = await requirePaidReviewEligibility(input.principalId, now);
  const issuance = await getPaidReviewVoucherLifecycle(input.issuanceId);
  if (
    preflight.principalId !== input.principalId ||
    preflight.payoutAccount.toLowerCase() !== payoutAccount ||
    issuance.raterId !== preflight.raterId ||
    issuance.snapshot.audienceBinding.profileAudience !== "private_invited" ||
    issuance.snapshot.audienceBinding.reviewerSource !== "customer_invited" ||
    issuance.snapshot.audienceBinding.assignmentReference !== input.assignmentId ||
    issuance.status !== "prepared"
  ) {
    throw new TokenlessServiceError(
      "The accepted assignment does not match its exact invited paid voucher preparation.",
      409,
      "private_paid_assignment_conflict",
    );
  }
  const funding = await dbPool.query(
    `SELECT d.delivery_id,pr.reservation_id,pr.status,pr.operation_key,
            abr.reservation_id AS policy_reservation_id,abr.status AS policy_status,
            abr.operation_key AS policy_operation_key
     FROM tokenless_private_unpaid_review_assignments a
     JOIN tokenless_private_unpaid_review_deliveries d ON d.delivery_id=a.delivery_id
     JOIN tokenless_prepaid_reservations pr ON pr.operation_key=('private-paid:' || d.delivery_id)
     JOIN tokenless_agent_policy_budget_reservations abr ON abr.operation_key=pr.operation_key
     WHERE a.assignment_id=$1 AND a.reviewer_account_address=$2 LIMIT 1`,
    [input.assignmentId, payoutAccount],
  );
  const row = funding.rows[0] as Row | undefined;
  if (
    !row ||
    text(row, "status") !== "reserved" ||
    text(row, "policy_status") !== "reserved" ||
    text(row, "operation_key") !== text(row, "policy_operation_key")
  ) {
    throw new TokenlessServiceError(
      "Paid funding is not durably reserved for this assignment.",
      409,
      "private_paid_funding_conflict",
    );
  }
  const accepted = await acceptPrivateUnpaidReviewAssignment({
    assignmentId: input.assignmentId,
    reviewerAccountAddress: payoutAccount,
    now,
  });
  return {
    schemaVersion: "rateloop.private-paid-assignment-acceptance.v1" as const,
    ...accepted,
    issuanceId: issuance.issuanceId,
    fundingOperationReference: text(row, "operation_key")!,
    acceptedWorkLiability: "locked" as const,
  };
}

export const __privatePaidHumanReviewAdapterTestUtils = {
  assertExactRequest,
  bindPrivatePaidFunding,
  fundingKey,
  reservePrivatePaidFunding,
  sha256,
};

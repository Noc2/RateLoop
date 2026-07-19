import type { HumanAssuranceAudiencePolicy } from "@rateloop/sdk";
import { createHash } from "node:crypto";
import "server-only";
import { getAddress } from "viem";
import { isRateLoopPrincipalId } from "~~/lib/auth/accountSubject";
import { dbPool } from "~~/lib/db";
import type {
  HumanReviewDerivedEconomics,
  HumanReviewPreparedRequest,
} from "~~/lib/tokenless/humanReviewRequestPreparation";
import {
  bindPrivatePaidAssignmentSeatPreparations,
  ensurePrivatePaidAssignmentOperation,
  revalidatePrivatePaidAssignmentOperation,
} from "~~/lib/tokenless/paidAssignmentOperations";
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
  appOrigin?: string;
  integrationId: string;
  opportunityId: string;
  privateReviewId: string;
  projectId: string;
  cohortId: string;
  privateGroup: { id: string; policyVersion: number; policyHash: Hash };
  reviewers: readonly PaidReviewerBinding[];
  audiencePolicyHash: Hash;
  admissionPolicy: HumanAssuranceAudiencePolicy;
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
  status: "consumed";
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
  clock?: () => Date;
  requireEligibility: (principalId: string, now: Date) => Promise<PaidReviewEligibilityPreflight>;
  assignEncrypted: typeof requestPrivatePaidReviewAssignments;
  prepareVoucher: typeof preparePaidReviewVoucherIssuance;
  activateOperation: typeof ensurePrivatePaidAssignmentOperation;
  revalidateOperation: typeof revalidatePrivatePaidAssignmentOperation;
  bindSeats: typeof bindPrivatePaidAssignmentSeatPreparations;
};

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
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

function configuredAppOrigin(input: PrivatePaidHumanReviewRequest) {
  const raw = input.appOrigin?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim();
  try {
    const parsed = new URL(raw!);
    const origin = parsed.origin;
    if (origin !== raw!.replace(/\/$/u, "")) throw new Error();
    return origin;
  } catch {
    throw new TokenlessServiceError(
      "Private paid activation requires the canonical application origin.",
      500,
      "private_paid_app_origin_missing",
    );
  }
}

const DEFAULT_DEPENDENCIES: PrivatePaidAdapterDependencies = {
  clock: () => new Date(),
  requireEligibility: requirePaidReviewEligibility,
  assignEncrypted: requestPrivatePaidReviewAssignments,
  prepareVoucher: preparePaidReviewVoucherIssuance,
  activateOperation: ensurePrivatePaidAssignmentOperation,
  revalidateOperation: revalidatePrivatePaidAssignmentOperation,
  bindSeats: bindPrivatePaidAssignmentSeatPreparations,
};

export function createPrivatePaidHumanReviewAdapter(
  dependencies: PrivatePaidAdapterDependencies = DEFAULT_DEPENDENCIES,
) {
  const clock = dependencies.clock ?? (() => new Date());
  const liveNow = () => {
    const value = clock();
    if (!Number.isFinite(value.getTime())) {
      throw new TokenlessServiceError("The private paid review clock is invalid.", 500, "private_paid_clock_invalid");
    }
    return value;
  };
  const requireLivePreflights = (preflights: Iterable<PaidReviewEligibilityPreflight>, now: Date) => {
    for (const preflight of preflights) {
      const checkedAt = new Date(preflight.checkedAt);
      const validUntil = new Date(preflight.validUntil);
      if (
        !Number.isFinite(checkedAt.getTime()) ||
        !Number.isFinite(validUntil.getTime()) ||
        checkedAt > now ||
        validUntil <= now
      ) {
        throw new TokenlessServiceError(
          "Paid eligibility expired before private assignment preparation completed.",
          409,
          "paid_eligibility_expired",
          true,
        );
      }
    }
  };
  const requireLiveDelivery = (delivery: PrivatePaidDelivery, now: Date) => {
    const deadlines = [
      new Date(delivery.responseDeadline),
      ...delivery.assignments.map(assignment => new Date(assignment.reservationExpiresAt)),
    ];
    if (deadlines.some(deadline => !Number.isFinite(deadline.getTime()) || deadline <= now)) {
      throw new TokenlessServiceError(
        "The encrypted paid assignment expired before voucher preparation completed.",
        409,
        "private_paid_assignment_expired",
        true,
      );
    }
  };
  return async function requestPrivatePaidHumanReview(
    input: PrivatePaidHumanReviewRequest,
  ): Promise<PrivatePaidHumanReviewDelivery> {
    const startedAt = input.now ?? liveNow();
    assertExactRequest(input, startedAt);
    const reviewers = normalizePaidReviewers(input.reviewers);

    // Eligibility is the first external operation. Nothing may reserve funds,
    // prepare a voucher, or assign private material until every named human passes.
    const preflights = new Map<string, PaidReviewEligibilityPreflight>();
    for (const reviewer of reviewers) {
      const eligibilityNow = liveNow();
      const preflight = await dependencies.requireEligibility(reviewer.principalId, eligibilityNow);
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

    const activationNow = liveNow();
    requireLivePreflights(preflights.values(), activationNow);
    const activationRequest = {
      ...input,
      appOrigin: configuredAppOrigin(input),
      reviewers: reviewers.map(reviewer => {
        const preflight = preflights.get(reviewer.payoutAccount)!;
        return {
          principalId: preflight.principalId,
          raterId: preflight.raterId,
          payoutAccount: preflight.payoutAccount,
        };
      }),
      now: activationNow,
    };
    const activated = await dependencies.activateOperation(activationRequest);
    if (!activated.readyForAssignment) {
      throw new TokenlessServiceError(
        "The private paid ask is attached and waiting for its exact confirmed chain round.",
        409,
        "private_paid_round_pending",
        true,
      );
    }
    if (!activated.askOperationKey || !activated.prepaidReservationId || !activated.policyReservationId) {
      throw new TokenlessServiceError(
        "The private paid operation has no exact attached funding.",
        409,
        "private_paid_funding_conflict",
      );
    }
    const funding: PrivatePaidFundingReservation = {
      schemaVersion: "rateloop.private-paid-funding-reservation.v1",
      idempotencyKey: activated.requestIdempotencyKey,
      prepaidReservationId: activated.prepaidReservationId!,
      policyReservationId: activated.policyReservationId!,
      amountAtomic: activated.expectedAmountAtomic,
      status: "consumed",
      replayed: activated.replayed,
    };
    const assignmentNow = liveNow();
    requireLivePreflights(preflights.values(), assignmentNow);
    await dependencies.revalidateOperation({
      ...activationRequest,
      operationId: activated.operationId,
      now: assignmentNow,
    });
    const encryptedDelivery = await dependencies.assignEncrypted({
      principal: input.principal,
      opportunityId: input.opportunityId,
      privateReviewId: input.privateReviewId,
      reviewerAccountAddresses: reviewers.map(value => value.payoutAccount),
      now: assignmentNow,
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
    const operationReference = activated.askOperationKey!;
    const vouchers: PrivatePaidVoucherPreparation[] = [];
    for (const assignment of encryptedDelivery.assignments) {
      const reviewer = assignment.reviewerAccountAddress.toLowerCase();
      const preflight = preflights.get(reviewer)!;
      const voucherNow = liveNow();
      requireLivePreflights([preflight], voucherNow);
      requireLiveDelivery(encryptedDelivery, voucherNow);
      await dependencies.revalidateOperation({
        ...activationRequest,
        operationId: activated.operationId,
        now: voucherNow,
      });
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
        now: voucherNow,
      });
      vouchers.push({ assignmentId: assignment.assignmentId, reviewerAccountAddress: reviewer, issuance });
    }
    const bindNow = liveNow();
    requireLivePreflights(preflights.values(), bindNow);
    await dependencies.revalidateOperation({
      ...activationRequest,
      operationId: activated.operationId,
      now: bindNow,
    });
    requireLiveDelivery(encryptedDelivery, bindNow);
    await dependencies.bindSeats({
      operationId: activated.operationId,
      deliveryId: encryptedDelivery.deliveryId,
      seats: vouchers.map(value => {
        const preflight = preflights.get(value.reviewerAccountAddress)!;
        return {
          principalId: preflight.principalId,
          raterId: preflight.raterId,
          payoutAccount: preflight.payoutAccount,
          assignmentId: value.assignmentId,
          voucherIssuanceId: value.issuance.issuanceId,
        };
      }),
      now: bindNow,
    });
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
  const operationFunding = await dbPool.query(
    `SELECT d.delivery_id,pr.reservation_id,pr.status,pr.operation_key,
            abr.reservation_id AS policy_reservation_id,abr.status AS policy_status,
            abr.operation_key AS policy_operation_key,o.state AS paid_operation_state,
            o.operation_id,o.commit_deadline,vr.status AS voucher_round_status,
            vr.voucher_not_before,vr.voucher_deadline
     FROM tokenless_paid_assignment_seats s
     JOIN tokenless_paid_assignment_operations o ON o.operation_id=s.operation_id
     JOIN tokenless_private_unpaid_review_assignments a ON a.assignment_id=s.assignment_id
     JOIN tokenless_private_unpaid_review_deliveries d ON d.delivery_id=a.delivery_id
     JOIN tokenless_prepaid_reservations pr ON pr.reservation_id=o.prepaid_reservation_id
     JOIN tokenless_agent_policy_budget_reservations abr ON abr.reservation_id=o.policy_reservation_id
     JOIN tokenless_voucher_rounds vr
       ON vr.chain_id=o.chain_id AND vr.panel_address=o.panel_address AND vr.round_id=o.round_id
     WHERE s.assignment_id=$1 AND s.voucher_issuance_id=$2
       AND s.payout_account=$3 AND s.state='voucher_prepared' LIMIT 1`,
    [input.assignmentId, input.issuanceId, payoutAccount],
  );
  const row = operationFunding.rows[0] as Row | undefined;
  if (
    !row ||
    text(row, "status") !== "consumed" ||
    text(row, "policy_status") !== "spent" ||
    text(row, "operation_key") !== text(row, "policy_operation_key") ||
    text(row, "paid_operation_state") !== "round_bound" ||
    text(row, "voucher_round_status") !== "open" ||
    !row.voucher_not_before ||
    new Date(String(row.voucher_not_before)) > now ||
    !row.voucher_deadline ||
    new Date(String(row.voucher_deadline)) <= now ||
    new Date(String(row.commit_deadline)).getTime() !== new Date(String(row.voucher_deadline)).getTime()
  ) {
    throw new TokenlessServiceError(
      "Paid funding and its exact live chain round are not bound to this assignment.",
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
  sha256,
};

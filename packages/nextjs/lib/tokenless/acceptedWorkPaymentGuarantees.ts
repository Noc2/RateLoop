import { createHash } from "node:crypto";
import "server-only";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const ATOMIC_PATTERN = /^(0|[1-9]\d*)$/u;

export type AcceptedWorkPaymentLane = "public_paid" | "private_paid" | "hybrid" | "unpaid";
export type AcceptedWorkFailureTerminalState = "inconclusive" | "failed_terminal" | "cancelled_before_commit";

export type AcceptedWorkPaymentGuaranteeInput = {
  workspaceId: string;
  opportunityId: string;
  lane: AcceptedWorkPaymentLane;
  terminalState: AcceptedWorkFailureTerminalState;
  failureSignal: string;
  frozen: {
    requestProfileHash: string;
    fundingEvidenceHash: string;
    guaranteedCompensationMode: "off" | "usdc";
    fixedBasePerAcceptedWorkAtomic: string;
    attemptCompensationPerAcceptedWorkAtomic: string;
    fundedAtomic: string;
  };
  work: {
    publicAcceptedCount: number;
    publicPayableCount: number;
    invitedAcceptedCount: number;
    invitedPayableCount: number;
  };
};

export type AcceptedWorkPaymentGuaranteeReceipt = {
  schemaVersion: "rateloop.accepted-work-payment-guarantee.v1";
  receiptId: string;
  receiptHash: string;
  workspaceId: string;
  opportunityId: string;
  lane: AcceptedWorkPaymentLane;
  terminalState: AcceptedWorkFailureTerminalState;
  failureSignal: string;
  disposition: "not_applicable" | "refundable_zero_accepted_work" | "compensation_path_preserved" | "payable_terminal";
  work: {
    publicAcceptedCount: number;
    publicPayableCount: number;
    invitedAcceptedCount: number;
    invitedPayableCount: number;
    acceptedCount: number;
    payableCount: number;
  };
  guaranteedBase: {
    mode: "off" | "usdc";
    asset: "USDC";
    decimals: 6;
    fixedBasePerAcceptedWorkAtomic: string;
    attemptCompensationPerAcceptedWorkAtomic: string;
    fundedAtomic: string;
    preservedLiabilityAtomic: string;
    currentlyPayableAtomic: string;
    maximumRefundAtomic: string;
    claimRule: "not_applicable" | "accepted_valid_work_only";
    recipientControl: "none" | "commit_or_assignment_bound";
  };
  frozen: {
    requestProfileHash: string;
    fundingEvidenceHash: string;
  };
  noPostCommitCancellation: boolean;
  feedbackBonus: {
    includedInGuaranteedBase: false;
    maySatisfyGuaranteedBaseLiability: false;
  };
};

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Accepted-work payment evidence is not canonicalizable.");
  return encoded;
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function identifier(value: string, field: string) {
  if (typeof value !== "string" || value.trim() !== value || value.length < 1 || value.length > 256) {
    throw new TokenlessServiceError(`${field} is invalid.`, 400, "invalid_accepted_work_payment_evidence");
  }
  return value;
}

function hash(value: string, field: string) {
  if (!HASH_PATTERN.test(value)) {
    throw new TokenlessServiceError(`${field} is invalid.`, 400, "invalid_accepted_work_payment_evidence");
  }
  return value;
}

function atomic(value: string, field: string) {
  if (!ATOMIC_PATTERN.test(value)) {
    throw new TokenlessServiceError(`${field} is invalid.`, 400, "invalid_accepted_work_payment_evidence");
  }
  return BigInt(value);
}

function count(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TokenlessServiceError(`${field} is invalid.`, 400, "invalid_accepted_work_payment_evidence");
  }
  return value;
}

/**
 * Produces the canonical terminal payment projection from frozen funding and
 * accepted-work evidence. It never transfers funds: the immutable panel or an
 * assignment-bound payment adapter remains the only payer. Feedback Bonus
 * escrow is deliberately absent from every liability calculation.
 */
export function projectAcceptedWorkPaymentGuarantee(
  input: AcceptedWorkPaymentGuaranteeInput,
): AcceptedWorkPaymentGuaranteeReceipt {
  const workspaceId = identifier(input.workspaceId, "workspaceId");
  const opportunityId = identifier(input.opportunityId, "opportunityId");
  const failureSignal = identifier(input.failureSignal, "failureSignal");
  const requestProfileHash = hash(input.frozen.requestProfileHash, "Request profile hash");
  const fundingEvidenceHash = hash(input.frozen.fundingEvidenceHash, "Funding evidence hash");
  const publicAcceptedCount = count(input.work.publicAcceptedCount, "Public accepted-work count");
  const publicPayableCount = count(input.work.publicPayableCount, "Public payable-work count");
  const invitedAcceptedCount = count(input.work.invitedAcceptedCount, "Invited accepted-work count");
  const invitedPayableCount = count(input.work.invitedPayableCount, "Invited payable-work count");
  if (publicPayableCount > publicAcceptedCount || invitedPayableCount > invitedAcceptedCount) {
    throw new TokenlessServiceError(
      "Payable work cannot exceed its accepted-work evidence.",
      409,
      "accepted_work_payment_evidence_mismatch",
    );
  }
  if (
    (input.lane === "public_paid" && (invitedAcceptedCount !== 0 || invitedPayableCount !== 0)) ||
    (input.lane === "private_paid" && (publicAcceptedCount !== 0 || publicPayableCount !== 0)) ||
    (input.lane === "unpaid" &&
      (publicAcceptedCount !== 0 ||
        publicPayableCount !== 0 ||
        invitedAcceptedCount !== 0 ||
        invitedPayableCount !== 0))
  ) {
    throw new TokenlessServiceError(
      "Accepted-work evidence does not match the frozen payment lane.",
      409,
      "accepted_work_payment_lane_mismatch",
    );
  }
  const acceptedCount = publicAcceptedCount + invitedAcceptedCount;
  const payableCount = publicPayableCount + invitedPayableCount;
  if (input.terminalState === "cancelled_before_commit" && acceptedCount !== 0) {
    throw new TokenlessServiceError(
      "Accepted paid work cannot enter a pre-commit cancellation terminal.",
      409,
      "accepted_work_post_commit_cancellation",
    );
  }

  const fixedBase = atomic(input.frozen.fixedBasePerAcceptedWorkAtomic, "Fixed base per accepted work");
  const attemptCompensation = atomic(
    input.frozen.attemptCompensationPerAcceptedWorkAtomic,
    "Attempt compensation per accepted work",
  );
  const funded = atomic(input.frozen.fundedAtomic, "Frozen funding");
  if (input.frozen.guaranteedCompensationMode === "off") {
    if (
      input.lane !== "unpaid" ||
      fixedBase !== 0n ||
      attemptCompensation !== 0n ||
      funded !== 0n ||
      acceptedCount !== 0
    ) {
      throw new TokenlessServiceError(
        "Disabled guaranteed compensation must have zero base-payment evidence.",
        409,
        "accepted_work_payment_evidence_mismatch",
      );
    }
  } else if (
    input.lane === "unpaid" ||
    fixedBase <= 0n ||
    attemptCompensation !== fixedBase ||
    funded < fixedBase * BigInt(acceptedCount)
  ) {
    throw new TokenlessServiceError(
      "Frozen USDC evidence does not cover the exact accepted-work liability.",
      409,
      "accepted_work_payment_evidence_mismatch",
    );
  }

  const preservedLiability = fixedBase * BigInt(acceptedCount);
  const currentlyPayable = fixedBase * BigInt(payableCount);
  const maximumRefund = funded - preservedLiability;
  const disposition: AcceptedWorkPaymentGuaranteeReceipt["disposition"] =
    input.frozen.guaranteedCompensationMode === "off"
      ? "not_applicable"
      : acceptedCount === 0
        ? "refundable_zero_accepted_work"
        : payableCount > 0
          ? "payable_terminal"
          : "compensation_path_preserved";
  const body = {
    schemaVersion: "rateloop.accepted-work-payment-guarantee.v1" as const,
    workspaceId,
    opportunityId,
    lane: input.lane,
    terminalState: input.terminalState,
    failureSignal,
    disposition,
    work: {
      publicAcceptedCount,
      publicPayableCount,
      invitedAcceptedCount,
      invitedPayableCount,
      acceptedCount,
      payableCount,
    },
    guaranteedBase: {
      mode: input.frozen.guaranteedCompensationMode,
      asset: "USDC" as const,
      decimals: 6 as const,
      fixedBasePerAcceptedWorkAtomic: fixedBase.toString(),
      attemptCompensationPerAcceptedWorkAtomic: attemptCompensation.toString(),
      fundedAtomic: funded.toString(),
      preservedLiabilityAtomic: preservedLiability.toString(),
      currentlyPayableAtomic: currentlyPayable.toString(),
      maximumRefundAtomic: maximumRefund.toString(),
      claimRule:
        input.frozen.guaranteedCompensationMode === "off"
          ? ("not_applicable" as const)
          : ("accepted_valid_work_only" as const),
      recipientControl:
        input.frozen.guaranteedCompensationMode === "off" ? ("none" as const) : ("commit_or_assignment_bound" as const),
    },
    frozen: { requestProfileHash, fundingEvidenceHash },
    noPostCommitCancellation: acceptedCount > 0,
    feedbackBonus: {
      includedInGuaranteedBase: false as const,
      maySatisfyGuaranteedBaseLiability: false as const,
    },
  };
  const receiptHash = sha256(body);
  return {
    ...body,
    receiptId: `awpg_${receiptHash.slice("sha256:".length, "sha256:".length + 40)}`,
    receiptHash,
  };
}

export function assertResultPreservesAcceptedWorkPayment(input: {
  lane: "public_paid" | "private_paid" | "private_unpaid" | "hybrid";
  outcome: "positive" | "negative" | "inconclusive" | "failed" | "cancelled";
  responseCount: number;
  guaranteedBase: {
    mode: "off" | "usdc";
    fundedAtomic: string;
    paidAtomic: string;
    refundedAtomic: string;
  };
}) {
  const responseCount = count(input.responseCount, "Result response count");
  const funded = atomic(input.guaranteedBase.fundedAtomic, "Guaranteed-base funding");
  const paid = atomic(input.guaranteedBase.paidAtomic, "Guaranteed-base payment");
  const refunded = atomic(input.guaranteedBase.refundedAtomic, "Guaranteed-base refund");
  if (paid + refunded > funded) {
    throw new TokenlessServiceError(
      "Guaranteed-base result accounting exceeds frozen funding.",
      409,
      "accepted_work_result_payment_mismatch",
    );
  }
  if (input.guaranteedBase.mode === "off") return;
  if (responseCount > 0 && input.outcome === "cancelled") {
    throw new TokenlessServiceError(
      "A result with accepted responses cannot be cancelled.",
      409,
      "accepted_work_post_commit_cancellation",
    );
  }
  if (responseCount > 0 && refunded === funded && paid === 0n) {
    throw new TokenlessServiceError(
      "A result cannot fully refund guaranteed-base funding while accepted work remains payable.",
      409,
      "accepted_work_result_payment_mismatch",
    );
  }
}

export function classifyAcceptedWorkFailurePayment(input: {
  terminalState: AcceptedWorkFailureTerminalState;
  anyAcceptedWork: boolean;
  paidAcceptedWorkCount: number;
  paidPayableWorkCount: number;
}) {
  const acceptedCount = count(input.paidAcceptedWorkCount, "Paid accepted-work count");
  const payableCount = count(input.paidPayableWorkCount, "Paid payable-work count");
  if (payableCount > acceptedCount) {
    throw new TokenlessServiceError(
      "Paid payable work cannot exceed accepted paid work.",
      409,
      "accepted_work_payment_evidence_mismatch",
    );
  }
  if (input.terminalState === "cancelled_before_commit" && acceptedCount > 0) {
    throw new TokenlessServiceError(
      "Accepted paid work cannot enter a pre-commit cancellation terminal.",
      409,
      "accepted_work_post_commit_cancellation",
    );
  }
  return {
    disposition:
      acceptedCount === 0 && input.anyAcceptedWork
        ? ("not_applicable" as const)
        : acceptedCount === 0
          ? ("refundable_zero_accepted_work" as const)
          : payableCount > 0
            ? ("payable_terminal" as const)
            : ("compensation_path_preserved" as const),
    paidAcceptedWorkCount: acceptedCount,
    paidPayableWorkCount: payableCount,
    noPostCommitCancellation: acceptedCount > 0,
    feedbackBonusMaySatisfyBaseLiability: false as const,
  };
}

export const __acceptedWorkPaymentGuaranteeTestUtils = { canonicalJson, sha256 };

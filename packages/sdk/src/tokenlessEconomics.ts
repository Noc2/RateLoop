import type { TokenlessEconomics } from "./tokenlessTypes";

export type TokenlessEconomicsAccountingStage =
  | "quote"
  | "scored"
  | "zero_commit_refunded"
  | "compensated";

export type TokenlessEconomicsAccountingViolation = {
  expectation: string;
  path: string;
};

const ATOMIC_AMOUNT_PATTERN = /^(0|[1-9]\d*)$/u;

function violation(
  path: string,
  expectation: string,
): TokenlessEconomicsAccountingViolation {
  return { expectation, path };
}

/**
 * Checks the conservation rules shared by quote, result, and indexed-evidence
 * consumers. Callers remain responsible for mapping a violation to their
 * boundary-specific error type.
 */
export function tokenlessEconomicsAccountingViolation(
  value: TokenlessEconomics,
  stage: TokenlessEconomicsAccountingStage,
): TokenlessEconomicsAccountingViolation | null {
  const amounts = [
    ["bounty.fundedAtomic", value.bounty.fundedAtomic],
    ["bounty.paidAtomic", value.bounty.paidAtomic],
    ["bounty.refundedAtomic", value.bounty.refundedAtomic],
    ["fee.fundedAtomic", value.fee.fundedAtomic],
    ["fee.paidAtomic", value.fee.paidAtomic],
    ["fee.refundedAtomic", value.fee.refundedAtomic],
    ["attemptReserve.fundedAtomic", value.attemptReserve.fundedAtomic],
    [
      "attemptReserve.compensatedAtomic",
      value.attemptReserve.compensatedAtomic,
    ],
    ["attemptReserve.refundedAtomic", value.attemptReserve.refundedAtomic],
    ["refund.bountyAtomic", value.refund.bountyAtomic],
    ["refund.feeAtomic", value.refund.feeAtomic],
    ["refund.attemptReserveAtomic", value.refund.attemptReserveAtomic],
    ["refund.totalAtomic", value.refund.totalAtomic],
    [
      "compensation.perAcceptedRevealCapAtomic",
      value.compensation.perAcceptedRevealCapAtomic,
    ],
    ["compensation.totalAtomic", value.compensation.totalAtomic],
    ["totalFundedAtomic", value.totalFundedAtomic],
  ] as const;
  const malformed = amounts.find(
    ([, amount]) => !ATOMIC_AMOUNT_PATTERN.test(amount),
  );
  if (malformed) {
    return violation(malformed[0], "an unsigned base-10 atomic amount string");
  }
  if (
    !Number.isSafeInteger(value.fee.bps) ||
    value.fee.bps < 0 ||
    value.fee.bps > 2_000
  ) {
    return violation("fee.bps", "an integer between 0 and 2000");
  }
  if (
    !Number.isSafeInteger(value.compensation.recipientCount) ||
    value.compensation.recipientCount < 0
  ) {
    return violation(
      "compensation.recipientCount",
      "a non-negative safe integer",
    );
  }

  const bountyFunded = BigInt(value.bounty.fundedAtomic);
  const bountyPaid = BigInt(value.bounty.paidAtomic);
  const bountyRefunded = BigInt(value.bounty.refundedAtomic);
  const feeFunded = BigInt(value.fee.fundedAtomic);
  const feePaid = BigInt(value.fee.paidAtomic);
  const feeRefunded = BigInt(value.fee.refundedAtomic);
  const reserveFunded = BigInt(value.attemptReserve.fundedAtomic);
  const reserveCompensated = BigInt(value.attemptReserve.compensatedAtomic);
  const reserveRefunded = BigInt(value.attemptReserve.refundedAtomic);

  if (
    bountyFunded + feeFunded + reserveFunded !==
    BigInt(value.totalFundedAtomic)
  ) {
    return violation(
      "totalFundedAtomic",
      "bounty.fundedAtomic + fee.fundedAtomic + attemptReserve.fundedAtomic",
    );
  }
  if ((bountyFunded * BigInt(value.fee.bps)) / 10_000n !== feeFunded) {
    return violation(
      "fee.fundedAtomic",
      "floor(bounty.fundedAtomic * fee.bps / 10000)",
    );
  }

  const allocations = [
    ["bounty", bountyFunded, bountyPaid, bountyRefunded],
    ["fee", feeFunded, feePaid, feeRefunded],
    ["attemptReserve", reserveFunded, reserveCompensated, reserveRefunded],
  ] as const;
  const overAllocated = allocations.find(
    ([, funded, allocated, refunded]) => allocated + refunded > funded,
  );
  if (overAllocated) {
    return violation(
      overAllocated[0],
      "paid or compensated plus refunded no greater than funded",
    );
  }

  if (BigInt(value.refund.bountyAtomic) !== bountyRefunded) {
    return violation("refund.bountyAtomic", "bounty.refundedAtomic");
  }
  if (BigInt(value.refund.feeAtomic) !== feeRefunded) {
    return violation("refund.feeAtomic", "fee.refundedAtomic");
  }
  if (BigInt(value.refund.attemptReserveAtomic) !== reserveRefunded) {
    return violation(
      "refund.attemptReserveAtomic",
      "attemptReserve.refundedAtomic",
    );
  }
  if (
    bountyRefunded + feeRefunded + reserveRefunded !==
    BigInt(value.refund.totalAtomic)
  ) {
    return violation(
      "refund.totalAtomic",
      "the sum of the bounty, fee, and attempt-reserve refunds",
    );
  }
  if (BigInt(value.compensation.totalAtomic) !== reserveCompensated) {
    return violation(
      "compensation.totalAtomic",
      "attemptReserve.compensatedAtomic",
    );
  }
  if (
    BigInt(value.compensation.perAcceptedRevealCapAtomic) *
      BigInt(value.compensation.recipientCount) !==
    reserveCompensated
  ) {
    return violation(
      "compensation.totalAtomic",
      "perAcceptedRevealCapAtomic * recipientCount",
    );
  }

  if (stage === "quote") {
    if (
      bountyPaid !== 0n ||
      bountyRefunded !== 0n ||
      feePaid !== 0n ||
      feeRefunded !== 0n ||
      reserveCompensated !== 0n ||
      reserveRefunded !== 0n
    ) {
      return violation(
        "allocation",
        "zero paid, compensated, and refunded allocations in a quote",
      );
    }
    return null;
  }

  const notFullyAllocated = allocations.find(
    ([, funded, allocated, refunded]) => allocated + refunded !== funded,
  );
  if (notFullyAllocated) {
    return violation(
      notFullyAllocated[0],
      "paid or compensated plus refunded equal to funded at terminal settlement",
    );
  }

  if (stage === "zero_commit_refunded") {
    if (bountyPaid !== 0n || feePaid !== 0n || reserveCompensated !== 0n) {
      return violation(
        "allocation",
        "a full refund and zero payments for a zero-commit round",
      );
    }
    return null;
  }

  if (stage === "compensated") {
    if (
      bountyPaid !== 0n ||
      bountyRefunded !== bountyFunded ||
      feePaid !== 0n ||
      feeRefunded !== feeFunded
    ) {
      return violation(
        "allocation",
        "bounty and fee fully refunded for a compensation-only round",
      );
    }
    return null;
  }

  if (
    feePaid !== feeFunded ||
    feeRefunded !== 0n ||
    reserveCompensated !== 0n ||
    reserveRefunded !== reserveFunded
  ) {
    return violation(
      "allocation",
      "fee paid, attempt reserve refunded, and no compensation after finalized scoring",
    );
  }
  return null;
}

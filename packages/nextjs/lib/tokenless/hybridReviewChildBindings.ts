import "server-only";
import {
  HUMAN_REVIEW_FIXED_BASE_BPS,
  HUMAN_REVIEW_PLATFORM_FEE_BPS,
  hashPreparedHumanReviewValue,
} from "~~/lib/tokenless/humanReviewRequestPreparation";
import type { ReviewerExpertiseRequirement } from "~~/lib/tokenless/reviewerExpertiseOptions";

type Hash = `sha256:${string}`;

export type HybridChildParentBinding = {
  hybridOperationId: string;
  cohortBindingHash: Hash;
  economicsHash: Hash;
  expertiseHash: Hash;
  requestedCount: number;
  admissionPolicyHash: Hash;
  expertiseRequirements: ReviewerExpertiseRequirement[];
};

export function deriveHybridCohortEconomics(bountyPerSeatAtomic: string, panelSize: number) {
  const bountyPerSeat = BigInt(bountyPerSeatAtomic);
  const baseBounty = bountyPerSeat * BigInt(panelSize);
  const fee = (baseBounty * BigInt(HUMAN_REVIEW_PLATFORM_FEE_BPS)) / 10_000n;
  const fixedBasePerSeat = (bountyPerSeat * BigInt(HUMAN_REVIEW_FIXED_BASE_BPS)) / 10_000n;
  const attemptReserve = fixedBasePerSeat * BigInt(panelSize);
  const maximumCharge = baseBounty + fee + attemptReserve;
  if (
    bountyPerSeat <= 0n ||
    !Number.isSafeInteger(panelSize) ||
    panelSize < 1 ||
    fixedBasePerSeat === 0n ||
    maximumCharge >= 1n << 256n
  ) {
    throw new Error("Hybrid cohort economics exceed funded-round bounds.");
  }
  return {
    schemaVersion: "rateloop.human-review-derived-economics.v1" as const,
    compensationMode: "usdc" as const,
    bountyPerSeatAtomic,
    panelSize,
    baseBountyAtomic: baseBounty.toString(),
    feeBps: HUMAN_REVIEW_PLATFORM_FEE_BPS,
    feeAtomic: fee.toString(),
    attemptReserveAtomic: attemptReserve.toString(),
    maximumChargeAtomic: maximumCharge.toString(),
  };
}

export function hashHybridCohortEconomics(bountyPerSeatAtomic: string, panelSize: number) {
  return hashPreparedHumanReviewValue(deriveHybridCohortEconomics(bountyPerSeatAtomic, panelSize));
}

export function hashHybridCohortExpertise(
  cohort: "invited" | "network",
  requirements: readonly ReviewerExpertiseRequirement[],
) {
  return hashPreparedHumanReviewValue({
    schemaVersion: "rateloop.hybrid-child-expertise.v1",
    cohort,
    requirements,
  });
}

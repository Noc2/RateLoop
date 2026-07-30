import type { TokenlessPaymentInstructions } from "./tokenlessTypes";

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const ZERO_ADDRESS = `0x${"0".repeat(40)}`;
const ZERO_BYTES32 = `0x${"0".repeat(64)}`;

export const TOKENLESS_MAX_UINT32 = 4_294_967_295n;
export const TOKENLESS_MAX_UINT64 = 18_446_744_073_709_551_615n;
export const TOKENLESS_MAX_UINT256 = (1n << 256n) - 1n;
export const TOKENLESS_MAXIMUM_COMMITS = 500;
export const TOKENLESS_MINIMUM_REVEALS = 3;
export const TOKENLESS_BASE_PAY_BPS = 8_000n;
export const TOKENLESS_MAXIMUM_FEE_BPS = 2_000n;
export const TOKENLESS_MAXIMUM_CLAIM_GRACE_SECONDS = 365n * 24n * 60n * 60n;
export const TOKENLESS_MINIMUM_COMMIT_WINDOW_SECONDS = 5n * 60n;
export const TOKENLESS_MINIMUM_REVEAL_WINDOW_SECONDS = 5n * 60n;
export const TOKENLESS_MAXIMUM_REVEAL_HORIZON_SECONDS = 90n * 24n * 60n * 60n;
export const TOKENLESS_MAXIMUM_BEACON_FAILURE_HORIZON_SECONDS =
  120n * 24n * 60n * 60n;
export const TOKENLESS_QUICKNET_T_CHAIN_HASH =
  "0xcc9c398442737cbd141526600919edd69f1d6f9b4adb67e4d912fbc64341a9a5";
export const TOKENLESS_QUICKNET_T_GENESIS_SECONDS = 1_689_232_296n;
export const TOKENLESS_QUICKNET_T_PERIOD_SECONDS = 3n;
export const TOKENLESS_SCORING_BEACON_SAFETY_MARGIN_SECONDS = 24n * 60n * 60n;
export const TOKENLESS_MINIMUM_BEACON_FAILURE_GRACE_SECONDS = 6n * 60n * 60n;
export const TOKENLESS_X402_ROUND_AUTHORIZATION_DOMAIN = {
  name: "RateLoop X402 Panel Submitter",
  version: "1",
} as const;

export type TokenlessImmutableRoundTerms =
  TokenlessPaymentInstructions["roundTerms"];

export type TokenlessImmutableRoundTermsValidation = {
  fixedBasePay: bigint;
  maximumBonus: bigint;
  minimumAttemptReserve: bigint;
  totalFunded: bigint;
};

export type TokenlessImmutableRoundTermsValidationInput = {
  nowSeconds: bigint;
  paymentMode: TokenlessPaymentInstructions["paymentMode"];
  roundTerms: TokenlessImmutableRoundTerms;
  totalFundedAtomic: string;
  x402RoundAuthorizationDomain?: {
    name: string;
    version: string;
  };
};

export class TokenlessImmutableRoundTermsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenlessImmutableRoundTermsValidationError";
  }
}

function invalid(message: string): never {
  throw new TokenlessImmutableRoundTermsValidationError(message);
}

function uint(value: unknown, path: string, maximum: bigint): bigint {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) {
    invalid(`${path} must be an unsigned decimal amount.`);
  }
  const parsed = BigInt(value);
  if (parsed > maximum) invalid(`${path} exceeds its uint width.`);
  return parsed;
}

function uint32(value: unknown, path: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    BigInt(value) > TOKENLESS_MAX_UINT32
  ) {
    invalid(`${path} must be a valid uint32.`);
  }
  return value;
}

function nonZeroBytes32(value: unknown, path: string): void {
  if (
    typeof value !== "string" ||
    !BYTES32_PATTERN.test(value) ||
    value.toLowerCase() === ZERO_BYTES32
  ) {
    invalid(`${path} must be a non-zero bytes32 value.`);
  }
}

function address(value: unknown, path: string): string {
  if (typeof value !== "string" || !ADDRESS_PATTERN.test(value)) {
    invalid(`${path} must be an EVM address.`);
  }
  return value.toLowerCase();
}

function checkedMultiply(left: bigint, right: bigint, path: string): bigint {
  if (left !== 0n && right > TOKENLESS_MAX_UINT256 / left) {
    invalid(`${path} overflows uint256.`);
  }
  return left * right;
}

function checkedAdd(left: bigint, right: bigint, path: string): bigint {
  if (right > TOKENLESS_MAX_UINT256 - left) {
    invalid(`${path} overflows uint256.`);
  }
  return left + right;
}

export function tokenlessFirstQuicknetRoundAfter(timestamp: bigint): bigint {
  if (timestamp < 0n) invalid("quicknet-t timestamp must be non-negative.");
  if (timestamp < TOKENLESS_QUICKNET_T_GENESIS_SECONDS) return 1n;
  return (
    (timestamp - TOKENLESS_QUICKNET_T_GENESIS_SECONDS) /
      TOKENLESS_QUICKNET_T_PERIOD_SECONDS +
    2n
  );
}

export function tokenlessQuicknetTimestamp(round: bigint): bigint {
  if (round < 1n || round > TOKENLESS_MAX_UINT64) {
    invalid("quicknet-t round must be a valid uint64.");
  }
  return (
    TOKENLESS_QUICKNET_T_GENESIS_SECONDS +
    (round - 1n) * TOKENLESS_QUICKNET_T_PERIOD_SECONDS
  );
}

/**
 * Mirrors the immutable TokenlessPanel creation boundary plus the stateless
 * X402PanelSubmitter's exact-funding and pinned-domain requirements.
 *
 * `nowSeconds` is explicit so every consumer can validate against the same
 * prospective creation block without hiding a clock dependency in this rule.
 */
export function validateTokenlessImmutableRoundTerms(
  input: TokenlessImmutableRoundTermsValidationInput,
): TokenlessImmutableRoundTermsValidation {
  const { roundTerms: terms } = input;
  if (input.nowSeconds < 0n || input.nowSeconds > TOKENLESS_MAX_UINT64) {
    invalid("nowSeconds must be a valid uint64 timestamp.");
  }

  nonZeroBytes32(terms.contentId, "roundTerms.contentId");
  nonZeroBytes32(terms.termsHash, "roundTerms.termsHash");
  nonZeroBytes32(terms.admissionPolicyHash, "roundTerms.admissionPolicyHash");
  if (
    typeof terms.beaconNetworkHash !== "string" ||
    terms.beaconNetworkHash.toLowerCase() !== TOKENLESS_QUICKNET_T_CHAIN_HASH
  ) {
    invalid("roundTerms.beaconNetworkHash must pin drand quicknet-t.");
  }

  const minimumReveals = uint32(
    terms.minimumReveals,
    "roundTerms.minimumReveals",
  );
  const maximumCommits = uint32(
    terms.maximumCommits,
    "roundTerms.maximumCommits",
  );
  if (minimumReveals < TOKENLESS_MINIMUM_REVEALS) {
    invalid(
      `roundTerms.minimumReveals must be at least ${TOKENLESS_MINIMUM_REVEALS}.`,
    );
  }
  if (maximumCommits < minimumReveals) {
    invalid(
      "roundTerms.maximumCommits must be greater than or equal to minimumReveals.",
    );
  }
  if (maximumCommits > TOKENLESS_MAXIMUM_COMMITS) {
    invalid(
      `roundTerms.maximumCommits must not exceed ${TOKENLESS_MAXIMUM_COMMITS}.`,
    );
  }

  const bountyAmount = uint(
    terms.bountyAmount,
    "roundTerms.bountyAmount",
    TOKENLESS_MAX_UINT256,
  );
  const feeAmount = uint(
    terms.feeAmount,
    "roundTerms.feeAmount",
    TOKENLESS_MAX_UINT256,
  );
  const attemptReserve = uint(
    terms.attemptReserve,
    "roundTerms.attemptReserve",
    TOKENLESS_MAX_UINT256,
  );
  const attemptCompensation = uint(
    terms.attemptCompensation,
    "roundTerms.attemptCompensation",
    TOKENLESS_MAX_UINT256,
  );
  if (bountyAmount === 0n) {
    invalid("roundTerms.bountyAmount must be positive.");
  }

  const maximumSeatPay = bountyAmount / BigInt(maximumCommits);
  const basePayNumerator = checkedMultiply(
    maximumSeatPay,
    TOKENLESS_BASE_PAY_BPS,
    "roundTerms fixed-base calculation",
  );
  const fixedBasePay = basePayNumerator / 10_000n;
  const maximumBonus = maximumSeatPay - fixedBasePay;
  if (fixedBasePay === 0n || maximumBonus === 0n) {
    invalid(
      "roundTerms.bountyAmount is too small to preserve fixed-base and bonus compensation.",
    );
  }
  if (attemptCompensation !== fixedBasePay) {
    invalid(
      "roundTerms.attemptCompensation must equal the immutable fixed-base payment.",
    );
  }
  const minimumAttemptReserve = checkedMultiply(
    fixedBasePay,
    BigInt(maximumCommits),
    "roundTerms minimum attempt reserve",
  );
  if (attemptReserve < minimumAttemptReserve) {
    invalid(
      "roundTerms.attemptReserve cannot compensate every accepted commit.",
    );
  }

  const maximumFeeNumerator = checkedMultiply(
    bountyAmount,
    TOKENLESS_MAXIMUM_FEE_BPS,
    "roundTerms maximum fee calculation",
  );
  if (feeAmount > maximumFeeNumerator / 10_000n) {
    invalid("roundTerms.feeAmount exceeds the immutable fee cap.");
  }
  const feeRecipient = address(terms.feeRecipient, "roundTerms.feeRecipient");
  if (feeAmount !== 0n && feeRecipient === ZERO_ADDRESS) {
    invalid(
      "roundTerms.feeRecipient must be non-zero when feeAmount is non-zero.",
    );
  }

  const bountyAndFee = checkedAdd(
    bountyAmount,
    feeAmount,
    "roundTerms funded total",
  );
  const totalFunded = checkedAdd(
    bountyAndFee,
    attemptReserve,
    "roundTerms funded total",
  );
  const suppliedTotal = uint(
    input.totalFundedAtomic,
    "totalFundedAtomic",
    TOKENLESS_MAX_UINT256,
  );
  if (suppliedTotal !== totalFunded) {
    invalid(
      "totalFundedAtomic must equal bountyAmount + feeAmount + attemptReserve.",
    );
  }

  const commitDeadline = uint(
    terms.commitDeadline,
    "roundTerms.commitDeadline",
    TOKENLESS_MAX_UINT64,
  );
  const revealDeadline = uint(
    terms.revealDeadline,
    "roundTerms.revealDeadline",
    TOKENLESS_MAX_UINT64,
  );
  const beaconFailureDeadline = uint(
    terms.beaconFailureDeadline,
    "roundTerms.beaconFailureDeadline",
    TOKENLESS_MAX_UINT64,
  );
  const beaconRound = uint(
    terms.beaconRound,
    "roundTerms.beaconRound",
    TOKENLESS_MAX_UINT64,
  );
  const scoringBeaconRound = uint(
    terms.scoringBeaconRound,
    "roundTerms.scoringBeaconRound",
    TOKENLESS_MAX_UINT64,
  );
  const claimGracePeriod = uint(
    terms.claimGracePeriod,
    "roundTerms.claimGracePeriod",
    TOKENLESS_MAX_UINT64,
  );

  if (
    commitDeadline <
    input.nowSeconds + TOKENLESS_MINIMUM_COMMIT_WINDOW_SECONDS
  ) {
    invalid(
      "roundTerms.commitDeadline is shorter than the immutable commit window.",
    );
  }
  if (
    revealDeadline <
    commitDeadline + TOKENLESS_MINIMUM_REVEAL_WINDOW_SECONDS
  ) {
    invalid(
      "roundTerms.revealDeadline is shorter than the immutable reveal window.",
    );
  }
  if (
    revealDeadline >
    input.nowSeconds + TOKENLESS_MAXIMUM_REVEAL_HORIZON_SECONDS
  ) {
    invalid("roundTerms.revealDeadline exceeds the immutable custody horizon.");
  }
  if (
    beaconFailureDeadline >
    input.nowSeconds + TOKENLESS_MAXIMUM_BEACON_FAILURE_HORIZON_SECONDS
  ) {
    invalid(
      "roundTerms.beaconFailureDeadline exceeds the immutable custody horizon.",
    );
  }
  if (
    claimGracePeriod === 0n ||
    claimGracePeriod > TOKENLESS_MAXIMUM_CLAIM_GRACE_SECONDS
  ) {
    invalid(
      "roundTerms.claimGracePeriod must be between one second and 365 days.",
    );
  }

  const expectedDisclosureRound =
    tokenlessFirstQuicknetRoundAfter(commitDeadline);
  if (beaconRound !== expectedDisclosureRound) {
    invalid(
      "roundTerms.beaconRound is not the first quicknet-t round after the commit deadline.",
    );
  }
  const protectedScoringCutoff =
    revealDeadline + TOKENLESS_SCORING_BEACON_SAFETY_MARGIN_SECONDS;
  const expectedScoringRound = tokenlessFirstQuicknetRoundAfter(
    protectedScoringCutoff,
  );
  if (scoringBeaconRound !== expectedScoringRound) {
    invalid(
      "roundTerms.scoringBeaconRound is not the first protected quicknet-t round after reveal closure.",
    );
  }
  const scoringBeaconTimestamp =
    tokenlessQuicknetTimestamp(expectedScoringRound);
  if (
    beaconFailureDeadline <
    scoringBeaconTimestamp + TOKENLESS_MINIMUM_BEACON_FAILURE_GRACE_SECONDS
  ) {
    invalid(
      "roundTerms.beaconFailureDeadline is shorter than the immutable scoring-beacon grace.",
    );
  }

  if (input.paymentMode === "x402") {
    const domain = input.x402RoundAuthorizationDomain;
    if (
      domain?.name !== TOKENLESS_X402_ROUND_AUTHORIZATION_DOMAIN.name ||
      domain.version !== TOKENLESS_X402_ROUND_AUTHORIZATION_DOMAIN.version
    ) {
      invalid(
        "authorizationSpec.roundAuthorizationDomain must match the immutable X402 domain.",
      );
    }
  }

  return {
    fixedBasePay,
    maximumBonus,
    minimumAttemptReserve,
    totalFunded,
  };
}

export const ADVISORY_COMMIT_AVAILABILITY_STATUS = {
  Available: 0,
  Paused: 1,
  ContentInactive: 2,
  NoStakedRound: 3,
  RoundNotOpen: 4,
  OutsideBlindEpoch: 5,
  ThresholdReached: 6,
  MaxAdvisoryVotersReached: 7,
  InvalidConfig: 8,
} as const;

export type AdvisoryCommitAvailabilityStatus =
  (typeof ADVISORY_COMMIT_AVAILABILITY_STATUS)[keyof typeof ADVISORY_COMMIT_AVAILABILITY_STATUS];

export interface AdvisoryCommitAvailability {
  canCommit: boolean;
  status: AdvisoryCommitAvailabilityStatus;
  roundId: bigint;
  roundReferenceRatingBps: number;
  epochEnd: bigint;
  drandChainHash: `0x${string}`;
  drandGenesisTime: bigint;
  drandPeriod: bigint;
  minTargetRound: bigint;
  maxTargetRound: bigint;
}

const EMPTY_BYTES32 = `0x${"0".repeat(64)}` as `0x${string}`;

function field<T>(raw: unknown, index: number, name: string, fallback: T): T {
  if (raw && typeof raw === "object" && name in raw) {
    return (raw as Record<string, unknown>)[name] as T;
  }
  if (Array.isArray(raw) && raw.length > index) {
    return raw[index] as T;
  }
  return fallback;
}

export function parseAdvisoryCommitAvailability(raw: unknown): AdvisoryCommitAvailability {
  return {
    canCommit: Boolean(field(raw, 0, "canCommit", false)),
    status: Number(
      field(raw, 1, "status", ADVISORY_COMMIT_AVAILABILITY_STATUS.InvalidConfig),
    ) as AdvisoryCommitAvailabilityStatus,
    roundId: BigInt(field(raw, 2, "roundId", 0n)),
    roundReferenceRatingBps: Number(field(raw, 3, "roundReferenceRatingBps", 0)),
    epochEnd: BigInt(field(raw, 4, "epochEnd", 0n)),
    drandChainHash: field(raw, 5, "drandChainHash", EMPTY_BYTES32),
    drandGenesisTime: BigInt(field(raw, 6, "drandGenesisTime", 0n)),
    drandPeriod: BigInt(field(raw, 7, "drandPeriod", 0n)),
    minTargetRound: BigInt(field(raw, 8, "minTargetRound", 0n)),
    maxTargetRound: BigInt(field(raw, 9, "maxTargetRound", 0n)),
  };
}

export function getAdvisoryVoteUnavailableMessage(
  availability: Pick<AdvisoryCommitAvailability, "canCommit" | "status"> | null | undefined,
) {
  if (!availability || availability.canCommit) return null;

  switch (availability.status) {
    case ADVISORY_COMMIT_AVAILABILITY_STATUS.Paused:
      return "Advisory voting is paused right now.";
    case ADVISORY_COMMIT_AVAILABILITY_STATUS.ContentInactive:
      return "This content is no longer active for voting.";
    case ADVISORY_COMMIT_AVAILABILITY_STATUS.NoStakedRound:
      return "Zero-LREP voting opens after at least one staked rater joins this round.";
    case ADVISORY_COMMIT_AVAILABILITY_STATUS.OutsideBlindEpoch:
      return "Zero-LREP voting is only available during the first private epoch.";
    case ADVISORY_COMMIT_AVAILABILITY_STATUS.ThresholdReached:
      return "This round is already waiting for settlement.";
    case ADVISORY_COMMIT_AVAILABILITY_STATUS.MaxAdvisoryVotersReached:
      return "This round has reached the maximum number of advisory voters.";
    case ADVISORY_COMMIT_AVAILABILITY_STATUS.RoundNotOpen:
      return "This round is not accepting votes right now.";
    case ADVISORY_COMMIT_AVAILABILITY_STATUS.InvalidConfig:
    default:
      return "Zero-LREP voting is unavailable for this round right now.";
  }
}

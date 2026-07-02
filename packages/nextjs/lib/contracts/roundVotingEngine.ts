import { DEFAULT_ROUND_CONFIG, ROUND_STATE } from "@rateloop/contracts/protocol";
import { RoundData } from "~~/types/votingTypes";

export type RoundPhase = "voting" | "settlementPending" | "settled" | "cancelled" | "tied" | "revealFailed" | "none";

export interface VotingConfig {
  epochDuration: number;
  maxDuration: number;
  minVoters: number;
  maxVoters: number;
}

export interface OpenRoundFallbackData {
  roundId: bigint;
  state?: number;
  voteCount: number;
  revealedCount: number;
  totalStake: bigint;
  upPool: bigint;
  downPool: bigint;
  upCount?: number;
  downCount?: number;
  thresholdReachedAt?: bigint;
  hasHumanVerifiedCommit?: boolean;
  lastCommitRevealableAfter?: bigint | null;
  revealGracePeriod?: bigint | null;
  startTime: bigint | null;
  epochDuration?: number;
  maxDuration?: number;
  minVoters?: number;
  maxVoters?: number;
}

export interface OptimisticRoundDelta {
  voteCount: number;
  stake: bigint;
  roundId?: bigint;
  baseVoteCount?: bigint;
  baseTotalStake?: bigint;
}

export const COMMIT_AVAILABILITY_STATUS = {
  Open: 0,
  StartsNextRound: 1,
  RoundFull: 2,
  WaitingForSettlement: 3,
  WaitingForRevealGrace: 4,
  ContentInactive: 5,
} as const;

export type CommitAvailabilityStatus = (typeof COMMIT_AVAILABILITY_STATUS)[keyof typeof COMMIT_AVAILABILITY_STATUS];

export interface CommitAvailability {
  canCommit: boolean;
  status: CommitAvailabilityStatus;
  roundId: bigint;
  referenceRatingBps: number;
  willStartNewRound: boolean;
}

interface RoundTiming {
  epoch1EndTime: number;
  epoch1Remaining: number;
  currentEpochRemaining: number;
  roundTimeRemaining: number;
  isEpoch1: boolean;
}

interface VoteDeadlines extends RoundTiming {
  deadline: number;
  nextActionRemaining: number;
}

export interface RoundSnapshot {
  roundId: bigint;
  phase: RoundPhase;
  hasRound: boolean;
  state: number;
  startTime: number;
  revealedCount: number;
  voteCount: number;
  voteCountBigInt: bigint;
  totalStake: bigint;
  upPool: bigint;
  downPool: bigint;
  weightedUpPool: bigint;
  weightedDownPool: bigint;
  upCount: number;
  downCount: number;
  upWins: boolean;
  thresholdReachedAt: number;
  settlementTime: number;
  settlementCountdown: number;
  votersNeeded: number;
  readyToSettle: boolean;
  isRoundFull: boolean;
  minVoters: number;
  maxVoters: number;
  epochDuration: number;
  maxDuration: number;
  epoch1EndTime: number;
  epoch1Remaining: number;
  currentEpochRemaining: number;
  roundTimeRemaining: number;
  isEpoch1: boolean;
  round: {
    state: number;
    startTime: number;
    voteCount: bigint;
    revealedCount: number;
    totalStake: bigint;
    upPool: bigint;
    downPool: bigint;
    weightedUpPool: bigint;
    weightedDownPool: bigint;
    upCount: bigint;
    downCount: bigint;
    upWins: boolean;
    thresholdReachedAt: number;
  };
  commitAvailability?: CommitAvailability;
  willStartNewRound: boolean;
}

export const DEFAULT_VOTING_CONFIG: VotingConfig = {
  epochDuration: DEFAULT_ROUND_CONFIG.epochDurationSeconds,
  maxDuration: DEFAULT_ROUND_CONFIG.maxDurationSeconds,
  minVoters: DEFAULT_ROUND_CONFIG.minVoters,
  maxVoters: DEFAULT_ROUND_CONFIG.maxVoters,
};
const RBTS_MIN_REVEALS = 3;

export function buildStakeAmountWei(stakeAmount: number): bigint {
  return BigInt(Math.round(stakeAmount * 1e6));
}

export function resolveFrontendCode(frontendCode?: `0x${string}`, defaultFrontendCode?: `0x${string}`): `0x${string}` {
  return frontendCode ?? defaultFrontendCode ?? "0x0000000000000000000000000000000000000000";
}

function toBigInt(value: unknown, fallback = 0n): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^\d+$/u.test(value)) return BigInt(value);
  return fallback;
}

function toNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" ? value : typeof value === "bigint" ? Number(value) : fallback;
}

function toPositiveNumber(value: unknown, fallback: number): number {
  const parsed = toNumber(value, fallback);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function maxBigInt(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}

function preferPositiveBigInt(
  primary: bigint | undefined,
  fallback: bigint | null | undefined,
  defaultValue = 0n,
): bigint {
  if (primary != null && primary > 0n) return primary;
  if (fallback != null && fallback > 0n) return fallback;
  if (primary != null) return primary;
  if (fallback != null) return fallback;
  return defaultValue;
}

export function parseVotingConfig(rawConfig: unknown): VotingConfig {
  if (!rawConfig) return DEFAULT_VOTING_CONFIG;

  const config = rawConfig as Record<string, unknown> & unknown[];

  if (config.epochDuration != null) {
    return {
      epochDuration: toPositiveNumber(config.epochDuration, DEFAULT_VOTING_CONFIG.epochDuration),
      maxDuration: toPositiveNumber(config.maxDuration, DEFAULT_VOTING_CONFIG.maxDuration),
      minVoters: toPositiveNumber(config.minVoters, DEFAULT_VOTING_CONFIG.minVoters),
      maxVoters: toPositiveNumber(config.maxVoters, DEFAULT_VOTING_CONFIG.maxVoters),
    };
  }

  if (Array.isArray(config) && config.length >= 4) {
    return {
      epochDuration: toPositiveNumber(config[0], DEFAULT_VOTING_CONFIG.epochDuration),
      maxDuration: toPositiveNumber(config[1], DEFAULT_VOTING_CONFIG.maxDuration),
      minVoters: toPositiveNumber(config[2], DEFAULT_VOTING_CONFIG.minVoters),
      maxVoters: toPositiveNumber(config[3], DEFAULT_VOTING_CONFIG.maxVoters),
    };
  }

  return DEFAULT_VOTING_CONFIG;
}

export function parseRound(rawRoundData: unknown): RoundData | undefined {
  if (!rawRoundData) return undefined;

  const round = rawRoundData as Record<string, unknown> & unknown[];

  // viem/abitype tuples can arrive as arrays with partially attached named properties.
  // Prefer indexed decoding when possible so missing named keys do not silently zero fields.
  if (Array.isArray(round) && round.length >= 14) {
    return {
      startTime: toBigInt(round[0]),
      state: toNumber(round[1]),
      voteCount: toBigInt(round[2]),
      revealedCount: toBigInt(round[3]),
      totalStake: toBigInt(round[4]),
      upPool: toBigInt(round[5]),
      downPool: toBigInt(round[6]),
      upCount: toBigInt(round[7]),
      downCount: toBigInt(round[8]),
      upWins: Boolean(round[9]),
      settledAt: toBigInt(round[10]),
      thresholdReachedAt: toBigInt(round[11]),
      weightedUpPool: toBigInt(round[12]),
      weightedDownPool: toBigInt(round[13]),
    };
  }

  if (Array.isArray(round) && round.length >= 7) {
    return {
      startTime: toBigInt(round[0]),
      state: toNumber(round[1]),
      voteCount: toBigInt(round[2]),
      revealedCount: toBigInt(round[3]),
      totalStake: toBigInt(round[4]),
      upPool: 0n,
      downPool: 0n,
      upCount: 0n,
      downCount: 0n,
      upWins: false,
      settledAt: toBigInt(round[6]),
      thresholdReachedAt: toBigInt(round[5]),
      weightedUpPool: 0n,
      weightedDownPool: 0n,
    };
  }

  if (round.startTime != null) {
    return {
      startTime: toBigInt(round.startTime),
      state: toNumber(round.state),
      voteCount: toBigInt(round.voteCount),
      revealedCount: toBigInt(round.revealedCount),
      totalStake: toBigInt(round.totalStake),
      upPool: toBigInt(round.upPool),
      downPool: toBigInt(round.downPool),
      upCount: toBigInt(round.upCount),
      downCount: toBigInt(round.downCount),
      upWins: Boolean(round.upWins),
      settledAt: toBigInt(round.settledAt),
      thresholdReachedAt: toBigInt(round.thresholdReachedAt),
      weightedUpPool: toBigInt(round.weightedUpPool),
      weightedDownPool: toBigInt(round.weightedDownPool),
    };
  }

  return undefined;
}

export function mergeRoundDataWithFallback(params: {
  roundId: bigint;
  round?: RoundData;
  fallback?: OpenRoundFallbackData;
}): { roundId: bigint; round?: RoundData } {
  const { fallback, round } = params;

  if (!fallback) {
    return { roundId: params.roundId, round };
  }

  if (params.roundId > 0n && fallback.roundId > 0n && params.roundId !== fallback.roundId) {
    return { roundId: params.roundId, round };
  }

  if (
    round?.startTime != null &&
    round.startTime > 0n &&
    fallback.startTime != null &&
    round.startTime !== fallback.startTime
  ) {
    return { roundId: params.roundId, round };
  }

  const fallbackVoteCount = BigInt(Math.max(0, fallback.voteCount));
  const fallbackRevealedCount = BigInt(Math.max(0, fallback.revealedCount));
  const fallbackUpCount = BigInt(Math.max(0, fallback.upCount ?? 0));
  const fallbackDownCount = BigInt(Math.max(0, fallback.downCount ?? 0));
  const resolvedRoundId = params.roundId > 0n ? params.roundId : fallback.roundId;

  return {
    roundId: resolvedRoundId,
    round: {
      startTime: preferPositiveBigInt(round?.startTime, fallback.startTime),
      state: round?.state ?? fallback.state ?? ROUND_STATE.Open,
      voteCount: maxBigInt(round?.voteCount ?? 0n, fallbackVoteCount),
      revealedCount: maxBigInt(round?.revealedCount ?? 0n, fallbackRevealedCount),
      totalStake: maxBigInt(round?.totalStake ?? 0n, fallback.totalStake),
      upPool: maxBigInt(round?.upPool ?? 0n, fallback.upPool),
      downPool: maxBigInt(round?.downPool ?? 0n, fallback.downPool),
      upCount: maxBigInt(round?.upCount ?? 0n, fallbackUpCount),
      downCount: maxBigInt(round?.downCount ?? 0n, fallbackDownCount),
      upWins: round?.upWins ?? false,
      settledAt: round?.settledAt ?? 0n,
      thresholdReachedAt: round?.thresholdReachedAt ?? fallback.thresholdReachedAt ?? 0n,
      weightedUpPool: round?.weightedUpPool ?? 0n,
      weightedDownPool: round?.weightedDownPool ?? 0n,
    },
  };
}

function deriveRoundTiming(params: {
  startTime: number;
  now: number;
  epochDuration: number;
  maxDuration: number;
}): RoundTiming {
  if (params.startTime <= 0) {
    return {
      epoch1EndTime: 0,
      epoch1Remaining: 0,
      currentEpochRemaining: 0,
      roundTimeRemaining: 0,
      isEpoch1: false,
    };
  }

  const epoch1EndTime = params.startTime + params.epochDuration;
  const elapsed = params.now - params.startTime;
  const epochProgress = elapsed >= 0 ? elapsed % params.epochDuration : 0;
  const currentEpochRemaining =
    elapsed >= 0 ? (epochProgress === 0 ? params.epochDuration : params.epochDuration - epochProgress) : 0;

  return {
    epoch1EndTime,
    epoch1Remaining: Math.max(0, epoch1EndTime - params.now),
    currentEpochRemaining,
    roundTimeRemaining: Math.max(0, params.startTime + params.maxDuration - params.now),
    isEpoch1: params.now < epoch1EndTime,
  };
}

export function deriveVoteDeadlines(params: {
  startTime: number;
  now: number;
  epochDuration: number;
  maxDuration: number;
}): VoteDeadlines {
  const timing = deriveRoundTiming(params);
  const deadline = params.startTime > 0 ? params.startTime + params.maxDuration : 0;

  return {
    ...timing,
    deadline,
    nextActionRemaining: timing.epoch1Remaining > 0 ? timing.epoch1Remaining : timing.roundTimeRemaining,
  };
}

function deriveRoundPhase(state: number, hasRound: boolean): RoundPhase {
  if (!hasRound) return "none";

  switch (state) {
    case ROUND_STATE.Open:
      return "voting";
    case ROUND_STATE.SettlementPending:
      return "settlementPending";
    case ROUND_STATE.Settled:
      return "settled";
    case ROUND_STATE.Cancelled:
      return "cancelled";
    case ROUND_STATE.Tied:
      return "tied";
    case ROUND_STATE.RevealFailed:
      return "revealFailed";
    default:
      return "none";
  }
}

export function deriveRoundSnapshot(params: {
  roundId: bigint;
  round?: RoundData;
  config: VotingConfig;
  optimisticDelta?: OptimisticRoundDelta;
  commitAvailability?: CommitAvailability;
  previewRoundId?: bigint;
  previewStartsNewRound?: boolean;
  now: number;
}): RoundSnapshot {
  const round = params.round;
  const hasRound = params.roundId > 0n && !!round;
  const state = round?.state ?? 0;
  const startTime = round ? Number(round.startTime) : 0;
  const optimisticVoteCount = BigInt(params.optimisticDelta?.voteCount ?? 0);
  const optimisticStake = params.optimisticDelta?.stake ?? 0n;
  const baseVoteCount = round?.voteCount ?? 0n;
  const voteCountBigInt = baseVoteCount + optimisticVoteCount;
  const revealedCount = Number(round?.revealedCount ?? 0n);
  const voteCount = Number(voteCountBigInt);
  const totalStake = (round?.totalStake ?? 0n) + optimisticStake;
  const thresholdReachedAt = round ? Number(round.thresholdReachedAt) : 0;
  const settlementQuorum = Math.max(params.config.minVoters, RBTS_MIN_REVEALS);
  const timing = deriveRoundTiming({
    startTime,
    now: params.now,
    epochDuration: params.config.epochDuration,
    maxDuration: params.config.maxDuration,
  });
  const previewRoundId = params.previewRoundId ?? 0n;
  const commitAvailability =
    params.commitAvailability ??
    (params.previewStartsNewRound && previewRoundId > 0n
      ? {
          canCommit: true,
          status: COMMIT_AVAILABILITY_STATUS.StartsNextRound,
          roundId: previewRoundId,
          referenceRatingBps: 0,
          willStartNewRound: true,
        }
      : hasRound
        ? {
            canCommit:
              state === ROUND_STATE.Open &&
              timing.roundTimeRemaining > 0 &&
              thresholdReachedAt === 0 &&
              revealedCount < settlementQuorum &&
              voteCount < params.config.maxVoters,
            status:
              state !== ROUND_STATE.Open
                ? COMMIT_AVAILABILITY_STATUS.WaitingForSettlement
                : thresholdReachedAt !== 0 || revealedCount >= settlementQuorum
                  ? COMMIT_AVAILABILITY_STATUS.WaitingForSettlement
                  : voteCount >= params.config.maxVoters
                    ? COMMIT_AVAILABILITY_STATUS.RoundFull
                    : state === ROUND_STATE.Open && timing.roundTimeRemaining <= 0
                      ? COMMIT_AVAILABILITY_STATUS.WaitingForRevealGrace
                      : COMMIT_AVAILABILITY_STATUS.Open,
            roundId: params.roundId,
            referenceRatingBps: 0,
            willStartNewRound: false,
          }
        : params.roundId > 0n
          ? {
              canCommit: false,
              status: COMMIT_AVAILABILITY_STATUS.WaitingForSettlement,
              roundId: params.roundId,
              referenceRatingBps: 0,
              willStartNewRound: false,
            }
          : undefined);

  return {
    roundId: params.roundId,
    phase: deriveRoundPhase(state, hasRound),
    hasRound,
    state,
    startTime,
    revealedCount,
    voteCount,
    voteCountBigInt,
    totalStake,
    upPool: round?.upPool ?? 0n,
    downPool: round?.downPool ?? 0n,
    weightedUpPool: round?.weightedUpPool ?? 0n,
    weightedDownPool: round?.weightedDownPool ?? 0n,
    upCount: Number(round?.upCount ?? 0n),
    downCount: Number(round?.downCount ?? 0n),
    upWins: round?.upWins ?? false,
    thresholdReachedAt,
    settlementTime: thresholdReachedAt > 0 ? thresholdReachedAt : 0,
    settlementCountdown: 0,
    votersNeeded: Math.max(0, settlementQuorum - revealedCount),
    readyToSettle: state === ROUND_STATE.Open && revealedCount >= settlementQuorum,
    isRoundFull: voteCount >= params.config.maxVoters,
    minVoters: params.config.minVoters,
    maxVoters: params.config.maxVoters,
    epochDuration: params.config.epochDuration,
    maxDuration: params.config.maxDuration,
    epoch1EndTime: timing.epoch1EndTime,
    epoch1Remaining: timing.epoch1Remaining,
    currentEpochRemaining: timing.currentEpochRemaining,
    roundTimeRemaining: timing.roundTimeRemaining,
    isEpoch1: timing.isEpoch1,
    round: {
      state,
      startTime,
      voteCount: voteCountBigInt,
      revealedCount,
      totalStake,
      upPool: round?.upPool ?? 0n,
      downPool: round?.downPool ?? 0n,
      weightedUpPool: round?.weightedUpPool ?? 0n,
      weightedDownPool: round?.weightedDownPool ?? 0n,
      upCount: round?.upCount ?? 0n,
      downCount: round?.downCount ?? 0n,
      upWins: round?.upWins ?? false,
      thresholdReachedAt,
    },
    commitAvailability,
    willStartNewRound: Boolean(commitAvailability?.canCommit && commitAvailability.willStartNewRound),
  };
}

export function isRoundAcceptingVotes(
  snapshot: Pick<RoundSnapshot, "hasRound" | "phase" | "roundTimeRemaining" | "thresholdReachedAt"> & {
    commitAvailability?: Pick<CommitAvailability, "canCommit">;
  },
) {
  if (snapshot.commitAvailability) {
    return snapshot.commitAvailability.canCommit;
  }

  if (!snapshot.hasRound) {
    return true;
  }

  return snapshot.phase === "voting" && snapshot.roundTimeRemaining > 0 && snapshot.thresholdReachedAt === 0;
}

export function getRoundVoteUnavailableMessage(
  snapshot: Pick<
    RoundSnapshot,
    "commitAvailability" | "hasRound" | "phase" | "roundTimeRemaining" | "thresholdReachedAt"
  >,
) {
  switch (snapshot.commitAvailability?.status) {
    case COMMIT_AVAILABILITY_STATUS.RoundFull:
      return "This round has reached the maximum number of voters. A new round will start after resolution.";
    case COMMIT_AVAILABILITY_STATUS.WaitingForSettlement:
      return "This round is waiting to be settled. Voting resumes after it is settled, cancelled, or finalized.";
    case COMMIT_AVAILABILITY_STATUS.WaitingForRevealGrace:
      return "This round has expired and is waiting for reveal grace or finalization. Voting resumes after resolution.";
    case COMMIT_AVAILABILITY_STATUS.ContentInactive:
      return "This content is no longer active for voting.";
    default:
      return isRoundAcceptingVotes(snapshot) ? null : "This round is not accepting votes right now.";
  }
}

export function isOptimisticRoundDeltaReflected(params: {
  roundId: bigint;
  round?: RoundData;
  optimisticDelta?: OptimisticRoundDelta;
}): boolean {
  const { optimisticDelta, round, roundId } = params;
  if (!optimisticDelta || !round) {
    return false;
  }
  if (optimisticDelta.roundId !== undefined && optimisticDelta.roundId !== roundId) {
    return true;
  }
  if (optimisticDelta.baseVoteCount === undefined || optimisticDelta.baseTotalStake === undefined) {
    return false;
  }

  return (
    round.voteCount >= optimisticDelta.baseVoteCount + BigInt(optimisticDelta.voteCount) &&
    round.totalStake >= optimisticDelta.baseTotalStake + optimisticDelta.stake
  );
}

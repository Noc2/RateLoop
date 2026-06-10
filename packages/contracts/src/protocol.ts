export const BPS_SCALE = 10_000 as const;

export const USER_PREDICTION_BPS = {
  min: 100,
  max: 9_900,
} as const;

export const USER_PREDICTION_PERCENT = {
  min: USER_PREDICTION_BPS.min / 100,
  max: USER_PREDICTION_BPS.max / 100,
} as const;

export const ROUND_STATE = {
  Open: 0,
  Settled: 1,
  Cancelled: 2,
  Tied: 3,
  RevealFailed: 4,
} as const;

export type RoundState = (typeof ROUND_STATE)[keyof typeof ROUND_STATE];

export const ROUND_STATE_LABEL: Record<RoundState, string> = {
  [ROUND_STATE.Open]: "Open",
  [ROUND_STATE.Settled]: "Settled",
  [ROUND_STATE.Cancelled]: "Cancelled",
  [ROUND_STATE.Tied]: "Tied",
  [ROUND_STATE.RevealFailed]: "RevealFailed",
};

export const DEFAULT_ROUND_CONFIG = {
  epochDurationSeconds: 20 * 60,
  maxDurationSeconds: 20 * 60,
  minVoters: 3,
  maxVoters: 100,
} as const;

export const DEFAULT_REVEAL_GRACE_PERIOD_SECONDS = 60 * 60;

export const EPOCH_WEIGHT_BPS = {
  blind: BPS_SCALE,
  informed: 2_500,
} as const;

export const PLATFORM_REWARD_SPLIT_BPS = {
  frontend: 300,
} as const;

export const REWARD_SPLIT_BPS = {
  voter: 9_600,
  submitter: 0,
  platform: PLATFORM_REWARD_SPLIT_BPS.frontend,
  treasury: 100,
} as const;

export const SCORE_SPREAD_POLICY = {
  intensityBps: 15_000,
  forfeitMinReveals: 8,
  maxForfeitBps: 5_000,
} as const;

export const QUESTION_REWARD_PARTICIPANT_FLOORS = {
  minParticipants: 3,
  highValueAmount: 1_000_000_000,
  highValueMinParticipants: 5,
  veryHighValueAmount: 10_000_000_000,
  veryHighValueMinParticipants: SCORE_SPREAD_POLICY.forfeitMinReveals,
} as const;

export function requiredQuestionRewardParticipants(amountAtomic: bigint | number): number {
  const amount = typeof amountAtomic === "bigint" ? amountAtomic : BigInt(amountAtomic);
  if (amount >= BigInt(QUESTION_REWARD_PARTICIPANT_FLOORS.veryHighValueAmount)) {
    return QUESTION_REWARD_PARTICIPANT_FLOORS.veryHighValueMinParticipants;
  }
  if (amount >= BigInt(QUESTION_REWARD_PARTICIPANT_FLOORS.highValueAmount)) {
    return QUESTION_REWARD_PARTICIPANT_FLOORS.highValueMinParticipants;
  }
  return QUESTION_REWARD_PARTICIPANT_FLOORS.minParticipants;
}

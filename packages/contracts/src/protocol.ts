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

/** Matches `RoundCleanupLib.REVEAL_FAILED_GRACE_MULTIPLIER` in foundry. */
export const REVEAL_FAILED_GRACE_MULTIPLIER = 24;

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

export const CONFIDENTIALITY_FLAG_PRIVATE_FOREVER = 1 as const;

export const MIN_NONZERO_CONFIDENTIALITY_BOND = 1_000_000n;

export const USDC_BY_CHAIN_ID: Record<number, `0x${string}`> = {
  8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  84532: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  480: "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1",
  4801: "0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88",
};

export const WORLD_ID_V3_ROUTER_BY_CHAIN_ID: Record<number, `0x${string}`> = {
  8453: "0xBCC7e5910178AFFEEeBA573ba6903E9869594163",
  84532: "0x42FF98C4E85212a5D31358ACbFe76a621b50fC02",
  480: "0x17B354dD2595411ff79041f930e491A4Df39A278",
  4801: "0x57f928158C3EE7CDad1e4D8642503c4D0201f611",
};

/** @deprecated Use `USDC_BY_CHAIN_ID`; retained while downstream packages migrate names. */
export const WORLD_CHAIN_USDC_BY_CHAIN_ID = USDC_BY_CHAIN_ID;

export const BOUNTY_ELIGIBILITY_CREDENTIAL_MASK = 0x0e as const;
export const BOUNTY_ELIGIBILITY_RECENT_RECHECK_FLAG = 0x80 as const;

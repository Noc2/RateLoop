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
  SettlementPending: 5,
} as const;

export type RoundState = (typeof ROUND_STATE)[keyof typeof ROUND_STATE];

export const ROUND_STATE_LABEL: Record<RoundState, string> = {
  [ROUND_STATE.Open]: "Open",
  [ROUND_STATE.Settled]: "Settled",
  [ROUND_STATE.Cancelled]: "Cancelled",
  [ROUND_STATE.Tied]: "Tied",
  [ROUND_STATE.RevealFailed]: "RevealFailed",
  [ROUND_STATE.SettlementPending]: "SettlementPending",
};

export const PAYOUT_DOMAIN = {
  QuestionReward: 1,
  LaunchCredit: 2,
  PublicRating: 3,
  QuestionBundleReward: 4,
  RbtsSettlement: 5,
} as const;

export type PayoutDomain = (typeof PAYOUT_DOMAIN)[keyof typeof PAYOUT_DOMAIN];

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
  informed: BPS_SCALE,
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

export const BOUNTY_ELIGIBILITY_OPEN = 0 as const;
export const BOUNTY_ELIGIBILITY_VERIFIED_HUMAN = 1 << 3;

export const CONFIDENTIALITY_FLAG_PRIVATE_FOREVER = 1 as const;

export const MIN_NONZERO_CONFIDENTIALITY_BOND = 1_000_000n;

export const USDC_BY_CHAIN_ID: Record<number, `0x${string}`> = {
  8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
};

export const USDC_EIP712_DOMAIN_NAME_BY_CHAIN_ID: Record<number, string> = {
  31337: "USD Coin",
  8453: "USD Coin",
};

export function getUsdcEip712DomainName(chainId: number): string {
  return USDC_EIP712_DOMAIN_NAME_BY_CHAIN_ID[chainId] ?? "USDC";
}

export const WORLD_ID_V3_ROUTER_BY_CHAIN_ID: Record<number, `0x${string}`> = {
  8453: "0xBCC7e5910178AFFEEeBA573ba6903E9869594163",
};

/** @deprecated Use `USDC_BY_CHAIN_ID`; retained while downstream packages migrate names. */
export const WORLD_CHAIN_USDC_BY_CHAIN_ID = USDC_BY_CHAIN_ID;

export const BOUNTY_ELIGIBILITY_CREDENTIAL_MASK = 0x0e as const;
export const BOUNTY_ELIGIBILITY_RECENT_RECHECK_FLAG = 0x80 as const;

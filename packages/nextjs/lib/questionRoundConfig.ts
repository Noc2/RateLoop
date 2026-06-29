import { DEFAULT_ROUND_CONFIG, requiredQuestionRewardParticipants } from "@rateloop/contracts/protocol";

export type QuestionRoundConfig = {
  epochDuration: bigint;
  maxDuration: bigint;
  minVoters: bigint;
  maxVoters: bigint;
};

type SerializedQuestionRoundConfig = {
  questionDurationSeconds: string;
  minVoters: string;
  maxVoters: string;
};

export type QuestionRoundConfigBounds = {
  minEpochDuration: number;
  maxEpochDuration: number;
  minRoundDuration: number;
  maxRoundDuration: number;
  minSettlementVoters: number;
  maxSettlementVoters: number;
  minVoterCap: number;
  maxVoterCap: number;
};

export const MAX_QUESTION_BUNDLE_ROUND_VOTERS = 100;

export const DEFAULT_QUESTION_ROUND_CONFIG: QuestionRoundConfig = {
  epochDuration: BigInt(DEFAULT_ROUND_CONFIG.epochDurationSeconds),
  maxDuration: BigInt(DEFAULT_ROUND_CONFIG.epochDurationSeconds),
  minVoters: BigInt(DEFAULT_ROUND_CONFIG.minVoters),
  maxVoters: BigInt(DEFAULT_ROUND_CONFIG.maxVoters),
};

export const PURE_AGENT_FAST_ROUND_PRESET_ID = "pure_agent_fast";

export const PURE_AGENT_FAST_QUESTION_ROUND_CONFIG: QuestionRoundConfig = {
  epochDuration: 60n,
  maxDuration: 60n,
  minVoters: 3n,
  maxVoters: 3n,
};

export const DEFAULT_QUESTION_ROUND_CONFIG_BOUNDS: QuestionRoundConfigBounds = {
  minEpochDuration: 20,
  maxEpochDuration: 30 * 24 * 60 * 60,
  minRoundDuration: 20,
  maxRoundDuration: 60 * 24 * 60 * 60,
  minSettlementVoters: 3,
  maxSettlementVoters: 100,
  minVoterCap: 3,
  maxVoterCap: 200,
};

export function serializeQuestionRoundConfig(config: QuestionRoundConfig): SerializedQuestionRoundConfig {
  return {
    questionDurationSeconds: config.maxDuration.toString(),
    minVoters: config.minVoters.toString(),
    maxVoters: config.maxVoters.toString(),
  };
}

export function questionRoundConfigToAbi(config: QuestionRoundConfig) {
  const questionDuration = config.epochDuration;
  return {
    epochDuration: Number(questionDuration),
    maxDuration: Number(questionDuration),
    minVoters: Number(config.minVoters),
    maxVoters: Number(config.maxVoters),
  };
}

export function requiredQuestionRewardVotersForAmount(amountAtomic: bigint | number): bigint {
  return BigInt(requiredQuestionRewardParticipants(amountAtomic));
}

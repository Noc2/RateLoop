import {
  bpsToPredictionPercent,
  createTlockRbtsVoteCommit,
  predictionPercentToBps,
  type VoteCiphertext,
  type VoteDrandChainHash,
  type VoteCommitHash,
  type VoteTlockRuntime,
} from "@rateloop/contracts";
import { type Address } from "viem";

export interface CommitVoteParams {
  commitHash: VoteCommitHash;
  ciphertext: VoteCiphertext;
  ciphertextHash: `0x${string}`;
  roundId: bigint;
  roundReferenceRatingBps: number;
  targetRound: bigint;
  drandChainHash: VoteDrandChainHash;
  salt: `0x${string}`;
  stakeWei: bigint;
  frontend: `0x${string}`;
  isUp: boolean;
  predictedUpBps: number;
  predictedUpPercent: number;
}

export function buildStakeAmountWei(stakeAmount: number): bigint {
  return BigInt(Math.round(stakeAmount * 1e6));
}

export function resolveFrontendCode(
  frontendCode?: `0x${string}`,
  defaultFrontendCode?: `0x${string}`,
): `0x${string}` {
  return (
    frontendCode ??
    defaultFrontendCode ??
    "0x0000000000000000000000000000000000000000"
  );
}

export function generateVoteSalt(
  randomValues?: (bytes: Uint8Array) => Uint8Array,
): `0x${string}` {
  const fillRandom =
    randomValues ??
    ((bytes: Uint8Array) => {
      if (!globalThis.crypto?.getRandomValues) {
        throw new Error("Secure random generator unavailable");
      }
      return globalThis.crypto.getRandomValues(bytes);
    });

  const saltBytes = fillRandom(new Uint8Array(32));
  return `0x${Array.from(saltBytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}` as `0x${string}`;
}

export async function buildCommitVoteParams(params: {
  voter: Address;
  contentId: bigint;
  isUp: boolean;
  predictedUpPercent: number;
  stakeAmount: number;
  epochDuration: number;
  roundId: bigint;
  roundReferenceRatingBps: number;
  frontendCode?: `0x${string}`;
  defaultFrontendCode?: `0x${string}`;
  salt?: `0x${string}`;
  runtime?: VoteTlockRuntime;
}): Promise<CommitVoteParams> {
  const stakeWei = buildStakeAmountWei(params.stakeAmount);
  const frontend = resolveFrontendCode(
    params.frontendCode,
    params.defaultFrontendCode,
  );
  const salt = params.salt ?? generateVoteSalt();
  const predictedUpBps = predictionPercentToBps(params.predictedUpPercent);
  const {
    ciphertext,
    ciphertextHash,
    commitHash,
    roundReferenceRatingBps,
    targetRound,
    drandChainHash,
  } = await createTlockRbtsVoteCommit(
    {
      voter: params.voter,
      isUp: params.isUp,
      predictedUpBps,
      salt,
      contentId: params.contentId,
      roundId: params.roundId,
      roundReferenceRatingBps: params.roundReferenceRatingBps,
      epochDurationSeconds: params.epochDuration,
    },
    params.runtime,
  );

  return {
    commitHash,
    ciphertext,
    ciphertextHash,
    roundId: params.roundId,
    roundReferenceRatingBps,
    targetRound,
    drandChainHash,
    salt,
    stakeWei,
    frontend,
    isUp: params.isUp,
    predictedUpBps,
    predictedUpPercent: bpsToPredictionPercent(predictedUpBps),
  };
}

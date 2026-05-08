import {
  bpsToRating,
  createTlockPredictionCommit,
  ratingToBps,
  type VoteCiphertext,
  type VoteDrandChainHash,
  type VoteCommitHash,
  type VoteTlockRuntime,
} from "@ratemesh/contracts";
import { type Address } from "viem";

export interface CommitPredictionParams {
  commitHash: VoteCommitHash;
  ciphertext: VoteCiphertext;
  roundId: bigint;
  roundReferenceRatingBps: number;
  targetRound: bigint;
  drandChainHash: VoteDrandChainHash;
  salt: `0x${string}`;
  stakeWei: bigint;
  frontend: `0x${string}`;
  opinionRatingBps: number;
  predictedCrowdRatingBps: number;
  predictedRatingBps: number;
  rating: number;
  crowdRating: number;
}

export function buildStakeAmountWei(stakeAmount: number): bigint {
  return BigInt(Math.round(stakeAmount * 1e6));
}

export function resolveFrontendCode(frontendCode?: `0x${string}`, defaultFrontendCode?: `0x${string}`): `0x${string}` {
  return frontendCode ?? defaultFrontendCode ?? "0x0000000000000000000000000000000000000000";
}

export function generateVoteSalt(randomValues?: (bytes: Uint8Array) => Uint8Array): `0x${string}` {
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
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("")}` as `0x${string}`;
}

export async function buildCommitPredictionParams(params: {
  voter: Address;
  contentId: bigint;
  opinionRating?: number;
  predictedCrowdRating?: number;
  predictedRating?: number;
  stakeAmount: number;
  epochDuration: number;
  roundId: bigint;
  roundReferenceRatingBps: number;
  frontendCode?: `0x${string}`;
  defaultFrontendCode?: `0x${string}`;
  salt?: `0x${string}`;
  runtime?: VoteTlockRuntime;
}): Promise<CommitPredictionParams> {
  const stakeWei = buildStakeAmountWei(params.stakeAmount);
  const frontend = resolveFrontendCode(params.frontendCode, params.defaultFrontendCode);
  const salt = params.salt ?? generateVoteSalt();
  const opinionRating = params.opinionRating ?? params.predictedRating;
  const predictedCrowdRating = params.predictedCrowdRating ?? params.predictedRating;
  if (opinionRating === undefined || predictedCrowdRating === undefined) {
    throw new Error("opinionRating and predictedCrowdRating are required");
  }
  const opinionRatingBps = ratingToBps(opinionRating);
  const predictedCrowdRatingBps = ratingToBps(predictedCrowdRating);
  const { ciphertext, commitHash, roundReferenceRatingBps, targetRound, drandChainHash } =
    await createTlockPredictionCommit(
      {
        voter: params.voter,
        opinionRatingBps,
        predictedCrowdRatingBps,
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
    roundId: params.roundId,
    roundReferenceRatingBps,
    targetRound,
    drandChainHash,
    salt,
    stakeWei,
    frontend,
    opinionRatingBps,
    predictedCrowdRatingBps,
    predictedRatingBps: predictedCrowdRatingBps,
    rating: bpsToRating(opinionRatingBps),
    crowdRating: bpsToRating(predictedCrowdRatingBps),
  };
}

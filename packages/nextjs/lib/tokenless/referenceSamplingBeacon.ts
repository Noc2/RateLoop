import {
  type DrandBeaconEvidence,
  type DrandChainInfo,
  PINNED_DRAND_CHAINS,
  type VerifiedDrandBeaconEvidence,
  deriveReferenceSampleSeed,
  verifyDrandBeaconEvidence,
} from "@rateloop/node-utils/drand";
import type { TokenlessDrandNetwork } from "~~/lib/tokenless/rater/types";

export interface TokenlessReferenceSampleBeacon {
  readonly network: TokenlessDrandNetwork;
  readonly chainInfo: DrandChainInfo;
  readonly evidence: DrandBeaconEvidence;
  readonly expectedRound: number;
}

/** Verifies reference-sampling beacon evidence against RateLoop's pinned network. */
export function verifyTokenlessReferenceSampleBeacon(
  input: TokenlessReferenceSampleBeacon,
): VerifiedDrandBeaconEvidence {
  return verifyDrandBeaconEvidence({
    chain: PINNED_DRAND_CHAINS[input.network],
    chainInfo: input.chainInfo,
    beacon: input.evidence,
    expectedRound: input.expectedRound,
  });
}

/** Derives the seed used by a frozen reference-sampling frame and method. */
export function deriveTokenlessReferenceSampleSeed(
  input: TokenlessReferenceSampleBeacon & {
    readonly frameDigest: string;
    readonly samplingMethod: string;
  },
): `sha256:${string}` {
  return deriveReferenceSampleSeed({
    chain: PINNED_DRAND_CHAINS[input.network],
    chainInfo: input.chainInfo,
    beacon: input.evidence,
    expectedRound: input.expectedRound,
    frameDigest: input.frameDigest,
    samplingMethod: input.samplingMethod,
  });
}

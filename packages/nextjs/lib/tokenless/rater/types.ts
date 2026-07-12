import type { Address, Hex } from "viem";

export const TOKENLESS_PREDICTION_BUCKETS = [1000, 3000, 5000, 7000, 9000] as const;

export type TokenlessPredictionBucket = (typeof TOKENLESS_PREDICTION_BUCKETS)[number];
export type TokenlessVote = 0 | 1;

export interface TokenlessRevealMaterial {
  roundId: bigint;
  voteKey: Address;
  vote: TokenlessVote;
  predictedUpBps: TokenlessPredictionBucket;
  responseHash: Hex;
  payoutAddress: Address;
  salt: Hex;
}

/**
 * Private client state for one round. This object must never be serialized into
 * a request, log, analytics event, or server component boundary.
 */
export interface TokenlessRaterRoundSecrets {
  schemaVersion: "rateloop.tokenless.rater-secrets.v1";
  votePrivateKey: Hex;
  payoutPrivateKey: Hex;
  reveal: TokenlessRevealMaterial;
}

export interface TokenlessSealedReveal {
  roundId: bigint;
  drandNetwork: TokenlessDrandNetwork;
  beaconRound: number;
  sealedPayload: Hex;
  sealedPayloadHash: Hex;
  sealedCommitment: Hex;
  payoutCommitment: Hex;
}

export interface TokenlessCommitAuthorization extends TokenlessSealedReveal {
  panelAddress: Address;
  chainId: number;
  nullifier: Hex;
  voteKey: Address;
  voteKeySignature: Hex;
}

export type TokenlessDrandNetwork = "quicknet" | "quicknet-t";

export interface TokenlessRecoveryPackageV1 {
  schemaVersion: "rateloop.tokenless.rater-recovery.v1";
  kdf: {
    name: "PBKDF2";
    hash: "SHA-256";
    iterations: number;
    salt: string;
  };
  cipher: {
    name: "AES-GCM";
    iv: string;
    ciphertext: string;
  };
}

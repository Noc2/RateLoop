import type { Address, Hex } from "viem";

export enum TokenlessRoundState {
  Open,
  Revealable,
  Aggregating,
  Weighting,
  Finalized,
  ZeroCommitRefund,
  UnderQuorumCompensation,
  BeaconFailureCompensation,
}

export interface TokenlessRound {
  funder: Address;
  contentId: Hex;
  termsHash: Hex;
  beaconNetworkHash: Hex;
  feeRecipient: Address;
  bountyAmount: bigint;
  feeAmount: bigint;
  attemptReserve: bigint;
  attemptCompensation: bigint;
  compensationPerRecipient: bigint;
  totalAccuracyScore: bigint;
  totalPaid: bigint;
  commitDeadline: bigint;
  revealDeadline: bigint;
  beaconFailureDeadline: bigint;
  beaconRound: bigint;
  claimGracePeriod: bigint;
  claimDeadline: bigint;
  minimumReveals: number;
  maximumCommits: number;
  requiredTier: number;
  commitCount: number;
  revealCount: number;
  frozenRevealCount: number;
  aggregateCursor: number;
  weightCursor: number;
  upVotes: number;
  state: TokenlessRoundState;
  staleReturned: boolean;
}

export interface TokenlessCommit {
  roundId: bigint;
  voteKey: Address;
  sealedCommitment: Hex;
  sealedPayloadHash: Hex;
  payoutCommitment: Hex;
  responseHash: Hex;
  accuracyScore: bigint;
  predictedUpBps: number;
  vote: number;
  revealed: boolean;
  claimed: boolean;
}

export interface TokenlessRevealMaterial {
  roundId: bigint;
  voteKey: Address;
  vote: 0 | 1;
  predictedUpBps: 1000 | 3000 | 5000 | 7000 | 9000;
  responseHash: Hex;
  payoutAddress: Address;
  salt: Hex;
}

export interface TokenlessKeeperResult {
  roundsScanned: number;
  revealWindowsOpened: number;
  votesRevealed: number;
  settlementsBegun: number;
  aggregateBatchesProcessed: number;
  weightBatchesProcessed: number;
  roundsFinalized: number;
  terminalRoundsAdvanced: number;
  claimsExecuted: number;
  staleReturnsExecuted: number;
  selfRevealFallbacksPending: number;
}

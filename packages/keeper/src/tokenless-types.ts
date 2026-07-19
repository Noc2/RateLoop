import type { Address, Hex } from "viem";

export enum TokenlessRoundState {
  Open,
  Revealable,
  Aggregating,
  AwaitingSeed,
  Scoring,
  Finalized,
  ZeroCommitRefund,
  UnderQuorumCompensation,
  BeaconFailureCompensation,
}

export enum TokenlessScoringMode {
  Pending,
  Rbts,
  BaseOnlyBeaconUnavailable,
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
  fixedBasePay: bigint;
  maximumBonus: bigint;
  compensationPerRecipient: bigint;
  totalRbtsScoreBps: bigint;
  totalFinalizedLiability: bigint;
  totalPaid: bigint;
  revealSetXor: Hex;
  revealSetSum: bigint;
  scoringSeed: Hex;
  beaconEntropy: Hex;
  commitDeadline: bigint;
  revealDeadline: bigint;
  beaconFailureDeadline: bigint;
  beaconRound: bigint;
  claimGracePeriod: bigint;
  claimDeadline: bigint;
  minimumReveals: number;
  maximumCommits: number;
  admissionPolicyHash: Hex;
  commitCount: number;
  revealCount: number;
  compensatedRevealCount: number;
  frozenRevealCount: number;
  aggregateCursor: number;
  scoreCursor: number;
  upVotes: number;
  state: TokenlessRoundState;
  scoringMode: TokenlessScoringMode;
  staleReturned: boolean;
}

export interface TokenlessCommit {
  roundId: bigint;
  voteKey: Address;
  sealedCommitment: Hex;
  sealedPayloadHash: Hex;
  payoutCommitment: Hex;
  responseHash: Hex;
  referenceCommitKey: Hex;
  peerCommitKey: Hex;
  finalizedPayout: bigint;
  predictedUpBps: number;
  informationScoreBps: number;
  predictionScoreBps: number;
  rbtsScoreBps: number;
  vote: number;
  revealed: boolean;
  claimed: boolean;
}

export interface TokenlessRevealMaterial {
  roundId: bigint;
  voteKey: Address;
  vote: 0 | 1;
  predictedUpBps: number;
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
  scoringSeedsFinalized: number;
  scoreBatchesProcessed: number;
  roundsFinalized: number;
  terminalRoundsAdvanced: number;
  claimsExecuted: number;
  staleReturnsExecuted: number;
  feedbackBonusRefundsExecuted: number;
  selfRevealFallbacksPending: number;
  roundsAwaitingBeaconFailure: number;
  roundsAwaitingScoringEntropy: number;
}

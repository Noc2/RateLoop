/** Fields from RoundVotingEngine.getRound() — matches RoundLib.Round struct */
export interface RoundData {
  startTime: bigint;
  state: number;
  voteCount: bigint;
  revealedCount: bigint;
  totalStake: bigint;
  upPool: bigint;
  downPool: bigint;
  upCount: bigint;
  downCount: bigint;
  upWins: boolean;
  settledAt: bigint;
  thresholdReachedAt: bigint;
  weightedUpPool: bigint;
  weightedDownPool: bigint;
}

/** Fields from RoundVotingEngine.commitRevealData() */
export interface CommitData {
  ciphertextHash: `0x${string}`;
  targetRound?: bigint;
  drandChainHash?: `0x${string}`;
  revealableAfter: bigint;
  revealed: boolean;
  stakeAmount: bigint;
}

export const ROUND_STATE = {
  OPEN: 0,
  REVEALABLE: 1,
  AGGREGATING: 2,
  WEIGHTING: 3,
  FINALIZED: 4,
  ZERO_COMMIT_REFUND: 5,
  UNDER_QUORUM_COMPENSATION: 6,
  BEACON_FAILURE_COMPENSATION: 7,
} as const;

export const ROUND_STATUS = [
  "open",
  "revealable",
  "aggregating",
  "weighting",
  "finalized",
  "zero_commit_refunded",
  "under_quorum_compensated",
  "beacon_failure_compensated",
] as const;

export interface KeeperRound {
  roundId: bigint;
  state: number;
  commitCount: number;
  revealCount: number;
  minimumReveals: number;
  frozenRevealCount: number;
  aggregateCursor: number;
  weightCursor: number;
  commitDeadline: bigint;
  revealDeadline: bigint;
  beaconFailureDeadline: bigint;
  claimDeadline: bigint;
  staleReturned: boolean;
}

export function publicRoundStatus(round: Pick<KeeperRound, "state" | "commitDeadline" | "revealDeadline">, now: bigint) {
  if (round.state === ROUND_STATE.OPEN && now > round.commitDeadline && now <= round.revealDeadline) {
    return "revealable";
  }
  return ROUND_STATUS[round.state] ?? "unknown";
}

export function verdictStatus(state: number) {
  if (state === ROUND_STATE.FINALIZED) return "pending_analytics";
  if (state === ROUND_STATE.ZERO_COMMIT_REFUND) return "zero_commit_refunded";
  if (state === ROUND_STATE.UNDER_QUORUM_COMPENSATION) return "under_quorum_compensated";
  if (state === ROUND_STATE.BEACON_FAILURE_COMPENSATION) return "beacon_failure_compensated";
  return null;
}

export function keeperAction(round: KeeperRound, now: bigint) {
  if (round.state === ROUND_STATE.OPEN && now > round.commitDeadline && now <= round.revealDeadline) {
    return "open_reveal";
  }
  if ((round.state === ROUND_STATE.OPEN || round.state === ROUND_STATE.REVEALABLE) && now > round.revealDeadline) {
    if (round.commitCount > 0 && round.revealCount === 0 && now <= round.beaconFailureDeadline) return null;
    return "begin_settlement";
  }
  if (round.state === ROUND_STATE.AGGREGATING) return "process_aggregate";
  if (round.state === ROUND_STATE.WEIGHTING) {
    return round.weightCursor < round.frozenRevealCount ? "process_weights" : "finalize_settlement";
  }
  if (
    (round.state === ROUND_STATE.FINALIZED ||
      round.state === ROUND_STATE.UNDER_QUORUM_COMPENSATION ||
      round.state === ROUND_STATE.BEACON_FAILURE_COMPENSATION) &&
    !round.staleReturned &&
    round.claimDeadline > 0n &&
    now > round.claimDeadline
  ) {
    return "return_stale_shares";
  }
  return null;
}

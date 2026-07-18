export const ROUND_STATE = {
  OPEN: 0,
  REVEALABLE: 1,
  AGGREGATING: 2,
  AWAITING_SEED: 3,
  SCORING: 4,
  FINALIZED: 5,
  ZERO_COMMIT_REFUND: 6,
  UNDER_QUORUM_COMPENSATION: 7,
  BEACON_FAILURE_COMPENSATION: 8,
} as const;

export const ROUND_STATUS = [
  "open",
  "revealable",
  "aggregating",
  "awaiting_seed",
  "scoring",
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
  scoreCursor: number;
  commitDeadline: bigint;
  revealDeadline: bigint;
  beaconFailureDeadline: bigint;
  claimDeadline: bigint;
  staleReturned: boolean;
}

export function revealTalliesAfterVote(
  current: { revealCount: number; upVotes: number },
  vote: number,
  scoringEligible: boolean,
): { revealCount: number; upVotes: number } {
  if (vote !== 0 && vote !== 1) throw new Error("vote must be 0 or 1");
  if (!scoringEligible) return current;
  return {
    revealCount: current.revealCount + 1,
    upVotes: current.upVotes + vote,
  };
}

export function publicRoundStatus(
  round: Pick<
    KeeperRound,
    "state" | "commitDeadline" | "revealDeadline" | "beaconFailureDeadline"
  >,
  now: bigint,
) {
  if (
    round.state === ROUND_STATE.OPEN &&
    now > round.commitDeadline &&
    now <= round.beaconFailureDeadline
  ) {
    return "revealable";
  }
  return ROUND_STATUS[round.state] ?? "unknown";
}

export function verdictStatus(state: number) {
  if (state === ROUND_STATE.FINALIZED) return "pending";
  if (state === ROUND_STATE.ZERO_COMMIT_REFUND) return "zero_commit_refunded";
  if (state === ROUND_STATE.UNDER_QUORUM_COMPENSATION)
    return "under_quorum_compensated";
  if (state === ROUND_STATE.BEACON_FAILURE_COMPENSATION)
    return "beacon_failure_compensated";
  return null;
}

export function creditBalanceAfterEvent(
  remainingCredit: bigint,
  eventType: "accrued" | "withdrawn",
  amount: bigint,
) {
  if (amount < 0n) throw new Error("Credit event amount cannot be negative.");
  if (eventType === "accrued") return remainingCredit + amount;
  if (amount > remainingCredit) {
    throw new Error("Credit withdrawal exceeds the indexed owner balance.");
  }
  return remainingCredit - amount;
}

export function keeperAction(round: KeeperRound, now: bigint) {
  // The event-derived index cannot distinguish an on-chain Open round from one
  // whose permissionless openReveal call already moved it to Revealable, because
  // that transition has no event. Neither reveal nor settlement requires an
  // explicit openReveal call, so the indexed work feed deliberately omits it
  // instead of emitting stale, reverting work.
  if (
    (round.state === ROUND_STATE.OPEN ||
      round.state === ROUND_STATE.REVEALABLE) &&
    now > round.revealDeadline
  ) {
    if (
      round.commitCount > 0 &&
      round.revealCount < round.minimumReveals &&
      now <= round.beaconFailureDeadline
    )
      return null;
    return "begin_settlement";
  }
  if (round.state === ROUND_STATE.AGGREGATING) return "process_aggregate";
  if (round.state === ROUND_STATE.AWAITING_SEED) return "finalize_scoring_seed";
  if (round.state === ROUND_STATE.SCORING) {
    return round.scoreCursor < round.frozenRevealCount
      ? "process_scores"
      : "finalize_settlement";
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

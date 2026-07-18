import { describe, expect, it } from "vitest";
import {
  creditBalanceAfterEvent,
  keeperAction,
  publicRoundStatus,
  revealTalliesAfterVote,
  ROUND_STATE,
  type KeeperRound,
  verdictStatus,
} from "../src/status";

function round(overrides: Partial<KeeperRound> = {}): KeeperRound {
  return {
    roundId: 1n,
    state: ROUND_STATE.OPEN,
    commitCount: 0,
    revealCount: 0,
    minimumReveals: 2,
    frozenRevealCount: 0,
    aggregateCursor: 0,
    scoreCursor: 0,
    commitDeadline: 100n,
    revealDeadline: 200n,
    beaconFailureDeadline: 300n,
    claimDeadline: 0n,
    staleReturned: false,
    ...overrides,
  };
}

describe("tokenless public and keeper state", () => {
  it("derives revealable status despite openReveal having no event", () => {
    expect(publicRoundStatus(round(), 101n)).toBe("revealable");
    expect(publicRoundStatus(round(), 250n)).toBe("revealable");
    expect(keeperAction(round(), 101n)).toBe("open_reveal");
  });

  it("waits for the beacon failure deadline when no reveal exists", () => {
    const value = round({ state: ROUND_STATE.REVEALABLE, commitCount: 2 });
    expect(keeperAction(value, 201n)).toBeNull();
    expect(keeperAction(value, 301n)).toBe("begin_settlement");
    expect(keeperAction(round({ commitCount: 2 }), 201n)).toBe("open_reveal");
    expect(
      keeperAction(
        round({
          state: ROUND_STATE.REVEALABLE,
          commitCount: 3,
          revealCount: 1,
          minimumReveals: 2,
        }),
        201n,
      ),
    ).toBeNull();
    expect(
      keeperAction(
        round({ commitCount: 3, revealCount: 1, minimumReveals: 2 }),
        201n,
      ),
    ).toBe("open_reveal");
    expect(
      keeperAction(
        round({ commitCount: 3, revealCount: 2, minimumReveals: 2 }),
        201n,
      ),
    ).toBe("begin_settlement");
  });

  it("continues every paginated and stale terminal path permissionlessly", () => {
    expect(keeperAction(round({ state: ROUND_STATE.AGGREGATING }), 250n)).toBe(
      "process_aggregate",
    );
    expect(
      keeperAction(
        round({ state: ROUND_STATE.AWAITING_SEED, frozenRevealCount: 3 }),
        250n,
      ),
    ).toBe("finalize_scoring_seed");
    expect(
      keeperAction(
        round({
          state: ROUND_STATE.SCORING,
          frozenRevealCount: 3,
          scoreCursor: 2,
        }),
        250n,
      ),
    ).toBe("process_scores");
    expect(
      keeperAction(
        round({
          state: ROUND_STATE.SCORING,
          frozenRevealCount: 3,
          scoreCursor: 3,
        }),
        250n,
      ),
    ).toBe("finalize_settlement");
    expect(
      keeperAction(
        round({ state: ROUND_STATE.FINALIZED, claimDeadline: 400n }),
        401n,
      ),
    ).toBe("return_stale_shares");
  });

  it("does not imply analytics publication from payout finality", () => {
    expect(verdictStatus(ROUND_STATE.FINALIZED)).toBe("pending");
    expect(verdictStatus(ROUND_STATE.ZERO_COMMIT_REFUND)).toBe(
      "zero_commit_refunded",
    );
    expect(verdictStatus(ROUND_STATE.OPEN)).toBeNull();
  });

  it("tracks pull-credit accruals and withdrawals without allowing an indexed underflow", () => {
    expect(creditBalanceAfterEvent(2_000_000n, "accrued", 500_000n)).toBe(
      2_500_000n,
    );
    expect(creditBalanceAfterEvent(2_500_000n, "withdrawn", 2_500_000n)).toBe(
      0n,
    );
    expect(() => creditBalanceAfterEvent(1n, "withdrawn", 2n)).toThrow(
      "exceeds the indexed owner balance",
    );
  });

  it("counts only scoring-eligible reveals and their revealed up-votes", () => {
    expect(
      revealTalliesAfterVote({ revealCount: 2, upVotes: 1 }, 1, true),
    ).toEqual({ revealCount: 3, upVotes: 2 });
    expect(
      revealTalliesAfterVote({ revealCount: 3, upVotes: 2 }, 0, true),
    ).toEqual({ revealCount: 4, upVotes: 2 });
    expect(
      revealTalliesAfterVote({ revealCount: 3, upVotes: 2 }, 1, false),
    ).toEqual({ revealCount: 3, upVotes: 2 });
    expect(() =>
      revealTalliesAfterVote({ revealCount: 0, upVotes: 0 }, 2, false),
    ).toThrow("vote must be 0 or 1");
  });
});

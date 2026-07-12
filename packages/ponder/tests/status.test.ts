import { describe, expect, it } from "vitest";
import {
  creditBalanceAfterEvent,
  keeperAction,
  publicRoundStatus,
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
    weightCursor: 0,
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
    expect(keeperAction(round(), 101n)).toBe("open_reveal");
  });

  it("waits for the beacon failure deadline when no reveal exists", () => {
    const value = round({ commitCount: 2 });
    expect(keeperAction(value, 201n)).toBeNull();
    expect(keeperAction(value, 301n)).toBe("begin_settlement");
  });

  it("continues every paginated and stale terminal path permissionlessly", () => {
    expect(keeperAction(round({ state: ROUND_STATE.AGGREGATING }), 250n)).toBe("process_aggregate");
    expect(
      keeperAction(round({ state: ROUND_STATE.WEIGHTING, frozenRevealCount: 3, weightCursor: 2 }), 250n),
    ).toBe("process_weights");
    expect(
      keeperAction(round({ state: ROUND_STATE.WEIGHTING, frozenRevealCount: 3, weightCursor: 3 }), 250n),
    ).toBe("finalize_settlement");
    expect(
      keeperAction(round({ state: ROUND_STATE.FINALIZED, claimDeadline: 400n }), 401n),
    ).toBe("return_stale_shares");
  });

  it("does not imply analytics publication from payout finality", () => {
    expect(verdictStatus(ROUND_STATE.FINALIZED)).toBe("pending_analytics");
    expect(verdictStatus(ROUND_STATE.ZERO_COMMIT_REFUND)).toBe("zero_commit_refunded");
    expect(verdictStatus(ROUND_STATE.OPEN)).toBeNull();
  });

  it("tracks pull-credit accruals and withdrawals without allowing an indexed underflow", () => {
    expect(creditBalanceAfterEvent(2_000_000n, "accrued", 500_000n)).toBe(2_500_000n);
    expect(creditBalanceAfterEvent(2_500_000n, "withdrawn", 2_500_000n)).toBe(0n);
    expect(() => creditBalanceAfterEvent(1n, "withdrawn", 2n)).toThrow(
      "exceeds the indexed owner balance",
    );
  });
});

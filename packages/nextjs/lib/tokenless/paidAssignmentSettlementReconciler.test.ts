import assert from "node:assert/strict";
import test from "node:test";
import { __paidAssignmentSettlementReconcilerTestUtils as utils } from "~~/lib/tokenless/paidAssignmentSettlementReconciler";

const round = {
  roundId: "42",
  state: 5,
  status: "finalized",
  compensationPerRecipient: "0",
  claimDeadline: "200",
  staleReturned: false,
};

function settlement(input: { revealed?: boolean; claimed?: boolean; payout?: string; claimAmount?: string } = {}) {
  return {
    commit: {
      revealed: input.revealed ?? true,
      claimed: input.claimed ?? false,
      scoringEligible: true,
      finalizedPayout: input.payout ?? "1000000",
    },
    round,
    claim: input.claimed
      ? {
          amount: input.claimAmount ?? input.payout ?? "1000000",
          transactionHash: `0x${"9".repeat(64)}`,
        }
      : null,
  };
}

test("terminal outcomes distinguish claims, expiry, no-payout and stale refunds", () => {
  assert.equal(utils.terminalOutcome({ settlement: settlement({ claimed: true }), round, nowSeconds: 150n }), "paid");
  assert.equal(utils.terminalOutcome({ settlement: settlement(), round, nowSeconds: 201n }), "claim_expired");
  assert.equal(
    utils.terminalOutcome({
      settlement: settlement({ payout: "0" }),
      round: { ...round, state: 6 },
      nowSeconds: 150n,
    }),
    "no_payout",
  );
  assert.equal(
    utils.terminalOutcome({
      settlement: settlement(),
      round: { ...round, staleReturned: true },
      nowSeconds: 150n,
    }),
    "stale_refunded",
  );
});

test("terminal settlement evidence carries only chain and committed seat identifiers", () => {
  const operation = {
    deployment_key: "tokenless-test",
    chain_id: 84532,
    panel_address: `0x${"1".repeat(40)}`,
    round_id: "42",
  };
  const seat = {
    seat_id: "seat_terminal",
    assignment_id: "assignment_terminal",
    commit_id: "commit_terminal",
    vote_key: `0x${"2".repeat(40)}`,
  };
  const terminal = utils.terminalSeatEvidence({
    operation,
    seat,
    outcome: "paid",
    indexedRound: round,
    indexedSettlement: settlement({ claimed: true }),
    now: new Date("2026-07-26T12:00:00.000Z"),
  });
  assert.match(terminal.reference, /^chain:84532:0x[0-9a-f]{40}:42:0x[0-9a-f]{64}:paid$/u);
  assert.match(terminal.evidenceHash, /^sha256:[0-9a-f]{64}$/u);
  const encoded = JSON.stringify(terminal.evidence);
  assert.doesNotMatch(encoded, /principal|payoutAccount|reviewerAccount/u);
});

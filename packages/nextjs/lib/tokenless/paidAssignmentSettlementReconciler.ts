import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { getAddress, isAddress, isHash } from "viem";
import { dbPool } from "~~/lib/db";
import { loadTokenlessChainConfig } from "~~/lib/tokenless/chain/config";
import { maintenanceCancellationRequested, maintenanceRequestSignal } from "~~/lib/tokenless/maintenanceCancellation";
import { tokenlessCommitKey } from "~~/lib/tokenless/rater/settlementRecovery";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;
type SeatState = "planned" | "voucher_prepared" | "accepted" | "committed" | "revealed" | "terminal";
type SeatTerminalOutcome =
  | "paid"
  | "compensated"
  | "no_payout"
  | "claim_expired"
  | "stale_refunded"
  | "not_accepted"
  | "not_submitted"
  | "reveal_expired";

const TERMINAL_ROUND_STATES = new Set([5, 6, 7, 8]);
const UNSIGNED = /^(?:0|[1-9][0-9]*)$/u;

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function integer(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Indexed ${label} is invalid.`);
  return parsed;
}

function unsigned(value: unknown, label: string) {
  const normalized = typeof value === "bigint" ? value.toString(10) : String(value ?? "");
  if (!UNSIGNED.test(normalized)) throw new Error(`Indexed ${label} is invalid.`);
  return normalized;
}

function record(value: unknown, label: string): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Indexed ${label} is invalid.`);
  return value as Row;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Settlement evidence is not canonicalizable.");
  return encoded;
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}` as const;
}

function configuredPonderUrl(raw = process.env.TOKENLESS_PONDER_URL ?? process.env.NEXT_PUBLIC_PONDER_URL) {
  const value = raw?.trim() || (process.env.NODE_ENV === "production" ? "" : "http://127.0.0.1:42069");
  if (!value) throw new TokenlessServiceError("Settlement index is unavailable.", 503, "ponder_unavailable", true);
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.hash ||
    !["http:", "https:"].includes(url.protocol) ||
    (process.env.NODE_ENV === "production" && url.protocol !== "https:")
  ) {
    throw new TokenlessServiceError("Settlement index is unavailable.", 503, "ponder_unavailable", true);
  }
  return url;
}

function endpoint(base: URL, path: string) {
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/$/u, "")}/${path.replace(/^\//u, "")}`;
  url.search = "";
  return url;
}

async function fetchJson(fetchImpl: typeof fetch, url: URL, signal?: AbortSignal) {
  const response = await fetchImpl(url, {
    headers: { accept: "application/json" },
    cache: "no-store",
    redirect: "error",
    signal: maintenanceRequestSignal(signal, 10_000),
  });
  if (!response.ok) throw new Error(`Settlement index returned ${response.status}.`);
  return (await response.json()) as unknown;
}

type IndexedSettlement = {
  commit: Row;
  round: Row;
  claim: Row | null;
};

async function indexedOperationSettlement(input: {
  fetchImpl: typeof fetch;
  ponderUrl: URL;
  operation: Row;
  seats: Row[];
  signal?: AbortSignal;
}) {
  const roundId = text(input.operation, "round_id")!;
  const commitKeys = input.seats.flatMap(seat => {
    const voteKey = text(seat, "vote_key");
    return voteKey && isAddress(voteKey)
      ? [tokenlessCommitKey(BigInt(roundId), getAddress(voteKey)).toLowerCase()]
      : [];
  });
  const roundPromise = fetchJson(
    input.fetchImpl,
    endpoint(input.ponderUrl, `/rounds/${encodeURIComponent(roundId)}`),
    input.signal,
  );
  const settlementsPromise =
    commitKeys.length === 0
      ? Promise.resolve({
          schemaVersion: "rateloop.indexed-settlements.v1",
          deploymentKey: text(input.operation, "deployment_key"),
          chainId: Number(input.operation.chain_id),
          panelAddress: text(input.operation, "panel_address"),
          items: [],
        })
      : (() => {
          const url = endpoint(input.ponderUrl, "/settlements");
          url.searchParams.set("commitKeys", commitKeys.join(","));
          return fetchJson(input.fetchImpl, url, input.signal);
        })();
  const [roundValue, settlementValue] = await Promise.all([roundPromise, settlementsPromise]);
  const round = record(roundValue, "round");
  const envelope = record(settlementValue, "settlement envelope");
  const config = loadTokenlessChainConfig();
  if (
    text(input.operation, "deployment_key") !== config.deploymentKey ||
    Number(input.operation.chain_id) !== config.chainId ||
    !isAddress(text(input.operation, "panel_address") ?? "") ||
    getAddress(text(input.operation, "panel_address")!) !== config.panelAddress ||
    String(envelope.schemaVersion ?? "") !== "rateloop.indexed-settlements.v1" ||
    String(envelope.deploymentKey ?? "") !== config.deploymentKey ||
    integer(envelope.chainId, "chain ID") !== config.chainId ||
    !isAddress(String(envelope.panelAddress ?? "")) ||
    getAddress(String(envelope.panelAddress)) !== config.panelAddress ||
    unsigned(round.roundId, "round ID") !== roundId ||
    !Array.isArray(envelope.items)
  ) {
    throw new Error("Indexed settlement identity does not match the paid assignment.");
  }
  const byCommitKey = new Map<string, IndexedSettlement>();
  for (const value of envelope.items) {
    const item = record(value, "settlement item");
    const commit = record(item.commit, "settlement commit");
    const indexedRound = record(item.round, "settlement round");
    const commitKey = String(commit.commitKey ?? "").toLowerCase();
    if (
      !isHash(commitKey) ||
      !commitKeys.includes(commitKey) ||
      byCommitKey.has(commitKey) ||
      unsigned(indexedRound.roundId, "settlement round ID") !== roundId
    ) {
      throw new Error("Indexed settlement item does not match the paid assignment.");
    }
    byCommitKey.set(commitKey, {
      commit,
      round: indexedRound,
      claim: item.claim === null || item.claim === undefined ? null : record(item.claim, "settlement claim"),
    });
  }
  return { round, byCommitKey };
}

function seatReceipt(input: {
  operationId: string;
  seatId: string;
  revision: number;
  receiptType: string;
  payload: unknown;
  now: Date;
}) {
  const document = {
    schemaVersion: "rateloop.paid-assignment-seat-receipt.v1",
    operationId: input.operationId,
    seatId: input.seatId,
    revision: input.revision,
    receiptType: input.receiptType,
    payload: input.payload,
    occurredAt: input.now.toISOString(),
  };
  const receiptHash = sha256(document);
  return {
    receiptId: `parec_${receiptHash.slice("sha256:".length, "sha256:".length + 40)}`,
    receiptJson: stableJson(document),
    receiptHash,
  };
}

async function transitionSeat(
  client: PoolClient,
  input: {
    operationId: string;
    seat: Row;
    state: Exclude<SeatState, "planned" | "voucher_prepared">;
    now: Date;
    fields?: {
      commitId?: string;
      acceptedAt?: Date;
      committedAt?: Date;
      revealedAt?: Date;
      terminalOutcome?: SeatTerminalOutcome;
      settlementReference?: string;
      settlementEvidenceHash?: string;
      terminalAt?: Date;
    };
    evidence: unknown;
  },
) {
  const seatId = text(input.seat, "seat_id")!;
  const position = integer(input.seat.position, "seat position");
  const revision = integer(input.seat.transition_revision, "seat revision") + 1;
  const receiptType = `seat_${input.state}`;
  const receipt = seatReceipt({
    operationId: input.operationId,
    seatId,
    revision,
    receiptType,
    payload: input.evidence,
    now: input.now,
  });
  await client.query(
    `INSERT INTO tokenless_paid_assignment_receipts
       (receipt_id,operation_id,seat_id,sequence,operation_revision,seat_revision,
        receipt_type,receipt_version,receipt_json,receipt_hash,created_at)
     VALUES ($1,$2,$3,$4,NULL,$5,$6,1,$7,$8,$9)
     ON CONFLICT (seat_id,seat_revision) DO NOTHING`,
    [
      receipt.receiptId,
      input.operationId,
      seatId,
      revision * 1_000 + position,
      revision,
      receiptType,
      receipt.receiptJson,
      receipt.receiptHash,
      input.now,
    ],
  );
  const updated = await client.query(
    `UPDATE tokenless_paid_assignment_seats
     SET state=$1,transition_revision=$2,
         commit_id=COALESCE($3,commit_id),
         accepted_at=COALESCE($4,accepted_at),
         committed_at=COALESCE($5,committed_at),
         revealed_at=COALESCE($6,revealed_at),
         terminal_outcome=$7,settlement_reference=$8,settlement_evidence_hash=$9,terminal_at=$10,
         updated_at=$11
     WHERE seat_id=$12 AND transition_revision=$13
     RETURNING *`,
    [
      input.state,
      revision,
      input.fields?.commitId ?? null,
      input.fields?.acceptedAt ?? null,
      input.fields?.committedAt ?? null,
      input.fields?.revealedAt ?? null,
      input.fields?.terminalOutcome ?? null,
      input.fields?.settlementReference ?? null,
      input.fields?.settlementEvidenceHash ?? null,
      input.fields?.terminalAt ?? null,
      input.now,
      seatId,
      revision - 1,
    ],
  );
  if (updated.rowCount !== 1) throw new Error("Paid assignment seat changed during settlement reconciliation.");
  return updated.rows[0] as Row;
}

async function operationReceipt(
  client: PoolClient,
  input: {
    operation: Row;
    state: "active" | "settling" | "terminal";
    now: Date;
    payload: unknown;
    terminal?: { reference: string; evidenceHash: string };
  },
) {
  const operationId = text(input.operation, "operation_id")!;
  const revision = integer(input.operation.transition_revision, "operation revision") + 1;
  const receiptType = `operation_${input.state}`;
  const document = {
    schemaVersion: "rateloop.paid-assignment-receipt.v1",
    operationId,
    sequence: revision,
    receiptType,
    payload: input.payload,
    occurredAt: input.now.toISOString(),
  };
  const receiptJson = stableJson(document);
  const receiptHash = sha256(document);
  await client.query(
    `INSERT INTO tokenless_paid_assignment_receipts
       (receipt_id,operation_id,seat_id,sequence,operation_revision,seat_revision,
        receipt_type,receipt_version,receipt_json,receipt_hash,created_at)
     VALUES ($1,$2,NULL,$3,$3,NULL,$4,1,$5,$6,$7)
     ON CONFLICT (operation_id,operation_revision) DO NOTHING`,
    [
      `parec_${receiptHash.slice("sha256:".length, "sha256:".length + 40)}`,
      operationId,
      revision,
      receiptType,
      receiptJson,
      receiptHash,
      input.now,
    ],
  );
  const updated = await client.query(
    `UPDATE tokenless_paid_assignment_operations
     SET state=$1,transition_revision=$2,
         terminal_outcome=$3,settlement_reference=$4,settlement_evidence_hash=$5,terminal_at=$6,
         updated_at=$7
     WHERE operation_id=$8 AND transition_revision=$9
     RETURNING *`,
    [
      input.state,
      revision,
      input.state === "terminal" ? "all_seats_terminal" : null,
      input.terminal?.reference ?? null,
      input.terminal?.evidenceHash ?? null,
      input.state === "terminal" ? input.now : null,
      input.now,
      operationId,
      revision - 1,
    ],
  );
  if (updated.rowCount !== 1) throw new Error("Paid assignment operation changed during reconciliation.");
  return updated.rows[0] as Row;
}

function terminalSeatEvidence(input: {
  operation: Row;
  seat: Row;
  outcome: SeatTerminalOutcome;
  indexedRound: Row;
  indexedSettlement?: IndexedSettlement;
  now: Date;
}) {
  const commitKey =
    input.seat.vote_key && isAddress(String(input.seat.vote_key))
      ? tokenlessCommitKey(BigInt(text(input.operation, "round_id")!), getAddress(String(input.seat.vote_key)))
      : null;
  const evidence = {
    schemaVersion: "rateloop.paid-assignment-seat-settlement.v1",
    deploymentKey: text(input.operation, "deployment_key"),
    chainId: Number(input.operation.chain_id),
    panelAddress: text(input.operation, "panel_address"),
    roundId: text(input.operation, "round_id"),
    seatId: text(input.seat, "seat_id"),
    assignmentId: text(input.seat, "assignment_id"),
    commitId: text(input.seat, "commit_id"),
    commitKey,
    outcome: input.outcome,
    round: {
      state: integer(input.indexedRound.state, "round state"),
      status: String(input.indexedRound.status ?? ""),
      claimDeadline: unsigned(input.indexedRound.claimDeadline ?? "0", "claim deadline"),
      staleReturned: input.indexedRound.staleReturned === true,
    },
    commit: input.indexedSettlement
      ? {
          revealed: input.indexedSettlement.commit.revealed === true,
          claimed: input.indexedSettlement.commit.claimed === true,
          scoringEligible: input.indexedSettlement.commit.scoringEligible === true,
          finalizedPayoutAtomic: unsigned(input.indexedSettlement.commit.finalizedPayout ?? "0", "finalized payout"),
        }
      : null,
    claim: input.indexedSettlement?.claim
      ? {
          amountAtomic: unsigned(input.indexedSettlement.claim.amount, "claim amount"),
          transactionHash: String(input.indexedSettlement.claim.transactionHash ?? ""),
        }
      : null,
    reconciledAt: input.now.toISOString(),
  };
  const evidenceHash = sha256(evidence);
  const reference = `chain:${evidence.chainId}:${String(evidence.panelAddress).toLowerCase()}:${evidence.roundId}:${
    commitKey ?? text(input.seat, "seat_id")
  }:${input.outcome}`;
  return { evidence, evidenceHash, reference };
}

function terminalOutcome(input: {
  settlement: IndexedSettlement;
  round: Row;
  nowSeconds: bigint;
}): SeatTerminalOutcome | null {
  const state = integer(input.round.state, "round state");
  if (!TERMINAL_ROUND_STATES.has(state)) return null;
  const revealed = input.settlement.commit.revealed === true;
  const claimed = input.settlement.commit.claimed === true;
  const finalizedPayout = BigInt(unsigned(input.settlement.commit.finalizedPayout ?? "0", "finalized payout"));
  const compensation = BigInt(unsigned(input.round.compensationPerRecipient ?? "0", "compensation"));
  const deadline = BigInt(unsigned(input.round.claimDeadline ?? "0", "claim deadline"));
  if (claimed) {
    if (state === 5 && finalizedPayout > 0n) return "paid";
    if ((state === 7 || state === 8) && compensation > 0n) return "compensated";
    return "no_payout";
  }
  if (input.round.staleReturned === true) return "stale_refunded";
  if (!revealed && deadline > 0n && input.nowSeconds > deadline) return "reveal_expired";
  if (deadline > 0n && input.nowSeconds > deadline) return "claim_expired";
  if (state === 6 || (state === 5 && finalizedPayout === 0n) || ((state === 7 || state === 8) && compensation === 0n)) {
    return "no_payout";
  }
  return null;
}

async function reconcileOperation(input: {
  operationId: string;
  now: Date;
  fetchImpl: typeof fetch;
  ponderUrl: URL;
  signal?: AbortSignal;
}) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const operationResult = await client.query(
      `SELECT * FROM tokenless_paid_assignment_operations
       WHERE operation_id=$1 AND state IN ('round_bound','active','settling') FOR UPDATE`,
      [input.operationId],
    );
    let operation = operationResult.rows[0] as Row | undefined;
    if (!operation) {
      await client.query("COMMIT");
      return { transitionedSeats: 0, operationState: null };
    }
    const seatsResult = await client.query(
      `SELECT s.*,a.status AS assignment_status,a.accepted_at AS assignment_accepted_at,
              i.status AS issuance_status,i.voucher_id,
              c.commit_id AS linked_commit_id,c.vote_key,c.state AS commit_state,c.created_at AS commit_created_at
       FROM tokenless_paid_assignment_seats s
       LEFT JOIN tokenless_private_unpaid_review_assignments a ON a.assignment_id=s.assignment_id
       LEFT JOIN tokenless_paid_review_voucher_issuances i ON i.issuance_id=s.voucher_issuance_id
       LEFT JOIN tokenless_rater_commits c ON c.voucher_id=i.voucher_id
       WHERE s.operation_id=$1 ORDER BY s.position FOR UPDATE OF s`,
      [input.operationId],
    );
    let seats = seatsResult.rows as Row[];
    const indexed = await indexedOperationSettlement({
      fetchImpl: input.fetchImpl,
      ponderUrl: input.ponderUrl,
      operation,
      seats,
      signal: input.signal,
    });
    const roundState = integer(indexed.round.state, "round state");
    const roundTerminal = TERMINAL_ROUND_STATES.has(roundState);
    const nowSeconds = BigInt(Math.floor(input.now.getTime() / 1_000));
    let transitionedSeats = 0;
    const reconciledSeats: Row[] = [];
    for (let seat of seats) {
      const state = text(seat, "state") as SeatState;
      if (state === "voucher_prepared" && ["accepted", "completed"].includes(text(seat, "assignment_status") ?? "")) {
        seat = await transitionSeat(client, {
          operationId: input.operationId,
          seat,
          state: "accepted",
          now: input.now,
          fields: {
            acceptedAt: seat.assignment_accepted_at ? new Date(String(seat.assignment_accepted_at)) : input.now,
          },
          evidence: { assignmentId: text(seat, "assignment_id") },
        });
        seat.assignment_status = "accepted";
        const original = seats.find(value => text(value, "seat_id") === text(seat, "seat_id"));
        seat.linked_commit_id = original?.linked_commit_id;
        seat.vote_key = original?.vote_key;
        seat.commit_state = original?.commit_state;
        seat.commit_created_at = original?.commit_created_at;
        seat.voucher_id = original?.voucher_id;
        transitionedSeats += 1;
      }
      const linkedCommitId = text(seat, "linked_commit_id");
      if (text(seat, "state") === "accepted" && linkedCommitId && text(seat, "commit_state") === "confirmed") {
        seat = await transitionSeat(client, {
          operationId: input.operationId,
          seat,
          state: "committed",
          now: input.now,
          fields: {
            commitId: linkedCommitId,
            committedAt: seat.commit_created_at ? new Date(String(seat.commit_created_at)) : input.now,
          },
          evidence: { commitId: linkedCommitId, voucherId: text(seat, "voucher_id") },
        });
        seat.vote_key = seats.find(value => text(value, "seat_id") === text(seat, "seat_id"))?.vote_key;
        transitionedSeats += 1;
      }
      const voteKey = text(seat, "vote_key");
      const commitKey =
        voteKey && isAddress(voteKey)
          ? tokenlessCommitKey(BigInt(text(operation, "round_id")!), getAddress(voteKey)).toLowerCase()
          : null;
      const settlement = commitKey ? indexed.byCommitKey.get(commitKey) : undefined;
      if (text(seat, "state") === "committed" && settlement?.commit.revealed === true) {
        seat = await transitionSeat(client, {
          operationId: input.operationId,
          seat,
          state: "revealed",
          now: input.now,
          fields: { revealedAt: input.now },
          evidence: { commitKey, revealed: true },
        });
        seat.vote_key = voteKey;
        transitionedSeats += 1;
      }
      let outcome = settlement ? terminalOutcome({ settlement, round: indexed.round, nowSeconds }) : null;
      if (!outcome && roundTerminal && !settlement) {
        outcome = ["reserved", "expired"].includes(text(seat, "assignment_status") ?? "")
          ? "not_accepted"
          : "not_submitted";
      }
      if (text(seat, "state") !== "terminal" && outcome) {
        const terminal = terminalSeatEvidence({
          operation,
          seat,
          outcome,
          indexedRound: indexed.round,
          indexedSettlement: settlement,
          now: input.now,
        });
        seat = await transitionSeat(client, {
          operationId: input.operationId,
          seat,
          state: "terminal",
          now: input.now,
          fields: {
            terminalOutcome: outcome,
            settlementReference: terminal.reference,
            settlementEvidenceHash: terminal.evidenceHash,
            terminalAt: input.now,
          },
          evidence: terminal.evidence,
        });
        await client.query(
          `UPDATE tokenless_private_review_responses
           SET settlement_reference=$1,settlement_evidence_hash=$2
           WHERE assignment_id=$3
             AND (settlement_reference IS NULL OR
                  (settlement_reference=$1 AND settlement_evidence_hash=$2))`,
          [terminal.reference, terminal.evidenceHash, text(seat, "assignment_id")],
        );
        transitionedSeats += 1;
      }
      reconciledSeats.push(seat);
    }
    seats = reconciledSeats;
    const states = seats.map(seat => text(seat, "state"));
    const currentState = text(operation, "state");
    if (currentState === "round_bound") {
      operation = await operationReceipt(client, {
        operation,
        state: "active",
        now: input.now,
        payload: { seatCount: seats.length },
      });
    } else if (
      currentState === "active" &&
      states.some(state => ["committed", "revealed", "terminal"].includes(state!))
    ) {
      operation = await operationReceipt(client, {
        operation,
        state: "settling",
        now: input.now,
        payload: {
          committedOrTerminalSeats: states.filter(state => state !== "voucher_prepared" && state !== "accepted").length,
        },
      });
    } else if (currentState === "settling" && states.length > 0 && states.every(state => state === "terminal")) {
      const terminalSeats = seats.map(seat => ({
        seatId: text(seat, "seat_id"),
        settlementReference: text(seat, "settlement_reference"),
        settlementEvidenceHash: text(seat, "settlement_evidence_hash"),
        outcome: text(seat, "terminal_outcome"),
      }));
      const evidence = {
        schemaVersion: "rateloop.paid-assignment-operation-settlement.v1",
        operationId: input.operationId,
        deploymentKey: text(operation, "deployment_key"),
        chainId: Number(operation.chain_id),
        panelAddress: text(operation, "panel_address"),
        roundId: text(operation, "round_id"),
        seats: terminalSeats,
        reconciledAt: input.now.toISOString(),
      };
      const evidenceHash = sha256(evidence);
      const reference = `chain:${evidence.chainId}:${String(evidence.panelAddress).toLowerCase()}:${
        evidence.roundId
      }:operation:${input.operationId}`;
      operation = await operationReceipt(client, {
        operation,
        state: "terminal",
        now: input.now,
        payload: evidence,
        terminal: { reference, evidenceHash },
      });
    }
    await client.query("COMMIT");
    return { transitionedSeats, operationState: text(operation, "state") };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function recordPaidAssignmentSeatAcceptance(input: {
  assignmentId: string;
  issuanceId: string;
  acceptedAt?: Date;
}) {
  const acceptedAt = input.acceptedAt ?? new Date();
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT seat.*,assignment.status AS assignment_status,assignment.accepted_at AS assignment_accepted_at
       FROM tokenless_paid_assignment_seats seat
       JOIN tokenless_private_unpaid_review_assignments assignment
         ON assignment.assignment_id=seat.assignment_id
       WHERE seat.assignment_id=$1 AND seat.voucher_issuance_id=$2 FOR UPDATE OF seat`,
      [input.assignmentId, input.issuanceId],
    );
    const seat = result.rows[0] as Row | undefined;
    if (
      !seat ||
      !["accepted", "completed"].includes(text(seat, "assignment_status") ?? "") ||
      !["voucher_prepared", "accepted", "committed", "revealed", "terminal"].includes(text(seat, "state") ?? "")
    ) {
      throw new TokenlessServiceError(
        "The paid assignment seat does not match an accepted assignment.",
        409,
        "private_paid_assignment_conflict",
      );
    }
    if (text(seat, "state") === "voucher_prepared") {
      await transitionSeat(client, {
        operationId: text(seat, "operation_id")!,
        seat,
        state: "accepted",
        now: acceptedAt,
        fields: {
          acceptedAt: seat.assignment_accepted_at ? new Date(String(seat.assignment_accepted_at)) : acceptedAt,
        },
        evidence: { assignmentId: input.assignmentId, issuanceId: input.issuanceId },
      });
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function reconcilePaidAssignmentSettlements(
  input: {
    now?: Date;
    limit?: number;
    fetchImpl?: typeof fetch;
    ponderUrl?: string;
    signal?: AbortSignal;
  } = {},
) {
  const now = input.now ?? new Date();
  const limit = input.limit ?? 20;
  if (!Number.isFinite(now.getTime()) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Paid assignment reconciliation input is invalid.");
  }
  const due = await dbPool.query(
    `SELECT operation_id FROM tokenless_paid_assignment_operations
     WHERE state IN ('round_bound','active','settling')
     ORDER BY updated_at,operation_id LIMIT $1`,
    [limit],
  );
  const summary = {
    scanned: due.rows.length,
    transitionedSeats: 0,
    terminalOperations: 0,
    retry: 0,
    retryOperationIds: [] as string[],
  };
  const ponderUrl = configuredPonderUrl(input.ponderUrl);
  for (const value of due.rows) {
    if (maintenanceCancellationRequested(input.signal)) break;
    const operationId = text(value as Row, "operation_id")!;
    try {
      const result = await reconcileOperation({
        operationId,
        now,
        fetchImpl: input.fetchImpl ?? fetch,
        ponderUrl,
        signal: input.signal,
      });
      summary.transitionedSeats += result.transitionedSeats;
      if (result.operationState === "terminal") summary.terminalOperations += 1;
    } catch {
      summary.retry += 1;
      summary.retryOperationIds.push(operationId);
    }
  }
  return summary;
}

export const __paidAssignmentSettlementReconcilerTestUtils = {
  sha256,
  stableJson,
  terminalOutcome,
  terminalSeatEvidence,
};

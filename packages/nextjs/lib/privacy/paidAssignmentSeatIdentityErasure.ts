import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";

type Row = Record<string, unknown>;

export type PaidAssignmentSeatIdentityErasureEvidence = {
  erasedSeats: number;
  remainingDirectIdentities: number;
  retainedIdentityCommitments: number;
  receiptHashes: string[];
};

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
  if (encoded === undefined) throw new Error("Paid-assignment identity value is not canonicalizable.");
  return encoded;
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

export function paidAssignmentSeatIdentityCommitment(input: {
  principalId: string;
  raterId: string;
  payoutAccount: string;
}) {
  return sha256({
    schemaVersion: "rateloop.paid-assignment-seat-identity.v1",
    principalId: input.principalId,
    raterId: input.raterId,
    payoutAccount: input.payoutAccount.toLowerCase(),
  });
}

function rowText(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function rowNumber(row: Row | undefined, key: string) {
  const value = Number(row?.[key] ?? 0);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Stored ${key} is invalid.`);
  return value;
}

function identityErasureReceipt(input: {
  accountDeletionReceiptHash: string;
  identityCommitment: string;
  occurredAt: Date;
  operationId: string;
  previousSeatRevision: number;
  seatId: string;
  seatRevision: number;
  sequence: number;
}) {
  const document = {
    schemaVersion: "rateloop.paid-assignment-receipt.v1",
    operationId: input.operationId,
    sequence: input.sequence,
    receiptType: "seat_identity_erased",
    payload: {
      seatId: input.seatId,
      identityCommitment: input.identityCommitment,
      accountDeletionReceiptHash: input.accountDeletionReceiptHash,
      previousSeatRevision: input.previousSeatRevision,
      seatRevision: input.seatRevision,
    },
    occurredAt: input.occurredAt.toISOString(),
  };
  const receiptJson = stableJson(document);
  const receiptHash = sha256(document);
  return {
    receiptHash,
    receiptId: `parec_${receiptHash.slice("sha256:".length, "sha256:".length + 40)}`,
    receiptJson,
  };
}

export async function erasePaidAssignmentSeatIdentities(
  client: PoolClient,
  input: { principalId: string; receiptDigest: string; now: Date },
): Promise<PaidAssignmentSeatIdentityErasureEvidence> {
  const operationIds = await client.query(
    `SELECT DISTINCT operation_id
     FROM tokenless_paid_assignment_seats
     WHERE reviewer_principal_id=$1
     ORDER BY operation_id ASC`,
    [input.principalId],
  );
  for (const value of operationIds.rows as Row[]) {
    await client.query(
      `SELECT operation_id FROM tokenless_paid_assignment_operations
       WHERE operation_id=$1 FOR UPDATE`,
      [rowText(value, "operation_id")],
    );
  }
  const seats = await client.query(
    `SELECT seat_id,operation_id,position,reviewer_principal_id,rater_id,payout_account,
            identity_commitment,identity_erased_at,state,transition_revision
     FROM tokenless_paid_assignment_seats
     WHERE reviewer_principal_id=$1
     ORDER BY operation_id ASC,position ASC FOR UPDATE`,
    [input.principalId],
  );
  const receiptHashes: string[] = [];
  for (const value of seats.rows as Row[]) {
    const principalId = rowText(value, "reviewer_principal_id")!;
    const raterId = rowText(value, "rater_id")!;
    const payoutAccount = rowText(value, "payout_account")!;
    const identityCommitment = rowText(value, "identity_commitment")!;
    if (
      !principalId ||
      !raterId ||
      !payoutAccount ||
      rowText(value, "identity_erased_at") !== null ||
      identityCommitment !== paidAssignmentSeatIdentityCommitment({ principalId, raterId, payoutAccount })
    ) {
      throw new Error("Paid-assignment seat identity commitment is invalid; deletion stopped before mutation.");
    }
    const operationId = rowText(value, "operation_id")!;
    const seatId = rowText(value, "seat_id")!;
    const previousSeatRevision = rowNumber(value, "transition_revision");
    const seatRevision = previousSeatRevision + 1;
    const sequenceResult = await client.query(
      `SELECT COALESCE(MAX(sequence),0)+1 AS next_sequence
       FROM tokenless_paid_assignment_receipts WHERE operation_id=$1`,
      [operationId],
    );
    const sequence = rowNumber(sequenceResult.rows[0] as Row | undefined, "next_sequence");
    if (sequence < 1) throw new Error("Paid-assignment receipt sequence is invalid.");
    const receipt = identityErasureReceipt({
      accountDeletionReceiptHash: `sha256:${input.receiptDigest}`,
      identityCommitment,
      occurredAt: input.now,
      operationId,
      previousSeatRevision,
      seatId,
      seatRevision,
      sequence,
    });
    await client.query(
      `INSERT INTO tokenless_paid_assignment_receipts
         (receipt_id,operation_id,seat_id,sequence,operation_revision,seat_revision,
          receipt_type,receipt_version,receipt_json,receipt_hash,created_at)
       VALUES ($1,$2,$3,$4,NULL,$5,'seat_identity_erased',1,$6,$7,$8)`,
      [
        receipt.receiptId,
        operationId,
        seatId,
        sequence,
        seatRevision,
        receipt.receiptJson,
        receipt.receiptHash,
        input.now,
      ],
    );
    const updated = await client.query(
      `UPDATE tokenless_paid_assignment_seats
       SET reviewer_principal_id=NULL,rater_id=NULL,payout_account=NULL,
           identity_erased_at=$1,identity_erasure_receipt_hash=$2,
           transition_revision=$3,updated_at=$1
       WHERE seat_id=$4 AND reviewer_principal_id=$5 AND transition_revision=$6`,
      [input.now, `sha256:${input.receiptDigest}`, seatRevision, seatId, input.principalId, previousSeatRevision],
    );
    if (updated.rowCount !== 1) throw new Error("Paid-assignment seat identity erasure lost its locked transition.");
    receiptHashes.push(receipt.receiptHash);
  }
  const remaining = await client.query(
    `SELECT
       COALESCE(SUM(CASE WHEN reviewer_principal_id=$1 THEN 1 ELSE 0 END),0) AS direct_identities,
       COALESCE(SUM(CASE
         WHEN identity_erased_at IS NOT NULL AND identity_commitment ~ '^sha256:[0-9a-f]{64}$' THEN 1 ELSE 0
       END),0) AS retained_commitments
     FROM tokenless_paid_assignment_seats
     WHERE reviewer_principal_id=$1
        OR identity_erasure_receipt_hash=$2`,
    [input.principalId, `sha256:${input.receiptDigest}`],
  );
  const remainingRow = remaining.rows[0] as Row | undefined;
  return {
    erasedSeats: seats.rowCount ?? 0,
    remainingDirectIdentities: rowNumber(remainingRow, "direct_identities"),
    retainedIdentityCommitments: rowNumber(remainingRow, "retained_commitments"),
    receiptHashes,
  };
}

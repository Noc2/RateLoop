import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { PoolClient } from "pg";
import { DataType, newDb } from "pg-mem";
import {
  erasePaidAssignmentSeatIdentities,
  paidAssignmentSeatIdentityCommitment,
} from "~~/lib/privacy/paidAssignmentSeatIdentityErasure";

type Row = Record<string, unknown>;

const NOW = new Date("2026-07-19T16:00:00.000Z");
const PRINCIPAL_ID = "rlp_paid_identity_delete";
const RATER_ID = "rater_paid_identity_delete";
const PAYOUT = "0x1111111111111111111111111111111111111111";
const RECEIPT_DIGEST = "a".repeat(64);

function clientHarness(state: "planned" | "voucher_prepared") {
  const seat: Row = {
    seat_id: "paseat_identity_delete",
    operation_id: "paop_identity_delete",
    position: 2,
    reviewer_principal_id: PRINCIPAL_ID,
    rater_id: RATER_ID,
    payout_account: PAYOUT,
    identity_commitment: paidAssignmentSeatIdentityCommitment({
      principalId: PRINCIPAL_ID,
      raterId: RATER_ID,
      payoutAccount: PAYOUT,
    }),
    identity_erased_at: null,
    identity_erasure_receipt_hash: null,
    state,
    transition_revision: state === "planned" ? 0 : 1,
  };
  const receipts: Row[] = [];
  const client = {
    async query(sql: string, values: unknown[] = []) {
      if (sql.includes("SELECT DISTINCT operation_id")) {
        return { rowCount: seat.reviewer_principal_id ? 1 : 0, rows: seat.reviewer_principal_id ? [seat] : [] };
      }
      if (sql.includes("SELECT operation_id FROM tokenless_paid_assignment_operations")) {
        return { rowCount: 1, rows: [{ operation_id: seat.operation_id }] };
      }
      if (sql.includes("FROM tokenless_paid_assignment_seats") && sql.includes("ORDER BY operation_id")) {
        return { rowCount: seat.reviewer_principal_id ? 1 : 0, rows: seat.reviewer_principal_id ? [seat] : [] };
      }
      if (sql.includes("MAX(sequence)")) {
        return { rowCount: 1, rows: [{ next_sequence: receipts.length + 1 }] };
      }
      if (sql.includes("INSERT INTO tokenless_paid_assignment_receipts")) {
        receipts.push({
          receipt_id: values[0],
          operation_id: values[1],
          seat_id: values[2],
          sequence: values[3],
          seat_revision: values[4],
          receipt_json: values[5],
          receipt_hash: values[6],
          created_at: values[7],
        });
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("UPDATE tokenless_paid_assignment_seats")) {
        assert.equal(values[3], seat.seat_id);
        assert.equal(values[4], PRINCIPAL_ID);
        assert.equal(values[5], seat.transition_revision);
        seat.reviewer_principal_id = null;
        seat.rater_id = null;
        seat.payout_account = null;
        seat.identity_erased_at = values[0];
        seat.identity_erasure_receipt_hash = values[1];
        seat.transition_revision = values[2];
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("COALESCE(SUM")) {
        return {
          rowCount: 1,
          rows: [
            {
              direct_identities: seat.reviewer_principal_id ? 1 : 0,
              retained_commitments: seat.identity_erasure_receipt_hash === values[1] ? 1 : 0,
            },
          ],
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as unknown as PoolClient;
  return { client, receipts, seat };
}

for (const state of ["planned", "voucher_prepared"] as const) {
  test(`paid-assignment ${state} identity erasure preserves only a commitment and immutable receipt`, async () => {
    const harness = clientHarness(state);
    const evidence = await erasePaidAssignmentSeatIdentities(harness.client, {
      now: NOW,
      principalId: PRINCIPAL_ID,
      receiptDigest: RECEIPT_DIGEST,
    });

    assert.equal(evidence.erasedSeats, 1);
    assert.equal(evidence.remainingDirectIdentities, 0);
    assert.equal(evidence.retainedIdentityCommitments, 1);
    assert.equal(evidence.receiptHashes.length, 1);
    assert.equal(harness.seat.reviewer_principal_id, null);
    assert.equal(harness.seat.rater_id, null);
    assert.equal(harness.seat.payout_account, null);
    assert.equal(harness.seat.transition_revision, state === "planned" ? 1 : 2);
    assert.equal(harness.seat.identity_erasure_receipt_hash, `sha256:${RECEIPT_DIGEST}`);

    const receipt = harness.receipts[0]!;
    assert.equal(receipt.seat_revision, state === "planned" ? 1 : 2);
    assert.match(String(receipt.receipt_hash), /^sha256:[0-9a-f]{64}$/u);
    assert.doesNotMatch(String(receipt.receipt_json), new RegExp(PRINCIPAL_ID, "u"));
    assert.doesNotMatch(String(receipt.receipt_json), new RegExp(RATER_ID, "u"));
    assert.doesNotMatch(String(receipt.receipt_json), new RegExp(PAYOUT, "u"));
    assert.match(String(receipt.receipt_json), /seat_identity_erased/u);
    assert.match(String(receipt.receipt_json), new RegExp(`sha256:${RECEIPT_DIGEST}`, "u"));
  });
}

test("paid-assignment seat commitment binds all three direct identity values", () => {
  const commitment = paidAssignmentSeatIdentityCommitment({
    principalId: PRINCIPAL_ID,
    raterId: RATER_ID,
    payoutAccount: PAYOUT,
  });
  assert.match(commitment, /^sha256:[0-9a-f]{64}$/u);
  assert.notEqual(
    commitment,
    paidAssignmentSeatIdentityCommitment({
      principalId: `${PRINCIPAL_ID}_other`,
      raterId: RATER_ID,
      payoutAccount: PAYOUT,
    }),
  );
  assert.notEqual(
    commitment,
    paidAssignmentSeatIdentityCommitment({
      principalId: PRINCIPAL_ID,
      raterId: `${RATER_ID}_other`,
      payoutAccount: PAYOUT,
    }),
  );
  assert.notEqual(
    commitment,
    paidAssignmentSeatIdentityCommitment({
      principalId: PRINCIPAL_ID,
      raterId: RATER_ID,
      payoutAccount: "0x2222222222222222222222222222222222222222",
    }),
  );
});

test("paid-assignment erasure SQL satisfies the 0121 tombstone and receipt constraints", async () => {
  const database = newDb();
  database.public.registerOperator({
    operator: "~",
    left: DataType.text,
    right: DataType.text,
    returns: DataType.bool,
    implementation: (value, pattern) => new RegExp(pattern).test(value),
  });
  database.public.none(`
    CREATE TABLE tokenless_paid_assignment_operations (operation_id text PRIMARY KEY);
    CREATE TABLE tokenless_principals (principal_id text PRIMARY KEY);
    CREATE TABLE tokenless_rater_profiles (rater_id text PRIMARY KEY);
    CREATE TABLE tokenless_private_unpaid_review_assignments (assignment_id text PRIMARY KEY);
    CREATE TABLE tokenless_paid_review_voucher_issuances (issuance_id text PRIMARY KEY);
  `);
  const migration = readFileSync(new URL("../../drizzle/0121_paid_assignment_operations.sql", import.meta.url), "utf8");
  const statements = migration.split("--> statement-breakpoint").map(value => value.trim());
  database.public.none(statements.find(value => value.startsWith('CREATE TABLE "tokenless_paid_assignment_seats"'))!);
  database.public.none(
    statements.find(value => value.startsWith('CREATE TABLE "tokenless_paid_assignment_receipts"'))!,
  );

  const commitment = paidAssignmentSeatIdentityCommitment({
    principalId: PRINCIPAL_ID,
    raterId: RATER_ID,
    payoutAccount: PAYOUT,
  });
  database.public.none(`
    INSERT INTO tokenless_paid_assignment_operations VALUES ('paop_identity_delete');
    INSERT INTO tokenless_principals VALUES ('${PRINCIPAL_ID}');
    INSERT INTO tokenless_rater_profiles VALUES ('${RATER_ID}');
    INSERT INTO tokenless_paid_assignment_seats
      (seat_id,operation_id,position,reviewer_principal_id,rater_id,payout_account,
       identity_commitment,state,transition_revision,created_at,updated_at)
    VALUES ('paseat_identity_delete','paop_identity_delete',0,'${PRINCIPAL_ID}','${RATER_ID}',
            '${PAYOUT}','${commitment}','planned',0,'${NOW.toISOString()}','${NOW.toISOString()}');
  `);
  const adapter = database.adapters.createPg();
  const pool = new adapter.Pool();
  const client = (await pool.connect()) as unknown as PoolClient;
  try {
    await client.query("BEGIN");
    const evidence = await erasePaidAssignmentSeatIdentities(client, {
      now: NOW,
      principalId: PRINCIPAL_ID,
      receiptDigest: RECEIPT_DIGEST,
    });
    await client.query("COMMIT");
    assert.deepEqual(
      {
        erasedSeats: evidence.erasedSeats,
        remainingDirectIdentities: evidence.remainingDirectIdentities,
        retainedIdentityCommitments: evidence.retainedIdentityCommitments,
      },
      { erasedSeats: 1, remainingDirectIdentities: 0, retainedIdentityCommitments: 1 },
    );
    const stored = await client.query(
      `SELECT reviewer_principal_id,rater_id,payout_account,identity_commitment,
              identity_erasure_receipt_hash,transition_revision
       FROM tokenless_paid_assignment_seats WHERE seat_id=$1`,
      ["paseat_identity_delete"],
    );
    assert.deepEqual(stored.rows[0], {
      reviewer_principal_id: null,
      rater_id: null,
      payout_account: null,
      identity_commitment: commitment,
      identity_erasure_receipt_hash: `sha256:${RECEIPT_DIGEST}`,
      transition_revision: 1,
    });
    const receipt = await client.query(
      `SELECT receipt_type,seat_revision,receipt_hash FROM tokenless_paid_assignment_receipts
       WHERE seat_id=$1`,
      ["paseat_identity_delete"],
    );
    assert.equal(receipt.rows[0]?.receipt_type, "seat_identity_erased");
    assert.equal(receipt.rows[0]?.seat_revision, 1);
    assert.match(String(receipt.rows[0]?.receipt_hash), /^sha256:[0-9a-f]{64}$/u);
  } finally {
    client.release();
    await pool.end();
  }
});

import { drainPrepaidTopupAuditOutbox, projectPrepaidInvoice, projectPrepaidReversal } from "./prepaidTopups";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import type Stripe from "stripe";
import { __setDatabaseResourcesForTests, dbClient, dbPool } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";

const originalStripeKey = process.env.STRIPE_SECRET_KEY;
const originalBankTransferType = process.env.STRIPE_PREPAID_TOPUP_BANK_TRANSFER_TYPE;
const now = new Date("2026-07-17T01:00:00.000Z");

beforeEach(async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_fixture";
  process.env.STRIPE_PREPAID_TOPUP_BANK_TRANSFER_TYPE = "us_bank_transfer";
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspaces (workspace_id,name,status,created_at,updated_at)
          VALUES ('ws_topup','Top-up fixture','active',?,?)`,
    args: [now, now],
  });
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
  if (originalStripeKey === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = originalStripeKey;
  if (originalBankTransferType === undefined) delete process.env.STRIPE_PREPAID_TOPUP_BANK_TRANSFER_TYPE;
  else process.env.STRIPE_PREPAID_TOPUP_BANK_TRANSFER_TYPE = originalBankTransferType;
});

async function seedTopup(topupId: string, invoiceId: string) {
  await dbClient.execute({
    sql: `INSERT INTO tokenless_prepaid_topup_intents
          (topup_id,workspace_id,requested_by,idempotency_key,amount_atomic,invoice_currency,invoice_amount_minor,
           provider_amount_due_minor,provider_tax_amount_minor,provider,provider_customer_id,provider_invoice_id,
           state,reconciliation_attempts,next_reconcile_at,requested_at,issued_at,updated_at)
          VALUES (?, 'ws_topup','rlp_requester',?,100000000,'usd',10000,11900,1900,'stripe','cus_topup',?,
                  'sent',0,?,?,?,?)`,
    args: [topupId, `idem:${topupId}`, invoiceId, now, now, now, now],
  });
  for (const [eventType, sequence] of [
    ["requested", 1],
    ["issued", 2],
  ] as const) {
    await dbClient.execute({
      sql: `INSERT INTO tokenless_prepaid_topup_audit_outbox
            (outbox_id,workspace_id,topup_id,event_type,event_sequence,actor_reference,event_occurred_at,state,
             attempt_count,next_attempt_at,created_at,updated_at)
            VALUES (?, 'ws_topup', ?, ?, ?, 'rlp_requester', ?, 'pending', 0, ?, ?, ?)`,
      args: [`outbox:${topupId}:${eventType}`, topupId, eventType, sequence, now, now, now, now],
    });
  }
}

async function seedDraftTopup(topupId: string) {
  await dbClient.execute({
    sql: `INSERT INTO tokenless_prepaid_topup_intents
          (topup_id,workspace_id,requested_by,idempotency_key,amount_atomic,invoice_currency,invoice_amount_minor,
           provider,state,reconciliation_attempts,next_reconcile_at,requested_at,updated_at)
          VALUES (?, 'ws_topup','rlp_requester',?,100000000,'usd',10000,'stripe','draft',0,?,?,?)`,
    args: [topupId, `idem:${topupId}`, now, now, now],
  });
}

async function settledBalance() {
  const result = await dbClient.execute({
    sql: `SELECT COALESCE(SUM(delta_atomic),0) AS balance FROM tokenless_prepaid_ledger_entries
          WHERE workspace_id='ws_topup' AND settlement_status='settled'`,
  });
  return String(result.rows[0]?.balance);
}

function invoice(id: string, overrides: Partial<Stripe.Invoice> = {}) {
  return {
    amount_due: 11_900,
    amount_overpaid: 0,
    amount_paid: 11_900,
    amount_paid_off_stripe: 0,
    amount_remaining: 0,
    collection_method: "send_invoice",
    currency: "usd",
    customer: "cus_topup",
    id,
    livemode: false,
    metadata: {
      rateloop_purpose: "prepaid_topup",
      rateloop_topup_id: `topup_${id}`,
      rateloop_workspace_id: "ws_topup",
    },
    payment_settings: {
      payment_method_options: { customer_balance: { bank_transfer: { type: "us_bank_transfer" } } },
      payment_method_types: ["customer_balance"],
    },
    starting_balance: 0,
    status: "paid",
    total_excluding_tax: 10_000,
    ...overrides,
  } as unknown as Stripe.Invoice;
}

async function project(input: { eventId: string; invoice: Stripe.Invoice }) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const result = await projectPrepaidInvoice(client, {
      eventCreatedAt: now,
      eventId: input.eventId,
      invoice: input.invoice,
    });
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

test("valid paid invoice credits the net amount exactly once and delivers ordered audit events", async () => {
  await seedTopup("topup_in_valid", "in_valid");
  const canonical = invoice("in_valid");
  assert.deepEqual(await project({ eventId: "evt_paid", invoice: canonical }), { matched: true, credited: true });
  assert.deepEqual(await project({ eventId: "evt_paid_duplicate", invoice: canonical }), {
    matched: true,
    credited: true,
  });
  const ledger = await dbClient.execute({
    sql: "SELECT delta_atomic,source FROM tokenless_prepaid_ledger_entries WHERE external_reference='stripe_invoice:in_valid'",
  });
  assert.equal(ledger.rowCount, 1);
  assert.equal(String(ledger.rows[0]?.delta_atomic), "100000000");
  assert.equal(ledger.rows[0]?.source, "fiat_topup");

  assert.deepEqual(await drainPrepaidTopupAuditOutbox({ topupId: "topup_in_valid" }), {
    attempted: 4,
    delivered: 4,
  });
  const audit = await dbClient.execute({
    sql: `SELECT action FROM tokenless_audit_events WHERE workspace_id='ws_topup' ORDER BY sequence ASC`,
  });
  assert.deepEqual(
    audit.rows.map(row => row.action),
    [
      "billing.prepaid_topup.requested",
      "billing.prepaid_topup.issued",
      "billing.prepaid_topup.paid",
      "billing.prepaid_topup.credited",
    ],
  );
});

test("an invoice issued before its intent row was updated is adopted and still credits", async () => {
  await seedDraftTopup("topup_in_orphan");
  assert.deepEqual(await project({ eventId: "evt_orphan_paid", invoice: invoice("in_orphan") }), {
    matched: true,
    credited: true,
  });
  const topup = await dbClient.execute({
    sql: `SELECT state,provider_invoice_id,provider_customer_id,provider_amount_due_minor,provider_tax_amount_minor,
                 issued_at,credited_at FROM tokenless_prepaid_topup_intents WHERE topup_id='topup_in_orphan'`,
  });
  assert.equal(topup.rows[0]?.state, "credited");
  assert.equal(topup.rows[0]?.provider_invoice_id, "in_orphan");
  assert.equal(topup.rows[0]?.provider_customer_id, "cus_topup");
  assert.equal(Number(topup.rows[0]?.provider_amount_due_minor), 11_900);
  assert.equal(Number(topup.rows[0]?.provider_tax_amount_minor), 1_900);
  assert.ok(topup.rows[0]?.issued_at);
  assert.equal(await settledBalance(), "100000000");
  assert.deepEqual(await drainPrepaidTopupAuditOutbox({ topupId: "topup_in_orphan" }), {
    attempted: 3,
    delivered: 3,
  });
});

test("an invoice that matches no intent is reported for attention rather than as success", async () => {
  assert.deepEqual(await project({ eventId: "evt_unknown", invoice: invoice("in_unknown") }), {
    attention: "unmatched_prepaid_invoice",
    credited: false,
    matched: false,
  });
});

test("a payment that lands after a terminal failure is recorded without crediting or throwing", async () => {
  await seedTopup("topup_in_drift", "in_drift");
  await project({ eventId: "evt_drift", invoice: invoice("in_drift", { total_excluding_tax: 9_999 }) });
  assert.deepEqual(await project({ eventId: "evt_late_payment", invoice: invoice("in_drift") }), {
    attention: "paid_invoice_for_failed_topup",
    credited: false,
    matched: true,
  });
  const topup = await dbClient.execute({
    sql: "SELECT state,failure_code,paid_at FROM tokenless_prepaid_topup_intents WHERE topup_id='topup_in_drift'",
  });
  assert.equal(topup.rows[0]?.state, "failed");
  assert.equal(topup.rows[0]?.failure_code, "invoice_net_amount_mismatch");
  assert.ok(topup.rows[0]?.paid_at, "the payment that arrived after the failure is recorded on the row");
  assert.equal((await dbClient.execute({ sql: "SELECT 1 FROM tokenless_prepaid_ledger_entries" })).rowCount, 0);
});

test("a voided invoice for a credited top-up is reported instead of failing the endpoint", async () => {
  await seedTopup("topup_in_late_void", "in_late_void");
  await project({ eventId: "evt_credited", invoice: invoice("in_late_void") });
  assert.deepEqual(await project({ eventId: "evt_late_void", invoice: invoice("in_late_void", { status: "void" }) }), {
    attention: "credited_invoice_voided",
    credited: true,
    matched: true,
  });
});

test("reversals debit the credited net amount once per invoice, even from two Stripe signals", async () => {
  await seedTopup("topup_in_refunded", "in_refunded");
  await project({ eventId: "evt_refund_credit", invoice: invoice("in_refunded") });
  assert.equal(await settledBalance(), "100000000");

  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    assert.deepEqual(
      await projectPrepaidReversal(client, { grossMinor: 11_900, invoiceId: "in_refunded", reversalId: "cn_1" }),
      { matched: true, reversedAtomic: "100000000" },
    );
    // The same money reported a second time, under the refund's own key, must not debit again.
    assert.deepEqual(
      await projectPrepaidReversal(client, { grossMinor: 11_900, invoiceId: "in_refunded", reversalId: "re_1" }),
      { matched: true, reversedAtomic: "0" },
    );
    await client.query("COMMIT");
  } finally {
    client.release();
  }
  assert.equal(await settledBalance(), "0");
  const entries = await dbClient.execute({
    sql: `SELECT delta_atomic,source FROM tokenless_prepaid_ledger_entries
          WHERE external_reference='stripe_reversal:in_refunded:cn_1'`,
  });
  assert.equal(entries.rowCount, 1);
  assert.equal(String(entries.rows[0]?.delta_atomic), "-100000000");
  assert.equal(entries.rows[0]?.source, "fiat_topup_reversal");
});

test("a reversal of already spent funds goes negative and says so instead of clamping", async () => {
  await seedTopup("topup_in_spent", "in_spent");
  await project({ eventId: "evt_spent_credit", invoice: invoice("in_spent") });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_prepaid_ledger_entries
          (entry_id,workspace_id,delta_atomic,settlement_status,source,external_reference,created_at,settled_at)
          VALUES ('led_spend','ws_topup','-60000000','settled','round_consumption','round:1',?,?)`,
    args: [now, now],
  });
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    assert.deepEqual(
      await projectPrepaidReversal(client, { grossMinor: 11_900, invoiceId: "in_spent", reversalId: "cn_spent" }),
      { attention: "prepaid_balance_negative_after_reversal", matched: true, reversedAtomic: "100000000" },
    );
    await client.query("COMMIT");
  } finally {
    client.release();
  }
  assert.equal(await settledBalance(), "-60000000");
});

test("partial payment stays retryable and cannot create ledger credit", async () => {
  await seedTopup("topup_in_partial", "in_partial");
  const result = await project({
    eventId: "evt_partial",
    invoice: invoice("in_partial", { amount_paid: 5_000, amount_remaining: 6_900, status: "open" }),
  });
  assert.deepEqual(result, { matched: true, credited: false });
  const topup = await dbClient.execute({
    sql: "SELECT state,failure_code,reconciliation_attempts FROM tokenless_prepaid_topup_intents WHERE topup_id='topup_in_partial'",
  });
  assert.equal(topup.rows[0]?.state, "sent");
  assert.equal(topup.rows[0]?.failure_code, "invoice_amount_paid_mismatch");
  assert.equal(Number(topup.rows[0]?.reconciliation_attempts), 1);
  assert.equal((await dbClient.execute({ sql: "SELECT 1 FROM tokenless_prepaid_ledger_entries" })).rowCount, 0);
});

test("net amount drift and invoice void fail without credit", async () => {
  await seedTopup("topup_in_wrong", "in_wrong");
  assert.deepEqual(
    await project({ eventId: "evt_wrong", invoice: invoice("in_wrong", { total_excluding_tax: 9_999 }) }),
    { matched: true, credited: false },
  );
  const wrong = await dbClient.execute({
    sql: "SELECT state,failure_code FROM tokenless_prepaid_topup_intents WHERE topup_id='topup_in_wrong'",
  });
  assert.equal(wrong.rows[0]?.state, "failed");
  assert.equal(wrong.rows[0]?.failure_code, "invoice_net_amount_mismatch");

  await seedTopup("topup_in_void", "in_void");
  assert.deepEqual(await project({ eventId: "evt_void", invoice: invoice("in_void", { status: "void" }) }), {
    matched: true,
    credited: false,
  });
  const voided = await dbClient.execute({
    sql: "SELECT state,failure_code FROM tokenless_prepaid_topup_intents WHERE topup_id='topup_in_void'",
  });
  assert.equal(voided.rows[0]?.state, "failed");
  assert.equal(voided.rows[0]?.failure_code, "invoice_voided");
  assert.equal((await dbClient.execute({ sql: "SELECT 1 FROM tokenless_prepaid_ledger_entries" })).rowCount, 0);
});

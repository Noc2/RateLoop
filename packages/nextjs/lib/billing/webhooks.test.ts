import { LEGACY_EARLY_ACCESS_PRICE_VERSION } from "./plans";
import { __setStripeForTests } from "./stripe";
import { processStripeWebhook } from "./webhooks";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import type Stripe from "stripe";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";

const originalEnv = {
  bankTransfer: process.env.STRIPE_PREPAID_TOPUP_BANK_TRANSFER_TYPE,
  price: process.env.STRIPE_EARLY_ACCESS_MONTHLY_PRICE_ID,
  secret: process.env.STRIPE_SECRET_KEY,
};
const PRICE_ID = "price_early_access_fixture";
const seededAt = new Date("2026-07-14T12:00:00.000Z");
let canonicalSubscription: Stripe.Subscription;
let canonicalInvoice: Stripe.Invoice | null = null;
let canonicalCharge: Stripe.Charge | null = null;
let canonicalInvoicePayments: Array<{ invoice: string }> = [];

function subscriptionEvent(input: {
  created: number;
  eventId: string;
  eventType?: "customer.subscription.updated" | "customer.subscription.deleted";
  status: Stripe.Subscription.Status;
  priceId?: string;
  priceVersion?: string;
  subscriptionId?: string;
}) {
  const periodStart = input.created - 100;
  const periodEnd = input.created + 2_592_000;
  return {
    api_version: "2026-06-30.basil",
    created: input.created,
    data: {
      object: {
        cancel_at_period_end: input.status === "canceled",
        customer: "cus_fixture",
        id: input.subscriptionId ?? "sub_fixture",
        items: {
          data: [
            {
              current_period_end: periodEnd,
              current_period_start: periodStart,
              price: { id: input.priceId ?? PRICE_ID },
            },
          ],
        },
        metadata: {
          rateloop_workspace_id: "ws_fixture",
          ...(input.priceVersion ? { rateloop_price_version: input.priceVersion } : {}),
        },
        object: "subscription",
        status: input.status,
      },
    },
    id: input.eventId,
    livemode: false,
    object: "event",
    pending_webhooks: 1,
    request: null,
    type: input.eventType ?? "customer.subscription.updated",
  } as unknown as Stripe.Event;
}

function invoiceEvent(input: {
  created: number;
  eventId: string;
  eventType: "invoice.paid" | "invoice.marked_uncollectible";
  invoiceId: string;
  topupId: string;
}) {
  return {
    api_version: "2026-06-30.basil",
    created: input.created,
    data: {
      object: {
        id: input.invoiceId,
        metadata: {
          rateloop_purpose: "prepaid_topup",
          rateloop_topup_id: input.topupId,
          rateloop_workspace_id: "ws_fixture",
        },
        object: "invoice",
      },
    },
    id: input.eventId,
    livemode: false,
    object: "event",
    pending_webhooks: 1,
    request: null,
    type: input.eventType,
  } as unknown as Stripe.Event;
}

function topupInvoice(invoiceId: string, topupId: string, overrides: Record<string, unknown> = {}) {
  return {
    amount_due: 11_900,
    amount_overpaid: 0,
    amount_paid: 11_900,
    amount_paid_off_stripe: 0,
    amount_remaining: 0,
    collection_method: "send_invoice",
    currency: "usd",
    customer: "cus_fixture",
    id: invoiceId,
    livemode: false,
    metadata: {
      rateloop_purpose: "prepaid_topup",
      rateloop_topup_id: topupId,
      rateloop_workspace_id: "ws_fixture",
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

async function seedCreditedTopup(topupId: string, invoiceId: string) {
  await dbClient.execute({
    sql: `INSERT INTO tokenless_prepaid_topup_intents
          (topup_id,workspace_id,requested_by,idempotency_key,amount_atomic,invoice_currency,invoice_amount_minor,
           provider_amount_due_minor,provider_tax_amount_minor,provider,provider_customer_id,provider_invoice_id,
           provider_event_id,provider_event_created_at,state,reconciliation_attempts,requested_at,issued_at,paid_at,
           credited_at,updated_at)
          VALUES (?, 'ws_fixture','rlp_requester',?,100000000,'usd',10000,11900,1900,'stripe','cus_fixture',?,
                  ?,?,'credited',0,?,?,?,?,?)`,
    args: [
      topupId,
      `idem:${topupId}`,
      invoiceId,
      `evt_seed_${topupId}`,
      seededAt,
      seededAt,
      seededAt,
      seededAt,
      seededAt,
      seededAt,
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_prepaid_ledger_entries
          (entry_id,workspace_id,delta_atomic,settlement_status,source,external_reference,created_at,settled_at)
          VALUES (?, 'ws_fixture','100000000','settled','fiat_topup',?,?,?)`,
    args: [`led_${topupId}`, `stripe_invoice:${invoiceId}`, seededAt, seededAt],
  });
}

async function settledBalance() {
  const result = await dbClient.execute({
    sql: `SELECT COALESCE(SUM(delta_atomic),0) AS balance FROM tokenless_prepaid_ledger_entries
          WHERE workspace_id='ws_fixture' AND settlement_status='settled'`,
  });
  return String(result.rows[0]?.balance);
}

async function webhookEvent(eventId: string) {
  const result = await dbClient.execute({
    sql: `SELECT processing_status, error_code FROM tokenless_billing_webhook_events
          WHERE provider_event_id = ?`,
    args: [eventId],
  });
  return { errorCode: result.rows[0]?.error_code ?? null, status: result.rows[0]?.processing_status };
}

beforeEach(async () => {
  process.env.STRIPE_EARLY_ACCESS_MONTHLY_PRICE_ID = PRICE_ID;
  process.env.STRIPE_SECRET_KEY = "sk_test_fixture";
  process.env.STRIPE_PREPAID_TOPUP_BANK_TRANSFER_TYPE = "us_bank_transfer";
  canonicalInvoice = null;
  canonicalCharge = null;
  canonicalInvoicePayments = [];
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  __setStripeForTests({
    charges: { retrieve: async () => canonicalCharge },
    invoicePayments: { list: async () => ({ data: canonicalInvoicePayments }) },
    invoices: { retrieve: async () => canonicalInvoice },
    subscriptions: { retrieve: async () => canonicalSubscription },
  } as unknown as Stripe);
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspaces (workspace_id, name, status, created_at, updated_at)
          VALUES ('ws_fixture', 'Fixture', 'active', ?, ?)`,
    args: [seededAt, seededAt],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_billing_customers
            (workspace_id, provider, provider_customer_id, created_at, updated_at)
          VALUES ('ws_fixture', 'stripe', 'cus_fixture', ?, ?)`,
    args: [seededAt, seededAt],
  });
});

afterEach(() => {
  __setStripeForTests(null);
  __setDatabaseResourcesForTests(null);
  for (const [name, value] of [
    ["STRIPE_EARLY_ACCESS_MONTHLY_PRICE_ID", originalEnv.price],
    ["STRIPE_SECRET_KEY", originalEnv.secret],
    ["STRIPE_PREPAID_TOPUP_BANK_TRANSFER_TYPE", originalEnv.bankTransfer],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test("verified subscription events project Early Access once and duplicate delivery is idempotent", async () => {
  const event = subscriptionEvent({ created: 1_784_035_200, eventId: "evt_active", status: "active" });
  canonicalSubscription = event.data.object as Stripe.Subscription;
  assert.deepEqual(await processStripeWebhook({ event, rawBody: "active-body" }), { duplicate: false });
  assert.deepEqual(await processStripeWebhook({ event, rawBody: "active-body" }), { duplicate: true });

  const subscription = await dbClient.execute(
    `SELECT plan_key, price_version, provider_status, provider_subscription_id, provider_price_id
     FROM tokenless_workspace_subscriptions WHERE workspace_id = 'ws_fixture'`,
  );
  assert.deepEqual(
    {
      planKey: subscription.rows[0]?.plan_key,
      priceVersion: subscription.rows[0]?.price_version,
      providerStatus: subscription.rows[0]?.provider_status,
      subscriptionId: subscription.rows[0]?.provider_subscription_id,
      priceId: subscription.rows[0]?.provider_price_id,
    },
    {
      planKey: "early_access",
      priceVersion: "early_access_usd_29_2026_07",
      providerStatus: "active",
      subscriptionId: "sub_fixture",
      priceId: PRICE_ID,
    },
  );
  const events = await dbClient.execute(
    "SELECT processing_status, payload_sha256 FROM tokenless_billing_webhook_events WHERE provider_event_id = 'evt_active'",
  );
  assert.equal(events.rows[0]?.processing_status, "processed");
  assert.match(String(events.rows[0]?.payload_sha256), /^[0-9a-f]{64}$/);
});

test("an older subscription event cannot overwrite a newer entitlement snapshot", async () => {
  const newer = subscriptionEvent({ created: 1_784_035_300, eventId: "evt_newer", status: "active" });
  const older = subscriptionEvent({ created: 1_784_035_200, eventId: "evt_older", status: "canceled" });
  canonicalSubscription = newer.data.object as Stripe.Subscription;
  await processStripeWebhook({ event: newer, rawBody: "newer-body" });
  await processStripeWebhook({ event: older, rawBody: "older-body" });

  const subscription = await dbClient.execute(
    "SELECT provider_status, cancel_at_period_end, provider_event_created_at FROM tokenless_workspace_subscriptions WHERE workspace_id = 'ws_fixture'",
  );
  assert.equal(subscription.rows[0]?.provider_status, "active");
  assert.equal(subscription.rows[0]?.cancel_at_period_end, false);
  assert.equal(new Date(String(subscription.rows[0]?.provider_event_created_at)).getTime(), newer.created * 1000);
});

test("a late event from an old subscription cannot replace the workspace's newer active subscription", async () => {
  const oldActive = subscriptionEvent({
    created: 1_784_035_100,
    eventId: "evt_old_active",
    status: "active",
    subscriptionId: "sub_old",
  });
  canonicalSubscription = oldActive.data.object as Stripe.Subscription;
  await processStripeWebhook({ event: oldActive, rawBody: "old-active" });

  const oldCancelled = subscriptionEvent({
    created: 1_784_035_200,
    eventId: "evt_old_cancelled",
    eventType: "customer.subscription.deleted",
    status: "canceled",
    subscriptionId: "sub_old",
  });
  await processStripeWebhook({ event: oldCancelled, rawBody: "old-cancelled" });

  const newActive = subscriptionEvent({
    created: 1_784_035_300,
    eventId: "evt_new_active",
    status: "active",
    subscriptionId: "sub_new",
  });
  canonicalSubscription = newActive.data.object as Stripe.Subscription;
  await processStripeWebhook({ event: newActive, rawBody: "new-active" });

  const lateOld = subscriptionEvent({
    created: 1_784_035_400,
    eventId: "evt_late_old",
    eventType: "customer.subscription.deleted",
    status: "canceled",
    subscriptionId: "sub_old",
  });
  await processStripeWebhook({ event: lateOld, rawBody: "late-old" });

  const subscription = await dbClient.execute(
    "SELECT provider_subscription_id, provider_status FROM tokenless_workspace_subscriptions WHERE workspace_id = 'ws_fixture'",
  );
  assert.equal(subscription.rows[0]?.provider_subscription_id, "sub_new");
  assert.equal(subscription.rows[0]?.provider_status, "active");
});

test("unrecognised Stripe prices grant nothing, are recorded, and do not fail the endpoint", async () => {
  const event = subscriptionEvent({
    created: 1_784_035_200,
    eventId: "evt_wrong_price",
    priceId: "price_attacker_controlled",
    status: "active",
  });
  canonicalSubscription = event.data.object as Stripe.Subscription;
  assert.deepEqual(await processStripeWebhook({ event, rawBody: "wrong-price-body" }), {
    attention: "unsupported_subscription_price",
    duplicate: false,
  });

  const subscription = await dbClient.execute(
    "SELECT provider_subscription_id FROM tokenless_workspace_subscriptions WHERE workspace_id = 'ws_fixture'",
  );
  assert.equal(subscription.rowCount, 0);
  assert.deepEqual(await webhookEvent("evt_wrong_price"), {
    errorCode: "unsupported_subscription_price",
    status: "failed",
  });
});

test("rotating the configured price keeps existing subscribers projected under their real price", async () => {
  const before = subscriptionEvent({ created: 1_784_035_200, eventId: "evt_before_rotation", status: "active" });
  canonicalSubscription = before.data.object as Stripe.Subscription;
  await processStripeWebhook({ event: before, rawBody: "before-rotation" });

  process.env.STRIPE_EARLY_ACCESS_MONTHLY_PRICE_ID = "price_early_access_rotated";
  const renewal = subscriptionEvent({ created: 1_784_035_300, eventId: "evt_after_rotation", status: "active" });
  canonicalSubscription = renewal.data.object as Stripe.Subscription;
  assert.deepEqual(await processStripeWebhook({ event: renewal, rawBody: "after-rotation" }), { duplicate: false });

  const subscription = await dbClient.execute(
    `SELECT plan_key, price_version, provider_status, provider_event_id, provider_price_id
     FROM tokenless_workspace_subscriptions WHERE workspace_id = 'ws_fixture'`,
  );
  assert.deepEqual(
    {
      eventId: subscription.rows[0]?.provider_event_id,
      planKey: subscription.rows[0]?.plan_key,
      priceId: subscription.rows[0]?.provider_price_id,
      priceVersion: subscription.rows[0]?.price_version,
      status: subscription.rows[0]?.provider_status,
    },
    {
      eventId: "evt_after_rotation",
      planKey: "early_access",
      priceId: PRICE_ID,
      priceVersion: "early_access_usd_29_2026_07",
      status: "active",
    },
  );
  assert.equal((await webhookEvent("evt_after_rotation")).status, "processed");
});

test("a subscription on a legacy price stores the price version Stripe recorded for it", async () => {
  const event = subscriptionEvent({
    created: 1_784_035_200,
    eventId: "evt_legacy_price",
    priceId: "price_early_access_legacy",
    priceVersion: LEGACY_EARLY_ACCESS_PRICE_VERSION,
    status: "active",
  });
  canonicalSubscription = event.data.object as Stripe.Subscription;
  assert.deepEqual(await processStripeWebhook({ event, rawBody: "legacy-price" }), { duplicate: false });

  const subscription = await dbClient.execute(
    "SELECT plan_key, price_version FROM tokenless_workspace_subscriptions WHERE workspace_id = 'ws_fixture'",
  );
  assert.equal(subscription.rows[0]?.plan_key, "early_access");
  assert.equal(subscription.rows[0]?.price_version, LEGACY_EARLY_ACCESS_PRICE_VERSION);
});

test("a credit note for a credited top-up debits the prepaid balance exactly once", async () => {
  await seedCreditedTopup("topup_refund", "in_refund");
  const event = {
    api_version: "2026-06-30.basil",
    created: 1_784_035_400,
    data: { object: { id: "cn_fixture", invoice: "in_refund", object: "credit_note", total: 11_900 } },
    id: "evt_credit_note",
    livemode: false,
    object: "event",
    pending_webhooks: 1,
    request: null,
    type: "credit_note.created",
  } as unknown as Stripe.Event;
  assert.deepEqual(await processStripeWebhook({ event, rawBody: "credit-note" }), { duplicate: false });
  assert.equal(await settledBalance(), "0");

  // The dashboard refund behind the credit note also emits charge.refunded for the same money.
  canonicalCharge = { amount_refunded: 11_900, id: "ch_fixture", payment_intent: "pi_fixture" } as Stripe.Charge;
  canonicalInvoicePayments = [{ invoice: "in_refund" }];
  const refundEvent = {
    api_version: "2026-06-30.basil",
    created: 1_784_035_500,
    data: {
      object: {
        amount_refunded: 11_900,
        id: "ch_fixture",
        object: "charge",
        payment_intent: "pi_fixture",
        refunds: { data: [{ amount: 11_900, id: "re_fixture" }] },
      },
    },
    id: "evt_charge_refunded",
    livemode: false,
    object: "event",
    pending_webhooks: 1,
    request: null,
    type: "charge.refunded",
  } as unknown as Stripe.Event;
  assert.deepEqual(await processStripeWebhook({ event: refundEvent, rawBody: "charge-refunded" }), {
    duplicate: false,
  });
  assert.equal(await settledBalance(), "0");
  const debits = await dbClient.execute(
    "SELECT delta_atomic FROM tokenless_prepaid_ledger_entries WHERE source = 'fiat_topup_reversal'",
  );
  assert.equal(debits.rowCount, 1);
  assert.equal(String(debits.rows[0]?.delta_atomic), "-100000000");
});

test("a payment for a failed top-up is answered without a rollback so the endpoint keeps working", async () => {
  await dbClient.execute({
    sql: `INSERT INTO tokenless_prepaid_topup_intents
          (topup_id,workspace_id,requested_by,idempotency_key,amount_atomic,invoice_currency,invoice_amount_minor,
           provider_amount_due_minor,provider_tax_amount_minor,provider,provider_customer_id,provider_invoice_id,
           state,failure_code,reconciliation_attempts,requested_at,issued_at,failed_at,updated_at)
          VALUES ('topup_failed','ws_fixture','rlp_requester','idem:failed',100000000,'usd',10000,11900,1900,
                  'stripe','cus_fixture','in_failed','failed','invoice_net_amount_mismatch',0,?,?,?,?)`,
    args: [seededAt, seededAt, seededAt, seededAt],
  });
  canonicalInvoice = topupInvoice("in_failed", "topup_failed");
  const event = invoiceEvent({
    created: 1_784_035_600,
    eventId: "evt_paid_after_failure",
    eventType: "invoice.paid",
    invoiceId: "in_failed",
    topupId: "topup_failed",
  });
  assert.deepEqual(await processStripeWebhook({ event, rawBody: "paid-after-failure" }), {
    attention: "paid_invoice_for_failed_topup",
    duplicate: false,
  });
  assert.deepEqual(await webhookEvent("evt_paid_after_failure"), {
    errorCode: "paid_invoice_for_failed_topup",
    status: "failed",
  });
  assert.equal((await dbClient.execute({ sql: "SELECT 1 FROM tokenless_prepaid_ledger_entries" })).rowCount, 0);

  // The shared endpoint still projects subscriptions after the anomaly.
  const subscriptionEventAfter = subscriptionEvent({
    created: 1_784_035_700,
    eventId: "evt_after_anomaly",
    status: "active",
  });
  canonicalSubscription = subscriptionEventAfter.data.object as Stripe.Subscription;
  assert.deepEqual(await processStripeWebhook({ event: subscriptionEventAfter, rawBody: "after-anomaly" }), {
    duplicate: false,
  });
});

import { EARLY_ACCESS_PRICE_VERSION, type TokenlessBillingPriceVersion, getPlanByPriceVersion } from "./plans";
import {
  drainPrepaidTopupAuditOutbox,
  projectPrepaidInvoice,
  projectPrepaidReversal,
  reinstatePrepaidReversal,
} from "./prepaidTopups";
import { getEarlyAccessPriceId, getStripe, getStripeWebhookSecret } from "./stripe";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import Stripe from "stripe";
import { dbPool } from "~~/lib/db";
import { acquireSessionAdvisoryLock, releaseSessionAdvisoryLocksAndConnection } from "~~/lib/db/advisoryLocks";
import { stripeRefundReversalKey } from "~~/lib/tokenless/idempotencyKeys";
import { persistScheduledProcessorHealth } from "~~/lib/tokenless/scheduledProcessorHealth";

const HANDLED_EVENTS = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.voided",
  "invoice.marked_uncollectible",
]);

/** Events that give money back to the customer and must debit the prepaid balance. */
const REVERSAL_EVENTS = new Set([
  "credit_note.created",
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.closed",
]);

const STRIPE_WEBHOOK_HEALTH_PROCESSOR = "processStripeWebhook";
const STRIPE_WEBHOOK_ATTENTION_CODE = "billing_webhook_operator_attention";
const STRIPE_WEBHOOK_ATTENTION_DIGEST = `sha256:${createHash("sha256")
  .update(`${STRIPE_WEBHOOK_HEALTH_PROCESSOR}:${STRIPE_WEBHOOK_ATTENTION_CODE}`)
  .digest("hex")}` as const;

function providerId(value: string | { id: string } | null | undefined) {
  return typeof value === "string" ? value : (value?.id ?? null);
}

function invoiceSubscriptionId(invoice: Stripe.Invoice) {
  const value = invoice.parent?.subscription_details?.subscription;
  return providerId(value);
}

function subscriptionPeriod(subscription: Stripe.Subscription) {
  if (subscription.items.data.length !== 1) {
    throw new Error("unsupported_subscription_items");
  }
  const item = subscription.items.data[0];
  return {
    end: new Date(item.current_period_end * 1000),
    start: new Date(item.current_period_start * 1000),
  };
}

function earlyAccessPriceVersion(value: unknown) {
  return typeof value === "string" && getPlanByPriceVersion(value)?.key === "early_access"
    ? (value as TokenlessBillingPriceVersion)
    : null;
}

/**
 * Map a subscription's actual price to the price version it is billed under, or null when the
 * price is not one we recognise.
 *
 * Rotating `STRIPE_EARLY_ACCESS_MONTHLY_PRICE_ID` must not orphan the subscribers still on the
 * previous price, and no legacy price-id variable exists to list them. Both remaining sources of
 * truth are facts Stripe or an earlier projection already recorded: the price version stamped on
 * the subscription at Checkout, and the version we stored the last time we projected this exact
 * subscription and price. The stored `price_version` therefore becomes a mapping of the real
 * price rather than an assertion that the current price is the only one that can exist.
 */
async function resolveSubscriptionPriceVersion(client: PoolClient, subscription: Stripe.Subscription) {
  if (subscription.items.data.length !== 1) return null;
  const priceId = subscription.items.data[0].price.id;
  if (priceId === getEarlyAccessPriceId()) return EARLY_ACCESS_PRICE_VERSION;
  const declared = earlyAccessPriceVersion(subscription.metadata.rateloop_price_version);
  if (declared) return declared;
  const stored = await client.query(
    `SELECT price_version FROM tokenless_workspace_subscriptions
     WHERE provider_subscription_id = $1 AND provider_price_id = $2 LIMIT 1`,
    [subscription.id, priceId],
  );
  return earlyAccessPriceVersion(stored.rows[0]?.price_version);
}

async function workspaceForCustomer(client: PoolClient, customerId: string) {
  const result = await client.query(
    `SELECT workspace_id FROM tokenless_workspace_billing_customers
     WHERE provider = 'stripe' AND provider_customer_id = $1 LIMIT 1`,
    [customerId],
  );
  const workspaceId = result.rows[0]?.workspace_id;
  return typeof workspaceId === "string" ? workspaceId : null;
}

async function assertSubscriptionOwnership(client: PoolClient, subscription: Stripe.Subscription) {
  const customerId = providerId(subscription.customer);
  if (!customerId) throw new Error("subscription_customer_missing");
  const workspaceId = await workspaceForCustomer(client, customerId);
  if (!workspaceId) throw new Error("billing_customer_not_mapped");
  const metadataWorkspaceId = subscription.metadata.rateloop_workspace_id;
  if (metadataWorkspaceId && metadataWorkspaceId !== workspaceId) {
    throw new Error("subscription_workspace_mismatch");
  }
  return workspaceId;
}

async function projectSubscription(client: PoolClient, event: Stripe.Event, subscription: Stripe.Subscription) {
  const workspaceId = await assertSubscriptionOwnership(client, subscription);
  const priceVersion = await resolveSubscriptionPriceVersion(client, subscription);
  if (!priceVersion) {
    // Never grant an entitlement from a price we cannot map, and never fail the shared endpoint
    // over it. Any entitlement this workspace already has is left in place rather than being
    // quietly downgraded to Free while Stripe keeps charging.
    return "unsupported_subscription_price";
  }
  const period = subscriptionPeriod(subscription);
  const eventCreatedAt = new Date(event.created * 1000);
  const now = new Date();
  await client.query(
    `INSERT INTO tokenless_workspace_subscriptions
       (workspace_id, plan_key, price_version, provider_subscription_id, provider_price_id,
        provider_status, provider_event_created_at, provider_event_id, current_period_start, current_period_end,
        cancel_at_period_end, created_at, updated_at)
     VALUES ($1, 'early_access', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
     ON CONFLICT (workspace_id) DO UPDATE SET
       plan_key = EXCLUDED.plan_key,
       price_version = EXCLUDED.price_version,
       provider_subscription_id = EXCLUDED.provider_subscription_id,
       provider_price_id = EXCLUDED.provider_price_id,
       provider_status = EXCLUDED.provider_status,
       provider_event_created_at = EXCLUDED.provider_event_created_at,
       provider_event_id = EXCLUDED.provider_event_id,
       current_period_start = EXCLUDED.current_period_start,
       current_period_end = EXCLUDED.current_period_end,
       cancel_at_period_end = EXCLUDED.cancel_at_period_end,
       updated_at = EXCLUDED.updated_at
     WHERE (
       tokenless_workspace_subscriptions.provider_event_created_at IS NULL
       OR tokenless_workspace_subscriptions.provider_event_created_at < EXCLUDED.provider_event_created_at
       OR (
         tokenless_workspace_subscriptions.provider_event_created_at = EXCLUDED.provider_event_created_at
         AND COALESCE(tokenless_workspace_subscriptions.provider_event_id, '') < EXCLUDED.provider_event_id
       )
     ) AND (
       tokenless_workspace_subscriptions.provider_subscription_id IS NULL
       OR tokenless_workspace_subscriptions.provider_subscription_id = EXCLUDED.provider_subscription_id
       OR tokenless_workspace_subscriptions.provider_status IN ('free', 'canceled', 'incomplete_expired')
     )`,
    [
      workspaceId,
      priceVersion,
      subscription.id,
      subscription.items.data[0].price.id,
      subscription.status,
      eventCreatedAt,
      event.id,
      period.start,
      period.end,
      subscription.cancel_at_period_end,
      now,
    ],
  );
  return null;
}

async function subscriptionForEvent(event: Stripe.Event) {
  if (event.type.startsWith("customer.subscription.")) {
    const subscription = event.data.object as Stripe.Subscription;
    return event.type === "customer.subscription.deleted"
      ? subscription
      : getStripe().subscriptions.retrieve(subscription.id);
  }
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const subscriptionId = providerId(session.subscription);
    if (!subscriptionId) throw new Error("checkout_subscription_missing");
    return getStripe().subscriptions.retrieve(subscriptionId);
  }
  if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
    const subscriptionId = invoiceSubscriptionId(event.data.object as Stripe.Invoice);
    if (!subscriptionId) return null;
    return getStripe().subscriptions.retrieve(subscriptionId);
  }
  return null;
}

function boundedErrorCode(error: unknown) {
  if (error instanceof Error && /^[a-z0-9_]{1,80}$/.test(error.message)) return error.message;
  return "webhook_processing_failed";
}

async function invoiceIdForCharge(charge: Stripe.Charge) {
  const paymentIntentId = providerId(charge.payment_intent);
  if (!paymentIntentId) return null;
  const payments = await getStripe().invoicePayments.list({
    limit: 1,
    payment: { payment_intent: paymentIntentId, type: "payment_intent" },
  });
  const invoice = payments.data[0]?.invoice;
  return providerId(invoice as string | { id: string } | null | undefined);
}

type ReversalTarget = { grossMinor: number; invoiceId: string; reinstate: boolean; reversalId: string };

/**
 * Resolve a reversal event to the invoice it takes money back from.
 *
 * The gross minor amount is whatever Stripe returned to the customer; `projectPrepaidReversal`
 * converts it to the net share that was actually credited. Events that do not resolve to an
 * invoice are not prepaid reversals and are simply processed.
 */
async function resolveReversalTarget(event: Stripe.Event): Promise<ReversalTarget | null> {
  if (event.type === "credit_note.created") {
    const creditNote = event.data.object as Stripe.CreditNote;
    const invoiceId = providerId(creditNote.invoice);
    return invoiceId ? { grossMinor: creditNote.total, invoiceId, reinstate: false, reversalId: creditNote.id } : null;
  }
  if (event.type === "charge.refunded") {
    const charge = event.data.object as Stripe.Charge;
    const invoiceId = await invoiceIdForCharge(charge);
    if (!invoiceId) return null;
    // `refunds` is not expanded by default, so the individual refund is usually absent and only
    // the charge's cumulative `amount_refunded` is available. A cumulative amount must never be
    // keyed on the charge alone: a second partial refund would collide with the first, be dropped
    // by the conflict clause, and report the first refund's smaller amount as success. Keying on
    // the running total gives each refund state its own entry, and the reversal cap then debits
    // exactly the difference. A redelivery repeats a total already seen and stays idempotent.
    const refund = charge.refunds?.data?.[0];
    return {
      grossMinor: refund?.amount ?? charge.amount_refunded,
      invoiceId,
      reinstate: false,
      reversalId: refund?.id
        ? stripeRefundReversalKey({ kind: "refund", refundId: refund.id })
        : stripeRefundReversalKey({
            amountRefundedMinor: charge.amount_refunded,
            chargeId: charge.id,
            kind: "charge_running_total",
          }),
    };
  }
  if (event.type === "charge.dispute.created" || event.type === "charge.dispute.closed") {
    const dispute = event.data.object as Stripe.Dispute;
    const chargeId = providerId(dispute.charge);
    if (!chargeId) return null;
    const won = event.type === "charge.dispute.closed" && dispute.status === "won";
    if (event.type === "charge.dispute.closed" && !won && dispute.status !== "lost") return null;
    const invoiceId = await invoiceIdForCharge(await getStripe().charges.retrieve(chargeId));
    return invoiceId ? { grossMinor: dispute.amount, invoiceId, reinstate: won, reversalId: dispute.id } : null;
  }
  return null;
}

/**
 * Close out an event.
 *
 * An event that needs a human is deliberately left un-`processed` and flagged with its reason, so
 * it shows up in the `processing_status` index and is re-driven if it is replayed. The caller
 * still answers Stripe with a 200: these states are not fixed by redelivering the same event for
 * three days, and this is the single endpoint for every billing event.
 */
async function recordEventOutcome(client: PoolClient, eventId: string, attention: string[]) {
  const failed = attention.length > 0;
  await client.query(
    `UPDATE tokenless_billing_webhook_events
     SET processing_status = $1, processed_at = $2, error_code = $3
     WHERE provider_event_id = $4`,
    [
      failed ? "failed" : "processed",
      failed ? null : new Date(),
      failed ? attention.join(",").slice(0, 200) : null,
      eventId,
    ],
  );
}

/**
 * Project the durable queue state rather than the outcome of only the latest delivery. A healthy
 * event must not clear an older event that still needs an operator, while replaying the repaired
 * event resolves the health row once the failed queue is empty.
 *
 * Health projection is deliberately best-effort after the webhook event itself is durable. Stripe
 * must not retry an operator-attention event merely because the observability projection failed.
 */
async function projectStripeWebhookHealth(
  client: Pick<PoolClient, "query">,
  now = new Date(),
  persistHealth = persistScheduledProcessorHealth,
) {
  try {
    const pending = await client.query(
      `SELECT COUNT(*) AS count FROM tokenless_billing_webhook_events
       WHERE processing_status='failed'`,
    );
    const pendingCount = Number(pending.rows[0]?.count ?? 0);
    if (!Number.isSafeInteger(pendingCount) || pendingCount < 0) {
      throw new Error("invalid_billing_webhook_attention_count");
    }
    await persistHealth(
      [
        pendingCount > 0
          ? {
              configurationState: "broken",
              errorCode: STRIPE_WEBHOOK_ATTENTION_CODE,
              errorDigest: STRIPE_WEBHOOK_ATTENTION_DIGEST,
              processor: STRIPE_WEBHOOK_HEALTH_PROCESSOR,
            }
          : {
              configurationState: "enabled",
              processor: STRIPE_WEBHOOK_HEALTH_PROCESSOR,
            },
      ],
      now,
    );
  } catch {
    console.error(
      JSON.stringify({
        event: "tokenless_stripe_webhook_health_projection_failed",
      }),
    );
  }
}

export function constructStripeEvent(rawBody: string, signature: string | null) {
  return getStripe().webhooks.constructEvent(rawBody, signature ?? "", getStripeWebhookSecret());
}

export async function processStripeWebhook(input: { event: Stripe.Event; rawBody: string }) {
  const payloadSha256 = createHash("sha256").update(input.rawBody).digest("hex");
  const client = await dbPool.connect();
  const acquiredLockKeys: string[] = [];
  try {
    await acquireSessionAdvisoryLock(client, input.event.id);
    acquiredLockKeys.push(input.event.id);
    const existing = await client.query(
      `SELECT processing_status, payload_sha256 FROM tokenless_billing_webhook_events
       WHERE provider_event_id = $1 LIMIT 1`,
      [input.event.id],
    );
    if (existing.rows[0] && existing.rows[0].payload_sha256 !== payloadSha256) {
      throw new Error("event_payload_mismatch");
    }
    if (existing.rows[0]?.processing_status === "processed") {
      if (input.event.type.startsWith("invoice.")) {
        const invoiceId = (input.event.data.object as Stripe.Invoice).id;
        const topup = await client.query(
          "SELECT topup_id FROM tokenless_prepaid_topup_intents WHERE provider='stripe' AND provider_invoice_id=$1",
          [invoiceId],
        );
        const topupId = topup.rows[0]?.topup_id;
        if (typeof topupId === "string") await drainPrepaidTopupAuditOutbox({ topupId });
      }
      return { duplicate: true };
    }

    const receivedAt = new Date();
    await client.query(
      `INSERT INTO tokenless_billing_webhook_events
         (provider_event_id, event_type, payload_sha256, event_created_at, processing_status,
          error_code, received_at, processed_at)
       VALUES ($1, $2, $3, $4, 'processing', NULL, $5, NULL)
       ON CONFLICT (provider_event_id) DO UPDATE SET
         processing_status = 'processing', error_code = NULL, received_at = EXCLUDED.received_at`,
      [input.event.id, input.event.type, payloadSha256, new Date(input.event.created * 1000), receivedAt],
    );

    try {
      let topupId: string | null = null;
      const attention: string[] = [];
      if (HANDLED_EVENTS.has(input.event.type)) {
        const subscription = await subscriptionForEvent(input.event);
        const eventInvoice = input.event.type.startsWith("invoice.")
          ? (input.event.data.object as Stripe.Invoice)
          : null;
        let topupInvoice = Boolean(eventInvoice?.metadata?.rateloop_purpose === "prepaid_topup");
        if (eventInvoice && !topupInvoice) {
          const local = await client.query(
            "SELECT topup_id FROM tokenless_prepaid_topup_intents WHERE provider='stripe' AND provider_invoice_id=$1",
            [eventInvoice.id],
          );
          topupInvoice = local.rowCount === 1;
        }
        const invoice = eventInvoice && topupInvoice ? await getStripe().invoices.retrieve(eventInvoice.id) : null;
        await client.query("BEGIN");
        try {
          if (subscription) {
            const unsupported = await projectSubscription(client, input.event, subscription);
            if (unsupported) attention.push(unsupported);
          }
          if (invoice) {
            const projected = await projectPrepaidInvoice(client, {
              eventCreatedAt: new Date(input.event.created * 1000),
              eventId: input.event.id,
              invoice,
            });
            if (projected.matched) topupId = invoice.metadata?.rateloop_topup_id ?? null;
            if (projected.attention) attention.push(projected.attention);
          }
          await recordEventOutcome(client, input.event.id, attention);
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      } else if (REVERSAL_EVENTS.has(input.event.type)) {
        const target = await resolveReversalTarget(input.event);
        await client.query("BEGIN");
        try {
          if (target) {
            const reversal = target.reinstate
              ? await reinstatePrepaidReversal(client, target)
              : await projectPrepaidReversal(client, target);
            if (reversal.attention) attention.push(reversal.attention);
          }
          await recordEventOutcome(client, input.event.id, attention);
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      } else {
        await recordEventOutcome(client, input.event.id, attention);
      }
      if (topupId) await drainPrepaidTopupAuditOutbox({ topupId });
      if (attention.length > 0 || existing.rows[0]?.processing_status === "failed") {
        await projectStripeWebhookHealth(client, receivedAt);
      }
      return attention.length > 0 ? { attention: attention.join(","), duplicate: false } : { duplicate: false };
    } catch (error) {
      await client.query(
        `UPDATE tokenless_billing_webhook_events
         SET processing_status = 'failed', error_code = $1, processed_at = NULL
         WHERE provider_event_id = $2`,
        [boundedErrorCode(error), input.event.id],
      );
      throw error;
    }
  } finally {
    await releaseSessionAdvisoryLocksAndConnection(client, acquiredLockKeys);
  }
}

export const __stripeWebhookTestUtils = {
  boundedErrorCode,
  invoiceSubscriptionId,
  projectStripeWebhookHealth,
  subscriptionPeriod,
};

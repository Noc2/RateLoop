import { EARLY_ACCESS_PRICE_VERSION } from "./plans";
import { getEarlyAccessPriceId, getStripe, getStripeWebhookSecret } from "./stripe";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import Stripe from "stripe";
import { dbPool } from "~~/lib/db";

const HANDLED_EVENTS = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
]);

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

function supportedSubscription(subscription: Stripe.Subscription) {
  if (subscription.items.data.length !== 1 || subscription.items.data[0].price.id !== getEarlyAccessPriceId()) {
    throw new Error("unsupported_subscription_price");
  }
  return EARLY_ACCESS_PRICE_VERSION;
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
  const priceVersion = supportedSubscription(subscription);
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

export function constructStripeEvent(rawBody: string, signature: string | null) {
  return getStripe().webhooks.constructEvent(rawBody, signature ?? "", getStripeWebhookSecret());
}

export async function processStripeWebhook(input: { event: Stripe.Event; rawBody: string }) {
  const payloadSha256 = createHash("sha256").update(input.rawBody).digest("hex");
  const client = await dbPool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [input.event.id]);
    const existing = await client.query(
      `SELECT processing_status, payload_sha256 FROM tokenless_billing_webhook_events
       WHERE provider_event_id = $1 LIMIT 1`,
      [input.event.id],
    );
    if (existing.rows[0] && existing.rows[0].payload_sha256 !== payloadSha256) {
      throw new Error("event_payload_mismatch");
    }
    if (existing.rows[0]?.processing_status === "processed") return { duplicate: true };

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
      if (HANDLED_EVENTS.has(input.event.type)) {
        const subscription = await subscriptionForEvent(input.event);
        if (subscription) {
          await client.query("BEGIN");
          try {
            await projectSubscription(client, input.event, subscription);
            await client.query(
              `UPDATE tokenless_billing_webhook_events
               SET processing_status = 'processed', processed_at = $1, error_code = NULL
               WHERE provider_event_id = $2`,
              [new Date(), input.event.id],
            );
            await client.query("COMMIT");
          } catch (error) {
            await client.query("ROLLBACK");
            throw error;
          }
        } else {
          await client.query(
            `UPDATE tokenless_billing_webhook_events
             SET processing_status = 'processed', processed_at = $1, error_code = NULL
             WHERE provider_event_id = $2`,
            [new Date(), input.event.id],
          );
        }
      } else {
        await client.query(
          `UPDATE tokenless_billing_webhook_events
           SET processing_status = 'processed', processed_at = $1, error_code = NULL
           WHERE provider_event_id = $2`,
          [new Date(), input.event.id],
        );
      }
      return { duplicate: false };
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
    await client.query("SELECT pg_advisory_unlock(hashtext($1))", [input.event.id]).catch(() => undefined);
    client.release();
  }
}

export const __stripeWebhookTestUtils = {
  boundedErrorCode,
  invoiceSubscriptionId,
  subscriptionPeriod,
};

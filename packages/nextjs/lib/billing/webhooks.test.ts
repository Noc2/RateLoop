import { __setStripeForTests } from "./stripe";
import { processStripeWebhook } from "./webhooks";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import type Stripe from "stripe";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";

const originalPrice = process.env.STRIPE_EARLY_ACCESS_MONTHLY_PRICE_ID;
const PRICE_ID = "price_early_access_fixture";
let canonicalSubscription: Stripe.Subscription;

function subscriptionEvent(input: {
  created: number;
  eventId: string;
  eventType?: "customer.subscription.updated" | "customer.subscription.deleted";
  status: Stripe.Subscription.Status;
  priceId?: string;
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
        metadata: { rateloop_workspace_id: "ws_fixture" },
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

beforeEach(async () => {
  process.env.STRIPE_EARLY_ACCESS_MONTHLY_PRICE_ID = PRICE_ID;
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  __setStripeForTests({
    subscriptions: { retrieve: async () => canonicalSubscription },
  } as unknown as Stripe);
  const now = new Date("2026-07-14T12:00:00.000Z");
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspaces (workspace_id, name, status, created_at, updated_at)
          VALUES ('ws_fixture', 'Fixture', 'active', ?, ?)`,
    args: [now, now],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_billing_customers
            (workspace_id, provider, provider_customer_id, created_at, updated_at)
          VALUES ('ws_fixture', 'stripe', 'cus_fixture', ?, ?)`,
    args: [now, now],
  });
});

afterEach(() => {
  __setStripeForTests(null);
  __setDatabaseResourcesForTests(null);
  if (originalPrice === undefined) delete process.env.STRIPE_EARLY_ACCESS_MONTHLY_PRICE_ID;
  else process.env.STRIPE_EARLY_ACCESS_MONTHLY_PRICE_ID = originalPrice;
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
      priceVersion: "early_access_usd_99_2026_07",
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

test("unsupported Stripe prices fail closed and leave a bounded retry record", async () => {
  const event = subscriptionEvent({
    created: 1_784_035_200,
    eventId: "evt_wrong_price",
    priceId: "price_attacker_controlled",
    status: "active",
  });
  canonicalSubscription = event.data.object as Stripe.Subscription;
  await assert.rejects(
    () => processStripeWebhook({ event, rawBody: "wrong-price-body" }),
    /unsupported_subscription_price/,
  );

  const subscription = await dbClient.execute(
    "SELECT provider_subscription_id FROM tokenless_workspace_subscriptions WHERE workspace_id = 'ws_fixture'",
  );
  assert.equal(subscription.rowCount, 0);
  const recorded = await dbClient.execute(
    "SELECT processing_status, error_code FROM tokenless_billing_webhook_events WHERE provider_event_id = 'evt_wrong_price'",
  );
  assert.equal(recorded.rows[0]?.processing_status, "failed");
  assert.equal(recorded.rows[0]?.error_code, "unsupported_subscription_price");
});

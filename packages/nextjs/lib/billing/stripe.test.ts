import { EARLY_ACCESS_PRICE_VERSION } from "./plans";
import {
  __resetStripeForTests,
  checkoutIdempotencyKey,
  isBlockingSubscriptionStatus,
  isExpectedEarlyAccessStripePrice,
  subscriptionsEnabled,
} from "./stripe";
import { constructStripeEvent } from "./webhooks";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

const originalEnv = {
  secret: process.env.STRIPE_SECRET_KEY,
  subscriptions: process.env.TOKENLESS_SUBSCRIPTIONS_ENABLED,
  webhook: process.env.STRIPE_WEBHOOK_SECRET,
};

afterEach(() => {
  __resetStripeForTests();
  if (originalEnv.secret === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = originalEnv.secret;
  if (originalEnv.subscriptions === undefined) delete process.env.TOKENLESS_SUBSCRIPTIONS_ENABLED;
  else process.env.TOKENLESS_SUBSCRIPTIONS_ENABLED = originalEnv.subscriptions;
  if (originalEnv.webhook === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
  else process.env.STRIPE_WEBHOOK_SECRET = originalEnv.webhook;
});

test("subscription feature flag is explicit and fails closed", () => {
  assert.equal(subscriptionsEnabled({}), false);
  assert.equal(subscriptionsEnabled({ TOKENLESS_SUBSCRIPTIONS_ENABLED: "false" }), false);
  assert.equal(subscriptionsEnabled({ TOKENLESS_SUBSCRIPTIONS_ENABLED: "true" }), true);
  assert.throws(
    () => subscriptionsEnabled({ TOKENLESS_SUBSCRIPTIONS_ENABLED: "yes" }),
    /must be exactly true or false/,
  );
});

test("checkout retries use one server-owned key per workspace price version", () => {
  const first = checkoutIdempotencyKey("ws_test");
  const retry = checkoutIdempotencyKey("ws_test");
  assert.equal(first, retry);
  assert.match(first, new RegExp(EARLY_ACCESS_PRICE_VERSION));
});

test("only terminal Stripe subscriptions allow a fresh Checkout", () => {
  assert.equal(isBlockingSubscriptionStatus("active"), true);
  assert.equal(isBlockingSubscriptionStatus("past_due"), true);
  assert.equal(isBlockingSubscriptionStatus("unpaid"), true);
  assert.equal(isBlockingSubscriptionStatus("incomplete"), true);
  assert.equal(isBlockingSubscriptionStatus("canceled"), false);
  assert.equal(isBlockingSubscriptionStatus("incomplete_expired"), false);
});

test("Checkout accepts only the configured Early Access amount and cadence", () => {
  const expected = {
    active: true,
    currency: "usd",
    recurring: { interval: "month", interval_count: 1 },
    type: "recurring",
    unit_amount: 2_900,
  };
  assert.equal(isExpectedEarlyAccessStripePrice(expected), true);
  assert.equal(isExpectedEarlyAccessStripePrice({ ...expected, unit_amount: 9_900 }), false);
  assert.equal(
    isExpectedEarlyAccessStripePrice({ ...expected, recurring: { interval: "year", interval_count: 1 } }),
    false,
  );
  assert.equal(isExpectedEarlyAccessStripePrice({ ...expected, active: false }), false);
});

test("Stripe webhook construction accepts only a signature for the exact raw body", async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_rateloop_fixture";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_rateloop_fixture";
  const payload = JSON.stringify({
    api_version: "2026-06-30.basil",
    created: 1_783_987_200,
    data: { object: { id: "sub_fixture", object: "subscription" } },
    id: "evt_fixture",
    livemode: false,
    object: "event",
    pending_webhooks: 1,
    request: null,
    type: "customer.subscription.updated",
  });
  const { getStripe } = await import("./stripe");
  const signature = getStripe().webhooks.generateTestHeaderString({
    payload,
    secret: process.env.STRIPE_WEBHOOK_SECRET,
  });
  assert.equal(constructStripeEvent(payload, signature).id, "evt_fixture");
  assert.throws(() => constructStripeEvent(`${payload} `, signature));
  assert.throws(() => constructStripeEvent(payload, null));
});

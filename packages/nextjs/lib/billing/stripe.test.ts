import { EARLY_ACCESS_PRICE_VERSION } from "./plans";
import {
  __resetStripeForTests,
  __setStripeForTests,
  checkoutIdempotencyKey,
  isBlockingSubscriptionStatus,
  isExpectedEarlyAccessStripePrice,
  preparePrepaidInvoiceCustomer,
  subscriptionsEnabled,
  workspaceBillingReturnPath,
} from "./stripe";
import { constructStripeEvent } from "./webhooks";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type Stripe from "stripe";

const originalEnv = {
  secret: process.env.STRIPE_SECRET_KEY,
  subscriptions: process.env.TOKENLESS_SUBSCRIPTIONS_ENABLED,
  webhook: process.env.STRIPE_WEBHOOK_SECRET,
};

afterEach(() => {
  __setStripeForTests(null);
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

test("billing providers return to the workspace that initiated billing", () => {
  assert.equal(
    workspaceBillingReturnPath("ws second/with spaces"),
    "/agents?tab=overview&workspace=ws+second%2Fwith+spaces",
  );
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

test("a top-up without a VAT id leaves the subscription's stored VAT id alone", async () => {
  const deleted: string[] = [];
  const created: string[] = [];
  __setStripeForTests({
    customers: {
      createTaxId: async (_customerId: string, params: { value: string }) => {
        created.push(params.value);
        return { id: "txi_new" };
      },
      deleteTaxId: async (_customerId: string, taxIdId: string) => {
        deleted.push(taxIdId);
        return { deleted: true };
      },
      listTaxIds: async () => ({ data: [{ id: "txi_existing", type: "eu_vat", value: "DE123456789" }] }),
      update: async () => ({ id: "cus_shared" }),
    },
  } as unknown as Stripe);
  const address = {
    city: "Berlin",
    country: "DE",
    line1: "Hauptstr 1",
    line2: null,
    postalCode: "10115",
    state: null,
  };
  const input = { address, customerId: "cus_shared", legalName: "Fixture GmbH", workspaceId: "ws_fixture" };

  await preparePrepaidInvoiceCustomer({ ...input, vatId: null });
  assert.deepEqual(deleted, [], "an absent VAT id must not delete the one the subscription relies on");
  assert.deepEqual(created, []);

  await preparePrepaidInvoiceCustomer({ ...input, vatId: "DE123456789" });
  assert.deepEqual(deleted, [], "an unchanged VAT id is left in place");

  await preparePrepaidInvoiceCustomer({ ...input, vatId: "DE999999999" });
  assert.deepEqual(deleted, ["txi_existing"], "a different VAT id replaces the stored one");
  assert.deepEqual(created, ["DE999999999"]);

  await preparePrepaidInvoiceCustomer({ ...input, removeStoredVatIds: true, vatId: null });
  assert.deepEqual(deleted, ["txi_existing", "txi_existing"], "an explicit removal still deletes");
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

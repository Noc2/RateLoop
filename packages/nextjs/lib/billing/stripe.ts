import { EARLY_ACCESS_PRICE_VERSION, TOKENLESS_BILLING_PLANS, formatUsdPrice } from "./plans";
import "server-only";
import Stripe from "stripe";
import { getOptionalAppUrl } from "~~/lib/env/server";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

let stripeClient: Stripe | null = null;

function readEnv(name: string) {
  return process.env[name]?.trim() || undefined;
}

export function subscriptionsEnabled(env: Record<string, string | undefined> = process.env) {
  const value = env.TOKENLESS_SUBSCRIPTIONS_ENABLED?.trim().toLowerCase();
  if (!value || value === "false") return false;
  if (value === "true") return true;
  throw new TokenlessServiceError(
    "TOKENLESS_SUBSCRIPTIONS_ENABLED must be exactly true or false.",
    500,
    "invalid_billing_configuration",
  );
}

function requiredEnv(name: string) {
  const value = readEnv(name);
  if (!value) {
    throw new TokenlessServiceError(`${name} is required when subscriptions are enabled.`, 503, "billing_unavailable");
  }
  return value;
}

export function getStripe() {
  if (!stripeClient) {
    stripeClient = new Stripe(requiredEnv("STRIPE_SECRET_KEY"), {
      appInfo: { name: "RateLoop tokenless" },
      maxNetworkRetries: 2,
    });
  }
  return stripeClient;
}

export function getStripeWebhookSecret() {
  return requiredEnv("STRIPE_WEBHOOK_SECRET");
}

export function getEarlyAccessPriceId() {
  return requiredEnv("STRIPE_EARLY_ACCESS_MONTHLY_PRICE_ID");
}

export function isExpectedEarlyAccessStripePrice(price: {
  active: boolean;
  currency: string;
  recurring: { interval: string; interval_count: number } | null;
  type: string;
  unit_amount: number | null;
}) {
  return (
    price.active &&
    price.currency === "usd" &&
    price.type === "recurring" &&
    price.recurring?.interval === "month" &&
    price.recurring.interval_count === 1 &&
    price.unit_amount === TOKENLESS_BILLING_PLANS.early_access.monthlyPriceCents
  );
}

async function getValidatedEarlyAccessPriceId() {
  const priceId = getEarlyAccessPriceId();
  const price = await getStripe().prices.retrieve(priceId);
  if (!isExpectedEarlyAccessStripePrice(price)) {
    const priceLabel = formatUsdPrice(TOKENLESS_BILLING_PLANS.early_access.monthlyPriceCents);
    throw new TokenlessServiceError(
      `STRIPE_EARLY_ACCESS_MONTHLY_PRICE_ID must reference an active USD ${priceLabel} monthly recurring price.`,
      503,
      "invalid_billing_configuration",
    );
  }
  return priceId;
}

function getBillingAppUrl() {
  const appUrl = getOptionalAppUrl();
  if (!appUrl) {
    throw new TokenlessServiceError("APP_URL is required for hosted billing redirects.", 503, "billing_unavailable");
  }
  return appUrl.replace(/\/$/, "");
}

export function checkoutIdempotencyKey(workspaceId: string) {
  return `rateloop:checkout:${workspaceId}:${EARLY_ACCESS_PRICE_VERSION}`;
}

export function isBlockingSubscriptionStatus(status: Stripe.Subscription.Status) {
  return status !== "canceled" && status !== "incomplete_expired";
}

export async function findBlockingStripeSubscription(customerId: string) {
  const subscriptions = await getStripe().subscriptions.list({ customer: customerId, limit: 100, status: "all" });
  return subscriptions.data.find(subscription => isBlockingSubscriptionStatus(subscription.status)) ?? null;
}

export async function createStripeCustomer(input: { workspaceId: string; legalName: string }) {
  return getStripe().customers.create(
    {
      description: input.legalName,
      metadata: { rateloop_workspace_id: input.workspaceId },
      name: input.legalName,
    },
    { idempotencyKey: `rateloop:customer:${input.workspaceId}` },
  );
}

export async function createEarlyAccessCheckout(input: { customerId: string; legalName: string; workspaceId: string }) {
  const appUrl = getBillingAppUrl();
  const priceId = await getValidatedEarlyAccessPriceId();
  const session = await getStripe().checkout.sessions.create(
    {
      allow_promotion_codes: false,
      automatic_tax: { enabled: true },
      billing_address_collection: "required",
      cancel_url: `${appUrl}/agents?tab=overview&billing=cancelled`,
      customer: input.customerId,
      customer_update: { address: "auto", name: "auto" },
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: {
        rateloop_price_version: EARLY_ACCESS_PRICE_VERSION,
        rateloop_workspace_id: input.workspaceId,
      },
      mode: "subscription",
      subscription_data: {
        description: `RateLoop Early Access for ${input.legalName}`,
        metadata: {
          rateloop_price_version: EARLY_ACCESS_PRICE_VERSION,
          rateloop_workspace_id: input.workspaceId,
        },
      },
      success_url: `${appUrl}/agents?tab=overview&billing=success`,
      tax_id_collection: { enabled: true },
    },
    { idempotencyKey: checkoutIdempotencyKey(input.workspaceId) },
  );
  if (!session.url) {
    throw new TokenlessServiceError(
      "Stripe did not return a hosted Checkout URL.",
      502,
      "billing_provider_error",
      true,
    );
  }
  return session.url;
}

export async function createStripePortal(customerId: string) {
  const session = await getStripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: `${getBillingAppUrl()}/agents?tab=overview`,
  });
  return session.url;
}

export function __resetStripeForTests() {
  stripeClient = null;
}

export function __setStripeForTests(client: Stripe | null) {
  stripeClient = client;
}

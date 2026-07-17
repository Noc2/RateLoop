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

function strictFeatureFlag(name: string, env: Record<string, string | undefined>) {
  const value = env[name]?.trim().toLowerCase();
  if (!value || value === "false") return false;
  if (value === "true") return true;
  throw new TokenlessServiceError(`${name} must be exactly true or false.`, 500, "invalid_billing_configuration");
}

export function prepaidTopupsEnabled(env: Record<string, string | undefined> = process.env) {
  return strictFeatureFlag("TOKENLESS_PREPAID_TOPUP_ENABLED", env);
}

function requiredEnv(name: string) {
  const value = readEnv(name);
  if (!value) {
    throw new TokenlessServiceError(`${name} is required when Stripe billing is enabled.`, 503, "billing_unavailable");
  }
  return value;
}

export function getPrepaidTopupTaxCode() {
  const value = requiredEnv("STRIPE_PREPAID_TOPUP_TAX_CODE");
  if (!/^txcd_[A-Za-z0-9_]+$/u.test(value)) {
    throw new TokenlessServiceError(
      "STRIPE_PREPAID_TOPUP_TAX_CODE must be a Stripe Tax code.",
      503,
      "invalid_billing_configuration",
    );
  }
  return value;
}

export function getPrepaidTopupBankTransferType() {
  const value = requiredEnv("STRIPE_PREPAID_TOPUP_BANK_TRANSFER_TYPE");
  if (value !== "us_bank_transfer") {
    throw new TokenlessServiceError(
      "USD prepaid top-ups require STRIPE_PREPAID_TOPUP_BANK_TRANSFER_TYPE=us_bank_transfer.",
      503,
      "invalid_billing_configuration",
    );
  }
  return value;
}

export function stripeLivemode(env: Record<string, string | undefined> = process.env) {
  const key = env.STRIPE_SECRET_KEY?.trim() ?? "";
  if (key.startsWith("sk_live_") || key.startsWith("rk_live_")) return true;
  if (key.startsWith("sk_test_") || key.startsWith("rk_test_")) return false;
  throw new TokenlessServiceError(
    "STRIPE_SECRET_KEY must identify Stripe test or live mode.",
    503,
    "invalid_billing_configuration",
  );
}

export function assertPrepaidTopupConfiguration() {
  if (!prepaidTopupsEnabled()) {
    throw new TokenlessServiceError("Prepaid top-ups are not enabled yet.", 503, "prepaid_topup_unavailable");
  }
  requiredEnv("STRIPE_SECRET_KEY");
  requiredEnv("STRIPE_WEBHOOK_SECRET");
  getPrepaidTopupTaxCode();
  getPrepaidTopupBankTransferType();
  stripeLivemode();
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

export type PrepaidInvoiceAddress = {
  country: string;
  line1: string;
  line2: string | null;
  city: string;
  postalCode: string;
  state: string | null;
};

export async function preparePrepaidInvoiceCustomer(input: {
  address: PrepaidInvoiceAddress;
  customerId: string;
  legalName: string;
  vatId: string | null;
  workspaceId: string;
}) {
  const stripe = getStripe();
  await stripe.customers.update(input.customerId, {
    address: {
      city: input.address.city,
      country: input.address.country,
      line1: input.address.line1,
      line2: input.address.line2 ?? undefined,
      postal_code: input.address.postalCode,
      state: input.address.state ?? undefined,
    },
    description: input.legalName,
    metadata: { rateloop_workspace_id: input.workspaceId },
    name: input.legalName,
  });
  const taxIds = await stripe.customers.listTaxIds(input.customerId, { limit: 100 });
  const existingVatIds = taxIds.data.filter(taxId => taxId.type === "eu_vat");
  if (!input.vatId) {
    for (const taxId of existingVatIds) await stripe.customers.deleteTaxId(input.customerId, taxId.id);
    return;
  }
  if (existingVatIds.some(taxId => taxId.value.replace(/\s+/gu, "").toUpperCase() === input.vatId)) return;
  for (const taxId of existingVatIds) await stripe.customers.deleteTaxId(input.customerId, taxId.id);
  await stripe.customers.createTaxId(input.customerId, { type: "eu_vat", value: input.vatId });
}

export async function createAndSendPrepaidInvoice(input: {
  amountMinor: number;
  customerId: string;
  legalName: string;
  topupId: string;
  workspaceId: string;
}) {
  assertPrepaidTopupConfiguration();
  const stripe = getStripe();
  const invoice = await stripe.invoices.create(
    {
      auto_advance: false,
      automatic_tax: { enabled: true },
      collection_method: "send_invoice",
      currency: "usd",
      customer: input.customerId,
      days_until_due: 30,
      description: `RateLoop prepaid review funding for ${input.legalName}`,
      metadata: {
        rateloop_purpose: "prepaid_topup",
        rateloop_topup_id: input.topupId,
        rateloop_workspace_id: input.workspaceId,
      },
      payment_settings: {
        payment_method_options: {
          customer_balance: {
            bank_transfer: { type: getPrepaidTopupBankTransferType() },
            funding_type: "bank_transfer",
          },
        },
        payment_method_types: ["customer_balance"],
      },
    },
    { idempotencyKey: `rateloop:prepaid-invoice:${input.topupId}` },
  );
  await stripe.invoiceItems.create(
    {
      amount: input.amountMinor,
      currency: "usd",
      customer: input.customerId,
      description: "Prepaid human-assurance balance",
      discountable: false,
      invoice: invoice.id,
      metadata: { rateloop_topup_id: input.topupId, rateloop_workspace_id: input.workspaceId },
      tax_behavior: "exclusive",
      tax_code: getPrepaidTopupTaxCode(),
    },
    { idempotencyKey: `rateloop:prepaid-line:${input.topupId}` },
  );
  const finalized = await stripe.invoices.finalizeInvoice(invoice.id, undefined, {
    idempotencyKey: `rateloop:prepaid-finalize:${input.topupId}`,
  });
  if (finalized.status !== "open") {
    throw new TokenlessServiceError(
      "Stripe did not finalize the funding invoice.",
      502,
      "billing_provider_error",
      true,
    );
  }
  const sent = await stripe.invoices.sendInvoice(finalized.id, undefined, {
    idempotencyKey: `rateloop:prepaid-send:${input.topupId}`,
  });
  if (
    sent.currency !== "usd" ||
    sent.collection_method !== "send_invoice" ||
    sent.total_excluding_tax !== input.amountMinor ||
    sent.amount_due < input.amountMinor ||
    sent.amount_due <= 0 ||
    sent.starting_balance !== 0 ||
    sent.livemode !== stripeLivemode()
  ) {
    throw new TokenlessServiceError(
      "Stripe returned an inconsistent finalized funding invoice.",
      502,
      "billing_provider_error",
      true,
    );
  }
  if (!sent.hosted_invoice_url) {
    throw new TokenlessServiceError(
      "Stripe did not return a hosted funding invoice URL.",
      502,
      "billing_provider_error",
      true,
    );
  }
  return sent;
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

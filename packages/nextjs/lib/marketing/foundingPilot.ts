/**
 * The Founding Pilot is a hand-invoiced engagement, not a billing plan. It has no
 * Stripe price object, no `price_version`, and no entitlement row, so it is kept
 * out of TOKENLESS_BILLING_PLANS where every entry is validated against a live
 * Stripe price before checkout. Nothing here may be used to grant entitlements.
 */
export const FOUNDING_PILOT = {
  priceCents: 250_000,
  weeks: 6,
  creditablePercent: 50,
} as const;

export const SANDBOX_PRICE_CENTS = 0;

export function formatEurPrice(cents: number, locale: string = "en") {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error("EUR price must be a non-negative integer.");
  return new Intl.NumberFormat(locale === "de" ? "de-DE" : "en-US", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

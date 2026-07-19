export const DEFAULT_FREE_PRICE_VERSION = "free_2026_07" as const;
export const EARLY_ACCESS_PRICE_VERSION = "early_access_usd_29_2026_07" as const;
export const LEGACY_EARLY_ACCESS_PRICE_VERSION = "early_access_usd_99_2026_07" as const;

export type TokenlessBillingPlanKey = "free" | "early_access";
export type TokenlessBillingPriceVersion =
  | typeof DEFAULT_FREE_PRICE_VERSION
  | typeof EARLY_ACCESS_PRICE_VERSION
  | typeof LEGACY_EARLY_ACCESS_PRICE_VERSION;

export type TokenlessBillingPlan = {
  key: TokenlessBillingPlanKey;
  priceVersion: TokenlessBillingPriceVersion;
  displayName: string;
  monthlyPriceCents: number;
  /** Displayed list price this plan's promotional monthly price is anchored against. */
  listPriceCents?: number;
  decisionsPerPeriod: number;
  activeAgents: number;
  activePrivateGroups: number;
  paidPanels: boolean;
};

export const TOKENLESS_BILLING_PLANS = {
  free: {
    key: "free",
    priceVersion: DEFAULT_FREE_PRICE_VERSION,
    displayName: "Free",
    monthlyPriceCents: 0,
    decisionsPerPeriod: 25,
    activeAgents: 1,
    activePrivateGroups: 1,
    paidPanels: false,
  },
  early_access: {
    key: "early_access",
    priceVersion: EARLY_ACCESS_PRICE_VERSION,
    displayName: "Early Access",
    monthlyPriceCents: 2_900,
    listPriceCents: 9_900,
    decisionsPerPeriod: 250,
    activeAgents: 3,
    activePrivateGroups: 5,
    paidPanels: true,
  },
} as const satisfies Record<TokenlessBillingPlanKey, TokenlessBillingPlan>;

export const TOKENLESS_PRICE_VERSIONS = {
  [DEFAULT_FREE_PRICE_VERSION]: TOKENLESS_BILLING_PLANS.free,
  [EARLY_ACCESS_PRICE_VERSION]: TOKENLESS_BILLING_PLANS.early_access,
  [LEGACY_EARLY_ACCESS_PRICE_VERSION]: TOKENLESS_BILLING_PLANS.early_access,
} as const satisfies Record<TokenlessBillingPriceVersion, TokenlessBillingPlan>;

export function formatUsdPrice(cents: number) {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error("USD price must be a non-negative integer.");
  const fractionDigits = cents % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(cents / 100);
}

export function getBillingPlan(planKey: string): TokenlessBillingPlan | null {
  return planKey === "free" || planKey === "early_access" ? TOKENLESS_BILLING_PLANS[planKey] : null;
}

export function getPlanByPriceVersion(priceVersion: string): TokenlessBillingPlan | null {
  return Object.prototype.hasOwnProperty.call(TOKENLESS_PRICE_VERSIONS, priceVersion)
    ? TOKENLESS_PRICE_VERSIONS[priceVersion as TokenlessBillingPriceVersion]
    : null;
}

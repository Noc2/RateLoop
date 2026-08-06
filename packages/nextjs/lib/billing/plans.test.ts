import {
  DEFAULT_FREE_PRICE_VERSION,
  EARLY_ACCESS_PRICE_VERSION,
  LEGACY_EARLY_ACCESS_PRICE_VERSION,
  TOKENLESS_BILLING_PLANS,
  TOKENLESS_HOSTED_REVIEW_COPY,
  activeAgentLimitLabel,
  formatUsdPrice,
  getBillingPlan,
  getPlanByPriceVersion,
  privateGroupLimitLabel,
} from "./plans";
import assert from "node:assert/strict";
import { test } from "node:test";

test("billing plan definitions freeze the launch limits and price versions", () => {
  assert.deepEqual(TOKENLESS_HOSTED_REVIEW_COPY, {
    planBenefit: "Invited unpaid reviews",
    planSummary: "Workspace plans support invited, unpaid review workflows.",
  });
  assert.deepEqual(TOKENLESS_BILLING_PLANS.free, {
    key: "free",
    priceVersion: DEFAULT_FREE_PRICE_VERSION,
    displayName: "Free",
    monthlyPriceCents: 0,
    decisionsPerPeriod: 25,
    activeAgents: 1,
    activePrivateGroups: 1,
    paidPanels: false,
  });
  assert.deepEqual(TOKENLESS_BILLING_PLANS.early_access, {
    key: "early_access",
    priceVersion: EARLY_ACCESS_PRICE_VERSION,
    displayName: "Early Access",
    monthlyPriceCents: 2_900,
    decisionsPerPeriod: 250,
    activeAgents: 3,
    activePrivateGroups: 5,
    paidPanels: true,
  });
});

test("unknown plan and price-version values fail closed", () => {
  assert.equal(getBillingPlan("early_access"), TOKENLESS_BILLING_PLANS.early_access);
  assert.equal(getPlanByPriceVersion(EARLY_ACCESS_PRICE_VERSION), TOKENLESS_BILLING_PLANS.early_access);
  assert.equal(getPlanByPriceVersion(LEGACY_EARLY_ACCESS_PRICE_VERSION), TOKENLESS_BILLING_PLANS.early_access);
  assert.equal(getBillingPlan("enterprise"), null);
  assert.equal(getPlanByPriceVersion("early_access_future_price"), null);
});

test("workspace prices format from their canonical cent amounts", () => {
  assert.equal(formatUsdPrice(TOKENLESS_BILLING_PLANS.free.monthlyPriceCents), "$0");
  assert.equal(formatUsdPrice(TOKENLESS_BILLING_PLANS.early_access.monthlyPriceCents), "$29");
  assert.throws(() => formatUsdPrice(29.5), /non-negative integer/);
});

test("customer-facing resource labels come from the enforced plan limits", () => {
  assert.equal(activeAgentLimitLabel(TOKENLESS_BILLING_PLANS.free.activeAgents), "1 active agent");
  assert.equal(activeAgentLimitLabel(TOKENLESS_BILLING_PLANS.early_access.activeAgents), "3 active agents");
  assert.equal(privateGroupLimitLabel(TOKENLESS_BILLING_PLANS.free.activePrivateGroups), "1 invited reviewer group");
  assert.equal(
    privateGroupLimitLabel(TOKENLESS_BILLING_PLANS.early_access.activePrivateGroups),
    "5 invited reviewer groups",
  );
  assert.equal(activeAgentLimitLabel(TOKENLESS_BILLING_PLANS.free.activeAgents, "de"), "1 aktiver Agent");
  assert.equal(activeAgentLimitLabel(TOKENLESS_BILLING_PLANS.early_access.activeAgents, "de"), "3 aktive Agenten");
  assert.equal(
    privateGroupLimitLabel(TOKENLESS_BILLING_PLANS.free.activePrivateGroups, "de"),
    "1 eingeladene Prüfgruppe",
  );
  assert.equal(
    privateGroupLimitLabel(TOKENLESS_BILLING_PLANS.early_access.activePrivateGroups, "de"),
    "5 eingeladene Prüfgruppen",
  );
});

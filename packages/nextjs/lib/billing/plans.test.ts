import {
  DEFAULT_FREE_PRICE_VERSION,
  EARLY_ACCESS_PRICE_VERSION,
  TOKENLESS_BILLING_PLANS,
  getBillingPlan,
  getPlanByPriceVersion,
} from "./plans";
import assert from "node:assert/strict";
import { test } from "node:test";

test("billing plan definitions freeze the launch limits and price versions", () => {
  assert.deepEqual(TOKENLESS_BILLING_PLANS.free, {
    key: "free",
    priceVersion: DEFAULT_FREE_PRICE_VERSION,
    displayName: "Free",
    decisionsPerPeriod: 25,
    activeAgents: 1,
    activePrivateGroups: 1,
    paidPanels: false,
  });
  assert.deepEqual(TOKENLESS_BILLING_PLANS.early_access, {
    key: "early_access",
    priceVersion: EARLY_ACCESS_PRICE_VERSION,
    displayName: "Early Access",
    decisionsPerPeriod: 250,
    activeAgents: 3,
    activePrivateGroups: 5,
    paidPanels: true,
  });
});

test("unknown plan and price-version values fail closed", () => {
  assert.equal(getBillingPlan("early_access"), TOKENLESS_BILLING_PLANS.early_access);
  assert.equal(getPlanByPriceVersion(EARLY_ACCESS_PRICE_VERSION), TOKENLESS_BILLING_PLANS.early_access);
  assert.equal(getBillingPlan("enterprise"), null);
  assert.equal(getPlanByPriceVersion("early_access_future_price"), null);
});

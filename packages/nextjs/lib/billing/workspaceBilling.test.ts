import {
  getWorkspaceBillingProfile,
  getWorkspaceBillingSummary,
  startWorkspaceCheckout,
  updateWorkspaceBillingProfile,
} from "./workspaceBilling";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const OWNER = "0x1111111111111111111111111111111111111111";
const BILLING = "0x2222222222222222222222222222222222222222";
const OUTSIDER = "0x3333333333333333333333333333333333333333";
const originalEnabled = process.env.TOKENLESS_SUBSCRIPTIONS_ENABLED;

beforeEach(async () => {
  process.env.TOKENLESS_SUBSCRIPTIONS_ENABLED = "false";
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  const now = new Date("2026-07-14T12:00:00.000Z");
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspaces (workspace_id, name, status, created_at, updated_at)
          VALUES (?, 'Acme', 'active', ?, ?)`,
    args: ["ws_acme", now, now],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_members (workspace_id, account_address, role, created_at)
          VALUES ('ws_acme', ?, 'owner', ?), ('ws_acme', ?, 'billing', ?)`,
    args: [OWNER, now, BILLING, now],
  });
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
  if (originalEnabled === undefined) delete process.env.TOKENLESS_SUBSCRIPTIONS_ENABLED;
  else process.env.TOKENLESS_SUBSCRIPTIONS_ENABLED = originalEnabled;
});

test("billing summary defaults safely to Free without exposing provider identifiers", async () => {
  const summary = await getWorkspaceBillingSummary({ accountAddress: OWNER, workspaceId: "ws_acme" });
  assert.equal(summary.plan, "free");
  assert.equal(summary.status, "free");
  assert.equal(summary.usage.limit, 25);
  assert.equal(summary.limits.activeAgents, 1);
  assert.equal(summary.canManageBilling, true);
  assert.equal(summary.checkoutAvailable, false);
  assert.equal(summary.checkoutBlockedReason, "billing_unavailable");
  assert.equal(summary.portalAvailable, false);
  assert.equal("providerCustomerId" in summary, false);
  assert.equal("providerSubscriptionId" in summary, false);
});

test("billing access role can manage while outsiders receive a not-found response", async () => {
  const summary = await getWorkspaceBillingSummary({ accountAddress: BILLING, workspaceId: "ws_acme" });
  assert.equal(summary.canManageBilling, true);
  await assert.rejects(
    () => getWorkspaceBillingSummary({ accountAddress: OUTSIDER, workspaceId: "ws_acme" }),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.status === 404 && error.code === "workspace_not_found",
  );
});

test("billing summary distinguishes payment attention, subscription management, and open checkout", async () => {
  process.env.TOKENLESS_SUBSCRIPTIONS_ENABLED = "true";
  const now = new Date("2026-07-14T12:00:00.000Z");
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_billing_customers
            (workspace_id, provider, provider_customer_id, created_at, updated_at)
          VALUES ('ws_acme', 'stripe', 'cus_acme', ?, ?)`,
    args: [now, now],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_subscriptions
            (workspace_id, plan_key, price_version, provider_subscription_id, provider_status,
             cancel_at_period_end, created_at, updated_at)
          VALUES ('ws_acme', 'free', 'free_2026_07', 'sub_acme', 'incomplete', false, ?, ?)`,
    args: [now, now],
  });

  const attention = await getWorkspaceBillingSummary({ accountAddress: OWNER, workspaceId: "ws_acme" });
  assert.equal(attention.plan, "free");
  assert.equal(attention.checkoutAvailable, false);
  assert.equal(attention.checkoutBlockedReason, "subscription_requires_attention");
  assert.equal(attention.portalAvailable, true);

  await dbClient.execute({
    sql: "UPDATE tokenless_workspace_subscriptions SET provider_status = 'paused' WHERE workspace_id = 'ws_acme'",
    args: [],
  });
  const manageable = await getWorkspaceBillingSummary({ accountAddress: OWNER, workspaceId: "ws_acme" });
  assert.equal(manageable.plan, "free");
  assert.equal(manageable.checkoutAvailable, false);
  assert.equal(manageable.checkoutBlockedReason, "manage_existing_subscription");

  await dbClient.execute({
    sql: "UPDATE tokenless_workspace_subscriptions SET provider_status = 'canceled' WHERE workspace_id = 'ws_acme'",
    args: [],
  });
  const open = await getWorkspaceBillingSummary({ accountAddress: OWNER, workspaceId: "ws_acme" });
  assert.equal(open.checkoutAvailable, true);
  assert.equal(open.checkoutBlockedReason, null);
});

test("billing members can self-declare a business profile without changing retention", async () => {
  const now = new Date("2026-07-14T12:00:00.000Z");
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_governance
            (workspace_id, default_retention_days, trader_status, updated_by, created_at, updated_at)
          VALUES ('ws_acme', 90, 'unverified', ?, ?, ?)`,
    args: [OWNER, now, now],
  });
  const profile = await updateWorkspaceBillingProfile({
    accountAddress: BILLING,
    legalName: " Acme GmbH ",
    registeredAddress: "Example Street 1, Berlin",
    registrationNumber: "HRB 123",
    vatCountryCode: "de",
    vatId: "DE123456789",
    workspaceId: "ws_acme",
  });
  assert.deepEqual(profile, {
    billingAddress: {
      city: null,
      country: null,
      line1: null,
      line2: null,
      postalCode: null,
      state: null,
    },
    complete: true,
    verificationStatus: "self_declared",
    legalName: "Acme GmbH",
    registeredAddress: "Example Street 1, Berlin",
    registrationNumber: "HRB 123",
    vatCountryCode: "DE",
    vatId: "DE123456789",
  });
  assert.deepEqual(await getWorkspaceBillingProfile({ accountAddress: BILLING, workspaceId: "ws_acme" }), profile);
  const stored = await dbClient.execute(
    "SELECT default_retention_days, trader_status FROM tokenless_workspace_governance WHERE workspace_id = 'ws_acme'",
  );
  assert.equal(Number(stored.rows[0]?.default_retention_days), 90);
  assert.equal(stored.rows[0]?.trader_status, "self_declared");
  process.env.TOKENLESS_SUBSCRIPTIONS_ENABLED = "true";
  await assert.rejects(
    () => startWorkspaceCheckout({ accountAddress: OWNER, plan: "early_access", workspaceId: "ws_acme" }),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.status === 403 && error.code === "business_verification_required",
  );
});

test("billing profile requires legal identity and paired VAT fields", async () => {
  await assert.rejects(
    () =>
      updateWorkspaceBillingProfile({
        accountAddress: OWNER,
        legalName: "Acme",
        registeredAddress: "Berlin",
        vatCountryCode: "DE",
        workspaceId: "ws_acme",
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_billing_profile",
  );
});

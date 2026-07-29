import {
  assertVerifiedBusinessCustomerRecord,
  recordOperatorBusinessVerification,
  requireVerifiedBusinessCustomer,
} from "./businessCustomerEligibility";
import { assertPaidPanelsAllowed, requireWorkspacePaidPanels, reserveWorkspaceUsageAllocations } from "./entitlements";
import { createPrepaidTopup } from "./prepaidTopups";
import { startWorkspaceCheckout, updateWorkspaceBillingProfile } from "./workspaceBilling";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { afterEach, beforeEach } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { prepareProductAsk } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const OWNER = "0x1111111111111111111111111111111111111111";
const NOW = new Date("2026-07-29T12:00:00.000Z");
const EXPIRES = new Date("2027-07-29T12:00:00.000Z");
const EVIDENCE_HASH = "a".repeat(64);

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
});

test("verified-business records fail closed across status, evidence, and time boundaries", () => {
  const record = {
    trader_status: "verified",
    trader_legal_name: "Acme GmbH",
    trader_registered_address: "Example Street 1, Berlin",
    trader_verification_method: "commercial_register",
    trader_verification_reference_hash: EVIDENCE_HASH,
    trader_verified_at: NOW,
    trader_verification_expires_at: EXPIRES,
    trader_verified_by: "operator:legal-ops",
  };
  assert.equal(
    assertVerifiedBusinessCustomerRecord(record, { workspaceId: "ws_acme", now: NOW }).verificationMethod,
    "commercial_register",
  );
  for (const invalid of [
    { ...record, trader_status: "self_declared" },
    { ...record, trader_verification_reference_hash: "not-a-digest" },
    { ...record, trader_verification_expires_at: NOW },
    { ...record, trader_verified_at: new Date(NOW.getTime() + 1) },
  ]) {
    assert.throws(
      () => assertVerifiedBusinessCustomerRecord(invalid, { workspaceId: "ws_acme", now: NOW }),
      (error: unknown) => error instanceof TokenlessServiceError && error.code === "business_verification_required",
    );
  }
});

test("customer profile edits never self-verify and invalidate an operator verification with an audit event", async () => {
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspaces (workspace_id,name,status,created_at,updated_at)
          VALUES ('ws_acme','Acme','active',?,?)`,
    args: [NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_members (workspace_id,account_address,role,created_at)
          VALUES ('ws_acme',?,'owner',?)`,
    args: [OWNER, NOW],
  });
  const selfDeclared = await updateWorkspaceBillingProfile({
    accountAddress: OWNER,
    workspaceId: "ws_acme",
    legalName: "Acme GmbH",
    registeredAddress: "Example Street 1, Berlin",
  });
  assert.equal(selfDeclared.verificationStatus, "self_declared");
  await assert.rejects(
    () => requireVerifiedBusinessCustomer({ workspaceId: "ws_acme", now: NOW }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "business_verification_required",
  );

  const verified = await recordOperatorBusinessVerification({
    workspaceId: "ws_acme",
    operatorReference: "operator:legal-ops",
    verificationMethod: "commercial_register",
    verificationReferenceHash: EVIDENCE_HASH,
    verifiedAt: NOW,
    verificationExpiresAt: EXPIRES,
    reason: "Matched the submitted legal identity to retained register evidence.",
  });
  assert.equal(verified.legalName, "Acme GmbH");
  assert.equal(
    (await requireVerifiedBusinessCustomer({ workspaceId: "ws_acme", now: NOW })).verifiedBy,
    "operator:legal-ops",
  );
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_subscriptions
            (workspace_id,plan_key,price_version,provider_status,current_period_start,current_period_end,
             cancel_at_period_end,created_at,updated_at)
          VALUES ('ws_acme','early_access','early_access_usd_99_2026_07','active',?,?,false,?,?)`,
    args: [NOW, new Date("2028-01-01T00:00:00.000Z"), NOW, NOW],
  });
  assert.equal((await requireWorkspacePaidPanels("ws_acme", NOW)).plan.key, "early_access");
  await assert.rejects(
    () => requireWorkspacePaidPanels("ws_acme", EXPIRES),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "business_verification_required",
  );

  const edited = await updateWorkspaceBillingProfile({
    accountAddress: OWNER,
    workspaceId: "ws_acme",
    legalName: "Acme GmbH",
    registeredAddress: "Changed Street 2, Berlin",
  });
  assert.equal(edited.verificationStatus, "self_declared");
  await assert.rejects(
    () => requireVerifiedBusinessCustomer({ workspaceId: "ws_acme", now: NOW }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "business_verification_required",
  );
  const events = await dbClient.execute({
    sql: `SELECT action,prior_status,next_status FROM tokenless_business_verification_events
          WHERE workspace_id='ws_acme' ORDER BY created_at,event_id`,
    args: [],
  });
  assert.deepEqual(
    events.rows.map(row => [row.action, row.prior_status, row.next_status]),
    [
      ["operator_verified", "self_declared", "verified"],
      ["profile_changed", "verified", "self_declared"],
    ],
  );
});

test("checkout, top-up, and every canonical paid-panel mode bind to the same verified-business gate", () => {
  const consumers = [
    startWorkspaceCheckout,
    createPrepaidTopup,
    requireWorkspacePaidPanels,
    assertPaidPanelsAllowed,
    reserveWorkspaceUsageAllocations,
    prepareProductAsk,
  ];
  assert.ok(consumers.every(consumer => typeof consumer === "function"));

  const workspaceBillingSource = readFileSync(new URL("./workspaceBilling.ts", import.meta.url), "utf8");
  const prepaidTopupSource = readFileSync(new URL("./prepaidTopups.ts", import.meta.url), "utf8");
  const entitlementSource = readFileSync(new URL("./entitlements.ts", import.meta.url), "utf8");
  const productCoreSource = readFileSync(new URL("../tokenless/productCore.ts", import.meta.url), "utf8");

  assert.match(workspaceBillingSource, /requireVerifiedBusinessCustomer\(\{ workspaceId: input\.workspaceId \}\)/u);
  assert.match(prepaidTopupSource, /requireVerifiedBusinessCustomer\(\{ workspaceId: input\.workspaceId, now \}\)/u);
  assert.match(entitlementSource, /requireVerifiedBusinessCustomer\(\{ workspaceId, now, client \}\)/u);
  assert.match(
    entitlementSource,
    /input\.requiresPaidPanels[\s\S]{0,120}assertPaidPanelsAllowed\(client, input\.workspaceId, now\)/u,
  );
  const gateOffset = productCoreSource.indexOf("await requireWorkspacePaidPanels(workspaceId)");
  const paymentBranchOffset = productCoreSource.indexOf("const paymentMode = input.request.payment.mode", gateOffset);
  assert.ok(
    gateOffset >= 0 && paymentBranchOffset > gateOffset,
    "wallet, x402, and prepaid branch only after one gate",
  );
});

test("the migration demotes evidence-free legacy verification and requires complete independent evidence", () => {
  const migration = readFileSync(
    new URL("../../drizzle/0163_verified_business_customers.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /WHERE "trader_status" = 'verified'/u);
  assert.match(migration, /"trader_status" = 'self_declared'/u);
  assert.match(migration, /legacy_verification_demoted/u);
  for (const field of [
    "trader_verification_method",
    "trader_verification_reference_hash",
    "trader_verified_at",
    "trader_verification_expires_at",
    "trader_verified_by",
  ]) {
    assert.match(migration, new RegExp(`"${field}"`, "u"));
  }
  assert.match(migration, /"trader_status" = 'verified'[\s\S]+AND "trader_verification_method" IS NOT NULL/u);
});

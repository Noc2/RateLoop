import { freeCalendarPeriod, loadWorkspaceEntitlement } from "./entitlements";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { createWorkspace } from "~~/lib/tokenless/productCore";

const OWNER = "0x1111111111111111111111111111111111111111";

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

test("Free periods use exact UTC calendar-month boundaries", () => {
  assert.deepEqual(freeCalendarPeriod(new Date("2026-12-31T23:59:59.999Z")), {
    start: new Date("2026-12-01T00:00:00.000Z"),
    end: new Date("2027-01-01T00:00:00.000Z"),
  });
});

test("verified active and paid-through past-due snapshots grant Early Access only through period end", async () => {
  const { workspaceId } = await createWorkspace({ name: "Entitlement states", ownerAddress: OWNER });
  const now = new Date("2026-07-14T12:00:00.000Z");
  const periodStart = new Date("2026-07-01T00:00:00.000Z");
  const periodEnd = new Date("2026-08-01T00:00:00.000Z");
  for (const status of ["active", "past_due"] as const) {
    await dbClient.execute({
      sql: `UPDATE tokenless_workspace_subscriptions
            SET plan_key = 'early_access', price_version = 'early_access_usd_99_2026_07',
                provider_status = ?, current_period_start = ?, current_period_end = ?, updated_at = ?
            WHERE workspace_id = ?`,
      args: [status, periodStart, periodEnd, now, workspaceId],
    });
    const entitlement = await loadWorkspaceEntitlement(workspaceId, now);
    assert.equal(entitlement.plan.key, "early_access");
    assert.equal(entitlement.providerStatus, status);
    assert.equal(entitlement.currentPeriodStart.toISOString(), periodStart.toISOString());
    assert.equal(entitlement.currentPeriodEnd.toISOString(), periodEnd.toISOString());
  }
  const expired = await loadWorkspaceEntitlement(workspaceId, new Date("2026-08-01T00:00:00.000Z"));
  assert.equal(expired.plan.key, "free");
});

test("unsupported prices and non-entitled provider states fail safely to Free", async () => {
  const { workspaceId } = await createWorkspace({ name: "Fail closed", ownerAddress: OWNER });
  const now = new Date("2026-07-14T12:00:00.000Z");
  await dbClient.execute({
    sql: `UPDATE tokenless_workspace_subscriptions
          SET plan_key = 'early_access', price_version = 'unknown_price', provider_status = 'active',
              current_period_start = ?, current_period_end = ?, updated_at = ?
          WHERE workspace_id = ?`,
    args: [new Date("2026-07-01T00:00:00.000Z"), new Date("2026-08-01T00:00:00.000Z"), now, workspaceId],
  });
  assert.equal((await loadWorkspaceEntitlement(workspaceId, now)).plan.key, "free");
  await dbClient.execute({
    sql: `UPDATE tokenless_workspace_subscriptions
          SET price_version = 'early_access_usd_99_2026_07', provider_status = 'canceled', updated_at = ?
          WHERE workspace_id = ?`,
    args: [now, workspaceId],
  });
  assert.equal((await loadWorkspaceEntitlement(workspaceId, now)).plan.key, "free");
});

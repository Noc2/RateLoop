import {
  DEFAULT_FREE_PRICE_VERSION,
  TOKENLESS_BILLING_PLANS,
  type TokenlessBillingPlan,
  type TokenlessBillingPlanKey,
  getPlanByPriceVersion,
} from "./plans";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { dbPool } from "~~/lib/db";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;

export type WorkspaceEntitlement = {
  workspaceId: string;
  plan: TokenlessBillingPlan;
  providerStatus: string;
  priceVersion: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
};

export type PlanLimitType = "active_agents" | "active_private_groups" | "review_decisions" | "paid_panels";

export class PlanLimitReachedError extends TokenlessServiceError {
  readonly limitType: PlanLimitType;
  readonly limit: number;
  readonly current: number;
  readonly planKey: TokenlessBillingPlanKey;

  constructor(input: { limitType: PlanLimitType; limit: number; current: number; planKey: TokenlessBillingPlanKey }) {
    const labels: Record<PlanLimitType, string> = {
      active_agents: "active agents",
      active_private_groups: "active private groups",
      review_decisions: "review decisions in this billing period",
      paid_panels: "paid panels",
    };
    super(
      `The ${input.planKey === "free" ? "Free" : "Early Access"} plan allows ${input.limit} ${labels[input.limitType]}.`,
      409,
      "plan_limit_reached",
    );
    this.name = "PlanLimitReachedError";
    this.limitType = input.limitType;
    this.limit = input.limit;
    this.current = input.current;
    this.planKey = input.planKey;
  }
}

function rowString(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function rowBoolean(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === true || value === "t" || value === 1;
}

function rowInteger(row: Row | undefined, key: string) {
  const value = Number(row?.[key]);
  return Number.isSafeInteger(value) ? value : null;
}

function rowDate(row: Row | undefined, key: string) {
  const value = row?.[key];
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date : null;
}

export function freeCalendarPeriod(now: Date) {
  if (!Number.isFinite(now.getTime())) throw new Error("Billing period time is invalid.");
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

function isPaidEntitlementActive(row: Row, now: Date) {
  const status = rowString(row, "provider_status");
  const periodEnd = rowDate(row, "current_period_end");
  return (
    rowString(row, "plan_key") === "early_access" &&
    Boolean(periodEnd && periodEnd.getTime() > now.getTime()) &&
    (status === "active" || status === "trialing" || status === "past_due")
  );
}

async function ensureAndLockSubscription(client: PoolClient, workspaceId: string, now: Date) {
  const workspace = await client.query(
    "SELECT workspace_id FROM tokenless_workspaces WHERE workspace_id = $1 AND status = 'active' FOR UPDATE",
    [workspaceId],
  );
  if (!workspace.rowCount) {
    throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  }
  await client.query(
    `INSERT INTO tokenless_workspace_subscriptions
     (workspace_id, plan_key, price_version, provider_status, cancel_at_period_end, created_at, updated_at)
     VALUES ($1, 'free', $2, 'free', false, $3, $3)
     ON CONFLICT (workspace_id) DO NOTHING`,
    [workspaceId, DEFAULT_FREE_PRICE_VERSION, now],
  );
  const result = await client.query(
    "SELECT * FROM tokenless_workspace_subscriptions WHERE workspace_id = $1 FOR UPDATE",
    [workspaceId],
  );
  const row = result.rows[0] as Row | undefined;
  if (!row) throw new Error("Workspace subscription could not be loaded.");
  return row;
}

export async function resolveWorkspaceEntitlement(
  client: PoolClient,
  workspaceId: string,
  now = new Date(),
): Promise<WorkspaceEntitlement> {
  const row = await ensureAndLockSubscription(client, workspaceId, now);
  if (isPaidEntitlementActive(row, now)) {
    const priceVersion = rowString(row, "price_version")!;
    const plan = getPlanByPriceVersion(priceVersion);
    const periodStart = rowDate(row, "current_period_start");
    const periodEnd = rowDate(row, "current_period_end");
    if (plan?.key === "early_access" && periodStart && periodEnd && periodEnd > periodStart) {
      return {
        workspaceId,
        plan,
        providerStatus: rowString(row, "provider_status")!,
        priceVersion,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: rowBoolean(row, "cancel_at_period_end"),
      };
    }
  }
  const period = freeCalendarPeriod(now);
  return {
    workspaceId,
    plan: TOKENLESS_BILLING_PLANS.free,
    providerStatus: rowString(row, "provider_status") ?? "free",
    priceVersion: DEFAULT_FREE_PRICE_VERSION,
    currentPeriodStart: period.start,
    currentPeriodEnd: period.end,
    cancelAtPeriodEnd: false,
  };
}

export async function loadWorkspaceEntitlement(workspaceId: string, now = new Date()) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const entitlement = await resolveWorkspaceEntitlement(client, workspaceId, now);
    await client.query("COMMIT");
    return entitlement;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function countActive(
  client: PoolClient,
  table: "tokenless_agents" | "tokenless_private_groups",
  workspaceId: string,
) {
  const result = await client.query(
    `SELECT COUNT(*) AS count FROM ${table} WHERE workspace_id = $1 AND status = 'active'`,
    [workspaceId],
  );
  return rowInteger(result.rows[0] as Row | undefined, "count") ?? 0;
}

export async function assertCanCreateWorkspaceAgent(client: PoolClient, workspaceId: string, now = new Date()) {
  const entitlement = await resolveWorkspaceEntitlement(client, workspaceId, now);
  const current = await countActive(client, "tokenless_agents", workspaceId);
  if (current >= entitlement.plan.activeAgents) {
    throw new PlanLimitReachedError({
      limitType: "active_agents",
      limit: entitlement.plan.activeAgents,
      current,
      planKey: entitlement.plan.key,
    });
  }
  return entitlement;
}

export async function assertCanCreatePrivateGroup(client: PoolClient, workspaceId: string, now = new Date()) {
  const entitlement = await resolveWorkspaceEntitlement(client, workspaceId, now);
  const current = await countActive(client, "tokenless_private_groups", workspaceId);
  if (current >= entitlement.plan.activePrivateGroups) {
    throw new PlanLimitReachedError({
      limitType: "active_private_groups",
      limit: entitlement.plan.activePrivateGroups,
      current,
      planKey: entitlement.plan.key,
    });
  }
  return entitlement;
}

export async function assertPaidPanelsAllowed(client: PoolClient, workspaceId: string, now = new Date()) {
  const entitlement = await resolveWorkspaceEntitlement(client, workspaceId, now);
  if (!entitlement.plan.paidPanels) {
    throw new PlanLimitReachedError({
      limitType: "paid_panels",
      limit: 0,
      current: 0,
      planKey: entitlement.plan.key,
    });
  }
  return entitlement;
}

export async function requireWorkspacePaidPanels(workspaceId: string, now = new Date()) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const entitlement = await assertPaidPanelsAllowed(client, workspaceId, now);
    await client.query("COMMIT");
    return entitlement;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function reserveWorkspaceUsageAllocations(
  client: PoolClient,
  input: { workspaceId: string; runId: string; caseIds: string[]; requiresPaidPanels?: boolean; now?: Date },
) {
  const now = input.now ?? new Date();
  const entitlement = await resolveWorkspaceEntitlement(client, input.workspaceId, now);
  if (input.requiresPaidPanels && !entitlement.plan.paidPanels)
    throw new PlanLimitReachedError({ limitType: "paid_panels", limit: 0, current: 0, planKey: entitlement.plan.key });
  const uniqueCaseIds = [...new Set(input.caseIds)];
  if (uniqueCaseIds.length !== input.caseIds.length || uniqueCaseIds.length === 0) {
    throw new Error("Usage allocations require a non-empty unique case set.");
  }
  const existing = await client.query(
    `SELECT case_id, state FROM tokenless_workspace_usage_allocations
     WHERE workspace_id = $1 AND run_id = $2`,
    [input.workspaceId, input.runId],
  );
  if (existing.rowCount) {
    const existingCases = new Set(existing.rows.map(row => rowString(row as Row, "case_id")));
    if (existingCases.size === uniqueCaseIds.length && uniqueCaseIds.every(caseId => existingCases.has(caseId))) {
      return entitlement;
    }
    throw new Error("The run has a partial or mismatched usage allocation set.");
  }
  const usedResult = await client.query(
    `SELECT COUNT(*) AS count FROM tokenless_workspace_usage_allocations
     WHERE workspace_id = $1 AND period_start = $2 AND period_end = $3
       AND state IN ('reserved', 'consumed')`,
    [input.workspaceId, entitlement.currentPeriodStart, entitlement.currentPeriodEnd],
  );
  const current = rowInteger(usedResult.rows[0] as Row | undefined, "count") ?? 0;
  if (current + uniqueCaseIds.length > entitlement.plan.decisionsPerPeriod) {
    throw new PlanLimitReachedError({
      limitType: "review_decisions",
      limit: entitlement.plan.decisionsPerPeriod,
      current,
      planKey: entitlement.plan.key,
    });
  }
  for (const caseId of uniqueCaseIds) {
    await client.query(
      `INSERT INTO tokenless_workspace_usage_allocations
       (allocation_id, workspace_id, run_id, case_id, plan_key, price_version,
        period_start, period_end, state, reserved_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'reserved',$9)`,
      [
        `use_${randomUUID().replaceAll("-", "")}`,
        input.workspaceId,
        input.runId,
        caseId,
        entitlement.plan.key,
        entitlement.priceVersion,
        entitlement.currentPeriodStart,
        entitlement.currentPeriodEnd,
        now,
      ],
    );
  }
  return entitlement;
}

export async function consumeWorkspaceUsageAllocations(client: PoolClient, runId: string, now = new Date()) {
  const result = await client.query(
    `UPDATE tokenless_workspace_usage_allocations
     SET state = 'consumed', consumed_at = $1
     WHERE run_id = $2 AND state = 'reserved'`,
    [now, runId],
  );
  return result.rowCount ?? 0;
}

export async function releaseWorkspaceUsageAllocations(client: PoolClient, runId: string, now = new Date()) {
  const result = await client.query(
    `UPDATE tokenless_workspace_usage_allocations
     SET state = 'released', released_at = $1
     WHERE run_id = $2 AND state = 'reserved'`,
    [now, runId],
  );
  return result.rowCount ?? 0;
}

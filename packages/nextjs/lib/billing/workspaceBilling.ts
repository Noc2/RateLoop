import { TOKENLESS_BILLING_PLANS, getPlanByPriceVersion } from "./plans";
import {
  createEarlyAccessCheckout,
  createStripeCustomer,
  createStripePortal,
  findBlockingStripeSubscription,
  getEarlyAccessPriceId,
  isBlockingSubscriptionStatus,
  subscriptionsEnabled,
} from "./stripe";
import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbClient } from "~~/lib/db";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type QueryRow = Record<string, unknown> | undefined;
type WorkspaceBillingRole = "owner" | "admin" | "member" | "billing";

function rowString(row: QueryRow, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function rowBoolean(row: QueryRow, key: string) {
  const value = row?.[key];
  return value === true || value === "true" || value === 1 || value === "1";
}

async function requireWorkspaceAccess(accountAddress: string, workspaceId: string) {
  let address: string;
  try {
    address = normalizeAccountSubject(accountAddress);
  } catch {
    throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  }
  const result = await dbClient.execute({
    sql: `SELECT m.role, w.name, COALESCE(g.trader_status, 'unverified') AS trader_status,
                 g.trader_legal_name, g.trader_registered_address
          FROM tokenless_workspace_members m
          JOIN tokenless_workspaces w ON w.workspace_id = m.workspace_id
          LEFT JOIN tokenless_workspace_governance g ON g.workspace_id = w.workspace_id
          WHERE m.workspace_id = ? AND m.account_address = ? AND w.status = 'active' LIMIT 1`,
    args: [workspaceId, address],
  });
  const row = result.rows[0] as QueryRow;
  const role = rowString(row, "role") as WorkspaceBillingRole | null;
  const name = rowString(row, "name");
  if (!role || !name || !["owner", "admin", "member", "billing"].includes(role)) {
    throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  }
  return {
    canManageBilling: role === "owner" || role === "billing",
    legalName: rowString(row, "trader_legal_name"),
    registeredAddress: rowString(row, "trader_registered_address"),
    role,
    traderStatus: rowString(row, "trader_status"),
    workspaceName: name,
  };
}

function requireBillingManager(access: Awaited<ReturnType<typeof requireWorkspaceAccess>>) {
  if (!access.canManageBilling) {
    throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  }
}

function optionalProfileText(value: unknown, field: string, maxLength: number) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new TokenlessServiceError(`${field} must be text.`, 400, "invalid_billing_profile");
  }
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) {
    throw new TokenlessServiceError(
      `${field} must be at most ${maxLength} characters.`,
      400,
      "invalid_billing_profile",
    );
  }
  return normalized;
}

function billingProfileFromRow(row: QueryRow) {
  const legalName = rowString(row, "trader_legal_name");
  const registeredAddress = rowString(row, "trader_registered_address");
  return {
    complete: rowString(row, "trader_status") === "verified" && Boolean(legalName && registeredAddress),
    legalName,
    registeredAddress,
    registrationNumber: rowString(row, "trader_registration_number"),
    vatCountryCode: rowString(row, "vat_country_code"),
    vatId: rowString(row, "vat_id"),
  };
}

export async function getWorkspaceBillingProfile(input: { accountAddress: string; workspaceId: string }) {
  const access = await requireWorkspaceAccess(input.accountAddress, input.workspaceId);
  requireBillingManager(access);
  const result = await dbClient.execute({
    sql: `SELECT COALESCE(trader_status, 'unverified') AS trader_status,
                 trader_legal_name, trader_registration_number, trader_registered_address,
                 vat_country_code, vat_id
          FROM tokenless_workspace_governance WHERE workspace_id = ? LIMIT 1`,
    args: [input.workspaceId],
  });
  return billingProfileFromRow(result.rows[0] as QueryRow);
}

export async function updateWorkspaceBillingProfile(input: {
  accountAddress: string;
  workspaceId: string;
  legalName: unknown;
  registrationNumber?: unknown;
  registeredAddress: unknown;
  vatCountryCode?: unknown;
  vatId?: unknown;
}) {
  const access = await requireWorkspaceAccess(input.accountAddress, input.workspaceId);
  requireBillingManager(access);
  const legalName = optionalProfileText(input.legalName, "legalName", 200);
  const registrationNumber = optionalProfileText(input.registrationNumber, "registrationNumber", 120);
  const registeredAddress = optionalProfileText(input.registeredAddress, "registeredAddress", 500);
  const vatCountryCode = optionalProfileText(input.vatCountryCode, "vatCountryCode", 2)?.toUpperCase() ?? null;
  const vatId = optionalProfileText(input.vatId, "vatId", 64);
  if (!legalName || !registeredAddress) {
    throw new TokenlessServiceError(
      "A legal name and registered business address are required.",
      400,
      "invalid_billing_profile",
    );
  }
  if ((vatCountryCode === null) !== (vatId === null) || (vatCountryCode && !/^[A-Z]{2}$/.test(vatCountryCode))) {
    throw new TokenlessServiceError(
      "VAT country code and VAT ID must be supplied together.",
      400,
      "invalid_billing_profile",
    );
  }
  const now = new Date();
  const result = await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_governance
            (workspace_id, default_retention_days, trader_status, trader_legal_name,
             trader_registration_number, trader_registered_address, vat_country_code, vat_id,
             updated_by, created_at, updated_at)
          VALUES (?, 30, 'verified', ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (workspace_id) DO UPDATE SET
            trader_status = 'verified',
            trader_legal_name = EXCLUDED.trader_legal_name,
            trader_registration_number = EXCLUDED.trader_registration_number,
            trader_registered_address = EXCLUDED.trader_registered_address,
            vat_country_code = EXCLUDED.vat_country_code,
            vat_id = EXCLUDED.vat_id,
            updated_by = EXCLUDED.updated_by,
            updated_at = EXCLUDED.updated_at
          RETURNING trader_status, trader_legal_name, trader_registration_number,
                    trader_registered_address, vat_country_code, vat_id`,
    args: [
      input.workspaceId,
      legalName,
      registrationNumber,
      registeredAddress,
      vatCountryCode,
      vatId,
      normalizeAccountSubject(input.accountAddress),
      now,
      now,
    ],
  });
  return billingProfileFromRow(result.rows[0] as QueryRow);
}

function currentFreePeriod(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { end, start };
}

function paidEntitlementActive(status: string, periodEnd: Date | null, now: Date) {
  return ["active", "trialing", "past_due"].includes(status) && Boolean(periodEnd && periodEnd > now);
}

async function readSubscription(workspaceId: string) {
  const result = await dbClient.execute({
    sql: `SELECT plan_key, price_version, provider_status, current_period_start, current_period_end,
                 cancel_at_period_end
          FROM tokenless_workspace_subscriptions WHERE workspace_id = ? LIMIT 1`,
    args: [workspaceId],
  });
  return result.rows[0] as QueryRow;
}

async function hasBillingCustomer(workspaceId: string) {
  const result = await dbClient.execute({
    sql: "SELECT provider_customer_id FROM tokenless_workspace_billing_customers WHERE workspace_id = ? LIMIT 1",
    args: [workspaceId],
  });
  return Boolean(rowString(result.rows[0] as QueryRow, "provider_customer_id"));
}

export async function getWorkspaceBillingSummary(input: { accountAddress: string; workspaceId: string }) {
  const access = await requireWorkspaceAccess(input.accountAddress, input.workspaceId);
  const subscription = await readSubscription(input.workspaceId);
  const now = new Date();
  const storedStatus = rowString(subscription, "provider_status") ?? "free";
  const storedPeriodEnd = rowString(subscription, "current_period_end")
    ? new Date(String(subscription?.current_period_end))
    : null;
  const storedPeriodStart = rowString(subscription, "current_period_start")
    ? new Date(String(subscription?.current_period_start))
    : null;
  const statusAllowsPaid = paidEntitlementActive(storedStatus, storedPeriodEnd, now);
  const storedVersion = rowString(subscription, "price_version");
  const storedPlan = statusAllowsPaid && storedVersion ? getPlanByPriceVersion(storedVersion) : null;
  const paid =
    storedPlan?.key === "early_access" &&
    Boolean(storedPeriodStart && Number.isFinite(storedPeriodStart.getTime()) && storedPeriodStart < storedPeriodEnd!);
  const plan = paid ? TOKENLESS_BILLING_PLANS.early_access : TOKENLESS_BILLING_PLANS.free;
  const planKey = plan.key;
  const period = paid
    ? {
        end: storedPeriodEnd as Date,
        start: storedPeriodStart as Date,
      }
    : currentFreePeriod(now);
  const usageResult = await dbClient.execute({
    sql: `SELECT
            COUNT(*) FILTER (WHERE state = 'consumed')::integer AS completed,
            COUNT(*) FILTER (WHERE state = 'reserved')::integer AS reserved
          FROM tokenless_workspace_usage_allocations
          WHERE workspace_id = ? AND period_start = ? AND period_end = ?`,
    args: [input.workspaceId, period.start, period.end],
  });
  const usage = usageResult.rows[0] as QueryRow;
  const enabled = subscriptionsEnabled();
  const customerExists = await hasBillingCustomer(input.workspaceId);
  const storedSubscriptionId = rowString(subscription, "provider_subscription_id");
  const hasBlockingSubscription = Boolean(
    storedSubscriptionId &&
      isBlockingSubscriptionStatus(storedStatus as Parameters<typeof isBlockingSubscriptionStatus>[0]),
  );
  return {
    canManageBilling: access.canManageBilling,
    cancelAtPeriodEnd: paid && rowBoolean(subscription, "cancel_at_period_end"),
    checkoutAvailable: enabled && !paid && !hasBlockingSubscription,
    limits: {
      activeAgents: plan.activeAgents,
      activePrivateGroups: plan.activePrivateGroups,
      paidPanels: plan.paidPanels,
    },
    periodEnd: period.end.toISOString(),
    periodStart: period.start.toISOString(),
    plan: planKey,
    portalAvailable: enabled && customerExists,
    priceVersion: plan.priceVersion,
    status: storedStatus,
    usage: {
      completed: Number(rowString(usage, "completed") ?? "0"),
      limit: plan.decisionsPerPeriod,
      reserved: Number(rowString(usage, "reserved") ?? "0"),
    },
  };
}

async function getOrCreateBillingCustomer(input: { legalName: string; workspaceId: string }) {
  const existing = await dbClient.execute({
    sql: "SELECT provider_customer_id FROM tokenless_workspace_billing_customers WHERE workspace_id = ? LIMIT 1",
    args: [input.workspaceId],
  });
  const existingId = rowString(existing.rows[0] as QueryRow, "provider_customer_id");
  if (existingId) return existingId;

  const customer = await createStripeCustomer(input);
  const now = new Date();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_billing_customers
            (workspace_id, provider, provider_customer_id, created_at, updated_at)
          VALUES (?, 'stripe', ?, ?, ?)
          ON CONFLICT (workspace_id) DO NOTHING`,
    args: [input.workspaceId, customer.id, now, now],
  });
  const mapped = await dbClient.execute({
    sql: "SELECT provider_customer_id FROM tokenless_workspace_billing_customers WHERE workspace_id = ? LIMIT 1",
    args: [input.workspaceId],
  });
  const mappedId = rowString(mapped.rows[0] as QueryRow, "provider_customer_id");
  if (!mappedId) throw new TokenlessServiceError("Unable to save the billing customer.", 500, "billing_provider_error");
  return mappedId;
}

export async function startWorkspaceCheckout(input: { accountAddress: string; plan: unknown; workspaceId: string }) {
  if (!subscriptionsEnabled()) {
    throw new TokenlessServiceError("Subscription billing is not enabled yet.", 503, "billing_unavailable");
  }
  if (input.plan !== "early_access") {
    throw new TokenlessServiceError(
      "Only the Early Access plan is available for Checkout.",
      400,
      "invalid_billing_plan",
    );
  }
  const access = await requireWorkspaceAccess(input.accountAddress, input.workspaceId);
  requireBillingManager(access);
  if (access.traderStatus !== "verified" || !access.legalName || !access.registeredAddress) {
    throw new TokenlessServiceError(
      "Complete the self-declared business billing profile before Checkout.",
      409,
      "billing_profile_required",
    );
  }
  const subscription = await readSubscription(input.workspaceId);
  const status = rowString(subscription, "provider_status") ?? "free";
  const periodEnd = rowString(subscription, "current_period_end")
    ? new Date(String(subscription?.current_period_end))
    : null;
  if (paidEntitlementActive(status, periodEnd, new Date())) {
    throw new TokenlessServiceError(
      "This workspace already has an active subscription. Manage it in the billing portal.",
      409,
      "subscription_already_active",
    );
  }
  getEarlyAccessPriceId();
  const customerId = await getOrCreateBillingCustomer({ legalName: access.legalName, workspaceId: input.workspaceId });
  const blockingSubscription = await findBlockingStripeSubscription(customerId);
  if (blockingSubscription) {
    throw new TokenlessServiceError(
      "An existing subscription needs attention in the billing portal before starting another Checkout.",
      409,
      "subscription_requires_attention",
    );
  }
  return {
    url: await createEarlyAccessCheckout({
      customerId,
      legalName: access.legalName,
      workspaceId: input.workspaceId,
    }),
  };
}

export async function startWorkspaceBillingPortal(input: { accountAddress: string; workspaceId: string }) {
  if (!subscriptionsEnabled()) {
    throw new TokenlessServiceError("Subscription billing is not enabled yet.", 503, "billing_unavailable");
  }
  const access = await requireWorkspaceAccess(input.accountAddress, input.workspaceId);
  requireBillingManager(access);
  const result = await dbClient.execute({
    sql: "SELECT provider_customer_id FROM tokenless_workspace_billing_customers WHERE workspace_id = ? LIMIT 1",
    args: [input.workspaceId],
  });
  const customerId = rowString(result.rows[0] as QueryRow, "provider_customer_id");
  if (!customerId) {
    throw new TokenlessServiceError("No billing account exists for this workspace.", 404, "billing_customer_not_found");
  }
  return { url: await createStripePortal(customerId) };
}

export const __workspaceBillingTestUtils = {
  currentFreePeriod,
  paidEntitlementActive,
};

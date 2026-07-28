import type { TokenlessBillingPlanKey, TokenlessBillingPriceVersion } from "./plans";

export type WorkspaceCheckoutBlockedReason =
  | "billing_unavailable"
  | "subscription_requires_attention"
  | "manage_existing_subscription"
  | null;

export type WorkspaceBillingSummary = {
  plan: TokenlessBillingPlanKey;
  priceVersion: TokenlessBillingPriceVersion;
  status: string;
  cancelAtPeriodEnd: boolean;
  periodStart: string;
  periodEnd: string;
  usage: { completed: number; reserved: number; limit: number };
  limits: { activeAgents: number; activePrivateGroups: number; paidPanels: boolean };
  canManageBilling: boolean;
  checkoutAvailable: boolean;
  checkoutBlockedReason: WorkspaceCheckoutBlockedReason;
  portalAvailable: boolean;
};

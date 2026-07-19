export const TOKENLESS_WORKSPACE_ROLES = ["owner", "admin", "member", "billing"] as const;
export type TokenlessWorkspaceRole = (typeof TOKENLESS_WORKSPACE_ROLES)[number];

export const TOKENLESS_MODERATION_STATUSES = ["pending", "approved", "rejected", "delisted"] as const;
export type TokenlessModerationStatus = (typeof TOKENLESS_MODERATION_STATUSES)[number];

export const TOKENLESS_PAYMENT_STATES = [
  "reserved",
  "pending_user_signature",
  "pending_chain_execution",
  "possibly_paid",
  "submitted",
  "settled",
  "failed",
  "released",
] as const;
export type TokenlessPaymentState = (typeof TOKENLESS_PAYMENT_STATES)[number];

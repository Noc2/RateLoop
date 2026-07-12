export const TOKENLESS_SCHEMA_VERSION = "rateloop.tokenless.v1" as const;

export const TOKENLESS_TERMINAL_VERDICT_STATUSES = [
  "published",
  "delisted",
  "zero_commit_refunded",
  "under_quorum_compensated",
  "beacon_failure_compensated",
] as const;

export const TOKENLESS_VERDICT_STATUSES = [
  "pending_analytics",
  ...TOKENLESS_TERMINAL_VERDICT_STATUSES,
] as const;

export type TokenlessTerminalVerdictStatus =
  (typeof TOKENLESS_TERMINAL_VERDICT_STATUSES)[number];
export type TokenlessVerdictStatus =
  (typeof TOKENLESS_VERDICT_STATUSES)[number];
export type TokenlessAtomicAmount = string;

export interface TokenlessFundAccounting {
  fundedAtomic: TokenlessAtomicAmount;
  paidAtomic: TokenlessAtomicAmount;
  refundedAtomic: TokenlessAtomicAmount;
}

export interface TokenlessFeeAccounting extends TokenlessFundAccounting {
  bps: number;
}

export interface TokenlessAttemptReserveAccounting {
  compensatedAtomic: TokenlessAtomicAmount;
  fundedAtomic: TokenlessAtomicAmount;
  refundedAtomic: TokenlessAtomicAmount;
}

export interface TokenlessRefundAccounting {
  attemptReserveAtomic: TokenlessAtomicAmount;
  bountyAtomic: TokenlessAtomicAmount;
  feeAtomic: TokenlessAtomicAmount;
  totalAtomic: TokenlessAtomicAmount;
}

export interface TokenlessCompensationAccounting {
  perAcceptedRevealCapAtomic: TokenlessAtomicAmount;
  recipientCount: number;
  totalAtomic: TokenlessAtomicAmount;
}

export interface TokenlessEconomics {
  asset: "USDC";
  decimals: 6;
  bounty: TokenlessFundAccounting;
  fee: TokenlessFeeAccounting;
  attemptReserve: TokenlessAttemptReserveAccounting;
  refund: TokenlessRefundAccounting;
  compensation: TokenlessCompensationAccounting;
  totalFundedAtomic: TokenlessAtomicAmount;
}

export type TokenlessQuestion =
  | {
      kind: "binary";
      prompt: string;
      negativeLabel?: string;
      positiveLabel?: string;
      rationale: TokenlessRationaleRequirement;
    }
  | {
      kind: "head_to_head";
      prompt: string;
      optionA: { key: string; label: string };
      optionB: { key: string; label: string };
      rationale: TokenlessRationaleRequirement;
    };

export type TokenlessRationaleRequirement =
  | { mode: "optional" }
  | { mode: "required"; maxLength: number; minLength?: number };

export interface TokenlessQuoteRequest {
  audience: {
    tierId: string;
  };
  budget: {
    attemptReserveAtomic: TokenlessAtomicAmount;
    bountyAtomic: TokenlessAtomicAmount;
    feeBps: number;
  };
  question: TokenlessQuestion;
  requestedPanelSize: number;
}

export interface TokenlessQuoteResponse {
  schemaVersion: typeof TOKENLESS_SCHEMA_VERSION;
  quoteId: string;
  expiresAt: string;
  economics: TokenlessEconomics;
  audience: {
    tierId: string;
    label: string;
  };
  panel: {
    minimumReveals: number;
    requestedSize: number;
  };
  slo: {
    estimatedSeconds: number;
    tierId: string;
  };
}

export type TokenlessPayment =
  | { mode: "prepaid"; workspaceId: string }
  | { mode: "wallet"; payerAddress: `0x${string}` }
  | {
      mode: "x402";
      authorization: Record<string, unknown>;
      payerAddress: `0x${string}`;
    };

export const TOKENLESS_WEBHOOK_EVENT_TYPES = [
  "result.ready",
  "result.updated",
] as const;
export type TokenlessWebhookEventType =
  (typeof TOKENLESS_WEBHOOK_EVENT_TYPES)[number];

export interface TokenlessWebhookRegistration {
  eventTypes: TokenlessWebhookEventType[];
  url: string;
}

export interface TokenlessAskRequest {
  idempotencyKey: string;
  payment: TokenlessPayment;
  quoteId: string;
  webhook?: TokenlessWebhookRegistration;
}

export interface TokenlessPollContinuation {
  cursor: string;
  expiresAt: string;
  pollUrl: string;
  retryAfterMs: number;
}

export interface TokenlessAskResponse {
  schemaVersion: typeof TOKENLESS_SCHEMA_VERSION;
  idempotencyKey: string;
  operationKey: string;
  roundId: string | null;
  status: "awaiting_payment" | "submitted" | "open";
  continuation: TokenlessPollContinuation;
  webhookAccepted: boolean;
}

export interface TokenlessWaitRequest {
  operationKey: string;
  cursor?: string;
  timeoutMs?: number;
}

export type TokenlessWaitResponse =
  | {
      schemaVersion: typeof TOKENLESS_SCHEMA_VERSION;
      operationKey: string;
      status: "pending";
      verdictStatus: "pending_analytics" | null;
      continuation: TokenlessPollContinuation;
    }
  | {
      schemaVersion: typeof TOKENLESS_SCHEMA_VERSION;
      operationKey: string;
      status: "ready";
      verdictStatus: TokenlessVerdictStatus;
      continuation: null;
    };

export interface TokenlessResultRequest {
  operationKey: string;
}

export interface TokenlessResult {
  schemaVersion: typeof TOKENLESS_SCHEMA_VERSION;
  operationKey: string;
  roundId: string;
  verdictStatus: TokenlessVerdictStatus;
  terminal: boolean;
  economics: TokenlessEconomics;
  audience: {
    tierId: string;
    label: string;
    participantCount: number;
  };
  verdict: {
    confidenceBps: number | null;
    selected: string | null;
    scoreBps: number | null;
  } | null;
  methodologyUrl: string;
  updatedAt: string;
}

export interface TokenlessWebhookEvent {
  schemaVersion: typeof TOKENLESS_SCHEMA_VERSION;
  eventId: string;
  eventType: TokenlessWebhookEventType;
  occurredAt: string;
  operationKey: string;
  verdictStatus: TokenlessVerdictStatus;
  resultUrl: string;
}

export interface TokenlessClientOptions {
  apiBaseUrl: string;
  apiPath?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface TokenlessRateLoopClient {
  quote(request: TokenlessQuoteRequest): Promise<TokenlessQuoteResponse>;
  ask(request: TokenlessAskRequest): Promise<TokenlessAskResponse>;
  wait(request: TokenlessWaitRequest): Promise<TokenlessWaitResponse>;
  result(request: TokenlessResultRequest): Promise<TokenlessResult>;
}

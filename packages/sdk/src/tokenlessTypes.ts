export const TOKENLESS_SCHEMA_VERSION = "rateloop.tokenless.v2" as const;

export const TOKENLESS_REVIEWER_SOURCES = [
  "customer_invited",
  "rateloop_network",
  "hybrid",
  "sandbox",
] as const;
export type TokenlessReviewerSource =
  (typeof TOKENLESS_REVIEWER_SOURCES)[number];

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
    admissionPolicyHash: `0x${string}`;
    source: TokenlessReviewerSource;
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
    admissionPolicyHash: `0x${string}`;
    label: string;
    source: TokenlessReviewerSource;
  };
  panel: {
    minimumReveals: number;
    requestedSize: number;
  };
  slo: {
    estimatedSeconds: number;
  };
}

export type TokenlessPayment =
  | { mode: "prepaid"; workspaceId: string }
  | { mode: "wallet"; payerAddress: `0x${string}` }
  | {
      mode: "x402";
      /** Supplied after GET payment instructions when the exact immutable round terms are known. */
      authorization?: Record<string, unknown>;
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
    admissionPolicyHash: `0x${string}`;
    label: string;
    participantCount: number;
    source: TokenlessReviewerSource;
  };
  verdict: {
    intervalBps: { lower: number; upper: number } | null;
    preferenceShareBps: number | null;
    selected: string | null;
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
  /** Server-side workspace API key. Browser clients must use the HttpOnly Base Account session instead. */
  apiKey?: string;
  credentials?: RequestCredentials;
  defaultHeaders?: HeadersInit;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface TokenlessRoundTerms {
  contentId: `0x${string}`;
  termsHash: `0x${string}`;
  beaconNetworkHash: `0x${string}`;
  bountyAmount: TokenlessAtomicAmount;
  feeAmount: TokenlessAtomicAmount;
  attemptReserve: TokenlessAtomicAmount;
  attemptCompensation: TokenlessAtomicAmount;
  minimumReveals: number;
  maximumCommits: number;
  admissionPolicyHash: `0x${string}`;
  commitDeadline: string;
  revealDeadline: string;
  beaconFailureDeadline: string;
  beaconRound: string;
  claimGracePeriod: string;
  feeRecipient: `0x${string}`;
}

export interface TokenlessPaymentInstructions {
  operationKey: string;
  paymentMode: "wallet" | "x402" | "prepaid";
  paymentState: string;
  deploymentKey: string;
  chainId: number;
  panelAddress: `0x${string}`;
  x402SubmitterAddress: `0x${string}`;
  usdcAddress: `0x${string}`;
  funderAddress: `0x${string}`;
  totalFundedAtomic: TokenlessAtomicAmount;
  roundTerms: TokenlessRoundTerms;
  roundId: string | null;
  transactionHash: `0x${string}` | null;
}

export type TokenlessSubmitPaymentRequest =
  | { operationKey: string; transactionHash: `0x${string}` }
  | { operationKey: string; authorization: Record<string, unknown> }
  | { operationKey: string };

export interface TokenlessRateLoopClient {
  quote(request: TokenlessQuoteRequest): Promise<TokenlessQuoteResponse>;
  ask(request: TokenlessAskRequest): Promise<TokenlessAskResponse>;
  paymentInstructions(request: {
    operationKey: string;
  }): Promise<TokenlessPaymentInstructions>;
  submitPayment(
    request: TokenlessSubmitPaymentRequest,
  ): Promise<TokenlessPaymentInstructions>;
  wait(request: TokenlessWaitRequest): Promise<TokenlessWaitResponse>;
  result(request: TokenlessResultRequest): Promise<TokenlessResult>;
}

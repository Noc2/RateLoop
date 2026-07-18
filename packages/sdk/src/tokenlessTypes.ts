import type { HumanAssuranceApiClient } from "./humanAssuranceApiTypes";

export const TOKENLESS_SCHEMA_VERSION = "rateloop.tokenless.v2" as const;

export const TOKENLESS_REVIEWER_SOURCES = [
  "customer_invited",
  "rateloop_network",
  "hybrid",
] as const;
export type TokenlessReviewerSource =
  (typeof TOKENLESS_REVIEWER_SOURCES)[number];

export const TOKENLESS_TERMINAL_VERDICT_STATUSES = [
  "publishable",
  "inconclusive",
  "delisted",
  "zero_commit_refunded",
  "under_quorum_compensated",
  "beacon_failure_compensated",
] as const;

export const TOKENLESS_VERDICT_STATUSES = [
  "pending",
  ...TOKENLESS_TERMINAL_VERDICT_STATUSES,
] as const;

export type TokenlessTerminalVerdictStatus =
  (typeof TOKENLESS_TERMINAL_VERDICT_STATUSES)[number];
export type TokenlessVerdictStatus =
  (typeof TOKENLESS_VERDICT_STATUSES)[number];
export type TokenlessAtomicAmount = string;

export interface TokenlessRequestProfileReference {
  id: string;
  version: number;
  hash: `sha256:${string}`;
}

export type TokenlessFrozenReviewEconomics =
  | {
      compensationMode: "unpaid";
      bountyPerSeatAtomic: null;
      panelSize: number;
    }
  | {
      compensationMode: "usdc";
      bountyPerSeatAtomic: TokenlessAtomicAmount;
      panelSize: number;
    };

export const TOKENLESS_VISIBILITIES = ["public", "private"] as const;
export type TokenlessVisibility = (typeof TOKENLESS_VISIBILITIES)[number];

export const TOKENLESS_DATA_CLASSIFICATIONS = [
  "public",
  "synthetic",
  "redacted",
  "internal",
  "confidential",
  "restricted",
  "regulated",
] as const;
export type TokenlessDataClassification =
  (typeof TOKENLESS_DATA_CLASSIFICATIONS)[number];

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

export type TokenlessQuestionImage = {
  assetId: string;
  digest: `sha256:${string}`;
  alt: string;
};

export type TokenlessQuestionMedia =
  | { kind: "images"; items: TokenlessQuestionImage[] }
  | { kind: "youtube"; videoId: string };

export type TokenlessQuestionImageUploadRequest = {
  bytes: Uint8Array;
  clientRequestId: string;
  contentType?: "image/jpeg" | "image/png" | "image/webp";
  filename: string;
};

export type TokenlessQuestionImageUploadResponse = {
  assetId: string;
  contentType: "image/webp";
  digest: `sha256:${string}`;
  height: number;
  previewCapability: string;
  previewExpiresAt: string;
  previewUrl: string;
  sizeBytes: number;
  width: number;
};

/** Short-lived bearer used only to bridge an authenticated staged image into a browser handoff. */
export type TokenlessQuestionImagePreviewGrant = Pick<
  TokenlessQuestionImageUploadResponse,
  "assetId" | "digest" | "previewCapability"
>;

export type TokenlessQuestion =
  | {
      kind: "binary";
      prompt: string;
      negativeLabel?: string;
      positiveLabel?: string;
      rationale: TokenlessRationaleRequirement;
      media?: TokenlessQuestionMedia;
    }
  | {
      kind: "head_to_head";
      prompt: string;
      optionA: { key: string; label: string };
      optionB: { key: string; label: string };
      rationale: TokenlessRationaleRequirement;
      media?: TokenlessQuestionMedia;
    };

export type TokenlessRationaleRequirement =
  | { mode: "off" }
  | { mode: "optional" }
  | { mode: "required"; maxLength: number; minLength?: number };

export interface TokenlessQuoteRequest {
  /** Public questions must explicitly select public visibility and a safe classification. */
  visibility?: TokenlessVisibility;
  dataClassification?: TokenlessDataClassification;
  redactionSummary?: string;
  confirmedNoSensitiveData?: boolean;
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
  /** Frozen time available for responses. This is never derived from the service fill-time estimate. */
  responseWindowSeconds: number;
  /** Present when this quote was prepared from an immutable agent request profile. */
  requestProfile?: TokenlessRequestProfileReference;
  /** Present with requestProfile when per-seat and panel terms came from that frozen profile. */
  reviewEconomics?: TokenlessFrozenReviewEconomics;
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
  responseWindowSeconds: number;
  requestProfile: TokenlessRequestProfileReference | null;
  reviewEconomics: TokenlessFrozenReviewEconomics | null;
  /** Estimated end-to-end fill time only. Never use this value as the response window or commit deadline. */
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

export interface TokenlessAskRequest {
  idempotencyKey: string;
  payment: TokenlessPayment;
  quoteId: string;
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
  responseWindowSeconds: number;
  /** Absolute ISO-8601 commit deadline. Null until a round exists. */
  commitDeadline: string | null;
  requestProfile: TokenlessRequestProfileReference | null;
  reviewEconomics: TokenlessFrozenReviewEconomics | null;
  continuation: TokenlessPollContinuation;
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
      verdictStatus: "pending" | null;
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

export interface TokenlessResultFeedback {
  items: Array<{
    category:
      | "opinion"
      | "evidence"
      | "clarification"
      | "concern"
      | "bug_report"
      | "other";
    body: string;
    sourceUrl: string | null;
  }>;
  redactedCount: number;
}

export interface TokenlessResult {
  schemaVersion: typeof TOKENLESS_SCHEMA_VERSION;
  operationKey: string;
  roundId: string;
  verdictStatus: TokenlessVerdictStatus;
  terminal: boolean;
  responseWindowSeconds: number;
  /** Absolute ISO-8601 commit deadline frozen when the round opened. */
  commitDeadline: string;
  requestProfile: TokenlessRequestProfileReference | null;
  reviewEconomics: TokenlessFrozenReviewEconomics | null;
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
  feedback?: TokenlessResultFeedback;
  methodologyUrl: string;
  updatedAt: string;
}

export interface TokenlessClientOptions {
  apiBaseUrl: string;
  apiPath?: string;
  /** Server-side credential created by an approved agent connection. Browser clients use the HttpOnly session. */
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
  /**
   * Canonical facts for building an x402 authorization. This is optional while
   * older tokenless deployments are drained; x402 builders require it.
   */
  authorizationSpec?: TokenlessX402AuthorizationSpec;
}

export const TOKENLESS_PAYMENT_AUTHORIZATION_SCHEMA_VERSION =
  "rateloop.tokenless.payment-authorization.v1" as const;

export interface TokenlessEip712Domain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: `0x${string}`;
}

export interface TokenlessX402AuthorizationSpec {
  schemaVersion: typeof TOKENLESS_PAYMENT_AUTHORIZATION_SCHEMA_VERSION;
  /** The EIP-3009 token domain used by receiveWithAuthorization. */
  eip3009Domain: TokenlessEip712Domain;
  /** The X402PanelSubmitter EIP-712 domain used by roundAuthorizationSignature. */
  roundAuthorizationDomain: TokenlessEip712Domain;
  validAfter: TokenlessAtomicAmount;
  validBefore: TokenlessAtomicAmount;
  nonce: `0x${string}`;
}

export interface TokenlessDeploymentIdentity {
  deploymentKey: string;
  chainId: number;
  panelAddress: `0x${string}`;
  x402SubmitterAddress: `0x${string}`;
  usdcAddress: `0x${string}`;
}

export type TokenlessSubmitPaymentRequest =
  | { operationKey: string; transactionHash: `0x${string}` }
  | { operationKey: string; authorization: Record<string, unknown> }
  | { operationKey: string };

export interface TokenlessRateLoopClient {
  /** Workspace-scoped B2B project and run APIs. Requires a server-side workspace API key. */
  assurance: HumanAssuranceApiClient;
  stageQuestionImage(
    request: TokenlessQuestionImageUploadRequest,
  ): Promise<TokenlessQuestionImageUploadResponse>;
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

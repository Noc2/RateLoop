export type TransactionTimingMetadataValue = string | number | boolean | null | undefined;

export type TransactionTimingPayload = {
  action?: string;
  attemptIndex?: number;
  bundlerInfrastructureError?: boolean;
  callCount?: number;
  callTypes?: readonly string[];
  chainId?: number | null;
  deltaMs?: number;
  elapsedMs?: number;
  event: string;
  fallback?: string | boolean;
  message?: string;
  metadata?: Record<string, TransactionTimingMetadataValue>;
  parentRunId?: string;
  pollCount?: number;
  receiptCount?: number;
  route?: string;
  runId: string;
  segmentIndex?: number;
  source: string;
  sponsorshipMode?: string;
  status?: string;
  statusCode?: number;
  transactionHashCount?: number;
  transport?: string;
  walletId?: string;
};

type TransactionTimingRunParams = {
  action: string;
  callCount?: number;
  callTypes?: readonly string[];
  chainId?: number | null;
  consoleLabel: string;
  metadata?: Record<string, TransactionTimingMetadataValue>;
  parentRunId?: string;
  route?: string;
  segmentIndex?: number;
  source: string;
  sponsorshipMode?: string;
  transport?: string;
};

function nowMs() {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

function createRunId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function reportTransactionTiming(payload: TransactionTimingPayload) {
  if (typeof window === "undefined" || typeof fetch !== "function") {
    return;
  }

  try {
    const body = JSON.stringify(payload);
    void fetch("/api/transactions/timing", {
      body,
      headers: {
        "content-type": "application/json",
      },
      keepalive: body.length < 60_000,
      method: "POST",
    }).catch(() => {});
  } catch {
    // Timing telemetry must never affect the transaction flow.
  }
}

export function createTransactionTimingRun(params: TransactionTimingRunParams) {
  const startedAt = nowMs();
  let lastMarkAt = startedAt;
  const runId = createRunId();

  const emit = (event: string, extra: Record<string, unknown> = {}) => {
    const timestamp = nowMs();
    const elapsedMs = Math.round(timestamp - startedAt);
    const deltaMs = Math.round(timestamp - lastMarkAt);
    lastMarkAt = timestamp;

    const payload: TransactionTimingPayload & Record<string, unknown> = {
      action: params.action,
      callCount: params.callCount,
      callTypes: params.callTypes,
      chainId: params.chainId,
      deltaMs,
      elapsedMs,
      event,
      metadata: params.metadata,
      parentRunId: params.parentRunId,
      route: params.route,
      runId,
      segmentIndex: params.segmentIndex,
      source: params.source,
      sponsorshipMode: params.sponsorshipMode,
      transport: params.transport,
      ...extra,
    };

    console.info(`[${params.consoleLabel}]`, payload);
    reportTransactionTiming(payload);
  };

  emit("start");

  return { emit, runId };
}

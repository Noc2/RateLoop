import { createTokenlessRateLoopClient } from "@rateloop/sdk";
import type {
  TokenlessClientOptions,
  TokenlessRateLoopClient,
  TokenlessWaitRequest,
  TokenlessWaitResponse,
} from "@rateloop/sdk";

export type TokenlessWaitUntilReadyOptions = TokenlessWaitRequest & {
  maxWaitMs: number;
  sleep?: (milliseconds: number) => Promise<void>;
};

export type TokenlessAgentsClientOptions = TokenlessClientOptions & {
  apiKey?: string;
};

function isQuoteRequest(input: RequestInfo | URL) {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url,
  );
  return url.pathname.endsWith("/quote");
}

function withScopedApiKey(
  transport: typeof fetch,
  apiKey: string | undefined,
): typeof fetch {
  const normalizedApiKey = apiKey?.trim();
  if (!normalizedApiKey) return transport;

  return async (input, init) => {
    if (isQuoteRequest(input)) return transport(input, init);
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${normalizedApiKey}`);
    return transport(input, { ...init, headers });
  };
}

export function createTokenlessAgentsClient(
  options: TokenlessAgentsClientOptions,
): TokenlessRateLoopClient {
  const { apiKey, fetchImpl, ...sdkOptions } = options;
  return createTokenlessRateLoopClient({
    ...sdkOptions,
    fetchImpl: withScopedApiKey(fetchImpl ?? fetch, apiKey),
  });
}

function defaultSleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export async function waitUntilTokenlessReady(
  client: TokenlessRateLoopClient,
  options: TokenlessWaitUntilReadyOptions,
): Promise<TokenlessWaitResponse> {
  if (!Number.isSafeInteger(options.maxWaitMs) || options.maxWaitMs < 1_000) {
    throw new Error("maxWaitMs must be a safe integer of at least 1000ms.");
  }

  const startedAt = Date.now();
  const sleep = options.sleep ?? defaultSleep;
  let cursor = options.cursor;

  while (true) {
    const elapsed = Date.now() - startedAt;
    const remaining = options.maxWaitMs - elapsed;
    if (remaining < 1_000) {
      const resume = cursor ? ` Resume with cursor ${cursor}.` : "";
      throw new Error(
        `Tokenless result was not ready within ${options.maxWaitMs}ms.${resume}`,
      );
    }

    const timeoutMs = Math.max(
      1_000,
      Math.min(options.timeoutMs ?? 30_000, remaining, 60_000),
    );
    const response = await client.wait({
      cursor,
      operationKey: options.operationKey,
      timeoutMs,
    });
    if (response.status === "ready") return response;

    cursor = response.continuation.cursor;
    const retryAfterMs = Math.min(
      response.continuation.retryAfterMs,
      Math.max(0, options.maxWaitMs - (Date.now() - startedAt)),
    );
    if (retryAfterMs > 0) await sleep(retryAfterMs);
  }
}

export { createTokenlessRateLoopClient } from "@rateloop/sdk";
export {
  TOKENLESS_SCHEMA_VERSION,
  TOKENLESS_TERMINAL_VERDICT_STATUSES,
  TOKENLESS_VERDICT_STATUSES,
  TOKENLESS_WEBHOOK_EVENT_TYPES,
} from "@rateloop/sdk";
export type {
  TokenlessAskRequest,
  TokenlessAskResponse,
  TokenlessAttemptReserveAccounting,
  TokenlessClientOptions,
  TokenlessCompensationAccounting,
  TokenlessEconomics,
  TokenlessFeeAccounting,
  TokenlessFundAccounting,
  TokenlessPayment,
  TokenlessPollContinuation,
  TokenlessQuestion,
  TokenlessQuoteRequest,
  TokenlessQuoteResponse,
  TokenlessRateLoopClient,
  TokenlessRationaleRequirement,
  TokenlessRefundAccounting,
  TokenlessResult,
  TokenlessResultRequest,
  TokenlessTerminalVerdictStatus,
  TokenlessVerdictStatus,
  TokenlessWaitRequest,
  TokenlessWaitResponse,
  TokenlessWebhookEvent,
  TokenlessWebhookEventType,
  TokenlessWebhookRegistration,
} from "@rateloop/sdk";

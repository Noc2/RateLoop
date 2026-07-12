import { RateLoopApiError, RateLoopSdkError } from "./errors";
import {
  parseTokenlessAskResponse,
  parseTokenlessQuoteResponse,
  parseTokenlessResult,
  parseTokenlessWaitResponse,
} from "./tokenlessSchema";
import type {
  TokenlessAskRequest,
  TokenlessAskResponse,
  TokenlessClientOptions,
  TokenlessQuoteRequest,
  TokenlessQuoteResponse,
  TokenlessRateLoopClient,
  TokenlessResult,
  TokenlessResultRequest,
  TokenlessWaitRequest,
  TokenlessWaitResponse,
} from "./tokenlessTypes";

const DEFAULT_API_PATH = "/api/agent/v1";
const DEFAULT_TIMEOUT_MS = 10_000;
const MIN_WAIT_TIMEOUT_MS = 1_000;
const MAX_WAIT_TIMEOUT_MS = 60_000;
const WAIT_TRANSPORT_BUFFER_MS = 5_000;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,160}$/;
const ATOMIC_AMOUNT_PATTERN = /^(0|[1-9]\d*)$/;

interface NormalizedTokenlessClientOptions {
  apiBaseUrl: string;
  apiPath: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1"
  );
}

function normalizeApiBaseUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new RateLoopSdkError(`Invalid tokenless apiBaseUrl: ${value}`);
  }

  if (parsed.username || parsed.password) {
    throw new RateLoopSdkError(
      "Tokenless apiBaseUrl must not contain credentials.",
    );
  }
  if (
    parsed.protocol !== "https:" &&
    !(parsed.protocol === "http:" && isLoopbackHostname(parsed.hostname))
  ) {
    throw new RateLoopSdkError(
      "Tokenless apiBaseUrl must use HTTPS except for loopback development.",
    );
  }
  return parsed.toString().replace(/\/+$/, "");
}

function normalizeApiPath(value: string | undefined) {
  const normalized = value?.trim() || DEFAULT_API_PATH;
  if (
    !normalized.startsWith("/") ||
    normalized.includes("?") ||
    normalized.includes("#")
  ) {
    throw new RateLoopSdkError(
      "Tokenless apiPath must be an absolute URL path without query or fragment.",
    );
  }
  return normalized.replace(/\/+$/, "");
}

function positiveTimeout(
  value: number | undefined,
  fallback: number,
  name: string,
) {
  const normalized = value ?? fallback;
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new RateLoopSdkError(`${name} must be a positive safe integer.`);
  }
  return normalized;
}

function normalizeOptions(
  options: TokenlessClientOptions,
): NormalizedTokenlessClientOptions {
  return {
    apiBaseUrl: normalizeApiBaseUrl(options.apiBaseUrl),
    apiPath: normalizeApiPath(options.apiPath),
    fetchImpl: options.fetchImpl ?? fetch,
    timeoutMs: positiveTimeout(
      options.timeoutMs,
      DEFAULT_TIMEOUT_MS,
      "timeoutMs",
    ),
  };
}

function encodePathSegment(value: string, name: string) {
  const normalized = value.trim();
  if (!normalized) throw new RateLoopSdkError(`${name} is required.`);
  return encodeURIComponent(normalized).replaceAll(".", "%2E");
}

function assertIdempotencyKey(value: string) {
  if (!IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new RateLoopSdkError(
      "idempotencyKey must be 8-160 characters using letters, numbers, dot, underscore, colon, or hyphen.",
    );
  }
}

function assertQuoteRequest(request: TokenlessQuoteRequest) {
  if (!ATOMIC_AMOUNT_PATTERN.test(request.budget.bountyAtomic)) {
    throw new RateLoopSdkError(
      "budget.bountyAtomic must be an unsigned base-10 atomic amount string.",
    );
  }
  if (!ATOMIC_AMOUNT_PATTERN.test(request.budget.attemptReserveAtomic)) {
    throw new RateLoopSdkError(
      "budget.attemptReserveAtomic must be an unsigned base-10 atomic amount string.",
    );
  }
  if (
    !Number.isSafeInteger(request.budget.feeBps) ||
    request.budget.feeBps < 0 ||
    request.budget.feeBps > 2_000
  ) {
    throw new RateLoopSdkError(
      "budget.feeBps must be an integer between 0 and 2000.",
    );
  }
  if (
    !Number.isSafeInteger(request.requestedPanelSize) ||
    request.requestedPanelSize <= 0
  ) {
    throw new RateLoopSdkError(
      "requestedPanelSize must be a positive safe integer.",
    );
  }
  if (!request.question.prompt.trim()) {
    throw new RateLoopSdkError("question.prompt is required.");
  }
}

function normalizeWaitTimeout(value: number | undefined) {
  const timeoutMs = value ?? 30_000;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < MIN_WAIT_TIMEOUT_MS ||
    timeoutMs > MAX_WAIT_TIMEOUT_MS
  ) {
    throw new RateLoopSdkError(
      `wait timeoutMs must be between ${MIN_WAIT_TIMEOUT_MS} and ${MAX_WAIT_TIMEOUT_MS}.`,
    );
  }
  return timeoutMs;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new RateLoopApiError(
      "RateLoop returned a non-JSON tokenless response.",
      response.status || 502,
    );
  }
}

function errorDetails(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const body = value as Record<string, unknown>;
  return {
    code: typeof body.code === "string" ? body.code : undefined,
    details: body.details,
    recoverWith:
      typeof body.recoverWith === "string" ? body.recoverWith : undefined,
    retryable: typeof body.retryable === "boolean" ? body.retryable : undefined,
  };
}

function errorMessage(value: unknown, status: number) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const body = value as Record<string, unknown>;
    if (typeof body.message === "string" && body.message.trim())
      return body.message;
    if (typeof body.error === "string" && body.error.trim()) return body.error;
  }
  return `RateLoop tokenless request failed with HTTP ${status}.`;
}

async function request(
  config: NormalizedTokenlessClientOptions,
  path: string,
  init: RequestInit,
  timeoutMs = config.timeoutMs,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await config.fetchImpl(
      `${config.apiBaseUrl}${config.apiPath}${path}`,
      {
        ...init,
        headers: {
          accept: "application/json",
          ...init.headers,
        },
        signal: controller.signal,
      },
    );
    const body = await parseResponseBody(response);
    if (!response.ok) {
      throw new RateLoopApiError(
        errorMessage(body, response.status),
        response.status,
        errorDetails(body),
      );
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

async function post<T>(
  config: NormalizedTokenlessClientOptions,
  path: string,
  body: unknown,
  parse: (value: unknown) => T,
  headers?: HeadersInit,
): Promise<T> {
  const response = await request(config, path, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    method: "POST",
  });
  return parse(response);
}

export function createTokenlessRateLoopClient(
  options: TokenlessClientOptions,
): TokenlessRateLoopClient {
  const config = normalizeOptions(options);

  return {
    quote(requestBody: TokenlessQuoteRequest): Promise<TokenlessQuoteResponse> {
      assertQuoteRequest(requestBody);
      return post(config, "/quote", requestBody, parseTokenlessQuoteResponse);
    },

    ask(requestBody: TokenlessAskRequest): Promise<TokenlessAskResponse> {
      assertIdempotencyKey(requestBody.idempotencyKey);
      return post(config, "/asks", requestBody, parseTokenlessAskResponse, {
        "idempotency-key": requestBody.idempotencyKey,
      });
    },

    async wait(
      waitRequest: TokenlessWaitRequest,
    ): Promise<TokenlessWaitResponse> {
      const operationKey = encodePathSegment(
        waitRequest.operationKey,
        "operationKey",
      );
      const timeoutMs = normalizeWaitTimeout(waitRequest.timeoutMs);
      const search = new URLSearchParams({ timeoutMs: String(timeoutMs) });
      if (waitRequest.cursor?.trim())
        search.set("cursor", waitRequest.cursor.trim());
      const response = await request(
        config,
        `/asks/${operationKey}/wait?${search.toString()}`,
        { method: "GET" },
        timeoutMs + WAIT_TRANSPORT_BUFFER_MS,
      );
      return parseTokenlessWaitResponse(response);
    },

    async result(
      resultRequest: TokenlessResultRequest,
    ): Promise<TokenlessResult> {
      const operationKey = encodePathSegment(
        resultRequest.operationKey,
        "operationKey",
      );
      const response = await request(config, `/results/${operationKey}`, {
        method: "GET",
      });
      return parseTokenlessResult(response);
    },
  };
}

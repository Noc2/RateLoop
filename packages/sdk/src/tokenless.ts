import { RateLoopApiError, RateLoopSdkError } from "./errors";
import {
  parseHumanAssuranceProjectCreateRequest,
  parseHumanAssuranceProjectCreateResponse,
  parseHumanAssuranceProjectListResponse,
  parseHumanAssuranceProjectResourcesResponse,
  parseHumanAssurancePrivateReviewCreateRequest,
  parseHumanAssurancePrivateReviewCreateResponse,
  parseHumanAssuranceRunStatusResponse,
} from "./humanAssuranceApiSchema";
import type {
  HumanAssurancePrivateReviewCreateRequest,
  HumanAssuranceProjectCreateRequest,
} from "./humanAssuranceApiTypes";
import {
  parseTokenlessAskResponse,
  parseTokenlessPaymentInstructions,
  parseTokenlessQuoteResponse,
  parseTokenlessResult,
  parseTokenlessWaitResponse,
} from "./tokenlessSchema";
import type {
  TokenlessAskRequest,
  TokenlessAskResponse,
  TokenlessClientOptions,
  TokenlessPaymentInstructions,
  TokenlessFrozenReviewEconomics,
  TokenlessQuoteRequest,
  TokenlessQuoteResponse,
  TokenlessQuestionImageUploadRequest,
  TokenlessQuestionImageUploadResponse,
  TokenlessRateLoopClient,
  TokenlessResult,
  TokenlessResultRequest,
  TokenlessRequestProfileReference,
  TokenlessWaitRequest,
  TokenlessWaitResponse,
  TokenlessSubmitPaymentRequest,
} from "./tokenlessTypes";
import {
  TOKENLESS_REVIEWER_SOURCES,
  TOKENLESS_SCHEMA_VERSION,
} from "./tokenlessTypes";
import { normalizeTokenlessQuestion } from "./tokenlessMedia";
import { sha256, stringToHex } from "viem";

const DEFAULT_API_PATH = "/api/agent/v1";
const DEFAULT_TIMEOUT_MS = 10_000;
const MIN_WAIT_TIMEOUT_MS = 1_000;
const MAX_WAIT_TIMEOUT_MS = 60_000;
const WAIT_TRANSPORT_BUFFER_MS = 5_000;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,160}$/;
const ATOMIC_AMOUNT_PATTERN = /^(0|[1-9]\d*)$/;
const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const reviewerSources = new Set<string>(TOKENLESS_REVIEWER_SOURCES);
const MIN_RESPONSE_WINDOW_SECONDS = 1_200;
const MAX_RESPONSE_WINDOW_SECONDS = 86_400;

interface NormalizedTokenlessClientOptions {
  apiBaseUrl: string;
  apiPath: string;
  credentials: RequestCredentials;
  defaultHeaders: Headers;
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
  const defaultHeaders = new Headers(options.defaultHeaders);
  if (
    typeof window !== "undefined" &&
    (options.apiKey || defaultHeaders.has("authorization"))
  ) {
    throw new RateLoopSdkError(
      "Tokenless API authorization is server-only and must not be embedded in browser clients.",
    );
  }
  if (
    options.apiKey &&
    !/^rlk_[a-f0-9]{16}_[A-Za-z0-9_-]{32,128}$/.test(options.apiKey)
  ) {
    throw new RateLoopSdkError("Invalid tokenless workspace apiKey.");
  }
  if (options.apiKey)
    defaultHeaders.set("authorization", `Bearer ${options.apiKey}`);
  return {
    apiBaseUrl: normalizeApiBaseUrl(options.apiBaseUrl),
    apiPath: normalizeApiPath(options.apiPath),
    credentials: options.credentials ?? "same-origin",
    defaultHeaders,
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

export function normalizeTokenlessQuoteRequest(
  request: TokenlessQuoteRequest,
): TokenlessQuoteRequest {
  if (!BYTES32_PATTERN.test(request.audience.admissionPolicyHash)) {
    throw new RateLoopSdkError(
      "audience.admissionPolicyHash must be a bytes32 hex value.",
    );
  }
  if (!reviewerSources.has(request.audience.source)) {
    throw new RateLoopSdkError("audience.source is unsupported.");
  }
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
    request.requestedPanelSize < 3 ||
    request.requestedPanelSize > 500
  ) {
    throw new RateLoopSdkError(
      "requestedPanelSize must be a safe integer between 3 and 500.",
    );
  }
  if (
    !Number.isSafeInteger(request.responseWindowSeconds) ||
    request.responseWindowSeconds < MIN_RESPONSE_WINDOW_SECONDS ||
    request.responseWindowSeconds > MAX_RESPONSE_WINDOW_SECONDS
  ) {
    throw new RateLoopSdkError(
      `responseWindowSeconds must be a safe integer between ${MIN_RESPONSE_WINDOW_SECONDS} and ${MAX_RESPONSE_WINDOW_SECONDS}.`,
    );
  }
  if (
    (request.requestProfile === undefined) !==
    (request.reviewEconomics === undefined)
  ) {
    throw new RateLoopSdkError(
      "requestProfile and reviewEconomics must be supplied together.",
    );
  }
  let requestProfile: TokenlessRequestProfileReference | undefined;
  let reviewEconomics: TokenlessFrozenReviewEconomics | undefined;
  if (request.requestProfile && request.reviewEconomics) {
    if (
      !request.requestProfile.id.trim() ||
      !Number.isSafeInteger(request.requestProfile.version) ||
      request.requestProfile.version < 1 ||
      !/^sha256:[0-9a-f]{64}$/.test(request.requestProfile.hash)
    ) {
      throw new RateLoopSdkError(
        "requestProfile must contain an ID, positive version, and lowercase sha256 hash.",
      );
    }
    if (request.reviewEconomics.panelSize !== request.requestedPanelSize) {
      throw new RateLoopSdkError(
        "reviewEconomics.panelSize must equal requestedPanelSize.",
      );
    }
    if (
      request.reviewEconomics.compensationMode !== "unpaid" &&
      request.reviewEconomics.compensationMode !== "usdc"
    ) {
      throw new RateLoopSdkError(
        "reviewEconomics.compensationMode must be unpaid or usdc.",
      );
    }
    if (
      request.reviewEconomics.compensationMode === "unpaid" &&
      request.reviewEconomics.bountyPerSeatAtomic !== null
    ) {
      throw new RateLoopSdkError(
        "reviewEconomics.bountyPerSeatAtomic must be null for unpaid review.",
      );
    }
    if (
      request.reviewEconomics.compensationMode === "usdc" &&
      (!ATOMIC_AMOUNT_PATTERN.test(
        request.reviewEconomics.bountyPerSeatAtomic,
      ) ||
        BigInt(request.reviewEconomics.bountyPerSeatAtomic) < 1n)
    ) {
      throw new RateLoopSdkError(
        "reviewEconomics.bountyPerSeatAtomic must be a positive USDC atomic amount.",
      );
    }
    requestProfile = {
      id: request.requestProfile.id.trim(),
      version: request.requestProfile.version,
      hash: request.requestProfile.hash,
    };
    reviewEconomics = { ...request.reviewEconomics };
  }
  if (BigInt(request.budget.bountyAtomic) === 0n) {
    throw new RateLoopSdkError(
      "budget.bountyAtomic must be greater than zero.",
    );
  }
  if (
    BigInt(request.budget.attemptReserveAtomic) <
    BigInt(request.requestedPanelSize)
  ) {
    throw new RateLoopSdkError(
      "budget.attemptReserveAtomic must fund a non-zero compensation cap for every requested rater.",
    );
  }
  return {
    ...request,
    visibility: request.visibility ?? "private",
    dataClassification: request.dataClassification ?? "internal",
    question: normalizeTokenlessQuestion(request.question),
    ...(request.redactionSummary === undefined
      ? {}
      : { redactionSummary: request.redactionSummary.trim() }),
    ...(requestProfile && reviewEconomics
      ? { requestProfile, reviewEconomics }
      : {}),
  };
}

const quoteAudienceLabels = {
  customer_invited: "Customer-invited reviewers",
  rateloop_network: "RateLoop-network reviewers",
  hybrid: "Separate invited and RateLoop-network subpanels",
} as const;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined)
    throw new RateLoopSdkError("Tokenless intent is not JSON serializable.");
  return encoded;
}

function intentDigest(value: unknown) {
  return sha256(stringToHex(stableJson(value)));
}

function assertIntentField(name: string, actual: unknown, expected: unknown) {
  if (stableJson(actual) !== stableJson(expected)) {
    throw new RateLoopSdkError(
      `The accepted quote changed the locally requested ${name}.`,
    );
  }
}

/**
 * Reconstructs the exact content and product-term commitments that the server
 * freezes before payment. Autonomous callers must compare these commitments
 * with the signed round terms instead of trusting same-total server output.
 */
export function buildTokenlessQuoteIntent(
  requestBody: TokenlessQuoteRequest,
  quote: TokenlessQuoteResponse,
) {
  const request = normalizeTokenlessQuoteRequest(requestBody);
  const bounty = BigInt(request.budget.bountyAtomic);
  const reserve = BigInt(request.budget.attemptReserveAtomic);
  const fee = (bounty * BigInt(request.budget.feeBps)) / 10_000n;
  const economics = {
    asset: "USDC" as const,
    decimals: 6 as const,
    bounty: {
      fundedAtomic: bounty.toString(),
      paidAtomic: "0",
      refundedAtomic: "0",
    },
    fee: {
      bps: request.budget.feeBps,
      fundedAtomic: fee.toString(),
      paidAtomic: "0",
      refundedAtomic: "0",
    },
    attemptReserve: {
      compensatedAtomic: "0",
      fundedAtomic: reserve.toString(),
      refundedAtomic: "0",
    },
    refund: {
      attemptReserveAtomic: "0",
      bountyAtomic: "0",
      feeAtomic: "0",
      totalAtomic: "0",
    },
    compensation: {
      perAcceptedRevealCapAtomic: (
        reserve / BigInt(request.requestedPanelSize)
      ).toString(),
      recipientCount: 0,
      totalAtomic: "0",
    },
    totalFundedAtomic: (bounty + fee + reserve).toString(),
  };
  const audience = {
    admissionPolicyHash: request.audience.admissionPolicyHash,
    label: quoteAudienceLabels[request.audience.source],
    source: request.audience.source,
  };
  const panel = {
    minimumReveals: Math.max(3, Math.ceil(request.requestedPanelSize * 0.8)),
    requestedSize: request.requestedPanelSize,
  };
  assertIntentField("economics", quote.economics, economics);
  assertIntentField("audience", quote.audience, audience);
  assertIntentField("panel", quote.panel, panel);
  assertIntentField(
    "response window",
    quote.responseWindowSeconds,
    request.responseWindowSeconds,
  );
  assertIntentField(
    "request profile",
    quote.requestProfile,
    request.requestProfile ?? null,
  );
  assertIntentField(
    "review economics",
    quote.reviewEconomics,
    request.reviewEconomics ?? null,
  );

  const contentHash = intentDigest(request.question).slice(2);
  const terms = {
    audience,
    visibility: request.visibility,
    dataClassification: request.dataClassification,
    redactionSummary: request.redactionSummary ?? null,
    confirmedNoSensitiveData: request.confirmedNoSensitiveData === true,
    economics,
    panel,
    questionHash: contentHash,
    responseWindowSeconds: request.responseWindowSeconds,
    schemaVersion: TOKENLESS_SCHEMA_VERSION,
  };
  return {
    contentId: `0x${contentHash}` as const,
    normalizedRequest: request,
    termsHash: intentDigest(terms),
  };
}

function assertEvmAddress(value: string, path: string) {
  if (!EVM_ADDRESS_PATTERN.test(value)) {
    throw new RateLoopSdkError(`${path} must be an EVM address.`);
  }
}

function assertAskRequest(request: TokenlessAskRequest) {
  assertIdempotencyKey(request.idempotencyKey);
  if (!request.quoteId?.trim()) {
    throw new RateLoopSdkError("quoteId is required.");
  }
  if (request.payment.mode === "prepaid") {
    if (!request.payment.workspaceId.trim()) {
      throw new RateLoopSdkError(
        "payment.workspaceId is required for prepaid payment.",
      );
    }
  } else {
    assertEvmAddress(request.payment.payerAddress, "payment.payerAddress");
    if (
      request.payment.mode === "x402" &&
      request.payment.authorization !== undefined &&
      (request.payment.authorization === null ||
        Array.isArray(request.payment.authorization) ||
        Object.keys(request.payment.authorization).length === 0)
    ) {
      throw new RateLoopSdkError(
        "payment.authorization must be a non-empty object when provided.",
      );
    }
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

function parseQuestionImageUpload(
  value: unknown,
): TokenlessQuestionImageUploadResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RateLoopSdkError(
      "Question image upload response must be an object.",
    );
  }
  const response = value as Record<string, unknown>;
  if (
    typeof response.assetId !== "string" ||
    !/^pqm_[A-Za-z0-9_-]{24,80}$/.test(response.assetId) ||
    response.contentType !== "image/webp" ||
    typeof response.digest !== "string" ||
    !/^sha256:[0-9a-f]{64}$/.test(response.digest) ||
    !Number.isSafeInteger(response.width) ||
    Number(response.width) <= 0 ||
    !Number.isSafeInteger(response.height) ||
    Number(response.height) <= 0 ||
    !Number.isSafeInteger(response.sizeBytes) ||
    Number(response.sizeBytes) <= 0 ||
    typeof response.previewUrl !== "string" ||
    !response.previewUrl.startsWith("/api/public-media/images/")
  ) {
    throw new RateLoopSdkError("Question image upload response is invalid.");
  }
  return response as TokenlessQuestionImageUploadResponse;
}

async function request(
  config: NormalizedTokenlessClientOptions,
  path: string,
  init: RequestInit,
  timeoutMs = config.timeoutMs,
  options: { omitAuthorization?: boolean } = {},
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = new Headers(config.defaultHeaders);
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    if (options.omitAuthorization) headers.delete("authorization");
    if (!headers.has("accept")) headers.set("accept", "application/json");
    const response = await config.fetchImpl(
      `${config.apiBaseUrl}${config.apiPath}${path}`,
      {
        ...init,
        credentials: config.credentials,
        headers,
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
  options?: { omitAuthorization?: boolean },
): Promise<T> {
  const response = await request(
    config,
    path,
    {
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        ...headers,
      },
      method: "POST",
    },
    config.timeoutMs,
    options,
  );
  return parse(response);
}

export function createTokenlessRateLoopClient(
  options: TokenlessClientOptions,
): TokenlessRateLoopClient {
  const config = normalizeOptions(options);

  return {
    assurance: {
      async listProjects() {
        const response = await request(config, "/assurance/projects", {
          method: "GET",
        });
        return parseHumanAssuranceProjectListResponse(response);
      },

      createProject(requestBody: HumanAssuranceProjectCreateRequest) {
        return post(
          config,
          "/assurance/projects",
          parseHumanAssuranceProjectCreateRequest(requestBody),
          parseHumanAssuranceProjectCreateResponse,
        );
      },

      createPrivateReview(
        requestBody: HumanAssurancePrivateReviewCreateRequest,
      ) {
        return post(
          config,
          "/assurance/private-reviews",
          parseHumanAssurancePrivateReviewCreateRequest(requestBody),
          parseHumanAssurancePrivateReviewCreateResponse,
          { "idempotency-key": requestBody.idempotencyKey },
        );
      },

      async getProject(requestBody: { projectId: string }) {
        const projectId = encodePathSegment(requestBody.projectId, "projectId");
        const response = await request(
          config,
          `/assurance/projects/${projectId}`,
          {
            method: "GET",
          },
        );
        return parseHumanAssuranceProjectResourcesResponse(response);
      },

      async getRunStatus(requestBody: { runId: string }) {
        const runId = encodePathSegment(requestBody.runId, "runId");
        const response = await request(config, `/assurance/runs/${runId}`, {
          method: "GET",
        });
        return parseHumanAssuranceRunStatusResponse(response);
      },
    },

    async stageQuestionImage(requestBody: TokenlessQuestionImageUploadRequest) {
      if (
        !(requestBody.bytes instanceof Uint8Array) ||
        requestBody.bytes.byteLength < 1 ||
        requestBody.bytes.byteLength > 10 * 1024 * 1024 ||
        !/^[A-Za-z0-9._:-]{8,160}$/.test(requestBody.clientRequestId) ||
        !requestBody.filename.trim() ||
        requestBody.filename.length > 180
      ) {
        throw new RateLoopSdkError("Question image upload request is invalid.");
      }
      const form = new FormData();
      form.set("clientRequestId", requestBody.clientRequestId);
      form.set(
        "file",
        new Blob([requestBody.bytes.slice().buffer], {
          type: requestBody.contentType ?? "application/octet-stream",
        }),
        requestBody.filename,
      );
      const response = await request(config, "/media/images", {
        body: form,
        method: "POST",
      });
      return parseQuestionImageUpload(response);
    },

    quote(requestBody: TokenlessQuoteRequest): Promise<TokenlessQuoteResponse> {
      const normalized = normalizeTokenlessQuoteRequest(requestBody);
      return post(
        config,
        "/quote",
        normalized,
        parseTokenlessQuoteResponse,
        undefined,
        {
          omitAuthorization: normalized.visibility === "public",
        },
      );
    },

    ask(requestBody: TokenlessAskRequest): Promise<TokenlessAskResponse> {
      assertAskRequest(requestBody);
      return post(config, "/asks", requestBody, parseTokenlessAskResponse, {
        "idempotency-key": requestBody.idempotencyKey,
      });
    },

    async paymentInstructions(requestBody: {
      operationKey: string;
    }): Promise<TokenlessPaymentInstructions> {
      const operationKey = encodePathSegment(
        requestBody.operationKey,
        "operationKey",
      );
      const response = await request(config, `/asks/${operationKey}/payment`, {
        method: "GET",
      });
      return parseTokenlessPaymentInstructions(response);
    },

    async submitPayment(
      requestBody: TokenlessSubmitPaymentRequest,
    ): Promise<TokenlessPaymentInstructions> {
      const operationKey = encodePathSegment(
        requestBody.operationKey,
        "operationKey",
      );
      const body =
        "transactionHash" in requestBody
          ? { transactionHash: requestBody.transactionHash }
          : "authorization" in requestBody
            ? { authorization: requestBody.authorization }
            : {};
      return post(
        config,
        `/asks/${operationKey}/payment`,
        body,
        parseTokenlessPaymentInstructions,
      );
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

import { CuryoApiError, CuryoSdkError } from "./errors";
import type { CuryoFetch } from "./types";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type JsonRecord = Record<string, unknown>;

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MCP_PROTOCOL_VERSION = "2025-11-25";
const DEFAULT_AGENT_API_PATH = "/api/agent";
const DEFAULT_MCP_PATH = "/api/mcp";
const DEFAULT_PUBLIC_MCP_PATH = "/api/mcp/public";
const AGENT_AUTH_REQUIRED_MESSAGE =
  "Curyo agent operations require apiBaseUrl for direct HTTP or mcpApiUrl for MCP. Add mcpAccessToken only for managed agent policies.";

export interface CuryoAgentClientOptions {
  agentApiPath?: string;
  apiBaseUrl?: string;
  mcpApiUrl?: string;
  mcpAccessToken?: string;
  fetchImpl?: CuryoFetch;
  quoteFetchImpl?: CuryoFetch;
  timeoutMs?: number;
  mcpProtocolVersion?: string;
}

export interface CuryoAgentQuestionItem {
  title: string;
  description?: string;
  contextUrl?: string;
  categoryId: string | number | bigint;
  tags: string | string[];
  imageUrls?: string[];
  videoUrl?: string;
  [key: string]: unknown;
}

export interface CuryoAgentBounty {
  asset?: "USDC" | string;
  amount: string | number | bigint;
  requiredVoters?: string | number | bigint;
  requiredSettledRounds?: string | number | bigint;
  rewardPoolExpiresAt?: string | number | bigint;
  feedbackClosesAt?: string | number | bigint;
  bountyEligibility?: 0 | 1 | string | number;
  [key: string]: unknown;
}

export interface CuryoAgentRoundConfig {
  epochDuration?: string | number | bigint;
  blindPhaseSeconds?: string | number | bigint;
  blindSeconds?: string | number | bigint;
  maxDuration?: string | number | bigint;
  maxDurationSeconds?: string | number | bigint;
  deadlineSeconds?: string | number | bigint;
  minVoters?: string | number | bigint;
  maxVoters?: string | number | bigint;
  [key: string]: unknown;
}

export interface CuryoAgentQuestionRequest {
  clientRequestId: string;
  chainId?: number;
  question?: CuryoAgentQuestionItem;
  questions?: CuryoAgentQuestionItem[];
  bounty: CuryoAgentBounty;
  roundConfig?: CuryoAgentRoundConfig;
  walletAddress?: `0x${string}` | string;
  [key: string]: unknown;
}

export interface QuoteQuestionRequest extends CuryoAgentQuestionRequest {}

export interface AskHumansRequest extends CuryoAgentQuestionRequest {
  maxPaymentAmount?: string | number | bigint;
  mode?: "sync" | "async";
  paymentAuthorization?: {
    from?: `0x${string}` | string;
    nonce?: `0x${string}` | string;
    signature?: `0x${string}` | string;
    to?: `0x${string}` | string;
    validAfter?: string | number | bigint;
    validBefore?: string | number | bigint;
    value?: string | number | bigint;
    [key: string]: unknown;
  };
  paymentMode?: "wallet_calls" | "x402_authorization";
  signatureMode?: "agent_signs" | "browser_link";
  transport?: "http" | "mcp";
}

export interface ConfirmAskTransactionsRequest {
  operationKey: `0x${string}` | string;
  transactionHashes: (`0x${string}` | string)[];
}

export interface QuestionStatusLookup {
  operationKey?: `0x${string}` | string;
  chainId?: number;
  clientRequestId?: string;
  walletAddress?: `0x${string}` | string;
}

export interface CreateSigningIntentRequest {
  request: AskHumansRequest;
  ttlMs?: number;
}

export interface SigningIntentLookup {
  intentId: string;
  token: string;
}

export interface PrepareSigningIntentRequest extends SigningIntentLookup {
  walletAddress: `0x${string}` | string;
  paymentAuthorization?: AskHumansRequest["paymentAuthorization"];
}

export interface CompleteSigningIntentRequest extends SigningIntentLookup {
  transactionHashes: (`0x${string}` | string)[];
}

export interface CuryoAgentPayment {
  amount?: string;
  asset?: string;
  bountyAmount?: string;
  decimals?: number;
  spender?: string;
  tokenAddress?: string;
  [key: string]: unknown;
}

export interface CuryoAgentWalletTransactionCall {
  data?: `0x${string}` | string;
  description?: string;
  functionName?: string;
  id?: string;
  phase?: "approve_usdc" | "reserve_submission" | "submit_question" | "submit_x402_question" | string;
  to?: `0x${string}` | string;
  value?: string;
  waitAfterMs?: number;
  [key: string]: unknown;
}

export interface CuryoAgentWalletTransactionPlan {
  calls?: CuryoAgentWalletTransactionCall[];
  requiresOrderedExecution?: boolean;
  [key: string]: unknown;
}

export interface CuryoAgentWalletInfo {
  address?: `0x${string}` | string;
  fundingMode?: "agent_wallet" | "x402_authorization" | string;
  note?: string;
  [key: string]: unknown;
}

export interface CuryoAgentFastLaneGuidance {
  conservativeStartingBountyAtomic?: string;
  estimatedResultAt?: number;
  estimatedTimeToResultSeconds?: number;
  expectedResponse?: {
    healthyTargetVoters?: string;
    likelyOutcome?: "thin" | "healthy" | "broad" | string;
    minimumExpectedVoters?: string;
    [key: string]: unknown;
  };
  guidance?: string[];
  minimumViableQuorum?: string;
  perRequiredSignalUnitAtomic?: string;
  pricingConfidence?: "low" | "medium" | "high" | string;
  recommendedAction?: "start_small" | "raise_before_submit" | "adjust_round_window" | string;
  requiredSignalUnits?: string;
  speed?: "fast" | "standard" | "slow" | string;
  stretchBountyAmountAtomic?: string;
  suggestedBountyAmountAtomic?: string;
  warnings?: string[];
  [key: string]: unknown;
}

export interface CuryoAgentLiveAskGuidance {
  lowResponseRisk?: "low" | "medium" | "high" | string;
  reasonCodes?: string[];
  recommendedAction?: "wait" | "top_up" | "retry_later" | string;
  suggestedTopUpAtomic?: string | null;
  [key: string]: unknown;
}

export interface QuoteQuestionResponse {
  canSubmit?: boolean;
  clientRequestId?: string;
  fastLane?: CuryoAgentFastLaneGuidance;
  operationKey?: `0x${string}` | string;
  payloadHash?: string;
  payment?: CuryoAgentPayment;
  questionCount?: number;
  resolvedCategoryIds?: string[];
  walletPolicyRequired?: boolean;
  [key: string]: unknown;
}

export interface AskHumansResponse {
  clientRequestId?: string;
  operationKey?: `0x${string}` | string;
  contentId?: string | null;
  contentIds?: string[];
  fastLane?: CuryoAgentFastLaneGuidance;
  managedBudget?: JsonRecord | null;
  nextAction?: string | null;
  pollAfterMs?: number | null;
  publicUrl?: string | null;
  ready?: boolean;
  resultTool?: string | null;
  terminal?: boolean;
  status?: string;
  statusTool?: string;
  confirmTool?: string;
  payment?: CuryoAgentPayment;
  paymentMode?: "wallet_calls" | "x402_authorization" | string;
  rewardPoolId?: string | null;
  transactionPlan?: CuryoAgentWalletTransactionPlan;
  transactionHashes?: string[];
  wallet?: CuryoAgentWalletInfo;
  webhook?: JsonRecord | null;
  warnings?: string[];
  x402AuthorizationRequest?: JsonRecord | null;
  [key: string]: unknown;
}

export interface SigningIntentResponse extends AskHumansResponse {
  id: string;
  signingUrl?: string;
  expiresAt: string;
  requestBody?: JsonRecord;
}

export interface CallbackDeliveryStatus {
  attemptCount: number;
  callbackUrl: string;
  deliveredAt?: string | null;
  eventId: string;
  eventType: string;
  lastError?: string | null;
  nextAttemptAt: string;
  status: "pending" | "delivering" | "retrying" | "delivered" | "dead";
  subscriptionId: string;
  [key: string]: unknown;
}

export interface QuestionStatusResponse {
  bounty?: JsonRecord;
  bundleId?: string | null;
  callbackDeliveries?: CallbackDeliveryStatus[];
  chainId?: number;
  clientRequestId?: string;
  contentId?: string | null;
  contentIds?: string[];
  error?: string | null;
  nextAction?: string | null;
  operationKey?: `0x${string}` | string;
  payerAddress?: string;
  payloadHash?: string;
  payment?: CuryoAgentPayment;
  pollAfterMs?: number | null;
  publicUrl?: string | null;
  questionCount?: number;
  ready?: boolean;
  liveAskGuidance?: CuryoAgentLiveAskGuidance | null;
  rewardPoolId?: string | null;
  resultTool?: string | null;
  status: string;
  terminal?: boolean;
  transactionHashes?: string[];
  updatedAt?: string;
  [key: string]: unknown;
}

export type CuryoAgentAnswer =
  | "pending"
  | "proceed"
  | "proceed_with_caution"
  | "revise_and_resubmit"
  | "do_not_proceed"
  | "inconclusive"
  | "failed";

export interface CuryoAgentResult {
  ready: boolean;
  answer?: CuryoAgentAnswer | string;
  status?: string;
  operation?: JsonRecord | null;
  result?: unknown;
  confidence?: {
    level?: "none" | "low" | "medium" | "high" | string;
    score?: number;
    [key: string]: unknown;
  };
  cohortSummary?: JsonRecord | null;
  distribution?: JsonRecord;
  voteCount?: number;
  stakeMass?: JsonRecord;
  rationaleSummary?: string;
  majorObjections?: JsonRecord[];
  featureTest?: JsonRecord | null;
  dissentingView?: string | null;
  liveAskGuidance?: CuryoAgentLiveAskGuidance | null;
  recommendedNextAction?: string;
  publicUrl?: string | null;
  methodology?: JsonRecord;
  limitations?: string[];
  protocolState?: JsonRecord;
  [key: string]: unknown;
}

export interface AgentResultTemplate {
  bundleStrategy?: "independent" | "rank_by_rating" | string;
  id: string;
  description?: string;
  interpretation?: JsonRecord;
  ratingSystem?: string;
  recommendedUse?: string[];
  resultSpecHash?: `0x${string}` | string;
  submissionPattern?: "single_question" | "bundle_member" | string;
  templateInputsExample?: JsonValue;
  templateInputsSchema?: JsonRecord;
  title?: string;
  version: number;
  voteSemantics?: {
    up: string;
    down: string;
  };
  [key: string]: unknown;
}

export interface ListResultTemplatesResponse {
  templates: AgentResultTemplate[];
  [key: string]: unknown;
}

export interface CuryoAgentClient {
  quoteQuestion(params: QuoteQuestionRequest): Promise<QuoteQuestionResponse>;
  askHumans(params: AskHumansRequest): Promise<AskHumansResponse>;
  createSigningIntent(
    params: CreateSigningIntentRequest,
  ): Promise<SigningIntentResponse>;
  getSigningIntent(params: SigningIntentLookup): Promise<SigningIntentResponse>;
  prepareSigningIntent(
    params: PrepareSigningIntentRequest,
  ): Promise<SigningIntentResponse>;
  completeSigningIntent(
    params: CompleteSigningIntentRequest,
  ): Promise<SigningIntentResponse>;
  confirmAskTransactions(
    params: ConfirmAskTransactionsRequest,
  ): Promise<QuestionStatusResponse>;
  getQuestionStatus(
    params: QuestionStatusLookup,
  ): Promise<QuestionStatusResponse>;
  getResult(
    params: QuestionStatusLookup & { contentId?: string | bigint },
  ): Promise<CuryoAgentResult>;
  listResultTemplates(): Promise<ListResultTemplatesResponse>;
}

export interface WebhookVerifierOptions {
  secret: string;
  eventIdHeader?: string;
  signatureHeader?: string;
  timestampHeader?: string;
  toleranceSeconds?: number;
}

export interface VerifyWebhookParams {
  body: string | Uint8Array | ArrayBuffer | JsonValue | JsonRecord;
  headers: Headers | Record<string, string | string[] | undefined | null>;
  now?: Date | number;
}

export interface WebhookVerifier {
  verify(params: VerifyWebhookParams): Promise<boolean>;
  assertValid(params: VerifyWebhookParams): Promise<void>;
}

interface NormalizedAgentConfig {
  agentApiPath: string;
  apiBaseUrl?: string;
  mcpApiUrl?: string;
  mcpAccessToken?: string;
  fetchImpl: CuryoFetch;
  timeoutMs: number;
  mcpProtocolVersion: string;
}

export function createCuryoAgentClient(
  options: CuryoAgentClientOptions = {},
): CuryoAgentClient {
  const config = normalizeAgentConfig(options);

  return {
    quoteQuestion: (params) => quoteQuestion(params, config),
    askHumans: (params) => askHumans(params, config),
    createSigningIntent: (params) => createSigningIntent(params, config),
    getSigningIntent: (params) => getSigningIntent(params, config),
    prepareSigningIntent: (params) => prepareSigningIntent(params, config),
    completeSigningIntent: (params) => completeSigningIntent(params, config),
    confirmAskTransactions: (params) => confirmAskTransactions(params, config),
    getQuestionStatus: (params) => getQuestionStatus(params, config),
    getResult: (params) => getResult(params, config),
    listResultTemplates: () => listResultTemplates(config),
  };
}

export function quoteQuestion(
  params: QuoteQuestionRequest,
  options: CuryoAgentClientOptions = {},
): Promise<QuoteQuestionResponse> {
  const config = normalizeAgentConfig(options);
  if (hasDirectAgentHttp(config)) {
    return requestJson<QuoteQuestionResponse>(config, agentQuoteUrl(config), {
      body: stringifyJson(params),
      headers: jsonAgentHeaders(config),
      method: "POST",
    });
  }

  return callMcpTool<QuoteQuestionResponse>(
    config,
    "curyo_quote_question",
    params,
  );
}

export async function askHumans(
  params: AskHumansRequest,
  options: CuryoAgentClientOptions = {},
): Promise<AskHumansResponse> {
  const config = normalizeAgentConfig(options);
  const { transport, ...body } = params;

  if (
    transport === "http" ||
    (transport !== "mcp" && hasDirectAgentHttp(config))
  ) {
    return requestJson<AskHumansResponse>(config, agentAsksUrl(config), {
      body: stringifyJson(body),
      headers: jsonAgentHeaders(config),
      method: "POST",
    });
  }

  if (transport === "mcp" || config.mcpApiUrl) {
    return callMcpTool<AskHumansResponse>(config, "curyo_ask_humans", body);
  }

  throw new CuryoSdkError(AGENT_AUTH_REQUIRED_MESSAGE);
}

export async function createSigningIntent(
  params: CreateSigningIntentRequest,
  options: CuryoAgentClientOptions = {},
): Promise<SigningIntentResponse> {
  const config = normalizeAgentConfig(options);
  if (!hasDirectAgentHttp(config)) {
    throw new CuryoSdkError("apiBaseUrl is required to create browser signing links");
  }

  return requestJson<SigningIntentResponse>(config, agentSigningIntentsUrl(config), {
    body: stringifyJson(params),
    headers: jsonAgentHeaders(config),
    method: "POST",
  });
}

export async function getSigningIntent(
  params: SigningIntentLookup,
  options: CuryoAgentClientOptions = {},
): Promise<SigningIntentResponse> {
  const config = normalizeAgentConfig(options);
  if (!hasDirectAgentHttp(config)) {
    throw new CuryoSdkError("apiBaseUrl is required to read browser signing links");
  }

  return requestJson<SigningIntentResponse>(config, agentSigningIntentUrl(config, params), {
    headers: agentHeaders(config),
    method: "GET",
  });
}

export async function prepareSigningIntent(
  params: PrepareSigningIntentRequest,
  options: CuryoAgentClientOptions = {},
): Promise<SigningIntentResponse> {
  const config = normalizeAgentConfig(options);
  if (!hasDirectAgentHttp(config)) {
    throw new CuryoSdkError("apiBaseUrl is required to prepare browser signing links");
  }

  return requestJson<SigningIntentResponse>(config, agentSigningIntentActionUrl(config, params, "prepare"), {
    body: stringifyJson({
      paymentAuthorization: params.paymentAuthorization,
      token: params.token,
      walletAddress: params.walletAddress,
    }),
    headers: jsonAgentHeaders(config),
    method: "POST",
  });
}

export async function completeSigningIntent(
  params: CompleteSigningIntentRequest,
  options: CuryoAgentClientOptions = {},
): Promise<SigningIntentResponse> {
  const config = normalizeAgentConfig(options);
  if (!hasDirectAgentHttp(config)) {
    throw new CuryoSdkError("apiBaseUrl is required to complete browser signing links");
  }

  return requestJson<SigningIntentResponse>(config, agentSigningIntentActionUrl(config, params, "complete"), {
    body: stringifyJson({
      token: params.token,
      transactionHashes: params.transactionHashes,
    }),
    headers: jsonAgentHeaders(config),
    method: "POST",
  });
}

export async function confirmAskTransactions(
  params: ConfirmAskTransactionsRequest,
  options: CuryoAgentClientOptions = {},
): Promise<QuestionStatusResponse> {
  const config = normalizeAgentConfig(options);
  if (hasDirectAgentHttp(config)) {
    return requestJson<QuestionStatusResponse>(config, agentConfirmAskUrl(config, params.operationKey), {
      body: stringifyJson({ transactionHashes: params.transactionHashes }),
      headers: jsonAgentHeaders(config),
      method: "POST",
    });
  }

  if (config.mcpApiUrl) {
    return callMcpTool<QuestionStatusResponse>(config, "curyo_confirm_ask_transactions", { ...params });
  }

  throw new CuryoSdkError(AGENT_AUTH_REQUIRED_MESSAGE);
}

export async function getQuestionStatus(
  params: QuestionStatusLookup,
  options: CuryoAgentClientOptions = {},
): Promise<QuestionStatusResponse> {
  const config = normalizeAgentConfig(options);
  if (hasDirectAgentHttp(config)) {
    return requestJson<QuestionStatusResponse>(
      config,
      agentStatusUrl(config, params),
      {
        headers: agentHeaders(config),
        method: "GET",
      },
    );
  }

  if (config.mcpApiUrl) {
    return callMcpTool<QuestionStatusResponse>(
      config,
      "curyo_get_question_status",
      { ...params },
    );
  }

  throw new CuryoSdkError(AGENT_AUTH_REQUIRED_MESSAGE);
}

export async function getResult(
  params: QuestionStatusLookup & { contentId?: string | bigint },
  options: CuryoAgentClientOptions = {},
): Promise<CuryoAgentResult> {
  const config = normalizeAgentConfig(options);
  if (hasDirectAgentHttp(config)) {
    return requestJson<CuryoAgentResult>(
      config,
      agentResultUrl(config, params),
      {
        headers: agentHeaders(config),
        method: "GET",
      },
    );
  }

  if (config.mcpApiUrl) {
    const result = await callMcpTool<unknown>(config, "curyo_get_result", {
      ...params,
      contentId:
        params.contentId === undefined ? undefined : String(params.contentId),
    });
    return parseAgentResult(result);
  }

  throw new CuryoSdkError(AGENT_AUTH_REQUIRED_MESSAGE);
}

export async function listResultTemplates(
  options: CuryoAgentClientOptions = {},
): Promise<ListResultTemplatesResponse> {
  const config = normalizeAgentConfig(options);
  if (hasDirectAgentHttp(config)) {
    return requestJson<ListResultTemplatesResponse>(
      config,
      agentTemplatesUrl(config),
      {
        headers: agentHeaders(config),
        method: "GET",
      },
    );
  }

  return callMcpTool<ListResultTemplatesResponse>(
    config,
    "curyo_list_result_templates",
    {},
  );
}

export function parseAgentResult(value: unknown): CuryoAgentResult {
  const parsed = parseMaybeJson(value);
  const unwrapped = unwrapStructuredContent(parsed);
  if (!isJsonRecord(unwrapped)) {
    throw new CuryoSdkError("Agent result must be a JSON object");
  }

  const ready =
    typeof unwrapped.ready === "boolean"
      ? unwrapped.ready
      : inferResultReady(unwrapped);
  return {
    ...unwrapped,
    ready,
  } as CuryoAgentResult;
}

export function buildWebhookVerifier(
  options: WebhookVerifierOptions,
): WebhookVerifier {
  if (!options.secret) {
    throw new CuryoSdkError("Webhook verifier secret is required");
  }

  const eventIdHeader = (
    options.eventIdHeader ?? "x-curyo-callback-id"
  ).toLowerCase();
  const signatureHeader = (
    options.signatureHeader ?? "x-curyo-callback-signature"
  ).toLowerCase();
  const timestampHeader = (
    options.timestampHeader ?? "x-curyo-callback-timestamp"
  ).toLowerCase();
  const toleranceSeconds = options.toleranceSeconds ?? 300;

  async function verify(params: VerifyWebhookParams): Promise<boolean> {
    const signatureHeaderValue = getHeader(params.headers, signatureHeader);
    if (!signatureHeaderValue) return false;

    const eventId = getHeader(params.headers, eventIdHeader);
    if (!eventId) return false;

    const timestamp = getHeader(params.headers, timestampHeader);
    if (
      !timestamp ||
      (toleranceSeconds >= 0 &&
        !isTimestampFresh(timestamp, toleranceSeconds, params.now))
    ) {
      return false;
    }

    const body = bodyToString(params.body);
    const signedPayload = `v1.${eventId}.${timestamp}.${body}`;
    const expected = await hmacSha256Hex(options.secret, signedPayload);
    return signatureMatches(signatureHeaderValue, expected);
  }

  return {
    verify,
    assertValid: async (params) => {
      if (!(await verify(params))) {
        throw new CuryoSdkError("Invalid Curyo webhook signature");
      }
    },
  };
}

async function callMcpTool<T>(
  config: NormalizedAgentConfig,
  name: string,
  args: JsonRecord,
): Promise<T> {
  if (!config.mcpApiUrl) {
    throw new CuryoSdkError(
      "apiBaseUrl or mcpApiUrl is required for MCP agent operations",
    );
  }

  const id = `curyo-sdk-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const body = {
    id,
    jsonrpc: "2.0",
    method: "tools/call",
    params: {
      arguments: args,
      name,
    },
  };

  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
    "mcp-protocol-version": config.mcpProtocolVersion,
  };
  if (config.mcpAccessToken) {
    headers.authorization = `Bearer ${config.mcpAccessToken}`;
  }

  const rpc = await requestJson<JsonRecord>(config, config.mcpApiUrl, {
    body: stringifyJson(body),
    headers,
    method: "POST",
  });

  if (isJsonRecord(rpc.error)) {
    const message =
      typeof rpc.error.message === "string"
        ? rpc.error.message
        : "Curyo MCP request failed";
    throw new CuryoApiError(message, 400);
  }

  const result = isJsonRecord(rpc.result) ? rpc.result : null;
  const toolResult = isJsonRecord(result?.structuredContent)
    ? result.structuredContent
    : result?.structuredContent;
  if (isJsonRecord(toolResult) && toolResult.isError === true) {
    const message =
      typeof toolResult.message === "string"
        ? toolResult.message
        : "Curyo MCP tool failed";
    throw new CuryoApiError(message, 400);
  }
  if (result?.isError === true) {
    const structured = isJsonRecord(result.structuredContent)
      ? result.structuredContent
      : {};
    const message =
      typeof structured.message === "string"
        ? structured.message
        : "Curyo MCP tool failed";
    throw new CuryoApiError(message, 400);
  }

  return (
    result && "structuredContent" in result
      ? result.structuredContent
      : rpc.result
  ) as T;
}

async function requestJson<T>(
  config: Pick<NormalizedAgentConfig, "fetchImpl" | "timeoutMs">,
  url: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetchWithTimeout(
    config.fetchImpl,
    config.timeoutMs,
    url,
    init,
  );

  const body = await response.text();
  const parsed = body.length === 0 ? null : parseJson(body);

  if (!response.ok) {
    const message =
      isJsonRecord(parsed) && typeof parsed.error === "string"
        ? parsed.error
        : isJsonRecord(parsed) && typeof parsed.message === "string"
          ? parsed.message
          : `Curyo request failed with status ${response.status}`;
    throw new CuryoApiError(message, response.status);
  }

  return parsed as T;
}

async function fetchWithTimeout(
  fetchImpl: CuryoFetch,
  timeoutMs: number,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchImpl(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new CuryoApiError(`Curyo request timed out after ${timeoutMs}ms`, 504);
    }

    const message = error instanceof Error ? error.message : "Unknown fetch error";
    throw new CuryoApiError(`Curyo request failed: ${message}`, 502);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function normalizeAgentConfig(
  options: CuryoAgentClientOptions,
): NormalizedAgentConfig {
  const apiBaseUrl = normalizeUrl(options.apiBaseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const defaultMcpPath = options.mcpAccessToken
    ? DEFAULT_MCP_PATH
    : DEFAULT_PUBLIC_MCP_PATH;
  return {
    agentApiPath: options.agentApiPath ?? DEFAULT_AGENT_API_PATH,
    apiBaseUrl,
    fetchImpl,
    mcpAccessToken: options.mcpAccessToken,
    mcpApiUrl:
      normalizeUrl(options.mcpApiUrl) ??
      (apiBaseUrl
        ? new URL(defaultMcpPath, `${apiBaseUrl}/`).toString()
        : undefined),
    mcpProtocolVersion:
      options.mcpProtocolVersion ?? DEFAULT_MCP_PROTOCOL_VERSION,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
}

function normalizeUrl(value?: string) {
  if (!value) return undefined;

  try {
    return new URL(value).toString().replace(/\/+$/, "");
  } catch {
    throw new CuryoSdkError(`Invalid URL: ${value}`);
  }
}

function agentBaseUrl(config: NormalizedAgentConfig) {
  if (!config.apiBaseUrl) {
    throw new CuryoSdkError(
      "apiBaseUrl is required for direct agent HTTP operations",
    );
  }

  return new URL(
    config.agentApiPath.replace(/\/+$/, ""),
    `${config.apiBaseUrl}/`,
  ).toString();
}

function agentQuoteUrl(config: NormalizedAgentConfig) {
  return new URL("./quote", `${agentBaseUrl(config)}/`).toString();
}

function agentAsksUrl(config: NormalizedAgentConfig) {
  return new URL("./asks", `${agentBaseUrl(config)}/`).toString();
}

function agentSigningIntentsUrl(config: NormalizedAgentConfig) {
  return new URL("./signing-intents", `${agentBaseUrl(config)}/`).toString();
}

function agentSigningIntentUrl(config: NormalizedAgentConfig, params: SigningIntentLookup) {
  if (!params.intentId.trim()) {
    throw new CuryoSdkError("intentId is required");
  }
  if (!params.token.trim()) {
    throw new CuryoSdkError("token is required");
  }
  const url = new URL(`./signing-intents/${params.intentId.trim()}`, `${agentBaseUrl(config)}/`);
  url.searchParams.set("token", params.token);
  return url.toString();
}

function agentSigningIntentActionUrl(
  config: NormalizedAgentConfig,
  params: SigningIntentLookup,
  action: "complete" | "prepare",
) {
  if (!params.intentId.trim()) {
    throw new CuryoSdkError("intentId is required");
  }
  return new URL(`./signing-intents/${params.intentId.trim()}/${action}`, `${agentBaseUrl(config)}/`).toString();
}

function agentConfirmAskUrl(config: NormalizedAgentConfig, operationKey: string) {
  const trimmed = operationKey.trim();
  if (!trimmed) {
    throw new CuryoSdkError("operationKey is required to confirm ask transactions");
  }
  return new URL(`./asks/${trimmed}/confirm`, `${agentBaseUrl(config)}/`).toString();
}

function agentStatusUrl(
  config: NormalizedAgentConfig,
  params: QuestionStatusLookup,
) {
  const operationKey =
    typeof params.operationKey === "string" ? params.operationKey.trim() : "";
  if (operationKey) {
    return new URL(
      `./asks/${operationKey}`,
      `${agentBaseUrl(config)}/`,
    ).toString();
  }

  if (!params.chainId || !params.clientRequestId) {
    throw new CuryoSdkError(
      "Provide operationKey or both chainId and clientRequestId",
    );
  }

  const url = new URL("./asks/by-client-request", `${agentBaseUrl(config)}/`);
  url.searchParams.set("chainId", String(params.chainId));
  url.searchParams.set("clientRequestId", params.clientRequestId);
  if (params.walletAddress) {
    url.searchParams.set("walletAddress", params.walletAddress);
  }
  return url.toString();
}

function agentResultUrl(
  config: NormalizedAgentConfig,
  params: QuestionStatusLookup & { contentId?: string | bigint },
) {
  const contentId =
    params.contentId === undefined ? "" : String(params.contentId).trim();
  if (contentId) {
    return new URL(
      `./results/by-content/${encodeURIComponent(contentId)}`,
      `${agentBaseUrl(config)}/`,
    ).toString();
  }

  const operationKey =
    typeof params.operationKey === "string" ? params.operationKey.trim() : "";
  if (operationKey) {
    return new URL(
      `./results/${operationKey}`,
      `${agentBaseUrl(config)}/`,
    ).toString();
  }

  if (!params.chainId || !params.clientRequestId) {
    throw new CuryoSdkError(
      "Provide contentId, operationKey, or both chainId and clientRequestId",
    );
  }

  const url = new URL(
    "./results/by-client-request",
    `${agentBaseUrl(config)}/`,
  );
  url.searchParams.set("chainId", String(params.chainId));
  url.searchParams.set("clientRequestId", params.clientRequestId);
  if (params.walletAddress) {
    url.searchParams.set("walletAddress", params.walletAddress);
  }
  return url.toString();
}

function agentTemplatesUrl(config: NormalizedAgentConfig) {
  return new URL("./templates", `${agentBaseUrl(config)}/`).toString();
}

function hasDirectAgentHttp(config: NormalizedAgentConfig) {
  return Boolean(config.apiBaseUrl);
}

function agentHeaders(config: NormalizedAgentConfig) {
  const headers: Record<string, string> = {
    accept: "application/json",
  };

  if (config.mcpAccessToken) {
    headers.authorization = `Bearer ${config.mcpAccessToken}`;
  }

  return headers;
}

function jsonAgentHeaders(config: NormalizedAgentConfig) {
  return {
    ...agentHeaders(config),
    "content-type": "application/json",
  };
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown parse error";
    throw new CuryoApiError(`Curyo returned invalid JSON: ${message}`, 502);
  }
}

function stringifyJson(value: unknown) {
  return JSON.stringify(value, (_key, entry) =>
    typeof entry === "bigint" ? entry.toString() : entry,
  );
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return parseJson(value);
}

function unwrapStructuredContent(value: unknown): unknown {
  if (!isJsonRecord(value)) return value;
  if (isJsonRecord(value.structuredContent)) return value.structuredContent;
  if (isJsonRecord(value.result)) {
    if (isJsonRecord(value.result.structuredContent))
      return value.result.structuredContent;
    return value.result;
  }
  if (Array.isArray(value.content)) {
    const textPart = value.content.find(
      (part) =>
        isJsonRecord(part) &&
        part.type === "text" &&
        typeof part.text === "string",
    );
    if (isJsonRecord(textPart) && typeof textPart.text === "string") {
      return parseMaybeJson(textPart.text);
    }
  }
  return value;
}

function inferResultReady(value: JsonRecord): boolean {
  if (isJsonRecord(value.result) && typeof value.result.ready === "boolean")
    return value.result.ready;
  if (value.result === null) return false;
  if (typeof value.answer === "string") return value.answer !== "pending";
  return false;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getHeader(
  headers: Headers | Record<string, string | string[] | undefined | null>,
  name: string,
) {
  if (headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }

  const found = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  )?.[1];
  return Array.isArray(found) ? found.join(",") : (found ?? undefined);
}

function bodyToString(body: VerifyWebhookParams["body"]): string {
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
  return stringifyJson(body);
}

function isTimestampFresh(
  timestamp: string,
  toleranceSeconds: number,
  now: Date | number | undefined,
) {
  const timestampMs = /^\d+$/.test(timestamp)
    ? Number(timestamp) * (timestamp.length <= 10 ? 1000 : 1)
    : Date.parse(timestamp);
  if (!Number.isFinite(timestampMs)) return false;
  const nowMs =
    now instanceof Date
      ? now.getTime()
      : typeof now === "number"
        ? now
        : Date.now();
  return Math.abs(nowMs - timestampMs) <= toleranceSeconds * 1000;
}

async function hmacSha256Hex(secret: string, payload: string) {
  const encoder = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload),
  );
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function signatureMatches(headerValue: string, expectedHex: string) {
  const expected = expectedHex.toLowerCase();
  const candidates = headerValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => value.replace(/^(?:sha256|v1)=/i, "").toLowerCase());

  return candidates.some((candidate) => constantTimeEqual(candidate, expected));
}

function constantTimeEqual(a: string, b: string) {
  if (!/^[a-f0-9]+$/i.test(a) || !/^[a-f0-9]+$/i.test(b)) return false;
  if (a.length !== b.length) return false;

  let mismatch = 0;
  for (let index = 0; index < a.length; index++) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}

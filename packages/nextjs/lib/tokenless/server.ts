import {
  RateLoopSdkError,
  TOKENLESS_SCHEMA_VERSION,
  type TokenlessAskRequest,
  type TokenlessAskResponse,
  type TokenlessEconomics,
  type TokenlessQuestionImagePreviewGrant,
  type TokenlessQuoteRequest,
  type TokenlessQuoteResponse,
  type TokenlessResult,
  type TokenlessWaitResponse,
  buildTokenlessPrivateReviewCommitmentQuestion,
  normalizeTokenlessQuestion,
  normalizeTokenlessQuoteRequest,
  parseTokenlessQuoteResponse,
  parseTokenlessResult,
} from "@rateloop/sdk";
import { and, eq } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { db, dbClient } from "~~/lib/db";
import { tokenlessAgentAsks, tokenlessAgentQuotes } from "~~/lib/db/schema";
import { assertDataIngressPolicy } from "~~/lib/privacy/dataPolicy";

const QUOTE_TTL_MS = 15 * 60_000;
const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
const DEFAULT_WAIT_POLL_INTERVAL_MS = 250;
const MAX_WAIT_TIMEOUT_MS = 60_000;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,160}$/;
const ATOMIC_AMOUNT_PATTERN = /^(0|[1-9]\d*)$/;
const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const PUBLIC_MEDIA_ASSET_ID_PATTERN = /^pqm_[A-Za-z0-9_-]{24,80}$/;
const PUBLIC_MEDIA_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const PUBLIC_MEDIA_PREVIEW_CAPABILITY_PATTERN = /^pqp1_[0-9a-z]{6,12}_[A-Za-z0-9_-]{43}$/;
const AUDIENCE_LABELS = {
  customer_invited: "Customer-invited reviewers",
  rateloop_network: "RateLoop-network reviewers",
  hybrid: "Separate invited and RateLoop-network subpanels",
};

type StoredQuote = {
  quoteId: string;
  requestHash: string;
  requestJson: string;
  responseJson: string;
  ownerPrincipalId: string | null;
  ownerWorkspaceId: string | null;
  ownerApiKeyId: string | null;
  expiresAt: Date;
  createdAt: Date;
};

export type TokenlessQuoteOwner = { kind: "api_key"; apiKeyId: string; workspaceId: string };

type StoredAsk = {
  operationKey: string;
  idempotencyScope: string;
  idempotencyKey: string;
  requestHash: string;
  quoteId: string;
  requestJson: string;
  economicsJson: string;
  status: string;
  verdictStatus: string | null;
  roundId: string | null;
  resultJson: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export class TokenlessServiceError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly status: number;

  constructor(message: string, status: number, code: string, retryable = false) {
    super(message);
    this.name = "TokenlessServiceError";
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableJson(entryValue)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function hashTokenlessQuoteRequest(value: unknown) {
  return hash(parseTokenlessQuoteRequest(value));
}

function parseAtomic(value: unknown, path: string) {
  if (typeof value !== "string" || !ATOMIC_AMOUNT_PATTERN.test(value)) {
    throw new TokenlessServiceError(`${path} must be an unsigned atomic amount string.`, 400, "invalid_quote");
  }
  return BigInt(value);
}

export function parseTokenlessQuoteRequest(value: unknown): TokenlessQuoteRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TokenlessServiceError("Quote body must be an object.", 400, "invalid_quote");
  }
  const request = value as Partial<TokenlessQuoteRequest>;
  let question: TokenlessQuoteRequest["question"];
  try {
    question = normalizeTokenlessQuestion(request.question);
  } catch (error) {
    if (error instanceof RateLoopSdkError) {
      throw new TokenlessServiceError(error.message, 400, "invalid_quote");
    }
    throw error;
  }
  if (!request.audience || !BYTES32_PATTERN.test(request.audience.admissionPolicyHash ?? "")) {
    throw new TokenlessServiceError("audience.admissionPolicyHash must be a bytes32 hex value.", 400, "invalid_quote");
  }
  if (!(request.audience.source in AUDIENCE_LABELS)) {
    throw new TokenlessServiceError("audience.source is unsupported.", 400, "invalid_quote");
  }
  if (
    !Number.isSafeInteger(request.requestedPanelSize) ||
    (request.requestedPanelSize ?? 0) < 3 ||
    (request.requestedPanelSize ?? 0) > 500
  ) {
    throw new TokenlessServiceError("requestedPanelSize must be an integer from 3 to 500.", 400, "invalid_quote");
  }
  if (
    !Number.isSafeInteger(request.responseWindowSeconds) ||
    (request.responseWindowSeconds ?? 0) < 1_200 ||
    (request.responseWindowSeconds ?? 0) > 86_400
  ) {
    throw new TokenlessServiceError(
      "responseWindowSeconds must be an integer from 1200 to 86400.",
      400,
      "invalid_quote",
    );
  }
  if (!request.budget) {
    throw new TokenlessServiceError("budget is required.", 400, "invalid_quote");
  }
  const visibility = request.visibility ?? "private";
  const dataClassification = request.dataClassification ?? "internal";
  if (visibility !== "public" && visibility !== "private") {
    throw new TokenlessServiceError("visibility must be public or private.", 400, "invalid_quote");
  }
  assertDataIngressPolicy({
    classification: dataClassification,
    confirmedNoSensitiveData: request.confirmedNoSensitiveData,
    visibility,
  });
  if (
    dataClassification === "redacted" &&
    (typeof request.redactionSummary !== "string" || request.redactionSummary.trim().length < 10)
  ) {
    throw new TokenlessServiceError(
      "Redacted questions require a redaction summary of at least 10 characters.",
      400,
      "invalid_redaction_summary",
    );
  }
  const bounty = parseAtomic(request.budget.bountyAtomic, "budget.bountyAtomic");
  const attemptReserve = parseAtomic(request.budget.attemptReserveAtomic, "budget.attemptReserveAtomic");
  if (bounty === 0n) {
    throw new TokenlessServiceError("budget.bountyAtomic must be greater than zero.", 400, "invalid_quote");
  }
  if (attemptReserve < BigInt(request.requestedPanelSize ?? 0)) {
    throw new TokenlessServiceError(
      "budget.attemptReserveAtomic must fund a non-zero compensation cap for every accepted rater.",
      400,
      "invalid_quote",
    );
  }
  if (!Number.isSafeInteger(request.budget.feeBps) || request.budget.feeBps < 0 || request.budget.feeBps > 2_000) {
    throw new TokenlessServiceError("budget.feeBps must be between 0 and 2000.", 400, "invalid_quote");
  }
  const normalized = {
    ...request,
    question,
    visibility,
    dataClassification,
    ...(request.redactionSummary === undefined ? {} : { redactionSummary: request.redactionSummary.trim() }),
  } as TokenlessQuoteRequest;
  try {
    const exact = normalizeTokenlessQuoteRequest(normalized);
    if (
      exact.visibility === "private" &&
      (!exact.privateReview ||
        stableJson(exact.question) !== stableJson(buildTokenlessPrivateReviewCommitmentQuestion()))
    ) {
      throw new TokenlessServiceError(
        "Private quotes require commitment-only review artifacts; plaintext private questions are not persisted.",
        409,
        "private_quote_encrypted_artifacts_required",
      );
    }
    return exact;
  } catch (error) {
    if (error instanceof RateLoopSdkError) {
      throw new TokenlessServiceError(error.message, 400, "invalid_quote");
    }
    throw error;
  }
}

function assertPayment(value: unknown): asserts value is TokenlessAskRequest["payment"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TokenlessServiceError("payment must be an object.", 400, "invalid_payment");
  }
  const payment = value as Record<string, unknown>;
  if (payment.mode === "prepaid") {
    if (typeof payment.workspaceId !== "string" || !payment.workspaceId.trim()) {
      throw new TokenlessServiceError("payment.workspaceId is required.", 400, "invalid_payment");
    }
    return;
  }
  if (payment.mode !== "wallet" && payment.mode !== "x402") {
    throw new TokenlessServiceError("payment.mode is unsupported.", 400, "invalid_payment");
  }
  if (typeof payment.payerAddress !== "string" || !EVM_ADDRESS_PATTERN.test(payment.payerAddress)) {
    throw new TokenlessServiceError("payment.payerAddress must be an EVM address.", 400, "invalid_payment");
  }
  if (
    payment.mode === "x402" &&
    payment.authorization !== undefined &&
    (payment.authorization === null ||
      typeof payment.authorization !== "object" ||
      Array.isArray(payment.authorization) ||
      Object.keys(payment.authorization).length === 0)
  ) {
    throw new TokenlessServiceError(
      "payment.authorization must be a non-empty object when provided.",
      400,
      "invalid_payment",
    );
  }
}

export function parseTokenlessAskRequest(value: unknown, idempotencyHeader: string | null): TokenlessAskRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TokenlessServiceError("Ask body must be an object.", 400, "invalid_ask");
  }
  const request = value as Partial<TokenlessAskRequest>;
  if (!request.idempotencyKey || !IDEMPOTENCY_KEY_PATTERN.test(request.idempotencyKey)) {
    throw new TokenlessServiceError("A valid idempotencyKey is required.", 400, "invalid_idempotency_key");
  }
  if (idempotencyHeader !== request.idempotencyKey) {
    throw new TokenlessServiceError("Idempotency-Key header must match the request body.", 400, "idempotency_mismatch");
  }
  if (!request.quoteId?.trim() || !request.payment) {
    throw new TokenlessServiceError("quoteId and payment are required.", 400, "invalid_ask");
  }
  if ("webhook" in value) {
    throw new TokenlessServiceError(
      "Result webhooks are not supported. Use wait and result instead.",
      400,
      "webhook_unsupported",
    );
  }
  assertPayment(request.payment);
  return {
    idempotencyKey: request.idempotencyKey,
    payment: request.payment,
    quoteId: request.quoteId,
  };
}

export function parseTokenlessAskMediaPreviewGrants(value: unknown): TokenlessQuestionImagePreviewGrant[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const raw = (value as Record<string, unknown>).mediaPreviews;
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 4) {
    throw new TokenlessServiceError(
      "mediaPreviews must contain one exact grant per staged image.",
      400,
      "invalid_media_preview_capability",
    );
  }
  const seen = new Set<string>();
  return raw.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new TokenlessServiceError(
        "Each media preview grant must be an object.",
        400,
        "invalid_media_preview_capability",
      );
    }
    const grant = item as Record<string, unknown>;
    if (
      Object.keys(grant).some(key => !["assetId", "digest", "previewCapability"].includes(key)) ||
      typeof grant.assetId !== "string" ||
      !PUBLIC_MEDIA_ASSET_ID_PATTERN.test(grant.assetId) ||
      seen.has(grant.assetId) ||
      typeof grant.digest !== "string" ||
      !PUBLIC_MEDIA_DIGEST_PATTERN.test(grant.digest) ||
      typeof grant.previewCapability !== "string" ||
      !PUBLIC_MEDIA_PREVIEW_CAPABILITY_PATTERN.test(grant.previewCapability)
    ) {
      throw new TokenlessServiceError(
        "A media preview grant is malformed or duplicated.",
        400,
        "invalid_media_preview_capability",
      );
    }
    seen.add(grant.assetId);
    return {
      assetId: grant.assetId,
      digest: grant.digest as `sha256:${string}`,
      previewCapability: grant.previewCapability,
    };
  });
}

export async function preflightTokenlessAskIdempotency(
  value: unknown,
  idempotencyHeader: string | null,
  idempotencyScope = "legacy:global",
): Promise<TokenlessAskRequest> {
  const request = parseTokenlessAskRequest(value, idempotencyHeader);
  const existing = await readAskByIdempotency(idempotencyScope, request.idempotencyKey);
  if (existing && existing.requestHash !== hash(request)) {
    throw new TokenlessServiceError(
      "This idempotency key was already used with a different ask.",
      409,
      "idempotency_conflict",
    );
  }
  return request;
}

function buildEconomics(request: TokenlessQuoteRequest): TokenlessEconomics {
  const bounty = parseAtomic(request.budget.bountyAtomic, "budget.bountyAtomic");
  const reserve = parseAtomic(request.budget.attemptReserveAtomic, "budget.attemptReserveAtomic");
  const fee = (bounty * BigInt(request.budget.feeBps)) / 10_000n;
  return {
    asset: "USDC",
    decimals: 6,
    bounty: { fundedAtomic: bounty.toString(), paidAtomic: "0", refundedAtomic: "0" },
    fee: { bps: request.budget.feeBps, fundedAtomic: fee.toString(), paidAtomic: "0", refundedAtomic: "0" },
    attemptReserve: { compensatedAtomic: "0", fundedAtomic: reserve.toString(), refundedAtomic: "0" },
    refund: { attemptReserveAtomic: "0", bountyAtomic: "0", feeAtomic: "0", totalAtomic: "0" },
    compensation: {
      perAcceptedRevealCapAtomic: (reserve / BigInt(request.requestedPanelSize)).toString(),
      recipientCount: 0,
      totalAtomic: "0",
    },
    totalFundedAtomic: (bounty + fee + reserve).toString(),
  };
}

async function persistQuote(row: StoredQuote) {
  await db.insert(tokenlessAgentQuotes).values(row);
}

async function readQuote(quoteId: string): Promise<StoredQuote | null> {
  const [row] = await db.select().from(tokenlessAgentQuotes).where(eq(tokenlessAgentQuotes.quoteId, quoteId)).limit(1);
  return row ?? null;
}

async function readAskByOperation(operationKey: string): Promise<StoredAsk | null> {
  const [row] = await db
    .select()
    .from(tokenlessAgentAsks)
    .where(eq(tokenlessAgentAsks.operationKey, operationKey))
    .limit(1);
  return row ?? null;
}

async function readAskByIdempotency(idempotencyScope: string, idempotencyKey: string): Promise<StoredAsk | null> {
  const [row] = await db
    .select()
    .from(tokenlessAgentAsks)
    .where(
      and(
        eq(tokenlessAgentAsks.idempotencyScope, idempotencyScope),
        eq(tokenlessAgentAsks.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getTokenlessAskReplay(idempotencyScope: string, idempotencyKey: string) {
  if (!idempotencyScope.trim() || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    throw new TokenlessServiceError("A valid scoped idempotency key is required.", 400, "invalid_idempotency_key");
  }
  const ask = await readAskByIdempotency(idempotencyScope, idempotencyKey);
  if (!ask) return null;
  const quote = await readQuote(ask.quoteId);
  if (!quote) throw new TokenlessServiceError("Ask quote not found.", 409, "invalid_quote");
  return {
    request: parseTokenlessAskRequest(JSON.parse(ask.requestJson), idempotencyKey),
    quoteRequestHash: quote.requestHash,
  };
}

async function persistAsk(row: StoredAsk) {
  await db
    .insert(tokenlessAgentAsks)
    .values(row)
    .onConflictDoNothing({ target: [tokenlessAgentAsks.idempotencyScope, tokenlessAgentAsks.idempotencyKey] });
}

async function createQuote(
  value: unknown,
  owner: TokenlessQuoteOwner | undefined,
  allowInternalPrivateReview: boolean,
): Promise<TokenlessQuoteResponse> {
  const request = parseTokenlessQuoteRequest(value);
  if (request.visibility === "private" && !allowInternalPrivateReview) {
    throw new TokenlessServiceError(
      "Private quotes are created only by the internal encrypted-review workflow.",
      409,
      "private_quote_internal_only",
    );
  }
  if (request.visibility === "private" && (!owner || owner.kind !== "api_key")) {
    throw new TokenlessServiceError(
      "Internal private-review quotes require an exact workspace API-key owner.",
      403,
      "private_quote_owner_required",
    );
  }
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + QUOTE_TTL_MS);
  const requestHash = hash(request);
  const quoteId = `qte_${randomUUID().replaceAll("-", "")}`;
  const response = parseTokenlessQuoteResponse({
    schemaVersion: TOKENLESS_SCHEMA_VERSION,
    quoteId,
    expiresAt: expiresAt.toISOString(),
    economics: buildEconomics(request),
    audience: {
      admissionPolicyHash: request.audience.admissionPolicyHash,
      label: AUDIENCE_LABELS[request.audience.source],
      source: request.audience.source,
    },
    panel: {
      minimumReveals: Math.max(3, Math.ceil(request.requestedPanelSize * 0.8)),
      requestedSize: request.requestedPanelSize,
    },
    responseWindowSeconds: request.responseWindowSeconds,
    requestProfile: request.requestProfile ?? null,
    reviewEconomics: request.reviewEconomics ?? null,
    slo: {
      estimatedSeconds:
        request.audience.source === "rateloop_network" || request.audience.source === "hybrid" ? 3600 : 1800,
    },
  });
  await persistQuote({
    quoteId,
    requestHash,
    requestJson: stableJson(request),
    responseJson: JSON.stringify(response),
    ownerPrincipalId: null,
    ownerWorkspaceId: request.visibility === "private" ? (owner?.workspaceId ?? null) : null,
    ownerApiKeyId: request.visibility === "private" ? (owner?.apiKeyId ?? null) : null,
    expiresAt,
    createdAt,
  });
  return response;
}

export async function createTokenlessQuote(value: unknown): Promise<TokenlessQuoteResponse> {
  return createQuote(value, undefined, false);
}

/** Narrow internal entry point used only after the paid private-review operation has frozen exact artifacts. */
export async function createInternalPrivateReviewQuote(
  value: unknown,
  owner: TokenlessQuoteOwner,
): Promise<TokenlessQuoteResponse> {
  return createQuote(value, owner, true);
}

export async function sweepExpiredTokenlessQuotes(input: { now?: Date; limit?: number } = {}) {
  const now = input.now ?? new Date();
  const limit = input.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new Error("Expired quote sweep limit must be an integer from 1 to 500.");
  }
  const expired = await dbClient.execute({
    sql: `SELECT DISTINCT q.quote_id, q.expires_at
          FROM tokenless_agent_quotes q
          LEFT JOIN tokenless_agent_asks a ON a.quote_id = q.quote_id
          LEFT JOIN tokenless_paid_assignment_operations paid ON paid.quote_id = q.quote_id
          WHERE q.expires_at <= ?
            AND a.quote_id IS NULL
            AND paid.quote_id IS NULL
          ORDER BY q.expires_at ASC
          LIMIT ?`,
    args: [now, limit],
  });
  let deleted = 0;
  for (const row of expired.rows) {
    const quoteId = typeof row.quote_id === "string" ? row.quote_id : null;
    if (!quoteId) continue;
    const result = await dbClient.execute({
      sql: `DELETE FROM tokenless_agent_quotes
            WHERE quote_id = ? AND expires_at <= ?
              AND quote_id NOT IN (
                SELECT quote_id FROM tokenless_agent_asks WHERE quote_id = ?
              )
              AND quote_id NOT IN (
                SELECT quote_id FROM tokenless_paid_assignment_operations WHERE quote_id = ?
              )`,
      args: [quoteId, now, quoteId, quoteId],
    });
    deleted += result.rowCount ?? 0;
  }
  return { deleted, scanned: expired.rows.length };
}

const OPERATION_WAIT_TTL_MS = 24 * 60 * 60_000;

function continuation(operationKey: string, appOrigin: string, updatedAt: Date) {
  return {
    cursor: `${updatedAt.getTime()}`,
    expiresAt: new Date(updatedAt.getTime() + OPERATION_WAIT_TTL_MS).toISOString(),
    pollUrl: `${appOrigin}/api/agent/v1/asks/${encodeURIComponent(operationKey)}/wait`,
    retryAfterMs: 1_000,
  };
}

function operationWaitExpiresAt(updatedAt: Date) {
  return updatedAt.getTime() + OPERATION_WAIT_TTL_MS;
}

async function askCommitDeadline(ask: StoredAsk) {
  if (ask.roundId === null) return null;
  const result = await dbClient.execute({
    sql: "SELECT round_terms_json FROM tokenless_chain_executions WHERE operation_key = ? LIMIT 1",
    args: [ask.operationKey],
  });
  const rawTerms = result.rows[0]?.round_terms_json;
  if (typeof rawTerms !== "string") {
    throw new TokenlessServiceError("The ask has no frozen round deadline.", 409, "invalid_round_terms");
  }
  const terms = JSON.parse(rawTerms) as { commitDeadline?: unknown };
  if (typeof terms.commitDeadline !== "string" || !ATOMIC_AMOUNT_PATTERN.test(terms.commitDeadline)) {
    throw new TokenlessServiceError("The ask has an invalid frozen round deadline.", 409, "invalid_round_terms");
  }
  const milliseconds = Number(BigInt(terms.commitDeadline) * 1_000n);
  const deadline = new Date(milliseconds);
  if (!Number.isSafeInteger(milliseconds) || !Number.isFinite(deadline.getTime())) {
    throw new TokenlessServiceError("The ask has an invalid frozen round deadline.", 409, "invalid_round_terms");
  }
  return deadline.toISOString();
}

async function askResponse(
  ask: StoredAsk,
  quote: TokenlessQuoteResponse,
  appOrigin: string,
): Promise<TokenlessAskResponse> {
  return {
    schemaVersion: TOKENLESS_SCHEMA_VERSION,
    idempotencyKey: ask.idempotencyKey,
    operationKey: ask.operationKey,
    roundId: ask.roundId,
    status: ask.status as TokenlessAskResponse["status"],
    responseWindowSeconds: quote.responseWindowSeconds,
    commitDeadline: await askCommitDeadline(ask),
    requestProfile: quote.requestProfile,
    reviewEconomics: quote.reviewEconomics,
    continuation: continuation(ask.operationKey, appOrigin, ask.updatedAt),
  };
}

export async function createTokenlessAsk(
  value: unknown,
  idempotencyHeader: string | null,
  appOrigin: string,
  idempotencyScope = "legacy:global",
): Promise<TokenlessAskResponse> {
  const request = parseTokenlessAskRequest(value, idempotencyHeader);

  const requestHash = hash(request);
  const existing = await readAskByIdempotency(idempotencyScope, request.idempotencyKey);
  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new TokenlessServiceError(
        "This idempotency key was already used with a different ask.",
        409,
        "idempotency_conflict",
      );
    }
    const existingQuote = await readQuote(existing.quoteId);
    if (!existingQuote) throw new TokenlessServiceError("Ask quote not found.", 409, "invalid_quote");
    return askResponse(existing, parseTokenlessQuoteResponse(JSON.parse(existingQuote.responseJson)), appOrigin);
  }

  const storedQuote = await readQuote(request.quoteId);
  if (!storedQuote || storedQuote.expiresAt.getTime() <= Date.now()) {
    throw new TokenlessServiceError("Quote is missing or expired.", 410, "quote_expired");
  }
  const quote = parseTokenlessQuoteResponse(JSON.parse(storedQuote.responseJson));
  const now = new Date();
  const operationKey = `op_${randomUUID().replaceAll("-", "")}`;
  const baseRow = {
    operationKey,
    idempotencyScope,
    idempotencyKey: request.idempotencyKey,
    requestHash,
    quoteId: request.quoteId,
    requestJson: stableJson(request),
    economicsJson: JSON.stringify(quote.economics),
    status: "awaiting_payment",
    verdictStatus: null,
    roundId: null,
    resultJson: null,
    createdAt: now,
    updatedAt: now,
  } satisfies StoredAsk;
  await persistAsk(baseRow);
  const persisted = await readAskByIdempotency(idempotencyScope, request.idempotencyKey);
  if (!persisted) {
    throw new TokenlessServiceError("Ask could not be stored.", 500, "ask_persistence_failed");
  }
  if (persisted.requestHash !== requestHash) {
    throw new TokenlessServiceError(
      "This idempotency key was already used with a different ask.",
      409,
      "idempotency_conflict",
    );
  }

  return askResponse(persisted, quote, appOrigin);
}

export async function waitForTokenlessAsk(
  operationKey: string,
  appOrigin: string,
  options: {
    cursor?: string;
    pollIntervalMs?: number;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {},
): Promise<TokenlessWaitResponse> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_WAIT_POLL_INTERVAL_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_WAIT_TIMEOUT_MS) {
    throw new TokenlessServiceError("timeoutMs must be between 1 and 60000.", 400, "invalid_wait_timeout");
  }
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 1 || pollIntervalMs > MAX_WAIT_TIMEOUT_MS) {
    throw new TokenlessServiceError("pollIntervalMs must be between 1 and 60000.", 400, "invalid_wait_timeout");
  }
  const cursor = options.cursor?.trim();
  if (cursor && (!/^\d{1,16}$/.test(cursor) || !Number.isSafeInteger(Number(cursor)))) {
    throw new TokenlessServiceError("cursor is invalid.", 400, "invalid_wait_cursor");
  }
  const knownUpdatedAt = cursor ? Number(cursor) : null;
  const deadline = Date.now() + timeoutMs;
  let ask: StoredAsk;

  while (true) {
    const current = await readAskByOperation(operationKey);
    if (!current) throw new TokenlessServiceError("Ask not found.", 404, "ask_not_found");
    ask = current;
    if (ask.status === "rejected") {
      throw new TokenlessServiceError("The question did not pass pre-round moderation.", 410, "content_rejected");
    }
    if (ask.resultJson) {
      return {
        schemaVersion: TOKENLESS_SCHEMA_VERSION,
        operationKey,
        status: "ready",
        verdictStatus: parseTokenlessResult(JSON.parse(ask.resultJson)).verdictStatus,
        continuation: null,
      };
    }
    if (Date.now() >= operationWaitExpiresAt(ask.updatedAt)) {
      throw new TokenlessServiceError("The authenticated result wait window expired.", 410, "operation_wait_expired");
    }
    if (knownUpdatedAt !== null && ask.updatedAt.getTime() > knownUpdatedAt) break;

    const remainingMs = Math.min(deadline - Date.now(), operationWaitExpiresAt(ask.updatedAt) - Date.now());
    if (remainingMs <= 0) break;
    if (options.signal?.aborted) {
      throw new TokenlessServiceError("Wait request was cancelled.", 499, "wait_cancelled", true);
    }
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => options.signal?.removeEventListener("abort", abort);
      const abort = () => {
        clearTimeout(timer);
        cleanup();
        reject(new TokenlessServiceError("Wait request was cancelled.", 499, "wait_cancelled", true));
      };
      const timer = setTimeout(
        () => {
          cleanup();
          resolve();
        },
        Math.min(pollIntervalMs, remainingMs),
      );
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) abort();
    });
  }

  if (Date.now() >= operationWaitExpiresAt(ask.updatedAt)) {
    throw new TokenlessServiceError("The authenticated result wait window expired.", 410, "operation_wait_expired");
  }

  return {
    schemaVersion: TOKENLESS_SCHEMA_VERSION,
    operationKey,
    status: "pending",
    verdictStatus: null,
    continuation: continuation(operationKey, appOrigin, ask.updatedAt),
  };
}

export async function getTokenlessAskByIdempotencyKey(idempotencyKey: string) {
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    throw new TokenlessServiceError("A valid idempotencyKey is required.", 400, "invalid_idempotency_key");
  }
  const asks = await db
    .select()
    .from(tokenlessAgentAsks)
    .where(eq(tokenlessAgentAsks.idempotencyKey, idempotencyKey))
    .limit(2);
  if (asks.length > 1) {
    throw new TokenlessServiceError("Ask lookup is ambiguous.", 409, "ambiguous_idempotency_key");
  }
  const [ask] = asks;
  if (!ask) return null;
  return {
    operationKey: ask.operationKey,
    result: ask.resultJson ? parseTokenlessResult(JSON.parse(ask.resultJson)) : null,
    roundId: ask.roundId,
    status: ask.status,
    updatedAt: ask.updatedAt.toISOString(),
    verdictStatus: ask.verdictStatus,
  };
}

export async function getTokenlessResult(operationKey: string): Promise<TokenlessResult> {
  const ask = await readAskByOperation(operationKey);
  if (!ask) throw new TokenlessServiceError("Ask not found.", 404, "ask_not_found");
  if (!ask.resultJson) {
    throw new TokenlessServiceError("Result is not ready.", 409, "result_not_ready", true);
  }
  return parseTokenlessResult(JSON.parse(ask.resultJson));
}

export function tokenlessErrorResponse(error: unknown) {
  if (error instanceof TokenlessServiceError) {
    return {
      body: { code: error.code, message: error.message, retryable: error.retryable },
      status: error.status,
    };
  }
  console.error("[tokenless-api] unexpected error", error);
  return {
    body: { code: "internal_error", message: "Tokenless API request failed.", retryable: false },
    status: 500,
  };
}

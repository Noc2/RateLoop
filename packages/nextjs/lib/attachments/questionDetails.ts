import { createHash } from "crypto";
import { and, eq, isNull, or } from "drizzle-orm";
import "server-only";
import {
  MAX_QUESTION_DETAILS_TEXT_BYTES,
  getQuestionDetailsTextSizeBytes,
  normalizeQuestionDetailsText,
  questionDetailsHashInput,
} from "~~/lib/attachments/questionDetails.shared";
import { assertGatedAttachmentSchemaReady } from "~~/lib/attachments/uploadErrors";
import { db, dbPool } from "~~/lib/db";
import { type QuestionDetails, questionDetails } from "~~/lib/db/schema";
import { getTrustedRateLoopAppUrl } from "~~/lib/env/server";
import { isValidWalletAddress, normalizeWalletAddress } from "~~/lib/watchlist/contentWatch";
import { isLocalE2EProductionBuildEnabled } from "~~/utils/env/e2eProduction";

const QUESTION_DETAILS_ROUTE_PREFIX = "/api/attachments/details";
const DEFAULT_DETAILS_TEXT_PREVIEW_LENGTH = 600;
const OPENAI_MODERATION_MODEL = "omni-moderation-latest";
const MODERATION_CHUNK_MAX_CHARS = 10_000;
const OPENAI_MODERATION_MAX_ATTEMPTS = 2;
const OPENAI_MODERATION_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_QUESTION_DETAILS_ORPHAN_SWEEP_LIMIT = 100;
const DEFAULT_UNATTACHED_QUESTION_DETAILS_ORPHAN_TTL_MS = 24 * 60 * 60 * 1000;
const QUESTION_DETAILS_ID_PATTERN = /^det_[A-Za-z0-9_-]{16,80}$/;
const PRODUCTION_QUESTION_DETAILS_ORIGINS = ["https://rateloop.ai", "https://www.rateloop.ai"];
const QUESTION_DETAILS_PUBLIC_URL_ERROR =
  "Question Details require APP_URL or NEXT_PUBLIC_APP_URL to be a public HTTPS origin before on-chain submission. Set one to your hosted RateLoop URL, or leave Details empty while submitting from localhost.";
const BLOCKED_MODERATION_CATEGORIES = new Set([
  "sexual/minors",
  "sexual",
  "violence/graphic",
  "self-harm/instructions",
  "hate/threatening",
  "harassment/threatening",
  "illicit/violent",
]);

type QuestionDetailsStatus = "approved" | "blocked" | "failed" | "deleted";

type QuestionDetailsDeploymentScope = {
  chainId?: number | null;
  contentRegistryAddress?: string | null;
  deploymentKey?: string | null;
};

function questionDetailsSameDeploymentScopePredicate(scope: QuestionDetailsDeploymentScope) {
  return and(
    scope.deploymentKey
      ? eq(questionDetails.deploymentKey, scope.deploymentKey)
      : isNull(questionDetails.deploymentKey),
    scope.chainId === undefined || scope.chainId === null
      ? isNull(questionDetails.chainId)
      : eq(questionDetails.chainId, scope.chainId),
    scope.contentRegistryAddress
      ? eq(questionDetails.contentRegistryAddress, scope.contentRegistryAddress)
      : isNull(questionDetails.contentRegistryAddress),
  );
}

type QuestionDetailsUploaderIdentity =
  | {
      kind: "wallet";
      ownerWalletAddress: `0x${string}`;
      agentId?: null;
    }
  | {
      kind: "agent";
      ownerWalletAddress: string | null;
      agentId: string;
    };

type CreateQuestionDetailsFromTextParams = {
  clientRequestId?: string | null;
  detailsId: string;
  requestUrl: string;
  requiresGatedAccess?: boolean;
  sha256: string;
  sizeBytes: number;
  text: string;
  uploader: QuestionDetailsUploaderIdentity;
};

type ModerationDecision = {
  provider: string;
  result: unknown;
  status: "approved" | "blocked" | "review_required";
};

type OpenAiModerationResult = {
  categories?: Record<string, boolean>;
  flagged?: boolean;
};

type OpenAiModerationResponse = {
  results?: OpenAiModerationResult[];
};

type QuestionDetailsUploadResult = {
  detailsHash: `0x${string}` | null;
  detailsId: string;
  detailsUrl: string | null;
  error: string | null;
  moderationStatus: string;
  nextAction: string;
  preview: string | null;
  status: QuestionDetailsStatus;
};

function nowDate() {
  return new Date();
}

export function isQuestionDetailsId(value: string) {
  return QUESTION_DETAILS_ID_PATTERN.test(value);
}

function getQuestionDetailsPath(detailsId: string) {
  return `${QUESTION_DETAILS_ROUTE_PREFIX}/${detailsId}`;
}

function getConfiguredQuestionDetailsBaseUrl() {
  return getTrustedRateLoopAppUrl() ?? (process.env.NODE_ENV === "production" ? "https://www.rateloop.ai" : null);
}

export function getQuestionDetailsUrl(requestUrl: string, detailsId: string) {
  return new URL(getQuestionDetailsPath(detailsId), getConfiguredQuestionDetailsBaseUrl() ?? requestUrl).toString();
}

function isLocalhostDetailsHostname(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

function shouldAllowLocalQuestionDetailsUrls() {
  return process.env.NODE_ENV !== "production" || isLocalE2EProductionBuildEnabled();
}

function isPublicHttpsQuestionDetailsUrl(value: string) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return false;

    const hostname = parsed.hostname.toLowerCase();
    if (
      isLocalhostDetailsHostname(hostname) ||
      !hostname.includes(".") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal") ||
      /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) ||
      hostname.startsWith("[") ||
      hostname.includes(":")
    ) {
      return false;
    }

    const urlBytes = value;
    if (urlBytes.length === 0 || urlBytes.length > 2048) return false;
    for (let index = 0; index < urlBytes.length; index += 1) {
      const code = urlBytes.charCodeAt(index);
      if (code < 0x21 || code > 0x7e) return false;
      if (urlBytes[index] === "\\" || urlBytes[index] === "@") return false;
    }

    return true;
  } catch {
    return false;
  }
}

function isPublishableQuestionDetailsUrl(value: string) {
  if (isPublicHttpsQuestionDetailsUrl(value)) return true;
  if (!isLocalE2EProductionBuildEnabled()) return false;

  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      !parsed.username &&
      !parsed.password &&
      isLocalhostDetailsHostname(parsed.hostname.toLowerCase()) &&
      /^\/api\/attachments\/details\/det_[A-Za-z0-9_-]{16,80}$/.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

function getAllowedQuestionDetailsOrigins() {
  const origins = new Set(PRODUCTION_QUESTION_DETAILS_ORIGINS);
  const configuredAppUrl = getConfiguredQuestionDetailsBaseUrl();
  if (configuredAppUrl) {
    origins.add(new URL(configuredAppUrl).origin);
  }

  return origins;
}

function isLocalQuestionDetailsOrigin(parsed: URL) {
  return (
    shouldAllowLocalQuestionDetailsUrls() &&
    (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]")
  );
}

function isAllowedQuestionDetailsOrigin(parsed: URL) {
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  return getAllowedQuestionDetailsOrigins().has(parsed.origin) || isLocalQuestionDetailsOrigin(parsed);
}

export function parseQuestionDetailsIdFromDetailsUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) return null;
    if (!isAllowedQuestionDetailsOrigin(parsed)) return null;
    const match = parsed.pathname.match(/^\/api\/attachments\/details\/(det_[A-Za-z0-9_-]{16,80})$/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export async function getQuestionDetails(id: string): Promise<QuestionDetails | null> {
  const [details] = await db.select().from(questionDetails).where(eq(questionDetails.id, id)).limit(1);
  return details ?? null;
}

function questionDetailsSha256Hex(params: {
  detailsId: string;
  normalizedText: string;
  requiresGatedAccess?: boolean;
}) {
  return createHash("sha256").update(questionDetailsHashInput(params), "utf8").digest("hex");
}

function assertSupportedDetailsInput(params: {
  detailsId: string;
  normalizedText: string;
  requiresGatedAccess?: boolean;
  sha256: string;
  sizeBytes: number;
}) {
  const sizeBytes = getQuestionDetailsTextSizeBytes(params.normalizedText);
  if (!Number.isSafeInteger(params.sizeBytes) || params.sizeBytes <= 0) {
    throw new Error("Details size is invalid.");
  }
  if (params.sizeBytes > MAX_QUESTION_DETAILS_TEXT_BYTES || sizeBytes > MAX_QUESTION_DETAILS_TEXT_BYTES) {
    throw new Error("Details are too large.");
  }
  if (sizeBytes !== params.sizeBytes) {
    throw new Error("Details size does not match the signed metadata.");
  }

  const actualSha256 = questionDetailsSha256Hex({
    detailsId: params.detailsId,
    normalizedText: params.normalizedText,
    requiresGatedAccess: params.requiresGatedAccess,
  });
  if (actualSha256 !== params.sha256) {
    throw new Error("Details hash does not match the signed metadata.");
  }
}

function hasOpenAiModerationKey() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

function isDevelopmentModerationExplicitlyDisabled() {
  return shouldAllowLocalQuestionDetailsUrls() && process.env.RATELOOP_QUESTION_DETAILS_MODERATION_MODE === "disabled";
}

function isDevModerationSkipAllowed() {
  return shouldAllowLocalQuestionDetailsUrls() && !hasOpenAiModerationKey();
}

function textChunks(text: string) {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += MODERATION_CHUNK_MAX_CHARS) {
    chunks.push(text.slice(index, index + MODERATION_CHUNK_MAX_CHARS));
  }
  return chunks;
}

function isRetryableModerationStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

async function fetchOpenAiModerationChunk(params: {
  apiKey: string;
  chunk: string;
}): Promise<{ ok: true; result: OpenAiModerationResult } | { ok: false; result: unknown }> {
  let lastFetchError: unknown = null;

  for (let attempt = 1; attempt <= OPENAI_MODERATION_MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch("https://api.openai.com/v1/moderations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${params.apiKey}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(OPENAI_MODERATION_REQUEST_TIMEOUT_MS),
        body: JSON.stringify({
          model: OPENAI_MODERATION_MODEL,
          input: params.chunk,
        }),
      });

      const result = (await response.json().catch(() => null)) as OpenAiModerationResponse | null;
      if (response.ok) {
        return { ok: true, result: result?.results?.[0] ?? {} };
      }

      const retryable = isRetryableModerationStatus(response.status);
      if (attempt < OPENAI_MODERATION_MAX_ATTEMPTS && retryable) continue;

      return {
        ok: false,
        result: result ?? {
          attempts: attempt,
          error: `OpenAI moderation failed with ${response.status}`,
          retryable,
          status: response.status,
        },
      };
    } catch (error) {
      lastFetchError = error;
      if (attempt < OPENAI_MODERATION_MAX_ATTEMPTS) continue;
    }
  }

  return {
    ok: false,
    result: {
      attempts: OPENAI_MODERATION_MAX_ATTEMPTS,
      error: "OpenAI moderation request failed.",
      lastError: lastFetchError instanceof Error ? lastFetchError.message : "Unknown error",
      timeoutMs: OPENAI_MODERATION_REQUEST_TIMEOUT_MS,
    },
  };
}

async function moderateQuestionDetailsText(text: string): Promise<ModerationDecision> {
  const chunks = textChunks(text);
  if (isDevelopmentModerationExplicitlyDisabled()) {
    return {
      provider: "disabled",
      status: "approved",
      result: { chunkCount: chunks.length, skipped: true, reason: "explicitly_disabled" },
    };
  }
  if (isDevModerationSkipAllowed()) {
    return {
      provider: "dev-skip",
      status: "approved",
      result: { chunkCount: chunks.length, skipped: true, reason: "missing_dev_key" },
    };
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return { provider: "openai", status: "review_required", result: { error: "OPENAI_API_KEY is not configured" } };
  }

  const results: OpenAiModerationResult[] = [];

  for (const chunk of chunks) {
    const moderation = await fetchOpenAiModerationChunk({ apiKey, chunk });
    if (!moderation.ok) {
      return {
        provider: "openai",
        status: "review_required",
        result: moderation.result,
      };
    }

    results.push(moderation.result);
  }

  const flagged = results.some(result => Boolean(result.flagged));
  const blockedCategories = [
    ...new Set(
      results.flatMap(result =>
        Object.entries(result.categories ?? {})
          .filter(([category, flagged]) => flagged && BLOCKED_MODERATION_CATEGORIES.has(category))
          .map(([category]) => category),
      ),
    ),
  ];

  return {
    provider: "openai",
    status: flagged || blockedCategories.length > 0 ? "blocked" : "approved",
    result: {
      blockedCategories,
      chunkCount: chunks.length,
      flagged,
    },
  };
}

function uploadResult(params: { details: QuestionDetails; requestUrl: string }): QuestionDetailsUploadResult {
  const detailsHash = `0x${params.details.sha256}` as const;
  return {
    detailsHash: params.details.status === "approved" ? detailsHash : null,
    detailsId: params.details.id,
    detailsUrl:
      params.details.status === "approved" ? getQuestionDetailsUrl(params.requestUrl, params.details.id) : null,
    error: params.details.error,
    moderationStatus: params.details.moderationStatus,
    nextAction:
      params.details.status === "approved"
        ? "Use detailsUrl and detailsHash with the question submission."
        : "Edit the details and try again before submitting.",
    preview: params.details.normalizedText
      ? params.details.normalizedText.slice(0, DEFAULT_DETAILS_TEXT_PREVIEW_LENGTH)
      : null,
    status: params.details.status as QuestionDetailsStatus,
  };
}

export async function createQuestionDetailsFromText(params: CreateQuestionDetailsFromTextParams) {
  if (!isQuestionDetailsId(params.detailsId)) {
    throw new Error("Invalid details id.");
  }
  await assertGatedAttachmentSchemaReady("question_details");

  const createdAt = nowDate();
  const baseValues = {
    id: params.detailsId,
    uploaderKind: params.uploader.kind,
    ownerWalletAddress: params.uploader.ownerWalletAddress,
    agentId: params.uploader.kind === "agent" ? params.uploader.agentId : null,
    clientRequestId: params.clientRequestId ?? null,
    requiresGatedAccess: params.requiresGatedAccess === true,
    sizeBytes: params.sizeBytes,
    sha256: params.sha256,
    createdAt,
    updatedAt: createdAt,
  };

  let normalizedText: string | null = null;
  let moderation: ModerationDecision | null = null;
  let status: QuestionDetailsStatus = "failed";
  let error: string | null = null;

  try {
    normalizedText = normalizeQuestionDetailsText(params.text);
    assertSupportedDetailsInput({
      detailsId: params.detailsId,
      normalizedText,
      requiresGatedAccess: params.requiresGatedAccess,
      sha256: params.sha256,
      sizeBytes: params.sizeBytes,
    });
    moderation = await moderateQuestionDetailsText(normalizedText);
    status =
      moderation.status === "approved" ? "approved" : moderation.status === "review_required" ? "failed" : "blocked";
    error = moderation.status === "review_required" ? "Details require moderation review before publication." : null;
    if (
      status === "approved" &&
      !isPublishableQuestionDetailsUrl(getQuestionDetailsUrl(params.requestUrl, params.detailsId))
    ) {
      status = "failed";
      error = QUESTION_DETAILS_PUBLIC_URL_ERROR;
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Details processing failed.";
  }

  const [created] = await db
    .insert(questionDetails)
    .values({
      ...baseValues,
      normalizedText: status === "approved" ? normalizedText : null,
      status,
      moderationStatus: moderation?.status ?? "failed",
      moderationProvider: moderation?.provider ?? null,
      moderationResult: moderation ? JSON.stringify(moderation.result) : null,
      error,
    })
    .onConflictDoNothing()
    .returning();

  if (!created) {
    throw new Error("Question details already exist.");
  }

  return uploadResult({ details: created, requestUrl: params.requestUrl });
}

export async function attachQuestionDetailsToContent(
  params: QuestionDetailsDeploymentScope & {
    agentId?: string | null;
    contentId: string;
    detailsUrl: string;
    ownerWalletAddress?: string | null;
  },
) {
  const detailsId = parseQuestionDetailsIdFromDetailsUrl(params.detailsUrl);
  if (!detailsId) return false;

  const ownerWalletAddress =
    params.ownerWalletAddress && isValidWalletAddress(params.ownerWalletAddress)
      ? normalizeWalletAddress(params.ownerWalletAddress)
      : null;
  const identityPredicate =
    params.agentId && ownerWalletAddress
      ? or(eq(questionDetails.agentId, params.agentId), eq(questionDetails.ownerWalletAddress, ownerWalletAddress))
      : params.agentId
        ? eq(questionDetails.agentId, params.agentId)
        : ownerWalletAddress
          ? eq(questionDetails.ownerWalletAddress, ownerWalletAddress)
          : null;
  if (!identityPredicate) return false;

  const updatedAt = nowDate();
  const [updated] = await db
    .update(questionDetails)
    .set({
      chainId: params.chainId ?? null,
      contentId: params.contentId,
      contentRegistryAddress: params.contentRegistryAddress ?? null,
      deploymentKey: params.deploymentKey ?? null,
      updatedAt,
    })
    .where(
      and(
        eq(questionDetails.id, detailsId),
        eq(questionDetails.status, "approved"),
        identityPredicate,
        or(
          isNull(questionDetails.contentId),
          and(eq(questionDetails.contentId, params.contentId), questionDetailsSameDeploymentScopePredicate(params)),
        ),
      ),
    )
    .returning({ id: questionDetails.id });
  return Boolean(updated);
}

export async function markQuestionDetailsRequiresGatedAccess(params: {
  agentId?: string | null;
  detailsUrl: string;
  ownerWalletAddress?: string | null;
}) {
  const detailsId = parseQuestionDetailsIdFromDetailsUrl(params.detailsUrl);
  if (!detailsId) return false;

  const ownerWalletAddress =
    params.ownerWalletAddress && isValidWalletAddress(params.ownerWalletAddress)
      ? normalizeWalletAddress(params.ownerWalletAddress)
      : null;
  const identityPredicate =
    params.agentId && ownerWalletAddress
      ? or(eq(questionDetails.agentId, params.agentId), eq(questionDetails.ownerWalletAddress, ownerWalletAddress))
      : params.agentId
        ? eq(questionDetails.agentId, params.agentId)
        : ownerWalletAddress
          ? eq(questionDetails.ownerWalletAddress, ownerWalletAddress)
          : null;
  if (!identityPredicate) return false;

  const [updated] = await db
    .update(questionDetails)
    .set({
      requiresGatedAccess: true,
      updatedAt: nowDate(),
    })
    .where(and(eq(questionDetails.id, detailsId), eq(questionDetails.status, "approved"), identityPredicate))
    .returning({ id: questionDetails.id });
  return Boolean(updated);
}

export async function sweepOrphanedQuestionDetails(
  params: {
    limit?: number;
    now?: Date;
    unattachedTtlMs?: number;
  } = {},
) {
  const now = params.now ?? nowDate();
  const limit = Math.max(1, Math.min(Math.floor(params.limit ?? DEFAULT_QUESTION_DETAILS_ORPHAN_SWEEP_LIMIT), 500));
  const unattachedTtlMs = Math.max(1, params.unattachedTtlMs ?? DEFAULT_UNATTACHED_QUESTION_DETAILS_ORPHAN_TTL_MS);
  const expiresBefore = new Date(now.getTime() - unattachedTtlMs);

  const candidates = await dbPool.query<{
    id: string;
    status: QuestionDetailsStatus;
  }>(
    `
      SELECT id, status
      FROM question_details
      WHERE content_id IS NULL
        AND status IN ('blocked', 'failed')
        AND created_at <= $1
      ORDER BY created_at ASC
      LIMIT $2
    `,
    [expiresBefore, limit],
  );

  let deleted = 0;
  for (const candidate of candidates.rows) {
    const claimed = await dbPool.query<{ id: string }>(
      `
        UPDATE question_details
        SET status = 'deleted',
            normalized_text = NULL,
            updated_at = $2,
            error = COALESCE(error, 'Expired unsubmitted question details.')
        WHERE id = $1
          AND status = $3
          AND content_id IS NULL
        RETURNING id
      `,
      [candidate.id, now, candidate.status],
    );
    if (claimed.rows[0]) deleted += 1;
  }

  return {
    deleted,
    scanned: candidates.rows.length,
  };
}

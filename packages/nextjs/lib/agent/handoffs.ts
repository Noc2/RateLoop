import { normalizeInferredHeadToHeadAbRequestBody } from "@rateloop/agents/voteUi";
import { createHash, randomBytes } from "crypto";
import "server-only";
import { type Address, type Hex, isAddress } from "viem";
import {
  redactSensitiveAgentRequestFields,
  sealSensitiveAgentRequestFields,
  unsealSensitiveAgentRequestFields,
} from "~~/lib/agent/requestRedaction";
import {
  assertProcessableImageBuffer,
  assertSupportedImageSignature,
  createImageAttachmentId,
  reserveImageUploadDailyQuotas,
} from "~~/lib/attachments/imageAttachments";
import { getMaxImageUploadSizeBytes, isSupportedImageUploadMimeType } from "~~/lib/auth/imageUploadChallenge.shared";
import { dbClient } from "~~/lib/db";
import { buildAppRelativeUrl } from "~~/lib/url/appRelative";
import { parseX402QuestionRequest } from "~~/lib/x402/questionPayload";
import { X402QuestionConfigError, resolveX402QuestionConfig } from "~~/lib/x402/questionSubmission";

type JsonObject = Record<string, unknown>;

export type AgentAskHandoffPaymentMode = "wallet_calls" | "x402_authorization";

export type AgentAskHandoffStatus =
  | "pending"
  | "awaiting_image_signatures"
  | "uploading_images"
  | "prepared"
  | "submitted"
  | "failed"
  | "expired";

export type AgentAskHandoffFeedbackBonusStatus = "pending_confirmation" | "failed_confirmation" | "confirmed";

export type AgentAskHandoffRecord = {
  chainId: number | null;
  clientRequestId: string | null;
  completedAt: Date | null;
  createdAt: Date;
  draftRevision: number;
  editedByUser: boolean;
  error: string | null;
  expiresAt: Date;
  feedbackBonusError: string | null;
  feedbackBonusStatus: AgentAskHandoffFeedbackBonusStatus | null;
  feedbackBonusTransactionHashes: Hex[];
  id: string;
  operationKey: `0x${string}` | null;
  originalRequestBody: JsonObject;
  payloadHash: string | null;
  paymentMode: AgentAskHandoffPaymentMode;
  preparedDraftRevision: number | null;
  requestBody: JsonObject;
  status: AgentAskHandoffStatus;
  tokenHash: string;
  transactionHashes: Hex[];
  transactionPlan: JsonObject | null;
  updatedAt: Date;
  walletAddress: Address | null;
};

export type AgentAskHandoffAssetRecord = {
  attachmentId: string;
  createdAt: Date;
  error: string | null;
  handoffId: string;
  id: string;
  imageBase64: string;
  imageUrl: string | null;
  mimeType: string;
  originalFilename: string;
  position: number;
  sha256: string;
  sizeBytes: number;
  status: "uploading" | "staged" | "uploaded" | "failed";
  updatedAt: Date;
};

type CreateHandoffImageInput = {
  dataUrl?: unknown;
  filename?: unknown;
  imageBase64?: unknown;
  mimeType?: unknown;
  sha256?: unknown;
  sizeBytes?: unknown;
};

type CreateHandoffImageUploadInput = {
  filename?: unknown;
  mimeType?: unknown;
  sha256?: unknown;
  sizeBytes?: unknown;
};

const DEFAULT_HANDOFF_TTL_MS = 30 * 60 * 1000;
const PUBLIC_HANDOFF_MAX_TTL_MS = DEFAULT_HANDOFF_TTL_MS;
const CLIENT_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{4,160}$/;
const HANDOFF_TOKEN_HEADER = "x-rateloop-handoff-token";
const HANDOFF_DRAFT_MIGRATION_PATH = "packages/nextjs/drizzle/0003_agent_handoff_drafts.sql";
const HANDOFF_DRAFT_COLUMNS = [
  "original_request_body",
  "draft_revision",
  "prepared_draft_revision",
  "edited_by_user",
] as const;
const HANDOFF_DRAFT_MIGRATION_MESSAGE =
  `Agent ask handoff database migration is pending. Apply ${HANDOFF_DRAFT_MIGRATION_PATH} ` +
  "to the handoff database before creating or preparing browser handoff links.";
const HANDOFF_ASSET_POSITION_MIGRATION_PATH = "packages/nextjs/drizzle/0014_agent_handoff_asset_positions.sql";
const HANDOFF_ASSET_POSITION_COLUMN = "position";
const HANDOFF_ASSET_POSITION_MIGRATION_MESSAGE =
  `Agent ask handoff asset database migration is pending. Apply ${HANDOFF_ASSET_POSITION_MIGRATION_PATH} ` +
  "to the handoff database before creating or preparing browser handoff links.";
const HANDOFF_FEEDBACK_BONUS_RECOVERY_MIGRATION_PATH =
  "packages/nextjs/drizzle/0018_agent_handoff_feedback_bonus_recovery.sql";
const HANDOFF_FEEDBACK_BONUS_RECOVERY_COLUMNS = [
  "feedback_bonus_transaction_hashes",
  "feedback_bonus_status",
  "feedback_bonus_error",
] as const;
const HANDOFF_FEEDBACK_BONUS_RECOVERY_MIGRATION_MESSAGE =
  `Agent ask handoff database migration is pending. Apply ${HANDOFF_FEEDBACK_BONUS_RECOVERY_MIGRATION_PATH} ` +
  "to enable Feedback Bonus confirmation recovery for browser handoffs.";
const HANDOFF_LINK_EXPIRED_MESSAGE = "Handoff link has expired. Ask the AI agent to generate a new handoff link.";
const IMAGE_BASE64_TRANSPORT_HINT =
  "Read the image from disk or memory in the same process that sends the request; do not copy base64 from terminal output or downscale solely because a chat display capped the output.";
const CLIENT_REQUEST_ID_MAX_LENGTH = 160;

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(item => (item === undefined ? null : stableJsonValue(item)));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .filter(key => record[key] !== undefined)
        .sort()
        .map(key => [key, stableJsonValue(record[key])]),
    );
  }
  return value;
}

function stableJsonStringify(value: unknown) {
  return JSON.stringify(stableJsonValue(value));
}

function requestBodyWithoutClientRequestId(value: JsonObject) {
  const next = redactSensitiveAgentRequestFields(value);
  delete next.clientRequestId;
  return next;
}

function readRequestClientRequestId(value: JsonObject) {
  return typeof value.clientRequestId === "string" ? value.clientRequestId.trim() : "";
}

function handoffRequestBodiesMatchIgnoringClientRequestId(left: JsonObject, right: JsonObject) {
  return (
    stableJsonStringify(requestBodyWithoutClientRequestId(left)) ===
    stableJsonStringify(requestBodyWithoutClientRequestId(right))
  );
}

function normalizeClientRequestIdPrefix(value: string) {
  return value.replace(/[^A-Za-z0-9._:-]/g, "-").replace(/[._:-]+$/g, "") || "handoff";
}

function handoffDraftClientRequestIdMarker(handoffId: string) {
  return `:draft:${handoffId.slice(0, 16)}:`;
}

function isHandoffDraftClientRequestId(value: string, handoffId: string) {
  return value.includes(handoffDraftClientRequestIdMarker(handoffId));
}

function buildHandoffDraftClientRequestId(params: { handoff: AgentAskHandoffRecord; originalClientRequestId: string }) {
  const suffix = `${handoffDraftClientRequestIdMarker(params.handoff.id)}${params.handoff.draftRevision + 1}`;
  const prefixMaxLength = Math.max(4, CLIENT_REQUEST_ID_MAX_LENGTH - suffix.length);
  const prefix = normalizeClientRequestIdPrefix(params.originalClientRequestId).slice(0, prefixMaxLength);
  return `${prefix || "handoff"}${suffix}`.slice(0, CLIENT_REQUEST_ID_MAX_LENGTH);
}

function withHandoffDraftClientRequestId(requestBody: JsonObject, handoff: AgentAskHandoffRecord) {
  const originalClientRequestId = readRequestClientRequestId(handoff.originalRequestBody);
  if (!originalClientRequestId) return requestBody;

  if (handoffRequestBodiesMatchIgnoringClientRequestId(requestBody, handoff.originalRequestBody)) {
    return readRequestClientRequestId(requestBody) === originalClientRequestId
      ? requestBody
      : { ...requestBody, clientRequestId: originalClientRequestId };
  }

  const currentClientRequestId = readRequestClientRequestId(requestBody);
  const shouldDeriveDraftId =
    !currentClientRequestId ||
    currentClientRequestId === originalClientRequestId ||
    isHandoffDraftClientRequestId(currentClientRequestId, handoff.id);
  if (!shouldDeriveDraftId) return requestBody;

  const draftClientRequestId = buildHandoffDraftClientRequestId({ handoff, originalClientRequestId });
  return currentClientRequestId === draftClientRequestId
    ? requestBody
    : { ...requestBody, clientRequestId: draftClientRequestId };
}

function resolveHandoffTtl(requestedTtlMs: number | undefined) {
  const requested = requestedTtlMs ?? DEFAULT_HANDOFF_TTL_MS;
  const effectiveTtlMs = Math.min(Math.max(requested, 60_000), PUBLIC_HANDOFF_MAX_TTL_MS);
  const warnings =
    requested > PUBLIC_HANDOFF_MAX_TTL_MS
      ? [
          `requested_ttl_clamped: requested ttlMs ${requested} exceeds the maximum ${PUBLIC_HANDOFF_MAX_TTL_MS}; using ${effectiveTtlMs}.`,
        ]
      : [];
  return {
    effectiveTtlMs,
    requestedTtlMs: requestedTtlMs ?? null,
    warnings,
  };
}

type ErrorWithCause = {
  cause?: unknown;
  code?: unknown;
  message?: unknown;
};

let handoffDraftSchemaReadyPromise: Promise<void> | null = null;
let handoffDraftSchemaReadyForTests: boolean | null = null;
let handoffAssetPositionSchemaReadyPromise: Promise<void> | null = null;
let handoffFeedbackBonusRecoverySchemaReadyPromise: Promise<void> | null = null;

export class AgentAskHandoffError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "AgentAskHandoffError";
    this.status = status;
  }
}

function pendingHandoffDraftMigrationError() {
  return new AgentAskHandoffError(HANDOFF_DRAFT_MIGRATION_MESSAGE, 503);
}

function pendingHandoffAssetPositionMigrationError() {
  return new AgentAskHandoffError(HANDOFF_ASSET_POSITION_MIGRATION_MESSAGE, 503);
}

function pendingHandoffFeedbackBonusRecoveryMigrationError() {
  return new AgentAskHandoffError(HANDOFF_FEEDBACK_BONUS_RECOVERY_MIGRATION_MESSAGE, 503);
}

function isMissingHandoffDraftSchemaError(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object") return false;

  const candidate = error as ErrorWithCause;
  const code = typeof candidate.code === "string" ? candidate.code : "";
  const message = typeof candidate.message === "string" ? candidate.message : "";
  const mentionsHandoffTable = message.includes("agent_ask_handoff_intents");
  const mentionsDraftColumn = HANDOFF_DRAFT_COLUMNS.some(column => message.includes(column));

  if ((code === "42703" || code === "42P01") && (mentionsHandoffTable || mentionsDraftColumn)) {
    return true;
  }
  if (message.includes("column") && message.includes("does not exist") && mentionsDraftColumn) {
    return true;
  }
  if (message.includes("relation") && message.includes("does not exist") && mentionsHandoffTable) {
    return true;
  }

  return depth < 3 && candidate.cause !== undefined
    ? isMissingHandoffDraftSchemaError(candidate.cause, depth + 1)
    : false;
}

function isMissingHandoffAssetPositionSchemaError(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object") return false;

  const candidate = error as ErrorWithCause;
  const code = typeof candidate.code === "string" ? candidate.code : "";
  const message = typeof candidate.message === "string" ? candidate.message : "";
  const mentionsHandoffAssetsTable = message.includes("agent_ask_handoff_assets");
  const mentionsPositionColumn = message.includes(HANDOFF_ASSET_POSITION_COLUMN);

  if ((code === "42703" || code === "42P01") && (mentionsHandoffAssetsTable || mentionsPositionColumn)) {
    return true;
  }
  if (message.includes("column") && message.includes("does not exist") && mentionsPositionColumn) {
    return true;
  }
  if (message.includes("relation") && message.includes("does not exist") && mentionsHandoffAssetsTable) {
    return true;
  }

  return depth < 3 && candidate.cause !== undefined
    ? isMissingHandoffAssetPositionSchemaError(candidate.cause, depth + 1)
    : false;
}

function isMissingHandoffFeedbackBonusRecoverySchemaError(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object") return false;

  const candidate = error as ErrorWithCause;
  const code = typeof candidate.code === "string" ? candidate.code : "";
  const message = typeof candidate.message === "string" ? candidate.message : "";
  const mentionsHandoffTable = message.includes("agent_ask_handoff_intents");
  const mentionsFeedbackBonusColumn = HANDOFF_FEEDBACK_BONUS_RECOVERY_COLUMNS.some(column => message.includes(column));

  if ((code === "42703" || code === "42P01") && (mentionsHandoffTable || mentionsFeedbackBonusColumn)) {
    return true;
  }
  if (message.includes("column") && message.includes("does not exist") && mentionsFeedbackBonusColumn) {
    return true;
  }
  if (message.includes("relation") && message.includes("does not exist") && mentionsHandoffTable) {
    return true;
  }

  return depth < 3 && candidate.cause !== undefined
    ? isMissingHandoffFeedbackBonusRecoverySchemaError(candidate.cause, depth + 1)
    : false;
}

async function checkHandoffDraftSchemaReady() {
  try {
    await dbClient.execute(`
      SELECT original_request_body, draft_revision, prepared_draft_revision, edited_by_user
      FROM agent_ask_handoff_intents
      LIMIT 0
    `);
  } catch (error) {
    if (isMissingHandoffDraftSchemaError(error)) {
      throw pendingHandoffDraftMigrationError();
    }
    throw error;
  }
}

async function checkHandoffAssetPositionSchemaReady() {
  await dbClient.execute(`
    SELECT ${HANDOFF_ASSET_POSITION_COLUMN}
    FROM agent_ask_handoff_assets
    LIMIT 0
  `);
}

async function checkHandoffFeedbackBonusRecoverySchemaReady() {
  await dbClient.execute(`
    SELECT feedback_bonus_transaction_hashes, feedback_bonus_status, feedback_bonus_error
    FROM agent_ask_handoff_intents
    LIMIT 0
  `);
}

async function applyPendingHandoffAssetPositionMigration() {
  await dbClient.execute(
    `ALTER TABLE "agent_ask_handoff_assets" ADD COLUMN IF NOT EXISTS "${HANDOFF_ASSET_POSITION_COLUMN}" integer DEFAULT 0 NOT NULL`,
  );
}

export async function assertAgentAskHandoffDraftSchemaReady() {
  if (handoffDraftSchemaReadyForTests === false) {
    throw pendingHandoffDraftMigrationError();
  }
  if (handoffDraftSchemaReadyForTests === true) {
    return;
  }

  handoffDraftSchemaReadyPromise ??= checkHandoffDraftSchemaReady().catch(error => {
    handoffDraftSchemaReadyPromise = null;
    throw error;
  });
  await handoffDraftSchemaReadyPromise;
}

export function __setAgentAskHandoffDraftSchemaReadyForTests(value: boolean | null) {
  handoffDraftSchemaReadyForTests = value;
  handoffDraftSchemaReadyPromise = null;
}

export function __resetAgentAskHandoffAssetPositionSchemaReadyForTests() {
  handoffAssetPositionSchemaReadyPromise = null;
}

export function __resetAgentAskHandoffFeedbackBonusRecoverySchemaReadyForTests() {
  handoffFeedbackBonusRecoverySchemaReadyPromise = null;
}

export async function assertAgentAskHandoffAssetPositionSchemaReady() {
  handoffAssetPositionSchemaReadyPromise ??= (async () => {
    try {
      await checkHandoffAssetPositionSchemaReady();
    } catch (error) {
      if (!isMissingHandoffAssetPositionSchemaError(error)) {
        throw error;
      }
      try {
        await applyPendingHandoffAssetPositionMigration();
        await checkHandoffAssetPositionSchemaReady();
      } catch (migrationError) {
        console.error("[agent-handoffs] Failed to apply pending handoff asset position migration", migrationError);
        throw pendingHandoffAssetPositionMigrationError();
      }
    }
  })().catch(error => {
    handoffAssetPositionSchemaReadyPromise = null;
    throw error;
  });
  await handoffAssetPositionSchemaReadyPromise;
}

export async function assertAgentAskHandoffFeedbackBonusRecoverySchemaReady() {
  handoffFeedbackBonusRecoverySchemaReadyPromise ??= checkHandoffFeedbackBonusRecoverySchemaReady().catch(error => {
    handoffFeedbackBonusRecoverySchemaReadyPromise = null;
    if (isMissingHandoffFeedbackBonusRecoverySchemaError(error)) {
      throw pendingHandoffFeedbackBonusRecoveryMigrationError();
    }
    throw error;
  });
  await handoffFeedbackBonusRecoverySchemaReadyPromise;
}

function nowDate() {
  return new Date();
}

function randomToken() {
  return randomBytes(32).toString("base64url");
}

function randomHandoffId() {
  return `ahf_${randomBytes(16).toString("hex")}`;
}

function randomAssetId() {
  return `aha_${randomBytes(16).toString("hex")}`;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function asJsonObject(value: unknown, fieldName: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentAskHandoffError(`${fieldName} must be a JSON object.`);
  }
  return value as JsonObject;
}

function readOptionalAddress(value: unknown, fieldName: string): Address | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string" && isAddress(value)) return value as Address;
  throw new AgentAskHandoffError(`${fieldName} must be an EVM address.`);
}

function readOptionalString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function parseAgentAskHandoffPaymentMode(
  value: unknown,
  defaultMode: AgentAskHandoffPaymentMode = "wallet_calls",
): AgentAskHandoffPaymentMode {
  const paymentMode = readOptionalString(value);
  if (!paymentMode) return defaultMode;
  if (paymentMode === "wallet_calls" || paymentMode === "agent_wallet") return "wallet_calls";
  if (
    paymentMode === "eip3009_usdc_authorization" ||
    paymentMode === "eip3009_authorization" ||
    paymentMode === "x402_authorization" ||
    paymentMode === "native_x402" ||
    paymentMode === "x402"
  ) {
    return "x402_authorization";
  }
  throw new AgentAskHandoffError(
    "paymentMode must be wallet_calls, eip3009_usdc_authorization, or x402_authorization.",
  );
}

function defaultAgentAskHandoffPaymentMode(params: {
  parsed: ReturnType<typeof parseX402QuestionRequest>;
  requestBody?: JsonObject;
}): AgentAskHandoffPaymentMode {
  const feedbackBonus =
    params.requestBody?.feedbackBonus &&
    typeof params.requestBody.feedbackBonus === "object" &&
    !Array.isArray(params.requestBody.feedbackBonus)
      ? (params.requestBody.feedbackBonus as JsonObject)
      : null;
  const feedbackAsset = typeof feedbackBonus?.asset === "string" ? feedbackBonus.asset.trim().toUpperCase() : null;
  if (feedbackAsset && (feedbackAsset !== "USDC" || params.parsed.bounty.asset !== "USDC")) {
    return "wallet_calls";
  }
  return params.parsed.bounty.asset === "USDC" && params.parsed.questions.length === 1
    ? "x402_authorization"
    : "wallet_calls";
}

function resolveAgentAskHandoffPaymentMode(params: {
  parsed: ReturnType<typeof parseX402QuestionRequest>;
  requestBody: JsonObject;
}) {
  return parseAgentAskHandoffPaymentMode(
    params.requestBody.paymentMode ?? params.requestBody.fundingMode,
    defaultAgentAskHandoffPaymentMode({ parsed: params.parsed, requestBody: params.requestBody }),
  );
}

function assertAgentAskHandoffFeedbackBonusMode(params: {
  parsed: ReturnType<typeof parseX402QuestionRequest>;
  paymentMode: AgentAskHandoffPaymentMode;
  requestBody: JsonObject;
}) {
  const raw = params.requestBody.feedbackBonus;
  if (raw === undefined || raw === null || raw === false) return;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new AgentAskHandoffError("feedbackBonus must be an object when provided.");
  }
  const value = raw as JsonObject;
  const asset = typeof value.asset === "string" ? value.asset.trim().toUpperCase() : params.parsed.bounty.asset;
  if (asset !== "USDC" && asset !== "LREP") {
    throw new AgentAskHandoffError("feedbackBonus.asset must be USDC or LREP.");
  }
  if (params.parsed.questions.length !== 1) {
    throw new AgentAskHandoffError("Feedback Bonus funding requires a single-question ask.");
  }
  if (params.paymentMode === "x402_authorization") {
    if (params.parsed.bounty.asset !== "USDC" || asset !== "USDC") {
      throw new AgentAskHandoffError("EIP-3009 authorization can only fund USDC bounties and USDC Feedback Bonuses.");
    }
  }
}

function readRequiredString(value: unknown, fieldName: string) {
  const stringValue = readOptionalString(value);
  if (!stringValue) {
    throw new AgentAskHandoffError(`${fieldName} is required.`);
  }
  return stringValue;
}

function readPositiveSizeBytes(value: unknown, fallback: number, fieldName = "generatedImages[].sizeBytes") {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new AgentAskHandoffError(`${fieldName} must be a positive integer.`);
  }
  return parsed;
}

function readRequiredPositiveSizeBytes(value: unknown, fieldName: string) {
  const parsed = readPositiveSizeBytes(value, 0, fieldName);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new AgentAskHandoffError(`${fieldName} must be a positive integer.`);
  }
  return parsed;
}

function readSha256(value: unknown, fieldName: string) {
  const rawValue = readRequiredString(value, fieldName).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(rawValue)) {
    throw new AgentAskHandoffError(`${fieldName} must be a lowercase SHA-256 hash.`);
  }
  return rawValue;
}

function parseStoredJson(value: string): JsonObject {
  try {
    return asJsonObject(JSON.parse(value), "Stored handoff request body");
  } catch (error) {
    if (error instanceof AgentAskHandoffError) throw error;
    throw new AgentAskHandoffError("Stored handoff request body is invalid.", 500);
  }
}

function parseStoredTransactionPlan(value: string | null): JsonObject | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as JsonObject) : null;
  } catch {
    return null;
  }
}

function parseStoredHashes(value: string | null): Hex[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed.filter((entry): entry is Hex => typeof entry === "string") as Hex[]) : [];
  } catch {
    return [];
  }
}

function parseFeedbackBonusStatus(value: unknown): AgentAskHandoffFeedbackBonusStatus | null {
  return value === "pending_confirmation" || value === "failed_confirmation" || value === "confirmed" ? value : null;
}

function rowToHandoff(row: Record<string, unknown> | undefined): AgentAskHandoffRecord | null {
  if (!row) return null;
  return {
    chainId: row.chain_id === null || row.chain_id === undefined ? null : Number(row.chain_id),
    clientRequestId: typeof row.client_request_id === "string" ? row.client_request_id : null,
    completedAt:
      row.completed_at instanceof Date
        ? row.completed_at
        : row.completed_at
          ? new Date(String(row.completed_at))
          : null,
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at)),
    draftRevision: row.draft_revision === null || row.draft_revision === undefined ? 0 : Number(row.draft_revision),
    editedByUser: row.edited_by_user === true || row.edited_by_user === "true",
    error: typeof row.error === "string" ? row.error : null,
    expiresAt: row.expires_at instanceof Date ? row.expires_at : new Date(String(row.expires_at)),
    feedbackBonusError: typeof row.feedback_bonus_error === "string" ? row.feedback_bonus_error : null,
    feedbackBonusStatus: parseFeedbackBonusStatus(row.feedback_bonus_status),
    feedbackBonusTransactionHashes: parseStoredHashes(
      typeof row.feedback_bonus_transaction_hashes === "string" ? row.feedback_bonus_transaction_hashes : null,
    ),
    id: String(row.id),
    operationKey: typeof row.operation_key === "string" ? (row.operation_key as `0x${string}`) : null,
    originalRequestBody: parseStoredJson(String(row.original_request_body ?? row.request_body)),
    payloadHash: typeof row.payload_hash === "string" ? row.payload_hash : null,
    paymentMode: parseAgentAskHandoffPaymentMode(row.payment_mode),
    preparedDraftRevision:
      row.prepared_draft_revision === null || row.prepared_draft_revision === undefined
        ? null
        : Number(row.prepared_draft_revision),
    requestBody: parseStoredJson(String(row.request_body)),
    status: String(row.status) as AgentAskHandoffStatus,
    tokenHash: String(row.token_hash),
    transactionHashes: parseStoredHashes(typeof row.transaction_hashes === "string" ? row.transaction_hashes : null),
    transactionPlan: parseStoredTransactionPlan(typeof row.transaction_plan === "string" ? row.transaction_plan : null),
    updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(String(row.updated_at)),
    walletAddress:
      typeof row.wallet_address === "string" && isAddress(row.wallet_address) ? (row.wallet_address as Address) : null,
  };
}

function rowToAsset(row: Record<string, unknown>): AgentAskHandoffAssetRecord {
  const imageData = normalizeStoredAssetImageData({
    imageBase64: String(row.image_base64),
    mimeType: String(row.mime_type),
    sha256: String(row.sha256),
    sizeBytes: Number(row.size_bytes),
  });

  return {
    attachmentId: String(row.attachment_id),
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at)),
    error: typeof row.error === "string" ? row.error : null,
    handoffId: String(row.handoff_id),
    id: String(row.id),
    imageBase64: imageData.imageBase64,
    imageUrl: typeof row.image_url === "string" ? row.image_url : null,
    mimeType: imageData.mimeType,
    originalFilename: String(row.original_filename),
    position: Number(row.position ?? 0),
    sha256: imageData.sha256,
    sizeBytes: imageData.sizeBytes,
    status: String(row.status) as AgentAskHandoffAssetRecord["status"],
    updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(String(row.updated_at)),
  };
}

function handoffUrl(params: { appBaseUrl: string; handoffId: string; token: string }) {
  const url = buildAppRelativeUrl(params.appBaseUrl, `/agent/handoff/${params.handoffId}`);
  url.hash = `token=${encodeURIComponent(params.token)}`;
  return url.toString();
}

function assetImageUrl(appBaseUrl: string, attachmentId: string, sha256: string) {
  const url = buildAppRelativeUrl(appBaseUrl, `/api/attachments/images/${attachmentId}.webp`);
  url.hash = `sha256=0x${sha256.toLowerCase()}`;
  return url.toString();
}

function readDataUrl(value: string) {
  const match = value.trim().match(/^data:([^;,]+);base64,([A-Za-z0-9+/=_-]+)$/i);
  if (!match) return null;
  return {
    imageBase64: match[2],
    mimeType: match[1].toLowerCase(),
  };
}

function decodeBase64(value: string) {
  const normalized = value.replace(/\s/g, "");
  if (
    !normalized ||
    (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) && !/^[A-Za-z0-9_-]+={0,2}$/.test(normalized)) ||
    normalized.length % 4 === 1
  ) {
    throw new AgentAskHandoffError(
      `generatedImages[].imageBase64 must be base64-encoded image bytes. ${IMAGE_BASE64_TRANSPORT_HINT}`,
    );
  }
  const buffer = Buffer.from(normalized, "base64");
  if (buffer.length === 0) {
    throw new AgentAskHandoffError(
      `generatedImages[].imageBase64 must be base64-encoded image bytes. ${IMAGE_BASE64_TRANSPORT_HINT}`,
    );
  }
  return buffer;
}

function readNestedDataUrl(buffer: Buffer) {
  const text = buffer.toString("utf8").trim();
  return text.startsWith("data:") ? readDataUrl(text) : null;
}

function normalizeStoredAssetImageData(imageData: {
  imageBase64: string;
  mimeType: string;
  sha256: string;
  sizeBytes: number;
}) {
  try {
    const buffer = decodeBase64(imageData.imageBase64);
    const nestedDataUrlParts = readNestedDataUrl(buffer);
    if (!nestedDataUrlParts) return imageData;

    const nestedBuffer = decodeBase64(nestedDataUrlParts.imageBase64);
    assertSupportedImageSignature(nestedBuffer, nestedDataUrlParts.mimeType);
    return {
      imageBase64: nestedBuffer.toString("base64"),
      mimeType: nestedDataUrlParts.mimeType,
      sha256: createHash("sha256").update(nestedBuffer).digest("hex"),
      sizeBytes: nestedBuffer.byteLength,
    };
  } catch {
    return imageData;
  }
}

function normalizeGeneratedImage(input: CreateHandoffImageInput, index: number) {
  const filename = readRequiredString(input.filename, `generatedImages[${index}].filename`).slice(0, 180);
  const dataUrl = readOptionalString(input.dataUrl);
  const dataUrlParts = dataUrl ? readDataUrl(dataUrl) : null;
  if (dataUrl && !dataUrlParts) {
    throw new AgentAskHandoffError(
      `generatedImages[${index}].dataUrl must be a base64 image data URL. ${IMAGE_BASE64_TRANSPORT_HINT}`,
    );
  }
  let imageBase64 =
    dataUrlParts?.imageBase64 ?? readRequiredString(input.imageBase64, `generatedImages[${index}].imageBase64`);
  let mimeType = (dataUrlParts?.mimeType ?? readOptionalString(input.mimeType)).toLowerCase();
  let buffer = decodeBase64(imageBase64);
  const nestedDataUrlParts = dataUrlParts ? null : readNestedDataUrl(buffer);
  if (nestedDataUrlParts) {
    if (mimeType && mimeType !== nestedDataUrlParts.mimeType) {
      throw new AgentAskHandoffError(
        `generatedImages[${index}].mimeType must match the MIME type embedded in imageBase64.`,
      );
    }
    imageBase64 = nestedDataUrlParts.imageBase64;
    mimeType = nestedDataUrlParts.mimeType;
    buffer = decodeBase64(imageBase64);
  }
  if (!mimeType) {
    throw new AgentAskHandoffError(`generatedImages[${index}].mimeType is required.`);
  }
  if (!isSupportedImageUploadMimeType(mimeType)) {
    throw new AgentAskHandoffError(`generatedImages[${index}].mimeType must be image/jpeg, image/png, or image/webp.`);
  }

  try {
    assertSupportedImageSignature(buffer, mimeType);
  } catch {
    throw new AgentAskHandoffError(
      `generatedImages[${index}] bytes do not match the declared ${mimeType} content type.`,
    );
  }
  const sizeBytes = readPositiveSizeBytes(input.sizeBytes, buffer.byteLength);
  if (sizeBytes !== buffer.byteLength) {
    throw new AgentAskHandoffError(
      `generatedImages[${index}].sizeBytes must match the decoded image byte length. Omit sizeBytes or compute it from the exact image buffer in the same request process.`,
    );
  }
  if (sizeBytes > getMaxImageUploadSizeBytes()) {
    throw new AgentAskHandoffError(
      `generatedImages[${index}] exceeds the maximum image upload size of ${getMaxImageUploadSizeBytes()} bytes.`,
    );
  }
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const suppliedSha256 = readOptionalString(input.sha256).toLowerCase();
  if (suppliedSha256 && suppliedSha256 !== sha256) {
    throw new AgentAskHandoffError(
      `generatedImages[${index}].sha256 must match the decoded image bytes. Omit sha256 or compute it from the exact image buffer in the same request process.`,
    );
  }

  return {
    filename,
    imageBase64: buffer.toString("base64"),
    mimeType,
    sha256,
    sizeBytes,
  };
}

function normalizeGeneratedImageUpload(input: CreateHandoffImageUploadInput, index: number) {
  const filename = readRequiredString(input.filename, `generatedImageUploads[${index}].filename`).slice(0, 180);
  const mimeType = readRequiredString(input.mimeType, `generatedImageUploads[${index}].mimeType`).toLowerCase();
  if (!isSupportedImageUploadMimeType(mimeType)) {
    throw new AgentAskHandoffError(
      `generatedImageUploads[${index}].mimeType must be image/jpeg, image/png, or image/webp.`,
    );
  }
  const sizeBytes = readRequiredPositiveSizeBytes(input.sizeBytes, `generatedImageUploads[${index}].sizeBytes`);
  if (sizeBytes > getMaxImageUploadSizeBytes()) {
    throw new AgentAskHandoffError(
      `generatedImageUploads[${index}] exceeds the maximum image upload size of ${getMaxImageUploadSizeBytes()} bytes.`,
    );
  }

  return {
    filename,
    imageBase64: "",
    mimeType,
    sha256: readSha256(input.sha256, `generatedImageUploads[${index}].sha256`),
    sizeBytes,
  };
}

function readGeneratedImages(value: unknown) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new AgentAskHandoffError("generatedImages must be an array.");
  }
  if (value.length > 4) {
    throw new AgentAskHandoffError("generatedImages supports at most four images.");
  }
  return value.map((entry, index) => normalizeGeneratedImage(asJsonObject(entry, `generatedImages[${index}]`), index));
}

function readGeneratedImageUploads(value: unknown) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new AgentAskHandoffError("generatedImageUploads must be an array.");
  }
  if (value.length > 4) {
    throw new AgentAskHandoffError("generatedImageUploads supports at most four images.");
  }
  return value.map((entry, index) =>
    normalizeGeneratedImageUpload(asJsonObject(entry, `generatedImageUploads[${index}]`), index),
  );
}

async function assertGeneratedImagesProcessable(images: ReturnType<typeof readGeneratedImages>): Promise<void> {
  for (const [index, image] of images.entries()) {
    try {
      await assertProcessableImageBuffer(Buffer.from(image.imageBase64, "base64"));
    } catch (error) {
      throw new AgentAskHandoffError(
        `generatedImages[${index}] is not a processable image. ${
          error instanceof Error ? error.message : "Re-export or regenerate the image, then try again."
        }`,
      );
    }
  }
}

function existingImageUrlStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function cloneWithImageUrls(requestBody: JsonObject, imageUrls: string[]) {
  if (imageUrls.length === 0) return requestBody;
  const cloned = structuredClone(requestBody) as JsonObject;
  const question = cloned.question;
  if (question && typeof question === "object" && !Array.isArray(question)) {
    const nextQuestion: JsonObject = {
      ...(question as JsonObject),
      imageUrls: [...new Set([...existingImageUrlStrings((question as JsonObject).imageUrls), ...imageUrls])],
    };
    delete nextQuestion.videoUrl;
    cloned.question = nextQuestion;
    return cloned;
  }
  const questions = cloned.questions;
  if (Array.isArray(questions)) {
    if (questions.length !== 1 || !questions[0] || typeof questions[0] !== "object" || Array.isArray(questions[0])) {
      throw new AgentAskHandoffError("generatedImages currently support single-question handoffs.");
    }
    const firstQuestion = questions[0] as JsonObject;
    const nextQuestion: JsonObject = {
      ...firstQuestion,
      imageUrls: [...new Set([...existingImageUrlStrings(firstQuestion.imageUrls), ...imageUrls])],
    };
    delete nextQuestion.videoUrl;
    cloned.questions = [nextQuestion];
    return cloned;
  }
  cloned.imageUrls = [...new Set([...existingImageUrlStrings(cloned.imageUrls), ...imageUrls])];
  delete cloned.videoUrl;
  return cloned;
}

function stripHandoffOnlyValidationFields(requestBody: JsonObject) {
  if (!("feedbackBonus" in requestBody)) return requestBody;
  const cloned = structuredClone(requestBody) as JsonObject;
  delete cloned.feedbackBonus;
  return cloned;
}

function assertHandoffChainSubmitReady(chainId: number) {
  try {
    resolveX402QuestionConfig(chainId);
  } catch (error) {
    if (error instanceof X402QuestionConfigError) {
      throw new AgentAskHandoffError(
        `Chain ${chainId} is not available for browser handoffs on this server: ${error.message}`,
        error.status,
      );
    }
    throw error;
  }
}

export function buildAgentAskHandoffValidationImageUrls(params: {
  appBaseUrl: string;
  assets: AgentAskHandoffAssetRecord[];
}) {
  return params.assets.map(
    asset => asset.imageUrl ?? assetImageUrl(params.appBaseUrl, asset.attachmentId, asset.sha256),
  );
}

export function normalizeAgentAskHandoffRequestBody(params: {
  fieldName?: string;
  requestBody: unknown;
  validationImageUrls?: string[];
}) {
  const requestBody = asJsonObject(params.requestBody, params.fieldName ?? "Handoff request body");

  const validationBody = stripHandoffOnlyValidationFields(
    cloneWithImageUrls(requestBody, params.validationImageUrls ?? []),
  );
  const parsed = parseX402QuestionRequest(validationBody);
  assertHandoffChainSubmitReady(parsed.chainId);
  const paymentMode = resolveAgentAskHandoffPaymentMode({ parsed, requestBody });
  assertAgentAskHandoffFeedbackBonusMode({ parsed, paymentMode, requestBody });
  const walletAddress = readOptionalAddress(
    requestBody.walletAddress ?? requestBody.agentWalletAddress,
    "walletAddress",
  );

  return {
    paymentMode,
    parsed,
    requestBody,
    walletAddress,
  };
}

function assertFresh(handoff: AgentAskHandoffRecord) {
  if (handoff.expiresAt.getTime() <= Date.now()) {
    throw new AgentAskHandoffError(HANDOFF_LINK_EXPIRED_MESSAGE, 410);
  }
}

async function markHandoffExpired(handoff: AgentAskHandoffRecord) {
  if (handoff.status === "expired" || handoff.status === "submitted") return;
  const now = nowDate();
  await dbClient.execute({
    sql: `
      UPDATE agent_ask_handoff_intents
      SET status = 'expired',
          updated_at = ?
      WHERE id = ? AND status NOT IN ('submitted', 'expired')
    `,
    args: [now, handoff.id],
  });
}

export async function loadAgentAskHandoffByToken(params: {
  handoffId: string;
  token: string;
}): Promise<AgentAskHandoffRecord> {
  const tokenHash = hashToken(params.token);
  const result = await dbClient.execute({
    sql: `
      SELECT *
      FROM agent_ask_handoff_intents
      WHERE id = ? AND token_hash = ?
      LIMIT 1
    `,
    args: [params.handoffId, tokenHash],
  });
  const handoff = rowToHandoff(result.rows[0]);
  if (!handoff) {
    throw new AgentAskHandoffError("Handoff link was not found.", 404);
  }
  if (handoff.expiresAt.getTime() <= Date.now() && handoff.status !== "submitted") {
    await markHandoffExpired(handoff);
    return { ...handoff, status: "expired" };
  }
  return handoff;
}

export async function listAgentAskHandoffAssets(handoffId: string) {
  await assertAgentAskHandoffAssetPositionSchemaReady();

  const result = await dbClient.execute({
    sql: `
      SELECT *
      FROM agent_ask_handoff_assets
      WHERE handoff_id = ?
      ORDER BY position ASC, created_at ASC, id ASC
    `,
    args: [handoffId],
  });
  return result.rows.map(row => rowToAsset(row));
}

export function readHandoffTokenFromHeaders(headers: Pick<Headers, "get">) {
  return headers.get(HANDOFF_TOKEN_HEADER)?.trim() ?? "";
}

function transactionPlanCallCount(transactionPlan: JsonObject | null) {
  const calls = transactionPlan?.calls;
  return Array.isArray(calls) ? calls.length : 0;
}

export function buildAgentAskHandoffResponse(params: {
  assets: AgentAskHandoffAssetRecord[];
  handoff: AgentAskHandoffRecord;
  includeImageData?: boolean;
}) {
  const failedAsset = params.assets.find(asset => asset.status === "failed");
  const uploadingAsset = params.assets.find(asset => asset.status === "uploading");
  const feedbackBonusNeedsConfirmation =
    params.handoff.feedbackBonusTransactionHashes.length > 0 &&
    (params.handoff.feedbackBonusStatus === "pending_confirmation" ||
      params.handoff.feedbackBonusStatus === "failed_confirmation");
  const nextAction = (() => {
    if (params.handoff.status === "failed" && failedAsset) {
      return "Image upload failed. Ask the agent for a fresh handoff link with a regenerated or re-exported image.";
    }
    if (uploadingAsset) {
      return "Image upload is still staging. Poll rateloop_get_handoff_status before sharing or preparing the handoff.";
    }
    if (feedbackBonusNeedsConfirmation) {
      return "Feedback Bonus confirmation needs retry with the stored bonus transaction hashes; do not rebroadcast the bonus wallet calls.";
    }
    if (params.handoff.status === "failed" && params.handoff.transactionHashes.length > 0) {
      return "Confirmation failed after wallet transactions were submitted. Retry handoff completion with the stored transaction hashes; do not rebroadcast the wallet calls.";
    }
    if (params.handoff.status === "failed") {
      return "Review the handoff error, save any needed draft changes, then retry preparation or ask the agent for a fresh link.";
    }
    if (params.handoff.status === "expired") {
      return "Ask the AI agent to generate a new handoff link.";
    }
    if (params.handoff.status === "submitted") {
      return "Use resultTool or the public result URL to inspect the submitted ask.";
    }
    if (params.handoff.status === "prepared" && !params.handoff.transactionPlan) {
      return "Open the handoff page and continue preparation to sign the EIP-3009 USDC authorization.";
    }
    if (params.handoff.status === "prepared") {
      return "Execute the returned transactionPlan.calls in the connected wallet, then confirm the transaction hashes.";
    }
    if (params.handoff.status === "awaiting_image_signatures") {
      return "Sign each upload challenge in the browser wallet, then prepare the handoff again with imageSignatures.";
    }
    if (params.handoff.status === "uploading_images") {
      return "Image upload is still processing. Poll rateloop_get_handoff_status for completion or failure.";
    }
    return "Share or open the handoffUrl, review the draft, connect the funding wallet, and submit.";
  })();
  const originalRequestBody = redactSensitiveAgentRequestFields(params.handoff.originalRequestBody);
  const requestBody = redactSensitiveAgentRequestFields(params.handoff.requestBody);

  return {
    assets: params.assets.map(asset => ({
      attachmentId: asset.attachmentId,
      dataUrl:
        params.includeImageData && asset.imageBase64 ? `data:${asset.mimeType};base64,${asset.imageBase64}` : undefined,
      error: asset.error,
      filename: asset.originalFilename,
      id: asset.id,
      imageUrl: asset.imageUrl,
      mimeType: asset.mimeType,
      sha256: asset.sha256,
      sizeBytes: asset.sizeBytes,
      status: asset.status,
    })),
    chainId: params.handoff.chainId,
    clientRequestId: params.handoff.clientRequestId,
    completedAt: params.handoff.completedAt?.toISOString() ?? null,
    createdAt: params.handoff.createdAt.toISOString(),
    draftRevision: params.handoff.draftRevision,
    editedByUser: params.handoff.editedByUser,
    error: params.handoff.error,
    expiresAt: params.handoff.expiresAt.toISOString(),
    feedbackBonusError: params.handoff.feedbackBonusError,
    feedbackBonusStatus: params.handoff.feedbackBonusStatus,
    feedbackBonusTransactionHashes: params.handoff.feedbackBonusTransactionHashes,
    id: params.handoff.id,
    nextAction,
    operationKey: params.handoff.operationKey,
    originalRequestBody,
    payloadHash: params.handoff.payloadHash,
    paymentMode: params.handoff.paymentMode,
    paymentModeDiagnostics: {
      awaitingX402Authorization:
        params.handoff.paymentMode === "x402_authorization" &&
        params.handoff.status === "prepared" &&
        !params.handoff.transactionPlan,
      mode: params.handoff.paymentMode,
      transactionCallCount: transactionPlanCallCount(params.handoff.transactionPlan),
    },
    preparedDraftRevision: params.handoff.preparedDraftRevision,
    requestBody,
    status: params.handoff.status,
    transactionHashes: params.handoff.transactionHashes,
    transactionPlan: params.handoff.transactionPlan,
    updatedAt: params.handoff.updatedAt.toISOString(),
    walletAddress: params.handoff.walletAddress,
  };
}

export async function createAgentAskHandoff(params: {
  appBaseUrl: string;
  generatedImages?: unknown;
  generatedImageUploads?: unknown;
  rateLimitSubjectId?: string;
  requestBody: unknown;
  ttlMs?: number;
}) {
  const originalRequestBody = asJsonObject(params.requestBody, "Handoff request body");
  const inferredHeadToHead = normalizeInferredHeadToHeadAbRequestBody(originalRequestBody);
  const requestBody = inferredHeadToHead.requestBody;

  const generatedImages = readGeneratedImages(params.generatedImages);
  const generatedImageUploads = readGeneratedImageUploads(params.generatedImageUploads);
  if (generatedImages.length > 0 && generatedImageUploads.length > 0) {
    throw new AgentAskHandoffError("Use generatedImages or generatedImageUploads, not both.");
  }
  await assertGeneratedImagesProcessable(generatedImages);
  const totalStagingBytes = [...generatedImages, ...generatedImageUploads].reduce(
    (sum, image) => sum + image.sizeBytes,
    0,
  );
  if (params.rateLimitSubjectId && totalStagingBytes > 0) {
    await reserveImageUploadDailyQuotas({
      sizeBytes: totalStagingBytes,
      subjects: [{ subjectId: params.rateLimitSubjectId, subjectKind: "handoff_ip" }],
    });
  }
  const id = randomHandoffId();
  const token = randomToken();
  const now = nowDate();
  const ttl = resolveHandoffTtl(params.ttlMs);
  const expiresAt = new Date(now.getTime() + ttl.effectiveTtlMs);
  const assets = [
    ...generatedImages.map(image => ({
      ...image,
      attachmentId: createImageAttachmentId(),
      id: randomAssetId(),
      status: "staged" as const,
    })),
    ...generatedImageUploads.map(image => ({
      ...image,
      attachmentId: createImageAttachmentId(),
      id: randomAssetId(),
      status: "uploading" as const,
    })),
  ];
  const validationImageUrls = assets.map(asset => assetImageUrl(params.appBaseUrl, asset.attachmentId, asset.sha256));
  const normalized = normalizeAgentAskHandoffRequestBody({ requestBody, validationImageUrls });
  const storedRequestBody = sealSensitiveAgentRequestFields(requestBody, token);
  const storedOriginalRequestBody = sealSensitiveAgentRequestFields(originalRequestBody, token);

  await assertAgentAskHandoffDraftSchemaReady();
  await assertAgentAskHandoffAssetPositionSchemaReady();

  await dbClient.execute({
    sql: `
      INSERT INTO agent_ask_handoff_intents (
        id,
        token_hash,
        status,
        chain_id,
        client_request_id,
        payment_mode,
        wallet_address,
        request_body,
        original_request_body,
        draft_revision,
        prepared_draft_revision,
        edited_by_user,
        expires_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      id,
      hashToken(token),
      // Both image and image-free handoffs start in "pending"; image handoffs
      // advance to awaiting_image_signatures only once prepare is called.
      "pending",
      normalized.parsed.chainId,
      normalized.parsed.clientRequestId,
      normalized.paymentMode,
      normalized.walletAddress,
      JSON.stringify(storedRequestBody),
      JSON.stringify(storedOriginalRequestBody),
      0,
      null,
      false,
      expiresAt,
      now,
      now,
    ],
  });

  for (const [position, asset] of assets.entries()) {
    await dbClient.execute({
      sql: `
        INSERT INTO agent_ask_handoff_assets (
          id,
          handoff_id,
          attachment_id,
          position,
          status,
          original_filename,
          mime_type,
          size_bytes,
          sha256,
          image_base64,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        asset.id,
        id,
        asset.attachmentId,
        position,
        asset.status,
        asset.filename,
        asset.mimeType,
        asset.sizeBytes,
        asset.sha256,
        asset.imageBase64,
        now,
        now,
      ],
    });
  }

  const handoff = await loadAgentAskHandoffByToken({ handoffId: id, token });
  const storedAssets = await listAgentAskHandoffAssets(id);
  return {
    ...buildAgentAskHandoffResponse({ assets: storedAssets, handoff }),
    effectiveTtlMs: ttl.effectiveTtlMs,
    handoffId: id,
    handoffToken: token,
    handoffUrl: handoffUrl({ appBaseUrl: params.appBaseUrl, handoffId: id, token }),
    nextAction:
      generatedImageUploads.length > 0
        ? "Upload each staged image through the handoff asset upload route, then share handoffUrl with the user."
        : "Share handoffUrl with the user. Do not ask the user to paste raw wallet signatures.",
    resultTool: "rateloop_get_result",
    statusTool: "rateloop_get_handoff_status",
    warnings: [
      ...ttl.warnings,
      ...(inferredHeadToHead.inferred
        ? [
            `auto_converted_head_to_head_ab: inferred A = ${inferredHeadToHead.inferred.optionALabel}, B = ${inferredHeadToHead.inferred.optionBLabel}`,
          ]
        : []),
    ],
  };
}

export async function loadAgentAskHandoffAssetUploadTarget(params: {
  assetId: string;
  handoffId: string;
  token: string;
}) {
  const handoff = await loadAgentAskHandoffByToken({ handoffId: params.handoffId, token: params.token });
  if (handoff.status === "submitted") {
    throw new AgentAskHandoffError("Handoff ask has already been submitted.", 409);
  }

  const assets = await listAgentAskHandoffAssets(handoff.id);
  const asset = assets.find(candidate => candidate.id === params.assetId || candidate.attachmentId === params.assetId);
  if (!asset) {
    throw new AgentAskHandoffError("Handoff image asset was not found.", 404);
  }
  if (asset.status !== "uploading") {
    throw new AgentAskHandoffError(`Handoff image asset cannot be uploaded from status ${asset.status}.`, 409);
  }

  return { asset, handoff };
}

export async function stageAgentAskHandoffAssetUpload(params: {
  assetId: string;
  buffer: Buffer;
  contentType?: string | null;
  handoffId: string;
}) {
  const assets = await listAgentAskHandoffAssets(params.handoffId);
  const asset = assets.find(candidate => candidate.id === params.assetId || candidate.attachmentId === params.assetId);
  if (!asset) {
    throw new AgentAskHandoffError("Handoff image asset was not found.", 404);
  }
  if (asset.status !== "uploading") {
    throw new AgentAskHandoffError(`Handoff image asset cannot be staged from status ${asset.status}.`, 409);
  }
  if (params.contentType && params.contentType.toLowerCase() !== asset.mimeType) {
    throw new AgentAskHandoffError("Uploaded image content type does not match the staged handoff metadata.");
  }

  const image = normalizeGeneratedImage(
    {
      filename: asset.originalFilename,
      imageBase64: params.buffer.toString("base64"),
      mimeType: asset.mimeType,
      sha256: asset.sha256,
      sizeBytes: asset.sizeBytes,
    },
    0,
  );
  await assertGeneratedImagesProcessable([image]);

  const now = nowDate();
  const result = await dbClient.execute({
    sql: `
      UPDATE agent_ask_handoff_assets
      SET status = 'staged',
          mime_type = ?,
          size_bytes = ?,
          sha256 = ?,
          image_base64 = ?,
          error = NULL,
          updated_at = ?
      WHERE id = ?
        AND handoff_id = ?
        AND status = 'uploading'
    `,
    args: [image.mimeType, image.sizeBytes, image.sha256, image.imageBase64, now, asset.id, params.handoffId],
  });
  if (result.rowCount === 0) {
    throw new AgentAskHandoffError("Handoff image asset changed before upload staging completed.", 409);
  }

  return { ...asset, ...image, status: "staged" as const, updatedAt: now };
}

export async function updateAgentAskHandoffStatus(params: {
  chainId?: number | null;
  error?: string | null;
  expectedDraftRevision?: number;
  handoffId: string;
  operationKey?: string | null;
  payloadHash?: string | null;
  paymentMode?: AgentAskHandoffPaymentMode;
  preparedDraftRevision?: number | null;
  status: AgentAskHandoffStatus;
  transactionHashes?: Hex[];
  transactionPlan?: JsonObject | null;
  walletAddress?: Address | null;
}) {
  await assertAgentAskHandoffDraftSchemaReady();

  const now = nowDate();
  const result = await dbClient.execute({
    sql: `
      UPDATE agent_ask_handoff_intents
      SET status = ?,
          chain_id = COALESCE(?, chain_id),
          wallet_address = COALESCE(?, wallet_address),
          payment_mode = COALESCE(?, payment_mode),
          operation_key = COALESCE(?, operation_key),
          payload_hash = COALESCE(?, payload_hash),
          prepared_draft_revision = COALESCE(?, prepared_draft_revision),
          transaction_plan = CASE WHEN ? = 1 THEN NULL ELSE COALESCE(?, transaction_plan) END,
          transaction_hashes = COALESCE(?, transaction_hashes),
          error = ?,
          completed_at = CASE WHEN ? = 'submitted' THEN ? ELSE completed_at END,
          updated_at = ?
      WHERE id = ?
        AND status NOT IN ('submitted', 'expired')
        AND draft_revision = COALESCE(CAST(? AS integer), draft_revision)
    `,
    args: [
      params.status,
      params.chainId ?? null,
      params.walletAddress ?? null,
      params.paymentMode ?? null,
      params.operationKey ?? null,
      params.payloadHash ?? null,
      params.preparedDraftRevision ?? null,
      params.transactionPlan === null ? 1 : 0,
      params.transactionPlan === undefined
        ? null
        : params.transactionPlan
          ? JSON.stringify(params.transactionPlan)
          : null,
      params.transactionHashes ? JSON.stringify(params.transactionHashes) : null,
      params.error ?? null,
      params.status,
      now,
      now,
      params.handoffId,
      params.expectedDraftRevision ?? null,
    ],
  });
  if (params.expectedDraftRevision !== undefined && result.rowCount === 0) {
    throw new AgentAskHandoffError(
      "Handoff draft changed while preparing. Review the saved draft and prepare again.",
      409,
    );
  }
}

export async function updateAgentAskHandoffFeedbackBonusStatus(params: {
  error?: string | null;
  handoffId: string;
  status: AgentAskHandoffFeedbackBonusStatus;
  transactionHashes?: Hex[];
}) {
  await assertAgentAskHandoffFeedbackBonusRecoverySchemaReady();

  const now = nowDate();
  await dbClient.execute({
    sql: `
      UPDATE agent_ask_handoff_intents
      SET feedback_bonus_status = ?,
          feedback_bonus_transaction_hashes = COALESCE(?, feedback_bonus_transaction_hashes),
          feedback_bonus_error = ?,
          updated_at = ?
      WHERE id = ?
        AND status != 'expired'
    `,
    args: [
      params.status,
      params.transactionHashes ? JSON.stringify(params.transactionHashes) : null,
      params.error ?? null,
      now,
      params.handoffId,
    ],
  });
}

export function assertHandoffCanEditDraft(handoff: AgentAskHandoffRecord) {
  assertFresh(handoff);
  if (handoff.status !== "pending" && handoff.status !== "failed") {
    throw new AgentAskHandoffError(
      `Handoff draft cannot be edited after preparation has started. Current status: ${handoff.status}.`,
      409,
    );
  }
}

export async function updateAgentAskHandoffDraft(params: {
  handoff: AgentAskHandoffRecord;
  requestBody: unknown;
  token: string;
  validationImageUrls?: string[];
}) {
  assertHandoffCanEditDraft(params.handoff);
  await assertAgentAskHandoffDraftSchemaReady();
  await assertAgentAskHandoffFeedbackBonusRecoverySchemaReady();

  const normalized = normalizeAgentAskHandoffRequestBody({
    fieldName: "requestBody",
    requestBody: params.requestBody,
    validationImageUrls: params.validationImageUrls,
  });
  const draftRequestBody = withHandoffDraftClientRequestId(normalized.requestBody, params.handoff);
  const draftNormalized =
    draftRequestBody === normalized.requestBody
      ? normalized
      : normalizeAgentAskHandoffRequestBody({
          fieldName: "requestBody",
          requestBody: draftRequestBody,
          validationImageUrls: params.validationImageUrls,
        });
  const storedRequestBody = sealSensitiveAgentRequestFields(draftNormalized.requestBody, params.token);
  const storedOriginalRequestBody = sealSensitiveAgentRequestFields(params.handoff.originalRequestBody, params.token, {
    preserveEncryptedFields: true,
  });
  const now = nowDate();
  const result = await dbClient.execute({
    sql: `
      UPDATE agent_ask_handoff_intents
      SET status = 'pending',
          chain_id = ?,
          client_request_id = ?,
          payment_mode = ?,
          wallet_address = ?,
          request_body = ?,
          original_request_body = ?,
          draft_revision = draft_revision + 1,
          edited_by_user = true,
          prepared_draft_revision = NULL,
          operation_key = NULL,
          payload_hash = NULL,
          transaction_plan = NULL,
          transaction_hashes = NULL,
          feedback_bonus_transaction_hashes = NULL,
          feedback_bonus_status = NULL,
          feedback_bonus_error = NULL,
          error = NULL,
          updated_at = ?
      WHERE id = ?
        AND status IN ('pending', 'failed')
    `,
    args: [
      draftNormalized.parsed.chainId,
      draftNormalized.parsed.clientRequestId,
      draftNormalized.paymentMode,
      draftNormalized.walletAddress,
      JSON.stringify(storedRequestBody),
      JSON.stringify(storedOriginalRequestBody),
      now,
      params.handoff.id,
    ],
  });
  if (result.rowCount === 0) {
    throw new AgentAskHandoffError("Handoff draft changed state before it could be saved.", 409);
  }
}

export async function restoreAgentAskHandoffOriginalDraft(params: {
  handoff: AgentAskHandoffRecord;
  token: string;
  validationImageUrls?: string[];
}) {
  await updateAgentAskHandoffDraft({
    handoff: params.handoff,
    requestBody: unsealSensitiveAgentRequestFields(params.handoff.originalRequestBody, params.token),
    token: params.token,
    validationImageUrls: params.validationImageUrls,
  });
}

export async function updateAgentAskHandoffAsset(params: {
  assetId: string;
  error?: string | null;
  imageUrl?: string | null;
  status: AgentAskHandoffAssetRecord["status"];
}) {
  const now = nowDate();
  await dbClient.execute({
    sql: `
      UPDATE agent_ask_handoff_assets
      SET status = ?,
          image_url = COALESCE(?, image_url),
          error = ?,
          updated_at = ?
      WHERE id = ?
    `,
    args: [params.status, params.imageUrl ?? null, params.error ?? null, now, params.assetId],
  });
}

export function buildAskBodyWithUploadedHandoffImages(params: {
  assets: AgentAskHandoffAssetRecord[];
  handoff: AgentAskHandoffRecord;
  token: string;
}) {
  const imageUrls = params.assets.map(asset => asset.imageUrl).filter((url): url is string => Boolean(url));
  if (params.assets.length > 0 && imageUrls.length !== params.assets.length) {
    throw new AgentAskHandoffError("All staged images must be uploaded before preparing the ask.");
  }
  return cloneWithImageUrls(unsealSensitiveAgentRequestFields(params.handoff.requestBody, params.token), imageUrls);
}

export function assertHandoffCanPrepare(handoff: AgentAskHandoffRecord) {
  assertFresh(handoff);
  if (handoff.status === "submitted") {
    throw new AgentAskHandoffError("Handoff ask has already been submitted.", 409);
  }
  if (handoff.status === "prepared") {
    return;
  }
  if (handoff.status !== "pending" && handoff.status !== "awaiting_image_signatures" && handoff.status !== "failed") {
    throw new AgentAskHandoffError(`Handoff cannot be prepared from status ${handoff.status}.`, 409);
  }
}

export function assertClientRequestId(value: unknown) {
  const clientRequestId = readRequiredString(value, "clientRequestId");
  if (!CLIENT_REQUEST_ID_PATTERN.test(clientRequestId)) {
    throw new AgentAskHandoffError(
      "clientRequestId must be 4-160 characters using letters, numbers, dot, dash, colon, or underscore.",
    );
  }
  return clientRequestId;
}

export async function sweepExpiredHandoffIntents(limit = 100) {
  const now = nowDate();
  const expired = await dbClient.execute({
    sql: `
      SELECT id
      FROM agent_ask_handoff_intents
      WHERE expires_at <= ?
        AND status NOT IN ('submitted')
      ORDER BY expires_at ASC
      LIMIT ?
    `,
    args: [now, limit],
  });

  let deleted = 0;
  for (const row of expired.rows as Array<{ id: string }>) {
    await dbClient.execute({
      sql: "DELETE FROM agent_ask_handoff_assets WHERE handoff_id = ?",
      args: [row.id],
    });
    await dbClient.execute({
      sql: "DELETE FROM agent_ask_handoff_intents WHERE id = ?",
      args: [row.id],
    });
    deleted += 1;
  }

  return { deleted };
}

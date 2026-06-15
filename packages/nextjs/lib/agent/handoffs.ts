import { createHash, randomBytes } from "crypto";
import "server-only";
import { type Address, type Hex, isAddress } from "viem";
import {
  assertProcessableImageBuffer,
  assertSupportedImageSignature,
  createImageAttachmentId,
  reserveImageUploadDailyQuotas,
} from "~~/lib/attachments/imageAttachments";
import { getMaxImageUploadSizeBytes, isSupportedImageUploadMimeType } from "~~/lib/auth/imageUploadChallenge.shared";
import { dbClient } from "~~/lib/db";
import { parseX402QuestionRequest } from "~~/lib/x402/questionPayload";
import { X402QuestionConfigError, resolveX402QuestionConfig } from "~~/lib/x402/questionSubmission";

type JsonObject = Record<string, unknown>;

export type AgentAskHandoffStatus =
  | "pending"
  | "awaiting_image_signatures"
  | "uploading_images"
  | "prepared"
  | "feedback_bonus_prepared"
  | "submitted"
  | "failed"
  | "expired";

export type AgentAskHandoffRecord = {
  chainId: number | null;
  clientRequestId: string | null;
  completedAt: Date | null;
  createdAt: Date;
  draftRevision: number;
  editedByUser: boolean;
  error: string | null;
  expiresAt: Date;
  id: string;
  operationKey: `0x${string}` | null;
  originalRequestBody: JsonObject;
  payloadHash: string | null;
  paymentMode: "wallet_calls";
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
  sha256: string;
  sizeBytes: number;
  status: "staged" | "uploaded" | "failed";
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

const DEFAULT_HANDOFF_TTL_MS = 30 * 60 * 1000;
const MAX_HANDOFF_TTL_MS = 24 * 60 * 60 * 1000;
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

type ErrorWithCause = {
  cause?: unknown;
  code?: unknown;
  message?: unknown;
};

let handoffDraftSchemaReadyPromise: Promise<void> | null = null;
let handoffDraftSchemaReadyForTests: boolean | null = null;

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

function readRequiredString(value: unknown, fieldName: string) {
  const stringValue = readOptionalString(value);
  if (!stringValue) {
    throw new AgentAskHandoffError(`${fieldName} is required.`);
  }
  return stringValue;
}

function readPositiveSizeBytes(value: unknown, fallback: number) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new AgentAskHandoffError("generatedImages[].sizeBytes must be a positive integer.");
  }
  return parsed;
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
    id: String(row.id),
    operationKey: typeof row.operation_key === "string" ? (row.operation_key as `0x${string}`) : null,
    originalRequestBody: parseStoredJson(String(row.original_request_body ?? row.request_body)),
    payloadHash: typeof row.payload_hash === "string" ? row.payload_hash : null,
    paymentMode: "wallet_calls",
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
    sha256: imageData.sha256,
    sizeBytes: imageData.sizeBytes,
    status: String(row.status) as AgentAskHandoffAssetRecord["status"],
    updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(String(row.updated_at)),
  };
}

function handoffUrl(params: { handoffId: string; origin: string; token: string }) {
  const url = new URL(`/agent/handoff/${params.handoffId}`, params.origin);
  url.hash = `token=${encodeURIComponent(params.token)}`;
  return url.toString();
}

function assetImageUrl(origin: string, attachmentId: string, sha256: string) {
  const url = new URL(`/api/attachments/images/${attachmentId}.webp`, origin);
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
    throw new AgentAskHandoffError("generatedImages[].imageBase64 must be base64-encoded image bytes.");
  }
  const buffer = Buffer.from(normalized, "base64");
  if (buffer.length === 0) {
    throw new AgentAskHandoffError("generatedImages[].imageBase64 must be base64-encoded image bytes.");
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
    throw new AgentAskHandoffError(`generatedImages[${index}].dataUrl must be a base64 image data URL.`);
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
    throw new AgentAskHandoffError(`generatedImages[${index}].sizeBytes must match the decoded image byte length.`);
  }
  if (sizeBytes > getMaxImageUploadSizeBytes()) {
    throw new AgentAskHandoffError(`generatedImages[${index}] exceeds the maximum image upload size.`);
  }
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const suppliedSha256 = readOptionalString(input.sha256).toLowerCase();
  if (suppliedSha256 && suppliedSha256 !== sha256) {
    throw new AgentAskHandoffError(`generatedImages[${index}].sha256 must match the decoded image bytes.`);
  }

  return {
    filename,
    imageBase64: buffer.toString("base64"),
    mimeType,
    sha256,
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

function assertWalletCallsPaymentMode(requestBody: JsonObject) {
  const paymentMode = readOptionalString(requestBody.paymentMode ?? requestBody.fundingMode) || "wallet_calls";
  if (paymentMode !== "wallet_calls") {
    throw new AgentAskHandoffError("Browser handoff links currently support paymentMode=wallet_calls.");
  }
}

function assertHandoffChainSubmitReady(chainId: number) {
  try {
    resolveX402QuestionConfig(chainId);
  } catch (error) {
    if (error instanceof X402QuestionConfigError) {
      throw new AgentAskHandoffError(
        `Chain ${chainId} is not available for browser handoffs on this server: ${error.message}`,
      );
    }
    throw error;
  }
}

export function buildAgentAskHandoffValidationImageUrls(params: {
  assets: AgentAskHandoffAssetRecord[];
  origin: string;
}) {
  return params.assets.map(asset => asset.imageUrl ?? assetImageUrl(params.origin, asset.attachmentId, asset.sha256));
}

export function normalizeAgentAskHandoffRequestBody(params: {
  fieldName?: string;
  requestBody: unknown;
  validationImageUrls?: string[];
}) {
  const requestBody = asJsonObject(params.requestBody, params.fieldName ?? "Handoff request body");
  assertWalletCallsPaymentMode(requestBody);

  const validationBody = stripHandoffOnlyValidationFields(
    cloneWithImageUrls(requestBody, params.validationImageUrls ?? []),
  );
  const parsed = parseX402QuestionRequest(validationBody);
  assertHandoffChainSubmitReady(parsed.chainId);
  const walletAddress = readOptionalAddress(
    requestBody.walletAddress ?? requestBody.agentWalletAddress,
    "walletAddress",
  );

  return {
    parsed,
    requestBody,
    walletAddress,
  };
}

function assertFresh(handoff: AgentAskHandoffRecord) {
  if (handoff.expiresAt.getTime() <= Date.now()) {
    throw new AgentAskHandoffError("Handoff link has expired.", 410);
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
  const result = await dbClient.execute({
    sql: `
      SELECT *
      FROM agent_ask_handoff_assets
      WHERE handoff_id = ?
      ORDER BY created_at ASC
    `,
    args: [handoffId],
  });
  return result.rows.map(row => rowToAsset(row));
}

export function readHandoffTokenFromHeaders(headers: Pick<Headers, "get">) {
  return headers.get(HANDOFF_TOKEN_HEADER)?.trim() ?? "";
}

export function buildAgentAskHandoffResponse(params: {
  assets: AgentAskHandoffAssetRecord[];
  handoff: AgentAskHandoffRecord;
  includeImageData?: boolean;
}) {
  const failedAsset = params.assets.find(asset => asset.status === "failed");
  const nextAction = (() => {
    if (params.handoff.status === "failed" && failedAsset) {
      return "Image upload failed. Ask the agent for a fresh handoff link with a regenerated or re-exported image.";
    }
    if (params.handoff.status === "failed") {
      return "Review the handoff error, save any needed draft changes, then retry preparation or ask the agent for a fresh link.";
    }
    if (params.handoff.status === "expired") {
      return "Ask the agent for a fresh handoff link.";
    }
    if (params.handoff.status === "submitted") {
      return "Use resultTool or the public result URL to inspect the submitted ask.";
    }
    if (params.handoff.status === "prepared" || params.handoff.status === "feedback_bonus_prepared") {
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

  return {
    assets: params.assets.map(asset => ({
      attachmentId: asset.attachmentId,
      dataUrl: params.includeImageData ? `data:${asset.mimeType};base64,${asset.imageBase64}` : undefined,
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
    id: params.handoff.id,
    nextAction,
    operationKey: params.handoff.operationKey,
    originalRequestBody: params.handoff.originalRequestBody,
    payloadHash: params.handoff.payloadHash,
    paymentMode: params.handoff.paymentMode,
    preparedDraftRevision: params.handoff.preparedDraftRevision,
    requestBody: params.handoff.requestBody,
    status: params.handoff.status,
    transactionHashes: params.handoff.transactionHashes,
    transactionPlan: params.handoff.transactionPlan,
    updatedAt: params.handoff.updatedAt.toISOString(),
    walletAddress: params.handoff.walletAddress,
  };
}

export async function createAgentAskHandoff(params: {
  generatedImages?: unknown;
  origin: string;
  rateLimitSubjectId?: string;
  requestBody: unknown;
  ttlMs?: number;
}) {
  const requestBody = asJsonObject(params.requestBody, "Handoff request body");
  assertWalletCallsPaymentMode(requestBody);

  const generatedImages = readGeneratedImages(params.generatedImages);
  await assertGeneratedImagesProcessable(generatedImages);
  const totalStagingBytes = generatedImages.reduce((sum, image) => sum + image.sizeBytes, 0);
  if (params.rateLimitSubjectId && totalStagingBytes > 0) {
    await reserveImageUploadDailyQuotas({
      sizeBytes: totalStagingBytes,
      subjects: [{ subjectId: params.rateLimitSubjectId, subjectKind: "handoff_ip" }],
    });
  }
  const id = randomHandoffId();
  const token = randomToken();
  const now = nowDate();
  const ttlMs = Math.min(Math.max(params.ttlMs ?? DEFAULT_HANDOFF_TTL_MS, 60_000), DEFAULT_HANDOFF_TTL_MS);
  const expiresAt = new Date(now.getTime() + ttlMs);
  const assets = generatedImages.map(image => ({
    ...image,
    attachmentId: createImageAttachmentId(),
    id: randomAssetId(),
  }));
  const validationImageUrls = assets.map(asset => assetImageUrl(params.origin, asset.attachmentId, asset.sha256));
  const normalized = normalizeAgentAskHandoffRequestBody({ requestBody, validationImageUrls });

  await assertAgentAskHandoffDraftSchemaReady();

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
      "wallet_calls",
      normalized.walletAddress,
      JSON.stringify(requestBody),
      JSON.stringify(requestBody),
      0,
      null,
      false,
      expiresAt,
      now,
      now,
    ],
  });

  for (const asset of assets) {
    await dbClient.execute({
      sql: `
        INSERT INTO agent_ask_handoff_assets (
          id,
          handoff_id,
          attachment_id,
          status,
          original_filename,
          mime_type,
          size_bytes,
          sha256,
          image_base64,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        asset.id,
        id,
        asset.attachmentId,
        "staged",
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
    handoffId: id,
    handoffToken: token,
    handoffUrl: handoffUrl({ handoffId: id, origin: params.origin, token }),
    nextAction: "Share handoffUrl with the user. Do not ask the user to paste raw wallet signatures.",
    resultTool: "rateloop_get_result",
    statusTool: "rateloop_get_handoff_status",
  };
}

export async function updateAgentAskHandoffStatus(params: {
  chainId?: number | null;
  error?: string | null;
  expectedDraftRevision?: number;
  handoffId: string;
  operationKey?: string | null;
  payloadHash?: string | null;
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
          operation_key = COALESCE(?, operation_key),
          payload_hash = COALESCE(?, payload_hash),
          prepared_draft_revision = COALESCE(?, prepared_draft_revision),
          transaction_plan = COALESCE(?, transaction_plan),
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
      params.operationKey ?? null,
      params.payloadHash ?? null,
      params.preparedDraftRevision ?? null,
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
  validationImageUrls?: string[];
}) {
  assertHandoffCanEditDraft(params.handoff);
  await assertAgentAskHandoffDraftSchemaReady();

  const normalized = normalizeAgentAskHandoffRequestBody({
    fieldName: "requestBody",
    requestBody: params.requestBody,
    validationImageUrls: params.validationImageUrls,
  });
  const now = nowDate();
  const result = await dbClient.execute({
    sql: `
      UPDATE agent_ask_handoff_intents
      SET status = 'pending',
          chain_id = ?,
          client_request_id = ?,
          wallet_address = ?,
          request_body = ?,
          draft_revision = draft_revision + 1,
          edited_by_user = true,
          prepared_draft_revision = NULL,
          operation_key = NULL,
          payload_hash = NULL,
          transaction_plan = NULL,
          transaction_hashes = NULL,
          error = NULL,
          updated_at = ?
      WHERE id = ?
        AND status IN ('pending', 'failed')
    `,
    args: [
      normalized.parsed.chainId,
      normalized.parsed.clientRequestId,
      normalized.walletAddress,
      JSON.stringify(normalized.requestBody),
      now,
      params.handoff.id,
    ],
  });
  if (result.rowCount === 0) {
    throw new AgentAskHandoffError("Handoff draft changed state before it could be saved.", 409);
  }
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
}) {
  const imageUrls = params.assets.map(asset => asset.imageUrl).filter((url): url is string => Boolean(url));
  if (params.assets.length > 0 && imageUrls.length !== params.assets.length) {
    throw new AgentAskHandoffError("All staged images must be uploaded before preparing the ask.");
  }
  return cloneWithImageUrls(params.handoff.requestBody, imageUrls);
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

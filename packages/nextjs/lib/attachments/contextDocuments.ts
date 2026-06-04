import { createHash, randomBytes } from "crypto";
import { and, eq } from "drizzle-orm";
import "server-only";
import {
  CONTEXT_DOCUMENT_MIME_TYPE_MARKDOWN,
  CONTEXT_DOCUMENT_MIME_TYPE_TEXT,
  getMaxContextDocumentUploadSizeBytes,
  normalizeContextDocumentMimeType,
} from "~~/lib/auth/contextDocumentUploadChallenge.shared";
import { db } from "~~/lib/db";
import { type QuestionContextDocument, questionContextDocuments } from "~~/lib/db/schema";

const CONTEXT_DOCUMENT_ROUTE_PREFIX = "/context/documents";
const DEFAULT_CONTEXT_DOCUMENT_TEXT_PREVIEW_LENGTH = 600;
const OPENAI_MODERATION_MODEL = "omni-moderation-latest";
const MODERATION_CHUNK_MAX_CHARS = 10_000;
const CONTEXT_DOCUMENT_ID_PATTERN = /^doc_[A-Za-z0-9_-]{16,80}$/;
const BLOCKED_MODERATION_CATEGORIES = new Set([
  "sexual/minors",
  "sexual",
  "violence/graphic",
  "self-harm/instructions",
  "hate/threatening",
  "harassment/threatening",
  "illicit/violent",
]);

type ContextDocumentStatus = "approved" | "blocked" | "failed" | "deleted";

export type ContextDocumentUploaderIdentity =
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

export type CreateContextDocumentFromBufferParams = {
  buffer: Buffer;
  clientRequestId?: string | null;
  documentId: string;
  filename: string;
  mimeType: string;
  requestUrl: string;
  sha256: string;
  sizeBytes: number;
  uploader: ContextDocumentUploaderIdentity;
};

type ModerationDecision = {
  provider: string;
  result: unknown;
  status: "approved" | "blocked" | "review_required";
};

export type ContextDocumentUploadResult = {
  contextUrl: string | null;
  documentId: string;
  error: string | null;
  moderationStatus: string;
  nextAction: string;
  preview: string | null;
  status: ContextDocumentStatus;
};

function nowDate() {
  return new Date();
}

export function createContextDocumentId() {
  return `doc_${randomBytes(18).toString("base64url")}`;
}

export function isContextDocumentId(value: string) {
  return CONTEXT_DOCUMENT_ID_PATTERN.test(value);
}

function getContextDocumentPath(documentId: string) {
  return `${CONTEXT_DOCUMENT_ROUTE_PREFIX}/${documentId}`;
}

function getConfiguredContextDocumentBaseUrl() {
  const rawValue =
    process.env.APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    (process.env.VERCEL_URL?.trim() ? `https://${process.env.VERCEL_URL.trim()}` : "");
  if (!rawValue) return null;

  try {
    const parsed = new URL(rawValue);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString().replace(/\/$/, "") : null;
  } catch {
    return null;
  }
}

export function getContextDocumentUrl(requestUrl: string, documentId: string) {
  return new URL(getContextDocumentPath(documentId), getConfiguredContextDocumentBaseUrl() ?? requestUrl).toString();
}

export function parseContextDocumentIdFromContextUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    const match = parsed.pathname.match(/^\/context\/documents\/(doc_[A-Za-z0-9_-]{16,80})$/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export async function getContextDocument(id: string): Promise<QuestionContextDocument | null> {
  const [document] = await db
    .select()
    .from(questionContextDocuments)
    .where(eq(questionContextDocuments.id, id))
    .limit(1);
  return document ?? null;
}

function assertSupportedDocumentInput(params: {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  sha256: string;
  sizeBytes: number;
}) {
  if (params.filename.trim().length === 0) {
    throw new Error("Filename is required.");
  }

  const normalizedMimeType = normalizeContextDocumentMimeType(params.filename, params.mimeType);
  if (!normalizedMimeType) {
    throw new Error("Upload a TXT or Markdown document.");
  }
  if (!Number.isSafeInteger(params.sizeBytes) || params.sizeBytes <= 0) {
    throw new Error("Document upload size is invalid.");
  }
  if (params.sizeBytes > getMaxContextDocumentUploadSizeBytes()) {
    throw new Error("Document is too large.");
  }
  if (params.buffer.byteLength !== params.sizeBytes) {
    throw new Error("Uploaded document size does not match the signed metadata.");
  }

  const actualSha256 = createHash("sha256").update(params.buffer).digest("hex");
  if (actualSha256 !== params.sha256) {
    throw new Error("Document hash does not match the signed upload metadata.");
  }
}

function normalizeContextDocumentText(buffer: Buffer) {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error("Document must be valid UTF-8 text.");
  }

  const normalized = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
  if (!normalized) {
    throw new Error("Document is empty.");
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(normalized)) {
    throw new Error("Document contains unsupported control characters.");
  }
  return normalized;
}

function hasOpenAiModerationKey() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

function isDevelopmentModerationExplicitlyDisabled() {
  return process.env.NODE_ENV !== "production" && process.env.RATELOOP_CONTEXT_DOCUMENT_MODERATION_MODE === "disabled";
}

function isDevModerationSkipAllowed() {
  return process.env.NODE_ENV !== "production" && !hasOpenAiModerationKey();
}

function textChunks(text: string) {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += MODERATION_CHUNK_MAX_CHARS) {
    chunks.push(text.slice(index, index + MODERATION_CHUNK_MAX_CHARS));
  }
  return chunks;
}

async function moderateContextDocumentText(text: string): Promise<ModerationDecision> {
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

  const results: Array<{
    categories?: Record<string, boolean>;
    flagged?: boolean;
  }> = [];

  for (const chunk of chunks) {
    const response = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODERATION_MODEL,
        input: chunk,
      }),
    });

    const result = (await response.json().catch(() => null)) as {
      results?: Array<{
        categories?: Record<string, boolean>;
        flagged?: boolean;
      }>;
    } | null;

    if (!response.ok) {
      return {
        provider: "openai",
        status: "review_required",
        result: result ?? { error: `OpenAI moderation failed with ${response.status}` },
      };
    }

    results.push(result?.results?.[0] ?? {});
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

function uploadResult(params: { document: QuestionContextDocument; requestUrl: string }): ContextDocumentUploadResult {
  const preview = params.document.normalizedText
    ? params.document.normalizedText.slice(0, DEFAULT_CONTEXT_DOCUMENT_TEXT_PREVIEW_LENGTH)
    : null;
  return {
    contextUrl:
      params.document.status === "approved" ? getContextDocumentUrl(params.requestUrl, params.document.id) : null,
    documentId: params.document.id,
    error: params.document.error,
    moderationStatus: params.document.moderationStatus,
    nextAction:
      params.document.status === "approved"
        ? "Use contextUrl as the question context source."
        : "Fix the document and upload a new TXT or Markdown file before submitting.",
    preview,
    status: params.document.status as ContextDocumentStatus,
  };
}

export async function createContextDocumentFromBuffer(params: CreateContextDocumentFromBufferParams) {
  if (!isContextDocumentId(params.documentId)) {
    throw new Error("Invalid document id.");
  }

  const normalizedMimeType = normalizeContextDocumentMimeType(params.filename, params.mimeType);
  if (!normalizedMimeType) {
    throw new Error("Upload a TXT or Markdown document.");
  }

  const createdAt = nowDate();
  const baseValues = {
    id: params.documentId,
    uploaderKind: params.uploader.kind,
    ownerWalletAddress: params.uploader.ownerWalletAddress,
    agentId: params.uploader.kind === "agent" ? params.uploader.agentId : null,
    clientRequestId: params.clientRequestId ?? null,
    originalFilename: params.filename.slice(0, 180),
    mimeType: normalizedMimeType,
    sizeBytes: params.sizeBytes,
    sha256: params.sha256,
    createdAt,
    updatedAt: createdAt,
  };

  let normalizedText: string | null = null;
  let moderation: ModerationDecision | null = null;
  let status: ContextDocumentStatus = "failed";
  let error: string | null = null;

  try {
    assertSupportedDocumentInput({
      buffer: params.buffer,
      filename: params.filename,
      mimeType: normalizedMimeType,
      sha256: params.sha256,
      sizeBytes: params.sizeBytes,
    });
    normalizedText = normalizeContextDocumentText(params.buffer);
    moderation = await moderateContextDocumentText(normalizedText);
    status = moderation.status === "approved" ? "approved" : "blocked";
    error = moderation.status === "review_required" ? "Document requires moderation review before publication." : null;
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Document processing failed.";
  }

  const [created] = await db
    .insert(questionContextDocuments)
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
    throw new Error("Context document already exists.");
  }

  return uploadResult({ document: created, requestUrl: params.requestUrl });
}

export async function getContextDocumentSubmissionValidationError(params: {
  agentId?: string | null;
  contextUrl: string;
  ownerWalletAddress?: string | null;
}): Promise<string | null> {
  const documentId = parseContextDocumentIdFromContextUrl(params.contextUrl);
  if (!documentId) return null;

  const document = await getContextDocument(documentId);
  if (!document || document.status !== "approved") {
    return "Document context must come from an approved RateLoop upload.";
  }

  const ownerWalletAddress = params.ownerWalletAddress?.trim().toLowerCase() || null;
  const agentId = params.agentId?.trim() || null;
  const ownedByAgent = agentId !== null && document.agentId === agentId;
  const ownedByWallet =
    ownerWalletAddress !== null && document.ownerWalletAddress?.trim().toLowerCase() === ownerWalletAddress;

  return ownedByAgent || ownedByWallet ? null : "Uploaded document context must belong to the submitting wallet or agent.";
}

export async function attachContextDocumentToContent(params: {
  agentId?: string | null;
  contentId: string;
  contextUrl: string;
  ownerWalletAddress?: string | null;
}) {
  const documentId = parseContextDocumentIdFromContextUrl(params.contextUrl);
  if (!documentId) return;

  const updatedAt = nowDate();
  await db
    .update(questionContextDocuments)
    .set({
      contentId: params.contentId,
      updatedAt,
    })
    .where(
      and(
        eq(questionContextDocuments.id, documentId),
        params.agentId
          ? eq(questionContextDocuments.agentId, params.agentId)
          : eq(questionContextDocuments.ownerWalletAddress, params.ownerWalletAddress ?? ""),
      ),
    );
}

export function getContextDocumentKind(document: Pick<QuestionContextDocument, "mimeType">) {
  return document.mimeType === CONTEXT_DOCUMENT_MIME_TYPE_MARKDOWN ? "Markdown" : "Text";
}

export function getContextDocumentFileExtension(document: Pick<QuestionContextDocument, "mimeType">) {
  return document.mimeType === CONTEXT_DOCUMENT_MIME_TYPE_TEXT ? ".txt" : ".md";
}

import {
  RateLoopSdkError,
  type TokenlessQuoteRequest,
  normalizeTokenlessQuestion,
  normalizeTokenlessQuoteRequest,
} from "@rateloop/sdk";
import { createHash, randomBytes } from "node:crypto";
import "server-only";
import { TokenlessMcpToolError } from "~~/lib/mcp/errors";
import { validatePublicQuestionMediaPreviewCapability } from "~~/lib/tokenless/publicQuestionMediaPreview";
import { getTokenlessAskByIdempotencyKey } from "~~/lib/tokenless/server";

export const TOKENLESS_HANDOFF_VERSION = "rateloop.handoff.v1" as const;
const HANDOFF_TTL_MS = 24 * 60 * 60_000;
const DEFAULT_RESPONSE_WINDOW_SECONDS = 3_600;
const MAX_FRAGMENT_BYTES = 16 * 1024;
const HANDOFF_ID_PATTERN = /^rhl_[A-Za-z0-9_-]{32}$/;
const HANDOFF_TOKEN_PATTERN = /^rht_[A-Za-z0-9_-]{43}_([0-9a-z]{6,12})$/;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const ATOMIC_PATTERN = /^(0|[1-9]\d*)$/;
const AUDIENCE_SOURCES = ["customer_invited", "rateloop_network", "hybrid"] as const;
const DATA_CLASSIFICATIONS = ["public", "synthetic", "redacted"] as const;

type JsonRecord = Record<string, unknown>;
export type TokenlessHandoffAccess = { handoffId: string; handoffToken: string };
export type TokenlessHandoffMediaPreview = {
  assetId: string;
  digest: `sha256:${string}`;
  previewCapability: string;
};
export type TokenlessHandoffPayload = {
  version: typeof TOKENLESS_HANDOFF_VERSION;
  handoffId: string;
  handoffToken: string;
  idempotencyKey: string;
  expiresAt: string;
  dataClassification: (typeof DATA_CLASSIFICATIONS)[number];
  mediaPreviews: TokenlessHandoffMediaPreview[];
  redactionSummary: string;
  request: TokenlessQuoteRequest;
};

function toolError(message: string, code: string): never {
  throw new TokenlessMcpToolError(message, code);
}

function record(value: unknown, path: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value))
    toolError(`${path} must be an object.`, "invalid_params");
  return value as JsonRecord;
}

function exact(input: JsonRecord, allowed: readonly string[], path: string) {
  const unexpected = Object.keys(input).find(key => !allowed.includes(key));
  if (unexpected) toolError(`${path}.${unexpected} is not supported.`, "invalid_params");
}

function string(value: unknown, path: string, minimum: number, maximum: number) {
  if (typeof value !== "string" || value.trim().length < minimum || value.length > maximum) {
    toolError(`${path} must contain ${minimum}-${maximum} characters.`, "invalid_params");
  }
  return value;
}

function atomic(value: unknown, path: string) {
  if (typeof value !== "string" || !ATOMIC_PATTERN.test(value)) {
    toolError(`${path} must be an unsigned base-10 atomic amount.`, "invalid_quote");
  }
  return value;
}

export function parseMcpQuoteRequest(value: unknown): TokenlessQuoteRequest {
  const input = record(value, "request");
  exact(input, ["audience", "audiencePolicy", "budget", "question", "requestedPanelSize"], "request");
  const audience = record(input.audience, "request.audience");
  exact(audience, ["admissionPolicyHash", "source"], "request.audience");
  const source = audience.source;
  if (!AUDIENCE_SOURCES.includes(source as (typeof AUDIENCE_SOURCES)[number])) {
    toolError("request.audience.source is unsupported.", "invalid_quote");
  }
  if (typeof audience.admissionPolicyHash !== "string" || !BYTES32_PATTERN.test(audience.admissionPolicyHash)) {
    toolError("request.audience.admissionPolicyHash must be a bytes32 hex value.", "invalid_quote");
  }

  const budget = record(input.budget, "request.budget");
  exact(budget, ["attemptReserveAtomic", "bountyAtomic", "feeBps"], "request.budget");
  const bountyAtomic = atomic(budget.bountyAtomic, "request.budget.bountyAtomic");
  const attemptReserveAtomic = atomic(budget.attemptReserveAtomic, "request.budget.attemptReserveAtomic");
  if (BigInt(bountyAtomic) === 0n) toolError("request.budget.bountyAtomic must be greater than zero.", "invalid_quote");
  if (!Number.isSafeInteger(budget.feeBps) || Number(budget.feeBps) < 0 || Number(budget.feeBps) > 2_000) {
    toolError("request.budget.feeBps must be between 0 and 2000.", "invalid_quote");
  }
  if (
    !Number.isSafeInteger(input.requestedPanelSize) ||
    Number(input.requestedPanelSize) < 3 ||
    Number(input.requestedPanelSize) > 500
  ) {
    toolError("request.requestedPanelSize must be an integer from 3 to 500.", "invalid_quote");
  }
  const requestedPanelSize = Number(input.requestedPanelSize);
  if (BigInt(attemptReserveAtomic) < BigInt(requestedPanelSize)) {
    toolError(
      "request.budget.attemptReserveAtomic must fund a non-zero compensation cap for every accepted rater.",
      "invalid_quote",
    );
  }

  let parsedQuestion: TokenlessQuoteRequest["question"];
  try {
    parsedQuestion = normalizeTokenlessQuestion(input.question);
  } catch (error) {
    if (error instanceof RateLoopSdkError) toolError(error.message, "invalid_quote");
    throw error;
  }

  try {
    return normalizeTokenlessQuoteRequest({
      audience: {
        admissionPolicyHash: audience.admissionPolicyHash as `0x${string}`,
        source: source as TokenlessQuoteRequest["audience"]["source"],
      },
      audiencePolicy: input.audiencePolicy as TokenlessQuoteRequest["audiencePolicy"],
      budget: { attemptReserveAtomic, bountyAtomic, feeBps: Number(budget.feeBps) },
      question: parsedQuestion,
      requestedPanelSize,
      responseWindowSeconds: DEFAULT_RESPONSE_WINDOW_SECONDS,
    });
  } catch (error) {
    if (error instanceof RateLoopSdkError) toolError(error.message, "invalid_quote");
    throw error;
  }
}

function parseMediaPreviews(value: unknown, request: TokenlessQuoteRequest, now: Date) {
  const imageItems = request.question.media?.kind === "images" ? request.question.media.items : [];
  if (imageItems.length === 0) {
    if (value !== undefined && (!Array.isArray(value) || value.length > 0)) {
      toolError("mediaPreviews are supported only for image handoffs.", "invalid_media_preview_capability");
    }
    return { expiresAt: null, mediaPreviews: [] as TokenlessHandoffMediaPreview[] };
  }
  if (!Array.isArray(value) || value.length !== imageItems.length) {
    toolError(
      "Every staged handoff image requires exactly one preview capability.",
      "media_preview_capability_required",
    );
  }
  const expected = new Map(imageItems.map(item => [item.assetId, item.digest]));
  const seen = new Set<string>();
  const expiryTimes: number[] = [];
  const mediaPreviews = value.map((raw, index) => {
    const item = record(raw, `mediaPreviews[${index}]`);
    exact(item, ["assetId", "digest", "previewCapability"], `mediaPreviews[${index}]`);
    const assetId = string(item.assetId, `mediaPreviews[${index}].assetId`, 1, 100);
    const digest = string(item.digest, `mediaPreviews[${index}].digest`, 1, 80);
    const previewCapability = string(item.previewCapability, `mediaPreviews[${index}].previewCapability`, 1, 160);
    if (expected.get(assetId) !== digest || seen.has(assetId)) {
      toolError(
        "Media preview capabilities must match each exact handoff asset and digest once.",
        "invalid_media_preview_capability",
      );
    }
    const validated = validatePublicQuestionMediaPreviewCapability({
      assetId,
      capability: previewCapability,
      digest,
      now,
    });
    if (!validated) {
      toolError("A media preview capability is invalid or expired.", "invalid_media_preview_capability");
    }
    seen.add(assetId);
    expiryTimes.push(validated.expiresAt.getTime());
    return {
      assetId,
      digest: digest as `sha256:${string}`,
      previewCapability,
    };
  });
  return { expiresAt: new Date(Math.min(...expiryTimes)), mediaPreviews };
}

export function deriveMcpHandoffIdempotencyKey(input: TokenlessHandoffAccess) {
  if (!HANDOFF_ID_PATTERN.test(input.handoffId) || !HANDOFF_TOKEN_PATTERN.test(input.handoffToken)) {
    toolError("The handoff bearer capability is invalid.", "invalid_handoff_capability");
  }
  return `mcp:${createHash("sha256").update(`${input.handoffId}\0${input.handoffToken}`).digest("base64url")}`;
}

function handoffExpiry(handoffToken: string) {
  const match = HANDOFF_TOKEN_PATTERN.exec(handoffToken);
  if (!match) toolError("The handoff bearer capability is invalid.", "invalid_handoff_capability");
  const expirySeconds = Number.parseInt(match[1], 36);
  if (!Number.isSafeInteger(expirySeconds)) {
    toolError("The handoff bearer capability is invalid.", "invalid_handoff_capability");
  }
  return new Date(expirySeconds * 1_000);
}

export function assertActiveMcpHandoff(input: TokenlessHandoffAccess, now = new Date()) {
  const idempotencyKey = deriveMcpHandoffIdempotencyKey(input);
  const expiresAt = handoffExpiry(input.handoffToken);
  if (expiresAt <= now) toolError("The handoff bearer capability expired.", "handoff_expired");
  if (expiresAt.getTime() > now.getTime() + HANDOFF_TTL_MS + 60_000) {
    toolError("The handoff bearer capability is invalid.", "invalid_handoff_capability");
  }
  return { expiresAt, idempotencyKey };
}

export function createMcpHandoff(
  value: unknown,
  origin: string,
  options: { now?: Date; random?: (size: number) => Buffer } = {},
) {
  const input = record(value, "arguments");
  exact(
    input,
    ["request", "dataClassification", "redactionSummary", "confirmedNoSensitiveData", "mediaPreviews"],
    "arguments",
  );
  if (input.confirmedNoSensitiveData !== true) {
    toolError(
      "confirmedNoSensitiveData must be true before creating a browser handoff.",
      "sensitive_data_confirmation_required",
    );
  }
  if (!DATA_CLASSIFICATIONS.includes(input.dataClassification as (typeof DATA_CLASSIFICATIONS)[number])) {
    toolError("dataClassification must be public, synthetic, or redacted.", "invalid_params");
  }
  const redactionSummary = string(input.redactionSummary, "redactionSummary", 10, 1_000).trim();
  const request = {
    ...parseMcpQuoteRequest(input.request),
    visibility: "public" as const,
    dataClassification: input.dataClassification as "public" | "synthetic" | "redacted",
    redactionSummary,
    confirmedNoSensitiveData: true as const,
  };
  const now = options.now ?? new Date();
  const preview = parseMediaPreviews(input.mediaPreviews, request, now);
  const random = options.random ?? randomBytes;
  const defaultExpiry = Math.floor((now.getTime() + HANDOFF_TTL_MS) / 1_000) * 1_000;
  const expiresAt = new Date(Math.min(defaultExpiry, preview.expiresAt?.getTime() ?? defaultExpiry));
  const handoffId = `rhl_${random(24).toString("base64url")}`;
  const handoffToken = `rht_${random(32).toString("base64url")}_${Math.floor(expiresAt.getTime() / 1_000).toString(36)}`;
  const idempotencyKey = deriveMcpHandoffIdempotencyKey({ handoffId, handoffToken });
  const payload: TokenlessHandoffPayload = {
    version: TOKENLESS_HANDOFF_VERSION,
    handoffId,
    handoffToken,
    idempotencyKey,
    expiresAt: expiresAt.toISOString(),
    dataClassification: input.dataClassification as TokenlessHandoffPayload["dataClassification"],
    mediaPreviews: preview.mediaPreviews,
    redactionSummary,
    request,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  if (Buffer.byteLength(`#payload=${encodedPayload}`, "utf8") > MAX_FRAGMENT_BYTES) {
    toolError("The handoff payload exceeds the 16 KiB browser fragment limit.", "handoff_payload_too_large");
  }
  const handoffUrl = new URL("/handoff", origin);
  handoffUrl.hash = `payload=${encodedPayload}`;
  return {
    expiresAt: payload.expiresAt,
    handoffId,
    handoffToken,
    handoffUrl: handoffUrl.toString(),
    status: "prepared" as const,
    warning: "The handoff URL and token are bearer capabilities. Share them only with the intended approver.",
  };
}

export async function getMcpHandoffStatus(value: unknown, options: { now?: Date } = {}) {
  const input = record(value, "arguments");
  exact(input, ["handoffId", "handoffToken"], "arguments");
  const handoffId = string(input.handoffId, "handoffId", 1, 80);
  const handoffToken = string(input.handoffToken, "handoffToken", 1, 120);
  const { idempotencyKey } = assertActiveMcpHandoff({ handoffId, handoffToken }, options.now);
  const ask = await getTokenlessAskByIdempotencyKey(idempotencyKey);
  if (!ask) return { handoffId, operationKey: null, status: "prepared" as const, updatedAt: null, verdictStatus: null };
  return {
    handoffId,
    operationKey: ask.operationKey,
    status: ask.result ? ("ready" as const) : ask.status,
    updatedAt: ask.updatedAt,
    verdictStatus: ask.result?.verdictStatus ?? ask.verdictStatus,
  };
}

export async function getMcpHandoffResult(value: unknown, options: { now?: Date } = {}) {
  const input = record(value, "arguments");
  exact(input, ["handoffId", "handoffToken"], "arguments");
  const handoffId = string(input.handoffId, "handoffId", 1, 80);
  const handoffToken = string(input.handoffToken, "handoffToken", 1, 120);
  const { idempotencyKey } = assertActiveMcpHandoff({ handoffId, handoffToken }, options.now);
  const ask = await getTokenlessAskByIdempotencyKey(idempotencyKey);
  if (!ask) return { handoffId, operationKey: null, result: null, status: "prepared" as const };
  return {
    handoffId,
    operationKey: ask.operationKey,
    result: ask.result,
    status: ask.result ? ("ready" as const) : ask.status,
  };
}

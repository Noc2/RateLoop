import { put } from "@vercel/blob/client";
import type { HandoffGeneratedImageFile } from "./handoffImages";

type AgentsRuntimeConfig = {
  apiBaseUrl?: string;
  mcpAccessToken?: string;
  mcpApiUrl?: string;
};

type HandoffAssetResponse = {
  error?: unknown;
  id?: unknown;
  status?: unknown;
};

type AskHandoffResponse = Record<string, unknown> & {
  assets?: HandoffAssetResponse[];
  handoffId?: string;
  handoffToken?: string;
};

const INLINE_IMAGE_JSON_BUDGET_BYTES = 3 * 1024 * 1024;
const BLOB_MULTIPART_UPLOAD_THRESHOLD_BYTES = 5 * 1024 * 1024;
const HANDOFF_JSON_REQUEST_TIMEOUT_MS = 10_000;
const STAGED_UPLOAD_POLL_INTERVAL_MS = 1_000;
const STAGED_UPLOAD_POLL_TIMEOUT_MS = 90_000;
export const DEFAULT_HANDOFF_API_BASE_URL = "https://www.rateloop.ai";

function deriveApiBaseUrlFromMcpApiUrl(mcpApiUrl: string | undefined) {
  if (!mcpApiUrl) return undefined;

  const url = new URL(mcpApiUrl);
  const pathname = url.pathname.replace(/\/+$/, "");
  for (const suffix of ["/api/mcp/public", "/api/mcp"]) {
    if (pathname === suffix || pathname.endsWith(suffix)) {
      url.pathname = pathname.slice(0, -suffix.length) || "/";
      url.search = "";
      url.hash = "";
      return url.toString().replace(/\/+$/, "");
    }
  }

  throw new Error(
    "RATELOOP_API_BASE_URL is required for staged image handoffs when RATELOOP_MCP_API_URL is not a standard /api/mcp endpoint.",
  );
}

function resolveHandoffApiBaseUrl(config: AgentsRuntimeConfig) {
  return (
    config.apiBaseUrl ??
    deriveApiBaseUrlFromMcpApiUrl(config.mcpApiUrl) ??
    DEFAULT_HANDOFF_API_BASE_URL
  );
}

function apiUrl(config: AgentsRuntimeConfig, pathname: string) {
  const apiBaseUrl = resolveHandoffApiBaseUrl(config);
  return new URL(
    pathname.replace(/^\/+/, ""),
    `${apiBaseUrl.replace(/\/+$/, "")}/`,
  ).toString();
}

function jsonHeaders(config: AgentsRuntimeConfig) {
  return {
    ...(config.mcpAccessToken
      ? { authorization: `Bearer ${config.mcpAccessToken}` }
      : {}),
    "content-type": "application/json",
  };
}

function handoffReadHeaders(config: AgentsRuntimeConfig, token: string) {
  return {
    ...(config.mcpAccessToken
      ? { authorization: `Bearer ${config.mcpAccessToken}` }
      : {}),
    "x-rateloop-handoff-token": token,
  };
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function responseErrorMessage(body: unknown, fallback: string) {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const record = body as Record<string, unknown>;
    if (typeof record.error === "string" && record.error.trim())
      return record.error;
    if (typeof record.message === "string" && record.message.trim())
      return record.message;
  }
  return fallback;
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(HANDOFF_JSON_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`RateLoop request timed out after ${HANDOFF_JSON_REQUEST_TIMEOUT_MS}ms.`);
    }
    throw error;
  }
  const body = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(
      responseErrorMessage(
        body,
        `RateLoop request failed with status ${response.status}.`,
      ),
    );
  }
  return body as T;
}

function handoffGeneratedImageUploadMetadata(image: HandoffGeneratedImageFile) {
  return {
    filename: image.filename,
    mimeType: image.mimeType,
    sha256: image.sha256,
    sizeBytes: image.sizeBytes,
  };
}

function sanitizePathSegment(value: string) {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 180) || "image";
}

function stripLargeImageFields<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripLargeImageFields) as T;
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) =>
      key === "dataUrl" || key === "imageBase64"
        ? []
        : [[key, stripLargeImageFields(entry)]],
    ),
  ) as T;
}

function assertHandoffIdentifiers(
  response: AskHandoffResponse,
): asserts response is AskHandoffResponse & {
  handoffId: string;
  handoffToken: string;
} {
  if (typeof response.handoffId !== "string" || !response.handoffId) {
    throw new Error("RateLoop handoff response did not include handoffId.");
  }
  if (typeof response.handoffToken !== "string" || !response.handoffToken) {
    throw new Error("RateLoop handoff response did not include handoffToken.");
  }
}

async function requestHandoffImageUploadToken(params: {
  asset: HandoffAssetResponse;
  config: AgentsRuntimeConfig;
  handoffId: string;
  image: HandoffGeneratedImageFile;
  multipart: boolean;
  pathname: string;
  token: string;
}) {
  const assetId = typeof params.asset.id === "string" ? params.asset.id : "";
  if (!assetId) {
    throw new Error(
      "RateLoop handoff response did not include an image asset id.",
    );
  }

  const response = await requestJson<{ clientToken?: unknown }>(
    apiUrl(
      params.config,
      `/api/agent/handoffs/${encodeURIComponent(params.handoffId)}/assets/${encodeURIComponent(assetId)}/upload`,
    ),
    {
      body: JSON.stringify({
        type: "blob.generate-client-token",
        payload: {
          clientPayload: JSON.stringify({
            ...handoffGeneratedImageUploadMetadata(params.image),
            token: params.token,
          }),
          multipart: params.multipart,
          pathname: params.pathname,
        },
      }),
      headers: jsonHeaders(params.config),
      method: "POST",
    },
  );
  if (typeof response.clientToken !== "string" || !response.clientToken) {
    throw new Error("RateLoop did not return a handoff image upload token.");
  }
  return response.clientToken;
}

async function uploadHandoffGeneratedImage(params: {
  asset: HandoffAssetResponse;
  config: AgentsRuntimeConfig;
  handoffId: string;
  image: HandoffGeneratedImageFile;
  token: string;
}) {
  const assetId = typeof params.asset.id === "string" ? params.asset.id : "";
  const multipart =
    params.image.sizeBytes > BLOB_MULTIPART_UPLOAD_THRESHOLD_BYTES;
  const pathname = [
    "agent-handoffs",
    sanitizePathSegment(params.handoffId),
    sanitizePathSegment(assetId),
    sanitizePathSegment(params.image.filename),
  ].join("/");
  const clientToken = await requestHandoffImageUploadToken({
    asset: params.asset,
    config: params.config,
    handoffId: params.handoffId,
    image: params.image,
    multipart,
    pathname,
    token: params.token,
  });

  await put(
    pathname,
    new Blob([new Uint8Array(params.image.buffer)], {
      type: params.image.mimeType,
    }),
    {
      access: "private",
      contentType: params.image.mimeType,
      multipart,
      token: clientToken,
    },
  );
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function allImagesStaged(response: AskHandoffResponse, expectedCount: number) {
  const assets = Array.isArray(response.assets) ? response.assets : [];
  if (assets.length < expectedCount) return false;
  const activeAssets = assets.slice(0, expectedCount);
  const failed = activeAssets.find((asset) => asset.status === "failed");
  if (failed) {
    throw new Error(
      typeof failed.error === "string" && failed.error
        ? failed.error
        : "RateLoop handoff image upload failed.",
    );
  }
  return activeAssets.every((asset) => asset.status !== "uploading");
}

async function waitForStagedHandoffImages(params: {
  config: AgentsRuntimeConfig;
  expectedCount: number;
  handoffId: string;
  token: string;
}) {
  const deadline = Date.now() + STAGED_UPLOAD_POLL_TIMEOUT_MS;
  let latest: AskHandoffResponse | null = null;
  while (Date.now() < deadline) {
    latest = await requestJson<AskHandoffResponse>(
      apiUrl(
        params.config,
        `/api/agent/handoffs/${encodeURIComponent(params.handoffId)}`,
      ),
      {
        headers: handoffReadHeaders(params.config, params.token),
        method: "GET",
      },
    );
    if (allImagesStaged(latest, params.expectedCount))
      return stripLargeImageFields(latest);
    await wait(STAGED_UPLOAD_POLL_INTERVAL_MS);
  }

  throw new Error(
    "RateLoop handoff image upload is still staging. Retry rateloop_get_handoff_status shortly.",
  );
}

export function shouldStageHandoffImageUploads(
  images: readonly HandoffGeneratedImageFile[],
) {
  return (
    images.reduce((sum, image) => sum + image.imageBase64.length, 0) >
    INLINE_IMAGE_JSON_BUDGET_BYTES
  );
}

export function inlineHandoffGeneratedImage(image: HandoffGeneratedImageFile) {
  return {
    filename: image.filename,
    imageBase64: image.imageBase64,
    mimeType: image.mimeType,
    sha256: image.sha256,
    sizeBytes: image.sizeBytes,
  };
}

export async function createAskHandoffWithStagedImageUploads(params: {
  config: AgentsRuntimeConfig;
  generatedImages: HandoffGeneratedImageFile[];
  request: unknown;
  ttlMs?: number;
}) {
  const created = await requestJson<AskHandoffResponse>(
    apiUrl(params.config, "/api/agent/handoffs"),
    {
      body: JSON.stringify({
        generatedImageUploads: params.generatedImages.map(
          handoffGeneratedImageUploadMetadata,
        ),
        request: params.request,
        ttlMs: params.ttlMs,
      }),
      headers: jsonHeaders(params.config),
      method: "POST",
    },
  );
  assertHandoffIdentifiers(created);

  const assets = Array.isArray(created.assets) ? created.assets : [];
  if (assets.length < params.generatedImages.length) {
    throw new Error(
      "RateLoop handoff response did not include every generated image asset.",
    );
  }

  for (const [index, image] of params.generatedImages.entries()) {
    await uploadHandoffGeneratedImage({
      asset: assets[index],
      config: params.config,
      handoffId: created.handoffId,
      image,
      token: created.handoffToken,
    });
  }

  const staged = await waitForStagedHandoffImages({
    config: params.config,
    expectedCount: params.generatedImages.length,
    handoffId: created.handoffId,
    token: created.handoffToken,
  });
  const stagedNextAction =
    typeof staged.nextAction === "string" && staged.nextAction.trim()
      ? staged.nextAction
      : undefined;

  return {
    ...stripLargeImageFields(created),
    ...staged,
    handoffId: created.handoffId,
    handoffToken: created.handoffToken,
    handoffUrl: created.handoffUrl,
    nextAction:
      stagedNextAction ??
      "Share handoffUrl with the user. Do not ask the user to paste raw wallet signatures.",
    resultTool: created.resultTool,
    statusTool: created.statusTool,
  };
}

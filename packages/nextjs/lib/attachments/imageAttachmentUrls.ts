import { isLocalE2EProductionBuildEnabled } from "~~/utils/env/e2eProduction";

const IMAGE_ATTACHMENT_PATH_PATTERN = /^\/api\/attachments\/images\/(att_[A-Za-z0-9_-]{16,80})\.webp$/;
const IMAGE_ATTACHMENT_SHA256_FRAGMENT_PATTERN = /^#sha256=0x([a-fA-F0-9]{64})$/;
const WALLET_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

const DEFAULT_IMAGE_ATTACHMENT_ORIGINS = ["https://www.rateloop.ai", "https://rateloop.ai"] as const;
const IMAGE_ATTACHMENT_FETCH_URL_BASE = "https://www.rateloop.ai";

type UploadedImageAttachmentUrlOptions = {
  allowedOrigins?: readonly string[];
  allowLocalhostOrigins?: boolean;
};

type UploadedImageAttachmentUrl = {
  attachmentId: string;
  origin: string;
  sha256: string;
  url: string;
};

function normalizeOrigin(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

function isLocalhostOrigin(origin: string) {
  try {
    const parsed = new URL(origin);
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function getBrowserOrigin() {
  if (typeof window === "undefined") return null;
  return normalizeOrigin(window.location.origin);
}

function shouldAllowLocalhostOrigins(options: UploadedImageAttachmentUrlOptions) {
  return options.allowLocalhostOrigins ?? (process.env.NODE_ENV !== "production" || isLocalE2EProductionBuildEnabled());
}

function getDefaultImageAttachmentAllowedOrigins() {
  return [
    ...new Set(
      [
        ...DEFAULT_IMAGE_ATTACHMENT_ORIGINS,
        normalizeOrigin(process.env.APP_URL),
        normalizeOrigin(process.env.NEXT_PUBLIC_APP_URL),
        normalizeOrigin(process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null),
        getBrowserOrigin(),
      ].filter((origin): origin is string => Boolean(origin)),
    ),
  ];
}

function getAllowedOrigins(options: UploadedImageAttachmentUrlOptions) {
  return new Set(
    (options.allowedOrigins ?? getDefaultImageAttachmentAllowedOrigins())
      .map(normalizeOrigin)
      .filter((origin): origin is string => Boolean(origin)),
  );
}

function parseUploadedImageAttachmentUrl(
  value: string,
  options: UploadedImageAttachmentUrlOptions = {},
): UploadedImageAttachmentUrl | null {
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) return null;

    const match = parsed.pathname.match(IMAGE_ATTACHMENT_PATH_PATTERN);
    if (!match) return null;
    if (parsed.search) return null;
    const digestMatch = parsed.hash.match(IMAGE_ATTACHMENT_SHA256_FRAGMENT_PATTERN);
    if (!digestMatch) return null;

    const allowedOrigins = getAllowedOrigins(options);
    const localhostAllowed = shouldAllowLocalhostOrigins(options);
    const isAllowedOrigin = allowedOrigins.has(parsed.origin) || (localhostAllowed && isLocalhostOrigin(parsed.origin));
    const isAllowedProtocol = parsed.protocol === "https:" || (localhostAllowed && parsed.protocol === "http:");
    if (!isAllowedOrigin || !isAllowedProtocol) return null;

    const sha256 = digestMatch[1].toLowerCase();
    parsed.hash = `sha256=0x${sha256}`;

    return {
      attachmentId: match[1],
      origin: parsed.origin,
      sha256,
      url: parsed.toString(),
    };
  } catch {
    return null;
  }
}

function hasOnlyOptionalAddressSearchParam(parsed: URL) {
  if (!parsed.search) return true;
  const params = parsed.searchParams;
  return params.size === 1 && WALLET_ADDRESS_PATTERN.test(params.get("address") ?? "");
}

function parseUploadedImageAttachmentFetchUrl(
  value: string,
  options: UploadedImageAttachmentUrlOptions = {},
): UploadedImageAttachmentUrl | null {
  try {
    const relativePathUrl = value.startsWith("/") && !value.startsWith("//");
    const parsed = new URL(value, IMAGE_ATTACHMENT_FETCH_URL_BASE);
    if (parsed.username || parsed.password) return null;

    const match = parsed.pathname.match(IMAGE_ATTACHMENT_PATH_PATTERN);
    if (!match) return null;
    if (!hasOnlyOptionalAddressSearchParam(parsed)) return null;
    const digestMatch = parsed.hash.match(IMAGE_ATTACHMENT_SHA256_FRAGMENT_PATTERN);
    if (!digestMatch) return null;

    if (!relativePathUrl) {
      const allowedOrigins = getAllowedOrigins(options);
      const localhostAllowed = shouldAllowLocalhostOrigins(options);
      const isAllowedOrigin =
        allowedOrigins.has(parsed.origin) || (localhostAllowed && isLocalhostOrigin(parsed.origin));
      const isAllowedProtocol = parsed.protocol === "https:" || (localhostAllowed && parsed.protocol === "http:");
      if (!isAllowedOrigin || !isAllowedProtocol) return null;
    }

    const sha256 = digestMatch[1].toLowerCase();
    parsed.hash = `sha256=0x${sha256}`;

    return {
      attachmentId: match[1],
      origin: parsed.origin,
      sha256,
      url: relativePathUrl ? `${parsed.pathname}${parsed.search}${parsed.hash}` : parsed.toString(),
    };
  } catch {
    return null;
  }
}

export function normalizeUploadedImageAttachmentUrl(
  value: string,
  options: UploadedImageAttachmentUrlOptions = {},
): string | null {
  return parseUploadedImageAttachmentUrl(value, options)?.url ?? null;
}

export function isUploadedImageAttachmentFetchUrl(
  value: string,
  options: UploadedImageAttachmentUrlOptions = {},
): boolean {
  return Boolean(parseUploadedImageAttachmentFetchUrl(value, options));
}

export function parseAttachmentIdFromUploadedImageUrl(
  value: string,
  options: UploadedImageAttachmentUrlOptions = {},
): string | null {
  return parseUploadedImageAttachmentUrl(value, options)?.attachmentId ?? null;
}

export function parseUploadedImageAttachmentUrlDigest(
  value: string,
  options: UploadedImageAttachmentUrlOptions = {},
): { attachmentId: string; sha256: string } | null {
  const parsed = parseUploadedImageAttachmentUrl(value, options);
  return parsed ? { attachmentId: parsed.attachmentId, sha256: parsed.sha256 } : null;
}

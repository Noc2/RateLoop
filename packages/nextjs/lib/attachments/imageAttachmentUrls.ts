const IMAGE_ATTACHMENT_PATH_PATTERN = /^\/api\/attachments\/images\/(att_[A-Za-z0-9_-]{16,80})\.webp$/;

const DEFAULT_IMAGE_ATTACHMENT_ORIGINS = [
  "https://www.rateloop.xyz",
  "https://rateloop.xyz",
  "https://www.rateloop.xyz",
  "https://rateloop.xyz",
] as const;

type UploadedImageAttachmentUrlOptions = {
  allowedOrigins?: readonly string[];
  allowLocalhostOrigins?: boolean;
};

type UploadedImageAttachmentUrl = {
  attachmentId: string;
  origin: string;
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
  return (
    options.allowLocalhostOrigins ??
    (process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD === "true")
  );
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

    const allowedOrigins = getAllowedOrigins(options);
    const localhostAllowed = shouldAllowLocalhostOrigins(options);
    const isAllowedOrigin = allowedOrigins.has(parsed.origin) || (localhostAllowed && isLocalhostOrigin(parsed.origin));
    const isAllowedProtocol = parsed.protocol === "https:" || (localhostAllowed && parsed.protocol === "http:");
    if (!isAllowedOrigin || !isAllowedProtocol) return null;

    return {
      attachmentId: match[1],
      origin: parsed.origin,
      url: parsed.toString(),
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

export function parseAttachmentIdFromUploadedImageUrl(
  value: string,
  options: UploadedImageAttachmentUrlOptions = {},
): string | null {
  return parseUploadedImageAttachmentUrl(value, options)?.attachmentId ?? null;
}

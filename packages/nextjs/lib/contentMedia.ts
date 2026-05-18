import { normalizeUploadedImageAttachmentUrl } from "~~/lib/attachments/imageAttachmentUrls";
import { sanitizeExternalUrl } from "~~/utils/externalUrl";
import { canonicalizeUrl, detectPlatform } from "~~/utils/platforms";

export const MAX_SUBMISSION_IMAGE_URLS = 4;
export const MAX_SUBMISSION_URL_LENGTH = 2048;
const DIRECT_IMAGE_URL_PATH_PATTERN = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i;

export type ContentMediaType = "image" | "video";

export interface ContentMediaItem {
  mediaIndex: number;
  mediaType: ContentMediaType;
  url: string;
  canonicalUrl?: string | null;
  urlHost?: string | null;
}

export function isUploadedImageUrl(url: string): boolean {
  return Boolean(normalizeUploadedImageUrl(url));
}

export function isYouTubeVideoUrl(url: string): boolean {
  return detectPlatform(url).type === "youtube";
}

export function isDirectImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return DIRECT_IMAGE_URL_PATH_PATTERN.test(parsed.pathname);
  } catch {
    return false;
  }
}

function getContentMediaType(url: string): ContentMediaType | null {
  if (isUploadedImageUrl(url)) return "image";
  if (isYouTubeVideoUrl(url)) return "video";
  return null;
}

export function normalizeSubmissionMediaUrl(value: string): string | null {
  const uploadedImageUrl = normalizeUploadedImageUrl(value);
  if (uploadedImageUrl) return uploadedImageUrl;

  const sanitizedUrl = sanitizeExternalUrl(value);
  if (sanitizedUrl) return canonicalizeUrl(sanitizedUrl);
  return null;
}

export function normalizeSubmissionContextUrl(value: string): string | null {
  const sanitizedUrl = sanitizeExternalUrl(value);
  if (!sanitizedUrl) return null;
  if (isDirectImageUrl(sanitizedUrl)) return null;
  return canonicalizeUrl(sanitizedUrl);
}

function normalizeUploadedImageUrl(value: string): string | null {
  return normalizeUploadedImageAttachmentUrl(value);
}

export function buildFallbackMediaItems(url: string | null | undefined): ContentMediaItem[] {
  const trimmedUrl = url?.trim();
  if (!trimmedUrl) return [];

  const mediaType = getContentMediaType(trimmedUrl);
  if (!mediaType) return [];

  return [
    {
      mediaIndex: 0,
      mediaType,
      url: trimmedUrl,
    },
  ];
}

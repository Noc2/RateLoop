import { normalizeUploadedImageAttachmentUrl } from "~~/lib/attachments/imageAttachmentUrls";
import { sanitizeExternalUrl } from "~~/utils/externalUrl";
import { canonicalizeUrl, detectPlatform } from "~~/utils/platforms";

export const MAX_SUBMISSION_IMAGE_URLS = 4;
export const MAX_SUBMISSION_URL_LENGTH = 2048;

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

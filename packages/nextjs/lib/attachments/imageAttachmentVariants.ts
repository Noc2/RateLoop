export const IMAGE_ATTACHMENT_VARIANTS = ["full", "feed", "preview"] as const;

export type ImageAttachmentVariant = (typeof IMAGE_ATTACHMENT_VARIANTS)[number];

export const DEFAULT_IMAGE_ATTACHMENT_VARIANT: ImageAttachmentVariant = "full";

const IMAGE_ATTACHMENT_VARIANT_SET = new Set<string>(IMAGE_ATTACHMENT_VARIANTS);

export function parseImageAttachmentVariant(value: string | null | undefined): ImageAttachmentVariant | null {
  const trimmed = value?.trim();
  if (!trimmed) return DEFAULT_IMAGE_ATTACHMENT_VARIANT;
  return IMAGE_ATTACHMENT_VARIANT_SET.has(trimmed) ? (trimmed as ImageAttachmentVariant) : null;
}

export function isImageAttachmentVariant(value: string | null | undefined): value is ImageAttachmentVariant {
  return Boolean(value && IMAGE_ATTACHMENT_VARIANT_SET.has(value));
}

export function withImageAttachmentVariantUrl(value: string, variant: ImageAttachmentVariant) {
  const relativePathUrl = value.startsWith("/") && !value.startsWith("//");
  const parsed = new URL(value, "https://www.rateloop.ai");
  if (variant === DEFAULT_IMAGE_ATTACHMENT_VARIANT) {
    parsed.searchParams.delete("variant");
  } else {
    parsed.searchParams.set("variant", variant);
  }
  return relativePathUrl ? `${parsed.pathname}${parsed.search}${parsed.hash}` : parsed.toString();
}

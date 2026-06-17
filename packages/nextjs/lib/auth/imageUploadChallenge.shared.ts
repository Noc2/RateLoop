const SUPPORTED_IMAGE_UPLOAD_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const MAX_IMAGE_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_GENERATED_IMAGES_PER_HANDOFF = 4;
const GENERATED_IMAGES_JSON_SLACK_BYTES = 2 * 1024 * 1024;

const SUPPORTED_UPLOAD_MIME_TYPE_SET = new Set<string>(SUPPORTED_IMAGE_UPLOAD_MIME_TYPES);

export function isSupportedImageUploadMimeType(value: string) {
  return SUPPORTED_UPLOAD_MIME_TYPE_SET.has(value);
}

export function getMaxImageUploadSizeBytes() {
  return MAX_IMAGE_UPLOAD_SIZE_BYTES;
}

/** Upper bound for agent/MCP JSON bodies that may include up to four base64 images. */
export function getAgentGeneratedImagesJsonBudgetBytes() {
  const maxEncodedImageBytes = Math.ceil((MAX_IMAGE_UPLOAD_SIZE_BYTES * MAX_GENERATED_IMAGES_PER_HANDOFF * 4) / 3);
  return maxEncodedImageBytes + GENERATED_IMAGES_JSON_SLACK_BYTES;
}

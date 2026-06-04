export const SUPPORTED_CONTEXT_DOCUMENT_EXTENSIONS = [".txt", ".md"] as const;
export const CONTEXT_DOCUMENT_MIME_TYPE_MARKDOWN = "text/markdown";
export const CONTEXT_DOCUMENT_MIME_TYPE_TEXT = "text/plain";
export const SUPPORTED_CONTEXT_DOCUMENT_MIME_TYPES = [
  CONTEXT_DOCUMENT_MIME_TYPE_TEXT,
  CONTEXT_DOCUMENT_MIME_TYPE_MARKDOWN,
  "text/x-markdown",
] as const;
export const MAX_CONTEXT_DOCUMENT_UPLOAD_SIZE_BYTES = 500 * 1024;

const SUPPORTED_CONTEXT_DOCUMENT_MIME_TYPE_SET = new Set<string>(SUPPORTED_CONTEXT_DOCUMENT_MIME_TYPES);

function lowercaseFilename(value: string) {
  return value.trim().toLowerCase();
}

export function getContextDocumentExtension(filename: string): ".txt" | ".md" | null {
  const normalized = lowercaseFilename(filename);
  if (normalized.endsWith(".txt")) return ".txt";
  if (normalized.endsWith(".md")) return ".md";
  return null;
}

export function isSupportedContextDocumentFilename(filename: string) {
  return getContextDocumentExtension(filename) !== null;
}

export function normalizeContextDocumentMimeType(filename: string, mimeType: string | null | undefined) {
  const extension = getContextDocumentExtension(filename);
  if (!extension) return null;

  const normalizedMimeType = mimeType?.trim().toLowerCase() ?? "";
  if (extension === ".txt") {
    return normalizedMimeType === "" || normalizedMimeType === CONTEXT_DOCUMENT_MIME_TYPE_TEXT
      ? CONTEXT_DOCUMENT_MIME_TYPE_TEXT
      : null;
  }

  if (normalizedMimeType === "" || normalizedMimeType === CONTEXT_DOCUMENT_MIME_TYPE_TEXT) {
    return CONTEXT_DOCUMENT_MIME_TYPE_MARKDOWN;
  }
  if (SUPPORTED_CONTEXT_DOCUMENT_MIME_TYPE_SET.has(normalizedMimeType)) {
    return CONTEXT_DOCUMENT_MIME_TYPE_MARKDOWN;
  }
  return null;
}

export function getMaxContextDocumentUploadSizeBytes() {
  return MAX_CONTEXT_DOCUMENT_UPLOAD_SIZE_BYTES;
}

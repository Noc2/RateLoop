export const SUPPORTED_CONTEXT_DOCUMENT_EXTENSIONS = [".txt", ".md"] as const;
export const CONTEXT_DOCUMENT_MIME_TYPE_MARKDOWN = "text/markdown";
export const CONTEXT_DOCUMENT_MIME_TYPE_TEXT = "text/plain";
export const SUPPORTED_CONTEXT_DOCUMENT_MIME_TYPES = [
  CONTEXT_DOCUMENT_MIME_TYPE_TEXT,
  CONTEXT_DOCUMENT_MIME_TYPE_MARKDOWN,
  "text/x-markdown",
] as const;
export const MAX_CONTEXT_DOCUMENT_UPLOAD_SIZE_BYTES = 500 * 1024;
const MAX_CONTEXT_DOCUMENT_FILENAME_LENGTH = 180;
const FILENAME_CONTROL_CHARS_PATTERN = /[\u0000-\u001F\u007F-\u009F]/g;
const FILENAME_INVISIBLE_FORMAT_CHARS_PATTERN = /[\u061C\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g;
const FILENAME_PATH_SEPARATOR_PATTERN = /[\\\/:\u2044\u2215]+/g;

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

function trimContextDocumentFilename(value: string, extension: ".txt" | ".md") {
  if (value.length <= MAX_CONTEXT_DOCUMENT_FILENAME_LENGTH) return value;

  const maxStemLength = MAX_CONTEXT_DOCUMENT_FILENAME_LENGTH - extension.length;
  const stem = value.slice(0, -extension.length).slice(0, maxStemLength).trim();
  return `${stem || "document"}${extension}`;
}

export function sanitizeContextDocumentFilename(filename: string) {
  const normalized = filename.trim();
  const extension = getContextDocumentExtension(normalized);
  if (!extension) return "";

  const stem = normalized
    .slice(0, -extension.length)
    .replace(FILENAME_CONTROL_CHARS_PATTERN, "")
    .replace(FILENAME_INVISIBLE_FORMAT_CHARS_PATTERN, "")
    .replace(FILENAME_PATH_SEPARATOR_PATTERN, " ")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+/, "")
    .replace(/[.\s]+$/, "")
    .trim();

  return trimContextDocumentFilename(`${stem || "document"}${extension}`, extension);
}

export function normalizeContextDocumentMimeType(filename: string, mimeType: string | null | undefined) {
  const sanitizedFilename = sanitizeContextDocumentFilename(filename);
  const extension = getContextDocumentExtension(sanitizedFilename);
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

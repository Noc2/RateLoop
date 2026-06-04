export const CONTEXT_DOCUMENT_ROUTE_PREFIX = "/context/documents";

const CONTEXT_DOCUMENT_PATH_PATTERN = /^\/context\/documents\/(doc_[A-Za-z0-9_-]{16,80})$/;
const PRODUCTION_CONTEXT_DOCUMENT_ORIGINS = new Set(["https://rateloop.ai", "https://www.rateloop.ai"]);

export type ParsedContextDocumentUrl = {
  documentId: string;
  path: string;
  url: string;
};

function isLocalContextDocumentUrl(parsed: URL) {
  return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
}

export function parseContextDocumentPublicUrl(
  value: string,
  currentOrigin?: string | null,
): ParsedContextDocumentUrl | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const baseUrl = currentOrigin?.trim() || "https://www.rateloop.ai";
    const parsed = new URL(trimmed, baseUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

    const match = parsed.pathname.match(CONTEXT_DOCUMENT_PATH_PATTERN);
    if (!match) return null;

    const currentOriginMatches = Boolean(currentOrigin && parsed.origin === currentOrigin);
    if (
      !currentOriginMatches &&
      !PRODUCTION_CONTEXT_DOCUMENT_ORIGINS.has(parsed.origin) &&
      !isLocalContextDocumentUrl(parsed)
    ) {
      return null;
    }

    return {
      documentId: match[1] ?? "",
      path: parsed.pathname,
      url: parsed.toString(),
    };
  } catch {
    return null;
  }
}

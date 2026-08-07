/**
 * Normalises a browser CSP violation report into something safe to log.
 *
 * The endpoint that receives these is unauthenticated by necessity — the browser
 * posts without credentials — so every field is attacker-controlled and must be
 * treated as untrusted input rather than as telemetry. Two rules follow:
 *
 *   1. **No personal data.** A `document-uri` carries the full URL of the page
 *      the user was on, including its query string, which on this application can
 *      hold a return-to path, an invitation token, or an OAuth `redirect_uri`.
 *      Only origin and pathname survive; the query and fragment are dropped
 *      rather than truncated, because a truncated secret is still a secret.
 *   2. **No unbounded strings.** Every retained value is length-capped so a
 *      crafted report cannot inflate the log line.
 *
 * Chrome sends the Reporting API shape (`application/reports+json`, an array of
 * `{type, body}`); other engines still send the legacy
 * `application/csp-report` shape (`{"csp-report": {...}}`). Both are accepted
 * because dropping either would silently lose the coverage this exists to add.
 */

const MAX_FIELD_LENGTH = 200;
const MAX_REPORTS_PER_REQUEST = 20;

export type NormalizedCspReport = {
  blockedUri: string;
  directive: string;
  documentUri: string;
  disposition: string;
};

function text(value: unknown, fallback = "unknown") {
  if (typeof value !== "string" || !value) return fallback;
  return value.slice(0, MAX_FIELD_LENGTH);
}

/**
 * Keeps the origin and path of a URL and discards everything that can carry a
 * secret. Non-URL values (CSP uses bare tokens such as `inline` and `eval`) are
 * passed through as bounded text.
 */
export function safeReportUrl(value: unknown) {
  const raw = text(value, "");
  if (!raw) return "unknown";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return url.protocol.replace(":", "");
    return `${url.origin}${redactCapabilitySegments(url.pathname)}`.slice(0, MAX_FIELD_LENGTH);
  } catch {
    // `inline`, `eval`, `data`, and scheme-only values are not URLs and carry
    // nothing sensitive, but anything unrecognised is still length-capped.
    return raw;
  }
}

/**
 * Blanks path segments that are themselves capabilities rather than identifiers.
 * `/connect/aci_<32 hex>` is 128 bits of randomness that returns workspace agent
 * metadata to anyone who knows it, so it must not sit in a log line even though
 * it is a path rather than a query parameter.
 */
function redactCapabilitySegments(pathname: string) {
  return pathname.replace(/\/(aci_|shr_|gnt_)[A-Za-z0-9_-]+/gu, "/$1redacted");
}

function normalizeOne(body: Record<string, unknown> | undefined): NormalizedCspReport | null {
  if (!body || typeof body !== "object") return null;
  const directive = body["effective-directive"] ?? body.effectiveDirective ?? body["violated-directive"];
  const blocked = body["blocked-uri"] ?? body.blockedURL;
  const document = body["document-uri"] ?? body.documentURL;
  if (directive === undefined && blocked === undefined && document === undefined) return null;
  return {
    blockedUri: safeReportUrl(blocked),
    directive: text(directive),
    documentUri: safeReportUrl(document),
    disposition: text(body.disposition, "enforce"),
  };
}

/** Accepts either wire shape and returns at most MAX_REPORTS_PER_REQUEST entries. */
export function normalizeCspReports(payload: unknown): NormalizedCspReport[] {
  if (Array.isArray(payload)) {
    return payload
      .slice(0, MAX_REPORTS_PER_REQUEST)
      .filter(
        (entry): entry is { body?: Record<string, unknown>; type?: string } =>
          Boolean(entry) && typeof entry === "object",
      )
      .filter(entry => entry.type === undefined || entry.type === "csp-violation")
      .map(entry => normalizeOne(entry.body))
      .filter((report): report is NormalizedCspReport => report !== null);
  }
  if (payload && typeof payload === "object") {
    const legacy = (payload as Record<string, unknown>)["csp-report"];
    const report = normalizeOne(
      (legacy as Record<string, unknown> | undefined) ?? (payload as Record<string, unknown>),
    );
    return report ? [report] : [];
  }
  return [];
}

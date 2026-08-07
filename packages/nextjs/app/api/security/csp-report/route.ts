import { NextRequest, NextResponse } from "next/server";
import { normalizeCspReports } from "~~/lib/security/contentSecurityPolicyReport";
import { readApiJsonRequestBody } from "~~/lib/tokenless/apiRequestBody";

/**
 * Receives browser CSP violation reports.
 *
 * Until this existed, a policy that blocked something real produced no signal
 * anywhere: the World ID widget's WebAssembly compilation would have failed in
 * production and nothing would have said so. That is the case this endpoint is
 * for — a policy too tight for shipped code — though it catches injected script
 * too.
 *
 * Unauthenticated by necessity: browsers post reports without credentials and do
 * not follow redirects. Everything it receives is therefore untrusted. The body
 * is read through the shared bounded reader so the cap is enforced while the
 * stream is consumed rather than after it is buffered, and every retained field
 * is truncated and stripped of its query string by `normalizeCspReports`.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const MAX_CSP_REPORT_BODY_BYTES = 16 * 1024;

const NO_CONTENT = { headers: { "Cache-Control": "no-store" }, status: 204 } as const;

export function readCspReportBody(request: Pick<Request, "body" | "headers">) {
  return readApiJsonRequestBody(request, MAX_CSP_REPORT_BODY_BYTES);
}

/**
 * The two content types browsers actually use for reports. Requiring one of them
 * is what stops any third-party page making its visitors write here: both are
 * CORS-preflighted, whereas the `text/plain` a crafted `fetch` would send is a
 * simple request that needs no preflight and no cooperation from this origin.
 */
const REPORT_CONTENT_TYPES = ["application/csp-report", "application/reports+json"];

export function isCspReportContentType(header: string | null) {
  const value = (header ?? "").split(";")[0]!.trim().toLowerCase();
  return REPORT_CONTENT_TYPES.includes(value);
}

export async function POST(request: NextRequest) {
  if (!isCspReportContentType(request.headers.get("content-type"))) {
    return new NextResponse(null, NO_CONTENT);
  }
  let payload: unknown;
  try {
    payload = await readCspReportBody(request);
  } catch (unreadable) {
    // Oversized or malformed bodies are dropped without a log line. The endpoint
    // is unauthenticated, so logging what an anonymous caller sends would hand
    // any scanner a way to flood the log — the opposite of the visibility this
    // endpoint exists to provide.
    void unreadable;
    return new NextResponse(null, NO_CONTENT);
  }
  for (const report of normalizeCspReports(payload)) {
    console.warn(JSON.stringify({ event: "csp_violation", ...report }));
  }
  // Always 204: a reporting endpoint that answers with errors teaches the
  // browser nothing and turns a misconfiguration into retry traffic.
  return new NextResponse(null, NO_CONTENT);
}

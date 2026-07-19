import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { SUBJECT_REQUEST_TYPES, type SubjectRequestType } from "~~/lib/privacy/lifecycle";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;

export async function POST(request: NextRequest) {
  try {
    await requireBrowserSession(request, { mutation: true });
    let body: Record<string, unknown> | null;
    try {
      body = (await request.json()) as Record<string, unknown> | null;
    } catch {
      throw new TokenlessServiceError("Subject request body must be valid JSON.", 400, "invalid_privacy_request");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new TokenlessServiceError("Subject request body must be an object.", 400, "invalid_privacy_request");
    }
    if (
      typeof body.requestType !== "string" ||
      !SUBJECT_REQUEST_TYPES.includes(body.requestType as SubjectRequestType)
    ) {
      throw new TokenlessServiceError("Subject request type is invalid.", 400, "invalid_privacy_request");
    }
    throw new TokenlessServiceError(
      "Automated privacy-request intake is not available. Use account settings for account deletion, or contact the operator listed in the privacy notice for other requests.",
      503,
      "privacy_request_intake_unavailable",
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { headers: NO_STORE, status: response.status });
  }
}

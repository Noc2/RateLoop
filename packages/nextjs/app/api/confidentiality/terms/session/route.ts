import { NextRequest, NextResponse } from "next/server";
import { GATED_CONTEXT_SIGNED_READ_SESSION_COOKIE_NAME, verifySignedReadSession } from "~~/lib/auth/signedReadSessions";
import { normalizeConfidentialityTermsInput } from "~~/lib/confidentiality/context";
import { checkRateLimit } from "~~/utils/rateLimit";

const READ_RATE_LIMIT = { limit: 60, windowMs: 60_000 };

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address");
  const contentId = request.nextUrl.searchParams.get("contentId");
  const limited = await checkRateLimit(request, READ_RATE_LIMIT, {
    allowOnStoreUnavailable: true,
    extraKeyParts: [
      typeof address === "string" ? address : undefined,
      typeof contentId === "string" ? contentId : undefined,
    ],
  });
  if (limited) return limited;

  const normalized = normalizeConfidentialityTermsInput({
    address: typeof address === "string" ? address : undefined,
    contentId: typeof contentId === "string" ? contentId : undefined,
  });
  if (!normalized.ok) {
    return NextResponse.json({ error: normalized.error }, { status: 400 });
  }

  try {
    const hasSession = await verifySignedReadSession(
      request.cookies.get(GATED_CONTEXT_SIGNED_READ_SESSION_COOKIE_NAME)?.value,
      normalized.payload.normalizedAddress,
      "gated_context",
    );

    return NextResponse.json({ hasSession });
  } catch (error) {
    console.error("Error checking gated context signed read session:", error);
    return NextResponse.json({ error: "Failed to check gated context session" }, { status: 500 });
  }
}

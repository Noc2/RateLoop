import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { listAssuranceAttestations } from "~~/lib/tokenless/assuranceAttestationPipeline";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;
type Context = { params: Promise<{ workspaceId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    if ([...request.nextUrl.searchParams.keys()].some(key => key !== "limit")) {
      throw new TokenlessServiceError("Attestation query is invalid.", 400, "invalid_assurance_attestation_query");
    }
    const rawLimit = request.nextUrl.searchParams.get("limit");
    const limit = rawLimit === null ? undefined : Number(rawLimit);
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)) {
      throw new TokenlessServiceError("Attestation query is invalid.", 400, "invalid_assurance_attestation_query");
    }
    const session = await requireBrowserSession(request);
    const { workspaceId } = await context.params;
    return NextResponse.json(
      { attestations: await listAssuranceAttestations({ accountAddress: session.principalId, workspaceId, limit }) },
      { headers: NO_STORE },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: NO_STORE });
  }
}

import { type NextRequest, NextResponse } from "next/server";
import { listWorkspaceFundResolutionRequests } from "~~/lib/privacy/workspaceDeletion";
import { authorizeComplianceOperator } from "~~/lib/tokenless/paidEligibility";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;

export async function GET(request: NextRequest) {
  try {
    authorizeComplianceOperator(request.headers.get("authorization"));
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? 50);
    return NextResponse.json(
      { resolutions: await listWorkspaceFundResolutionRequests({ limit }) },
      { headers: NO_STORE },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { headers: NO_STORE, status: response.status });
  }
}

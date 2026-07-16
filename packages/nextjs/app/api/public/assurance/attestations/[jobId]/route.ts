import { NextResponse } from "next/server";
import { getPublicAssuranceAttestationBundle } from "~~/lib/tokenless/assuranceAttestationPipeline";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" } as const;
type Context = { params: Promise<{ jobId: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const { jobId } = await context.params;
    return NextResponse.json(await getPublicAssuranceAttestationBundle(jobId), { headers: NO_STORE });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: NO_STORE });
  }
}

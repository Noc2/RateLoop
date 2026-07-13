import { NextRequest, NextResponse } from "next/server";
import { requireBaseAccountRequest } from "~~/lib/base-account/request";
import {
  assertEvidenceGenerationRequest,
  generateAssuranceEvidencePacket,
  getAssuranceEvidencePacket,
} from "~~/lib/tokenless/evidencePackets";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ runId: string; workspaceId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBaseAccountRequest(request);
    const { runId, workspaceId } = await context.params;
    return NextResponse.json(
      await getAssuranceEvidencePacket({ accountAddress: session.address, workspaceId, runId }),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBaseAccountRequest(request, { mutation: true });
    const text = await request.text();
    let body: unknown;
    try {
      body = text.trim() ? JSON.parse(text) : undefined;
    } catch {
      throw new TokenlessServiceError(
        "Evidence generation request must be valid JSON.",
        400,
        "invalid_assurance_evidence_request",
      );
    }
    assertEvidenceGenerationRequest(body);
    const { runId, workspaceId } = await context.params;
    return NextResponse.json(
      await generateAssuranceEvidencePacket({ accountAddress: session.address, workspaceId, runId }),
      { status: 201, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

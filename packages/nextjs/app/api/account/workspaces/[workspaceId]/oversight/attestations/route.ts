import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import {
  attestOversightDesignation,
  listOversightDesignations,
  revokeOversightDesignation,
} from "~~/lib/tokenless/oversightAttestations";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string }> };

const PUT_KEYS = new Set([
  "memberAccountAddress",
  "competenceBasis",
  "trainingRecords",
  "authorityScope",
  "expiresAt",
  "revoke",
]);

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request);
    const { workspaceId } = await context.params;
    return NextResponse.json(
      { attestations: await listOversightDesignations({ accountAddress: session.principalId, workspaceId }) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function PUT(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      throw new TokenlessServiceError(
        "Oversight attestation request must be valid JSON.",
        400,
        "invalid_oversight_attestation",
      );
    }
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).some(key => !PUT_KEYS.has(key)) ||
      typeof body.memberAccountAddress !== "string"
    ) {
      throw new TokenlessServiceError(
        "An oversight attestation upsert or revocation for one member is required.",
        400,
        "invalid_oversight_attestation",
      );
    }
    const { workspaceId } = await context.params;
    if (body.revoke === true) {
      return NextResponse.json(
        {
          attestation: await revokeOversightDesignation({
            accountAddress: session.principalId,
            workspaceId,
            memberAccountAddress: body.memberAccountAddress,
          }),
        },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    return NextResponse.json(
      {
        attestation: await attestOversightDesignation({
          accountAddress: session.principalId,
          workspaceId,
          memberAccountAddress: body.memberAccountAddress,
          competenceBasis: body.competenceBasis,
          trainingRecords: body.trainingRecords,
          authorityScope: body.authorityScope,
          expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : null,
        }),
      },
      { status: 201, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

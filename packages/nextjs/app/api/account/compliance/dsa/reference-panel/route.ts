import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { readApiJsonRequestBody, rethrowApiRequestBodyBoundaryError } from "~~/lib/tokenless/apiRequestBody";
import { reconcileDsaNamedPanelResponseEvidenceForPrincipal } from "~~/lib/tokenless/dsaNamedReferencePanel";
import { readDsaReferencePanelPilot } from "~~/lib/tokenless/dsaReferencePanelPilot";
import type { DsaReferencePanelPilotResponse } from "~~/lib/tokenless/dsaReferencePanelPilotTypes";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = "private, no-store, max-age=0";
const MAX_BODY_BYTES = 4_096;

type SessionOptions = { mutation?: boolean };
type ReadDependencies = {
  requireSession: (request: NextRequest, options?: SessionOptions) => Promise<{ principalId: string }>;
  readPilot: (input: { accountAddress: string }) => Promise<DsaReferencePanelPilotResponse>;
};
type ReconcileDependencies = {
  requireSession: (request: NextRequest, options?: SessionOptions) => Promise<{ principalId: string }>;
  reconcileResponses: (input: { accountAddress: string }) => Promise<unknown>;
};

export function createDsaReferencePanelPilotGet(
  dependencies: ReadDependencies = {
    requireSession: requireBrowserSession,
    readPilot: readDsaReferencePanelPilot,
  },
) {
  return async function GET(request: NextRequest) {
    try {
      const session = await dependencies.requireSession(request);
      const pilot = await dependencies.readPilot({ accountAddress: session.principalId });
      return NextResponse.json(pilot, { headers: { "Cache-Control": NO_STORE } });
    } catch (error) {
      const response = tokenlessErrorResponse(error);
      return NextResponse.json(response.body, {
        status: response.status,
        headers: { "Cache-Control": NO_STORE },
      });
    }
  };
}

export function createDsaReferencePanelPilotPost(
  dependencies: ReconcileDependencies = {
    requireSession: requireBrowserSession,
    reconcileResponses: reconcileDsaNamedPanelResponseEvidenceForPrincipal,
  },
) {
  return async function POST(request: NextRequest) {
    try {
      const session = await dependencies.requireSession(request, { mutation: true });
      let body: unknown;
      try {
        body = await readApiJsonRequestBody(request, MAX_BODY_BYTES);
      } catch (error) {
        rethrowApiRequestBodyBoundaryError(error);
        throw new TokenlessServiceError(
          "Reference-panel reconciliation must be valid JSON.",
          400,
          "invalid_dsa_named_panel_reconciliation",
        );
      }
      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        Object.keys(body).length !== 1 ||
        (body as Record<string, unknown>).action !== "reconcile_response_evidence"
      ) {
        throw new TokenlessServiceError(
          "Reference-panel reconciliation action is invalid.",
          400,
          "invalid_dsa_named_panel_reconciliation",
        );
      }
      const result = await dependencies.reconcileResponses({ accountAddress: session.principalId });
      return NextResponse.json(result, { headers: { "Cache-Control": NO_STORE } });
    } catch (error) {
      const response = tokenlessErrorResponse(error);
      return NextResponse.json(response.body, {
        status: response.status,
        headers: { "Cache-Control": NO_STORE },
      });
    }
  };
}

export const GET = createDsaReferencePanelPilotGet();
export const POST = createDsaReferencePanelPilotPost();

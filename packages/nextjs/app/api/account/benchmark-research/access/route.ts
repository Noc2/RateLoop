import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import {
  COMPLIANCE_NO_STORE_HEADERS,
  bearerSecret,
  benchmarkResearchApplication,
  benchmarkTokenLookupKeyId,
  complianceBody,
  complianceError,
  exactBody,
} from "~~/app/api/_support/complianceRoutes";
import { requireBrowserSession } from "~~/lib/auth/request";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function accessId(principalId: string, token: string, idempotencyKey: string) {
  const digest = createHash("sha256").update(`${principalId}\0${token}\0${idempotencyKey}`).digest("base64url");
  return `bra_${digest.slice(0, 22)}`;
}

type ReadByToken = ReturnType<typeof benchmarkResearchApplication>["persistence"]["readByToken"];

export function createBenchmarkResearchAccessPost(
  dependencies: {
    requireSession: typeof requireBrowserSession;
    readByToken: ReadByToken;
  } = {
    requireSession: requireBrowserSession,
    readByToken: input => benchmarkResearchApplication({ requireKeys: true }).persistence.readByToken(input),
  },
) {
  return async (request: NextRequest) => {
    try {
      const session = await dependencies.requireSession(request, { mutation: true });
      const token = bearerSecret(request, {
        message: "Benchmark research grant not found.",
        code: "benchmark_research_grant_not_found",
      });
      const tokenLookupKeyId = benchmarkTokenLookupKeyId(request);
      const body = exactBody(await complianceBody(request), ["idempotencyKey", "page"], ["idempotencyKey"]);
      if (typeof body.idempotencyKey !== "string") {
        throw new TokenlessServiceError("idempotencyKey is invalid.", 400, "invalid_compliance_request");
      }
      if (body.page !== undefined && (!body.page || typeof body.page !== "object" || Array.isArray(body.page))) {
        throw new TokenlessServiceError("page is invalid.", 400, "invalid_compliance_request");
      }
      const result = await dependencies.readByToken({
        accessId: accessId(session.principalId, token, body.idempotencyKey),
        idempotencyKey: body.idempotencyKey,
        token,
        tokenLookupKeyId,
        authenticatedRecipientPrincipalId: session.principalId,
        page: body.page as { offset?: number; limit?: number } | undefined,
      });
      const contentDigest = `sha256:${createHash("sha256").update(result.bytes).digest("hex")}`;
      return new NextResponse(result.bytes, {
        headers: {
          ...COMPLIANCE_NO_STORE_HEADERS,
          "Content-Type": result.contentType,
          "X-Content-SHA256": contentDigest,
          "X-RateLoop-Access-Id": result.accessId,
          "X-RateLoop-Audit-Event-Digest": result.commitReceipt.auditEventDigest,
          "X-RateLoop-Chain-Head-Digest": result.commitReceipt.chainHeadDigest,
          "X-RateLoop-Committed-At": result.commitReceipt.committedAt,
          "X-RateLoop-Idempotent-Replay": String(result.replayed),
          "X-RateLoop-Transaction-Id": result.commitReceipt.transactionId,
        },
      });
    } catch (error) {
      return complianceError(error);
    }
  };
}

export const POST = createBenchmarkResearchAccessPost();

import { NextRequest, NextResponse } from "next/server";
import {
  COMPLIANCE_NO_STORE_HEADERS,
  bearerSecret,
  complianceBody,
  complianceError,
  complianceJson,
  exactBody,
} from "~~/app/api/_support/complianceRoutes";
import { TokenlessMcpHttpError } from "~~/lib/mcp/errors";
import { consumeEvidenceShareRateLimit } from "~~/lib/mcp/rateLimit";
import { accessProjectWindowComplianceShare } from "~~/lib/tokenless/projectWindowComplianceShares";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ shareId: string }> };

export function createComplianceShareAccessPost(
  dependencies: {
    consumeRateLimit: typeof consumeEvidenceShareRateLimit;
    accessShare: typeof accessProjectWindowComplianceShare;
  } = { consumeRateLimit: consumeEvidenceShareRateLimit, accessShare: accessProjectWindowComplianceShare },
) {
  return async (request: NextRequest, context: Context) => {
    try {
      const rateLimit = await dependencies.consumeRateLimit(request.headers);
      if (!rateLimit.allowed) {
        return complianceJson(
          { code: "rate_limit_exceeded", message: "Too many compliance-share requests.", retryable: true },
          429,
        );
      }
      const secret = bearerSecret(request, {
        message: "Project-window compliance share not found.",
        code: "project_window_compliance_share_not_found",
      });
      const body = exactBody(await complianceBody(request, 8 * 1024), ["idempotencyKey", "artifact"]);
      if (typeof body.idempotencyKey !== "string" || !body.artifact || typeof body.artifact !== "object") {
        throw new TokenlessServiceError("Compliance-share request is invalid.", 400, "invalid_compliance_request");
      }
      const { shareId } = await context.params;
      const accessed = await dependencies.accessShare({
        shareId,
        bearerSecret: secret,
        idempotencyKey: body.idempotencyKey,
        artifact: body.artifact as
          | { artifactKind: "evidence_packet"; packetId: string }
          | { artifactKind: "part8_report_version"; reportId: string; reportVersion: number },
      });
      return new NextResponse(accessed.bytes, {
        headers: {
          ...COMPLIANCE_NO_STORE_HEADERS,
          "Content-Type": accessed.contentType,
          "X-Content-SHA256": accessed.responseHash,
          "X-RateLoop-Access-Id": accessed.accessId,
          "X-RateLoop-Idempotent-Replay": String(accessed.replayed),
        },
      });
    } catch (error) {
      if (error instanceof TokenlessMcpHttpError) {
        return complianceJson(
          { code: error.code, message: "Compliance share is temporarily unavailable.", retryable: true },
          error.status,
        );
      }
      return complianceError(error);
    }
  };
}

export const POST = createComplianceShareAccessPost();

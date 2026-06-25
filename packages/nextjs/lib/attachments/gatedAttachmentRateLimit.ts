import type { NextRequest } from "next/server";
import { checkRateLimit } from "~~/utils/rateLimit";

const GATED_ATTACHMENT_ROUTE_RATE_LIMIT = { limit: 120, windowMs: 60_000 };
const GATED_ATTACHMENT_RESOURCE_RATE_LIMIT = { limit: 30, windowMs: 60_000 };

export function checkGatedAttachmentRouteRateLimit(request: NextRequest, routeKey: string) {
  return checkRateLimit(request, GATED_ATTACHMENT_ROUTE_RATE_LIMIT, { routeKey });
}

export function checkGatedAttachmentResourceRateLimit(
  request: NextRequest,
  params: {
    contentId: string;
    deploymentKey: string;
    resourceId: string;
    resourceKind: "details" | "image";
    walletAddress: string;
  },
) {
  return checkRateLimit(request, GATED_ATTACHMENT_RESOURCE_RATE_LIMIT, {
    extraKeyParts: [
      params.deploymentKey,
      params.walletAddress,
      params.contentId,
      params.resourceKind,
      params.resourceId,
    ],
    routeKey: "/api/attachments/gated-resource",
  });
}

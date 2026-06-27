import { NextRequest, NextResponse } from "next/server";
import {
  listContentFeedbackCounts,
  normalizeContentFeedbackCountsInput,
  normalizeOptionalContentFeedbackChainId,
  resolveContentFeedbackDeploymentScope,
  resolveContentFeedbackRoundContext,
} from "~~/lib/feedback/contentFeedback";
import { checkRateLimit } from "~~/utils/rateLimit";

const ROUTE_RATE_LIMIT = { limit: 180, windowMs: 60_000 };
const RESOURCE_RATE_LIMIT = { limit: 60, windowMs: 60_000 };
const ROUTE_RATE_LIMIT_KEY = "/api/feedback/counts";
const RESOURCE_RATE_LIMIT_KEY = `${ROUTE_RATE_LIMIT_KEY}:resource`;

export async function GET(request: NextRequest) {
  const contentIdsParam = request.nextUrl.searchParams.get("contentIds");
  const chainIdParam = request.nextUrl.searchParams.get("chainId");
  const routeLimited = await checkRateLimit(request, ROUTE_RATE_LIMIT, {
    allowOnStoreUnavailable: true,
    routeKey: ROUTE_RATE_LIMIT_KEY,
  });
  if (routeLimited) return routeLimited;

  const limited = await checkRateLimit(request, RESOURCE_RATE_LIMIT, {
    allowOnStoreUnavailable: true,
    extraKeyParts: [contentIdsParam ?? undefined, chainIdParam ?? undefined],
    routeKey: RESOURCE_RATE_LIMIT_KEY,
  });
  if (limited) return limited;

  try {
    const contentIds = normalizeContentFeedbackCountsInput(contentIdsParam);
    if (contentIds.length === 0) {
      return NextResponse.json({ counts: {} });
    }
    const normalizedChain = normalizeOptionalContentFeedbackChainId(chainIdParam);
    if (!normalizedChain.ok) {
      return NextResponse.json({ error: normalizedChain.error }, { status: 400 });
    }
    const deployment = resolveContentFeedbackDeploymentScope(normalizedChain.chainId);
    if (!deployment) {
      return NextResponse.json({ error: "Feedback deployment is not configured" }, { status: 503 });
    }

    const contextEntries = await Promise.all(
      contentIds.map(
        async contentId =>
          [contentId, await resolveContentFeedbackRoundContext(contentId, deployment.chainId)] as const,
      ),
    );
    const counts = await listContentFeedbackCounts({
      chainId: deployment.chainId,
      deploymentKey: deployment.deploymentKey,
      contentIds,
      contextByContentId: new Map(contextEntries),
    });

    return NextResponse.json({ counts });
  } catch (error) {
    console.error("Error fetching feedback counts:", error);
    return NextResponse.json({ error: "Failed to fetch feedback counts" }, { status: 500 });
  }
}

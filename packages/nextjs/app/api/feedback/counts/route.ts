import { NextRequest, NextResponse } from "next/server";
import {
  listContentFeedbackCounts,
  normalizeContentFeedbackCountsInput,
  normalizeOptionalContentFeedbackChainId,
  resolveContentFeedbackDeploymentScope,
  resolveContentFeedbackRoundContext,
} from "~~/lib/feedback/contentFeedback";
import { checkRateLimit } from "~~/utils/rateLimit";

const RATE_LIMIT = { limit: 60, windowMs: 60_000 };

export async function GET(request: NextRequest) {
  const contentIdsParam = request.nextUrl.searchParams.get("contentIds");
  const chainIdParam = request.nextUrl.searchParams.get("chainId");
  const limited = await checkRateLimit(request, RATE_LIMIT, {
    allowOnStoreUnavailable: true,
    extraKeyParts: [contentIdsParam ?? undefined, chainIdParam ?? undefined],
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

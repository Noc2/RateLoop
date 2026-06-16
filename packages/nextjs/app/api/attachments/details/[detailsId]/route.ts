import { NextRequest, NextResponse } from "next/server";
import { getQuestionDetails, isQuestionDetailsId } from "~~/lib/attachments/questionDetails";
import {
  authorizeGatedContextRequest,
  createConfidentialViewToken,
  getQuestionConfidentiality,
  isConfidentialityCurrentlyGated,
  logConfidentialContextAccess,
} from "~~/lib/confidentiality/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DETAILS_RESPONSE_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers": "X-RateLoop-Details-Hash",
  "Cache-Control": "public, max-age=31536000, immutable",
};

const GATED_DETAILS_RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, noimageindex",
};

const UNLINKED_DETAILS_RESPONSE_HEADERS = {
  ...DETAILS_RESPONSE_HEADERS,
  "Cache-Control": "private, no-store",
};

const GATED_DETAILS_NOT_FOUND_RESPONSE = {
  headers: GATED_DETAILS_RESPONSE_HEADERS,
  status: 404,
};

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      ...DETAILS_RESPONSE_HEADERS,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    },
  });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ detailsId: string }> }) {
  const { detailsId } = await params;
  if (!isQuestionDetailsId(detailsId)) {
    return NextResponse.json({ error: "Invalid details id." }, { headers: DETAILS_RESPONSE_HEADERS, status: 400 });
  }

  const details = await getQuestionDetails(detailsId);
  if (!details || details.status !== "approved" || !details.normalizedText) {
    return NextResponse.json(
      { error: "Question details not found." },
      { headers: DETAILS_RESPONSE_HEADERS, status: 404 },
    );
  }

  if (!details.contentId) {
    return NextResponse.json(
      { error: "Question details not found." },
      details.requiresGatedAccess
        ? GATED_DETAILS_NOT_FOUND_RESPONSE
        : { headers: UNLINKED_DETAILS_RESPONSE_HEADERS, status: 404 },
    );
  }

  const detailsDeploymentScope = {
    chainId: details.chainId,
    contentRegistryAddress: details.contentRegistryAddress,
    deploymentKey: details.deploymentKey,
  };
  const confidentiality = details.contentId
    ? await getQuestionConfidentiality(details.contentId, detailsDeploymentScope)
    : null;
  const gated = details.requiresGatedAccess
    ? !confidentiality?.publishedAt
    : isConfidentialityCurrentlyGated(confidentiality);
  if (gated && details.contentId) {
    const authorization = await authorizeGatedContextRequest(request, details.contentId, {
      ...detailsDeploymentScope,
      ownerWalletAddress: details.ownerWalletAddress,
    });
    if (!authorization.ok) {
      return NextResponse.json(
        { error: authorization.error },
        { headers: GATED_DETAILS_RESPONSE_HEADERS, status: authorization.status },
      );
    }

    const viewToken = createConfidentialViewToken({
      contentId: details.contentId,
      deploymentKey: authorization.deploymentKey,
      identityKey: authorization.identityKey,
      resourceId: details.id,
      walletAddress: authorization.walletAddress,
    });
    await logConfidentialContextAccess({
      ...detailsDeploymentScope,
      contentId: details.contentId,
      deploymentKey: authorization.deploymentKey,
      identityKey: authorization.identityKey,
      request,
      resourceId: details.id,
      resourceKind: "details",
      viewToken,
      walletAddress: authorization.walletAddress,
    });

    return new NextResponse(details.normalizedText, {
      headers: {
        ...GATED_DETAILS_RESPONSE_HEADERS,
        "Content-Type": "text/plain; charset=utf-8",
        "X-RateLoop-Details-Hash": `0x${details.sha256}`,
        "X-RateLoop-View-Token": viewToken,
      },
    });
  }

  return new NextResponse(details.normalizedText, {
    headers: {
      ...(details.contentId ? DETAILS_RESPONSE_HEADERS : UNLINKED_DETAILS_RESPONSE_HEADERS),
      "Content-Type": "text/plain; charset=utf-8",
      "X-RateLoop-Details-Hash": `0x${details.sha256}`,
    },
  });
}

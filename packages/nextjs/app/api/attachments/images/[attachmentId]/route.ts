import { NextRequest, NextResponse } from "next/server";
import { get } from "@vercel/blob";
import {
  checkGatedAttachmentResourceRateLimit,
  checkGatedAttachmentRouteRateLimit,
} from "~~/lib/attachments/gatedAttachmentRateLimit";
import { parseImageAttachmentVariant } from "~~/lib/attachments/imageAttachmentVariants";
import {
  backfillImageAttachmentVariant,
  getImageAttachment,
  getImageAttachmentVariantPathname,
  isLocalImageAttachmentPathname,
  readLocalImageAttachment,
} from "~~/lib/attachments/imageAttachments";
import { watermarkConfidentialImage } from "~~/lib/attachments/imageWatermark";
import {
  authorizeGatedContextRequest,
  createConfidentialViewToken,
  getQuestionConfidentiality,
  isConfidentialityCurrentlyGated,
  logConfidentialContextAccess,
} from "~~/lib/confidentiality/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseImageParam(value: string) {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  const match = decoded.match(/^(att_[A-Za-z0-9_-]{16,80})\.webp$/);
  return match?.[1] ?? null;
}

function isMissingBlobResult(result: Awaited<ReturnType<typeof get>> | null) {
  return !result || (result as { statusCode?: number }).statusCode === 404;
}

const GATED_IMAGE_HEADERS = {
  "Cache-Control": "private, no-store",
  "Content-Type": "image/webp",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, noimageindex",
};
const UNLINKED_PUBLIC_IMAGE_HEADERS = {
  "Cache-Control": "private, no-store",
  "Content-Type": "image/webp",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, noimageindex",
};
const PUBLIC_IMAGE_CACHE_CONTROL = "public, max-age=31536000, immutable";

export async function GET(request: NextRequest, { params }: { params: Promise<{ attachmentId: string }> }) {
  const { attachmentId: image } = await params;
  const attachmentId = parseImageParam(image);
  if (!attachmentId) {
    return new NextResponse("Not found", { status: 404 });
  }

  const routeLimited = await checkGatedAttachmentRouteRateLimit(request, "/api/attachments/images/[attachmentId]");
  if (routeLimited) return routeLimited;

  const attachment = await getImageAttachment(attachmentId);
  if (!attachment || attachment.status !== "approved" || !attachment.normalizedBlobPathname) {
    return new NextResponse("Not found", { status: 404 });
  }
  const requestedVariant = parseImageAttachmentVariant(request.nextUrl.searchParams.get("variant"));
  if (!requestedVariant) {
    return new NextResponse("Invalid image variant", { status: 400 });
  }
  const servedBlobPathname = getImageAttachmentVariantPathname(attachment.normalizedBlobPathname, requestedVariant);

  const isUnlinkedPublic = !attachment.contentId && !attachment.requiresGatedAccess;
  if (!attachment.contentId && attachment.requiresGatedAccess) {
    return new NextResponse("Not found", {
      status: 404,
      headers: {
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex, noimageindex",
      },
    });
  }

  const attachmentDeploymentScope = {
    chainId: attachment.chainId,
    contentRegistryAddress: attachment.contentRegistryAddress,
    deploymentKey: attachment.deploymentKey,
  };
  const confidentiality = attachment.contentId
    ? await getQuestionConfidentiality(attachment.contentId, attachmentDeploymentScope)
    : null;
  const gated =
    !isUnlinkedPublic &&
    (attachment.requiresGatedAccess ? !confidentiality?.publishedAt : isConfidentialityCurrentlyGated(confidentiality));
  const gatedAuth =
    gated && attachment.contentId
      ? await authorizeGatedContextRequest(request, attachment.contentId, {
          ...attachmentDeploymentScope,
          ownerWalletAddress: attachment.ownerWalletAddress,
        })
      : null;
  if (gatedAuth && !gatedAuth.ok) {
    return NextResponse.json(
      { error: gatedAuth.error },
      { status: gatedAuth.status, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  if (gated && gatedAuth?.ok && attachment.contentId) {
    const resourceLimited = await checkGatedAttachmentResourceRateLimit(request, {
      contentId: attachment.contentId,
      deploymentKey: gatedAuth.deploymentKey,
      resourceId: attachment.id,
      resourceKind: "image",
      walletAddress: gatedAuth.walletAddress,
    });
    if (resourceLimited) return resourceLimited;
  }

  const publicImageCacheControl = isUnlinkedPublic
    ? UNLINKED_PUBLIC_IMAGE_HEADERS["Cache-Control"]
    : PUBLIC_IMAGE_CACHE_CONTROL;
  const publicImageHeaders = {
    "Content-Type": "image/webp",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": publicImageCacheControl,
    ...(isUnlinkedPublic ? { "X-Robots-Tag": "noindex, noimageindex" as const } : {}),
  };

  if (isLocalImageAttachmentPathname(attachment.normalizedBlobPathname)) {
    let result = await readLocalImageAttachment(servedBlobPathname);
    if (!result && requestedVariant !== "full") {
      const backfilledPathname = await backfillImageAttachmentVariant({
        attachmentId,
        normalizedBlobPathname: attachment.normalizedBlobPathname,
        variant: requestedVariant,
      }).catch(() => null);
      result = backfilledPathname ? await readLocalImageAttachment(backfilledPathname) : null;
    }
    result ??= await readLocalImageAttachment(attachment.normalizedBlobPathname);
    if (!result) {
      return new NextResponse("Not found", { status: 404 });
    }

    if (gated && gatedAuth?.ok && attachment.contentId) {
      const viewedAt = new Date();
      const viewToken = createConfidentialViewToken({
        contentId: attachment.contentId,
        deploymentKey: gatedAuth.deploymentKey,
        frontendAddress: gatedAuth.frontendAddress,
        identityKey: gatedAuth.identityKey,
        resourceId: attachment.id,
        walletAddress: gatedAuth.walletAddress,
      });
      await logConfidentialContextAccess({
        ...attachmentDeploymentScope,
        contentId: attachment.contentId,
        deploymentKey: gatedAuth.deploymentKey,
        frontendAddress: gatedAuth.frontendAddress,
        identityKey: gatedAuth.identityKey,
        request,
        resourceId: attachment.id,
        resourceKind: "image",
        viewToken,
        walletAddress: gatedAuth.walletAddress,
      });
      return new NextResponse(
        await watermarkConfidentialImage(result.buffer, {
          timestamp: viewedAt,
          viewToken,
          walletAddress: gatedAuth.walletAddress,
        }),
        {
          headers: {
            ...GATED_IMAGE_HEADERS,
            "X-RateLoop-View-Token": viewToken,
          },
        },
      );
    }

    if (!isUnlinkedPublic && request.headers.get("if-none-match") === result.etag) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          ETag: result.etag,
          "Cache-Control": publicImageCacheControl,
        },
      });
    }

    return new NextResponse(result.buffer, {
      headers: {
        ...publicImageHeaders,
        ETag: result.etag,
      },
    });
  }

  let result = await get(servedBlobPathname, {
    access: "private",
    ifNoneMatch: gated ? undefined : (request.headers.get("if-none-match") ?? undefined),
  });
  if (isMissingBlobResult(result) && requestedVariant !== "full") {
    const backfilledPathname = await backfillImageAttachmentVariant({
      attachmentId,
      normalizedBlobPathname: attachment.normalizedBlobPathname,
      variant: requestedVariant,
    }).catch(() => null);
    result = await get(backfilledPathname ?? attachment.normalizedBlobPathname, {
      access: "private",
      ifNoneMatch: gated ? undefined : (request.headers.get("if-none-match") ?? undefined),
    });
  }
  if (!result) {
    return new NextResponse("Not found", { status: 404 });
  }

  if (!gated && !isUnlinkedPublic && result.statusCode === 304) {
    return new NextResponse(null, {
      status: 304,
      headers: {
        ETag: result.blob.etag,
        "Cache-Control": publicImageCacheControl,
      },
    });
  }
  if (result.statusCode !== 200 || !result.stream) {
    return new NextResponse("Not found", { status: 404 });
  }

  if (gated && gatedAuth?.ok && attachment.contentId) {
    const buffer = Buffer.from(await new Response(result.stream).arrayBuffer());
    const viewedAt = new Date();
    const viewToken = createConfidentialViewToken({
      contentId: attachment.contentId,
      deploymentKey: gatedAuth.deploymentKey,
      frontendAddress: gatedAuth.frontendAddress,
      identityKey: gatedAuth.identityKey,
      resourceId: attachment.id,
      walletAddress: gatedAuth.walletAddress,
    });
    await logConfidentialContextAccess({
      ...attachmentDeploymentScope,
      contentId: attachment.contentId,
      deploymentKey: gatedAuth.deploymentKey,
      frontendAddress: gatedAuth.frontendAddress,
      identityKey: gatedAuth.identityKey,
      request,
      resourceId: attachment.id,
      resourceKind: "image",
      viewToken,
      walletAddress: gatedAuth.walletAddress,
    });
    return new NextResponse(
      await watermarkConfidentialImage(buffer, {
        timestamp: viewedAt,
        viewToken,
        walletAddress: gatedAuth.walletAddress,
      }),
      {
        headers: {
          ...GATED_IMAGE_HEADERS,
          "X-RateLoop-View-Token": viewToken,
        },
      },
    );
  }

  return new NextResponse(result.stream, {
    headers: {
      ...publicImageHeaders,
      ETag: result.blob.etag,
    },
  });
}

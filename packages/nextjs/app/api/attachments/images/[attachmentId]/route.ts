import { NextRequest, NextResponse } from "next/server";
import { get } from "@vercel/blob";
import {
  getImageAttachment,
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
  const decoded = decodeURIComponent(value);
  const match = decoded.match(/^(att_[A-Za-z0-9_-]{16,80})\.webp$/);
  return match?.[1] ?? null;
}

const GATED_IMAGE_HEADERS = {
  "Cache-Control": "private, no-store",
  "Content-Type": "image/webp",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, noimageindex",
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ attachmentId: string }> }) {
  const { attachmentId: image } = await params;
  const attachmentId = parseImageParam(image);
  if (!attachmentId) {
    return new NextResponse("Not found", { status: 404 });
  }

  const attachment = await getImageAttachment(attachmentId);
  if (!attachment || attachment.status !== "approved" || !attachment.normalizedBlobPathname) {
    return new NextResponse("Not found", { status: 404 });
  }

  if (!attachment.contentId) {
    return new NextResponse("Not found", {
      status: 404,
      headers: attachment.requiresGatedAccess
        ? {
            "Cache-Control": "private, no-store",
            "X-Robots-Tag": "noindex, noimageindex",
          }
        : { "Cache-Control": "private, no-store" },
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
  const gated = attachment.requiresGatedAccess
    ? !confidentiality?.publishedAt
    : isConfidentialityCurrentlyGated(confidentiality);
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

  if (isLocalImageAttachmentPathname(attachment.normalizedBlobPathname)) {
    const result = await readLocalImageAttachment(attachment.normalizedBlobPathname);
    if (!result) {
      return new NextResponse("Not found", { status: 404 });
    }

    if (gated && gatedAuth?.ok && attachment.contentId) {
      const viewedAt = new Date();
      const viewToken = createConfidentialViewToken({
        contentId: attachment.contentId,
        deploymentKey: gatedAuth.deploymentKey,
        identityKey: gatedAuth.identityKey,
        resourceId: attachment.id,
        walletAddress: gatedAuth.walletAddress,
      });
      await logConfidentialContextAccess({
        ...attachmentDeploymentScope,
        contentId: attachment.contentId,
        deploymentKey: gatedAuth.deploymentKey,
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

    if (request.headers.get("if-none-match") === result.etag) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          ETag: result.etag,
          "Cache-Control": "public, max-age=300, must-revalidate",
        },
      });
    }

    return new NextResponse(result.buffer, {
      headers: {
        "Content-Type": "image/webp",
        "X-Content-Type-Options": "nosniff",
        ETag: result.etag,
        "Cache-Control": "public, max-age=300, must-revalidate",
      },
    });
  }

  const result = await get(attachment.normalizedBlobPathname, {
    access: "private",
    ifNoneMatch: gated ? undefined : (request.headers.get("if-none-match") ?? undefined),
  });
  if (!result) {
    return new NextResponse("Not found", { status: 404 });
  }

  if (!gated && result.statusCode === 304) {
    return new NextResponse(null, {
      status: 304,
      headers: {
        ETag: result.blob.etag,
        "Cache-Control": "public, max-age=300, must-revalidate",
      },
    });
  }

  if (gated && gatedAuth?.ok && attachment.contentId) {
    const buffer = Buffer.from(await new Response(result.stream).arrayBuffer());
    const viewedAt = new Date();
    const viewToken = createConfidentialViewToken({
      contentId: attachment.contentId,
      deploymentKey: gatedAuth.deploymentKey,
      identityKey: gatedAuth.identityKey,
      resourceId: attachment.id,
      walletAddress: gatedAuth.walletAddress,
    });
    await logConfidentialContextAccess({
      ...attachmentDeploymentScope,
      contentId: attachment.contentId,
      deploymentKey: gatedAuth.deploymentKey,
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
      "Content-Type": "image/webp",
      "X-Content-Type-Options": "nosniff",
      ETag: result.blob.etag,
      "Cache-Control": "public, max-age=300, must-revalidate",
    },
  });
}

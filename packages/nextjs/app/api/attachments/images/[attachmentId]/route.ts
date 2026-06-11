import { NextRequest, NextResponse } from "next/server";
import { get } from "@vercel/blob";
import sharp from "sharp";
import {
  getImageAttachment,
  isLocalImageAttachmentPathname,
  readLocalImageAttachment,
} from "~~/lib/attachments/imageAttachments";
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

async function watermarkImage(buffer: Buffer, params: { timestamp: Date; viewToken: string; walletAddress: string }) {
  const label = `${params.walletAddress.slice(0, 6)}...${params.walletAddress.slice(-4)} ${params.timestamp.toISOString()}`;
  const token = params.viewToken.slice(0, 12);
  const overlay = Buffer.from(`
    <svg width="1200" height="160" viewBox="0 0 1200 160" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="1200" height="160" fill="rgba(0,0,0,0.42)"/>
      <text x="32" y="62" fill="rgba(255,255,255,0.92)" font-family="Arial, sans-serif" font-size="34" font-weight="700">${label}</text>
      <text x="32" y="112" fill="rgba(255,255,255,0.76)" font-family="Arial, sans-serif" font-size="28">view ${token}</text>
    </svg>
  `);
  return sharp(buffer)
    .composite([{ input: overlay, gravity: "southeast" }])
    .webp({ quality: 86 })
    .toBuffer();
}

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

  const confidentiality = attachment.contentId ? await getQuestionConfidentiality(attachment.contentId) : null;
  const gated = isConfidentialityCurrentlyGated(confidentiality);
  const gatedAuth =
    gated && attachment.contentId ? await authorizeGatedContextRequest(request, attachment.contentId) : null;
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
        identityKey: gatedAuth.identityKey,
        resourceId: attachment.id,
        walletAddress: gatedAuth.walletAddress,
      });
      await logConfidentialContextAccess({
        contentId: attachment.contentId,
        identityKey: gatedAuth.identityKey,
        request,
        resourceId: attachment.id,
        resourceKind: "image",
        viewToken,
        walletAddress: gatedAuth.walletAddress,
      });
      return new NextResponse(
        await watermarkImage(result.buffer, { timestamp: viewedAt, viewToken, walletAddress: gatedAuth.walletAddress }),
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
    ifNoneMatch: request.headers.get("if-none-match") ?? undefined,
  });
  if (!result) {
    return new NextResponse("Not found", { status: 404 });
  }

  if (result.statusCode === 304) {
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
      identityKey: gatedAuth.identityKey,
      resourceId: attachment.id,
      walletAddress: gatedAuth.walletAddress,
    });
    await logConfidentialContextAccess({
      contentId: attachment.contentId,
      identityKey: gatedAuth.identityKey,
      request,
      resourceId: attachment.id,
      resourceKind: "image",
      viewToken,
      walletAddress: gatedAuth.walletAddress,
    });
    return new NextResponse(
      await watermarkImage(buffer, { timestamp: viewedAt, viewToken, walletAddress: gatedAuth.walletAddress }),
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

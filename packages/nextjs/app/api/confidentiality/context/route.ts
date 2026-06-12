import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { authorizeGatedContextRequest, normalizeConfidentialityTermsInput } from "~~/lib/confidentiality/context";
import { db } from "~~/lib/db";
import { questionDetails, questionImageAttachments } from "~~/lib/db/schema";
import { isValidWalletAddress, normalizeWalletAddress } from "~~/lib/watchlist/contentWatch";
import { checkRateLimit } from "~~/utils/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const READ_RATE_LIMIT = { limit: 60, windowMs: 60_000 };

function normalizeOwnerAddress(value: string | null | undefined) {
  return value && isValidWalletAddress(value) ? normalizeWalletAddress(value) : null;
}

function imageFetchUrl(params: { attachmentId: string; sha256: string | null; walletAddress: `0x${string}` }) {
  const url = `/api/attachments/images/${params.attachmentId}.webp?address=${params.walletAddress}`;
  return params.sha256 ? `${url}#sha256=0x${params.sha256}` : url;
}

function detailsFetchUrl(params: { detailsId: string; walletAddress: `0x${string}` }) {
  return `/api/attachments/details/${params.detailsId}?address=${params.walletAddress}`;
}

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address");
  const contentId = request.nextUrl.searchParams.get("contentId");
  const limited = await checkRateLimit(request, READ_RATE_LIMIT, {
    allowOnStoreUnavailable: true,
    extraKeyParts: [address ?? undefined, contentId ?? undefined],
  });
  if (limited) return limited;

  const normalized = normalizeConfidentialityTermsInput({
    address: address ?? undefined,
    contentId: contentId ?? undefined,
  });
  if (!normalized.ok) {
    return NextResponse.json({ error: normalized.error }, { status: 400 });
  }

  const [detailsRows, imageRows] = await Promise.all([
    db
      .select({
        id: questionDetails.id,
        ownerWalletAddress: questionDetails.ownerWalletAddress,
        sha256: questionDetails.sha256,
      })
      .from(questionDetails)
      .where(and(eq(questionDetails.contentId, normalized.payload.contentId), eq(questionDetails.status, "approved"))),
    db
      .select({
        id: questionImageAttachments.id,
        ownerWalletAddress: questionImageAttachments.ownerWalletAddress,
        sha256: questionImageAttachments.sha256,
      })
      .from(questionImageAttachments)
      .where(
        and(
          eq(questionImageAttachments.contentId, normalized.payload.contentId),
          eq(questionImageAttachments.status, "approved"),
        ),
      ),
  ]);

  const matchingOwner = [...detailsRows, ...imageRows]
    .map(row => normalizeOwnerAddress(row.ownerWalletAddress))
    .find(owner => owner === normalized.payload.normalizedAddress);
  const authorization = await authorizeGatedContextRequest(request, normalized.payload.contentId, {
    ownerWalletAddress: matchingOwner,
  });
  if (!authorization.ok) {
    return NextResponse.json(
      { error: authorization.error },
      { status: authorization.status, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const details = detailsRows
    .slice()
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(row => ({
      id: row.id,
      sha256: row.sha256 ? `0x${row.sha256}` : null,
      url: detailsFetchUrl({ detailsId: row.id, walletAddress: normalized.payload.normalizedAddress }),
    }));
  const images = imageRows
    .slice()
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((row, index) => ({
      id: row.id,
      mediaIndex: index,
      mediaType: "image" as const,
      sha256: row.sha256 ? `0x${row.sha256}` : null,
      url: imageFetchUrl({
        attachmentId: row.id,
        sha256: row.sha256,
        walletAddress: normalized.payload.normalizedAddress,
      }),
    }));

  return NextResponse.json(
    {
      contentId: normalized.payload.contentId,
      details,
      images,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

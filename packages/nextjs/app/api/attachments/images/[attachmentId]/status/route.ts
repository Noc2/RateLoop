import { NextRequest, NextResponse } from "next/server";
import { getAttachmentImageUrl, getImageAttachment } from "~~/lib/attachments/imageAttachments";
import { checkRateLimit } from "~~/utils/rateLimit";

const ROUTE_RATE_LIMIT = { limit: 120, windowMs: 60_000 };
const ATTACHMENT_RATE_LIMIT = { limit: 60, windowMs: 60_000 };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ attachmentId: string }> }) {
  const { attachmentId } = await params;
  const routeLimited = await checkRateLimit(request, ROUTE_RATE_LIMIT, {
    routeKey: "/api/attachments/images/[attachmentId]/status",
  });
  if (routeLimited) return routeLimited;

  const attachment = await getImageAttachment(attachmentId);
  if (!attachment) {
    return NextResponse.json({ error: "Attachment not found." }, { status: 404 });
  }

  const limited = await checkRateLimit(request, ATTACHMENT_RATE_LIMIT, {
    extraKeyParts: [attachment.id],
    routeKey: "/api/attachments/images/status-resource",
  });
  if (limited) return limited;

  return NextResponse.json({
    attachmentId,
    error: attachment.error,
    height: attachment.height,
    imageUrl:
      attachment.status === "approved" ? getAttachmentImageUrl(request.url, attachmentId, attachment.sha256) : null,
    moderationStatus: attachment.moderationStatus,
    status: attachment.status,
    width: attachment.width,
  });
}

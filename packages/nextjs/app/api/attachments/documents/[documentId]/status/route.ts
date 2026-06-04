import { NextRequest, NextResponse } from "next/server";
import { getContextDocument, getContextDocumentUrl } from "~~/lib/attachments/contextDocuments";
import { checkRateLimit } from "~~/utils/rateLimit";

const RATE_LIMIT = { limit: 60, windowMs: 60_000 };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await params;
  const limited = await checkRateLimit(request, RATE_LIMIT, { extraKeyParts: [documentId] });
  if (limited) return limited;

  const document = await getContextDocument(documentId);
  if (!document) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  return NextResponse.json({
    contextUrl: document.status === "approved" ? getContextDocumentUrl(request.url, documentId) : null,
    documentId,
    error: document.error,
    filename: document.originalFilename,
    moderationStatus: document.moderationStatus,
    preview: document.normalizedText ? document.normalizedText.slice(0, 600) : null,
    sha256: document.sha256,
    sizeBytes: document.sizeBytes,
    status: document.status,
  });
}

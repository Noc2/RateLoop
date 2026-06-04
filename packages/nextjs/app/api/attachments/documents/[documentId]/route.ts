import { NextRequest, NextResponse } from "next/server";
import {
  getContextDocument,
  getContextDocumentFileExtension,
  getContextDocumentKind,
  getContextDocumentUrl,
  isContextDocumentId,
} from "~~/lib/attachments/contextDocuments";
import { checkRateLimit } from "~~/utils/rateLimit";

const RATE_LIMIT = { limit: 60, windowMs: 60_000 };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await params;
  const limited = await checkRateLimit(request, RATE_LIMIT, { extraKeyParts: [documentId] });
  if (limited) return limited;

  if (!isContextDocumentId(documentId)) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  const document = await getContextDocument(documentId);
  if (!document || document.status !== "approved" || !document.normalizedText) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  return NextResponse.json({
    contextUrl: getContextDocumentUrl(request.url, documentId),
    documentId,
    fileExtension: getContextDocumentFileExtension(document),
    filename: document.originalFilename,
    kind: getContextDocumentKind(document),
    mimeType: document.mimeType,
    moderationStatus: document.moderationStatus,
    normalizedText: document.normalizedText,
    sha256: document.sha256,
    sizeBytes: document.sizeBytes,
    status: document.status,
  });
}

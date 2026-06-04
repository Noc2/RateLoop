import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  getContextDocument,
  getContextDocumentFileExtension,
  getContextDocumentKind,
} from "~~/lib/attachments/contextDocuments";

export const dynamic = "force-dynamic";

type ContextDocumentPageProps = {
  params: Promise<{
    documentId: string;
  }>;
};

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function shortHash(value: string) {
  return value.length > 16 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value;
}

export async function generateMetadata({ params }: ContextDocumentPageProps): Promise<Metadata> {
  const { documentId } = await params;
  const document = await getContextDocument(documentId);
  if (!document || document.status !== "approved") {
    return {
      title: "Document Context Not Found | RateLoop",
    };
  }

  return {
    title: `${document.originalFilename} | RateLoop Context`,
    description: `Uploaded ${getContextDocumentKind(document).toLowerCase()} context for a RateLoop question.`,
  };
}

export default async function ContextDocumentPage({ params }: ContextDocumentPageProps) {
  const { documentId } = await params;
  const document = await getContextDocument(documentId);
  if (!document || document.status !== "approved" || !document.normalizedText) {
    notFound();
  }

  const kind = getContextDocumentKind(document);

  return (
    <main className="min-h-screen bg-base-100 px-4 py-10 text-base-content sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl">
        <div className="border-l-2 border-[#03CEA4] pl-5">
          <p className="font-mono text-xs uppercase tracking-widest text-base-content/55">RateLoop context document</p>
          <h1 className="mt-3 break-words text-3xl font-bold leading-tight sm:text-4xl">{document.originalFilename}</h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-base-content/68">
            This user-provided {kind.toLowerCase()} file was uploaded as public voting context and passed automated text
            moderation before publication.
          </p>
        </div>

        <dl className="mt-8 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-base-content/10 bg-base-content/[0.04] p-4">
            <dt className="text-base-content/55">Type</dt>
            <dd className="mt-1 font-semibold">{getContextDocumentFileExtension(document)}</dd>
          </div>
          <div className="rounded-lg border border-base-content/10 bg-base-content/[0.04] p-4">
            <dt className="text-base-content/55">Size</dt>
            <dd className="mt-1 font-semibold">{formatBytes(document.sizeBytes)}</dd>
          </div>
          <div className="rounded-lg border border-base-content/10 bg-base-content/[0.04] p-4">
            <dt className="text-base-content/55">SHA-256</dt>
            <dd className="mt-1 font-mono text-xs font-semibold">{shortHash(document.sha256)}</dd>
          </div>
          <div className="rounded-lg border border-base-content/10 bg-base-content/[0.04] p-4">
            <dt className="text-base-content/55">Moderation</dt>
            <dd className="mt-1 font-semibold capitalize">{document.moderationStatus.replaceAll("_", " ")}</dd>
          </div>
        </dl>

        <article className="mt-8 rounded-lg border border-base-content/10 bg-base-200/45 p-4 sm:p-6">
          <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-7 text-base-content/86 sm:text-base">
            {document.normalizedText}
          </pre>
        </article>
      </div>
    </main>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowTopRightOnSquareIcon, DocumentTextIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { ContextDocumentContent } from "~~/components/attachments/ContextDocumentContent";
import { parseContextDocumentPublicUrl } from "~~/lib/attachments/contextDocumentUrls";

type ContextDocumentResponse = {
  contextUrl: string;
  documentId: string;
  error?: string | null;
  fileExtension: string;
  filename: string;
  kind: string;
  mimeType: string;
  moderationStatus: string;
  normalizedText: string;
  sha256: string;
  sizeBytes: number;
  status: "approved";
};

type ContextDocumentModalProps = {
  documentUrl: string;
  onClose: () => void;
};

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function shortHash(value: string) {
  return value.length > 16 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value;
}

async function readDocumentResponse(response: Response): Promise<ContextDocumentResponse> {
  const json = (await response.json().catch(() => null)) as ContextDocumentResponse | { error?: string } | null;
  if (!response.ok) {
    throw new Error(json && "error" in json && json.error ? json.error : "Document could not be loaded.");
  }
  return json as ContextDocumentResponse;
}

export function ContextDocumentModal({ documentUrl, onClose }: ContextDocumentModalProps) {
  const [isMounted, setIsMounted] = useState(false);
  const [loadedDocument, setLoadedDocument] = useState<ContextDocumentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parsedDocument = useMemo(
    () => parseContextDocumentPublicUrl(documentUrl, typeof window === "undefined" ? null : window.location.origin),
    [documentUrl],
  );

  useEffect(() => {
    setIsMounted(true);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    const abortController = new AbortController();
    setLoadedDocument(null);
    setError(null);

    if (!parsedDocument?.documentId) {
      setError("Document link is not a RateLoop document.");
      return () => abortController.abort();
    }

    fetch(`/api/attachments/documents/${encodeURIComponent(parsedDocument.documentId)}`, {
      signal: abortController.signal,
    })
      .then(readDocumentResponse)
      .then(setLoadedDocument)
      .catch(caught => {
        if (abortController.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : "Document could not be loaded.");
      });

    return () => abortController.abort();
  }, [parsedDocument?.documentId]);

  if (!isMounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={loadedDocument ? `Context document: ${loadedDocument.filename}` : "Context document"}
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default bg-black/55 backdrop-blur-sm"
        aria-label="Close document viewer"
        onClick={onClose}
      />
      <div className="relative z-10 flex max-h-[calc(100svh-1rem)] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl border border-base-content/10 bg-base-200 shadow-2xl sm:max-h-[min(92svh,58rem)] sm:rounded-2xl">
        <div className="flex min-w-0 items-start gap-3 border-b border-base-content/10 px-4 py-4 pr-14 sm:px-6">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-base-content/[0.08]">
            <DocumentTextIcon className="h-5 w-5 text-base-content/72" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-xs uppercase tracking-widest text-base-content/45">
              RateLoop context document
            </p>
            <h2 className="mt-1 truncate text-lg font-semibold leading-tight text-base-content sm:text-xl">
              {loadedDocument?.filename ?? "Loading document"}
            </h2>
            {loadedDocument ? (
              <p className="mt-1 text-sm text-base-content/55">
                {loadedDocument.kind} · {formatBytes(loadedDocument.sizeBytes)} · SHA-256{" "}
                {shortHash(loadedDocument.sha256)}
              </p>
            ) : null}
          </div>
          {loadedDocument ? (
            <a
              href={loadedDocument.contextUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-outline btn-sm hidden shrink-0 gap-2 sm:inline-flex"
            >
              <ArrowTopRightOnSquareIcon className="h-4 w-4" />
              Open
            </a>
          ) : null}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="btn btn-sm btn-circle btn-ghost absolute right-3 top-3 text-base-content/70 hover:text-base-content"
          aria-label="Close"
        >
          <XMarkIcon className="h-5 w-5" />
        </button>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">
          {error ? (
            <div className="surface-card-nested rounded-lg p-4 text-sm leading-6 text-error">{error}</div>
          ) : loadedDocument ? (
            <ContextDocumentContent mimeType={loadedDocument.mimeType} text={loadedDocument.normalizedText} />
          ) : (
            <div className="space-y-3" role="status" aria-live="polite">
              <div className="h-5 w-48 animate-pulse rounded bg-base-content/10" />
              <div className="h-4 w-full animate-pulse rounded bg-base-content/10" />
              <div className="h-4 w-11/12 animate-pulse rounded bg-base-content/10" />
              <div className="h-4 w-4/5 animate-pulse rounded bg-base-content/10" />
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

"use client";

import { useMemo, useRef, useState } from "react";
import { useSignMessage } from "wagmi";
import { ArrowUpTrayIcon } from "@heroicons/react/24/outline";
import {
  getMaxContextDocumentUploadSizeBytes,
  normalizeContextDocumentMimeType,
} from "~~/lib/auth/contextDocumentUploadChallenge.shared";
import { notification } from "~~/utils/scaffold-eth";
import { isSignatureRejected } from "~~/utils/signatureErrors";

export type UploadedContextDocument = {
  contextUrl: string;
  documentId: string;
  filename: string;
  preview: string | null;
  sha256: string;
  sizeBytes: number;
};

type ContextDocumentUploaderProps = {
  address?: string;
  disabled?: boolean;
  onUploaded: (document: UploadedContextDocument) => void;
};

type ChallengeResponse = {
  challengeId: string;
  message: string;
};

type UploadResponse = {
  contextUrl?: string | null;
  documentId?: string;
  error?: string | null;
  filename?: string;
  preview?: string | null;
  sha256?: string;
  sizeBytes?: number;
  status?: "approved" | "blocked" | "failed" | "deleted";
};

const SUPPORTED_DOCUMENT_EXTENSIONS = ".txt,.md";

function createDocumentId() {
  return `doc_${crypto.randomUUID().replaceAll("-", "")}`;
}

async function sha256Hex(file: File) {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function readJson<T>(response: Response): Promise<T> {
  const json = (await response.json().catch(() => null)) as T | { error?: string } | null;
  if (!response.ok) {
    throw new Error(
      json && typeof json === "object" && "error" in json && json.error ? json.error : "Document upload failed.",
    );
  }
  return json as T;
}

export function ContextDocumentUploader({ address, disabled = false, onUploaded }: ContextDocumentUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { signMessageAsync } = useSignMessage();
  const [isUploading, setIsUploading] = useState(false);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);

  const maxSizeKb = useMemo(() => Math.floor(getMaxContextDocumentUploadSizeBytes() / 1024), []);
  const isDisabled = disabled || isUploading || !address;

  const handleFile = async (file: File) => {
    if (!address) {
      notification.error("Connect your wallet before uploading a document.");
      return;
    }

    const mimeType = normalizeContextDocumentMimeType(file.name, file.type);
    if (!mimeType) {
      notification.error("Upload a TXT or Markdown document.");
      return;
    }
    if (file.size > getMaxContextDocumentUploadSizeBytes()) {
      notification.error(`Upload a document smaller than ${maxSizeKb} KB.`);
      return;
    }

    const documentId = createDocumentId();
    setIsUploading(true);
    setProgressLabel("Reading document");

    try {
      const sha256 = await sha256Hex(file);
      const challengePayload = {
        address,
        documentId,
        filename: file.name || `${documentId}${mimeType === "text/markdown" ? ".md" : ".txt"}`,
        mimeType,
        sha256,
        sizeBytes: file.size,
      };

      setProgressLabel("Creating upload request");
      const challenge = await readJson<ChallengeResponse>(
        await fetch("/api/attachments/documents/challenge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(challengePayload),
        }),
      );

      setProgressLabel("Waiting for signature");
      const signature = await signMessageAsync({ message: challenge.message });
      const formData = new FormData();
      formData.set(
        "clientPayload",
        JSON.stringify({
          ...challengePayload,
          challengeId: challenge.challengeId,
          signature,
        }),
      );
      formData.set("document", file);

      setProgressLabel("Moderating document");
      const uploadResult = await readJson<UploadResponse>(
        await fetch("/api/attachments/documents/upload", {
          method: "POST",
          body: formData,
        }),
      );
      if (uploadResult.status !== "approved" || !uploadResult.contextUrl || !uploadResult.documentId) {
        throw new Error(uploadResult.error ?? "Document was not approved.");
      }

      onUploaded({
        contextUrl: uploadResult.contextUrl,
        documentId: uploadResult.documentId,
        filename: uploadResult.filename ?? file.name,
        preview: uploadResult.preview ?? null,
        sha256,
        sizeBytes: file.size,
      });
      notification.success("Document uploaded and approved.");
    } catch (error) {
      notification.error(
        isSignatureRejected(error)
          ? "Document upload canceled before the file was uploaded."
          : error instanceof Error
            ? error.message
            : "Document upload failed.",
      );
    } finally {
      setIsUploading(false);
      setProgressLabel(null);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  };

  return (
    <div className="surface-card-nested rounded-lg p-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn btn-outline btn-sm"
          disabled={isDisabled}
          onClick={() => inputRef.current?.click()}
        >
          <ArrowUpTrayIcon className="h-4 w-4" />
          {isUploading ? "Uploading" : "Upload document"}
        </button>
        <span className="text-sm text-base-content/60">
          TXT or Markdown up to {maxSizeKb} KB. Documents are moderated and become public question context.
        </span>
      </div>
      {isUploading && progressLabel ? (
        <div className="mt-3 space-y-2">
          <span className="text-sm text-base-content/70" role="status" aria-live="polite">
            {progressLabel}
          </span>
          <progress className="progress progress-primary h-2 w-full" aria-label={progressLabel} />
        </div>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept={SUPPORTED_DOCUMENT_EXTENSIONS}
        className="hidden"
        disabled={isDisabled}
        onChange={event => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
    </div>
  );
}

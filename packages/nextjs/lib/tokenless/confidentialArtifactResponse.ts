import { NextResponse } from "next/server";

export type ConfidentialArtifactRendererPolicy = "plain_text" | "sanitized_html" | "image" | "download";

export type ConfidentialArtifact = {
  bytes: Uint8Array;
  contentType: string;
  rendererPolicy: ConfidentialArtifactRendererPolicy | string | null | undefined;
  sizeBytes: number;
};

const INLINE_IMAGE_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const NO_STORE = "private, no-store, max-age=0";

function normalizedContentType(value: string) {
  return value.split(";", 1)[0]!.trim().toLowerCase();
}

function attachmentFilename(value: string) {
  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9._-]/gu, "-")
    .slice(0, 180);
  return normalized || "artifact";
}

function presentation(input: { artifact: ConfidentialArtifact; download?: boolean }) {
  const storedContentType = normalizedContentType(input.artifact.contentType);
  if (!input.download && input.artifact.rendererPolicy === "plain_text") {
    return { attachment: false, contentType: "text/plain; charset=utf-8" };
  }
  if (
    !input.download &&
    input.artifact.rendererPolicy === "image" &&
    INLINE_IMAGE_CONTENT_TYPES.has(storedContentType)
  ) {
    return { attachment: false, contentType: storedContentType };
  }

  // `sanitized_html` is intentionally download-only until the upload boundary
  // actually sanitizes and attests the stored bytes. Unknown and mismatched
  // policies also fail closed instead of trusting stored Content-Type metadata.
  return {
    attachment: true,
    contentType: storedContentType || "application/octet-stream",
  };
}

export function confidentialArtifactResponse(input: {
  artifact: ConfidentialArtifact;
  download?: boolean;
  filename: string;
}) {
  const resolved = presentation(input);
  return new NextResponse(Buffer.from(input.artifact.bytes), {
    headers: {
      "Cache-Control": NO_STORE,
      ...(resolved.attachment
        ? { "Content-Disposition": `attachment; filename="${attachmentFilename(input.filename)}"` }
        : {}),
      "Content-Length": String(input.artifact.sizeBytes),
      "Content-Type": resolved.contentType,
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const CONFIDENTIAL_ARTIFACT_NO_STORE = NO_STORE;

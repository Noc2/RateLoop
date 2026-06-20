"use client";

import React from "react";
import Link from "next/link";
import { buildRateContentHref } from "~~/constants/routes";
import { MAX_QUESTION_DETAILS_TEXT_BYTES, questionDetailsHashInput } from "~~/lib/attachments/questionDetails.shared";
import { resolveQuestionDetailsFetchUrl } from "~~/lib/attachments/questionDetailsUrls";
import { parseQuestionReferences } from "~~/lib/questionReferences";

export type QuestionReferenceContentSummary = {
  id: bigint | string;
  question?: string;
  title?: string;
};

type QuestionDescriptionProps = {
  description: string;
  detailsHash?: string | null;
  detailsUrl?: string | null;
  referencedContentById?: ReadonlyMap<string, QuestionReferenceContentSummary>;
  previewWordLimit?: number;
  previewLayout?: "default" | "inline-toggle";
  className?: string;
};

const DETAILS_FETCH_TIMEOUT_MS = 10_000;
const DESCRIPTION_PREVIEW_WORDS = 32;

function getDescriptionPreviewText(value: string, wordLimit = DESCRIPTION_PREVIEW_WORDS) {
  const normalizedWordLimit = Number.isFinite(wordLimit)
    ? Math.max(1, Math.floor(wordLimit))
    : DESCRIPTION_PREVIEW_WORDS;
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length <= normalizedWordLimit) {
    return words.join(" ");
  }
  return `${words.slice(0, normalizedWordLimit).join(" ")}...`;
}

function getReferenceLabel(
  contentId: string,
  customLabel: string | undefined,
  summary: QuestionReferenceContentSummary | undefined,
) {
  return customLabel?.trim() || summary?.question?.trim() || summary?.title?.trim() || `Question #${contentId}`;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `0x${Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function detailsIdFromUrl(value: string) {
  try {
    const parsed = new URL(value, window.location.origin);
    return parsed.pathname.match(/\/api\/attachments\/details\/(det_[A-Za-z0-9_-]{16,80})$/)?.[1] ?? null;
  } catch {
    return null;
  }
}

async function matchesQuestionDetailsHash(params: { detailsHash: string; detailsUrl: string; text: string }) {
  const expected = params.detailsHash.toLowerCase();
  const rawHash = await sha256Hex(params.text);
  if (rawHash.toLowerCase() === expected) return true;

  const detailsId = detailsIdFromUrl(params.detailsUrl);
  if (!detailsId) return false;
  const gatedHash = await sha256Hex(
    questionDetailsHashInput({ detailsId, normalizedText: params.text, requiresGatedAccess: true }),
  );
  return gatedHash.toLowerCase() === expected;
}

export async function readQuestionDetailsResponseText(response: Response) {
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const parsedContentLength = Number(contentLength);
    if (Number.isSafeInteger(parsedContentLength) && parsedContentLength > MAX_QUESTION_DETAILS_TEXT_BYTES) {
      throw new Error("Details are too large.");
    }
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Details response cannot be read safely.");
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  let receivedBytes = 0;
  let text = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > MAX_QUESTION_DETAILS_TEXT_BYTES) {
        throw new Error("Details are too large.");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof TypeError) {
      throw new Error("Details are not valid UTF-8.");
    }
    throw error;
  } finally {
    reader.releaseLock();
  }

  return text;
}

export function QuestionDescription({
  description,
  detailsHash,
  detailsUrl,
  referencedContentById,
  previewWordLimit,
  previewLayout = "default",
  className,
}: QuestionDescriptionProps) {
  const [detailsText, setDetailsText] = React.useState<string | null>(null);
  const [detailsError, setDetailsError] = React.useState<string | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = React.useState(false);
  const [isExpanded, setIsExpanded] = React.useState(false);
  const hasDetails = Boolean(detailsUrl);
  const baseText = detailsText ?? description.trim();
  const previewText = getDescriptionPreviewText(baseText, previewWordLimit);
  const displayText = isExpanded ? baseText : previewText;
  const parsed = parseQuestionReferences(displayText);
  const canExpand = Boolean(baseText && (isExpanded || baseText !== previewText || (hasDetails && !detailsText)));
  const shouldRenderToggle = hasDetails || canExpand;
  const useInlineTogglePreview = previewLayout === "inline-toggle" && !isExpanded && displayText && shouldRenderToggle;

  const loadDetails = React.useCallback(async () => {
    if (!detailsUrl) return;
    if (detailsText) return;

    setIsLoadingDetails(true);
    setDetailsError(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DETAILS_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(resolveQuestionDetailsFetchUrl(detailsUrl), { signal: controller.signal });
      if (!response.ok) throw new Error("Details are not available.");
      const text = await readQuestionDetailsResponseText(response);
      if (detailsHash) {
        if (!(await matchesQuestionDetailsHash({ detailsHash, detailsUrl, text }))) {
          throw new Error("Details hash mismatch.");
        }
      }
      setDetailsText(text);
    } catch (error) {
      setDetailsError(
        error instanceof DOMException && error.name === "AbortError"
          ? "Details request timed out."
          : error instanceof Error
            ? error.message
            : "Could not load details.",
      );
    } finally {
      clearTimeout(timeout);
      setIsLoadingDetails(false);
    }
  }, [detailsHash, detailsText, detailsUrl]);

  React.useEffect(() => {
    if (!description.trim() && detailsUrl) {
      void loadDetails();
    }
  }, [description, detailsUrl, loadDetails]);

  const handleToggleDetails = async () => {
    if (!isExpanded && hasDetails && !detailsText) {
      await loadDetails();
      setIsExpanded(true);
      return;
    }
    setIsExpanded(previous => !previous);
  };

  const renderDescriptionSegments = ({ linkReferences = true } = {}) =>
    parsed.segments.map((segment, index) => {
      if (segment.type === "text") {
        return segment.text;
      }

      const summary = referencedContentById?.get(segment.contentId);
      const label = getReferenceLabel(segment.contentId, segment.label, summary);
      if (!linkReferences) {
        return label;
      }

      return (
        <Link
          key={`${segment.contentId}-${index}`}
          href={buildRateContentHref(segment.contentId)}
          aria-label={`Rate related question: ${label}`}
          className="inline-flex max-w-full items-center align-baseline rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-left text-sm font-semibold leading-snug text-primary transition-colors hover:border-primary/50 hover:bg-primary/15 hover:text-primary-focus"
        >
          <span className="min-w-0 break-words">{label}</span>
        </Link>
      );
    });

  const toggleButton = (
    <button
      type="button"
      onClick={handleToggleDetails}
      className="text-sm font-semibold text-primary transition-colors hover:text-primary-focus disabled:text-primary/60"
      disabled={isLoadingDetails}
      aria-expanded={isExpanded}
    >
      {isExpanded ? "Show Less" : isLoadingDetails ? "Loading..." : "Show More"}
    </button>
  );

  if (useInlineTogglePreview) {
    const previewClassName = `${className ?? ""} min-w-0 flex-1 line-clamp-1`.trim();

    return (
      <div className="space-y-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <p className={previewClassName}>{renderDescriptionSegments({ linkReferences: false })}</p>
          <span className="shrink-0 whitespace-nowrap">{toggleButton}</span>
        </div>
        {detailsError ? <p className="text-sm text-error">{detailsError}</p> : null}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {displayText ? <p className={className}>{renderDescriptionSegments()}</p> : null}
      {shouldRenderToggle ? (
        <div className="space-y-2">
          {toggleButton}
          {detailsError ? <p className="text-sm text-error">{detailsError}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

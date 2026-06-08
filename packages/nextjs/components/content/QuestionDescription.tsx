"use client";

import React from "react";
import Link from "next/link";
import { buildRateContentHref } from "~~/constants/routes";
import { MAX_QUESTION_DETAILS_TEXT_BYTES } from "~~/lib/attachments/questionDetails.shared";
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
  className?: string;
};

const DETAILS_FETCH_TIMEOUT_MS = 10_000;
const DESCRIPTION_PREVIEW_WORDS = 32;

function getDescriptionPreviewText(value: string, wordLimit = DESCRIPTION_PREVIEW_WORDS) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length <= wordLimit) {
    return words.join(" ");
  }
  return `${words.slice(0, wordLimit).join(" ")}...`;
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
  className,
}: QuestionDescriptionProps) {
  const [detailsText, setDetailsText] = React.useState<string | null>(null);
  const [detailsError, setDetailsError] = React.useState<string | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = React.useState(false);
  const [isExpanded, setIsExpanded] = React.useState(false);
  const hasDetails = Boolean(detailsUrl);
  const baseText = detailsText ?? description.trim();
  const previewText = getDescriptionPreviewText(baseText);
  const displayText = isExpanded ? baseText : previewText;
  const parsed = parseQuestionReferences(displayText);
  const canExpand = Boolean(baseText && (isExpanded || baseText !== previewText || (hasDetails && !detailsText)));

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
        const fetchedHash = await sha256Hex(text);
        if (fetchedHash.toLowerCase() !== detailsHash.toLowerCase()) {
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

  return (
    <div className="space-y-2">
      {displayText ? (
        <p className={className}>
          {parsed.segments.map((segment, index) => {
            if (segment.type === "text") {
              return segment.text;
            }

            const summary = referencedContentById?.get(segment.contentId);
            const label = getReferenceLabel(segment.contentId, segment.label, summary);

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
          })}
        </p>
      ) : null}
      {hasDetails || canExpand ? (
        <div className="space-y-2">
          <button
            type="button"
            onClick={handleToggleDetails}
            className="text-sm font-semibold text-primary transition-colors hover:text-primary-focus"
            disabled={isLoadingDetails}
          >
            {isExpanded ? "Show Less" : isLoadingDetails ? "Loading..." : "Show More"}
          </button>
          {detailsError ? <p className="text-sm text-error">{detailsError}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

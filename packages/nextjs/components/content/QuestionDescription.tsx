"use client";

import React from "react";
import Link from "next/link";
import { buildRateContentHref } from "~~/constants/routes";
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

export function QuestionDescription({
  description,
  detailsHash,
  detailsUrl,
  referencedContentById,
  className,
}: QuestionDescriptionProps) {
  const parsed = parseQuestionReferences(description);
  const [detailsText, setDetailsText] = React.useState<string | null>(null);
  const [detailsError, setDetailsError] = React.useState<string | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = React.useState(false);
  const hasDetails = Boolean(detailsUrl);

  const handleToggleDetails = async () => {
    if (detailsText) {
      setDetailsText(null);
      setDetailsError(null);
      return;
    }
    if (!detailsUrl) return;

    setIsLoadingDetails(true);
    setDetailsError(null);
    try {
      const response = await fetch(detailsUrl);
      if (!response.ok) throw new Error("Details are not available.");
      const text = await response.text();
      if (detailsHash) {
        const fetchedHash = await sha256Hex(text);
        if (fetchedHash.toLowerCase() !== detailsHash.toLowerCase()) {
          throw new Error("Details hash mismatch.");
        }
      }
      setDetailsText(text);
    } catch (error) {
      setDetailsError(error instanceof Error ? error.message : "Could not load details.");
    } finally {
      setIsLoadingDetails(false);
    }
  };

  return (
    <div className="space-y-2">
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
      {hasDetails ? (
        <div className="space-y-2">
          <button
            type="button"
            onClick={handleToggleDetails}
            className="text-sm font-semibold text-primary transition-colors hover:text-primary-focus"
            disabled={isLoadingDetails}
          >
            {detailsText ? "Show Less" : isLoadingDetails ? "Loading..." : "Show More"}
          </button>
          {detailsError ? <p className="text-sm text-error">{detailsError}</p> : null}
          {detailsText ? (
            <div className="whitespace-pre-wrap rounded-lg border border-base-300 bg-base-100/70 p-3 text-base leading-relaxed text-base-content/85">
              {detailsText}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

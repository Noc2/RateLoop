"use client";

import React from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { XMarkIcon } from "@heroicons/react/24/outline";
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
  expandBehavior?: "inline" | "modal";
  className?: string;
};

const DETAILS_FETCH_TIMEOUT_MS = 10_000;
const DESCRIPTION_PREVIEW_WORDS = 32;
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

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

function getFocusableElements(container: HTMLElement | null) {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    element => element.getAttribute("aria-hidden") !== "true",
  );
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
  expandBehavior = "inline",
  className,
}: QuestionDescriptionProps) {
  const [detailsText, setDetailsText] = React.useState<string | null>(null);
  const [detailsError, setDetailsError] = React.useState<string | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = React.useState(false);
  const [isExpanded, setIsExpanded] = React.useState(false);
  const [isModalOpen, setIsModalOpen] = React.useState(false);
  const dialogId = React.useId();
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  const closeButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const hasDetails = Boolean(detailsUrl);
  const baseText = detailsText ?? description.trim();
  const previewText = getDescriptionPreviewText(baseText, previewWordLimit);
  const displayText = isExpanded ? baseText : previewText;
  const canExpand = Boolean(baseText && (isExpanded || baseText !== previewText || (hasDetails && !detailsText)));
  const shouldRenderToggle = hasDetails || canExpand;
  const useInlineTogglePreview = previewLayout === "inline-toggle" && !isExpanded && displayText && shouldRenderToggle;
  const useModalExpansion = expandBehavior === "modal";

  const loadDetails = React.useCallback(async () => {
    if (!detailsUrl) return true;
    if (detailsText) return true;

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
      return false;
    } finally {
      clearTimeout(timeout);
      setIsLoadingDetails(false);
    }
    return true;
  }, [detailsHash, detailsText, detailsUrl]);

  React.useEffect(() => {
    if (!description.trim() && detailsUrl) {
      void loadDetails();
    }
  }, [description, detailsUrl, loadDetails]);

  React.useEffect(() => {
    if (!isModalOpen) return;

    const triggerElement = triggerRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const focusTimer = window.setTimeout(() => {
      closeButtonRef.current?.focus({ preventScroll: true });
    }, 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsModalOpen(false);
        return;
      }

      if (event.key !== "Tab") return;

      const focusableElements = getFocusableElements(dialogRef.current);
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (!firstElement || !lastElement) {
        event.preventDefault();
        dialogRef.current?.focus({ preventScroll: true });
        return;
      }

      if (event.shiftKey && (document.activeElement === firstElement || document.activeElement === dialogRef.current)) {
        event.preventDefault();
        lastElement.focus({ preventScroll: true });
        return;
      }

      if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus({ preventScroll: true });
      }
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);

      const returnFocusTarget = previousFocus && document.contains(previousFocus) ? previousFocus : triggerElement;
      returnFocusTarget?.focus({ preventScroll: true });
    };
  }, [isModalOpen]);

  const handleToggleDetails = async () => {
    if (useModalExpansion) {
      if (hasDetails && !detailsText) {
        const loaded = await loadDetails();
        if (!loaded) return;
      }
      setIsModalOpen(true);
      return;
    }

    if (!isExpanded && hasDetails && !detailsText) {
      await loadDetails();
      setIsExpanded(true);
      return;
    }
    setIsExpanded(previous => !previous);
  };

  const renderDescriptionSegments = (text: string, { linkReferences = true } = {}) =>
    parseQuestionReferences(text).segments.map((segment, index) => {
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
      ref={triggerRef}
      type="button"
      onClick={handleToggleDetails}
      className="text-sm font-semibold text-primary transition-colors hover:text-primary-focus disabled:text-primary/60"
      disabled={isLoadingDetails}
      aria-expanded={useModalExpansion ? undefined : isExpanded}
      aria-haspopup={useModalExpansion ? "dialog" : undefined}
      aria-controls={useModalExpansion && isModalOpen ? dialogId : undefined}
    >
      {!useModalExpansion && isExpanded ? "Show Less" : isLoadingDetails ? "Loading..." : "Show More"}
    </button>
  );

  const detailsDialog = isModalOpen ? (
    <div
      id={dialogId}
      ref={dialogRef}
      className="fixed inset-0 z-[2000] flex items-end justify-center bg-black/80 px-4 py-5 backdrop-blur-md sm:items-center sm:py-6"
      role="dialog"
      aria-modal="true"
      aria-label="Question details"
      tabIndex={-1}
      onClick={() => setIsModalOpen(false)}
    >
      <section
        className="relative max-h-[82vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-white/10 bg-base-200 text-base-content shadow-[0_24px_80px_rgba(0,0,0,0.64)]"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-base-content/10 px-5 py-4">
          <h2 className="text-lg font-semibold leading-tight">Question details</h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={() => setIsModalOpen(false)}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-base-100/80 text-base-content shadow transition-colors hover:bg-base-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/80"
            aria-label="Close question details"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[calc(82vh-4.5rem)] overflow-y-auto px-5 py-5">
          {baseText ? (
            <p className="whitespace-pre-wrap break-words text-base leading-relaxed text-base-content/85">
              {renderDescriptionSegments(baseText)}
            </p>
          ) : null}
        </div>
      </section>
    </div>
  ) : null;

  if (useInlineTogglePreview) {
    const previewClassName = `${className ?? ""} min-w-0 flex-1 line-clamp-1`.trim();

    return (
      <>
        <div className="space-y-2">
          <div className="flex min-w-0 items-baseline gap-2">
            <p className={previewClassName}>{renderDescriptionSegments(displayText, { linkReferences: false })}</p>
            <span className="shrink-0 whitespace-nowrap">{toggleButton}</span>
          </div>
          {detailsError ? <p className="text-sm text-error">{detailsError}</p> : null}
        </div>
        {detailsDialog ? createPortal(detailsDialog, document.body) : null}
      </>
    );
  }

  return (
    <>
      <div className="space-y-2">
        {displayText ? <p className={className}>{renderDescriptionSegments(displayText)}</p> : null}
        {shouldRenderToggle ? (
          <div className="space-y-2">
            {toggleButton}
            {detailsError ? <p className="text-sm text-error">{detailsError}</p> : null}
          </div>
        ) : null}
      </div>
      {detailsDialog ? createPortal(detailsDialog, document.body) : null}
    </>
  );
}

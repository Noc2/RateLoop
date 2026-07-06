"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { CheckIcon, ClipboardIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { GradientActionInner, getGradientActionClassName } from "~~/components/shared/GradientAction";
import { buildRateContentHref } from "~~/constants/routes";
import { useCopyToClipboard } from "~~/hooks/scaffold-eth";
import { truncateContentTitle } from "~~/lib/contentTitle";
import { type ContentShareContentInput, buildContentShareData } from "~~/lib/social/contentShare";

interface ShareModalProps {
  contentId: bigint;
  chainId?: number | null;
  title: string;
  description: string;
  rating?: number | null;
  ratingBps?: number;
  ratingSettledRounds?: number;
  totalVotes?: number;
  lastActivityAt?: string | null;
  openRound?: ContentShareContentInput["openRound"];
  onClose: () => void;
}

export function ShareModal({
  contentId,
  chainId,
  title,
  description,
  rating = null,
  ratingBps,
  ratingSettledRounds = 0,
  totalVotes = 0,
  lastActivityAt,
  openRound,
  onClose,
}: ShareModalProps) {
  const { copyToClipboard, isCopiedToClipboard: copied } = useCopyToClipboard({ successDurationMs: 2000 });
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const shareDetails = useMemo(() => {
    if (typeof window === "undefined") return { ratingLabel: null, url: "" };

    const shareData = buildContentShareData(
      {
        id: contentId.toString(),
        chainId,
        title,
        description,
        rating,
        ratingBps,
        ratingSettledRounds,
        totalVotes,
        lastActivityAt,
        openRound,
      },
      window.location.origin,
    );

    return { ratingLabel: shareData.rating?.label ?? null, url: shareData.shareUrl };
  }, [
    chainId,
    contentId,
    description,
    lastActivityAt,
    openRound,
    rating,
    ratingBps,
    ratingSettledRounds,
    title,
    totalVotes,
  ]);
  const shareUrl = shareDetails.url;
  const truncatedTitle = truncateContentTitle(title);
  const tweetText = shareDetails.ratingLabel
    ? `I just submitted "${truncatedTitle}" on RateLoop. Current rating: ${shareDetails.ratingLabel}/10. Rate and build your reputation: ${shareUrl}`
    : `I just submitted "${truncatedTitle}" on RateLoop! Rate and build your reputation: ${shareUrl}`;

  const handleCopyLink = async () => {
    await copyToClipboard(shareUrl);
  };

  if (!isMounted) {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Question submitted"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default bg-black/40 backdrop-blur-sm"
        aria-label="Close share dialog"
        onClick={onClose}
      />
      <div className="relative z-10 max-h-[calc(100svh-1rem)] w-full max-w-md overflow-y-auto rounded-t-2xl bg-base-200 p-6 shadow-2xl sm:rounded-2xl">
        <button
          onClick={onClose}
          className="btn btn-sm btn-circle btn-ghost absolute right-3 top-3 text-base-content/70 hover:text-base-content"
          aria-label="Close"
        >
          <XMarkIcon className="h-5 w-5" />
        </button>

        {/* Success icon */}
        <div className="mb-4 flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/20">
            <CheckIcon className="h-8 w-8 text-primary" />
          </div>
        </div>

        <p className="mb-2 text-center text-sm font-semibold uppercase tracking-[0.16em] text-base-content/55">
          Question submitted
        </p>
        <h3 className="mb-2 px-9 text-balance break-words text-center text-lg font-semibold leading-tight">{title}</h3>
        {description ? (
          <p className="mb-6 text-center text-sm text-base-content/70 line-clamp-2">{description}</p>
        ) : null}

        {/* Share buttons */}
        <div className="space-y-2.5">
          {/* View content */}
          <Link
            href={buildRateContentHref(contentId, { chainId, waitForContent: true })}
            className={getGradientActionClassName("!w-full")}
            data-motion="idle"
          >
            <GradientActionInner>View Content</GradientActionInner>
          </Link>

          {/* Copy link */}
          <button type="button" onClick={handleCopyLink} className="btn btn-outline w-full gap-2">
            {copied ? (
              <>
                <CheckIcon className="h-5 w-5 text-success" />
                Copied!
              </>
            ) : (
              <>
                <ClipboardIcon className="h-5 w-5" />
                Copy Link
              </>
            )}
          </button>

          {/* Twitter/X share */}
          <a
            href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-outline w-full gap-2"
          >
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            Share on X
          </a>
        </div>

        {/* Divider */}
        <div className="divider my-4">or</div>

        {/* Submit another */}
        <button onClick={onClose} className="btn btn-outline w-full gap-2">
          Submit Another
        </button>
      </div>
    </div>,
    document.body,
  );
}

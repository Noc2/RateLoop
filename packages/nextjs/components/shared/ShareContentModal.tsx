"use client";

import { type PointerEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { CheckIcon, ClipboardIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { GradientActionButton } from "~~/components/shared/GradientAction";
import { useCopyToClipboard } from "~~/hooks/scaffold-eth";
import { truncateContentTitle } from "~~/lib/contentTitle";
import { type ContentShareContentInput, buildContentShareData } from "~~/lib/social/contentShare";

interface ShareContentModalProps {
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

export function ShareContentModal({
  contentId,
  chainId,
  title,
  description,
  rating,
  ratingBps,
  ratingSettledRounds,
  totalVotes,
  lastActivityAt,
  openRound,
  onClose,
}: ShareContentModalProps) {
  const { copyToClipboard, isCopiedToClipboard: copied } = useCopyToClipboard({ successDurationMs: 2000 });
  const [isMounted, setIsMounted] = useState(false);
  const closeModal = useCallback(() => {
    onClose();
  }, [onClose]);
  const handleClosePointerDown = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      closeModal();
    },
    [closeModal],
  );

  // Close on Escape key
  useEffect(() => {
    setIsMounted(true);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closeModal]);

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

  const handleCopyLink = async () => {
    await copyToClipboard(shareUrl);
  };

  const tweetText = shareDetails.ratingLabel
    ? `Rated ${shareDetails.ratingLabel}/10 on RateLoop: "${truncatedTitle}" ${shareUrl}`
    : `Check out "${truncatedTitle}" on RateLoop! ${shareUrl}`;

  if (!isMounted) {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={`Share ${title}`}
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default bg-black/40 backdrop-blur-sm"
        aria-label="Dismiss share dialog"
        onClick={closeModal}
        onPointerDown={handleClosePointerDown}
      />
      <div className="relative z-10 max-h-[calc(100svh-1rem)] w-full max-w-md overflow-y-auto rounded-t-2xl bg-base-200 p-6 shadow-2xl sm:rounded-2xl">
        <button
          type="button"
          onClick={closeModal}
          onPointerDown={handleClosePointerDown}
          className="btn btn-sm btn-circle btn-ghost absolute right-3 top-3 z-20 text-base-content/70 hover:text-base-content"
          aria-label="Close share dialog"
        >
          <XMarkIcon className="h-5 w-5" />
        </button>

        <h3 className="mb-3 px-9 text-balance break-words text-center text-lg font-semibold leading-tight">{title}</h3>
        {description ? (
          <p className="mb-5 text-center text-sm text-base-content/75 line-clamp-2">{description}</p>
        ) : null}

        {/* Share buttons */}
        <div className="space-y-2.5">
          {/* Copy Link */}
          <GradientActionButton onClick={handleCopyLink} className="!w-full">
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
          </GradientActionButton>

          {/* Facebook */}
          <a
            href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-outline w-full gap-2"
          >
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
            </svg>
            Share on Facebook
          </a>

          {/* Reddit */}
          <a
            href={`https://reddit.com/submit?url=${encodeURIComponent(shareUrl)}&title=${encodeURIComponent(truncatedTitle)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-outline w-full gap-2"
          >
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 0C5.373 0 0 5.373 0 12c0 6.627 5.373 12 12 12s12-5.373 12-12c0-6.627-5.373-12-12-12zm6.066 13.71c.147.307.216.636.216.98 0 .98-.477 1.878-1.33 2.556C16.098 18.01 14.146 18.5 12 18.5c-2.146 0-4.098-.49-4.952-1.254-.853-.678-1.33-1.576-1.33-2.556 0-.344.07-.673.216-.98a1.834 1.834 0 0 1-.216-.863c0-.534.223-1.016.58-1.365a1.844 1.844 0 0 1-.034-.344c0-.534.223-1.016.58-1.365A1.844 1.844 0 0 1 8.2 8.407c.6-.346 1.357-.557 2.2-.627l1.6-3.8a.6.6 0 0 1 .713-.36l2.7.6a1.2 1.2 0 1 1-.134.587l-2.4-.533-1.42 3.373c.788.082 1.5.29 2.063.618a1.844 1.844 0 0 1 1.355.58c.358.349.58.831.58 1.365 0 .12-.012.236-.034.344.358.349.58.831.58 1.365 0 .308-.075.6-.216.863zM9.6 14.4a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4zm4.8 0a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4zm-4.89 1.62c.06.06.15.06.21 0 .57-.57 1.32-.84 2.28-.84.96 0 1.71.27 2.28.84a.15.15 0 0 0 .21 0 .15.15 0 0 0 0-.21c-.63-.63-1.47-.93-2.49-.93s-1.86.3-2.49.93a.15.15 0 0 0 0 .21z" />
            </svg>
            Share on Reddit
          </a>

          {/* Twitter/X */}
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
      </div>
    </div>,
    document.body,
  );
}

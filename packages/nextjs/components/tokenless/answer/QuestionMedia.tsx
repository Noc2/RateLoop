"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type PublicQuestionMedia =
  | { kind: "images"; items: Array<{ alt: string; assetId: string; digest: `sha256:${string}` }> }
  | { kind: "youtube"; videoId: string };

export type QuestionMediaReviewState =
  | { status: "pending" }
  | { status: "ready" }
  | { status: "error"; message: string };

export function QuestionMedia({
  media,
  onReviewStateChange,
}: {
  media: PublicQuestionMedia;
  onReviewStateChange?: (state: QuestionMediaReviewState) => void;
}) {
  const [selectedImage, setSelectedImage] = useState<number | null>(null);
  const [playVideo, setPlayVideo] = useState(false);
  const [loadedImages, setLoadedImages] = useState<Set<string>>(() => new Set());
  const imageButtonsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setLoadedImages(new Set());
    setPlayVideo(false);
    onReviewStateChange?.({ status: "pending" });
  }, [media, onReviewStateChange]);

  useEffect(() => {
    if (media.kind === "images" && loadedImages.size === media.items.length) {
      onReviewStateChange?.({ status: "ready" });
    }
  }, [loadedImages, media, onReviewStateChange]);

  const closePreview = useCallback(() => {
    const previousIndex = selectedImage;
    setSelectedImage(null);
    window.setTimeout(() => {
      if (previousIndex !== null) imageButtonsRef.current[previousIndex]?.focus();
    }, 0);
  }, [selectedImage]);

  useEffect(() => {
    if (selectedImage === null) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePreview();
    };
    closeButtonRef.current?.focus();
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [closePreview, selectedImage]);

  if (media.kind === "youtube") {
    return (
      <div className="mt-6 overflow-hidden rounded-xl border border-white/10 bg-black/30">
        {playVideo ? (
          <iframe
            className="aspect-video w-full"
            src={`https://www.youtube-nocookie.com/embed/${media.videoId}?autoplay=1&rel=0`}
            title="YouTube context for this question"
            allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-presentation"
            onLoad={() => onReviewStateChange?.({ status: "ready" })}
            onError={() =>
              onReviewStateChange?.({
                status: "error",
                message: "The YouTube context could not be loaded. Check it before sharing this ask.",
              })
            }
          />
        ) : (
          <button
            type="button"
            className="group flex aspect-video w-full flex-col items-center justify-center bg-[radial-gradient(circle_at_center,rgba(118,170,255,0.16),transparent_58%)] px-6 text-center"
            onClick={() => setPlayVideo(true)}
            aria-label="Load and play YouTube video"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-xl text-black shadow-lg transition-transform group-hover:scale-105">
              ▶
            </span>
            <span className="mt-4 text-sm font-medium text-white">Load YouTube video</span>
            <span className="mt-1 text-xs text-white/50">
              The privacy-enhanced player loads only after you choose play.
            </span>
            <span className="mt-2 font-mono text-[11px] text-white/40">Video {media.videoId}</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <>
      <div className={`mt-6 grid gap-2 ${media.items.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
        {media.items.map((image, index) => (
          <button
            key={image.assetId}
            ref={element => {
              imageButtonsRef.current[index] = element;
            }}
            type="button"
            className={`overflow-hidden rounded-xl border border-white/10 bg-black/30 text-left transition-colors hover:border-white/25 ${
              media.items.length === 3 && index === 0 ? "col-span-2" : ""
            }`}
            onClick={() => setSelectedImage(index)}
            aria-label={`Open image ${index + 1}: ${image.alt}`}
          >
            <img
              src={`/api/public-media/images/${encodeURIComponent(image.assetId)}`}
              alt={image.alt}
              className="aspect-video h-full max-h-80 w-full object-contain"
              loading="lazy"
              onLoad={() =>
                setLoadedImages(current => {
                  const next = new Set(current);
                  next.add(image.assetId);
                  return next;
                })
              }
              onError={() =>
                onReviewStateChange?.({
                  status: "error",
                  message: `Image ${index + 1} could not be loaded. Check it before sharing this ask.`,
                })
              }
            />
          </button>
        ))}
      </div>
      {selectedImage !== null ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Question image preview"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <button
            type="button"
            className="absolute inset-0 cursor-default bg-black/85 backdrop-blur-sm"
            onClick={closePreview}
            aria-label="Close image preview"
          />
          <div className="relative z-10 max-h-full max-w-6xl">
            <button
              ref={closeButtonRef}
              type="button"
              className="absolute right-2 top-2 z-10 rounded-full bg-black/70 px-3 py-1.5 text-sm text-white"
              onClick={closePreview}
              aria-label="Close image preview"
            >
              Close
            </button>
            <img
              src={`/api/public-media/images/${encodeURIComponent(media.items[selectedImage]!.assetId)}`}
              alt={media.items[selectedImage]!.alt}
              className="max-h-[88vh] max-w-full rounded-xl object-contain"
            />
            <p className="mt-2 text-center text-sm text-white/70">{media.items[selectedImage]!.alt}</p>
          </div>
        </div>
      ) : null}
    </>
  );
}

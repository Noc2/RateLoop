"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

export type PublicQuestionMedia =
  | { kind: "images"; items: Array<{ alt: string; assetId: string; digest: `sha256:${string}` }> }
  | { kind: "youtube"; videoId: string };

export type QuestionMediaReviewState =
  | { status: "pending" }
  | { status: "ready" }
  | { status: "error"; message: string };

export type QuestionMediaPreviewCapability = {
  assetId: string;
  digest: `sha256:${string}`;
  previewCapability: string;
};

export function questionMediaImageSource(
  image: { assetId: string; digest: `sha256:${string}` },
  previewCapabilities: QuestionMediaPreviewCapability[] | undefined,
) {
  const base = `/api/public-media/images/${encodeURIComponent(image.assetId)}`;
  const preview = previewCapabilities?.find(
    candidate => candidate.assetId === image.assetId && candidate.digest === image.digest,
  );
  if (!preview) return base;
  const query = new URLSearchParams({ digest: image.digest, preview: preview.previewCapability });
  return `${base}?${query}`;
}

export function QuestionMedia({
  media,
  onReviewStateChange,
  previewCapabilities,
}: {
  media: PublicQuestionMedia;
  onReviewStateChange?: (state: QuestionMediaReviewState) => void;
  previewCapabilities?: QuestionMediaPreviewCapability[];
}) {
  const t = useTranslations("review.media");
  const [selectedImage, setSelectedImage] = useState<number | null>(null);
  const [playVideo, setPlayVideo] = useState(false);
  const [loadedImages, setLoadedImages] = useState<Set<string>>(() => new Set());
  const imageButtonsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const reviewStateListenerRef = useRef(onReviewStateChange);
  // The exact attached context, independent of object identity. A queue reload hands this component
  // an equal but freshly parsed `media` object, which must not discard a loaded video or images.
  const mediaKey =
    media.kind === "youtube"
      ? `youtube:${media.videoId}`
      : `images:${media.items.map(item => `${item.assetId}@${item.digest}`).join("|")}`;
  const expectedImageCount = media.kind === "images" ? media.items.length : null;

  useEffect(() => {
    reviewStateListenerRef.current = onReviewStateChange;
  }, [onReviewStateChange]);

  useEffect(() => {
    setLoadedImages(new Set());
    setPlayVideo(false);
    reviewStateListenerRef.current?.({ status: "pending" });
  }, [mediaKey]);

  useEffect(() => {
    if (expectedImageCount !== null && loadedImages.size === expectedImageCount) {
      reviewStateListenerRef.current?.({ status: "ready" });
    }
  }, [expectedImageCount, loadedImages]);

  const closePreview = useCallback(() => {
    const previousIndex = selectedImage;
    setSelectedImage(null);
    window.setTimeout(() => {
      if (previousIndex !== null) imageButtonsRef.current[previousIndex]?.focus();
    }, 0);
  }, [selectedImage]);

  useEffect(() => {
    if (selectedImage === null) return;
    // The overlay covers the page but the thumbnails behind it stay in the tab order, so a modal
    // preview has to keep Tab and Shift+Tab inside itself. Listening on the window rather than on
    // the dialog also recovers focus that has already escaped the overlay.
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closePreview();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [
        ...(dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]") ?? []),
      ];
      if (focusable.length === 0) return;
      const current = focusable.indexOf(document.activeElement as HTMLElement);
      const next =
        current < 0
          ? event.shiftKey
            ? focusable.at(-1)
            : focusable[0]
          : focusable[(current + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length];
      event.preventDefault();
      next?.focus();
    };
    closeButtonRef.current?.focus();
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [closePreview, selectedImage]);

  if (media.kind === "youtube") {
    return (
      <div className="mt-6 overflow-hidden rounded-xl border border-white/10 bg-[var(--rateloop-media-surface)]">
        {playVideo ? (
          <iframe
            className="aspect-video w-full"
            src={`https://www.youtube-nocookie.com/embed/${media.videoId}?autoplay=1&rel=0`}
            title={t("youtubeTitle")}
            allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-presentation"
            onLoad={() => onReviewStateChange?.({ status: "ready" })}
            onError={() =>
              onReviewStateChange?.({
                status: "error",
                message: t("youtubeFailed"),
              })
            }
          />
        ) : (
          <button
            type="button"
            className="group flex aspect-video w-full flex-col items-center justify-center bg-[radial-gradient(circle_at_center,rgba(118,170,255,0.16),transparent_58%)] px-6 text-center"
            onClick={() => setPlayVideo(true)}
            aria-label={t("loadYoutubeLabel")}
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-xl text-black shadow-lg transition-transform group-hover:scale-105">
              ▶
            </span>
            <span className="mt-4 text-sm font-medium text-white">{t("loadYoutube")}</span>
            <span className="mt-1 text-xs text-white/50">
              The privacy-enhanced player loads only after you choose play.
            </span>
            <span className="mt-2 font-mono text-[11px] text-white/60">Video {media.videoId}</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <>
      <div className={`mt-6 grid gap-2 ${media.items.length === 1 ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2"}`}>
        {media.items.map((image, index) => (
          <button
            key={image.assetId}
            ref={element => {
              imageButtonsRef.current[index] = element;
            }}
            type="button"
            className={`overflow-hidden rounded-xl border border-white/10 bg-[var(--rateloop-media-surface)] text-left transition-colors hover:border-white/25 ${
              media.items.length === 3 && index === 0 ? "sm:col-span-2" : ""
            }`}
            onClick={() => setSelectedImage(index)}
            aria-label={t("openImage", { index: index + 1, alt: image.alt })}
          >
            <img
              src={questionMediaImageSource(image, previewCapabilities)}
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
                  message: t("imageFailed", { index: index + 1 }),
                })
              }
            />
          </button>
        ))}
      </div>
      {selectedImage !== null ? (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={t("questionPreview")}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <button
            type="button"
            className="absolute inset-0 cursor-default bg-black/85 backdrop-blur-sm"
            onClick={closePreview}
            aria-label={t("closePreview")}
          />
          <div className="relative z-10 max-h-full max-w-6xl">
            <button
              ref={closeButtonRef}
              type="button"
              className="absolute right-2 top-2 z-10 rounded-full bg-black/70 px-3 py-1.5 text-sm text-white"
              onClick={closePreview}
              aria-label={t("closePreview")}
            >
              Close
            </button>
            <img
              src={questionMediaImageSource(media.items[selectedImage]!, previewCapabilities)}
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

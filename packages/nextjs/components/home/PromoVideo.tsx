"use client";

import { useRef, useState } from "react";

/**
 * Click-to-play promo video: a static poster with a play button until the
 * visitor opts in, so the 11 MB MP4 never loads during initial page render.
 * Captions ship as a toggleable WebVTT track (off by default since playback
 * starts with sound after an explicit click).
 */
export function PromoVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);

  const handlePlay = () => {
    setStarted(true);
    void videoRef.current?.play();
  };

  return (
    <div className="relative mb-14 w-full overflow-hidden rounded-lg bg-base-300 shadow-[0_24px_60px_rgb(0_0_0/0.35)]">
      {}
      <video
        ref={videoRef}
        controls={started}
        preload="none"
        playsInline
        poster="/videos/rateloop-promo-poster.jpg"
        className="block aspect-video h-auto w-full"
      >
        <source src="/videos/rateloop-promo.mp4" type="video/mp4" />
        <track kind="captions" src="/videos/rateloop-promo.vtt" srcLang="en" label="English" />
      </video>
      {!started ? (
        <button
          type="button"
          onClick={handlePlay}
          aria-label="Play the RateLoop intro video"
          className="group absolute inset-0 flex items-center justify-center bg-black/25 transition hover:bg-black/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-base-content"
        >
          <span className="flex h-20 w-20 items-center justify-center rounded-full border border-white/25 bg-black/55 backdrop-blur-sm transition group-hover:scale-105 group-hover:bg-black/70">
            <svg viewBox="0 0 24 24" className="ml-1 h-9 w-9 fill-white" aria-hidden="true">
              <path d="M8 5.5v13l11-6.5z" />
            </svg>
          </span>
          <span className="pointer-events-none absolute bottom-4 right-5 rounded-md bg-black/55 px-2.5 py-1 font-mono text-xs text-white/85 backdrop-blur-sm">
            1:07
          </span>
        </button>
      ) : null}
    </div>
  );
}

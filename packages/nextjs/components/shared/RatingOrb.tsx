"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import {
  type DisplayRating,
  clampContentRating,
  formatCommunityRatingAriaLabel,
  formatRatingScoreOutOfTen,
  hasVisibleRating,
} from "~~/lib/ui/ratingDisplay";

const START_ANGLE = 0;
const MIN_ANIMATION_MS = 500;
const MAX_ANIMATION_MS = 1200;
const INNER_SURFACE = "var(--rateloop-surface-nested)";
const INNER_SURFACE_EDGE = "var(--rateloop-surface-elevated-hover)";

function easeOutCubic(progress: number) {
  return 1 - Math.pow(1 - progress, 3);
}

function polarToCartesian(center: number, radius: number, angleInDegrees: number) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180;
  return {
    x: center + radius * Math.cos(angleInRadians),
    y: center + radius * Math.sin(angleInRadians),
  };
}

interface RatingOrbProps {
  rating: DisplayRating;
  size?: number;
  className?: string;
}

export function RatingOrb({ rating, size = 196, className = "" }: RatingOrbProps) {
  const orbId = useId().replace(/:/g, "");
  const progressGradientId = `${orbId}-progress-gradient`;
  const progressStroke = `url(#${progressGradientId})`;
  const hasRating = hasVisibleRating(rating);
  const clampedRating = hasRating ? clampContentRating(rating) : 0;
  const [animatedRating, setAnimatedRating] = useState(0);
  const animatedRatingRef = useRef(0);
  const center = size / 2;
  const trackRadius = size * 0.41;
  const displayedRating = hasRating ? clampContentRating(animatedRating) : null;
  const displayedScore = formatRatingScoreOutOfTen(displayedRating);
  const progress = displayedRating === null ? 0 : displayedRating / 100;
  const circumference = 2 * Math.PI * trackRadius;
  const progressLength = circumference * progress;
  const endPoint = polarToCartesian(center, trackRadius, START_ANGLE + progress * 360);
  const isTinyOrb = size <= 64;
  const isCompactOrb = size <= 88;
  const isSmallOrb = size <= 100;
  const trackWidth = isTinyOrb ? Math.max(3, size * 0.065) : Math.max(8, size * 0.034);
  const progressStrokeWidth = trackWidth * 0.6;
  const progressHighlightStrokeWidth = Math.max(2, trackWidth * 0.22);
  const innerCircleGap = Math.max(2, trackWidth * 0.5);
  const innerCircleRadius = trackRadius - progressStrokeWidth / 2 - innerCircleGap;
  const ratingFontSize = isTinyOrb
    ? Math.max(12, size * 0.26)
    : isCompactOrb
      ? Math.max(21, size * 0.235)
      : isSmallOrb
        ? Math.max(24, size * 0.26)
        : Math.max(34, size * 0.23);
  const scaleFontSize = isTinyOrb
    ? Math.max(6, ratingFontSize * 0.36)
    : isCompactOrb
      ? Math.max(8, ratingFontSize * 0.32)
      : isSmallOrb
        ? Math.max(10, ratingFontSize * 0.34)
        : Math.max(15, ratingFontSize * 0.38);
  const scoreGapClassName = isTinyOrb ? "ml-0.5" : isSmallOrb ? "ml-1" : "ml-2";
  const scoreMaxWidth = isTinyOrb ? size * 0.84 : trackRadius * 1.7;

  useEffect(() => {
    if (!hasRating) {
      animatedRatingRef.current = 0;
      setAnimatedRating(0);
      return;
    }

    if (typeof window === "undefined") return;

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mediaQuery.matches) {
      animatedRatingRef.current = clampedRating;
      setAnimatedRating(clampedRating);
      return;
    }

    const startRating = animatedRatingRef.current;
    const delta = clampedRating - startRating;

    if (Math.abs(delta) < 0.01) {
      animatedRatingRef.current = clampedRating;
      setAnimatedRating(clampedRating);
      return;
    }

    const duration = Math.min(MAX_ANIMATION_MS, Math.max(MIN_ANIMATION_MS, Math.abs(delta) * 14));
    const startedAt = performance.now();
    let frameId = 0;

    const animate = (now: number) => {
      const rawProgress = Math.min(1, (now - startedAt) / duration);
      const nextRating = startRating + delta * easeOutCubic(rawProgress);

      animatedRatingRef.current = nextRating;
      setAnimatedRating(nextRating);

      if (rawProgress < 1) {
        frameId = window.requestAnimationFrame(animate);
      } else {
        animatedRatingRef.current = clampedRating;
        setAnimatedRating(clampedRating);
      }
    };

    frameId = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frameId);
  }, [clampedRating, hasRating]);

  return (
    <div
      className={`relative flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={formatCommunityRatingAriaLabel(rating)}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 overflow-visible">
        <defs>
          <radialGradient id={`${orbId}-inner-fill`} cx="46%" cy="38%" r="72%">
            <stop offset="0%" stopColor={INNER_SURFACE_EDGE} stopOpacity="0.98" />
            <stop offset="68%" stopColor={INNER_SURFACE} stopOpacity="0.95" />
            <stop offset="100%" stopColor={INNER_SURFACE_EDGE} stopOpacity="0.9" />
          </radialGradient>
          <linearGradient id={progressGradientId} x1="0%" y1="50%" x2="100%" y2="50%">
            <stop offset="0%" stopColor="var(--rateloop-blue)" />
            <stop offset="38%" stopColor="var(--rateloop-green)" />
            <stop offset="68%" stopColor="var(--rateloop-yellow)" />
            <stop offset="100%" stopColor="var(--rateloop-pink)" />
          </linearGradient>
        </defs>

        {progress >= 1 ? (
          <>
            <circle
              cx={center}
              cy={center}
              r={trackRadius}
              fill="none"
              stroke={progressStroke}
              strokeWidth={progressStrokeWidth}
              strokeLinecap="round"
            />
            <circle
              cx={center}
              cy={center}
              r={trackRadius}
              fill="none"
              stroke={progressStroke}
              strokeWidth={progressHighlightStrokeWidth}
              strokeLinecap="round"
              opacity="0.82"
            />
          </>
        ) : progress > 0 ? (
          <>
            <circle
              cx={center}
              cy={center}
              r={trackRadius}
              fill="none"
              stroke={progressStroke}
              strokeWidth={progressStrokeWidth}
              strokeLinecap="round"
              strokeDasharray={`${progressLength} ${circumference}`}
              transform={`rotate(-90 ${center} ${center})`}
            />
            <circle
              cx={center}
              cy={center}
              r={trackRadius}
              fill="none"
              stroke={progressStroke}
              strokeWidth={progressHighlightStrokeWidth}
              strokeLinecap="round"
              opacity="0.82"
              strokeDasharray={`${progressLength} ${circumference}`}
              transform={`rotate(-90 ${center} ${center})`}
            />
            <circle cx={endPoint.x} cy={endPoint.y} r={trackWidth * 0.3} fill={progressStroke} />
          </>
        ) : null}

        <circle
          cx={center}
          cy={center}
          r={innerCircleRadius}
          fill={`url(#${orbId}-inner-fill)`}
          stroke="rgba(245,245,245,0.14)"
          strokeWidth={Math.max(1, trackWidth * 0.12)}
        />
      </svg>

      <div className="relative z-10 flex flex-col items-center justify-center text-center">
        <span
          className="display-metric inline-flex items-end justify-center tabular-nums"
          style={{ color: "var(--rateloop-warm-white)", maxWidth: scoreMaxWidth }}
        >
          <span className="font-semibold tracking-normal" style={{ fontSize: ratingFontSize }}>
            {displayedScore}
          </span>
          {hasRating ? (
            <span
              className={`${scoreGapClassName} mb-[0.12em] shrink-0 font-medium leading-[0.92]`}
              style={{ color: "rgb(255 255 255 / 0.72)", fontSize: scaleFontSize }}
            >
              /10
            </span>
          ) : null}
        </span>
      </div>
    </div>
  );
}

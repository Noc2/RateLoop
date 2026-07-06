import React from "react";
import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { fetchPreviewImageDataUrl } from "./previewImageDataUrl";
import { type ContentShareData, VOTE_SHARE_RATING_VERSION_PARAM } from "~~/lib/social/contentShare";
import { getContentShareDataForParam } from "~~/lib/social/contentShare.server";
import { checkRateLimit } from "~~/utils/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const bodyFontFamily = "sans-serif";
const headingFontFamily = "sans-serif";

const ROUTE_RATE_LIMIT = { limit: 180, windowMs: 60_000 };
const RESOURCE_RATE_LIMIT = { limit: 60, windowMs: 60_000 };
const ROUTE_RATE_LIMIT_KEY = "/api/og/vote";
const RESOURCE_RATE_LIMIT_KEY = `${ROUTE_RATE_LIMIT_KEY}:resource`;
const imageSize = {
  width: 1200,
  height: 630,
};

const versionedResponseHeaders = {
  "Cache-Control": "public, max-age=86400, immutable",
  "CDN-Cache-Control": "public, max-age=86400, stale-while-revalidate=604800, stale-if-error=604800",
  "Vercel-CDN-Cache-Control": "public, max-age=86400, stale-while-revalidate=604800, stale-if-error=604800",
};

const fallbackResponseHeaders = {
  "Cache-Control": "no-store, max-age=0",
};

const brandColors = {
  surface: "#000000",
  surfaceElevated: "#121212",
  surfaceHover: "#1A1A1A",
  surfaceNested: "#121212",
  warmWhite: "#F5F5F5",
  muted: "#A3A3A3",
  border: "rgba(245,245,245,0.1)",
  borderStrong: "rgba(245,245,245,0.16)",
  blue: "#359EEE",
  green: "#03CEA4",
  yellow: "#FFC43D",
  pink: "#EF476F",
};

const spectrumGradient = `linear-gradient(90deg, ${brandColors.blue}, ${brandColors.green}, ${brandColors.yellow}, ${brandColors.pink})`;
const surfaceGradient = `linear-gradient(135deg, ${brandColors.surface} 0%, ${brandColors.surfaceElevated} 52%, ${brandColors.surface} 100%)`;

function RateLoopMark({ size = 46 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" aria-hidden="true" style={{ display: "flex" }}>
      <defs>
        <linearGradient id="og-logo-seg-0" x1="64" y1="21" x2="85.5" y2="26.761" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFC43D" />
          <stop offset="1" stopColor="#FFC43D" />
        </linearGradient>
        <linearGradient id="og-logo-seg-1" x1="85.5" y1="26.761" x2="101.239" y2="42.5" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFC43D" />
          <stop offset="1" stopColor="#FFC43D" />
        </linearGradient>
        <linearGradient id="og-logo-seg-2" x1="101.239" y1="42.5" x2="107" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFC43D" />
          <stop offset="1" stopColor="#FFC43D" />
        </linearGradient>
        <linearGradient id="og-logo-seg-3" x1="107" y1="64" x2="101.239" y2="85.5" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFC43D" />
          <stop offset="1" stopColor="#EF476F" />
        </linearGradient>
        <linearGradient id="og-logo-seg-4" x1="101.239" y1="85.5" x2="85.5" y2="101.239" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#EF476F" />
          <stop offset="1" stopColor="#EF476F" />
        </linearGradient>
        <linearGradient id="og-logo-seg-5" x1="85.5" y1="101.239" x2="64" y2="107" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#EF476F" />
          <stop offset="1" stopColor="#EF476F" />
        </linearGradient>
        <linearGradient id="og-logo-seg-6" x1="64" y1="107" x2="42.5" y2="101.239" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#EF476F" />
          <stop offset="1" stopColor="#EF476F" />
        </linearGradient>
        <linearGradient id="og-logo-seg-7" x1="42.5" y1="101.239" x2="26.761" y2="85.5" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#EF476F" />
          <stop offset="1" stopColor="#359EEE" />
        </linearGradient>
        <linearGradient id="og-logo-seg-8" x1="26.761" y1="85.5" x2="21" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#359EEE" />
          <stop offset="1" stopColor="#359EEE" />
        </linearGradient>
        <linearGradient id="og-logo-seg-9" x1="21" y1="64" x2="26.761" y2="42.5" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#359EEE" />
          <stop offset="1" stopColor="#359EEE" />
        </linearGradient>
        <linearGradient id="og-logo-seg-10" x1="26.761" y1="42.5" x2="42.5" y2="26.761" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#359EEE" />
          <stop offset="1" stopColor="#03CEA4" />
        </linearGradient>
        <linearGradient id="og-logo-seg-11" x1="42.5" y1="26.761" x2="64" y2="21" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#03CEA4" />
          <stop offset="1" stopColor="#FFC43D" />
        </linearGradient>
      </defs>
      <g fill="none" strokeWidth="10" strokeLinecap="butt" strokeLinejoin="round">
        <path d="M64 21 A43 43 0 0 1 85.5 26.761" stroke="url(#og-logo-seg-0)" />
        <path d="M85.5 26.761 A43 43 0 0 1 101.239 42.5" stroke="url(#og-logo-seg-1)" />
        <path d="M101.239 42.5 A43 43 0 0 1 107 64" stroke="url(#og-logo-seg-2)" />
        <path d="M107 64 A43 43 0 0 1 101.239 85.5" stroke="url(#og-logo-seg-3)" />
        <path d="M101.239 85.5 A43 43 0 0 1 85.5 101.239" stroke="url(#og-logo-seg-4)" />
        <path d="M85.5 101.239 A43 43 0 0 1 64 107" stroke="url(#og-logo-seg-5)" />
        <path d="M64 107 A43 43 0 0 1 42.5 101.239" stroke="url(#og-logo-seg-6)" />
        <path d="M42.5 101.239 A43 43 0 0 1 26.761 85.5" stroke="url(#og-logo-seg-7)" />
        <path d="M26.761 85.5 A43 43 0 0 1 21 64" stroke="url(#og-logo-seg-8)" />
        <path d="M21 64 A43 43 0 0 1 26.761 42.5" stroke="url(#og-logo-seg-9)" />
        <path d="M26.761 42.5 A43 43 0 0 1 42.5 26.761" stroke="url(#og-logo-seg-10)" />
        <path d="M42.5 26.761 A43 43 0 0 1 64 21" stroke="url(#og-logo-seg-11)" />
      </g>
    </svg>
  );
}

function GradientFrame({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        display: "flex",
        borderRadius: 10,
        background: spectrumGradient,
        padding: 2,
        overflow: "hidden",
        boxShadow: "0 22px 58px rgba(0,0,0,0.38)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function QuestionKicker() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", marginBottom: 22 }}>
      <div style={{ color: brandColors.warmWhite, fontFamily: headingFontFamily, fontSize: 28, fontWeight: 700 }}>
        Question
      </div>
      <div
        style={{
          width: 170,
          height: 5,
          borderRadius: 999,
          background: spectrumGradient,
          marginTop: 12,
        }}
      />
    </div>
  );
}

function RatingBadge({
  ratingLabel,
  hasRating,
  size = 150,
  style,
}: {
  ratingLabel: string;
  hasRating: boolean;
  size?: number;
  style?: React.CSSProperties;
}) {
  const ratingFontSize = hasRating ? Math.round(size * 0.42) : Math.round(size * 0.34);
  const scaleFontSize = Math.max(18, Math.round(size * 0.15));

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        background: spectrumGradient,
        padding: 4,
        boxSizing: "border-box",
        boxShadow: "0 18px 44px rgba(0,0,0,0.46)",
        display: "flex",
        ...style,
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 999,
          background: `linear-gradient(145deg, ${brandColors.surfaceHover}, ${brandColors.surface})`,
          border: `1px solid ${brandColors.borderStrong}`,
          color: brandColors.warmWhite,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ fontFamily: headingFontFamily, fontSize: ratingFontSize, fontWeight: 700, lineHeight: 0.86 }}>
          {ratingLabel}
        </div>
        {hasRating ? (
          <div
            style={{
              color: "rgba(245,245,245,0.72)",
              fontFamily: headingFontFamily,
              fontSize: scaleFontSize,
              fontWeight: 700,
              lineHeight: 1.1,
            }}
          >
            /10
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Metric({ label, value, valueFontSize = 38 }: { label: string; value: string; valueFontSize?: number }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "12px 14px",
        border: `1px solid ${brandColors.border}`,
        borderRadius: 8,
        background: brandColors.surfaceNested,
        minWidth: 170,
      }}
    >
      <div style={{ color: brandColors.muted, fontSize: 19, fontWeight: 600 }}>{label}</div>
      <div
        style={{
          color: brandColors.warmWhite,
          fontFamily: headingFontFamily,
          fontSize: valueFontSize,
          fontWeight: 700,
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function getRewardMetricFontSize(value: string): number {
  return value.length > 14 ? 28 : 35;
}

function getTitleFontSize(title: string): number {
  if (title.length <= 42) return 86;
  if (title.length <= 64) return 78;
  if (title.length <= 84) return 68;
  return 60;
}

function RatingShareImage({ shareData }: { shareData: ContentShareData }) {
  const ratingLabel = shareData.rating?.label ?? "N/A";
  const hasRating = shareData.rating !== null;
  const bountyValue = shareData.bountyReward?.amountLabel ?? "When funded";
  const feedbackBonusValue = shareData.feedbackBonusReward?.amountLabel ?? "When funded";

  const rewardMetrics = (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Metric label="Bounties" value={bountyValue} valueFontSize={getRewardMetricFontSize(bountyValue)} />
      <Metric
        label="Feedback bonuses"
        value={feedbackBonusValue}
        valueFontSize={getRewardMetricFontSize(feedbackBonusValue)}
      />
    </div>
  );

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: surfaceGradient,
        color: brandColors.warmWhite,
        padding: 56,
        fontFamily: bodyFontFamily,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <RateLoopMark />
          <div style={{ fontFamily: headingFontFamily, fontSize: 32, fontWeight: 700, letterSpacing: 0 }}>RateLoop</div>
        </div>
        <GradientFrame style={{ borderRadius: 8, padding: 2, boxShadow: "none" }}>
          <div
            style={{
              color: brandColors.warmWhite,
              background: brandColors.surfaceElevated,
              borderRadius: 6,
              padding: "10px 18px",
              fontSize: 24,
              fontWeight: 700,
              boxShadow: "inset 0 1px 0 rgba(245,245,245,0.08)",
            }}
          >
            Disagree? Vote.
          </div>
        </GradientFrame>
      </div>

      <div style={{ display: "flex", flex: 1, gap: 42, alignItems: "center", paddingTop: 28 }}>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
          <QuestionKicker />
          <div
            style={{
              fontFamily: headingFontFamily,
              fontSize: getTitleFontSize(shareData.contentTitle),
              fontWeight: 700,
              lineHeight: 1.03,
              color: brandColors.warmWhite,
              maxWidth: 790,
            }}
          >
            {shareData.contentTitle}
          </div>
        </div>

        {shareData.contentImageUrl ? (
          <GradientFrame style={{ width: 360 }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                width: "100%",
                borderRadius: 7,
                background: brandColors.surfaceElevated,
                color: brandColors.warmWhite,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  display: "flex",
                  position: "relative",
                  width: "100%",
                  height: 188,
                  background: brandColors.surfaceNested,
                }}
              >
                <img
                  src={shareData.contentImageUrl}
                  alt=""
                  width={360}
                  height={188}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                  }}
                />
                <RatingBadge
                  ratingLabel={ratingLabel}
                  hasRating={hasRating}
                  size={136}
                  style={{
                    position: "absolute",
                    right: 18,
                    bottom: 18,
                  }}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 18 }}>{rewardMetrics}</div>
            </div>
          </GradientFrame>
        ) : (
          <GradientFrame style={{ width: 322 }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                width: "100%",
                borderRadius: 7,
                background: brandColors.surfaceElevated,
                color: brandColors.warmWhite,
                padding: 30,
                gap: 24,
              }}
            >
              <RatingBadge ratingLabel={ratingLabel} hasRating={hasRating} size={188} />
              <div
                style={{
                  display: "flex",
                  width: "100%",
                  height: 1,
                  background: "rgba(245,245,245,0.1)",
                }}
              />
              {rewardMetrics}
            </div>
          </GradientFrame>
        )}
      </div>
    </div>
  );
}

function FallbackShareImage() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        background: surfaceGradient,
        color: brandColors.warmWhite,
        padding: 64,
        fontFamily: bodyFontFamily,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 34 }}>
        <RateLoopMark size={52} />
        <div style={{ color: brandColors.warmWhite, fontFamily: headingFontFamily, fontSize: 34, fontWeight: 700 }}>
          RateLoop
        </div>
      </div>
      <div style={{ width: 330, height: 6, borderRadius: 999, background: spectrumGradient, marginBottom: 24 }} />
      <div style={{ fontFamily: headingFontFamily, fontSize: 86, fontWeight: 700, lineHeight: 1.02, maxWidth: 880 }}>
        Human reputation at stake
      </div>
      <div style={{ color: "rgba(245,245,245,0.76)", fontSize: 34, marginTop: 28 }}>
        Rate content, find bounties, and share useful feedback.
      </div>
    </div>
  );
}

function EmergencyFallbackImage() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        background: surfaceGradient,
        color: brandColors.warmWhite,
        padding: 64,
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ fontSize: 86, fontWeight: 700, lineHeight: 1.02, maxWidth: 880 }}>RateLoop</div>
      <div style={{ color: "rgba(245,245,245,0.76)", fontSize: 34, marginTop: 28 }}>Human reputation at stake</div>
    </div>
  );
}

export async function GET(request: NextRequest) {
  const contentParam = request.nextUrl.searchParams.get("content");
  const chainIdParam = request.nextUrl.searchParams.get("chainId");
  const routeLimited = await checkRateLimit(request, ROUTE_RATE_LIMIT, {
    routeKey: ROUTE_RATE_LIMIT_KEY,
  });
  if (routeLimited) return routeLimited;

  const limited = await checkRateLimit(request, RESOURCE_RATE_LIMIT, {
    extraKeyParts: [contentParam, chainIdParam ?? undefined],
    routeKey: RESOURCE_RATE_LIMIT_KEY,
  });
  if (limited) return limited;

  const shareData = await getContentShareDataForParam(contentParam, {
    chainId: chainIdParam,
    origin: request.nextUrl.origin,
  });
  const requestedRatingVersion = request.nextUrl.searchParams.get(VOTE_SHARE_RATING_VERSION_PARAM);
  const hasCurrentRatingVersion = Boolean(shareData && requestedRatingVersion === shareData.ratingVersion);
  const renderShareData = shareData
    ? {
        ...shareData,
        contentImageUrl: await fetchPreviewImageDataUrl(shareData.contentImageUrl),
      }
    : null;

  const image = renderShareData ? <RatingShareImage shareData={renderShareData} /> : <FallbackShareImage />;

  try {
    return new ImageResponse(image, {
      ...imageSize,
      headers: hasCurrentRatingVersion ? versionedResponseHeaders : fallbackResponseHeaders,
    });
  } catch (error) {
    console.error("[og/vote] Failed to render social card", error);
    return new ImageResponse(<EmergencyFallbackImage />, {
      ...imageSize,
      headers: fallbackResponseHeaders,
    });
  }
}

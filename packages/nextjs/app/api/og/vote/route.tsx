import React from "react";
import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { type ContentShareData, VOTE_SHARE_RATING_VERSION_PARAM } from "~~/lib/social/contentShare";
import { getContentShareDataForParam } from "~~/lib/social/contentShare.server";
import { checkRateLimit } from "~~/utils/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const RATE_LIMIT = { limit: 60, windowMs: 60_000 };

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

function Metric({ label, value, valueFontSize = 38 }: { label: string; value: string; valueFontSize?: number }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "16px 18px",
        border: "1px solid #2b332c",
        borderRadius: 8,
        background: "#161a16",
        minWidth: 170,
      }}
    >
      <div style={{ color: "#a7b3a8", fontSize: 22, fontWeight: 600 }}>{label}</div>
      <div style={{ color: "#f7fff5", fontSize: valueFontSize, fontWeight: 800, lineHeight: 1.1 }}>{value}</div>
    </div>
  );
}

function RatingShareImage({ shareData }: { shareData: ContentShareData }) {
  const ratingLabel = shareData.rating?.label ?? "N/A";
  const hasRating = shareData.rating !== null;
  const openRoundLabel =
    shareData.openRoundVoteCount > 0
      ? `${shareData.openRoundVoteCount} hidden vote${shareData.openRoundVoteCount === 1 ? "" : "s"} in the open round`
      : "Open round ready for your vote";

  const ratingMetrics = (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Metric label="Total votes" value={shareData.totalVotes.toLocaleString("en-US")} />
      <Metric label="Open round" value={openRoundLabel} valueFontSize={24} />
    </div>
  );

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#10130f",
        color: "#f7fff5",
        padding: 56,
        fontFamily: "Arial",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <RateLoopMark />
          <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: 0 }}>RateLoop</div>
        </div>
        <div
          style={{
            color: "#10130f",
            background: "#f7fff5",
            borderRadius: 8,
            padding: "10px 18px",
            fontSize: 24,
            fontWeight: 800,
          }}
        >
          Disagree? Vote.
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, gap: 44, alignItems: "center", paddingTop: 46 }}>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
          <div style={{ color: "#50f29a", fontSize: 28, fontWeight: 800, marginBottom: 18 }}>
            {hasRating ? "Current RateLoop rating" : "Community rating pending"}
          </div>
          <div
            style={{
              fontSize: 68,
              fontWeight: 900,
              lineHeight: 1.04,
              color: "#f7fff5",
              marginBottom: 24,
            }}
          >
            {shareData.contentTitle}
          </div>
          <div
            style={{
              display: "flex",
              color: "#cbd7ca",
              fontSize: 28,
              lineHeight: 1.28,
              maxWidth: 700,
            }}
          >
            {shareData.contentDescription || "Stake LREP, vote with conviction, and move the rating."}
          </div>
        </div>

        {shareData.contentImageUrl ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              width: 360,
              borderRadius: 8,
              border: "2px solid #50f29a",
              background: "#f7fff5",
              color: "#10130f",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                position: "relative",
                width: "100%",
                height: 244,
                background: "#161a16",
              }}
            >
              <img
                src={shareData.contentImageUrl}
                alt=""
                width={360}
                height={244}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  right: 18,
                  bottom: 18,
                  width: 150,
                  height: 150,
                  borderRadius: 999,
                  border: "3px solid #50f29a",
                  background: "#f7fff5",
                  color: "#10130f",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 16px 42px rgba(0,0,0,0.34)",
                }}
              >
                <div style={{ fontSize: hasRating ? 64 : 50, fontWeight: 900, lineHeight: 0.86 }}>{ratingLabel}</div>
                {hasRating ? <div style={{ fontSize: 24, fontWeight: 900, lineHeight: 1.1 }}>/10</div> : null}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 22 }}>
              <div style={{ fontSize: 24, fontWeight: 900, color: "#10130f" }}>
                {hasRating ? "Current rating" : "No rating yet"}
              </div>
              {ratingMetrics}
            </div>
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              width: 330,
              borderRadius: 8,
              border: "2px solid #50f29a",
              background: "#f7fff5",
              color: "#10130f",
              padding: 28,
              gap: 20,
            }}
          >
            <div style={{ fontSize: 26, fontWeight: 900, color: "#10130f" }}>
              {hasRating ? "Current rating" : "No rating yet"}
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
              <div style={{ fontSize: hasRating ? 104 : 84, fontWeight: 900, lineHeight: 0.9 }}>{ratingLabel}</div>
              {hasRating ? (
                <div style={{ fontSize: 36, fontWeight: 900, lineHeight: 1.1, paddingBottom: 8 }}>/10</div>
              ) : null}
            </div>
            {ratingMetrics}
          </div>
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
        background: "#10130f",
        color: "#f7fff5",
        padding: 64,
        fontFamily: "Arial",
      }}
    >
      <div style={{ color: "#50f29a", fontSize: 34, fontWeight: 800, marginBottom: 18 }}>RateLoop</div>
      <div style={{ fontSize: 86, fontWeight: 900, lineHeight: 1.02, maxWidth: 880 }}>Human reputation at stake</div>
      <div style={{ color: "#cbd7ca", fontSize: 34, marginTop: 28 }}>Get verified, stake LREP, and rate content.</div>
    </div>
  );
}

export async function GET(request: NextRequest) {
  const contentParam = request.nextUrl.searchParams.get("content");
  const limited = await checkRateLimit(request, RATE_LIMIT, {
    extraKeyParts: [contentParam],
  });
  if (limited) return limited;

  const shareData = await getContentShareDataForParam(contentParam, {
    origin: request.nextUrl.origin,
  });
  const requestedRatingVersion = request.nextUrl.searchParams.get(VOTE_SHARE_RATING_VERSION_PARAM);
  const hasCurrentRatingVersion = Boolean(shareData && requestedRatingVersion === shareData.ratingVersion);

  return new ImageResponse(shareData ? <RatingShareImage shareData={shareData} /> : <FallbackShareImage />, {
    ...imageSize,
    headers: hasCurrentRatingVersion ? versionedResponseHeaders : fallbackResponseHeaders,
  });
}

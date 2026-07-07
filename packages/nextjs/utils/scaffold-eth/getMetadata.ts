import type { Metadata } from "next";
import { resolveOptionalAppUrl } from "~~/lib/env/appUrl";
import { isLocalE2EProductionBuildEnabled } from "~~/utils/env/e2eProduction";

function resolveMetadataBaseUrl() {
  const production = process.env.NODE_ENV === "production";
  const localhostFallback = `http://localhost:${process.env.PORT || 3000}`;
  const resolved = resolveOptionalAppUrl({
    rawAppUrl: process.env.APP_URL,
    rawPublicAppUrl: process.env.NEXT_PUBLIC_APP_URL,
    rawVercelEnv: process.env.VERCEL_ENV,
    rawVercelProjectProductionUrl: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    rawVercelUrl: process.env.VERCEL_URL,
    production,
    allowLocalhostInProduction: isLocalE2EProductionBuildEnabled(),
  });

  if (!resolved) {
    return localhostFallback;
  }

  if (
    !production &&
    resolved === "http://localhost:3000" &&
    !process.env.APP_URL?.trim() &&
    !process.env.NEXT_PUBLIC_APP_URL?.trim()
  ) {
    return localhostFallback;
  }

  return resolved;
}

const titleTemplate = "%s | RateLoop";
const socialImageVersion = "20260707";
const socialImageAlt =
  "RateLoop social image with the RateLoop wordmark, the subtitle Level Up Your Agent, and the orbital loop mark";

export const getMetadata = ({ title, description }: { title: string; description: string }): Metadata => {
  const baseUrl = resolveMetadataBaseUrl();
  const openGraphImageUrl = `${baseUrl}/og-image.jpg?v=${socialImageVersion}`;
  const twitterImageUrl = `${baseUrl}/twitter-image.jpg?v=${socialImageVersion}`;

  return {
    metadataBase: new URL(baseUrl),
    manifest: "/manifest.json",
    title: {
      default: title,
      template: titleTemplate,
    },
    description: description,
    openGraph: {
      title: {
        default: title,
        template: titleTemplate,
      },
      description: description,
      images: [
        {
          url: openGraphImageUrl,
          width: 1200,
          height: 630,
          alt: socialImageAlt,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: {
        default: title,
        template: titleTemplate,
      },
      description: description,
      images: [
        {
          url: twitterImageUrl,
          width: 1200,
          height: 600,
          alt: socialImageAlt,
        },
      ],
    },
    icons: {
      icon: [
        {
          url: "/favicon.png",
          type: "image/png",
          sizes: "512x512",
        },
      ],
      apple: [
        {
          url: "/favicon.png",
          type: "image/png",
          sizes: "512x512",
        },
      ],
    },
  };
};

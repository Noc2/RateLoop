import type { Metadata } from "next";
import { resolveOptionalAppUrl } from "~~/lib/env/appUrl";

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
const socialImageVersion = "20260713a";
const socialImageAlt = "RateLoop orbital loop mark for human assurance in AI-enabled workflows";

export const getMetadata = ({ title, description }: { title: string; description: string }): Metadata => {
  const baseUrl = resolveMetadataBaseUrl();
  const socialImageUrl = `${baseUrl}/favicon.png?v=${socialImageVersion}`;

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
          url: socialImageUrl,
          width: 512,
          height: 512,
          alt: socialImageAlt,
        },
      ],
    },
    twitter: {
      card: "summary",
      title: {
        default: title,
        template: titleTemplate,
      },
      description: description,
      images: [
        {
          url: socialImageUrl,
          width: 512,
          height: 512,
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

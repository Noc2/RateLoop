import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const socialImageAlt = "RateLoop orbital loop mark for human assurance in AI-enabled workflows";

type MetadataSnapshot = {
  description?: string | null;
  icons?: {
    apple?: Array<{ sizes?: string | null; type?: string | null; url?: string | null }> | null;
    icon?: Array<{ sizes?: string | null; type?: string | null; url?: string | null }> | null;
  } | null;
  manifest?: string | null;
  metadataBase?: string | null;
  openGraph?: {
    description?: string | null;
    images?: Array<{ alt?: string | null; url?: string | null }>;
  } | null;
  title?:
    | string
    | {
        default?: string;
        template?: string;
      }
    | null;
  twitter?: {
    images?: Array<{ alt?: string | null; url?: string | null }>;
  } | null;
};

function loadMetadataWithEnv(
  env: {
    APP_URL?: string;
    NODE_ENV?: string;
    NEXT_PUBLIC_APP_URL?: string;
    PORT?: string;
    VERCEL_ENV?: string;
    VERCEL_PROJECT_PRODUCTION_URL?: string;
    VERCEL_URL?: string;
  },
  input: { description: string; title: string },
): MetadataSnapshot {
  const childEnv = { ...process.env };

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete childEnv[key];
    } else {
      childEnv[key] = value;
    }
  }

  const script = `
    const imported = await import(${JSON.stringify(new URL("./getMetadata.ts", import.meta.url).href)});
    const getMetadata =
      imported.getMetadata ??
      imported.default?.getMetadata ??
      imported["module.exports"]?.getMetadata;

    if (typeof getMetadata !== "function") {
      throw new TypeError("getMetadata export was not found");
    }

    const metadata = getMetadata(${JSON.stringify(input)});
    console.log(JSON.stringify({
      metadataBase: metadata.metadataBase?.toString() ?? null,
      manifest: metadata.manifest ?? null,
      title: metadata.title ?? null,
      description: metadata.description ?? null,
      openGraph: metadata.openGraph
        ? {
            description: metadata.openGraph.description ?? null,
            images: metadata.openGraph.images?.map(image => ({
              url: typeof image === "string" ? image : image?.url?.toString() ?? null,
              alt: typeof image === "string" ? null : image?.alt ?? null,
            })),
          }
        : null,
      twitter: metadata.twitter
        ? {
            images: metadata.twitter.images?.map(image =>
              typeof image === "string"
                ? { url: image, alt: null }
                : { url: image?.url?.toString() ?? null, alt: image?.alt ?? null },
            ),
          }
        : null,
      icons: metadata.icons
        ? {
            icon: (() => {
              const entries = metadata.icons?.icon;
              if (!entries) {
                return null;
              }

              const normalizedEntries = Array.isArray(entries) ? entries : [entries];

              return normalizedEntries.map(icon =>
                typeof icon === "string"
                  ? { url: icon, type: null, sizes: null }
                  : {
                      url: icon?.url?.toString() ?? null,
                      type: icon?.type ?? null,
                      sizes: icon?.sizes ?? null,
                    },
              );
            })(),
            apple: (() => {
              const entries = metadata.icons?.apple;
              if (!entries) {
                return null;
              }

              const normalizedEntries = Array.isArray(entries) ? entries : [entries];

              return normalizedEntries.map(icon =>
                typeof icon === "string"
                  ? { url: icon, type: null, sizes: null }
                  : {
                      url: icon?.url?.toString() ?? null,
                      type: icon?.type ?? null,
                      sizes: icon?.sizes ?? null,
                    },
              );
            })(),
          }
        : null,
    }));
  `;

  const tsxLoaderUrl = new URL("../../node_modules/tsx/dist/loader.mjs", import.meta.url);

  const result = spawnSync(process.execPath, ["--import", tsxLoaderUrl.href, "--eval", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: childEnv,
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "Failed to load metadata snapshot");
  }

  return JSON.parse(result.stdout) as MetadataSnapshot;
}

test("getMetadata uses localhost URLs and the updated brand copy when no production hostname is configured", () => {
  const metadata = loadMetadataWithEnv(
    {
      APP_URL: undefined,
      NEXT_PUBLIC_APP_URL: undefined,
      PORT: "4321",
      VERCEL_ENV: undefined,
      VERCEL_PROJECT_PRODUCTION_URL: undefined,
      VERCEL_URL: undefined,
    },
    {
      title: "RateLoop — Human assurance for AI workflows",
      description: "Human assurance for AI-enabled workflows",
    },
  );

  assert.equal(metadata.metadataBase, "http://localhost:4321/");
  assert.equal(metadata.manifest, "/manifest.json");
  assert.deepEqual(metadata.title, {
    default: "RateLoop — Human assurance for AI workflows",
    template: "%s | RateLoop",
  });
  assert.equal(metadata.description, "Human assurance for AI-enabled workflows");
  assert.equal(metadata.openGraph?.description, "Human assurance for AI-enabled workflows");
  assert.equal(metadata.openGraph?.images?.[0]?.url, "http://localhost:4321/favicon.png?v=20260713a");
  assert.equal(metadata.twitter?.images?.[0]?.url, "http://localhost:4321/favicon.png?v=20260713a");
  assert.equal(metadata.openGraph?.images?.[0]?.alt, socialImageAlt);
  assert.equal(metadata.twitter?.images?.[0]?.alt, socialImageAlt);
  assert.equal(metadata.icons?.icon?.[0]?.url, "/favicon.png");
  assert.equal(metadata.icons?.icon?.[0]?.type, "image/png");
  assert.equal(metadata.icons?.icon?.[0]?.sizes, "512x512");
  assert.equal(metadata.icons?.apple?.[0]?.url, "/favicon.png");
  assert.equal(metadata.icons?.apple?.[0]?.type, "image/png");
  assert.equal(metadata.icons?.apple?.[0]?.sizes, "512x512");
});

test("getMetadata prefers the production hostname for social metadata", () => {
  const metadata = loadMetadataWithEnv(
    {
      NODE_ENV: "production",
      PORT: "4321",
      VERCEL_ENV: "production",
      VERCEL_PROJECT_PRODUCTION_URL: "rateloop.app",
      VERCEL_URL: "rateloop-preview.vercel.app",
    },
    {
      title: "RateLoop — Human assurance for AI workflows",
      description: "Human assurance for AI-enabled workflows",
    },
  );

  assert.equal(metadata.metadataBase, "https://rateloop.app/");
  assert.equal(metadata.openGraph?.images?.[0]?.url, "https://rateloop.app/favicon.png?v=20260713a");
  assert.equal(metadata.twitter?.images?.[0]?.url, "https://rateloop.app/favicon.png?v=20260713a");
  assert.deepEqual(metadata.title, {
    default: "RateLoop — Human assurance for AI workflows",
    template: "%s | RateLoop",
  });
});

test("getMetadata uses the preview hostname when production metadata is unavailable", () => {
  const metadata = loadMetadataWithEnv(
    {
      NODE_ENV: "production",
      PORT: "4321",
      VERCEL_ENV: "preview",
      VERCEL_PROJECT_PRODUCTION_URL: undefined,
      VERCEL_URL: "rateloop-preview.vercel.app",
    },
    {
      title: "RateLoop — Human assurance for AI workflows",
      description: "Human assurance for AI-enabled workflows",
    },
  );

  assert.equal(metadata.metadataBase, "https://rateloop-preview.vercel.app/");
  assert.equal(metadata.openGraph?.images?.[0]?.url, "https://rateloop-preview.vercel.app/favicon.png?v=20260713a");
  assert.equal(metadata.twitter?.images?.[0]?.url, "https://rateloop-preview.vercel.app/favicon.png?v=20260713a");
});

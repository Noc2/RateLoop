import { NextRequest } from "next/server";
import { fetchPreviewImageDataUrl } from "./previewImageDataUrl";
import { GET } from "./route";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { __setRateLimitStoreForTests } from "~~/utils/rateLimit";

const originalFetch = globalThis.fetch;
const originalFrontendCode = process.env.NEXT_PUBLIC_FRONTEND_CODE;
const originalPonderUrl = process.env.NEXT_PUBLIC_PONDER_URL;
const onePixelPng = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=", "base64"),
);

function buildContentResponse(overrides: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      content: {
        id: "88",
        url: "https://www.youtube.com/watch?v=qRv7G7WpOoU",
        title: "A disputed piece of content",
        description: "A compact summary for social previews.",
        rating: 50,
        ratingBps: 5_000,
        totalVotes: 1,
        lastActivityAt: "1776160800",
        openRound: null,
        ...overrides,
      },
    }),
    {
      headers: {
        "content-type": "application/json",
      },
    },
  );
}

function mockShareContentFetch(requestedUrls: string[] = []) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" || input instanceof URL ? input.toString() : input.url;
    requestedUrls.push(url);

    if (url === "https://ponder.example/api/content/88") {
      return buildContentResponse();
    }

    if (url === "https://img.youtube.com/vi/qRv7G7WpOoU/hqdefault.jpg") {
      return new Response(onePixelPng, {
        headers: {
          "content-type": "image/png",
        },
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;
}

function createCountingRateLimitStore(): NonNullable<Parameters<typeof __setRateLimitStoreForTests>[0]> {
  const counts = new Map<string, number>();

  return {
    execute: async input => {
      const sql = typeof input === "string" ? input : input.sql;
      const args = typeof input === "string" ? [] : input.args;
      const statement = String(sql);
      if (/DELETE FROM api_rate_limits/u.test(statement)) {
        return { rows: [] } as any;
      }
      if (statement.includes("api_rate_limit_maintenance")) {
        return { rows: [{ name: "cleanup" }] } as any;
      }
      if (statement.includes("api_rate_limits")) {
        const key = String(args?.[0] ?? "");
        const requestCount = (counts.get(key) ?? 0) + 1;
        counts.set(key, requestCount);
        return { rows: [{ request_count: requestCount }] } as any;
      }
      return { rows: [] } as any;
    },
  };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_FRONTEND_CODE = "0x3333333333333333333333333333333333333333";
  process.env.NEXT_PUBLIC_PONDER_URL = "https://ponder.example/api";
  globalThis.fetch = originalFetch;
  __setRateLimitStoreForTests({
    execute: async () =>
      ({
        rows: [{ name: "cleanup", request_count: 1 }],
      }) as any,
  });
});

after(() => {
  globalThis.fetch = originalFetch;
  __setRateLimitStoreForTests(null);

  if (originalFrontendCode === undefined) {
    delete process.env.NEXT_PUBLIC_FRONTEND_CODE;
  } else {
    process.env.NEXT_PUBLIC_FRONTEND_CODE = originalFrontendCode;
  }

  if (originalPonderUrl === undefined) {
    delete process.env.NEXT_PUBLIC_PONDER_URL;
  } else {
    process.env.NEXT_PUBLIC_PONDER_URL = originalPonderUrl;
  }
});

test("caches versioned vote social cards for crawlers", async () => {
  const requestedUrls: string[] = [];
  mockShareContentFetch(requestedUrls);

  const response = await GET(
    new NextRequest("https://www.rateloop.ai/api/og/vote?content=88&rv=og6-r-88-5000-1-0-1776160800-none-none"),
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(response.headers.get("cache-control"), "public, max-age=86400, immutable");
  assert.equal(
    response.headers.get("cdn-cache-control"),
    "public, max-age=86400, stale-while-revalidate=604800, stale-if-error=604800",
  );
  assert.equal(
    response.headers.get("vercel-cdn-cache-control"),
    "public, max-age=86400, stale-while-revalidate=604800, stale-if-error=604800",
  );
  assert.ok((await response.arrayBuffer()).byteLength > 0);
  assert.ok(requestedUrls.includes("https://ponder.example/api/content/88"));
});

test("loads trusted preview images into data URLs for social card rendering", async () => {
  const requestedUrls: string[] = [];
  const dataUrl = await fetchPreviewImageDataUrl("https://img.youtube.com/vi/qRv7G7WpOoU/hqdefault.jpg", (async (
    input: RequestInfo | URL,
  ) => {
    const url = typeof input === "string" || input instanceof URL ? input.toString() : input.url;
    requestedUrls.push(url);

    return new Response(onePixelPng, {
      headers: {
        "content-type": "image/png",
      },
    });
  }) as typeof fetch);

  assert.equal(requestedUrls[0], "https://img.youtube.com/vi/qRv7G7WpOoU/hqdefault.jpg");
  assert.match(dataUrl ?? "", /^data:image\/png;base64,/);
});

test("keeps content vote social cards uncached without the current rating version", async () => {
  for (const url of [
    "https://www.rateloop.ai/api/og/vote?content=88",
    "https://www.rateloop.ai/api/og/vote?content=88&rv=og6-r-88-4900-1-0-1776160800-none-none",
  ]) {
    mockShareContentFetch();

    const response = await GET(new NextRequest(url));

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
    assert.equal(response.headers.get("cdn-cache-control"), null);
    assert.equal(response.headers.get("vercel-cdn-cache-control"), null);
    assert.ok((await response.arrayBuffer()).byteLength > 0);
  }
});

test("keeps fallback vote social cards uncached", async () => {
  const response = await GET(new NextRequest("https://www.rateloop.ai/api/og/vote?content=bad"));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(response.headers.get("cdn-cache-control"), null);
  assert.equal(response.headers.get("vercel-cdn-cache-control"), null);
});

test("redacts gated vote social cards before fetching preview images", async () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "memory:";
  const dbModule = await import("~~/lib/db");
  const dbTestMemory = await import("~~/lib/db/testing/testMemory");
  const confidentiality = await import("~~/lib/confidentiality/context");
  dbModule.__setDatabaseResourcesForTests(dbTestMemory.createMemoryDatabaseResources());

  const requestedUrls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" || input instanceof URL ? input.toString() : input.url;
    requestedUrls.push(url);

    if (url === "https://ponder.example/api/content/88") {
      return buildContentResponse({
        title: "Secret launch concept",
        description: "Confidential concept details.",
        imageUrl: "https://img.youtube.com/vi/qRv7G7WpOoU/hqdefault.jpg",
        url: "https://www.youtube.com/watch?v=qRv7G7WpOoU",
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    await confidentiality.upsertQuestionConfidentialityFromMetadata({
      contentId: "88",
      metadata: {
        confidentiality: {
          disclosurePolicy: "after_settlement",
          visibility: "gated",
        },
      },
    });

    const response = await GET(new NextRequest("https://www.rateloop.ai/api/og/vote?content=88"));

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.deepEqual(requestedUrls, ["https://ponder.example/api/content/88"]);
    assert.ok((await response.arrayBuffer()).byteLength > 0);
  } finally {
    globalThis.fetch = originalFetch;
    dbModule.__setDatabaseResourcesForTests(null);
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  }
});

test("rate-limits vote social cards before fetching share data", async () => {
  let fetched = false;
  __setRateLimitStoreForTests({
    execute: async () =>
      ({
        rows: [{ name: "cleanup", request_count: 61 }],
      }) as any,
  });
  globalThis.fetch = (async () => {
    fetched = true;
    throw new Error("fetch should not be called");
  }) as typeof fetch;

  const response = await GET(new NextRequest("https://www.rateloop.ai/api/og/vote?content=88"));

  assert.equal(response.status, 429);
  assert.equal(fetched, false);
});

test("rate-limits vote social cards across varying content params before fetching share data", async t => {
  let fetchCount = 0;
  t.mock.method(Date, "now", () => Date.UTC(2026, 5, 27, 12, 0, 0));
  __setRateLimitStoreForTests(createCountingRateLimitStore());
  globalThis.fetch = (async () => {
    fetchCount++;
    return new Response(null, { status: 404 });
  }) as typeof fetch;

  let response: Response | null = null;
  for (let index = 1; index <= 181; index++) {
    response = await GET(new NextRequest(`https://www.rateloop.ai/api/og/vote?content=${index}&chainId=31337`));
    if (index <= 180) {
      assert.equal(response.status, 200);
    }
  }

  assert.equal(response?.status, 429);
  assert.equal(fetchCount, 180);
});

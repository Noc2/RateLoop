import { NextRequest } from "next/server";
import { POST } from "./route";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { __setRateLimitStoreForTests } from "~~/utils/rateLimit";
import { __setUrlSafetyDnsResolversForTests } from "~~/utils/urlSafety";

const env = process.env as Record<string, string | undefined>;
const originalNodeEnv = env.NODE_ENV;

function makeRequest(urls: unknown[]) {
  return new NextRequest("https://rateloop.ai/api/thumbnails", {
    method: "POST",
    body: JSON.stringify({ urls }),
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "198.51.100.25",
    },
  });
}

beforeEach(() => {
  env.NODE_ENV = "development";
  __setRateLimitStoreForTests({
    execute: async (input: any) => {
      const sql = typeof input === "string" ? input : input.sql;
      if (String(sql).includes("api_rate_limits")) {
        return { rows: [{ request_count: 1 }] } as any;
      }
      return { rows: [] } as any;
    },
  });
  __setUrlSafetyDnsResolversForTests({
    resolve4: async () => ["93.184.216.34"],
    resolve6: async () => [],
  });
});

after(() => {
  __setRateLimitStoreForTests(null);
  __setUrlSafetyDnsResolversForTests(null);
  if (originalNodeEnv === undefined) {
    delete env.NODE_ENV;
  } else {
    env.NODE_ENV = originalNodeEnv;
  }
});

test("thumbnail route resolves a bounded unique URL batch", async () => {
  const response = await POST(
    makeRequest(["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"]),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(body.items), ["https://www.youtube.com/watch?v=dQw4w9WgXcQ"]);
  assert.match(
    body.items["https://www.youtube.com/watch?v=dQw4w9WgXcQ"].thumbnailUrl,
    /^https:\/\/img\.youtube\.com\/vi\/dQw4w9WgXcQ\//,
  );
});

test("thumbnail route rejects oversized URL batches instead of truncating", async () => {
  const response = await POST(
    makeRequest(Array.from({ length: 21 }, (_, index) => `https://example${index}.com/page`)),
  );
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error, "At most 20 URLs are allowed per request");
});

test("thumbnail route rejects too many URLs from one host", async () => {
  const response = await POST(
    makeRequest(Array.from({ length: 6 }, (_, index) => `https://example.com/page-${index}`)),
  );
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error, "At most 5 URLs are allowed per host");
});

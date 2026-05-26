import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { ponderApi } from "~~/services/ponder/client";

const TEST_ADDRESS = "0x63cada40e8acf7a1d47229af5be35b78b16035fa";
const originalGetFollows = ponderApi.getFollows;

type RateLimitModule = typeof import("~~/utils/rateLimit");
type RouteModule = typeof import("./route");

let rateLimit: RateLimitModule;
let route: RouteModule;

function makeRequest(
  pathname: string,
  init?: {
    body?: BodyInit | null;
    headers?: HeadersInit;
    method?: string;
  },
): NextRequest {
  const headers = new Headers(init?.headers);
  headers.set("x-forwarded-for", "203.0.113.77");

  return new NextRequest(`https://rateloop.xyz${pathname}`, {
    ...init,
    headers,
  });
}

before(async () => {
  rateLimit = await import("~~/utils/rateLimit");
  route = await import("./route");
});

beforeEach(() => {
  rateLimit.__setRateLimitStoreForTests({
    execute: async () =>
      ({
        rows: [{ name: "cleanup", request_count: 1 }],
      }) as any,
  });
  ponderApi.getFollows = originalGetFollows;
});

after(() => {
  rateLimit.__setRateLimitStoreForTests(null);
  ponderApi.getFollows = originalGetFollows;
});

test("public follow reads validate addresses before calling Ponder", async () => {
  const response = await route.GET(makeRequest("/api/follows/profiles?address=not-an-address"));

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Valid address is required",
  });
});

test("public follow reads proxy normalized addresses to Ponder", async () => {
  let requestedAddress: string | null = null;
  let requestedParams: { limit?: string; offset?: string } | undefined;
  ponderApi.getFollows = async (address, params) => {
    requestedAddress = address;
    requestedParams = params;
    return {
      items: [],
      count: 0,
      followerCount: 1,
      followingCount: 2,
      limit: 25,
      offset: 5,
    };
  };

  const response = await route.GET(makeRequest(`/api/follows/profiles?address=${TEST_ADDRESS}&limit=25&offset=5`));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    items: [],
    count: 0,
    followerCount: 1,
    followingCount: 2,
    limit: 25,
    offset: 5,
  });
  assert.equal(requestedAddress, TEST_ADDRESS);
  assert.deepEqual(requestedParams, { limit: "25", offset: "5" });
});

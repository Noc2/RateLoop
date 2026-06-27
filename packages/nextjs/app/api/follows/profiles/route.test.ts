import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { resolveProtocolDeploymentScope } from "~~/lib/protocolDeployment";
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

  return new NextRequest(`https://rateloop.ai${pathname}`, {
    ...init,
    headers,
  });
}

function createCountingRateLimitStore() {
  const counts = new Map<string, number>();

  return {
    execute: async ({ sql, args }: { sql: unknown; args?: unknown[] }) => {
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

function validAddress(index: number) {
  return `0x${index.toString(16).padStart(40, "0")}`;
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
  let requestedOptions: { chainId?: number | null; deploymentKey?: string | null } | undefined;
  ponderApi.getFollows = async (address, params, options) => {
    requestedAddress = address;
    requestedParams = params;
    requestedOptions = options;
    return {
      items: [],
      count: 0,
      followerCount: 1,
      followingCount: 2,
      limit: 25,
      offset: 5,
    };
  };

  const response = await route.GET(
    makeRequest(`/api/follows/profiles?address=${TEST_ADDRESS}&chainId=31337&limit=25&offset=5`),
  );

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
  assert.deepEqual(requestedOptions, {
    chainId: 31337,
    deploymentKey: resolveProtocolDeploymentScope(31337)?.deploymentKey,
  });
});

test("public follow route-wide rate limit is shared across address params", async () => {
  rateLimit.__setRateLimitStoreForTests(createCountingRateLimitStore());
  ponderApi.getFollows = async () => ({
    items: [],
    count: 0,
    followerCount: 0,
    followingCount: 0,
    limit: 200,
    offset: 0,
  });

  let response: Response | null = null;
  for (let index = 1; index <= 181; index++) {
    response = await route.GET(makeRequest(`/api/follows/profiles?address=${validAddress(index)}&chainId=31337`));
    if (index <= 180) {
      assert.equal(response.status, 200);
    }
  }

  assert.equal(response?.status, 429);
});

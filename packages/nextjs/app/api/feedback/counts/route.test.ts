import { NextRequest } from "next/server";
import { GET } from "./route";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { __setRateLimitStoreForTests } from "~~/utils/rateLimit";

function makeRequest(pathname: string): NextRequest {
  return new NextRequest(`https://rateloop.ai${pathname}`);
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

beforeEach(() => {
  __setRateLimitStoreForTests(createCountingRateLimitStore());
});

after(() => {
  __setRateLimitStoreForTests(null);
});

test("feedback counts route-wide rate limit is shared across chain params", async () => {
  let response: Response | null = null;
  for (let index = 1; index <= 181; index++) {
    response = await GET(makeRequest(`/api/feedback/counts?chainId=${index}`));
    if (index <= 180) {
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { counts: {} });
    }
  }

  assert.equal(response?.status, 429);
});

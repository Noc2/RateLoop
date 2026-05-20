import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { __setRateLimitStoreForTests } from "~~/utils/rateLimit";

type ChallengeRouteModule = typeof import("./challenge/route");
type PoliciesRouteModule = typeof import("./route");
type StatusRouteModule = typeof import("./status/route");
type TokenRouteModule = typeof import("./token/route");

let challengeRoute: ChallengeRouteModule;
let policiesRoute: PoliciesRouteModule;
let statusRoute: StatusRouteModule;
let tokenRoute: TokenRouteModule;

function makeMalformedRequest(path: string, method = "POST") {
  return new NextRequest(`https://rateloop.example${path}`, {
    body: "{",
    headers: new Headers({ "content-type": "application/json" }),
    method,
  });
}

async function expectInvalidJson(response: Response) {
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Invalid JSON body" });
}

before(async () => {
  __setRateLimitStoreForTests({
    execute: async input => {
      const sql = typeof input === "string" ? input : input.sql;
      if (sql.includes("api_rate_limits")) {
        return { rows: [{ request_count: 1 }] } as never;
      }
      return { rows: [] } as never;
    },
  });

  challengeRoute = await import("./challenge/route");
  policiesRoute = await import("./route");
  statusRoute = await import("./status/route");
  tokenRoute = await import("./token/route");
});

after(() => {
  __setRateLimitStoreForTests(null);
});

test("agent policy mutation routes reject malformed JSON with 400 responses", async () => {
  await expectInvalidJson(await challengeRoute.POST(makeMalformedRequest("/api/agent/policies/challenge")));
  await expectInvalidJson(await policiesRoute.POST(makeMalformedRequest("/api/agent/policies")));
  await expectInvalidJson(await policiesRoute.PUT(makeMalformedRequest("/api/agent/policies", "PUT")));
  await expectInvalidJson(await statusRoute.POST(makeMalformedRequest("/api/agent/policies/status")));
  await expectInvalidJson(await tokenRoute.POST(makeMalformedRequest("/api/agent/policies/token")));
  await expectInvalidJson(await tokenRoute.DELETE(makeMalformedRequest("/api/agent/policies/token", "DELETE")));
});

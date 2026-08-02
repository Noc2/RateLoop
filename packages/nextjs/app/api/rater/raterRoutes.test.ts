import { NextRequest } from "next/server";
import { POST as createWorldIdContext } from "./assurance/world-id/context/route";
import { GET as getWorldIdStatus } from "./assurance/world-id/status/route";
import { POST as verifyWorldId } from "./assurance/world-id/verify/route";
import { GET as getCommit } from "./commits/[commitId]/route";
import { POST as createCommit } from "./commits/route";
import { POST as providerCallback } from "./eligibility/provider/callback/route";
import { POST as startProvider } from "./eligibility/provider/start/route";
import { POST as createEligibility, GET as getEligibility } from "./eligibility/route";
import { GET as listFeedbackBonusEntitlements } from "./feedback-bonus-entitlements/route";
import { GET as listTasks } from "./tasks/route";
import { POST as createVoucher } from "./vouchers/route";
import assert from "node:assert/strict";
import test from "node:test";

const ORIGIN = "https://tokenless.example.test";
const commitContext = { params: Promise.resolve({ commitId: "commit_route_test" }) };

function request(path: string, method = "GET", body = "{}") {
  return new NextRequest(`${ORIGIN}${path}`, {
    method,
    ...(method === "GET" ? {} : { body, headers: { "content-type": "application/json" } }),
  });
}

test("every rater handler imports and enforces its route-level authentication or callback contract", async () => {
  const authenticatedHandlers = await Promise.all([
    createWorldIdContext(request("/api/rater/assurance/world-id/context", "POST")),
    getWorldIdStatus(request("/api/rater/assurance/world-id/status")),
    verifyWorldId(request("/api/rater/assurance/world-id/verify", "POST")),
    getCommit(request("/api/rater/commits/commit_route_test"), commitContext),
    createCommit(request("/api/rater/commits", "POST")),
    startProvider(request("/api/rater/eligibility/provider/start", "POST")),
    getEligibility(request("/api/rater/eligibility")),
    createEligibility(request("/api/rater/eligibility", "POST")),
    listFeedbackBonusEntitlements(request("/api/rater/feedback-bonus-entitlements")),
    listTasks(request("/api/rater/tasks")),
    createVoucher(request("/api/rater/vouchers", "POST")),
  ]);
  assert.deepEqual(
    authenticatedHandlers.map(response => response.status),
    [403, 401, 403, 401, 403, 403, 401, 403, 401, 401, 403],
  );
  const callback = await providerCallback(request("/api/rater/eligibility/provider/callback", "POST"));
  assert.equal(callback.status, 400);
  assert.equal((await callback.json()).code, "invalid_provider_result");
  for (const response of [...authenticatedHandlers, callback]) {
    const cacheControl = response.headers.get("cache-control");
    assert.ok(cacheControl, "each rater response must explicitly set Cache-Control");
    assert.match(cacheControl, /no-store/u);
  }
  assert.equal(authenticatedHandlers[3]?.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(authenticatedHandlers[4]?.headers.get("cache-control"), "private, no-store, max-age=0");
});

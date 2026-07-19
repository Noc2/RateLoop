import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { POST } from "~~/app/api/agent/v1/quote/route";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { freezeAdmissionPolicy } from "~~/lib/tokenless/admissionPolicy";

const originalRateLimitSecret = process.env.TOKENLESS_MCP_RATE_LIMIT_SECRET;

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  process.env.TOKENLESS_MCP_RATE_LIMIT_SECRET = "quote-route-rate-limit-secret-with-at-least-32-characters";
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
  if (originalRateLimitSecret === undefined) delete process.env.TOKENLESS_MCP_RATE_LIMIT_SECRET;
  else process.env.TOKENLESS_MCP_RATE_LIMIT_SECRET = originalRateLimitSecret;
});

function audiencePolicy() {
  return {
    schemaVersion: "rateloop.human-assurance.v2" as const,
    policyId: "policy_route_invited",
    version: 1,
    reviewerSource: "customer_invited" as const,
    compensation: "paid" as const,
    cohorts: [{ cohortId: "route-invited", minimumReviewers: 3, maximumReviewers: 500 }],
    selection: "customer_named" as const,
    fallbacks: { allowed: false, sources: [] },
    requiredQualifications: [],
    assurance: {
      requirements: [
        {
          capability: "customer_invitation" as const,
          reviewerSources: ["customer_invited" as const],
          allowedProviders: ["workspace-invitation"],
        },
      ],
    },
    buyerPrivacy: { visibleFields: ["reviewer_source" as const], minimumAggregationSize: 3, suppressSmallCells: true },
    legalEligibilityRequired: true,
  };
}

function quoteRequest(visibility: "private" | "public") {
  const policy = audiencePolicy();
  return {
    audience: { admissionPolicyHash: freezeAdmissionPolicy(policy).admissionPolicyHash, source: "customer_invited" },
    audiencePolicy: policy,
    budget: { attemptReserveAtomic: "5000000", bountyAtomic: "25000000", feeBps: 750 },
    ...(visibility === "public" ? { confirmedNoSensitiveData: true, dataClassification: "public" as const } : {}),
    question: { kind: "binary", prompt: "Ship this?", rationale: { mode: "optional" } },
    requestedPanelSize: 15,
    responseWindowSeconds: 3_600,
    visibility,
  };
}

function request(body: unknown, headers: HeadersInit = {}) {
  return new NextRequest("https://rateloop-tokenless.vercel.app/api/agent/v1/quote", {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "x-vercel-forwarded-for": "203.0.113.42",
      ...headers,
    },
    method: "POST",
  });
}

test("quote route permits safe public quotes but rejects external private content before authentication", async () => {
  const privateResponse = await POST(request(quoteRequest("private")));
  assert.equal(privateResponse.status, 409);
  assert.equal((await privateResponse.json()).code, "private_quote_internal_only");

  const publicResponse = await POST(request(quoteRequest("public")));
  assert.equal(publicResponse.status, 200);
  assert.equal(publicResponse.headers.get("cache-control"), "no-store");
  const publicQuoteId = String((await publicResponse.json()).quoteId);
  assert.match(publicQuoteId, /^qte_[0-9a-f]{32}$/);

  const quotes = await dbClient.execute(
    "SELECT quote_id, request_hash, owner_principal_id, owner_workspace_id, owner_api_key_id FROM tokenless_agent_quotes",
  );
  assert.equal(quotes.rows.length, 1);
  assert.equal(quotes.rows[0]?.quote_id, publicQuoteId);
  assert.notEqual(publicQuoteId, `qte_${String(quotes.rows[0]?.request_hash).slice(0, 32)}`);
  assert.equal(quotes.rows[0]?.owner_principal_id, null);
  assert.equal(quotes.rows[0]?.owner_workspace_id, null);
  assert.equal(quotes.rows[0]?.owner_api_key_id, null);
});

test("authenticated external callers cannot manufacture internal-looking private quotes", async () => {
  const response = await POST(request(quoteRequest("private"), { authorization: "Bearer rlk_fake" }));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "private_quote_internal_only");
  const stored = await dbClient.execute("SELECT COUNT(*) AS count FROM tokenless_agent_quotes");
  assert.equal(Number(stored.rows[0]?.count), 0);
});

test("quote route rejects oversized bodies before parsing or persistence", async () => {
  const response = await POST(
    request(quoteRequest("public"), {
      "content-length": String(64 * 1024 + 1),
    }),
  );
  assert.equal(response.status, 413);
  assert.equal((await response.json()).code, "request_too_large");
  const quotes = await dbClient.execute("SELECT COUNT(*) AS count FROM tokenless_agent_quotes");
  assert.equal(Number(quotes.rows[0]?.count), 0);
});

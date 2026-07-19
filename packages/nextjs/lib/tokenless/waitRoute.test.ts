import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { GET } from "~~/app/api/agent/v1/asks/[operationKey]/wait/route";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { freezeAdmissionPolicy } from "~~/lib/tokenless/admissionPolicy";
import {
  attachProductAsk,
  createWorkspace,
  createWorkspaceApiKey,
  prepareProductAsk,
  recordPrepaidLedgerEntry,
} from "~~/lib/tokenless/productCore";
import { createTokenlessAsk, createTokenlessQuote } from "~~/lib/tokenless/server";

const OWNER = "0x1111111111111111111111111111111111111111";

function audiencePolicy() {
  return {
    schemaVersion: "rateloop.human-assurance.v2" as const,
    policyId: "policy_wait_route_test",
    version: 1,
    reviewerSource: "customer_invited" as const,
    compensation: "paid" as const,
    cohorts: [{ cohortId: "wait-test", minimumReviewers: 3, maximumReviewers: 500 }],
    selection: "customer_named" as const,
    fallbacks: { allowed: false, sources: [] },
    requiredQualifications: [],
    assurance: { requirements: [] },
    buyerPrivacy: { visibleFields: [], minimumAggregationSize: 3, suppressSmallCells: true },
    legalEligibilityRequired: true,
  };
}

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
});

async function pendingAsk() {
  const { workspaceId } = await createWorkspace({ name: "Wait route", ownerAddress: OWNER });
  const now = new Date();
  await dbClient.execute({
    sql: `UPDATE tokenless_workspace_subscriptions
          SET plan_key = 'early_access', price_version = 'early_access_usd_99_2026_07',
              provider_status = 'active', current_period_start = ?, current_period_end = ?, updated_at = ?
          WHERE workspace_id = ?`,
    args: [new Date(now.getTime() - 60_000), new Date(now.getTime() + 86_400_000), now, workspaceId],
  });
  const { apiKeyId, token } = await createWorkspaceApiKey({ workspaceId, name: "Wait route key" });
  await recordPrepaidLedgerEntry({ workspaceId, amountAtomic: "100000000", source: "invoice" });
  const policy = audiencePolicy();
  const quote = await createTokenlessQuote({
    audience: {
      admissionPolicyHash: freezeAdmissionPolicy(policy).admissionPolicyHash,
      source: "customer_invited",
    },
    audiencePolicy: policy,
    confirmedNoSensitiveData: true,
    dataClassification: "synthetic",
    budget: { attemptReserveAtomic: "5000000", bountyAtomic: "25000000", feeBps: 750 },
    question: { kind: "binary", prompt: "Ship this?", rationale: { mode: "optional" } },
    requestedPanelSize: 15,
    responseWindowSeconds: 1_200,
    visibility: "public",
  });
  const askRequest = {
    idempotencyKey: "wait:route:12345678",
    payment: { mode: "prepaid" as const, workspaceId },
    quoteId: quote.quoteId,
  };
  const prepared = await prepareProductAsk({
    principal: { apiKeyId, kind: "api_key", role: "member", workspaceId },
    request: askRequest,
  });
  const ask = await createTokenlessAsk(askRequest, askRequest.idempotencyKey, "https://tokenless.example");
  await attachProductAsk(prepared, ask);
  return { ask, token };
}

function request(input: { cursor?: string; operationKey: string; timeoutMs: number; token: string }) {
  const search = new URLSearchParams({ timeoutMs: String(input.timeoutMs) });
  if (input.cursor !== undefined) search.set("cursor", input.cursor);
  return new NextRequest(
    `https://tokenless.example/api/agent/v1/asks/${input.operationKey}/wait?${search.toString()}`,
    { headers: { authorization: `Bearer ${input.token}` } },
  );
}

test("wait route forwards a stale cursor and does not execute payment work from GET", async () => {
  const { ask, token } = await pendingAsk();
  const startedAt = Date.now();
  const response = await GET(request({ cursor: "0", operationKey: ask.operationKey, timeoutMs: 60_000, token }), {
    params: Promise.resolve({ operationKey: ask.operationKey }),
  });

  assert.equal(response.status, 200);
  assert.ok(Date.now() - startedAt < 500);
  assert.equal((await response.json()).status, "pending");
});

test("wait route forwards the bounded timeout and rejects malformed cursors", async () => {
  const { ask, token } = await pendingAsk();
  const startedAt = Date.now();
  const response = await GET(request({ operationKey: ask.operationKey, timeoutMs: 1_000, token }), {
    params: Promise.resolve({ operationKey: ask.operationKey }),
  });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(response.status, 200);
  assert.ok(elapsedMs >= 800);
  assert.ok(elapsedMs < 2_500);

  const malformed = await GET(
    request({ cursor: "not-a-cursor", operationKey: ask.operationKey, timeoutMs: 1_000, token }),
    { params: Promise.resolve({ operationKey: ask.operationKey }) },
  );
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).code, "invalid_wait_cursor");
});

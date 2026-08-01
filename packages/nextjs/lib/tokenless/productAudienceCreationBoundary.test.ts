import type { HumanAssuranceAudiencePolicy } from "@rateloop/sdk";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { type DatabaseResources, __setDatabaseResourcesForTests } from "~~/lib/db";
import { tokenlessAgentAsks, tokenlessAgentQuotes } from "~~/lib/db/schema";
import { freezeAdmissionPolicy } from "~~/lib/tokenless/admissionPolicy";
import {
  type ProductAudienceCreationBoundary,
  evaluateProductAudienceCreation,
} from "~~/lib/tokenless/productAudienceCreationBoundary";
import { prepareProductAsk } from "~~/lib/tokenless/productCore";
import {
  TokenlessServiceError,
  createOpportunityBoundNetworkQuote,
  createTokenlessAsk,
  createTokenlessQuote,
} from "~~/lib/tokenless/server";

const OPPORTUNITY_ID = "opportunity_exact_network_boundary";

afterEach(() => __setDatabaseResourcesForTests(null));

function policy(reviewerSource: "customer_invited" | "rateloop_network" | "hybrid"): HumanAssuranceAudiencePolicy {
  const network = reviewerSource !== "customer_invited";
  return {
    schemaVersion: "rateloop.human-assurance.v2",
    policyId: `policy_${reviewerSource}`,
    version: 1,
    reviewerSource,
    ...(network
      ? {
          integrity: {
            schemaVersion: "rateloop.integrity-assignment.v1",
            epochId: "integrity:2026-08-01:boundary",
            epochManifestHash: `sha256:${"a".repeat(64)}`,
            maxClusterShareBps: 10_000,
            allowedRiskBands: ["low" as const],
            recentCoassignmentWindowSeconds: 86_400,
            maxRecentCoassignments: 0,
            maxPerCustomer: 1,
            onePerProviderSubject: true,
          },
        }
      : {}),
    compensation: "paid",
    cohorts:
      reviewerSource === "hybrid"
        ? [
            { cohortId: "invited_boundary", minimumReviewers: 3, maximumReviewers: 3 },
            { cohortId: "network_boundary", minimumReviewers: 3, maximumReviewers: 3 },
          ]
        : [{ cohortId: `${reviewerSource}_boundary`, minimumReviewers: 3, maximumReviewers: 3 }],
    selection: reviewerSource === "customer_invited" ? "customer_named" : "randomized",
    fallbacks: { allowed: false, sources: [] },
    requiredQualifications: [],
    assurance: {
      requirements: [
        ...(reviewerSource !== "rateloop_network"
          ? [
              {
                capability: "customer_invitation" as const,
                reviewerSources: ["customer_invited" as const],
                allowedProviders: ["workspace-invitation"],
              },
            ]
          : []),
        ...(reviewerSource !== "customer_invited"
          ? [
              {
                capability: "unique_human" as const,
                reviewerSources: ["rateloop_network" as const],
                allowedProviders: ["world:poh"],
              },
            ]
          : []),
      ],
    },
    buyerPrivacy: { visibleFields: ["reviewer_source"], minimumAggregationSize: 3, suppressSmallCells: true },
    legalEligibilityRequired: true,
  };
}

function quoteRequest(reviewerSource: "customer_invited" | "rateloop_network" | "hybrid") {
  const audiencePolicy = policy(reviewerSource);
  return {
    audience: {
      admissionPolicyHash: freezeAdmissionPolicy(audiencePolicy).admissionPolicyHash,
      source: reviewerSource,
    },
    audiencePolicy,
    budget: { attemptReserveAtomic: "3000000", bountyAtomic: "9000000", feeBps: 500 },
    confirmedNoSensitiveData: true,
    dataClassification: "synthetic" as const,
    question: {
      kind: "binary" as const,
      prompt: "Does this satisfy the exact criterion?",
      rationale: { mode: "off" as const },
    },
    requestedPanelSize: 3,
    responseWindowSeconds: 3_600,
    visibility: "public" as const,
  };
}

function decision(
  audienceSource: unknown,
  policyReviewerSource: unknown,
  boundary: ProductAudienceCreationBoundary = { kind: "generic_product" },
) {
  return evaluateProductAudienceCreation({ audienceSource, policyReviewerSource, boundary });
}

function negativeStorageMock() {
  let quote: Record<string, unknown> | null = null;
  const calls = { askInserts: 0, poolConnections: 0, quoteInserts: 0, unexpectedClientCalls: 0 };
  const database = {
    insert(table: unknown) {
      return {
        async values(row: Record<string, unknown>) {
          if (table === tokenlessAgentQuotes) {
            calls.quoteInserts += 1;
            quote = row;
            return;
          }
          if (table === tokenlessAgentAsks) {
            calls.askInserts += 1;
            return;
          }
          throw new Error("Unexpected database insert.");
        },
      };
    },
    select() {
      return {
        from(table: unknown) {
          return {
            where() {
              return {
                async limit() {
                  if (table === tokenlessAgentAsks) return [];
                  if (table === tokenlessAgentQuotes) return quote ? [quote] : [];
                  throw new Error("Unexpected database read.");
                },
              };
            },
          };
        },
      };
    },
  };
  const client = {
    async execute(input: string | { sql: string }) {
      const sql = typeof input === "string" ? input : input.sql;
      if (sql.includes("FROM tokenless_agent_quotes") && quote) {
        return {
          rows: [
            {
              request_json: quote.requestJson,
              response_json: quote.responseJson,
              owner_principal_id: quote.ownerPrincipalId,
              owner_workspace_id: quote.ownerWorkspaceId,
              owner_api_key_id: quote.ownerApiKeyId,
              expires_at: quote.expiresAt,
            },
          ],
          rowCount: 1,
        };
      }
      calls.unexpectedClientCalls += 1;
      throw new Error(`Unexpected product storage call: ${sql}`);
    },
  };
  const pool = {
    async connect() {
      calls.poolConnections += 1;
      throw new Error("A product mutation transaction was opened.");
    },
  };
  __setDatabaseResourcesForTests({ database, client, pool } as unknown as DatabaseResources);
  return { calls };
}

test("quote and request-profile audience aliases resolve to one shared fail-closed family", () => {
  assert.deepEqual(decision("customer_invited", "private_invited"), { allowed: true, family: "invited" });
  for (const aliases of [
    ["rateloop_network", "public_network"],
    ["public_paid_network", "rateloop_network"],
    ["hybrid", "hybrid_public_safe"],
  ] as const) {
    const result = decision(aliases[0], aliases[1]);
    assert.equal(result.allowed, false);
    if (!result.allowed) assert.equal(result.code, "network_opportunity_adapter_required");
  }
  for (const aliases of [
    ["customer_invited", "rateloop_network"],
    ["rateloop_network", "hybrid"],
    ["customer_invited", "unknown"],
    [" rateloop_network", "rateloop_network"],
  ] as const) {
    const result = decision(aliases[0], aliases[1]);
    assert.equal(result.allowed, false);
    if (!result.allowed) assert.equal(result.code, "network_opportunity_boundary_invalid");
  }
  assert.deepEqual(
    decision("rateloop_network", "public_network", {
      kind: "opportunity_bound_network",
      opportunityId: OPPORTUNITY_ID,
    }),
    { allowed: true, family: "network" },
  );
  assert.equal(
    decision("hybrid", "hybrid", { kind: "opportunity_bound_network", opportunityId: OPPORTUNITY_ID }).allowed,
    false,
  );
  assert.equal(
    decision("rateloop_network", "rateloop_network", {
      kind: "opportunity_bound_network",
      opportunityId: "invalid opportunity",
    }).allowed,
    false,
  );
});

test("generic quote creation rejects network, hybrid, and hidden-network policies before storage", async () => {
  const storage = negativeStorageMock();
  for (const reviewerSource of ["rateloop_network", "hybrid"] as const) {
    await assert.rejects(
      () => createTokenlessQuote(quoteRequest(reviewerSource)),
      (error: unknown) =>
        error instanceof TokenlessServiceError && error.code === "network_opportunity_adapter_required",
    );
  }
  const hiddenNetwork = quoteRequest("rateloop_network");
  hiddenNetwork.audience.source = "customer_invited";
  await assert.rejects(
    () => createTokenlessQuote(hiddenNetwork),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "network_opportunity_boundary_invalid",
  );
  assert.deepEqual(storage.calls, {
    askInserts: 0,
    poolConnections: 0,
    quoteInserts: 0,
    unexpectedClientCalls: 0,
  });
});

test("generic ask consumers reject an existing network quote before every payment or ask mutation", async () => {
  const storage = negativeStorageMock();
  const workspaceId = "workspace_network_boundary";
  const quote = await createOpportunityBoundNetworkQuote(quoteRequest("rateloop_network"), OPPORTUNITY_ID);
  const request = {
    idempotencyKey: "network:bypass:negative:12345678",
    payment: { mode: "prepaid" as const, workspaceId },
    quoteId: quote.quoteId,
  };
  const principal = { kind: "api_key" as const, apiKeyId: "key_network_boundary", workspaceId, role: "owner" as const };

  await assert.rejects(
    () => prepareProductAsk({ principal, request }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "network_opportunity_adapter_required",
  );
  await assert.rejects(
    () => createTokenlessAsk(request, request.idempotencyKey, "https://tokenless.example", `workspace:${workspaceId}`),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "network_opportunity_adapter_required",
  );

  assert.deepEqual(storage.calls, {
    askInserts: 0,
    poolConnections: 0,
    quoteInserts: 1,
    unexpectedClientCalls: 0,
  });
});

import { describe, expect, it, vi } from "vitest";
import type { TokenlessRateLoopClient } from "@rateloop/sdk";
import { sha256, stringToHex } from "viem";
import {
  createTokenlessAgentsClient,
  waitUntilTokenlessReady,
} from "../tokenless";

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const audiencePolicy = {
  schemaVersion: "rateloop.human-assurance.v2" as const,
  policyId: "aud_test_customer_invited",
  version: 1,
  reviewerSource: "customer_invited" as const,
  compensation: "paid" as const,
  cohorts: [
    {
      cohortId: "customer_named",
      minimumReviewers: 3,
      maximumReviewers: 500,
    },
  ],
  selection: "customer_named" as const,
  fallbacks: { allowed: false, sources: [] },
  requiredQualifications: [],
  assurance: {
    requirements: [
      {
        capability: "account_control" as const,
        reviewerSources: ["customer_invited" as const],
        allowedProviders: [],
      },
    ],
  },
  buyerPrivacy: {
    visibleFields: [],
    minimumAggregationSize: 3,
    suppressSmallCells: true,
  },
  legalEligibilityRequired: true,
};
const admissionPolicyHash = sha256(stringToHex(canonicalJson(audiencePolicy)));

describe("tokenless agents client", () => {
  it("authenticates tenant-scoped quotes on the isolated v2 route", async () => {
    const apiKey = `rlk_${"a".repeat(16)}_${"b".repeat(32)}`;
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            audience: {
              admissionPolicyHash,
              label: "Customer-invited reviewers",
              source: "customer_invited",
            },
            economics: {
              asset: "USDC",
              attemptReserve: {
                compensatedAtomic: "0",
                fundedAtomic: "100",
                refundedAtomic: "0",
              },
              bounty: {
                fundedAtomic: "1000",
                paidAtomic: "0",
                refundedAtomic: "0",
              },
              compensation: {
                perAcceptedRevealCapAtomic: "20",
                recipientCount: 0,
                totalAtomic: "0",
              },
              decimals: 6,
              fee: {
                bps: 500,
                fundedAtomic: "50",
                paidAtomic: "0",
                refundedAtomic: "0",
              },
              refund: {
                attemptReserveAtomic: "0",
                bountyAtomic: "0",
                feeAtomic: "0",
                totalAtomic: "0",
              },
              totalFundedAtomic: "1150",
            },
            expiresAt: "2026-07-12T20:00:00.000Z",
            panel: { minimumReveals: 4, requestedSize: 5 },
            quoteId: "qte_12345678",
            requestProfile: null,
            responseWindowSeconds: 3_600,
            reviewEconomics: null,
            schemaVersion: "rateloop.tokenless.v2",
            slo: { estimatedSeconds: 1800 },
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
    );
    const client = createTokenlessAgentsClient({
      apiKey,
      apiBaseUrl: "https://tokenless-preview.vercel.app",
      fetchImpl,
    });
    const quote = await client.quote({
      audience: {
        admissionPolicyHash,
        source: "customer_invited",
      },
      audiencePolicy,
      budget: {
        attemptReserveAtomic: "100",
        bountyAtomic: "1000",
        feeBps: 500,
      },
      question: {
        kind: "binary",
        prompt: "Ship it?",
        rationale: { mode: "optional" },
      },
      requestedPanelSize: 5,
      responseWindowSeconds: 3_600,
    });

    expect(quote.schemaVersion).toBe("rateloop.tokenless.v2");
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "https://tokenless-preview.vercel.app/api/agent/v1/quote",
    );
    expect(
      new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get("authorization"),
    ).toBe(`Bearer ${apiKey}`);
  });

  it("attaches a scoped API key to a prepaid ask", async () => {
    const apiKey = `rlk_${"c".repeat(16)}_${"d".repeat(32)}`;
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            continuation: {
              cursor: "cursor-1",
              expiresAt: "2026-07-13T20:00:00.000Z",
              pollUrl:
                "https://tokenless-preview.vercel.app/api/agent/v1/asks/op_123/wait",
              retryAfterMs: 1000,
            },
            idempotencyKey: "release-check-123",
            operationKey: "op_123",
            roundId: null,
            schemaVersion: "rateloop.tokenless.v2",
            status: "awaiting_payment",
            responseWindowSeconds: 3_600,
            commitDeadline: null,
            requestProfile: null,
            reviewEconomics: null,
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
    );
    const client = createTokenlessAgentsClient({
      apiBaseUrl: "https://tokenless-preview.vercel.app",
      apiKey,
      fetchImpl,
    });

    await client.ask({
      idempotencyKey: "release-check-123",
      payment: { mode: "prepaid", workspaceId: "workspace_123" },
      quoteId: "qte_12345678",
    });

    expect(
      new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get("authorization"),
    ).toBe(`Bearer ${apiKey}`);
  });

  it("follows continuation cursors until ready", async () => {
    const wait = vi
      .fn()
      .mockResolvedValueOnce({
        continuation: {
          cursor: "cursor-2",
          expiresAt: "2026-07-13T20:00:00.000Z",
          pollUrl: "https://tokenless.example/poll",
          retryAfterMs: 1,
        },
        operationKey: "op_123",
        schemaVersion: "rateloop.tokenless.v2",
        status: "pending",
        verdictStatus: null,
      })
      .mockResolvedValueOnce({
        continuation: null,
        operationKey: "op_123",
        schemaVersion: "rateloop.tokenless.v2",
        status: "ready",
        verdictStatus: "publishable",
      });
    const client = { wait } as unknown as TokenlessRateLoopClient;

    const response = await waitUntilTokenlessReady(client, {
      maxWaitMs: 5_000,
      operationKey: "op_123",
      sleep: async () => {},
      timeoutMs: 1_000,
    });

    expect(response.status).toBe("ready");
    expect(wait).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ cursor: "cursor-2" }),
    );
  });

  it("rejects an unbounded or sub-long-poll wait", async () => {
    await expect(
      waitUntilTokenlessReady({} as TokenlessRateLoopClient, {
        maxWaitMs: 999,
        operationKey: "op_123",
      }),
    ).rejects.toThrow(/at least 1000ms/);
  });
});

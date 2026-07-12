import { describe, expect, it, vi } from "vitest";
import type { TokenlessRateLoopClient } from "@rateloop/sdk";
import {
  createTokenlessAgentsClient,
  waitUntilTokenlessReady,
} from "../tokenless";

describe("tokenless agents client", () => {
  it("uses the isolated v1 quote route", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            audience: { label: "Presence", tierId: "presence" },
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
            schemaVersion: "rateloop.tokenless.v1",
            slo: { estimatedSeconds: 1800, tierId: "presence" },
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
    );
    const client = createTokenlessAgentsClient({
      apiKey: "must-not-be-sent-on-free-quotes",
      apiBaseUrl: "https://tokenless-preview.vercel.app",
      fetchImpl,
    });
    const quote = await client.quote({
      audience: { tierId: "presence" },
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
    });

    expect(quote.schemaVersion).toBe("rateloop.tokenless.v1");
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "https://tokenless-preview.vercel.app/api/agent/v1/quote",
    );
    expect(
      new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).has("authorization"),
    ).toBe(false);
  });

  it("attaches a scoped API key to a prepaid ask", async () => {
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
            schemaVersion: "rateloop.tokenless.v1",
            status: "awaiting_payment",
            webhookAccepted: false,
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
    );
    const client = createTokenlessAgentsClient({
      apiBaseUrl: "https://tokenless-preview.vercel.app",
      apiKey: "scoped-secret",
      fetchImpl,
    });

    await client.ask({
      idempotencyKey: "release-check-123",
      payment: { mode: "prepaid", workspaceId: "workspace_123" },
      quoteId: "qte_12345678",
    });

    expect(
      new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get("authorization"),
    ).toBe("Bearer scoped-secret");
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
        schemaVersion: "rateloop.tokenless.v1",
        status: "pending",
        verdictStatus: null,
      })
      .mockResolvedValueOnce({
        continuation: null,
        operationKey: "op_123",
        schemaVersion: "rateloop.tokenless.v1",
        status: "ready",
        verdictStatus: "published",
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

import assert from "node:assert/strict";
import test from "node:test";
import { RateLoopApiError } from "./errors";
import { createTokenlessRateLoopClient } from "./tokenless";
import {
  TOKENLESS_RESULT_JSON_SCHEMA,
  parseTokenlessResult,
  parseTokenlessWebhookEvent,
} from "./tokenlessSchema";
import {
  TOKENLESS_SCHEMA_VERSION,
  TOKENLESS_TERMINAL_VERDICT_STATUSES,
  TOKENLESS_VERDICT_STATUSES,
  type TokenlessEconomics,
} from "./tokenlessTypes";

const API_BASE_URL = "https://tokenless.example";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function economics(
  overrides: Partial<TokenlessEconomics> = {},
): TokenlessEconomics {
  return {
    asset: "USDC",
    decimals: 6,
    bounty: { fundedAtomic: "25000000", paidAtomic: "0", refundedAtomic: "0" },
    fee: {
      bps: 750,
      fundedAtomic: "1875000",
      paidAtomic: "0",
      refundedAtomic: "0",
    },
    attemptReserve: {
      compensatedAtomic: "0",
      fundedAtomic: "5000000",
      refundedAtomic: "0",
    },
    refund: {
      attemptReserveAtomic: "0",
      bountyAtomic: "0",
      feeAtomic: "0",
      totalAtomic: "0",
    },
    compensation: {
      perAcceptedRevealCapAtomic: "500000",
      recipientCount: 0,
      totalAtomic: "0",
    },
    totalFundedAtomic: "31875000",
    ...overrides,
  };
}

function resultFixture(
  verdictStatus: (typeof TOKENLESS_VERDICT_STATUSES)[number] = "published",
) {
  return {
    schemaVersion: TOKENLESS_SCHEMA_VERSION,
    operationKey: "op_12345678",
    roundId: "42",
    verdictStatus,
    terminal: verdictStatus !== "pending_analytics",
    economics: economics(),
    audience: {
      label: "Passport holders",
      participantCount: 15,
      tierId: "passport",
    },
    verdict:
      verdictStatus === "published"
        ? { confidenceBps: 8200, scoreBps: 6700, selected: "yes" }
        : null,
    methodologyUrl: "https://tokenless.example/docs/methodology/v1",
    updatedAt: "2026-07-12T12:00:00.000Z",
  };
}

test("tokenless status constants and JSON Schema expose the exact accounting contract", () => {
  assert.deepEqual(TOKENLESS_VERDICT_STATUSES, [
    "pending_analytics",
    "published",
    "delisted",
    "zero_commit_refunded",
    "under_quorum_compensated",
    "beacon_failure_compensated",
  ]);
  assert.deepEqual(
    TOKENLESS_TERMINAL_VERDICT_STATUSES,
    TOKENLESS_VERDICT_STATUSES.slice(1),
  );

  const economicsSchema = TOKENLESS_RESULT_JSON_SCHEMA.properties.economics;
  assert.deepEqual(economicsSchema.required, [
    "asset",
    "decimals",
    "bounty",
    "fee",
    "attemptReserve",
    "refund",
    "compensation",
    "totalFundedAtomic",
  ]);
  assert.deepEqual(
    TOKENLESS_RESULT_JSON_SCHEMA.properties.verdictStatus.enum,
    TOKENLESS_VERDICT_STATUSES,
  );
});

test("parseTokenlessResult validates terminal state and every accounting field", () => {
  for (const status of TOKENLESS_VERDICT_STATUSES) {
    const parsed = parseTokenlessResult(resultFixture(status));
    assert.equal(parsed.verdictStatus, status);
    assert.equal(parsed.terminal, status !== "pending_analytics");
    assert.equal(parsed.economics.attemptReserve.fundedAtomic, "5000000");
    assert.equal(parsed.economics.refund.totalAtomic, "0");
    assert.equal(parsed.economics.compensation.recipientCount, 0);
  }

  assert.throws(
    () =>
      parseTokenlessResult({
        ...resultFixture("pending_analytics"),
        terminal: true,
      }),
    /false only for pending_analytics/,
  );
  assert.throws(
    () =>
      parseTokenlessResult({
        ...resultFixture(),
        economics: {
          ...economics(),
          attemptReserve: { ...economics().attemptReserve, fundedAtomic: "-1" },
        },
      }),
    /economics\.attemptReserve\.fundedAtomic/,
  );
});

test("tokenless client performs quote and ask with a required idempotency header", async () => {
  const requests: Array<{
    body: unknown;
    headers: Headers;
    method: string;
    url: string;
  }> = [];
  const client = createTokenlessRateLoopClient({
    apiBaseUrl: API_BASE_URL,
    fetchImpl: async (input, init) => {
      requests.push({
        body: init?.body ? JSON.parse(String(init.body)) : null,
        headers: new Headers(init?.headers),
        method: init?.method ?? "GET",
        url: String(input),
      });

      if (String(input).endsWith("/quote")) {
        return jsonResponse({
          schemaVersion: TOKENLESS_SCHEMA_VERSION,
          quoteId: "quote_12345678",
          expiresAt: "2026-07-12T12:10:00.000Z",
          economics: economics(),
          audience: { label: "Passport holders", tierId: "passport" },
          panel: { minimumReveals: 12, requestedSize: 15 },
          slo: { estimatedSeconds: 1800, tierId: "passport" },
        });
      }

      return jsonResponse({
        schemaVersion: TOKENLESS_SCHEMA_VERSION,
        idempotencyKey: "ask:test:12345678",
        operationKey: "op_12345678",
        roundId: "42",
        status: "open",
        continuation: {
          cursor: "cursor_1",
          expiresAt: "2026-07-13T12:00:00.000Z",
          pollUrl:
            "https://tokenless.example/api/agent/v1/asks/op_12345678/wait",
          retryAfterMs: 1000,
        },
        webhookAccepted: true,
      });
    },
  });

  const quote = await client.quote({
    audience: { tierId: "passport" },
    budget: {
      attemptReserveAtomic: "5000000",
      bountyAtomic: "25000000",
      feeBps: 750,
    },
    question: {
      kind: "binary",
      prompt: "Ship it?",
      rationale: { mode: "optional" },
    },
    requestedPanelSize: 15,
  });
  const ask = await client.ask({
    idempotencyKey: "ask:test:12345678",
    payment: { mode: "prepaid", workspaceId: "workspace_1" },
    quoteId: quote.quoteId,
    webhook: {
      eventTypes: ["result.ready", "result.updated"],
      url: "https://agent.example/webhook",
    },
  });

  assert.equal(
    requests[0]?.url,
    "https://tokenless.example/api/agent/v1/quote",
  );
  assert.equal(requests[1]?.url, "https://tokenless.example/api/agent/v1/asks");
  assert.equal(
    requests[1]?.headers.get("idempotency-key"),
    "ask:test:12345678",
  );
  assert.equal(
    (requests[1]?.body as { idempotencyKey: string }).idempotencyKey,
    "ask:test:12345678",
  );
  assert.equal(ask.operationKey, "op_12345678");

  assert.throws(
    () =>
      client.quote({
        audience: { tierId: "passport" },
        budget: {
          attemptReserveAtomic: "5000000",
          bountyAtomic: "25000000",
          feeBps: 2_001,
        },
        question: {
          kind: "binary",
          prompt: "Ship it?",
          rationale: { mode: "optional" },
        },
        requestedPanelSize: 15,
      }),
    /feeBps must be an integer between 0 and 2000/,
  );

  assert.throws(
    () =>
      client.ask({
        idempotencyKey: "short",
        payment: { mode: "prepaid", workspaceId: "workspace_1" },
        quoteId: quote.quoteId,
      }),
    /idempotencyKey must be 8-160 characters/,
  );
  assert.equal(requests.length, 2);
});

test("tokenless wait returns an explicit polling continuation and then a result-ready signal", async () => {
  const requestedUrls: string[] = [];
  let call = 0;
  const client = createTokenlessRateLoopClient({
    apiBaseUrl: API_BASE_URL,
    fetchImpl: async (input) => {
      requestedUrls.push(String(input));
      call += 1;
      if (call === 1) {
        return jsonResponse({
          schemaVersion: TOKENLESS_SCHEMA_VERSION,
          operationKey: "op.with.dot",
          status: "pending",
          verdictStatus: "pending_analytics",
          continuation: {
            cursor: "next/cursor",
            expiresAt: "2026-07-13T12:00:00.000Z",
            pollUrl:
              "https://tokenless.example/api/agent/v1/asks/op.with.dot/wait",
            retryAfterMs: 1250,
          },
        });
      }
      return jsonResponse({
        schemaVersion: TOKENLESS_SCHEMA_VERSION,
        operationKey: "op.with.dot",
        status: "ready",
        verdictStatus: "published",
        continuation: null,
      });
    },
  });

  const pending = await client.wait({
    operationKey: "op.with.dot",
    timeoutMs: 15_000,
  });
  assert.equal(pending.status, "pending");
  assert.equal(pending.continuation.cursor, "next/cursor");

  const ready = await client.wait({
    operationKey: "op.with.dot",
    cursor: pending.continuation.cursor,
    timeoutMs: 15_000,
  });
  assert.equal(ready.status, "ready");
  assert.equal(ready.continuation, null);
  assert.match(
    requestedUrls[0] ?? "",
    /asks\/op%2Ewith%2Edot\/wait\?timeoutMs=15000$/,
  );
  assert.match(requestedUrls[1] ?? "", /cursor=next%2Fcursor/);

  await assert.rejects(
    () => client.wait({ operationKey: "op", timeoutMs: 60_001 }),
    /between 1000 and 60000/,
  );
});

test("tokenless result uses the versioned result route and reports structured API errors", async () => {
  let shouldFail = false;
  const client = createTokenlessRateLoopClient({
    apiBaseUrl: API_BASE_URL,
    fetchImpl: async () =>
      shouldFail
        ? jsonResponse(
            {
              code: "result_not_ready",
              message: "Result is not ready",
              retryable: true,
            },
            409,
          )
        : jsonResponse(resultFixture()),
  });

  const result = await client.result({ operationKey: "op_12345678" });
  assert.equal(result.verdictStatus, "published");
  assert.equal(result.economics.bounty.fundedAtomic, "25000000");

  shouldFail = true;
  await assert.rejects(
    () => client.result({ operationKey: "op_12345678" }),
    (error: unknown) =>
      error instanceof RateLoopApiError &&
      error.status === 409 &&
      error.code === "result_not_ready" &&
      error.retryable === true,
  );
});

test("tokenless webhook parser carries result URL and verdict continuation state", () => {
  const event = parseTokenlessWebhookEvent({
    schemaVersion: TOKENLESS_SCHEMA_VERSION,
    eventId: "evt_12345678",
    eventType: "result.updated",
    occurredAt: "2026-07-12T12:00:00.000Z",
    operationKey: "op_12345678",
    verdictStatus: "pending_analytics",
    resultUrl: "https://tokenless.example/api/agent/v1/results/op_12345678",
  });

  assert.equal(event.eventType, "result.updated");
  assert.equal(event.verdictStatus, "pending_analytics");
});

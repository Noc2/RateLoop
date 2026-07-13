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
import * as sdk from "./index";

const API_BASE_URL = "https://tokenless.example";

test("package root exposes only the tokenless client, schema, types, and generic errors", () => {
  assert.deepEqual(
    Object.keys(sdk).sort(),
    [
      "RateLoopApiError",
      "RateLoopSdkError",
      "HUMAN_ASSURANCE_ARTIFACT_JSON_SCHEMA",
      "HUMAN_ASSURANCE_AUDIENCE_POLICY_JSON_SCHEMA",
      "HUMAN_ASSURANCE_CAPABILITIES",
      "HUMAN_ASSURANCE_CASE_JSON_SCHEMA",
      "HUMAN_ASSURANCE_CLIENT_DECISION_JSON_SCHEMA",
      "HUMAN_ASSURANCE_EVIDENCE_PACKET_JSON_SCHEMA",
      "HUMAN_ASSURANCE_INTEGRITY_ASSIGNMENT_SCHEMA_VERSION",
      "HUMAN_ASSURANCE_PROJECT_JSON_SCHEMA",
      "HUMAN_ASSURANCE_RESPONSE_JSON_SCHEMA",
      "HUMAN_ASSURANCE_RUBRIC_JSON_SCHEMA",
      "HUMAN_ASSURANCE_RUN_JSON_SCHEMA",
      "HUMAN_ASSURANCE_SCHEMA_VERSION",
      "HUMAN_ASSURANCE_SUITE_JSON_SCHEMA",
      "TOKENLESS_RESULT_JSON_SCHEMA",
      "TOKENLESS_REVIEWER_SOURCES",
      "TOKENLESS_SCHEMA_VERSION",
      "TOKENLESS_TERMINAL_VERDICT_STATUSES",
      "TOKENLESS_VERDICT_STATUSES",
      "TOKENLESS_WEBHOOK_EVENT_TYPES",
      "createTokenlessRateLoopClient",
      "parseHumanAssuranceArtifact",
      "parseHumanAssuranceAudiencePolicy",
      "parseHumanAssuranceCase",
      "parseHumanAssuranceClientDecision",
      "parseHumanAssuranceEvidencePacket",
      "parseHumanAssuranceProject",
      "parseHumanAssuranceProjectCreateRequest",
      "parseHumanAssuranceProjectCreateResponse",
      "parseHumanAssuranceProjectListResponse",
      "parseHumanAssuranceProjectResourcesResponse",
      "parseHumanAssuranceResponse",
      "parseHumanAssuranceRubric",
      "parseHumanAssuranceRun",
      "parseHumanAssuranceRunStatusResponse",
      "parseHumanAssuranceSuite",
      "parseTokenlessAskResponse",
      "parseTokenlessPaymentInstructions",
      "parseTokenlessQuoteResponse",
      "parseTokenlessResult",
      "parseTokenlessWaitResponse",
      "parseTokenlessWebhookEvent",
    ].sort(),
  );
});

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
      admissionPolicyHash: `0x${"ab".repeat(32)}`,
      label: "Customer-invited reviewers",
      participantCount: 15,
      source: "customer_invited",
    },
    verdict:
      verdictStatus === "published"
        ? {
            intervalBps: { lower: 4121, upper: 8510 },
            preferenceShareBps: 6700,
            selected: "yes",
          }
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
  const apiKey = `rlk_${"c".repeat(16)}_${"d".repeat(32)}`;
  const requests: Array<{
    body: unknown;
    headers: Headers;
    method: string;
    url: string;
  }> = [];
  const client = createTokenlessRateLoopClient({
    apiKey,
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
          audience: {
            admissionPolicyHash: `0x${"ab".repeat(32)}`,
            label: "Customer-invited reviewers",
            source: "customer_invited",
          },
          panel: { minimumReveals: 12, requestedSize: 15 },
          slo: { estimatedSeconds: 1800 },
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
    audience: {
      admissionPolicyHash: `0x${"ab".repeat(32)}`,
      source: "customer_invited",
    },
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
  assert.equal(requests[0]?.headers.get("authorization"), null);
  assert.equal(requests[1]?.url, "https://tokenless.example/api/agent/v1/asks");
  assert.equal(requests[1]?.headers.get("authorization"), `Bearer ${apiKey}`);
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
        audience: {
          admissionPolicyHash: `0x${"ab".repeat(32)}`,
          source: "customer_invited",
        },
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

  assert.throws(
    () =>
      client.ask({
        idempotencyKey: "wallet:test:12345678",
        payment: { mode: "wallet", payerAddress: "0x123" },
        quoteId: quote.quoteId,
      }),
    /payment\.payerAddress must be an EVM address/,
  );

  assert.throws(
    () =>
      client.ask({
        idempotencyKey: "webhook:test:12345678",
        payment: { mode: "prepaid", workspaceId: "workspace_1" },
        quoteId: quote.quoteId,
        webhook: {
          eventTypes: ["result.ready"],
          url: "http://public.example/webhook",
        },
      }),
    /webhook\.url must use HTTPS/,
  );
  assert.equal(requests.length, 2);
});

test("tokenless quote validation rejects ambiguous mechanisms before HTTP", () => {
  const client = createTokenlessRateLoopClient({
    apiBaseUrl: API_BASE_URL,
    fetchImpl: async () => {
      throw new Error("must not fetch");
    },
  });

  assert.throws(
    () =>
      client.quote({
        audience: {
          admissionPolicyHash: `0x${"ab".repeat(32)}`,
          source: "customer_invited",
        },
        budget: {
          attemptReserveAtomic: "5000000",
          bountyAtomic: "25000000",
          feeBps: 750,
        },
        question: {
          kind: "head_to_head",
          prompt: "Which message?",
          optionA: { key: "same", label: "A" },
          optionB: { key: "same", label: "B" },
          rationale: { mode: "optional" },
        },
        requestedPanelSize: 15,
      }),
    /option keys must be different/,
  );

  assert.throws(
    () =>
      client.quote({
        audience: {
          admissionPolicyHash: `0x${"ab".repeat(32)}`,
          source: "customer_invited",
        },
        budget: {
          attemptReserveAtomic: "5000000",
          bountyAtomic: "25000000",
          feeBps: 750,
        },
        question: {
          kind: "binary",
          prompt: "Ship?",
          rationale: { mode: "required", minLength: 100, maxLength: 10 },
        },
        requestedPanelSize: 15,
      }),
    /required rationale lengths/,
  );
});

test("direct B2B clients authenticate payment preparation without exposing API keys in browser clients", async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  const terms = {
    contentId: `0x${"11".repeat(32)}`,
    termsHash: `0x${"22".repeat(32)}`,
    beaconNetworkHash: `0x${"33".repeat(32)}`,
    bountyAmount: "25000000",
    feeAmount: "1875000",
    attemptReserve: "5000000",
    attemptCompensation: "333333",
    minimumReveals: 12,
    maximumCommits: 15,
    admissionPolicyHash: `0x${"44".repeat(32)}`,
    commitDeadline: "2000000000",
    revealDeadline: "2000000120",
    beaconFailureDeadline: "2000000420",
    beaconRound: "1000",
    claimGracePeriod: "604800",
    feeRecipient: "0x6666666666666666666666666666666666666666",
  };
  const response = {
    operationKey: "op_payment",
    paymentMode: "x402",
    paymentState: "prepared",
    deploymentKey:
      "tokenless-v2:84532:0x1111111111111111111111111111111111111111:0x2222222222222222222222222222222222222222:0x3333333333333333333333333333333333333333",
    chainId: 84532,
    panelAddress: "0x1111111111111111111111111111111111111111",
    x402SubmitterAddress: "0x3333333333333333333333333333333333333333",
    usdcAddress: "0x4444444444444444444444444444444444444444",
    funderAddress: "0x5555555555555555555555555555555555555555",
    totalFundedAtomic: "31875000",
    roundTerms: terms,
    roundId: null,
    transactionHash: null,
  };
  const apiKey = `rlk_${"a".repeat(16)}_${"b".repeat(32)}`;
  const client = createTokenlessRateLoopClient({
    apiBaseUrl: API_BASE_URL,
    apiKey,
    defaultHeaders: { "x-client": "ci" },
    fetchImpl: async (url, init = {}) => {
      requests.push({ url: String(url), init });
      return new Response(JSON.stringify(response), { status: 200 });
    },
  });
  assert.equal(
    (await client.paymentInstructions({ operationKey: "op_payment" }))
      .roundTerms.admissionPolicyHash,
    terms.admissionPolicyHash,
  );
  await client.submitPayment({
    operationKey: "op_payment",
    authorization: { nonce: terms.contentId },
  });
  for (const request of requests) {
    const headers = new Headers(request.init.headers);
    assert.equal(headers.get("authorization"), `Bearer ${apiKey}`);
    assert.equal(headers.get("x-client"), "ci");
    assert.equal(request.init.credentials, "same-origin");
  }
  assert.equal(
    requests[0]?.url,
    `${API_BASE_URL}/api/agent/v1/asks/op_payment/payment`,
  );
  assert.deepEqual(JSON.parse(String(requests[1]?.init.body)), {
    authorization: { nonce: terms.contentId },
  });

  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {},
  });
  try {
    assert.throws(
      () => createTokenlessRateLoopClient({ apiBaseUrl: API_BASE_URL, apiKey }),
      /API authorization is server-only/,
    );
  } finally {
    if (originalWindow)
      Object.defineProperty(globalThis, "window", originalWindow);
    else delete (globalThis as { window?: unknown }).window;
  }
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

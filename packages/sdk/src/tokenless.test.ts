import assert from "node:assert/strict";
import test from "node:test";
import { RateLoopApiError } from "./errors";
import {
  buildTokenlessQuoteIntent,
  createTokenlessRateLoopClient,
} from "./tokenless";
import {
  normalizeTokenlessQuestion,
  parseTokenlessYouTubeUrl,
} from "./tokenlessMedia";
import {
  TOKENLESS_RESULT_JSON_SCHEMA,
  parseTokenlessAskResponse,
  parseTokenlessQuoteResponse,
  parseTokenlessResult,
} from "./tokenlessSchema";
import {
  TOKENLESS_SCHEMA_VERSION,
  TOKENLESS_TERMINAL_VERDICT_STATUSES,
  TOKENLESS_VERDICT_STATUSES,
  type TokenlessEconomics,
} from "./tokenlessTypes";
import * as sdk from "./index";

const API_BASE_URL = "https://tokenless.example";
const REQUEST_PROFILE = {
  id: "rrp_release_v1",
  version: 1,
  hash: `sha256:${"a".repeat(64)}` as const,
};
const REVIEW_ECONOMICS = {
  compensationMode: "usdc" as const,
  bountyPerSeatAtomic: "1000000",
  panelSize: 15,
};

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
      "HUMAN_REVIEW_RESULT_ENVELOPE_SCHEMA_VERSION",
      "HUMAN_REVIEW_RESULT_LANES",
      "HUMAN_REVIEW_RESULT_OUTCOMES",
      "HUMAN_REVIEW_RESULT_TERMINAL_STATES",
      "HUMAN_REVIEW_TERMINAL_EVIDENCE_SCHEMA_VERSION",
      "TOKENLESS_EIP3009_TYPES",
      "TOKENLESS_DATA_CLASSIFICATIONS",
      "TOKENLESS_MAX_IMAGE_ALT_LENGTH",
      "TOKENLESS_MAX_PROMPT_LENGTH",
      "TOKENLESS_MAX_QUESTION_IMAGES",
      "TOKENLESS_PAYMENT_AUTHORIZATION_SCHEMA_VERSION",
      "TOKENLESS_RESULT_JSON_SCHEMA",
      "TOKENLESS_REVIEWER_SOURCES",
      "TOKENLESS_ROUND_AUTHORIZATION_TYPES",
      "TOKENLESS_ROUND_TERMS_TYPES",
      "TOKENLESS_SCHEMA_VERSION",
      "TOKENLESS_TERMINAL_VERDICT_STATUSES",
      "TOKENLESS_VERDICT_STATUSES",
      "TOKENLESS_VISIBILITIES",
      "TOKENLESS_X402_DOMAIN",
      "buildTokenlessEip3009TypedData",
      "buildTokenlessQuoteIntent",
      "buildTokenlessRoundAuthorizationTypedData",
      "buildTokenlessRoundTermsMessage",
      "buildTokenlessRoundTermsTypedData",
      "buildTokenlessX402Authorization",
      "createTokenlessRateLoopClient",
      "hashTokenlessRoundAuthorization",
      "hashTokenlessRoundTerms",
      "parseHumanAssuranceArtifact",
      "parseHumanAssuranceAudiencePolicy",
      "parseHumanAssuranceCase",
      "parseHumanAssuranceClientDecision",
      "parseHumanAssuranceEvidencePacket",
      "parseHumanAssurancePrivateReviewCreateRequest",
      "parseHumanAssurancePrivateReviewCreateResponse",
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
      "parseHumanReviewResultEnvelope",
      "parseTokenlessAskResponse",
      "parseTokenlessPaymentInstructions",
      "parseTokenlessQuoteResponse",
      "parseTokenlessResult",
      "parseTokenlessWaitResponse",
      "normalizeTokenlessQuestion",
      "normalizeTokenlessQuestionMedia",
      "normalizeTokenlessQuoteRequest",
      "parseTokenlessYouTubeUrl",
      "serializeTokenlessX402Authorization",
      "validateTokenlessPaymentInstructions",
    ].sort(),
  );
});

test("canonical quote intent binds the exact question and frozen product terms", () => {
  const request = {
    audience: {
      admissionPolicyHash: `0x${"44".repeat(32)}` as const,
      source: "customer_invited" as const,
    },
    budget: { attemptReserveAtomic: "636", bountyAtomic: "800", feeBps: 1_250 },
    question: {
      kind: "binary" as const,
      prompt: "Is this safe?",
      rationale: { mode: "off" as const },
    },
    requestedPanelSize: 3,
    responseWindowSeconds: 3_600,
  };
  const quote = {
    schemaVersion: TOKENLESS_SCHEMA_VERSION,
    quoteId: "quote_test",
    expiresAt: "2099-01-01T00:00:00.000Z",
    economics: {
      asset: "USDC" as const,
      decimals: 6 as const,
      bounty: { fundedAtomic: "800", paidAtomic: "0", refundedAtomic: "0" },
      fee: {
        bps: 1_250,
        fundedAtomic: "100",
        paidAtomic: "0",
        refundedAtomic: "0",
      },
      attemptReserve: {
        compensatedAtomic: "0",
        fundedAtomic: "636",
        refundedAtomic: "0",
      },
      refund: {
        attemptReserveAtomic: "0",
        bountyAtomic: "0",
        feeAtomic: "0",
        totalAtomic: "0",
      },
      compensation: {
        perAcceptedRevealCapAtomic: "212",
        recipientCount: 0,
        totalAtomic: "0",
      },
      totalFundedAtomic: "1536",
    },
    audience: {
      admissionPolicyHash: request.audience.admissionPolicyHash,
      label: "Customer-invited reviewers",
      source: "customer_invited" as const,
    },
    panel: { minimumReveals: 3, requestedSize: 3 },
    responseWindowSeconds: 3_600,
    requestProfile: null,
    reviewEconomics: null,
    slo: { estimatedSeconds: 1_800 },
  };
  const intent = buildTokenlessQuoteIntent(request, quote);
  assert.equal(
    intent.contentId,
    "0x066023d48279e5c58dcd0e5088485d0965461ddc76fd7751a43517de48bd8705",
  );
  assert.equal(
    intent.termsHash,
    "0xf2c059751d1713f571f7f22de0235269badacb09f3e02a10bb1cf250ab104565",
  );
  assert.throws(
    () =>
      buildTokenlessQuoteIntent(request, {
        ...quote,
        economics: {
          ...quote.economics,
          bounty: { ...quote.economics.bounty, fundedAtomic: "801" },
          fee: { ...quote.economics.fee, fundedAtomic: "99" },
        },
      }),
    /changed the locally requested economics/,
  );
});

test("canonical tokenless media accepts ordered images and normalizes supported YouTube URLs", () => {
  const firstAssetId = `pqm_${"A".repeat(24)}`;
  const secondAssetId = `pqm_${"B".repeat(24)}`;
  const normalized = normalizeTokenlessQuestion({
    kind: "binary",
    prompt: "  Which visual should ship?  ",
    rationale: { mode: "optional" },
    media: {
      kind: "images",
      items: [
        {
          assetId: firstAssetId,
          digest: `sha256:${"a".repeat(64)}`,
          alt: "  Current layout  ",
        },
        {
          assetId: secondAssetId,
          digest: `sha256:${"b".repeat(64)}`,
          alt: "Candidate layout",
        },
      ],
    },
  });
  assert.equal(normalized.prompt, "Which visual should ship?");
  assert.deepEqual(normalized.media, {
    kind: "images",
    items: [
      {
        assetId: firstAssetId,
        digest: `sha256:${"a".repeat(64)}`,
        alt: "Current layout",
      },
      {
        assetId: secondAssetId,
        digest: `sha256:${"b".repeat(64)}`,
        alt: "Candidate layout",
      },
    ],
  });

  for (const url of [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10",
    "https://youtu.be/dQw4w9WgXcQ?si=tracking",
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  ]) {
    assert.deepEqual(parseTokenlessYouTubeUrl(url), {
      canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      media: { kind: "youtube", videoId: "dQw4w9WgXcQ" },
    });
  }
});

test("canonical tokenless media rejects ambiguous, duplicate, and spoofed context", () => {
  const assetId = `pqm_${"A".repeat(24)}`;
  const image = { assetId, digest: `sha256:${"a".repeat(64)}`, alt: "Preview" };
  assert.throws(
    () =>
      normalizeTokenlessQuestion({
        kind: "binary",
        prompt: "Which visual should ship?",
        rationale: { mode: "optional" },
        media: { kind: "images", items: [image, image] },
      }),
    /must not contain duplicates/,
  );
  assert.throws(
    () =>
      normalizeTokenlessQuestion({
        kind: "binary",
        prompt: "Which visual should ship?",
        rationale: { mode: "optional" },
        media: {
          kind: "images",
          items: Array.from({ length: 5 }, (_, index) => ({
            ...image,
            assetId: `${assetId}${index}`,
          })),
        },
      }),
    /must contain 1-4 images/,
  );
  assert.throws(
    () =>
      parseTokenlessYouTubeUrl(
        "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
      ),
    /supported video/,
  );
  assert.throws(
    () => parseTokenlessYouTubeUrl("http://youtu.be/dQw4w9WgXcQ"),
    /must use HTTPS/,
  );
  assert.throws(
    () =>
      normalizeTokenlessQuestion({
        kind: "binary",
        prompt: "Which visual should ship?",
        rationale: { mode: "optional" },
        media: {
          kind: "youtube",
          videoId: "dQw4w9WgXcQ",
          url: "https://example.com",
        },
      }),
    /url is not supported/,
  );
});

test("authenticated SDK image staging uses multipart bytes and returns a canonical descriptor", async () => {
  const apiKey = `rlk_${"c".repeat(16)}_${"d".repeat(32)}`;
  let captured: { form: FormData; headers: Headers; url: string } | null = null;
  const client = createTokenlessRateLoopClient({
    apiKey,
    apiBaseUrl: API_BASE_URL,
    fetchImpl: async (input, init) => {
      captured = {
        form: init?.body as FormData,
        headers: new Headers(init?.headers),
        url: String(input),
      };
      return jsonResponse({
        assetId: `pqm_${"A".repeat(24)}`,
        contentType: "image/webp",
        digest: `sha256:${"ab".repeat(32)}`,
        height: 720,
        previewUrl: `/api/public-media/images/pqm_${"A".repeat(24)}`,
        sizeBytes: 1234,
        width: 1280,
      });
    },
  });

  const staged = await client.stageQuestionImage({
    bytes: new Uint8Array([1, 2, 3]),
    clientRequestId: "upload:sdk:test1",
    contentType: "image/png",
    filename: "candidate.png",
  });

  assert.equal(
    captured?.url,
    "https://tokenless.example/api/agent/v1/media/images",
  );
  assert.equal(captured?.headers.get("authorization"), `Bearer ${apiKey}`);
  assert.equal(captured?.headers.has("content-type"), false);
  assert.equal(captured?.form.get("clientRequestId"), "upload:sdk:test1");
  const file = captured?.form.get("file");
  assert.ok(file instanceof Blob);
  assert.equal(file.type, "image/png");
  assert.deepEqual(
    new Uint8Array(await file.arrayBuffer()),
    new Uint8Array([1, 2, 3]),
  );
  assert.match(staged.digest, /^sha256:/);
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
  verdictStatus: (typeof TOKENLESS_VERDICT_STATUSES)[number] = "publishable",
) {
  return {
    schemaVersion: TOKENLESS_SCHEMA_VERSION,
    operationKey: "op_12345678",
    roundId: "42",
    verdictStatus,
    terminal: verdictStatus !== "pending",
    responseWindowSeconds: 3_600,
    commitDeadline: "2026-07-12T12:30:00.000Z",
    requestProfile: REQUEST_PROFILE,
    reviewEconomics: REVIEW_ECONOMICS,
    economics: economics(),
    audience: {
      admissionPolicyHash: `0x${"ab".repeat(32)}`,
      label: "Customer-invited reviewers",
      participantCount: 15,
      source: "customer_invited",
    },
    verdict:
      verdictStatus === "publishable"
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
    "pending",
    "publishable",
    "inconclusive",
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
  assert.ok(
    TOKENLESS_RESULT_JSON_SCHEMA.required.includes("responseWindowSeconds"),
  );
  assert.ok(TOKENLESS_RESULT_JSON_SCHEMA.required.includes("commitDeadline"));
  assert.ok(TOKENLESS_RESULT_JSON_SCHEMA.required.includes("requestProfile"));
  assert.ok(TOKENLESS_RESULT_JSON_SCHEMA.required.includes("reviewEconomics"));
});

test("parseTokenlessResult validates terminal state and every accounting field", () => {
  for (const status of TOKENLESS_VERDICT_STATUSES) {
    const parsed = parseTokenlessResult(resultFixture(status));
    assert.equal(parsed.verdictStatus, status);
    assert.equal(parsed.terminal, status !== "pending");
    assert.equal(parsed.economics.attemptReserve.fundedAtomic, "5000000");
    assert.equal(parsed.economics.refund.totalAtomic, "0");
    assert.equal(parsed.economics.compensation.recipientCount, 0);
    assert.equal(parsed.responseWindowSeconds, 3_600);
    assert.equal(parsed.commitDeadline, "2026-07-12T12:30:00.000Z");
    assert.deepEqual(parsed.requestProfile, REQUEST_PROFILE);
    assert.deepEqual(parsed.reviewEconomics, REVIEW_ECONOMICS);
  }

  assert.throws(
    () =>
      parseTokenlessResult({
        ...resultFixture("pending"),
        terminal: true,
      }),
    /false only for pending/,
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

test("review timing and frozen terms never fall back to the fill-time estimate", () => {
  const quoteFixture = {
    schemaVersion: TOKENLESS_SCHEMA_VERSION,
    quoteId: "quote_12345678",
    expiresAt: "2026-07-12T12:10:00.000Z",
    economics: economics(),
    audience: {
      admissionPolicyHash: `0x${"ab".repeat(32)}`,
      label: "RateLoop network",
      source: "rateloop_network",
    },
    panel: { minimumReveals: 12, requestedSize: 15 },
    responseWindowSeconds: 3_600,
    requestProfile: REQUEST_PROFILE,
    reviewEconomics: REVIEW_ECONOMICS,
    slo: { estimatedSeconds: 900 },
  };
  const quote = parseTokenlessQuoteResponse(quoteFixture);
  assert.equal(quote.responseWindowSeconds, 3_600);
  assert.equal(quote.slo.estimatedSeconds, 900);
  assert.throws(
    () =>
      parseTokenlessQuoteResponse({
        ...quoteFixture,
        responseWindowSeconds: undefined,
      }),
    /responseWindowSeconds/,
  );

  const awaiting = parseTokenlessAskResponse({
    schemaVersion: TOKENLESS_SCHEMA_VERSION,
    idempotencyKey: "ask:test:12345678",
    operationKey: "op_12345678",
    roundId: null,
    status: "awaiting_payment",
    responseWindowSeconds: 3_600,
    commitDeadline: null,
    requestProfile: REQUEST_PROFILE,
    reviewEconomics: REVIEW_ECONOMICS,
    continuation: {
      cursor: "cursor_1",
      expiresAt: "2026-07-13T12:00:00.000Z",
      pollUrl: "https://tokenless.example/poll",
      retryAfterMs: 1_000,
    },
  });
  assert.equal(awaiting.commitDeadline, null);
  assert.deepEqual(awaiting.requestProfile, REQUEST_PROFILE);
  assert.throws(
    () =>
      parseTokenlessAskResponse({
        ...awaiting,
        roundId: "42",
        commitDeadline: null,
      }),
    /commitDeadline/,
  );
  assert.throws(
    () =>
      parseTokenlessResult({
        ...resultFixture(),
        reviewEconomics: {
          compensationMode: "unpaid",
          bountyPerSeatAtomic: "1",
          panelSize: 15,
        },
      }),
    /bountyPerSeatAtomic/,
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
          responseWindowSeconds: 3_600,
          requestProfile: REQUEST_PROFILE,
          reviewEconomics: REVIEW_ECONOMICS,
          slo: { estimatedSeconds: 1800 },
        });
      }

      return jsonResponse({
        schemaVersion: TOKENLESS_SCHEMA_VERSION,
        idempotencyKey: "ask:test:12345678",
        operationKey: "op_12345678",
        roundId: "42",
        status: "open",
        responseWindowSeconds: 3_600,
        commitDeadline: "2026-07-12T12:30:00.000Z",
        requestProfile: REQUEST_PROFILE,
        reviewEconomics: REVIEW_ECONOMICS,
        continuation: {
          cursor: "cursor_1",
          expiresAt: "2026-07-13T12:00:00.000Z",
          pollUrl:
            "https://tokenless.example/api/agent/v1/asks/op_12345678/wait",
          retryAfterMs: 1000,
        },
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
    responseWindowSeconds: 3_600,
    requestProfile: REQUEST_PROFILE,
    reviewEconomics: REVIEW_ECONOMICS,
  });
  const ask = await client.ask({
    idempotencyKey: "ask:test:12345678",
    payment: { mode: "prepaid", workspaceId: "workspace_1" },
    quoteId: quote.quoteId,
  });

  assert.equal(
    requests[0]?.url,
    "https://tokenless.example/api/agent/v1/quote",
  );
  assert.equal(requests[0]?.headers.get("authorization"), `Bearer ${apiKey}`);
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

  await client.quote({
    audience: {
      admissionPolicyHash: `0x${"cd".repeat(32)}`,
      source: "customer_invited",
    },
    budget: {
      attemptReserveAtomic: "5000000",
      bountyAtomic: "25000000",
      feeBps: 750,
    },
    confirmedNoSensitiveData: true,
    dataClassification: "public",
    question: {
      kind: "binary",
      prompt: "Public question?",
      rationale: { mode: "optional" },
    },
    requestedPanelSize: 15,
    responseWindowSeconds: 3_600,
    visibility: "public",
  });
  assert.equal(requests[2]?.headers.get("authorization"), null);

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
        responseWindowSeconds: 3_600,
      }),
    /feeBps must be an integer between 0 and 2000/,
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
          prompt: "Ship it?",
          rationale: { mode: "optional" },
        },
        requestedPanelSize: 15,
        responseWindowSeconds: 1_199,
      }),
    /responseWindowSeconds must be a safe integer between 1200 and 86400/,
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
          prompt: "Ship it?",
          rationale: { mode: "optional" },
        },
        requestedPanelSize: 15,
        responseWindowSeconds: 3_600,
        requestProfile: REQUEST_PROFILE,
      }),
    /requestProfile and reviewEconomics must be supplied together/,
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

  assert.equal(requests.length, 3);
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
        responseWindowSeconds: 3_600,
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
        responseWindowSeconds: 3_600,
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
    authorizationSpec: {
      schemaVersion: "rateloop.tokenless.payment-authorization.v1",
      eip3009Domain: {
        name: "RateLoop Tokenless Test USDC",
        version: "2",
        chainId: 84532,
        verifyingContract: "0x4444444444444444444444444444444444444444",
      },
      roundAuthorizationDomain: {
        name: "RateLoop X402 Panel Submitter",
        version: "1",
        chainId: 84532,
        verifyingContract: "0x3333333333333333333333333333333333333333",
      },
      validAfter: "2000000000",
      validBefore: "2000000600",
      nonce: `0x${"aa".repeat(32)}`,
    },
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
          verdictStatus: "pending",
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
        verdictStatus: "publishable",
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
  assert.equal(result.verdictStatus, "publishable");
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

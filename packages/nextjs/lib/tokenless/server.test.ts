import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { freezeAdmissionPolicy } from "~~/lib/tokenless/admissionPolicy";
import {
  TokenlessServiceError,
  createTokenlessQuote as createOwnedTokenlessQuote,
  createTokenlessAsk,
  getTokenlessAskByIdempotencyKey,
  getTokenlessResult,
  sweepExpiredTokenlessQuotes,
  waitForTokenlessAsk,
} from "~~/lib/tokenless/server";

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
});

function audiencePolicy() {
  return {
    schemaVersion: "rateloop.human-assurance.v2" as const,
    policyId: "policy_server_test",
    version: 1,
    reviewerSource: "customer_invited" as const,
    compensation: "paid" as const,
    cohorts: [{ cohortId: "server-test", minimumReviewers: 3, maximumReviewers: 500 }],
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

function quoteRequest() {
  const policy = audiencePolicy();
  return {
    audience: {
      admissionPolicyHash: freezeAdmissionPolicy(policy).admissionPolicyHash,
      source: "customer_invited" as const,
    },
    audiencePolicy: policy,
    budget: { attemptReserveAtomic: "5000000", bountyAtomic: "25000000", feeBps: 1_000 },
    confirmedNoSensitiveData: true,
    dataClassification: "synthetic" as const,
    question: { kind: "binary", prompt: "Ship this?", rationale: { mode: "optional" } },
    requestedPanelSize: 15,
    responseWindowSeconds: 3_600,
    visibility: "public" as const,
  };
}

function createTokenlessQuote(request: Parameters<typeof createOwnedTokenlessQuote>[0]) {
  return createOwnedTokenlessQuote(request);
}

const imageAssetId = `pqm_${"A".repeat(24)}`;
const imageDigest = `sha256:${"a1".repeat(32)}`;

test("tokenless quote itemizes bounty, fee, reserve, refund, and compensation", async () => {
  const quote = await createTokenlessQuote(quoteRequest());

  assert.equal(quote.schemaVersion, "rateloop.tokenless.v2");
  assert.equal(quote.economics.bounty.fundedAtomic, "25000000");
  assert.equal(quote.economics.fee.fundedAtomic, "2500000");
  assert.equal(quote.economics.attemptReserve.fundedAtomic, "5000000");
  assert.equal(quote.economics.refund.totalAtomic, "0");
  assert.equal(quote.economics.compensation.perAcceptedRevealCapAtomic, "333333");
  assert.equal(quote.economics.totalFundedAtomic, "32500000");
  assert.equal(quote.responseWindowSeconds, 3_600);
  assert.equal(quote.requestProfile, null);
  assert.equal(quote.reviewEconomics, null);
});

test("expired quote retention removes only quotes unused by asks or paid operations", async () => {
  const unused = await createTokenlessQuote({
    ...quoteRequest(),
    question: { ...quoteRequest().question, prompt: "Unused expired quote?" },
  });
  const used = await createTokenlessQuote({
    ...quoteRequest(),
    question: { ...quoteRequest().question, prompt: "Used expired quote?" },
  });
  const paidOperation = await createTokenlessQuote({
    ...quoteRequest(),
    question: { ...quoteRequest().question, prompt: "Paid operation quote?" },
  });
  const idempotencyKey = "test:expired:used-quote";
  await createTokenlessAsk(
    { idempotencyKey, payment: { mode: "prepaid", workspaceId: "workspace" }, quoteId: used.quoteId },
    idempotencyKey,
    "https://tokenless.example",
  );
  await dbClient.execute(
    `ALTER TABLE tokenless_paid_assignment_operations
       DROP CONSTRAINT tokenless_paid_assignment_operations_opportunity_fk;
     ALTER TABLE tokenless_paid_assignment_operations
       DROP CONSTRAINT tokenless_paid_assignment_operations_api_key_fk;
     ALTER TABLE tokenless_paid_assignment_operations
       DROP CONSTRAINT tokenless_paid_assignment_operations_policy_fk;`,
  );
  await dbClient.execute({
    sql: `INSERT INTO tokenless_paid_assignment_operations
          (operation_id, workspace_id, opportunity_id, lane, api_key_id,
           publishing_policy_id, publishing_policy_version, request_idempotency_key,
           request_hash, prepared_request_hash, economics_hash, reviewer_set_hash,
           audience_policy_hash, chain_admission_policy_hash, admission_policy_json,
           artifact_commitments_json, artifact_binding_hash, expected_amount_atomic,
           state, quote_id, quote_expires_at, created_at, updated_at)
          VALUES ('paid_quote_retention', 'workspace', 'opportunity', 'private_invited_paid',
                  'api_key', 'policy', 1, 'paid:quote:retention', ?, ?, ?, ?, ?, ?,
                  '{}', '[]', ?, 1, 'quote_created', ?, ?, ?, ?)`,
    args: [
      `sha256:${"1".repeat(64)}`,
      `sha256:${"2".repeat(64)}`,
      `sha256:${"3".repeat(64)}`,
      `sha256:${"4".repeat(64)}`,
      `sha256:${"5".repeat(64)}`,
      `0x${"6".repeat(64)}`,
      `sha256:${"7".repeat(64)}`,
      paidOperation.quoteId,
      new Date(paidOperation.expiresAt),
      new Date(),
      new Date(),
    ],
  });
  const now = new Date("2026-07-18T12:00:00.000Z");
  await dbClient.execute({
    sql: "UPDATE tokenless_agent_quotes SET expires_at = ? WHERE quote_id IN (?, ?, ?)",
    args: [new Date(now.getTime() - 1), unused.quoteId, used.quoteId, paidOperation.quoteId],
  });
  assert.deepEqual(await sweepExpiredTokenlessQuotes({ now, limit: 10 }), { deleted: 1, scanned: 1 });
  const remaining = await dbClient.execute({
    sql: "SELECT quote_id FROM tokenless_agent_quotes ORDER BY quote_id ASC",
  });
  assert.deepEqual(remaining.rows.map(row => row.quote_id).sort(), [paidOperation.quoteId, used.quoteId].sort());
});

test("quotes freeze explicit review timing, profile provenance, and economics", async () => {
  const requestProfile = { id: "rrp_server", version: 3, hash: `sha256:${"ab".repeat(32)}` as const };
  const reviewEconomics = { compensationMode: "usdc" as const, bountyPerSeatAtomic: "2500000", panelSize: 15 };
  const quote = await createTokenlessQuote({
    ...quoteRequest(),
    responseWindowSeconds: 7_200,
    requestProfile,
    reviewEconomics,
  });
  assert.equal(quote.responseWindowSeconds, 7_200);
  assert.deepEqual(quote.requestProfile, requestProfile);
  assert.deepEqual(quote.reviewEconomics, reviewEconomics);
  for (const responseWindowSeconds of [undefined, 1_199, 86_401, 3_600.5, "3600"]) {
    await assert.rejects(
      () => createTokenlessQuote({ ...quoteRequest(), responseWindowSeconds }),
      (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_quote",
    );
  }
});

test("quotes canonicalize supported public question media", async () => {
  const quote = await createTokenlessQuote({
    ...quoteRequest(),
    question: {
      ...quoteRequest().question,
      media: {
        kind: "images",
        items: [{ alt: "  Checkout confirmation on mobile  ", assetId: imageAssetId, digest: imageDigest }],
      },
      prompt: "  Ship this?  ",
    },
  });

  const stored = await dbClient.execute({
    sql: "SELECT request_json FROM tokenless_agent_quotes WHERE quote_id = ?",
    args: [quote.quoteId],
  });
  const request = JSON.parse(String(stored.rows[0]?.request_json));
  assert.deepEqual(request.question, {
    kind: "binary",
    media: {
      kind: "images",
      items: [{ alt: "Checkout confirmation on mobile", assetId: imageAssetId, digest: imageDigest }],
    },
    prompt: "Ship this?",
    rationale: { mode: "optional" },
  });
});

test("quotes reject economics that cannot satisfy the panel contract", async () => {
  await assert.rejects(
    () => createTokenlessQuote({ ...quoteRequest(), budget: { ...quoteRequest().budget, bountyAtomic: "0" } }),
    /bountyAtomic must be greater than zero/,
  );
  await assert.rejects(
    () => createTokenlessQuote({ ...quoteRequest(), budget: { ...quoteRequest().budget, attemptReserveAtomic: "14" } }),
    /non-zero compensation cap for every accepted rater/,
  );
});

test("asks reject the removed result-webhook option", async () => {
  const quote = await createTokenlessQuote(quoteRequest());
  const idempotencyKey = "test:ask:no-webhook";
  await assert.rejects(
    () =>
      createTokenlessAsk(
        {
          idempotencyKey,
          payment: { mode: "prepaid", workspaceId: "workspace_test" },
          quoteId: quote.quoteId,
          webhook: { eventTypes: ["result.ready"], url: "https://example.test/hook" },
        },
        idempotencyKey,
        "https://tokenless.example",
      ),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "webhook_unsupported",
  );
});

test("asks are durable and idempotent, remain pending payment, and never synthesize a result", async () => {
  const quote = await createTokenlessQuote(quoteRequest());
  const request = {
    idempotencyKey: "test:ask:live0001",
    payment: { mode: "prepaid" as const, workspaceId: "live" },
    quoteId: quote.quoteId,
  };
  const ask = await createTokenlessAsk(request, request.idempotencyKey, "https://tokenless.example");
  const replay = await createTokenlessAsk(request, request.idempotencyKey, "https://tokenless.example");

  assert.equal(replay.operationKey, ask.operationKey);
  assert.equal(ask.status, "awaiting_payment");
  assert.equal(ask.roundId, null);
  assert.equal(ask.responseWindowSeconds, 3_600);
  assert.equal(ask.commitDeadline, null);
  assert.equal(ask.requestProfile, null);
  assert.equal(ask.reviewEconomics, null);
  assert.deepEqual(replay, ask);
  const staleCursorStartedAt = Date.now();
  const staleCursorWait = await waitForTokenlessAsk(ask.operationKey, "https://tokenless.example", {
    cursor: "0",
    pollIntervalMs: 2,
    timeoutMs: 1_000,
  });
  assert.ok(Date.now() - staleCursorStartedAt < 500);
  assert.equal(staleCursorWait.status, "pending");

  const boundedStartedAt = Date.now();
  const wait = await waitForTokenlessAsk(ask.operationKey, "https://tokenless.example", {
    cursor: ask.continuation.cursor,
    pollIntervalMs: 2,
    timeoutMs: 20,
  });
  const boundedElapsedMs = Date.now() - boundedStartedAt;
  assert.ok(boundedElapsedMs >= 10);
  assert.ok(boundedElapsedMs < 500);
  assert.equal(wait.status, "pending");
  assert.equal(wait.verdictStatus, null);
  await assert.rejects(
    () =>
      waitForTokenlessAsk(ask.operationKey, "https://tokenless.example", {
        cursor: "not-a-server-cursor",
        timeoutMs: 20,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_wait_cursor",
  );
  await assert.rejects(
    () => getTokenlessResult(ask.operationKey),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "result_not_ready" && error.retryable,
  );
});

test("pending operation waits fail closed after their continuation horizon", async () => {
  const quote = await createTokenlessQuote(quoteRequest());
  const idempotencyKey = "test:ask:expired-wait";
  const ask = await createTokenlessAsk(
    { idempotencyKey, payment: { mode: "prepaid", workspaceId: "expired-wait" }, quoteId: quote.quoteId },
    idempotencyKey,
    "https://tokenless.example",
  );
  await dbClient.execute({
    sql: `UPDATE tokenless_agent_asks SET updated_at = ? WHERE operation_key = ?`,
    args: [new Date("2000-01-01T00:00:00.000Z"), ask.operationKey],
  });
  await assert.rejects(
    () =>
      waitForTokenlessAsk(ask.operationKey, "https://tokenless.example", {
        pollIntervalMs: 1,
        timeoutMs: 20,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "operation_wait_expired",
  );
});

test("idempotency conflicts fail closed within a caller scope but cannot be preclaimed across scopes", async () => {
  const quote = await createTokenlessQuote(quoteRequest());
  const idempotencyKey = "test:ask:conflict1";
  const first = await createTokenlessAsk(
    { idempotencyKey, payment: { mode: "prepaid", workspaceId: "one" }, quoteId: quote.quoteId },
    idempotencyKey,
    "https://tokenless.example",
    "workspace:one:api_key:key_a",
  );
  await assert.rejects(
    () =>
      createTokenlessAsk(
        { idempotencyKey, payment: { mode: "prepaid", workspaceId: "two" }, quoteId: quote.quoteId },
        idempotencyKey,
        "https://tokenless.example",
        "workspace:one:api_key:key_a",
      ),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "idempotency_conflict",
  );
  const second = await createTokenlessAsk(
    { idempotencyKey, payment: { mode: "prepaid", workspaceId: "two" }, quoteId: quote.quoteId },
    idempotencyKey,
    "https://tokenless.example",
    "workspace:two:api_key:key_b",
  );
  assert.notEqual(second.operationKey, first.operationKey);
  await assert.rejects(
    () => getTokenlessAskByIdempotencyKey(idempotencyKey),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "ambiguous_idempotency_key",
  );
});

test("ask and quote request validation matches the tokenless SDK contract", async () => {
  await assert.rejects(
    () =>
      createTokenlessQuote({
        ...quoteRequest(),
        question: {
          kind: "head_to_head",
          optionA: { key: "same", label: "A" },
          optionB: { key: "same", label: "B" },
          prompt: "Choose",
          rationale: { mode: "optional" },
        },
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_quote",
  );

  await assert.rejects(
    () =>
      createTokenlessQuote({
        ...quoteRequest(),
        question: {
          ...quoteRequest().question,
          media: {
            kind: "images",
            items: Array.from({ length: 5 }, (_, index) => ({
              alt: `Image ${index + 1}`,
              assetId: `${imageAssetId}${index}`,
              digest: imageDigest,
            })),
          },
        },
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_quote",
  );

  await assert.rejects(
    () =>
      createTokenlessQuote({
        ...quoteRequest(),
        question: {
          ...quoteRequest().question,
          media: { kind: "youtube", videoId: "not-a-video" },
          unknownMediaUrl: "https://example.com/tracker",
        },
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_quote",
  );

  const quote = await createTokenlessQuote(quoteRequest());
  const idempotencyKey = "test:ask:badpay01";
  await assert.rejects(
    () =>
      createTokenlessAsk(
        { idempotencyKey, payment: { mode: "wallet", payerAddress: "not-an-address" }, quoteId: quote.quoteId },
        idempotencyKey,
        "https://tokenless.example",
      ),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_payment",
  );
});

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  TokenlessServiceError,
  createTokenlessAsk,
  createTokenlessQuote,
  getTokenlessResult,
  isTokenlessSandboxMode,
  waitForTokenlessAsk,
} from "~~/lib/tokenless/server";

const originalSandboxMode = process.env.TOKENLESS_SANDBOX_MODE;

beforeEach(() => {
  process.env.TOKENLESS_SANDBOX_MODE = "true";
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
  if (originalSandboxMode === undefined) delete process.env.TOKENLESS_SANDBOX_MODE;
  else process.env.TOKENLESS_SANDBOX_MODE = originalSandboxMode;
});

function quoteRequest() {
  return {
    audience: { tierId: "passport" },
    budget: { attemptReserveAtomic: "5000000", bountyAtomic: "25000000", feeBps: 750 },
    question: { kind: "binary", prompt: "Ship this?", rationale: { mode: "optional" } },
    requestedPanelSize: 15,
  };
}

test("tokenless quote itemizes bounty, fee, reserve, refund, and compensation", async () => {
  const quote = await createTokenlessQuote(quoteRequest());

  assert.equal(quote.schemaVersion, "rateloop.tokenless.v1");
  assert.equal(quote.economics.bounty.fundedAtomic, "25000000");
  assert.equal(quote.economics.fee.fundedAtomic, "1875000");
  assert.equal(quote.economics.attemptReserve.fundedAtomic, "5000000");
  assert.equal(quote.economics.refund.totalAtomic, "0");
  assert.equal(quote.economics.compensation.perAcceptedRevealCapAtomic, "333333");
  assert.equal(quote.economics.totalFundedAtomic, "31875000");
});

test("sandbox asks are durable, idempotent, and expose exact result accounting", async () => {
  const quote = await createTokenlessQuote(quoteRequest());
  const request = {
    idempotencyKey: "test:ask:12345678",
    payment: { mode: "prepaid" as const, workspaceId: "sandbox" },
    quoteId: quote.quoteId,
  };
  const first = await createTokenlessAsk(request, request.idempotencyKey, "https://tokenless.example");
  const replay = await createTokenlessAsk(request, request.idempotencyKey, "https://tokenless.example");

  assert.equal(replay.operationKey, first.operationKey);
  assert.equal(first.status, "open");
  const wait = await waitForTokenlessAsk(first.operationKey, "https://tokenless.example");
  assert.equal(wait.status, "ready");
  assert.equal(wait.verdictStatus, "published");
  const result = await getTokenlessResult(first.operationKey);
  assert.equal(result.verdictStatus, "published");
  assert.equal(result.economics.attemptReserve.refundedAtomic, "5000000");
  assert.equal(result.economics.refund.totalAtomic, "5000000");
  assert.equal(result.economics.compensation.totalAtomic, "0");
  assert.equal(result.methodologyUrl, "https://tokenless.example/docs/how-it-works#sandbox-limitations");
});

test("live asks remain pending payment and never synthesize a result", async () => {
  process.env.TOKENLESS_SANDBOX_MODE = "false";
  const quote = await createTokenlessQuote(quoteRequest());
  const request = {
    idempotencyKey: "test:ask:live0001",
    payment: { mode: "prepaid" as const, workspaceId: "live" },
    quoteId: quote.quoteId,
  };
  const ask = await createTokenlessAsk(request, request.idempotencyKey, "https://tokenless.example");

  assert.equal(ask.status, "awaiting_payment");
  assert.equal(ask.roundId, null);
  const wait = await waitForTokenlessAsk(ask.operationKey, "https://tokenless.example");
  assert.equal(wait.status, "pending");
  assert.equal(wait.verdictStatus, null);
  await assert.rejects(
    () => getTokenlessResult(ask.operationKey),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "result_not_ready" && error.retryable,
  );
});

test("idempotency conflicts and sandbox configuration fail closed", async () => {
  const quote = await createTokenlessQuote(quoteRequest());
  const idempotencyKey = "test:ask:conflict1";
  await createTokenlessAsk(
    { idempotencyKey, payment: { mode: "prepaid", workspaceId: "one" }, quoteId: quote.quoteId },
    idempotencyKey,
    "https://tokenless.example",
  );
  await assert.rejects(
    () =>
      createTokenlessAsk(
        { idempotencyKey, payment: { mode: "prepaid", workspaceId: "two" }, quoteId: quote.quoteId },
        idempotencyKey,
        "https://tokenless.example",
      ),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "idempotency_conflict",
  );

  process.env.TOKENLESS_SANDBOX_MODE = "yes";
  assert.throws(() => isTokenlessSandboxMode(), /must be exactly true or false/);
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

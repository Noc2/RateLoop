import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { TokenlessMcpToolError } from "~~/lib/mcp/errors";
import {
  type TokenlessHandoffPayload,
  createMcpHandoff,
  deriveMcpHandoffIdempotencyKey,
  getMcpHandoffResult,
  getMcpHandoffStatus,
} from "~~/lib/mcp/handoff";
import { createTokenlessAsk, createTokenlessQuote } from "~~/lib/tokenless/server";

const originalSandboxMode = process.env.TOKENLESS_SANDBOX_MODE;
const imageAssetId = `pqm_${"A".repeat(24)}`;
const imageDigest = `sha256:${"a1".repeat(32)}`;

function quoteRequest(source: "customer_invited" | "sandbox" = "customer_invited") {
  return {
    audience: { admissionPolicyHash: `0x${"ab".repeat(32)}`, source },
    budget: { attemptReserveAtomic: "5000000", bountyAtomic: "25000000", feeBps: 750 },
    question: {
      kind: "binary" as const,
      prompt: "Should this workflow output be approved?",
      rationale: { mode: "optional" as const },
    },
    requestedPanelSize: 15,
  };
}

function handoffArguments(source: "customer_invited" | "sandbox" = "customer_invited") {
  return {
    confirmedNoSensitiveData: true,
    dataClassification: "redacted",
    redactionSummary: "Customer identifiers and confidential inputs were removed.",
    request: quoteRequest(source),
  };
}

function decodePayload(handoffUrl: string) {
  const url = new URL(handoffUrl);
  return JSON.parse(
    Buffer.from(url.hash.slice("#payload=".length), "base64url").toString("utf8"),
  ) as TokenlessHandoffPayload;
}

beforeEach(() => {
  process.env.TOKENLESS_SANDBOX_MODE = "false";
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
  if (originalSandboxMode === undefined) delete process.env.TOKENLESS_SANDBOX_MODE;
  else process.env.TOKENLESS_SANDBOX_MODE = originalSandboxMode;
});

test("creates a 24-hour fragment-only bearer handoff without persisting raw capability data", async () => {
  const now = new Date("2026-07-13T12:00:00.000Z");
  let fill = 1;
  const handoff = createMcpHandoff(handoffArguments(), "https://rateloop-tokenless.vercel.app", {
    now,
    random: size => Buffer.alloc(size, fill++),
  });
  const url = new URL(handoff.handoffUrl);
  const payload = decodePayload(handoff.handoffUrl);

  assert.equal(url.origin, "https://rateloop-tokenless.vercel.app");
  assert.equal(url.pathname, "/handoff");
  assert.equal(url.search, "");
  assert.match(url.hash, /^#payload=[A-Za-z0-9_-]+$/);
  assert.match(handoff.handoffId, /^rhl_[A-Za-z0-9_-]{32}$/);
  assert.match(handoff.handoffToken, /^rht_[A-Za-z0-9_-]{43}_[0-9a-z]{6,12}$/);
  assert.equal(handoff.expiresAt, "2026-07-14T12:00:00.000Z");
  assert.deepEqual(Object.keys(payload), [
    "version",
    "handoffId",
    "handoffToken",
    "idempotencyKey",
    "expiresAt",
    "dataClassification",
    "redactionSummary",
    "request",
  ]);
  assert.equal(payload.version, "rateloop.handoff.v1");
  assert.equal(payload.handoffId, handoff.handoffId);
  assert.equal(payload.handoffToken, handoff.handoffToken);
  assert.equal(
    payload.idempotencyKey,
    deriveMcpHandoffIdempotencyKey({ handoffId: handoff.handoffId, handoffToken: handoff.handoffToken }),
  );
  assert.deepEqual(payload.request, {
    ...quoteRequest(),
    visibility: "public",
    dataClassification: "redacted",
    redactionSummary: "Customer identifiers and confidential inputs were removed.",
    confirmedNoSensitiveData: true,
  });
  assert.ok(Buffer.byteLength(url.hash, "utf8") <= 16 * 1_024);

  const asks = await dbClient.execute("SELECT COUNT(*) AS count FROM tokenless_agent_asks");
  assert.equal(Number(asks.rows[0]?.count), 0);
});

test("preserves canonical question media in the browser handoff", () => {
  const argumentsWithMedia = {
    ...handoffArguments(),
    request: {
      ...quoteRequest(),
      question: {
        ...quoteRequest().question,
        media: {
          kind: "images" as const,
          items: [{ alt: "  Candidate landing page  ", assetId: imageAssetId, digest: imageDigest }],
        },
      },
    },
  };

  const handoff = createMcpHandoff(argumentsWithMedia, "https://rateloop-tokenless.vercel.app");
  const payload = decodePayload(handoff.handoffUrl);
  assert.deepEqual(payload.request.question.media, {
    kind: "images",
    items: [{ alt: "Candidate landing page", assetId: imageAssetId, digest: imageDigest }],
  });
});

test("enforces content confirmation, privacy limits, quote limits, and environment source", () => {
  assert.throws(
    () =>
      createMcpHandoff(
        { ...handoffArguments(), confirmedNoSensitiveData: false },
        "https://rateloop-tokenless.vercel.app",
      ),
    (error: unknown) => error instanceof TokenlessMcpToolError && error.code === "sensitive_data_confirmation_required",
  );
  assert.throws(
    () =>
      createMcpHandoff(
        { ...handoffArguments(), redactionSummary: "too short" },
        "https://rateloop-tokenless.vercel.app",
      ),
    /redactionSummary must contain 10-1000 characters/,
  );
  assert.throws(
    () =>
      createMcpHandoff(
        {
          ...handoffArguments(),
          request: {
            ...quoteRequest(),
            question: { ...quoteRequest().question, positiveLabel: "x".repeat(201) },
          },
        },
        "https://rateloop-tokenless.vercel.app",
      ),
    /positiveLabel must contain 1-200 characters/,
  );
  assert.throws(
    () =>
      createMcpHandoff(
        {
          ...handoffArguments(),
          request: { ...quoteRequest(), question: { ...quoteRequest().question, prompt: "x".repeat(4_001) } },
        },
        "https://rateloop-tokenless.vercel.app",
      ),
    /prompt must contain 1-4000 characters/,
  );
  assert.throws(
    () =>
      createMcpHandoff(
        {
          ...handoffArguments(),
          request: {
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
          },
        },
        "https://rateloop-tokenless.vercel.app",
      ),
    /must contain 1-4 images/,
  );
  assert.throws(
    () => createMcpHandoff(handoffArguments("sandbox"), "https://rateloop-tokenless.vercel.app"),
    (error: unknown) => error instanceof TokenlessMcpToolError && error.code === "audience_environment_mismatch",
  );
});

test("status and result reads map the capability to ask idempotency without reconciling", async () => {
  process.env.TOKENLESS_SANDBOX_MODE = "true";
  const handoff = createMcpHandoff(handoffArguments("sandbox"), "https://rateloop-tokenless.vercel.app");
  const access = { handoffId: handoff.handoffId, handoffToken: handoff.handoffToken };
  const payload = decodePayload(handoff.handoffUrl);

  assert.deepEqual(await getMcpHandoffStatus(access), {
    handoffId: handoff.handoffId,
    operationKey: null,
    status: "prepared",
    updatedAt: null,
    verdictStatus: null,
  });
  assert.deepEqual(await getMcpHandoffResult(access), {
    handoffId: handoff.handoffId,
    operationKey: null,
    result: null,
    status: "prepared",
  });

  const quote = await createTokenlessQuote(payload.request);
  const ask = await createTokenlessAsk(
    {
      idempotencyKey: payload.idempotencyKey,
      payment: { mode: "prepaid", workspaceId: "sandbox" },
      quoteId: quote.quoteId,
    },
    payload.idempotencyKey,
    "https://rateloop-tokenless.vercel.app",
  );
  const beforeRead = await dbClient.execute({
    sql: "SELECT status, updated_at FROM tokenless_agent_asks WHERE operation_key = ?",
    args: [ask.operationKey],
  });
  const readyStatus = await getMcpHandoffStatus(access);
  const result = await getMcpHandoffResult(access);
  const afterRead = await dbClient.execute({
    sql: "SELECT status, updated_at FROM tokenless_agent_asks WHERE operation_key = ?",
    args: [ask.operationKey],
  });
  assert.equal(readyStatus.operationKey, ask.operationKey);
  assert.equal(readyStatus.status, "ready");
  assert.equal(readyStatus.verdictStatus, "published");
  assert.equal(result.status, "ready");
  assert.equal(result.result?.verdictStatus, "published");
  assert.deepEqual(afterRead.rows, beforeRead.rows);
});

test("expired bearer capabilities fail closed", async () => {
  const now = new Date("2026-07-13T12:00:00.000Z");
  const handoff = createMcpHandoff(handoffArguments(), "https://rateloop-tokenless.vercel.app", { now });
  await assert.rejects(
    () =>
      getMcpHandoffStatus(
        { handoffId: handoff.handoffId, handoffToken: handoff.handoffToken },
        { now: new Date("2026-07-14T12:00:01.000Z") },
      ),
    (error: unknown) => error instanceof TokenlessMcpToolError && error.code === "handoff_expired",
  );
});

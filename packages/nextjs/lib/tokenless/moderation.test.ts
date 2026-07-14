import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { moderateTokenlessOperation } from "~~/lib/tokenless/moderation";
import {
  attachProductAsk,
  createWorkspace,
  prepareProductAsk,
  recordPrepaidLedgerEntry,
} from "~~/lib/tokenless/productCore";
import {
  TokenlessServiceError,
  createTokenlessAsk,
  createTokenlessQuote,
  waitForTokenlessAsk,
} from "~~/lib/tokenless/server";

const OWNER = "0x1111111111111111111111111111111111111111";
const originalSandbox = process.env.TOKENLESS_SANDBOX_MODE;

beforeEach(() => {
  process.env.TOKENLESS_SANDBOX_MODE = "false";
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
  if (originalSandbox === undefined) delete process.env.TOKENLESS_SANDBOX_MODE;
  else process.env.TOKENLESS_SANDBOX_MODE = originalSandbox;
});

async function prepaidAsk() {
  const { workspaceId } = await createWorkspace({ name: "Moderation", ownerAddress: OWNER });
  await recordPrepaidLedgerEntry({ workspaceId, amountAtomic: "100000000", source: "invoice" });
  const quote = await createTokenlessQuote({
    audience: {
      admissionPolicyHash: `0x${"ab".repeat(32)}`,
      source: "customer_invited",
    },
    budget: { attemptReserveAtomic: "5000000", bountyAtomic: "25000000", feeBps: 750 },
    question: { kind: "binary" as const, prompt: "Is this safe?", rationale: { mode: "optional" as const } },
    requestedPanelSize: 15,
  });
  const request = {
    idempotencyKey: "moderation:test:12345678",
    payment: { mode: "prepaid" as const, workspaceId },
    quoteId: quote.quoteId,
  };
  const prepared = await prepareProductAsk({ principal: { kind: "session", accountAddress: OWNER }, request });
  const ask = await createTokenlessAsk(request, request.idempotencyKey, "https://tokenless.example");
  await attachProductAsk(prepared, ask);
  return { ask, prepared };
}

test("approval unblocks funding without changing its reservation", async () => {
  const { ask, prepared } = await prepaidAsk();
  const now = new Date("2026-07-14T12:00:00.000Z");
  await dbClient.execute({
    sql: `INSERT INTO tokenless_public_question_media
          (asset_id, workspace_id, owner_account_address, client_request_id, question_id, digest, storage_ref,
           content_type, original_filename, size_bytes, width, height, technical_status, moderation_status,
           expires_at, bound_at, created_at, updated_at)
          VALUES (?, ?, ?, 'moderation:test:image', ?, ?, 'memory://image', 'image/webp', 'image.webp',
                  100, 10, 10, 'ready', 'pending', ?, ?, ?, ?)`,
    args: [
      `pqm_${"A".repeat(32)}`,
      prepared.workspaceId,
      OWNER,
      prepared.questionId,
      `sha256:${"ab".repeat(32)}`,
      new Date("2026-07-15T12:00:00.000Z"),
      now,
      now,
      now,
    ],
  });
  const result = await moderateTokenlessOperation({
    operationKey: ask.operationKey,
    decision: "approved",
    reasonCode: "policy_clear",
  });
  assert.deepEqual(result, { decision: "approved", terminal: false, acceptedWorkPreserved: false });
  const content = await dbClient.execute("SELECT moderation_status FROM tokenless_content_records");
  const reservation = await dbClient.execute({
    sql: "SELECT status FROM tokenless_prepaid_reservations WHERE reservation_id = ?",
    args: [prepared.paymentReference],
  });
  const media = await dbClient.execute(
    "SELECT moderation_status, moderation_reason FROM tokenless_public_question_media",
  );
  assert.equal(content.rows[0]?.moderation_status, "approved");
  assert.deepEqual(media.rows, [{ moderation_status: "approved", moderation_reason: "policy_clear" }]);
  assert.equal(reservation.rows[0]?.status, "reserved");
});

test("pre-round rejection releases funding and gives pollers a terminal error", async () => {
  const { ask, prepared } = await prepaidAsk();
  await moderateTokenlessOperation({
    operationKey: ask.operationKey,
    decision: "rejected",
    reasonCode: "unsafe_content",
  });
  const reservation = await dbClient.execute({
    sql: "SELECT status FROM tokenless_prepaid_reservations WHERE reservation_id = ?",
    args: [prepared.paymentReference],
  });
  assert.equal(reservation.rows[0]?.status, "released");
  await assert.rejects(
    () => waitForTokenlessAsk(ask.operationKey, "https://tokenless.example"),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "content_rejected",
  );
});

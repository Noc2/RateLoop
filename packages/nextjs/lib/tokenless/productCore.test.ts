import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  attachProductAsk,
  authenticateProductPrincipal,
  authorizeAskAccess,
  createManagedWorkspaceApiKey,
  createWorkspace,
  createWorkspaceApiKey,
  listProductWorkspaces,
  listWorkspaceApiKeys,
  prepareProductAsk,
  recordPrepaidLedgerEntry,
  revokeWorkspaceApiKey,
} from "~~/lib/tokenless/productCore";
import { TokenlessServiceError, createTokenlessAsk, createTokenlessQuote } from "~~/lib/tokenless/server";

const ADDRESS_A = "0x1111111111111111111111111111111111111111";
const ADDRESS_B = "0x2222222222222222222222222222222222222222";
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
    question: { kind: "binary" as const, prompt: "Ship this?", rationale: { mode: "optional" as const } },
    requestedPanelSize: 15,
  };
}

async function workspaceWithKey(ownerAddress = ADDRESS_A) {
  const { workspaceId } = await createWorkspace({ name: "Acme", ownerAddress });
  const key = await createWorkspaceApiKey({ workspaceId, name: "CI" });
  return { workspaceId, ...key };
}

async function quoteAndRequest(workspaceId: string, idempotencyKey = "product:test:12345678") {
  const quote = await createTokenlessQuote(quoteRequest());
  return {
    quote,
    request: {
      idempotencyKey,
      payment: { mode: "prepaid" as const, workspaceId },
      quoteId: quote.quoteId,
    },
  };
}

test("API keys are stored as hashes and resolve only their active workspace role", async () => {
  const { workspaceId, token } = await workspaceWithKey();
  const principal = await authenticateProductPrincipal({ authorization: `Bearer ${token}`, sessionToken: undefined });
  assert.equal(principal.kind, "api_key");
  assert.equal(principal.workspaceId, workspaceId);

  const rows = await dbClient.execute("SELECT key_hash FROM tokenless_workspace_api_keys");
  assert.notEqual(String(rows.rows[0]?.key_hash), token);
  await assert.rejects(
    () => authenticateProductPrincipal({ authorization: `${token}`, sessionToken: undefined }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_api_key",
  );
});

test("prepaid asks fail closed when only pending or insufficient funds exist", async () => {
  const { workspaceId, apiKeyId } = await workspaceWithKey();
  const { request } = await quoteAndRequest(workspaceId);
  const principal = { kind: "api_key" as const, apiKeyId, workspaceId, role: "member" as const };

  await recordPrepaidLedgerEntry({ workspaceId, amountAtomic: "50000000", source: "invoice", settled: false });
  await assert.rejects(
    () => prepareProductAsk({ principal, request }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "insufficient_prepaid_balance",
  );
  await recordPrepaidLedgerEntry({ workspaceId, amountAtomic: "10000000", source: "invoice" });
  await assert.rejects(
    () => prepareProductAsk({ principal, request }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "insufficient_prepaid_balance",
  );
});

test("settled prepaid funds reserve idempotently and conflicting economics fail", async () => {
  const { workspaceId, apiKeyId } = await workspaceWithKey();
  await recordPrepaidLedgerEntry({ workspaceId, amountAtomic: "100000000", source: "invoice" });
  const { request } = await quoteAndRequest(workspaceId);
  const principal = { kind: "api_key" as const, apiKeyId, workspaceId, role: "member" as const };
  const first = await prepareProductAsk({ principal, request });
  const replay = await prepareProductAsk({ principal, request });
  assert.equal(replay.paymentReference, first.paymentReference);
  assert.equal(replay.createdPayment, false);

  await dbClient.execute({
    sql: "UPDATE tokenless_prepaid_reservations SET amount_atomic = ? WHERE reservation_id = ?",
    args: ["1", first.paymentReference],
  });
  await assert.rejects(
    () => prepareProductAsk({ principal, request }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "payment_conflict",
  );
});

test("ask ownership is bound to its workspace for wait and result authorization", async () => {
  const firstWorkspace = await workspaceWithKey(ADDRESS_A);
  const secondWorkspace = await workspaceWithKey(ADDRESS_B);
  await recordPrepaidLedgerEntry({
    workspaceId: firstWorkspace.workspaceId,
    amountAtomic: "100000000",
    source: "invoice",
  });
  const { request } = await quoteAndRequest(firstWorkspace.workspaceId);
  const firstPrincipal = {
    kind: "api_key" as const,
    apiKeyId: firstWorkspace.apiKeyId,
    workspaceId: firstWorkspace.workspaceId,
    role: "member" as const,
  };
  const prepared = await prepareProductAsk({ principal: firstPrincipal, request });
  const ask = await createTokenlessAsk(request, request.idempotencyKey, "https://tokenless.example");
  await attachProductAsk(prepared, ask);
  await authorizeAskAccess(firstPrincipal, ask.operationKey);
  await assert.rejects(
    () =>
      authorizeAskAccess(
        {
          kind: "api_key",
          apiKeyId: secondWorkspace.apiKeyId,
          workspaceId: secondWorkspace.workspaceId,
          role: "member",
        },
        ask.operationKey,
      ),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "ask_not_found",
  );
});

test("wallet payment intents require the signed-in Base Account to be the payer", async () => {
  const { workspaceId } = await createWorkspace({ name: "Personal", ownerAddress: ADDRESS_A });
  const quote = await createTokenlessQuote(quoteRequest());
  await assert.rejects(
    () =>
      prepareProductAsk({
        principal: { kind: "session", accountAddress: ADDRESS_A },
        request: {
          idempotencyKey: "wallet:test:12345678",
          payment: { mode: "wallet", payerAddress: ADDRESS_B },
          quoteId: quote.quoteId,
        },
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "payer_mismatch",
  );

  const prepared = await prepareProductAsk({
    principal: { kind: "session", accountAddress: ADDRESS_A },
    request: {
      idempotencyKey: "wallet:test:abcdefgh",
      payment: { mode: "wallet", payerAddress: ADDRESS_A },
      quoteId: quote.quoteId,
    },
  });
  assert.equal(prepared.workspaceId, workspaceId);
  assert.equal(prepared.paymentState, "pending_user_signature");
});

test("workspace management returns exact available prepaid balance and never exposes API key secrets", async () => {
  const { workspaceId } = await createWorkspace({ name: "Product team", ownerAddress: ADDRESS_A });
  await recordPrepaidLedgerEntry({ workspaceId, amountAtomic: "50000000", source: "invoice" });
  const quote = await createTokenlessQuote(quoteRequest());
  await prepareProductAsk({
    principal: { kind: "session", accountAddress: ADDRESS_A },
    request: {
      idempotencyKey: "workspace:reserve:12345678",
      payment: { mode: "prepaid", workspaceId },
      quoteId: quote.quoteId,
    },
  });
  const workspaces = await listProductWorkspaces(ADDRESS_A);
  assert.deepEqual(workspaces[0]?.prepaid, {
    settledAtomic: "50000000",
    reservedAtomic: quote.economics.totalFundedAtomic,
    availableAtomic: (50_000_000n - BigInt(quote.economics.totalFundedAtomic)).toString(),
  });

  const created = await createManagedWorkspaceApiKey({
    accountAddress: ADDRESS_A,
    workspaceId,
    name: "Production agent",
  });
  assert.match(created.token, /^rlk_/);
  const listed = await listWorkspaceApiKeys({ accountAddress: ADDRESS_A, workspaceId });
  assert.equal(listed[0]?.apiKeyId, created.apiKeyId);
  assert.equal("token" in listed[0]!, false);
  await revokeWorkspaceApiKey({ accountAddress: ADDRESS_A, workspaceId, apiKeyId: created.apiKeyId });
  assert.ok((await listWorkspaceApiKeys({ accountAddress: ADDRESS_A, workspaceId }))[0]?.revokedAt);
});

test("workspace API-key management is hidden from non-members", async () => {
  const { workspaceId } = await createWorkspace({ name: "Private team", ownerAddress: ADDRESS_A });
  await assert.rejects(
    () => listWorkspaceApiKeys({ accountAddress: ADDRESS_B, workspaceId }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "workspace_not_found",
  );
});

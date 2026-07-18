import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  decodeTokenlessHandoffFragment,
  validateTokenlessQuoteRequest,
} from "~~/components/tokenless/TokenlessHandoffClient";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { createMcpHandoff } from "~~/lib/mcp/handoff";
import {
  __productCoreTestUtils,
  attachProductAsk,
  authenticateProductPrincipal,
  authorizeAskAccess,
  authorizeAskPaymentMutation,
  createAgentPublishingPolicy,
  createWorkspace,
  createWorkspaceApiKey,
  listProductWorkspaces,
  normalizedX402Authorization,
  prepareProductAsk,
  recordPrepaidLedgerEntry,
  revokeAgentPublishingPolicy,
} from "~~/lib/tokenless/productCore";
import { TokenlessServiceError, createTokenlessAsk, createTokenlessQuote } from "~~/lib/tokenless/server";

const ADDRESS_A: `0x${string}` = "0x1111111111111111111111111111111111111111";
const ADDRESS_B: `0x${string}` = "0x2222222222222222222222222222222222222222";

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
});

function quoteRequest() {
  return {
    audience: {
      admissionPolicyHash: `0x${"ab".repeat(32)}`,
      source: "customer_invited",
    },
    budget: { attemptReserveAtomic: "5000000", bountyAtomic: "25000000", feeBps: 750 },
    question: { kind: "binary" as const, prompt: "Ship this?", rationale: { mode: "optional" as const } },
    requestedPanelSize: 15,
    responseWindowSeconds: 1_200,
  };
}

async function workspaceWithKey(ownerAddress = ADDRESS_A) {
  const { workspaceId } = await createWorkspace({ name: "Acme", ownerAddress });
  await activateEarlyAccess(workspaceId);
  const key = await createWorkspaceApiKey({ workspaceId, name: "CI" });
  return { workspaceId, ...key };
}

async function activateEarlyAccess(workspaceId: string) {
  const now = new Date();
  await dbClient.execute({
    sql: `UPDATE tokenless_workspace_subscriptions
          SET plan_key = 'early_access', price_version = 'early_access_usd_99_2026_07',
              provider_status = 'active', current_period_start = ?, current_period_end = ?, updated_at = ?
          WHERE workspace_id = ?`,
    args: [new Date(now.getTime() - 60_000), new Date(now.getTime() + 86_400_000), now, workspaceId],
  });
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

test("ordered media descriptors change the immutable question hash", () => {
  const first = { assetId: `pqm_${"A".repeat(24)}`, digest: `sha256:${"a".repeat(64)}`, alt: "Current" };
  const second = { assetId: `pqm_${"B".repeat(24)}`, digest: `sha256:${"b".repeat(64)}`, alt: "Candidate" };
  const question = {
    kind: "binary",
    media: { kind: "images", items: [first, second] },
    prompt: "Which image should ship?",
    rationale: { mode: "optional" },
  };
  const baseline = __productCoreTestUtils().hashJson(question);
  assert.notEqual(
    __productCoreTestUtils().hashJson({ ...question, media: { ...question.media, items: [second, first] } }),
    baseline,
  );
  assert.notEqual(
    __productCoreTestUtils().hashJson({
      ...question,
      media: { ...question.media, items: [{ ...first, alt: "Changed" }, second] },
    }),
    baseline,
  );
  assert.notEqual(
    __productCoreTestUtils().hashJson({
      ...question,
      media: { ...question.media, items: [{ ...first, digest: `sha256:${"c".repeat(64)}` }, second] },
    }),
    baseline,
  );
  assert.notEqual(
    __productCoreTestUtils().hashJson({ ...question, media: { kind: "youtube", videoId: "dQw4w9WgXcQ" } }),
    baseline,
  );
});

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

test("Free workspaces cannot prepare production paid-panel asks", async () => {
  const { workspaceId } = await createWorkspace({ name: "Free asks", ownerAddress: ADDRESS_A });
  const { request } = await quoteAndRequest(workspaceId, "free:paid-panel:12345678");
  await assert.rejects(
    () => prepareProductAsk({ principal: { kind: "session", accountAddress: ADDRESS_A }, request }),
    (error: unknown) =>
      error instanceof TokenlessServiceError &&
      error.code === "plan_limit_reached" &&
      "limitType" in error &&
      error.limitType === "paid_panels",
  );
  const mutations = await dbClient.execute(
    "SELECT (SELECT COUNT(*) FROM tokenless_question_records) AS questions, (SELECT COUNT(*) FROM tokenless_prepaid_reservations) AS reservations",
  );
  assert.equal(Number(mutations.rows[0]?.questions), 0);
  assert.equal(Number(mutations.rows[0]?.reservations), 0);
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

test("payment mutation requires the submitting scope and the creating API key", async () => {
  const workspace = await workspaceWithKey(ADDRESS_A);
  const resultsOnly = await createWorkspaceApiKey({
    workspaceId: workspace.workspaceId,
    name: "Results reader",
    scopes: ["result:read"],
  });
  const unrelatedSubmitter = await createWorkspaceApiKey({
    workspaceId: workspace.workspaceId,
    name: "Unrelated payment submitter",
    scopes: ["payment:submit", "result:read"],
  });
  await recordPrepaidLedgerEntry({
    workspaceId: workspace.workspaceId,
    amountAtomic: "100000000",
    source: "invoice",
  });
  const { request } = await quoteAndRequest(workspace.workspaceId, "payment:authorization:12345678");
  const creator = await authenticateProductPrincipal({
    authorization: `Bearer ${workspace.token}`,
    sessionToken: undefined,
  });
  if (creator.kind !== "api_key") assert.fail("expected an API-key principal");
  const prepared = await prepareProductAsk({ principal: creator, request });
  const ask = await createTokenlessAsk(request, request.idempotencyKey, "https://tokenless.example");
  await attachProductAsk(prepared, ask);

  for (const key of [resultsOnly, unrelatedSubmitter]) {
    const principal = await authenticateProductPrincipal({
      authorization: `Bearer ${key.token}`,
      sessionToken: undefined,
    });
    await assert.rejects(
      () => authorizeAskPaymentMutation(principal, ask.operationKey),
      (error: unknown) => error instanceof TokenlessServiceError && error.code === "ask_not_found",
    );
  }

  await assert.rejects(
    () => authorizeAskPaymentMutation({ ...creator, scopes: ["result:read"] }, ask.operationKey),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "insufficient_scope",
  );
  await authorizeAskPaymentMutation(creator, ask.operationKey);
});

test("production prepaid asks keep reservations payment-gated and attach idempotently", async () => {
  const workspace = await workspaceWithKey(ADDRESS_A);
  await recordPrepaidLedgerEntry({ workspaceId: workspace.workspaceId, amountAtomic: "100000000", source: "invoice" });
  const { quote, request } = await quoteAndRequest(workspace.workspaceId, "prepaid:pending:12345678");
  const principal = {
    kind: "api_key" as const,
    apiKeyId: workspace.apiKeyId,
    workspaceId: workspace.workspaceId,
    role: "member" as const,
  };
  const prepared = await prepareProductAsk({ principal, request });
  assert.equal((await listProductWorkspaces(ADDRESS_A))[0]?.prepaid.reservedAtomic, quote.economics.totalFundedAtomic);
  const ask = await createTokenlessAsk(request, request.idempotencyKey, "https://tokenless.example");

  await attachProductAsk(prepared, ask);
  await attachProductAsk(prepared, ask);
  const firstState = await dbClient.execute({
    sql: `SELECT r.status, r.operation_key, o.payment_state
          FROM tokenless_prepaid_reservations r
          JOIN tokenless_ask_ownership o ON o.payment_reference = r.reservation_id
          WHERE r.reservation_id = ?`,
    args: [prepared.paymentReference],
  });
  assert.deepEqual(firstState.rows[0], {
    operation_key: ask.operationKey,
    payment_state: "reserved",
    status: "reserved",
  });
  assert.deepEqual((await listProductWorkspaces(ADDRESS_A))[0]?.prepaid, {
    settledAtomic: "100000000",
    reservedAtomic: quote.economics.totalFundedAtomic,
    availableAtomic: (100_000_000n - BigInt(quote.economics.totalFundedAtomic)).toString(),
  });

  const replayPrepared = await prepareProductAsk({ principal, request });
  const replayAsk = await createTokenlessAsk(request, request.idempotencyKey, "https://tokenless.example");
  assert.equal(replayAsk.operationKey, ask.operationKey);
  await attachProductAsk(replayPrepared, replayAsk);
  const replayState = await dbClient.execute({
    sql: `SELECT status, operation_key FROM tokenless_prepaid_reservations WHERE reservation_id = ?`,
    args: [prepared.paymentReference],
  });
  assert.deepEqual(replayState.rows[0], { operation_key: ask.operationKey, status: "reserved" });
  assert.equal((await listProductWorkspaces(ADDRESS_A))[0]?.prepaid.reservedAtomic, quote.economics.totalFundedAtomic);
});

test("production wallet asks remain pending until the purpose-bound payment is confirmed", async () => {
  const principalId = "rlp_pending_wallet_principal";
  const { workspaceId } = await createWorkspace({ name: "Pending wallet", ownerAddress: principalId });
  await activateEarlyAccess(workspaceId);
  const quote = await createTokenlessQuote(quoteRequest());
  const request = {
    idempotencyKey: "wallet:pending:12345678",
    payment: { mode: "wallet" as const, payerAddress: ADDRESS_A },
    quoteId: quote.quoteId,
  };
  const principal = {
    kind: "session" as const,
    accountAddress: principalId,
    walletAddress: ADDRESS_A,
  };
  const prepared = await prepareProductAsk({ principal, request });
  const ask = await createTokenlessAsk(request, request.idempotencyKey, "https://tokenless.example");

  await attachProductAsk(prepared, ask);
  await attachProductAsk(prepared, ask);
  const state = await dbClient.execute({
    sql: `SELECT p.state, p.operation_key, o.payment_state
          FROM tokenless_payment_intents p
          JOIN tokenless_ask_ownership o ON o.payment_reference = p.payment_intent_id
          WHERE p.payment_intent_id = ?`,
    args: [prepared.paymentReference],
  });
  assert.deepEqual(state.rows[0], {
    operation_key: ask.operationKey,
    payment_state: "pending_user_signature",
    state: "pending_user_signature",
  });
  assert.deepEqual((await listProductWorkspaces(principalId))[0]?.prepaid, {
    settledAtomic: "0",
    reservedAtomic: "0",
    availableAtomic: "0",
  });

  const replayPrepared = await prepareProductAsk({ principal, request });
  await attachProductAsk(replayPrepared, ask);
  const replay = await dbClient.execute({
    sql: `SELECT state, operation_key FROM tokenless_payment_intents WHERE payment_intent_id = ?`,
    args: [prepared.paymentReference],
  });
  assert.deepEqual(replay.rows[0], { operation_key: ask.operationKey, state: "pending_user_signature" });
  assert.equal(workspaceId, prepared.workspaceId);
});

test("wallet payment intents require the purpose-bound funding wallet to be the payer", async () => {
  const principalId = "rlp_wallet_test_principal_0001";
  const { workspaceId } = await createWorkspace({ name: "Personal", ownerAddress: principalId });
  await activateEarlyAccess(workspaceId);
  const quote = await createTokenlessQuote(quoteRequest());
  await assert.rejects(
    () =>
      prepareProductAsk({
        principal: { kind: "session", accountAddress: principalId, walletAddress: ADDRESS_A },
        request: {
          idempotencyKey: "wallet:test:12345678",
          payment: { mode: "wallet", payerAddress: ADDRESS_B },
          quoteId: quote.quoteId,
        },
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "payer_mismatch",
  );

  const prepared = await prepareProductAsk({
    principal: { kind: "session", accountAddress: principalId, walletAddress: ADDRESS_A },
    request: {
      idempotencyKey: "wallet:test:abcdefgh",
      payment: { mode: "wallet", payerAddress: ADDRESS_A },
      quoteId: quote.quoteId,
    },
  });
  assert.equal(prepared.workspaceId, workspaceId);
  assert.equal(prepared.paymentState, "pending_user_signature");
});

test("workspace management returns the exact available prepaid balance", async () => {
  const { workspaceId } = await createWorkspace({ name: "Product team", ownerAddress: ADDRESS_A });
  await activateEarlyAccess(workspaceId);
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
});

test("policy-bound agent keys enforce exact audience and panel caps and reserve a budget", async () => {
  const { workspaceId } = await createWorkspace({ name: "Delegated", ownerAddress: ADDRESS_A });
  await activateEarlyAccess(workspaceId);
  const policy = await createAgentPublishingPolicy({
    accountAddress: ADDRESS_A,
    workspaceId,
    policy: {
      name: "Small invited-panel agent",
      allowedPaymentModes: ["prepaid"],
      maxPanelAtomic: "50000000",
      maxDailyAtomic: "40000000",
      maxMonthlyAtomic: "100000000",
      maxPanelSize: 20,
      maxBountyAtomic: "30000000",
      maxFeeBps: 1000,
      maxAttemptReserveAtomic: "10000000",
      allowedReviewerSources: ["customer_invited"],
      allowedAdmissionPolicyHashes: [`0x${"ab".repeat(32)}`],
    },
  });
  const key = await createWorkspaceApiKey({
    workspaceId,
    name: "Invited-panel agent",
    policyId: policy.policyId,
    scopes: ["quote:read", "panel:publish", "payment:submit", "result:read"],
  });
  await recordPrepaidLedgerEntry({ workspaceId, amountAtomic: "100000000", source: "invoice" });
  const first = await quoteAndRequest(workspaceId, "delegated:first:12345678");
  const principal = await authenticateProductPrincipal({
    authorization: `Bearer ${key.token}`,
    sessionToken: undefined,
  });
  assert.equal(principal.kind, "api_key");
  const prepared = await prepareProductAsk({ principal, request: first.request });
  assert.equal(prepared.policyId, policy.policyId);
  assert.equal(prepared.createdPolicyReservation, true);
  const reservations = await dbClient.execute(
    "SELECT status, policy_version FROM tokenless_agent_policy_budget_reservations",
  );
  assert.deepEqual(reservations.rows[0], { status: "reserved", policy_version: 1 });
  await assert.rejects(
    () => prepareProductAsk({ principal, request: { ...first.request, idempotencyKey: "delegated:second:12345678" } }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "policy_daily_cap_exceeded",
  );
});

test("publishing policies fail closed on unsupported reviewer sources and data classifications", async () => {
  const { workspaceId } = await createWorkspace({ name: "Classified", ownerAddress: ADDRESS_A });
  await activateEarlyAccess(workspaceId);
  const basePolicy = {
    name: "Internal-only agent",
    allowedPaymentModes: ["prepaid" as const],
    maxPanelAtomic: "50000000",
    maxDailyAtomic: "50000000",
    maxMonthlyAtomic: "100000000",
    maxPanelSize: 20,
    maxBountyAtomic: "30000000",
    maxFeeBps: 1000,
    maxAttemptReserveAtomic: "10000000",
    allowedAdmissionPolicyHashes: [`0x${"ab".repeat(32)}`],
  };
  await assert.rejects(
    () =>
      createAgentPublishingPolicy({
        accountAddress: ADDRESS_A,
        workspaceId,
        policy: { ...basePolicy, allowedReviewerSources: ["untrusted_network"] },
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_policy",
  );

  const policy = await createAgentPublishingPolicy({
    accountAddress: ADDRESS_A,
    workspaceId,
    policy: {
      ...basePolicy,
      allowedReviewerSources: ["rateloop_network"],
      allowedDataClassifications: ["public"],
      onPolicyMiss: "handoff",
    },
  });
  const key = await createWorkspaceApiKey({ workspaceId, name: "Public only", policyId: policy.policyId });
  await recordPrepaidLedgerEntry({ workspaceId, amountAtomic: "100000000", source: "invoice" });
  const { request } = await quoteAndRequest(workspaceId, "classified:ask:12345678");
  const principal = await authenticateProductPrincipal({
    authorization: `Bearer ${key.token}`,
    sessionToken: undefined,
  });
  await assert.rejects(
    () => prepareProductAsk({ principal, request }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "approval_required",
  );
});

test("policy-bound x402 keys require the configured wallet binding", async () => {
  const { workspaceId } = await createWorkspace({ name: "Wallet delegated", ownerAddress: ADDRESS_A });
  await activateEarlyAccess(workspaceId);
  const policy = await createAgentPublishingPolicy({
    accountAddress: ADDRESS_A,
    workspaceId,
    policy: {
      name: "Wallet agent",
      allowedPaymentModes: ["x402"],
      payerAddress: ADDRESS_A,
      maxPanelAtomic: "50000000",
      maxDailyAtomic: "50000000",
      maxMonthlyAtomic: "100000000",
      maxPanelSize: 20,
      maxBountyAtomic: "30000000",
      maxFeeBps: 1000,
      maxAttemptReserveAtomic: "10000000",
      allowedReviewerSources: ["customer_invited"],
      allowedAdmissionPolicyHashes: [`0x${"ab".repeat(32)}`],
    },
  });
  const key = await createWorkspaceApiKey({
    workspaceId,
    name: "Wallet agent",
    policyId: policy.policyId,
    walletAddress: ADDRESS_A,
  });
  const quote = await createTokenlessQuote(quoteRequest());
  const principal = await authenticateProductPrincipal({
    authorization: `Bearer ${key.token}`,
    sessionToken: undefined,
  });
  await assert.rejects(
    () =>
      prepareProductAsk({
        principal,
        request: {
          idempotencyKey: "wallet:policy:12345678",
          quoteId: quote.quoteId,
          payment: { mode: "x402", payerAddress: ADDRESS_B },
        },
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "wallet_binding_mismatch",
  );
});

test("policy revocation blocks the next delegated ask", async () => {
  const { workspaceId } = await createWorkspace({ name: "Revocable", ownerAddress: ADDRESS_A });
  await activateEarlyAccess(workspaceId);
  const policy = await createAgentPublishingPolicy({
    accountAddress: ADDRESS_A,
    workspaceId,
    policy: {
      name: "Revocable agent",
      allowedPaymentModes: ["prepaid"],
      maxPanelAtomic: "50000000",
      maxDailyAtomic: "50000000",
      maxMonthlyAtomic: "100000000",
      maxPanelSize: 20,
      maxBountyAtomic: "30000000",
      maxFeeBps: 1000,
      maxAttemptReserveAtomic: "10000000",
      allowedReviewerSources: ["customer_invited"],
      allowedAdmissionPolicyHashes: [`0x${"ab".repeat(32)}`],
    },
  });
  const key = await createWorkspaceApiKey({ workspaceId, name: "Revocable agent", policyId: policy.policyId });
  await revokeAgentPublishingPolicy({ accountAddress: ADDRESS_A, workspaceId, policyId: policy.policyId });
  const quote = await createTokenlessQuote(quoteRequest());
  const principal = await authenticateProductPrincipal({
    authorization: `Bearer ${key.token}`,
    sessionToken: undefined,
  });
  await assert.rejects(
    () =>
      prepareProductAsk({
        principal,
        request: {
          idempotencyKey: "revoked:policy:12345678",
          quoteId: quote.quoteId,
          payment: { mode: "prepaid", workspaceId },
        },
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "policy_revoked",
  );
});

test("a public browser handoff persists a discoverable public ask end to end", async () => {
  // AUD-01 regression guard: the MCP handoff creator marks the ask public with a safe classification.
  // The browser must carry that public-data contract through validation, quote, and ask so the persisted
  // question record enters the public rater queue (raterService.listPaidRaterTasks requires visibility
  // 'public' and a safe classification) instead of being silently downgraded to private/internal.
  const redactionSummary = "Names and account identifiers were replaced with synthetic values.";
  const handoff = createMcpHandoff(
    {
      confirmedNoSensitiveData: true,
      dataClassification: "synthetic",
      redactionSummary,
      request: {
        audience: { admissionPolicyHash: `0x${"ab".repeat(32)}`, source: "rateloop_network" },
        budget: { attemptReserveAtomic: "5000000", bountyAtomic: "25000000", feeBps: 750 },
        question: { kind: "binary", prompt: "Ship the synthetic reply?", rationale: { mode: "optional" } },
        requestedPanelSize: 15,
      },
    },
    "https://rateloop-tokenless.vercel.app",
  );

  // The browser decodes the fragment locally and re-validates the request it POSTs to /quote.
  const decoded = decodeTokenlessHandoffFragment(new URL(handoff.handoffUrl).hash);
  const browserRequest = validateTokenlessQuoteRequest(decoded.request);
  assert.equal(browserRequest.visibility, "public");
  assert.equal(browserRequest.dataClassification, "synthetic");
  assert.equal(browserRequest.confirmedNoSensitiveData, true);

  const { workspaceId, apiKeyId } = await workspaceWithKey();
  await recordPrepaidLedgerEntry({ workspaceId, amountAtomic: "100000000", source: "invoice" });
  const principal = { kind: "api_key" as const, apiKeyId, workspaceId, role: "member" as const };

  const quote = await createTokenlessQuote(browserRequest);
  await prepareProductAsk({
    principal,
    request: {
      idempotencyKey: decoded.idempotencyKey,
      payment: { mode: "prepaid" as const, workspaceId },
      quoteId: quote.quoteId,
    },
  });

  // The persisted question and content must satisfy the exact predicate the public rater queue applies.
  const discoverable = await dbClient.execute({
    sql: `SELECT q.visibility, q.data_classification, q.confirmed_no_sensitive_data, q.redaction_summary,
                 c.data_classification AS content_classification
          FROM tokenless_question_records q
          JOIN tokenless_content_records c ON c.content_id = q.content_id
          WHERE q.visibility = 'public' AND q.data_classification IN ('public', 'synthetic', 'redacted')`,
  });
  assert.equal(discoverable.rows.length, 1);
  const row = discoverable.rows[0]!;
  assert.equal(row.visibility, "public");
  assert.equal(row.data_classification, "synthetic");
  assert.equal(row.content_classification, "synthetic");
  assert.equal(row.redaction_summary, redactionSummary);
  assert.equal(Boolean(row.confirmed_no_sensitive_data), true);
});

test("x402 authorizations are limited to a short-lived signing window", () => {
  const now = Math.floor(Date.now() / 1_000);
  assert.throws(
    () =>
      normalizedX402Authorization({
        validAfter: String(now),
        validBefore: String(now + 3_601),
        nonce: `0x${"11".repeat(32)}`,
        v: 27,
        r: `0x${"22".repeat(32)}`,
        s: `0x${"33".repeat(32)}`,
        roundAuthorizationSignature: `0x${"44".repeat(65)}`,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_payment",
  );
});

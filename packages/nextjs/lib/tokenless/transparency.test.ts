import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  type IndexedFinalizedEvidence,
  appendFinalizedRoundEvidence,
  createWorkspaceWebhook,
  deliverPendingWebhooks,
  evaluateAnalytics,
  inspectWorkspaceTransparency,
  listWorkspaceWebhooks,
  reviewAndPublishResult,
  stableTransparencyJson,
  subscribeAskWebhook,
  validateWebhookUrl,
} from "~~/lib/tokenless/transparency";

const OWNER = "0x1111111111111111111111111111111111111111";
const WORKSPACE = "ws_transparency";
const OPERATION = "op_transparency";
const DEPLOYMENT = "tokenless-v1:84532:0x1:0x2:0x3";
const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64url");
const NOW = new Date("2026-07-12T18:00:00.000Z");
const resolvePublic = async () => ["203.0.113.10"];

const economics = {
  asset: "USDC" as const,
  decimals: 6 as const,
  bounty: { fundedAtomic: "25000000", paidAtomic: "25000000", refundedAtomic: "0" },
  fee: { bps: 750, fundedAtomic: "1875000", paidAtomic: "1875000", refundedAtomic: "0" },
  attemptReserve: { fundedAtomic: "5000000", compensatedAtomic: "0", refundedAtomic: "5000000" },
  refund: { bountyAtomic: "0", feeAtomic: "0", attemptReserveAtomic: "5000000", totalAtomic: "5000000" },
  compensation: { perAcceptedRevealCapAtomic: "333333", recipientCount: 0, totalAtomic: "0" },
  totalFundedAtomic: "31875000",
};

function evidence(): IndexedFinalizedEvidence {
  return {
    deploymentKey: DEPLOYMENT,
    roundId: "42",
    revealCount: 5,
    upVotes: 4,
    economics,
    tierMix: { passport: 3, orb: 2 },
    diversity: { independentClusters: 4, largestClusterBps: 2000, uniqueVoteKeys: 5 },
    chain: {
      blockNumber: "44060000",
      blockHash: `0x${"ab".repeat(32)}`,
      transactionHash: `0x${"cd".repeat(32)}`,
    },
  };
}

beforeEach(async () => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  await dbClient.execute({
    sql: "INSERT INTO tokenless_workspaces (workspace_id, name, status, created_at, updated_at) VALUES (?, 'Transparency', 'active', ?, ?)",
    args: [WORKSPACE, NOW, NOW],
  });
  await dbClient.execute({
    sql: "INSERT INTO tokenless_workspace_members (workspace_id, account_address, role, created_at) VALUES (?, ?, 'owner', ?)",
    args: [WORKSPACE, OWNER, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_quotes
          (quote_id, request_hash, request_json, response_json, expires_at, created_at)
          VALUES ('quote_transparency', 'hash', ?, ?, ?, ?)`,
    args: [
      JSON.stringify({ question: { kind: "binary", prompt: "Ship?" } }),
      JSON.stringify({
        schemaVersion: "tokenless-v1",
        audience: { tierId: "passport", label: "Passport-verified humans" },
      }),
      new Date("2027-01-01T00:00:00Z"),
      NOW,
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_asks
          (operation_key, idempotency_key, request_hash, quote_id, request_json, economics_json, status, verdict_status, round_id, sandbox, created_at, updated_at)
          VALUES (?, 'transparency:test:1', 'ask_hash', 'quote_transparency', '{}', ?, 'submitted', NULL, '42', false, ?, ?)`,
    args: [OPERATION, JSON.stringify(economics), NOW, NOW],
  });
  await dbClient.execute({
    sql: "INSERT INTO tokenless_content_records (content_id, workspace_id, content_hash, content_json, moderation_status, created_at, updated_at) VALUES ('content_transparency', ?, 'content_hash', '{}', 'approved', ?, ?)",
    args: [WORKSPACE, NOW, NOW],
  });
  await dbClient.execute({
    sql: "INSERT INTO tokenless_question_records (question_id, workspace_id, content_id, quote_id, terms_hash, terms_json, moderation_status, created_at, updated_at) VALUES ('question_transparency', ?, 'content_transparency', 'quote_transparency', 'terms_hash', '{}', 'approved', ?, ?)",
    args: [WORKSPACE, NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_ask_ownership
          (operation_key, workspace_id, owner_account_address, question_id, payment_mode, payment_state, payment_reference, idempotency_key, created_at, updated_at)
          VALUES (?, ?, ?, 'question_transparency', 'prepaid', 'settled', 'payment', 'transparency:test:1', ?, ?)`,
    args: [OPERATION, WORKSPACE, OWNER, NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_chain_executions
          (execution_id, operation_key, payment_mode, payment_reference, deployment_key, chain_id, deployment_block, panel_address, issuer_address, x402_submitter_address, usdc_address, funder_address, content_id, terms_hash, round_terms_json, total_funded_atomic, state, round_id, created_at, updated_at)
          VALUES ('execution_transparency', ?, 'prepaid', 'payment', ?, 84532, 44050000, ?, ?, ?, ?, ?, 'content_transparency', 'terms_hash', '{}', 31875000, 'confirmed', 42, ?, ?)`,
    args: [
      OPERATION,
      DEPLOYMENT,
      `0x${"11".repeat(20)}`,
      `0x${"22".repeat(20)}`,
      `0x${"33".repeat(20)}`,
      `0x${"44".repeat(20)}`,
      OWNER,
      NOW,
      NOW,
    ],
  });
});

afterEach(() => __setDatabaseResourcesForTests(null));

test("canonical evidence and fixed analytics rules are deterministic", () => {
  assert.equal(stableTransparencyJson({ z: 1, a: { y: 2, x: 3 } }), '{"a":{"x":3,"y":2},"z":1}');
  assert.deepEqual(
    evaluateAnalytics(
      { answerFingerprintRiskBps: 500, correlationRiskBps: 800, issuedVoucherCount: 5, verifiedIdentityCount: 5 },
      evidence().diversity,
    ),
    { decision: "published", reasonCodes: [] },
  );
  assert.equal(
    evaluateAnalytics(
      { answerFingerprintRiskBps: 4500, correlationRiskBps: 800, issuedVoucherCount: 6, verifiedIdentityCount: 5 },
      evidence().diversity,
    ).decision,
    "delisted",
  );
});

test("finalized evidence rejects malformed chain proofs and non-conserving funding before immutability", async () => {
  await assert.rejects(
    () =>
      appendFinalizedRoundEvidence({
        operationKey: OPERATION,
        evidence: { ...evidence(), chain: { ...evidence().chain, blockHash: "0x12" } },
        occurredAt: NOW,
      }),
    /Chain finality evidence is malformed/,
  );
  await assert.rejects(
    () =>
      appendFinalizedRoundEvidence({
        operationKey: OPERATION,
        evidence: { ...evidence(), economics: { ...economics, totalFundedAtomic: "1" } },
        occurredAt: NOW,
      }),
    /funding does not conserve/,
  );
});

test("webhook registration rejects SSRF targets and returns its secret only once", async () => {
  assert.throws(() => validateWebhookUrl("https://127.0.0.1/hook"), /private or local/);
  assert.throws(() => validateWebhookUrl("http://hooks.example.test/hook"), /HTTPS/);
  const created = await createWorkspaceWebhook({
    accountAddress: OWNER,
    workspaceId: WORKSPACE,
    url: "https://hooks.example.test/result",
    eventTypes: ["result.ready"],
    encryptionKey: ENCRYPTION_KEY,
    resolveHostname: resolvePublic,
  });
  assert.match(created.signingSecret, /^rlwhsec_/);
  const listed = await listWorkspaceWebhooks({ accountAddress: OWNER, workspaceId: WORKSPACE });
  assert.equal(listed[0]?.endpointId, created.endpointId);
  assert.equal("signingSecret" in listed[0]!, false);
});

test("finalized evidence publishes once and webhook retries preserve idempotency and signatures", async () => {
  const endpoint = await createWorkspaceWebhook({
    accountAddress: OWNER,
    workspaceId: WORKSPACE,
    url: "https://hooks.example.test/result",
    eventTypes: ["result.ready"],
    encryptionKey: ENCRYPTION_KEY,
    resolveHostname: resolvePublic,
  });
  assert.equal(
    await subscribeAskWebhook({
      operationKey: OPERATION,
      workspaceId: WORKSPACE,
      registration: { url: endpoint.url, eventTypes: ["result.ready"] },
    }),
    true,
  );
  const appended = await appendFinalizedRoundEvidence({
    operationKey: OPERATION,
    evidence: evidence(),
    occurredAt: NOW,
  });
  assert.deepEqual(
    await appendFinalizedRoundEvidence({ operationKey: OPERATION, evidence: evidence(), occurredAt: NOW }),
    appended,
  );
  const metrics = {
    answerFingerprintRiskBps: 500,
    correlationRiskBps: 600,
    issuedVoucherCount: 5,
    verifiedIdentityCount: 5,
  };
  const published = await reviewAndPublishResult({
    operationKey: OPERATION,
    metrics,
    appOrigin: "https://app.example.test",
    now: NOW,
  });
  const replay = await reviewAndPublishResult({
    operationKey: OPERATION,
    metrics,
    appOrigin: "https://app.example.test",
    now: new Date(NOW.getTime() + 1_000),
  });
  assert.equal(replay.publicationId, published.publicationId);
  assert.equal(published.result.verdictStatus, "published");
  assert.equal(published.result.verdict?.scoreBps, 8000);

  let calls = 0;
  let deliveryId = "";
  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
    calls += 1;
    const headers = new Headers(init?.headers);
    deliveryId = headers.get("rateloop-delivery-id") ?? "";
    const body = String(init?.body);
    const timestamp = headers.get("rateloop-timestamp")!;
    const expected = `v1=${createHmac("sha256", endpoint.signingSecret).update(`${timestamp}.${body}`).digest("hex")}`;
    assert.equal(headers.get("rateloop-signature"), expected);
    return new Response(null, { status: calls === 1 ? 503 : 204 });
  };
  assert.equal(
    (
      await deliverPendingWebhooks({
        fetchImpl,
        now: NOW,
        encryptionKey: ENCRYPTION_KEY,
        resolveHostname: resolvePublic,
      })
    )[0]?.state,
    "retry",
  );
  assert.equal(
    (
      await deliverPendingWebhooks({
        fetchImpl,
        now: new Date(NOW.getTime() + 30_000),
        encryptionKey: ENCRYPTION_KEY,
        resolveHostname: resolvePublic,
      })
    )[0]?.state,
    "delivered",
  );
  assert.match(deliveryId, /^whd_/);

  const inspection = await inspectWorkspaceTransparency({
    accountAddress: OWNER,
    workspaceId: WORKSPACE,
    operationKey: OPERATION,
  });
  assert.equal(inspection.events.length, 1);
  assert.equal(inspection.analyticsReviews[0]?.decision, "published");
  assert.equal(inspection.publications.length, 1);
  assert.equal(inspection.webhookDeliveries[0]?.state, "delivered");
});

test("analytics can delist public interpretation without changing indexed settlement evidence", async () => {
  await appendFinalizedRoundEvidence({ operationKey: OPERATION, evidence: evidence(), occurredAt: NOW });
  const published = await reviewAndPublishResult({
    operationKey: OPERATION,
    metrics: {
      answerFingerprintRiskBps: 4_500,
      correlationRiskBps: 4_200,
      issuedVoucherCount: 6,
      verifiedIdentityCount: 5,
    },
    appOrigin: "https://app.example.test",
    now: NOW,
  });
  assert.equal(published.result.verdictStatus, "delisted");
  assert.equal(published.result.verdict, null);
  assert.deepEqual(published.reasonCodes, [
    "issuance_exceeds_verified_identities",
    "high_correlation_risk",
    "high_answer_fingerprint_risk",
  ]);
  const stored = await dbClient.execute({
    sql: "SELECT verdict_status, result_json FROM tokenless_agent_asks WHERE operation_key = ?",
    args: [OPERATION],
  });
  assert.equal(stored.rows[0]?.verdict_status, "delisted");
  assert.equal(JSON.parse(String(stored.rows[0]?.result_json)).verdict, null);
});

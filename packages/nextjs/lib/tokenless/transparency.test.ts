import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
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
const PANEL = `0x${"aa".repeat(20)}`;
const ISSUER = `0x${"bb".repeat(20)}`;
const ADAPTER = `0x${"cc".repeat(20)}`;
const USDC = `0x${"dd".repeat(20)}`;
const FEE_RECIPIENT = `0x${"ee".repeat(20)}`;
const CONTENT_ID = `0x${"61".repeat(32)}`;
const TERMS_HASH = `0x${"62".repeat(32)}`;
const POLICY_HASH = `0x${"63".repeat(32)}`;
const BEACON_HASH = `0x${"64".repeat(32)}`;
const DEPLOYMENT = `tokenless-v2:84532:${PANEL}:${ISSUER}:${ADAPTER}`;
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

const roundTerms = {
  contentId: CONTENT_ID,
  termsHash: TERMS_HASH,
  beaconNetworkHash: BEACON_HASH,
  bountyAmount: "25000000",
  feeAmount: "1875000",
  attemptReserve: "5000000",
  attemptCompensation: "333333",
  minimumReveals: 3,
  maximumCommits: 5,
  admissionPolicyHash: POLICY_HASH,
  commitDeadline: "1783878000",
  revealDeadline: "1783878120",
  beaconFailureDeadline: "1783878420",
  beaconRound: "25000000",
  claimGracePeriod: "604800",
  feeRecipient: FEE_RECIPIENT,
};

function indexedRound(overrides: Record<string, unknown> = {}) {
  return {
    deploymentKey: DEPLOYMENT,
    roundId: "42",
    funder: OWNER,
    contentId: CONTENT_ID,
    termsHash: TERMS_HASH,
    beaconNetworkHash: BEACON_HASH,
    beaconRound: roundTerms.beaconRound,
    feeRecipient: FEE_RECIPIENT,
    bountyAmount: roundTerms.bountyAmount,
    feeAmount: roundTerms.feeAmount,
    attemptReserve: roundTerms.attemptReserve,
    attemptCompensation: roundTerms.attemptCompensation,
    minimumReveals: roundTerms.minimumReveals,
    maximumCommits: roundTerms.maximumCommits,
    admissionPolicyHash: POLICY_HASH,
    commitDeadline: roundTerms.commitDeadline,
    revealDeadline: roundTerms.revealDeadline,
    beaconFailureDeadline: roundTerms.beaconFailureDeadline,
    claimGracePeriod: roundTerms.claimGracePeriod,
    commitCount: 5,
    revealCount: 5,
    frozenRevealCount: 5,
    upVotes: 4,
    state: 4,
    createdBlock: "44050001",
    finalizedAt: String(Math.floor(NOW.getTime() / 1_000)),
    finalizedBlock: "44060000",
    finalizedBlockHash: `0x${"ab".repeat(32)}`,
    finalizedTxHash: `0x${"cd".repeat(32)}`,
    ...overrides,
  };
}

function indexedCommits(responseHash?: string) {
  return Array.from({ length: 5 }, (_, index) => ({
    deploymentKey: DEPLOYMENT,
    roundId: "42",
    voteKey: `0x${String(index + 1).padStart(40, "0")}`,
    nullifier: `0x${String(index + 11).padStart(64, "0")}`,
    responseHash: responseHash ?? `0x${String(index + 21).padStart(64, "0")}`,
    vote: index === 4 ? 0 : 1,
    predictedUpBps: 7_000,
    revealed: true,
  }));
}

function ponderFetch(input: { round?: Record<string, unknown>; commits?: Record<string, unknown>[] } = {}) {
  return async (request: string | URL | Request) => {
    const url = new URL(typeof request === "string" || request instanceof URL ? request : request.url);
    if (url.pathname.endsWith("/deployment")) {
      return Response.json({
        deploymentKey: DEPLOYMENT,
        chainId: 84_532,
        panelAddress: PANEL,
        issuerAddress: ISSUER,
        adapterAddress: ADAPTER,
        startBlock: 44_050_000,
      });
    }
    if (url.pathname.endsWith("/rounds/42/commits")) return Response.json(input.commits ?? indexedCommits());
    if (url.pathname.endsWith("/rounds/42")) return Response.json(input.round ?? indexedRound());
    return Response.json({ error: "not found" }, { status: 404 });
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
        schemaVersion: "rateloop.tokenless.v2",
        audience: {
          admissionPolicyHash: POLICY_HASH,
          label: "Customer-invited reviewers",
          source: "customer_invited",
        },
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
          VALUES ('execution_transparency', ?, 'prepaid', 'payment', ?, 84532, 44050000, ?, ?, ?, ?, ?, ?, ?, ?, 31875000, 'confirmed', 42, ?, ?)`,
    args: [
      OPERATION,
      DEPLOYMENT,
      PANEL,
      ISSUER,
      ADAPTER,
      USDC,
      OWNER,
      CONTENT_ID,
      TERMS_HASH,
      JSON.stringify(roundTerms),
      NOW,
      NOW,
    ],
  });
  for (let index = 0; index < 5; index += 1) {
    const raterId = `rater_transparency_${index}`;
    const accountAddress = `0x${String(index + 101).padStart(40, "0")}`;
    const identitySubjectHash = `identity_${index}`;
    const voteKey = `0x${String(index + 1).padStart(40, "0")}`;
    const assuranceSnapshotJson = stableTransparencyJson({
      schemaVersion: "rateloop.voucher-assurance-snapshot.v1",
      reviewerSource: "rateloop_network",
      assertions: [
        {
          assertionId: `assertion_${index}`,
          bindingId: `binding_${index}`,
          providerId: "self_xyz",
          providerNamespace: "self:test",
          subjectReferenceHash: identitySubjectHash,
          capabilities: ["live_human", "unique_human"],
          verifiedAt: NOW.toISOString(),
          expiresAt: "2027-01-01T00:00:00.000Z",
        },
      ],
      qualifications: [],
      cohortIds: [],
      capturedAt: NOW.toISOString(),
    });
    const assuranceSnapshotHash = `sha256:${createHash("sha256").update(assuranceSnapshotJson).digest("hex")}`;
    await dbClient.execute({
      sql: `INSERT INTO tokenless_rater_profiles
            (rater_id, account_address, nullifier_seed_ciphertext, nullifier_key_version,
             nullifier_key_domain, created_at, updated_at)
            VALUES (?, ?, 'ciphertext', 'v1', 'vote_mapping', ?, ?)`,
      args: [raterId, accountAddress, NOW, NOW],
    });
    await dbClient.execute({
      sql: `INSERT INTO tokenless_paid_vouchers
            (voucher_id, rater_id, request_idempotency_key, request_hash,
             chain_id, panel_address, issuer_address, issuer_epoch, signer_address, round_id,
             content_id, vote_key, nullifier, admission_policy_hash, assurance_snapshot_hash,
             expires_at, voucher_json, voucher_signature,
             status, issued_at)
            VALUES (?, ?, ?, ?, 84532, ?, ?, 1, ?, 42, ?, ?, ?, ?, ?, ?, '{}', 'signature', 'committed', ?)`,
      args: [
        `voucher_${index}`,
        raterId,
        `voucher_request_${index}`,
        `voucher_hash_${index}`,
        PANEL,
        ISSUER,
        ISSUER,
        CONTENT_ID,
        voteKey,
        `0x${String(index + 11).padStart(64, "0")}`,
        POLICY_HASH,
        assuranceSnapshotHash,
        new Date("2027-01-01T00:00:00Z"),
        NOW,
      ],
    });
    await dbClient.execute({
      sql: `INSERT INTO tokenless_voucher_assurance_snapshots
            (voucher_id, rater_id, reviewer_source, snapshot_json, snapshot_hash, created_at)
            VALUES (?, ?, 'rateloop_network', ?, ?, ?)`,
      args: [`voucher_${index}`, raterId, assuranceSnapshotJson, assuranceSnapshotHash, NOW],
    });
  }
});

afterEach(() => __setDatabaseResourcesForTests(null));

test("canonical evidence and fixed analytics rules are deterministic", () => {
  assert.equal(stableTransparencyJson({ z: 1, a: { y: 2, x: 3 } }), '{"a":{"x":3,"y":2},"z":1}');
  assert.deepEqual(
    evaluateAnalytics(
      { answerFingerprintRiskBps: 500, correlationRiskBps: 800, issuedVoucherCount: 5, verifiedIdentityCount: 5 },
      { independentClusters: 5, largestClusterBps: 2_000, uniqueVoteKeys: 5 },
    ),
    { decision: "published", reasonCodes: [] },
  );
  assert.equal(
    evaluateAnalytics(
      { answerFingerprintRiskBps: 4500, correlationRiskBps: 800, issuedVoucherCount: 6, verifiedIdentityCount: 5 },
      { independentClusters: 5, largestClusterBps: 2_000, uniqueVoteKeys: 5 },
    ).decision,
    "delisted",
  );
});

test("finalized evidence rejects malformed Ponder provenance and altered frozen terms", async () => {
  await assert.rejects(
    () =>
      appendFinalizedRoundEvidence({
        operationKey: OPERATION,
        fetchImpl: ponderFetch({ round: indexedRound({ finalizedBlockHash: "0x12" }) }),
        ponderUrl: "https://ponder.example.test",
      }),
    /Finalized block hash is malformed/,
  );
  await assert.rejects(
    () =>
      appendFinalizedRoundEvidence({
        operationKey: OPERATION,
        fetchImpl: ponderFetch({ round: indexedRound({ bountyAmount: "1" }) }),
        ponderUrl: "https://ponder.example.test",
      }),
    /do not match the frozen terms/,
  );
  await dbClient.execute(
    "UPDATE tokenless_voucher_assurance_snapshots SET snapshot_json = '{}' WHERE voucher_id = 'voucher_0'",
  );
  await assert.rejects(
    () =>
      appendFinalizedRoundEvidence({
        operationKey: OPERATION,
        fetchImpl: ponderFetch(),
        ponderUrl: "https://ponder.example.test",
      }),
    /provenance hash is invalid/,
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
    fetchImpl: ponderFetch(),
    ponderUrl: "https://ponder.example.test",
  });
  assert.deepEqual(
    await appendFinalizedRoundEvidence({
      operationKey: OPERATION,
      fetchImpl: ponderFetch(),
      ponderUrl: "https://ponder.example.test",
    }),
    appended,
  );
  const published = await reviewAndPublishResult({
    operationKey: OPERATION,
    appOrigin: "https://app.example.test",
    now: NOW,
  });
  const replay = await reviewAndPublishResult({
    operationKey: OPERATION,
    appOrigin: "https://app.example.test",
    now: new Date(NOW.getTime() + 1_000),
  });
  assert.equal(replay.publicationId, published.publicationId);
  assert.equal(published.result.verdictStatus, "published");
  assert.equal(published.result.verdict?.preferenceShareBps, 8000);
  assert.deepEqual(published.result.verdict?.intervalBps, { lower: 3755, upper: 9638 });

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
        operationKey: OPERATION,
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
        operationKey: OPERATION,
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
  const storedEvidence = inspection.events[0]?.evidence_json as Record<string, unknown>;
  assert.deepEqual(storedEvidence.analytics, {
    answerFingerprintRiskBps: 0,
    correlationRiskBps: 0,
    issuedVoucherCount: 5,
    verifiedIdentityCount: 5,
  });
  assert.deepEqual(storedEvidence.provenance, {
    assignmentCount: 0,
    issuedVoucherCount: 5,
    matchedAssignmentCount: 0,
    validResponseCount: 0,
    verifiedIdentityCount: 5,
  });
  assert.equal((storedEvidence.chain as Record<string, unknown>).transactionHash, `0x${"cd".repeat(32)}`);
  assert.equal(inspection.analyticsReviews[0]?.decision, "published");
  assert.equal(inspection.publications.length, 1);
  assert.equal(inspection.webhookDeliveries[0]?.state, "delivered");
});

test("analytics can delist public interpretation without changing indexed settlement evidence", async () => {
  await appendFinalizedRoundEvidence({
    operationKey: OPERATION,
    fetchImpl: ponderFetch({ commits: indexedCommits(`0x${"fe".repeat(32)}`) }),
    ponderUrl: "https://ponder.example.test",
  });
  const published = await reviewAndPublishResult({
    operationKey: OPERATION,
    appOrigin: "https://app.example.test",
    now: NOW,
  });
  assert.equal(published.result.verdictStatus, "delisted");
  assert.equal(published.result.verdict, null);
  assert.deepEqual(published.reasonCodes, ["high_answer_fingerprint_risk"]);
  const stored = await dbClient.execute({
    sql: "SELECT verdict_status, result_json FROM tokenless_agent_asks WHERE operation_key = ?",
    args: [OPERATION],
  });
  assert.equal(stored.rows[0]?.verdict_status, "delisted");
  assert.equal(JSON.parse(String(stored.rows[0]?.result_json)).verdict, null);
});

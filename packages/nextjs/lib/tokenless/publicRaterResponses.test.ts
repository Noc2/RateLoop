import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient, dbPool } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { moderateTokenlessPublicRaterResponse } from "~~/lib/tokenless/moderation";
import {
  __setPublicRaterResponseKeyringForTests,
  listAuthorizedTerminalPublicFeedback,
  listPendingPublicRaterResponses,
  preparePublicRaterResponse,
  verifyPublicRaterResponseCommitments,
} from "~~/lib/tokenless/publicRaterResponses";
import { createPublicRaterResponse } from "~~/lib/tokenless/rater/publicResponse";

const NOW = new Date("2026-07-15T15:00:00.000Z");
const CONTENT_ID = `0x${"11".repeat(32)}` as const;
const VOTE_KEY = "0x1111111111111111111111111111111111111111";

beforeEach(async () => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  __setPublicRaterResponseKeyringForTests({ currentVersion: "v1", keys: new Map([["v1", Buffer.alloc(32, 7)]]) });
  await dbClient.execute({
    sql: "INSERT INTO tokenless_workspaces (workspace_id, name, status, created_at, updated_at) VALUES ('ws_response', 'Response', 'active', ?, ?)",
    args: [NOW, NOW],
  });
  await dbClient.execute({
    sql: "INSERT INTO tokenless_agent_quotes (quote_id, request_hash, request_json, response_json, expires_at, created_at) VALUES ('quote_response', 'hash', '{}', '{}', ?, ?)",
    args: [new Date(NOW.getTime() + 60_000), NOW],
  });
  await dbClient.execute({
    sql: "INSERT INTO tokenless_agent_asks (operation_key, idempotency_key, request_hash, quote_id, request_json, economics_json, status, verdict_status, created_at, updated_at) VALUES ('op_response', 'response:test:1', 'hash', 'quote_response', '{}', '{}', 'open', 'pending', ?, ?)",
    args: [NOW, NOW],
  });
  await dbClient.execute({
    sql: "INSERT INTO tokenless_content_records (content_id, workspace_id, content_hash, content_json, moderation_status, created_at, updated_at) VALUES ('cnt_response', 'ws_response', 'hash', '{}', 'approved', ?, ?)",
    args: [NOW, NOW],
  });
  await dbClient.execute({
    sql: "INSERT INTO tokenless_question_records (question_id, workspace_id, content_id, quote_id, terms_hash, terms_json, visibility, data_classification, confirmed_no_sensitive_data, moderation_status, created_at, updated_at) VALUES ('qst_response', 'ws_response', 'cnt_response', 'quote_response', 'terms', '{}', 'public', 'public', true, 'approved', ?, ?)",
    args: [NOW, NOW],
  });
  await dbClient.execute({
    sql: "INSERT INTO tokenless_ask_ownership (operation_key, workspace_id, question_id, payment_mode, payment_state, payment_reference, idempotency_key, created_at, updated_at) VALUES ('op_response', 'ws_response', 'qst_response', 'prepaid', 'confirmed', 'payment', 'response:test:1', ?, ?)",
    args: [NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_principals (principal_id,status,created_at,updated_at)
          VALUES ('rlp_public_response','active',?,?);
          INSERT INTO tokenless_wallet_bindings
          (binding_id,principal_id,purpose,wallet_address,wallet_source,chain_id,proof_message_hash,created_at,last_used_at)
          VALUES ('binding_public_response','rlp_public_response','payout',?,'self_custodial',84532,'fixture',?,?);
          INSERT INTO tokenless_payout_wallet_ownership
          (wallet_address,principal_id,first_binding_id,first_bound_at)
          VALUES (?,'rlp_public_response','binding_public_response',?);
          INSERT INTO tokenless_rater_profiles
          (rater_id,principal_id,account_address,nullifier_seed_ciphertext,nullifier_key_version,
           nullifier_key_domain,created_at,updated_at)
          VALUES ('rater_response','rlp_public_response',?,'ciphertext','v1','vote_mapping',?,?)`,
    args: [NOW, NOW, VOTE_KEY, NOW, NOW, VOTE_KEY, NOW, VOTE_KEY, NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_paid_vouchers
          (voucher_id, rater_id, request_idempotency_key, request_hash, chain_id,
           panel_address, issuer_address, issuer_epoch, signer_address, round_id, content_id, vote_key, nullifier,
           admission_policy_hash, assurance_snapshot_hash, expires_at, payout_account_snapshot,
           voucher_json, voucher_signature, status, issued_at)
          VALUES ('voucher_response', 'rater_response', 'voucher:test:1', 'hash', 84532,
                  '0x2222222222222222222222222222222222222222', '0x3333333333333333333333333333333333333333',
                  1, '0x4444444444444444444444444444444444444444', 42, ?, ?, ?, ?, ?, ?, ?, '{}', '0x12', 'issued', ?)`,
    args: [
      CONTENT_ID,
      VOTE_KEY,
      `0x${"22".repeat(32)}`,
      `0x${"44".repeat(32)}`,
      `sha256:${"55".repeat(32)}`,
      new Date(NOW.getTime() + 60_000),
      VOTE_KEY,
      NOW,
    ],
  });
});

afterEach(() => {
  __setPublicRaterResponseKeyringForTests(null);
  __setDatabaseResourcesForTests(null);
});

test("public feedback is encrypted once per voucher, moderated, hash-verified, and projected only at terminal result", async () => {
  const response = createPublicRaterResponse(
    { operationKey: "op_response", roundId: "42", contentId: CONTENT_ID, rationale: { mode: "required" } },
    {
      category: "evidence",
      body: "The linked source supports this rating.",
      sourceUrl: "https://example.com/source",
      nonce: `0x${"33".repeat(32)}`,
    },
  );
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await preparePublicRaterResponse(client, {
      voucherId: "voucher_response",
      operationKey: "op_response",
      questionId: "qst_response",
      roundId: "42",
      contentId: CONTENT_ID,
      voteKey: VOTE_KEY,
      rationale: { mode: "required" },
      response,
      now: NOW,
    });
    await client.query("COMMIT");
  } finally {
    client.release();
  }
  const stored = await dbClient.execute("SELECT * FROM tokenless_public_rater_responses");
  assert.equal(stored.rows.length, 1);
  assert.equal(String(stored.rows[0]?.payload_ciphertext).includes(response.body), false);
  assert.equal(String(stored.rows[0]?.moderation_status), "pending");
  assert.deepEqual(await listAuthorizedTerminalPublicFeedback({ operationKey: "op_response", terminal: false }), {
    items: [],
    redactedCount: 0,
  });
  const pending = await listPendingPublicRaterResponses();
  assert.equal(pending[0]?.feedback?.body, response.body);
  await verifyPublicRaterResponseCommitments({
    operationKey: "op_response",
    reveals: [{ voteKey: VOTE_KEY, responseHash: response.responseHash }],
    now: NOW,
  });
  await moderateTokenlessPublicRaterResponse({
    responseId: String(stored.rows[0]?.response_id),
    decision: "approved",
    reasonCode: "policy_pass",
    now: NOW,
  });
  assert.deepEqual(await listAuthorizedTerminalPublicFeedback({ operationKey: "op_response", terminal: true }), {
    items: [{ category: "evidence", body: response.body, sourceUrl: "https://example.com/source" }],
    redactedCount: 0,
  });
});

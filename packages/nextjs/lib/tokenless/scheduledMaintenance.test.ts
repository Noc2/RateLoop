import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  authorizeTokenlessCron,
  runTokenlessScheduledMaintenance,
  seedTokenlessScheduledWork,
} from "~~/lib/tokenless/scheduledMaintenance";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const NOW = new Date("2026-07-14T15:00:00.000Z");

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
});

async function seedConfirmedExecution(operationKey: string) {
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_asks
          (operation_key, idempotency_key, request_hash, quote_id, request_json, economics_json,
           status, created_at, updated_at)
          VALUES (?, ?, 'request-hash', 'quote-test', '{}', '{}', 'open', ?, ?)`,
    args: [operationKey, `idem:${operationKey}`, NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_chain_executions
          (execution_id, operation_key, payment_mode, payment_reference, deployment_key, chain_id,
           deployment_block, panel_address, issuer_address, x402_submitter_address, usdc_address,
           funder_address, content_id, terms_hash, round_terms_json, total_funded_atomic, state,
           round_id, created_at, updated_at, confirmed_at)
          VALUES (?, ?, 'prepaid', ?, 'tokenless-v3:test', 84532, 1,
                  '0x1111111111111111111111111111111111111111',
                  '0x2222222222222222222222222222222222222222',
                  '0x3333333333333333333333333333333333333333',
                  '0x4444444444444444444444444444444444444444',
                  '0x5555555555555555555555555555555555555555',
                  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                  '{}', 1, 'confirmed', 42, ?, ?, ?)`,
    args: [`exec:${operationKey}`, operationKey, `payment:${operationKey}`, NOW, NOW, NOW],
  });
}

async function seedRecoverableExecution(
  operationKey: string,
  input: { claimExpiresAt: Date; state?: "prepared" | "signed" | "broadcast" },
) {
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_asks
          (operation_key, idempotency_key, request_hash, quote_id, request_json, economics_json,
           status, created_at, updated_at)
          VALUES (?, ?, 'request-hash', 'quote-test', '{}', '{}', 'open', ?, ?)`,
    args: [operationKey, `idem:${operationKey}`, NOW, NOW],
  });
  const state = input.state ?? "signed";
  await dbClient.execute({
    sql: `INSERT INTO tokenless_chain_executions
          (execution_id, operation_key, payment_mode, payment_reference, deployment_key, chain_id,
           deployment_block, panel_address, issuer_address, x402_submitter_address, usdc_address,
           funder_address, content_id, terms_hash, round_terms_json, total_funded_atomic, state,
           submission_transaction_hash, submission_signed_transaction, transaction_recovery_version,
           claim_owner, claim_token, claim_expires_at, claim_fencing_token, created_at, updated_at)
          VALUES (?, ?, 'prepaid', ?, 'tokenless-v3:test', 84532, 1,
                  '0x1111111111111111111111111111111111111111',
                  '0x2222222222222222222222222222222222222222',
                  '0x3333333333333333333333333333333333333333',
                  '0x4444444444444444444444444444444444444444',
                  '0x5555555555555555555555555555555555555555',
                  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                  '{}', 1, ?, ?, ?, 1, 'crashed-worker', 'chl_crashed', ?, 1, ?, ?)`,
    args: [
      `exec:${operationKey}`,
      operationKey,
      `payment:${operationKey}`,
      state,
      state === "prepared" ? null : `0x${createHash("sha256").update(operationKey).digest("hex")}`,
      state === "prepared" ? null : "0x01",
      input.claimExpiresAt,
      NOW,
      NOW,
    ],
  });
}

async function seedRecoverableRaterCommit(commitId: string, state: "signed" | "submitted" = "signed") {
  await dbClient.execute({
    sql: `INSERT INTO tokenless_principals (principal_id,status,created_at,updated_at)
          VALUES ('rlp_scheduled_recovery','active',?,?);
          INSERT INTO tokenless_wallet_bindings
          (binding_id,principal_id,purpose,wallet_address,wallet_source,chain_id,proof_message_hash,created_at,last_used_at)
          VALUES ('binding_scheduled_recovery','rlp_scheduled_recovery','payout',
                  '0x1111111111111111111111111111111111111111','self_custodial',84532,'fixture',?,?);
          INSERT INTO tokenless_payout_wallet_ownership
          (wallet_address,principal_id,first_binding_id,first_bound_at)
          VALUES ('0x1111111111111111111111111111111111111111','rlp_scheduled_recovery',
                  'binding_scheduled_recovery',?);
          INSERT INTO tokenless_rater_profiles
          (rater_id, principal_id, account_address, nullifier_seed_ciphertext, nullifier_key_version,
           nullifier_key_domain, created_at, updated_at)
          VALUES ('rater_scheduled_recovery', 'rlp_scheduled_recovery',
                  '0x1111111111111111111111111111111111111111',
                  'ciphertext', 'v1', 'vote_mapping', ?, ?)`,
    args: [NOW, NOW, NOW, NOW, NOW, NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_paid_vouchers
          (voucher_id, rater_id, request_idempotency_key, request_hash, chain_id, panel_address,
           issuer_address, issuer_epoch, signer_address, round_id, content_id, vote_key, nullifier,
           admission_policy_hash, assurance_snapshot_hash, expires_at, payout_account_snapshot,
           voucher_json, voucher_signature,
           status, issued_at)
          VALUES ('voucher_scheduled_recovery', 'rater_scheduled_recovery', 'voucher:scheduled:1',
                  'request-hash', 84532, '0x2222222222222222222222222222222222222222',
                  '0x3333333333333333333333333333333333333333', 1,
                  '0x3333333333333333333333333333333333333333', 42,
                  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                  '0x1111111111111111111111111111111111111111',
                  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                  '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
                  'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
                  ?, '0x1111111111111111111111111111111111111111', '{}', '0x12', 'issued', ?)`,
    args: [new Date(NOW.getTime() + 60_000), NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_rater_commits
          (commit_id, voucher_id, request_idempotency_key, request_hash, deployment_key, round_id,
           vote_key, sealed_commitment, sealed_payload_hash, payout_commitment, relay_payload_json,
           relay_nonce, relay_signed_transaction, transaction_hash, state, created_at, updated_at)
          VALUES (?, 'voucher_scheduled_recovery', 'commit:scheduled:1', 'request-hash', 'deployment', 42,
                  '0x1111111111111111111111111111111111111111',
                  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                  '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
                  '{}', 7, ?, ?, ?, ?, ?)`,
    args: [
      commitId,
      state === "submitted" ? null : "0x01",
      `0x${createHash("sha256").update(commitId).digest("hex")}`,
      state,
      NOW,
      NOW,
    ],
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(completed => {
    resolve = completed;
  });
  return { promise, resolve };
}

function processors(
  publish: (operationKey: string) => Promise<void>,
  notifications = { dead: 0, delivered: 0, enqueued: 0, materialized: 0, retry: 0, suppressed: 0 },
) {
  return {
    async deleteArtifact() {
      return true;
    },
    async publishFinalizedRound(input: { operationKey: string }) {
      await publish(input.operationKey);
    },
    async deliverWebhooks() {
      return [];
    },
    async projectAssuranceEvents() {
      return {
        scanned: 0,
        projected: 0,
        replayed: 0,
        retry: 0,
        deferredWithoutPacket: { gateBlocked: 0, reviewCompleted: 0 },
        retrySources: [],
      };
    },
    async deliverAssuranceEvents() {
      return [];
    },
    async processNotifications() {
      return notifications;
    },
    async processSurpriseBounties() {
      return { paid: 0, pendingClaim: 0, retry: 0, reconciliationRequired: 0 };
    },
    async processEvidenceRetention() {
      return {
        seeded: 0,
        due: 0,
        completed: 0,
        superseded: 0,
        retry: 0,
        dead: 0,
        objectsQueued: 0,
        accessLogsPruned: 0,
        objectsHeld: 0,
        accessLogsHeld: 0,
        backlog: 0,
        integrityRecordsPreserved: { auditEvents: 0, evidencePackets: 0, attestations: 0, wormReceipts: 0 },
        retryRunIds: [],
      };
    },
  };
}

test("scheduled maintenance publishes each due round once and deduplicates a cron bucket", async () => {
  await seedConfirmedExecution("operation_due_1");
  const published: string[] = [];
  const first = await runTokenlessScheduledMaintenance({
    appOrigin: "https://tokenless.example.test",
    now: NOW,
    processors: processors(async operationKey => {
      published.push(operationKey);
    }),
  });
  if (first.status === "duplicate") assert.fail("first invocation cannot be duplicate");
  assert.equal(first.status, "healthy");
  assert.deepEqual(first.summary.work, { completed: 1, dead: 0, deferred: 0, retry: 0 });
  assert.deepEqual(published, ["operation_due_1"]);

  const duplicate = await runTokenlessScheduledMaintenance({
    appOrigin: "https://tokenless.example.test",
    now: NOW,
    processors: processors(async operationKey => {
      published.push(operationKey);
    }),
  });
  assert.equal(duplicate.status, "duplicate");
  assert.deepEqual(published, ["operation_due_1"]);
});

test("scheduled work seeds only server-funded executions whose recovery claim is due", async () => {
  await seedRecoverableExecution("operation_recovery_due", {
    claimExpiresAt: new Date(NOW.getTime() - 1),
    state: "prepared",
  });
  await seedRecoverableExecution("operation_recovery_active", {
    claimExpiresAt: new Date(NOW.getTime() + 60_000),
    state: "signed",
  });
  const seeded = await seedTokenlessScheduledWork(NOW);
  assert.equal(seeded.chainRecoveries, 1);
  const items = await dbClient.execute({
    sql: `SELECT kind, subject_key, state FROM tokenless_scheduled_work_items
          WHERE kind = 'recover_chain_execution' ORDER BY subject_key`,
  });
  assert.deepEqual(items.rows, [
    { kind: "recover_chain_execution", state: "pending", subject_key: "operation_recovery_due" },
  ]);
});

test("scheduled maintenance recovers an initiated chain execution without another client request", async () => {
  await seedRecoverableExecution("operation_recovery_automatic", {
    claimExpiresAt: new Date(NOW.getTime() - 1),
    state: "signed",
  });
  const recovered: string[] = [];
  const result = await runTokenlessScheduledMaintenance({
    appOrigin: "https://tokenless.example.test",
    now: NOW,
    processors: {
      ...processors(async () => undefined),
      async recoverChainExecution({ operationKey }) {
        recovered.push(operationKey);
        return { paymentState: "confirmed" };
      },
    },
  });
  if (result.status === "duplicate") assert.fail("first invocation cannot be duplicate");
  assert.equal(result.status, "healthy");
  assert.deepEqual(recovered, ["operation_recovery_automatic"]);
  assert.deepEqual(result.summary.work, { completed: 1, dead: 0, deferred: 0, retry: 0 });
  const item = await dbClient.execute({
    sql: `SELECT state, attempt_count, claim_generation, last_error
          FROM tokenless_scheduled_work_items
          WHERE kind = 'recover_chain_execution' AND subject_key = 'operation_recovery_automatic'`,
  });
  assert.deepEqual(item.rows[0], { attempt_count: 1, claim_generation: 1, last_error: null, state: "completed" });
});

test("scheduled maintenance follows a submitted rater transaction through confirmation without another client request", async () => {
  await seedRecoverableRaterCommit("commit_recovery_automatic", "submitted");
  const recovered: string[] = [];
  const pending = await runTokenlessScheduledMaintenance({
    appOrigin: "https://tokenless.example.test",
    now: NOW,
    processors: {
      ...processors(async () => undefined),
      async recoverRaterCommit(commitId) {
        recovered.push(commitId);
        return { state: "submitted" };
      },
    },
  });
  if (pending.status === "duplicate") assert.fail("first invocation cannot be duplicate");
  assert.equal(pending.status, "healthy");
  assert.deepEqual(recovered, ["commit_recovery_automatic"]);
  assert.deepEqual(pending.summary.work, { completed: 0, dead: 0, deferred: 1, retry: 0 });
  const confirmed = await runTokenlessScheduledMaintenance({
    appOrigin: "https://tokenless.example.test",
    now: new Date(NOW.getTime() + 5 * 60_000),
    processors: {
      ...processors(async () => undefined),
      async recoverRaterCommit(commitId) {
        recovered.push(commitId);
        return { state: "confirmed" };
      },
    },
  });
  if (confirmed.status === "duplicate") assert.fail("the next cron bucket must run");
  assert.ok(confirmed.summary);
  assert.deepEqual(recovered, ["commit_recovery_automatic", "commit_recovery_automatic"]);
  assert.deepEqual(confirmed.summary.work, { completed: 1, dead: 0, deferred: 0, retry: 0 });
  const item = await dbClient.execute({
    sql: `SELECT state, attempt_count, claim_generation, last_error
          FROM tokenless_scheduled_work_items
          WHERE kind = 'recover_rater_commit' AND subject_key = 'commit_recovery_automatic'`,
  });
  assert.deepEqual(item.rows[0], { attempt_count: 1, claim_generation: 2, last_error: null, state: "completed" });
});

test("scheduled maintenance treats a reverted submitted rater transaction as terminal", async () => {
  await seedRecoverableRaterCommit("commit_recovery_reverted", "submitted");
  const result = await runTokenlessScheduledMaintenance({
    appOrigin: "https://tokenless.example.test",
    now: NOW,
    processors: {
      ...processors(async () => undefined),
      async recoverRaterCommit() {
        return { state: "failed" };
      },
    },
  });
  if (result.status === "duplicate") assert.fail("first invocation cannot be duplicate");
  assert.ok(result.summary);
  assert.deepEqual(result.summary.work, { completed: 1, dead: 0, deferred: 0, retry: 0 });
});

test("persistent chain recovery failures become dead-letter health evidence", async () => {
  await seedRecoverableExecution("operation_recovery_dead", {
    claimExpiresAt: new Date(NOW.getTime() - 1),
    state: "signed",
  });
  await seedTokenlessScheduledWork(NOW);
  await dbClient.execute({
    sql: `UPDATE tokenless_scheduled_work_items SET attempt_count = 19
          WHERE kind = 'recover_chain_execution' AND subject_key = 'operation_recovery_dead'`,
  });
  const result = await runTokenlessScheduledMaintenance({
    appOrigin: "https://tokenless.example.test",
    now: NOW,
    processors: {
      ...processors(async () => undefined),
      async recoverChainExecution() {
        throw new Error("persistent chain RPC failure");
      },
    },
  });
  if (result.status === "duplicate") assert.fail("first invocation cannot be duplicate");
  assert.equal(result.status, "degraded");
  assert.deepEqual(result.summary.work, { completed: 0, dead: 1, deferred: 0, retry: 0 });
  assert.equal(result.summary.deadWorkItems, 1);
  const item = await dbClient.execute({
    sql: `SELECT state, attempt_count, claim_generation, last_error, dead_at
          FROM tokenless_scheduled_work_items
          WHERE kind = 'recover_chain_execution' AND subject_key = 'operation_recovery_dead'`,
  });
  assert.equal(item.rows[0]?.state, "dead");
  assert.equal(item.rows[0]?.attempt_count, 20);
  assert.equal(item.rows[0]?.claim_generation, 1);
  assert.match(String(item.rows[0]?.last_error), /persistent chain RPC failure/u);
  assert.ok(item.rows[0]?.dead_at);
  const later = await runTokenlessScheduledMaintenance({
    appOrigin: "https://tokenless.example.test",
    now: new Date(NOW.getTime() + 5 * 60_000),
    processors: processors(async () => undefined),
  });
  if (later.status === "duplicate") assert.fail("the later cron bucket must run");
  assert.equal(later.status, "degraded");
  assert.equal(later.summary.deadWorkItems, 1);
});

test("a used x402 authorization dead-letters immediately instead of retrying a possibly paid operation", async () => {
  await seedRecoverableExecution("operation_x402_possibly_paid", {
    claimExpiresAt: new Date(NOW.getTime() - 1),
    state: "signed",
  });
  await seedTokenlessScheduledWork(NOW);
  const result = await runTokenlessScheduledMaintenance({
    appOrigin: "https://tokenless.example.test",
    now: NOW,
    processors: {
      ...processors(async () => undefined),
      async recoverChainExecution() {
        throw new TokenlessServiceError(
          "Authorization used; exact receipt reconciliation is required.",
          409,
          "x402_authorization_used_reconciliation_required",
        );
      },
    },
  });
  if (result.status === "duplicate") assert.fail("first invocation cannot be duplicate");
  assert.equal(result.status, "degraded");
  assert.deepEqual(result.summary.work, { completed: 0, dead: 1, deferred: 0, retry: 0 });
  const item = await dbClient.execute({
    sql: `SELECT state, attempt_count, last_error
          FROM tokenless_scheduled_work_items
          WHERE kind = 'recover_chain_execution' AND subject_key = 'operation_x402_possibly_paid'`,
  });
  assert.deepEqual(item.rows[0], {
    state: "dead",
    attempt_count: 1,
    last_error: "Authorization used; exact receipt reconciliation is required.",
  });
});

test("a reclaimed scheduled recovery claim fences the stale worker's completion", async () => {
  await seedRecoverableExecution("operation_recovery_fenced", {
    claimExpiresAt: new Date(NOW.getTime() - 1),
    state: "broadcast",
  });
  const staleStarted = deferred();
  const releaseStale = deferred();
  const staleRun = runTokenlessScheduledMaintenance({
    appOrigin: "https://tokenless.example.test",
    now: NOW,
    processors: {
      ...processors(async () => undefined),
      async recoverChainExecution() {
        staleStarted.resolve();
        await releaseStale.promise;
        return { paymentState: "confirmed" };
      },
    },
  });
  await staleStarted.promise;
  const reclaimNow = new Date(NOW.getTime() + 11 * 60_000);
  const reclaimed = await runTokenlessScheduledMaintenance({
    appOrigin: "https://tokenless.example.test",
    now: reclaimNow,
    processors: {
      ...processors(async () => undefined),
      async recoverChainExecution() {
        return { paymentState: "confirmed" };
      },
    },
  });
  if (reclaimed.status === "duplicate") assert.fail("the later cron bucket must run");
  assert.ok(reclaimed.summary);
  assert.deepEqual(reclaimed.summary.work, { completed: 1, dead: 0, deferred: 0, retry: 0 });
  releaseStale.resolve();
  const stale = await staleRun;
  if (stale.status === "duplicate") assert.fail("the original cron bucket must run");
  assert.ok(stale.summary);
  assert.deepEqual(stale.summary.work, { completed: 0, dead: 0, deferred: 0, retry: 0 });
  const item = await dbClient.execute({
    sql: `SELECT state, attempt_count, claim_generation, last_error
          FROM tokenless_scheduled_work_items
          WHERE kind = 'recover_chain_execution' AND subject_key = 'operation_recovery_fenced'`,
  });
  assert.deepEqual(item.rows[0], { attempt_count: 1, claim_generation: 2, last_error: null, state: "completed" });
});

test("a confirmed but not-finalized round is deferred without consuming its retry budget", async () => {
  await seedConfirmedExecution("operation_not_final");
  const result = await runTokenlessScheduledMaintenance({
    appOrigin: "https://tokenless.example.test",
    now: NOW,
    processors: processors(async () => {
      throw new TokenlessServiceError(
        "Indexed round is not completely finalized.",
        409,
        "indexed_evidence_pending",
        true,
      );
    }),
  });
  if (result.status === "duplicate") assert.fail("first invocation cannot be duplicate");
  assert.equal(result.status, "healthy");
  assert.deepEqual(result.summary.work, { completed: 0, dead: 0, deferred: 1, retry: 0 });
  const item = await dbClient.execute(
    "SELECT state, attempt_count, last_error FROM tokenless_scheduled_work_items WHERE subject_key = 'operation_not_final'",
  );
  assert.equal(item.rows[0]?.state, "retry");
  assert.equal(Number(item.rows[0]?.attempt_count), 0);
  assert.match(String(item.rows[0]?.last_error), /not completely finalized/);
});

test("old evidence-pending work degrades maintenance health instead of remaining silently green", async () => {
  await seedConfirmedExecution("operation_evidence_stale");
  await seedTokenlessScheduledWork(NOW);
  const result = await runTokenlessScheduledMaintenance({
    appOrigin: "https://tokenless.example.test",
    now: new Date(NOW.getTime() + 901_000),
    processors: processors(async () => {
      throw new TokenlessServiceError("Finalized round evidence is not indexed.", 409, "evidence_pending", true);
    }),
  });
  if (result.status === "duplicate") assert.fail("first invocation cannot be duplicate");
  assert.equal(result.status, "degraded");
  assert.deepEqual(result.summary.evidencePending, {
    pendingCount: 1,
    oldestCreatedAt: NOW.toISOString(),
    oldestAgeSeconds: 901,
    alertAfterSeconds: 900,
    alert: true,
  });
  assert.deepEqual(result.summary.work, { completed: 0, dead: 0, deferred: 1, retry: 0 });
});

test("a deletion processor that has not removed its object stays retryable instead of completing falsely", async () => {
  await dbClient.execute({
    sql: `INSERT INTO tokenless_scheduled_work_items
          (item_id, kind, subject_key, state, attempt_count, next_attempt_at, created_at, updated_at)
          VALUES ('swi_deletion_pending', 'delete_artifact', 'object_still_held', 'pending', 0, ?, ?, ?)`,
    args: [NOW, NOW, NOW],
  });
  const result = await runTokenlessScheduledMaintenance({
    appOrigin: "https://tokenless.example.test",
    now: NOW,
    processors: {
      ...processors(async () => undefined),
      async deleteArtifact() {
        return false;
      },
    },
  });
  if (result.status === "duplicate") assert.fail("first invocation cannot be duplicate");
  assert.equal(result.status, "healthy");
  assert.deepEqual(result.summary.work, { completed: 0, dead: 0, deferred: 1, retry: 0 });
  const item = await dbClient.execute(
    "SELECT state, attempt_count FROM tokenless_scheduled_work_items WHERE item_id = 'swi_deletion_pending'",
  );
  assert.deepEqual(item.rows[0], { attempt_count: 0, state: "retry" });
});

test("persistent worker failures become visible dead-letter health evidence", async () => {
  await seedConfirmedExecution("operation_broken");
  await seedTokenlessScheduledWork(NOW);
  await dbClient.execute({
    sql: "UPDATE tokenless_scheduled_work_items SET attempt_count = 19 WHERE subject_key = ?",
    args: ["operation_broken"],
  });
  const result = await runTokenlessScheduledMaintenance({
    appOrigin: "https://tokenless.example.test",
    now: NOW,
    processors: processors(async () => {
      throw new Error("permanent publication failure");
    }),
  });
  if (result.status === "duplicate") assert.fail("first invocation cannot be duplicate");
  assert.equal(result.status, "degraded");
  assert.deepEqual(result.summary.work, { completed: 0, dead: 1, deferred: 0, retry: 0 });
  const item = await dbClient.execute(
    "SELECT state, attempt_count, dead_at FROM tokenless_scheduled_work_items WHERE subject_key = 'operation_broken'",
  );
  assert.equal(item.rows[0]?.state, "dead");
  assert.equal(Number(item.rows[0]?.attempt_count), 20);
  assert.ok(item.rows[0]?.dead_at);
});

test("scheduled maintenance reports notification retries as degraded health evidence", async () => {
  const notificationSummary = { dead: 0, delivered: 1, enqueued: 2, materialized: 2, retry: 1, suppressed: 0 };
  const result = await runTokenlessScheduledMaintenance({
    appOrigin: "https://tokenless.example.test",
    now: NOW,
    processors: processors(async () => {}, notificationSummary),
  });
  if (result.status === "duplicate") assert.fail("first invocation cannot be duplicate");
  assert.equal(result.status, "degraded");
  assert.deepEqual(result.summary.notifications, notificationSummary);
});

test("scheduled maintenance projects assurance events, delivers them, and degrades on retry evidence", async () => {
  const base = processors(async () => {});
  const result = await runTokenlessScheduledMaintenance({
    appOrigin: "https://tokenless.example.test",
    now: NOW,
    processors: {
      ...base,
      async projectAssuranceEvents() {
        return {
          scanned: 2,
          projected: 1,
          replayed: 0,
          retry: 1,
          deferredWithoutPacket: { gateBlocked: 3, reviewCompleted: 0 },
          retrySources: ["hrtr_retry"],
        };
      },
      async deliverAssuranceEvents() {
        return [
          { deliveryId: "aed_delivered", state: "delivered" as const },
          { deliveryId: "aed_retry", state: "retry" as const },
        ];
      },
    },
  });
  if (result.status === "duplicate") assert.fail("first invocation cannot be duplicate");
  assert.equal(result.status, "degraded");
  assert.deepEqual(result.summary.assuranceEvents, {
    projection: {
      scanned: 2,
      projected: 1,
      replayed: 0,
      retry: 1,
      deferredWithoutPacket: { gateBlocked: 3, reviewCompleted: 0 },
      retrySources: ["hrtr_retry"],
    },
    delivery: { dead: 0, delivered: 1, retry: 1 },
  });
});

test("scheduled maintenance reports attestation retry, dead-letter, and adapter-unavailable health", async () => {
  const result = await runTokenlessScheduledMaintenance({
    appOrigin: "https://tokenless.example.test",
    now: NOW,
    processors: {
      ...processors(async () => {}),
      async processAttestations() {
        return { configured: false, due: 2, completed: 0, retry: 0, dead: 0, unavailable: 2 };
      },
    },
  });
  if (result.status === "duplicate") assert.fail("first invocation cannot be duplicate");
  assert.equal(result.status, "degraded");
  assert.deepEqual(result.summary.attestations, {
    configured: false,
    due: 2,
    completed: 0,
    retry: 0,
    dead: 0,
    unavailable: 2,
  });
});

test("scheduled maintenance degrades and reports evidence-retention retries", async () => {
  const result = await runTokenlessScheduledMaintenance({
    appOrigin: "https://tokenless.example.test",
    now: NOW,
    processors: {
      ...processors(async () => {}),
      async processEvidenceRetention() {
        return {
          seeded: 1,
          due: 1,
          completed: 0,
          superseded: 0,
          retry: 1,
          dead: 0,
          objectsQueued: 1,
          accessLogsPruned: 2,
          objectsHeld: 3,
          accessLogsHeld: 4,
          backlog: 5,
          integrityRecordsPreserved: { auditEvents: 6, evidencePackets: 7, attestations: 8, wormReceipts: 9 },
          retryRunIds: [`eer_${"1".repeat(40)}`],
        };
      },
    },
  });
  if (result.status === "duplicate") assert.fail("first invocation cannot be duplicate");
  assert.equal(result.status, "degraded");
  assert.equal(result.summary.evidenceRetention.retry, 1);
  assert.equal(result.summary.evidenceRetention.integrityRecordsPreserved.evidencePackets, 7);
});

test("scheduled maintenance remains degraded while a retention dead letter is unresolved", async () => {
  const base = processors(async () => {});
  const result = await runTokenlessScheduledMaintenance({
    appOrigin: "https://tokenless.example.test",
    now: NOW,
    processors: {
      ...base,
      async processEvidenceRetention() {
        const summary = await base.processEvidenceRetention();
        return { ...summary, dead: 1 };
      },
    },
  });
  if (result.status === "duplicate") assert.fail("first invocation cannot be duplicate");
  assert.equal(result.status, "degraded");
  assert.equal(result.summary.evidenceRetention.dead, 1);
});

test("scheduled maintenance degrades when dead deletion work leaves a retention backlog", async () => {
  const base = processors(async () => {});
  const result = await runTokenlessScheduledMaintenance({
    appOrigin: "https://tokenless.example.test",
    now: NOW,
    processors: {
      ...base,
      async processEvidenceRetention() {
        const summary = await base.processEvidenceRetention();
        return { ...summary, backlog: 1 };
      },
    },
  });
  if (result.status === "duplicate") assert.fail("first invocation cannot be duplicate");
  assert.equal(result.status, "degraded");
  assert.equal(result.summary.evidenceRetention.backlog, 1);
});

test("cron authorization fails closed when missing or incorrect", () => {
  assert.throws(
    () => authorizeTokenlessCron("Bearer secret", ""),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "cron_unavailable",
  );
  assert.throws(
    () => authorizeTokenlessCron("Bearer wrong", "correct"),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_cron_credential",
  );
  assert.doesNotThrow(() => authorizeTokenlessCron("Bearer correct", "correct"));
});

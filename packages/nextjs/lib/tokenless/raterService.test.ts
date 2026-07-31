import { HUMAN_ASSURANCE_SCHEMA_VERSION } from "@rateloop/sdk";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { type Address, type Hash, type Hex, keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { freezeAdmissionPolicy } from "~~/lib/tokenless/admissionPolicy";
import { EVM_TRANSACTION_FEE_POLICY } from "~~/lib/tokenless/chain/evmTransactionReplacement";
import type { TokenlessChainRuntime } from "~~/lib/tokenless/chain/runtime";
import { buildPublicVoucherRequest } from "~~/lib/tokenless/rater/publicVoucherRequest";
import { __raterServiceTestUtils, listPaidRaterTasks } from "~~/lib/tokenless/raterService";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const PRINCIPAL = `rlp_${"1".repeat(24)}`;
const RECOVERY_PRINCIPAL = `rlp_${"2".repeat(24)}`;
const NOW = new Date("2026-07-12T20:00:00.000Z");

function paidAdmissionPolicy() {
  return {
    schemaVersion: HUMAN_ASSURANCE_SCHEMA_VERSION,
    policyId: "policy_rater_tasks",
    version: 1,
    reviewerSource: "rateloop_network" as const,
    integrity: {
      schemaVersion: "rateloop.integrity-assignment.v1" as const,
      epochId: "integrity:2026-07-13:001",
      epochManifestHash: `sha256:${"a".repeat(64)}` as const,
      maxClusterShareBps: 2_000,
      allowedRiskBands: ["low", "medium"] as Array<"low" | "medium">,
      recentCoassignmentWindowSeconds: 2_592_000,
      maxRecentCoassignments: 0,
      maxPerCustomer: 3,
      onePerProviderSubject: true as const,
    },
    compensation: "paid" as const,
    cohorts: [],
    selection: "randomized" as const,
    fallbacks: { allowed: false, sources: [] },
    requiredQualifications: [],
    assurance: {
      requirements: [
        ...["account_control", "live_human", "minimum_age"].map(capability => ({
          capability: capability as "account_control" | "live_human" | "minimum_age",
          reviewerSources: ["rateloop_network" as const],
          allowedProviders: ["identity-production"],
        })),
        {
          capability: "unique_human" as const,
          reviewerSources: ["rateloop_network" as const],
          allowedProviders: ["world:poh"],
        },
      ],
    },
    buyerPrivacy: {
      visibleFields: ["reviewer_source" as const],
      minimumAggregationSize: 10,
      suppressSmallCells: true,
    },
    legalEligibilityRequired: true,
  };
}

function invitedPaidAdmissionPolicy() {
  return {
    schemaVersion: HUMAN_ASSURANCE_SCHEMA_VERSION,
    policyId: "policy_invited_rater_tasks",
    version: 1,
    reviewerSource: "customer_invited" as const,
    compensation: "paid" as const,
    cohorts: [{ cohortId: "cohort_invited_rater_tasks", minimumReviewers: 3, maximumReviewers: 3 }],
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
    buyerPrivacy: {
      visibleFields: ["reviewer_source" as const],
      minimumAggregationSize: 3,
      suppressSmallCells: true,
    },
    legalEligibilityRequired: true,
  };
}

beforeEach(async () => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  await dbClient.execute({
    sql: `INSERT INTO tokenless_principals (principal_id,status,created_at,updated_at)
          VALUES (?, 'active', ?, ?), (?, 'active', ?, ?)`,
    args: [PRINCIPAL, NOW, NOW, RECOVERY_PRINCIPAL, NOW, NOW],
  });
});
afterEach(() => __setDatabaseResourcesForTests(null));

async function seedRaterCommitState(input: {
  commitId: string;
  state: "signed" | "submitted";
  transactionHash?: Hash;
}) {
  const transactionHash = input.transactionHash ?? (`0x${"88".repeat(32)}` as Hash);
  await dbClient.execute({
    sql: `INSERT INTO tokenless_rater_profiles
          (rater_id, principal_id, account_address, nullifier_seed_ciphertext, nullifier_key_version,
           nullifier_key_domain, created_at, updated_at)
          VALUES ('rater_receipt', ?, ?, 'ciphertext', 'v1', 'vote_mapping', ?, ?)`,
    args: [PRINCIPAL, ACCOUNT, NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_paid_vouchers
          (voucher_id, rater_id, request_idempotency_key, request_hash, chain_id,
           panel_address, issuer_address, issuer_epoch, signer_address, round_id, content_id, vote_key,
           nullifier, admission_policy_hash, assurance_snapshot_hash, expires_at, payout_account_snapshot, voucher_json,
           voucher_signature, status, issued_at)
          VALUES ('voucher_receipt', 'rater_receipt', 'voucher:receipt:1', 'request-hash', 84532,
                  '0x2222222222222222222222222222222222222222',
                  '0x3333333333333333333333333333333333333333', 1,
                  '0x3333333333333333333333333333333333333333', 42,
                  ?, ?, ?, ?, ?, ?, ?, '{}', '0x12', 'issued', ?)`,
    args: [
      `0x${"11".repeat(32)}`,
      ACCOUNT,
      `0x${"22".repeat(32)}`,
      `0x${"33".repeat(32)}`,
      `sha256:${"44".repeat(32)}`,
      new Date(NOW.getTime() + 60_000),
      ACCOUNT,
      NOW,
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_rater_commits
          (commit_id, voucher_id, request_idempotency_key, request_hash, deployment_key, round_id,
           vote_key, sealed_commitment, sealed_payload_hash, payout_commitment, relay_payload_json,
           relay_nonce, relay_signed_transaction, transaction_hash, state, created_at, updated_at)
          VALUES (?, 'voucher_receipt', 'commit:receipt:1', 'request-hash', 'deployment-receipt', 42,
                  ?, ?, ?, ?, '{}', 7, '0x01', ?, ?, ?, ?)`,
    args: [
      input.commitId,
      ACCOUNT,
      `0x${"55".repeat(32)}`,
      `0x${"66".repeat(32)}`,
      `0x${"77".repeat(32)}`,
      transactionHash,
      input.state,
      NOW,
      NOW,
    ],
  });
  return {
    hash: transactionHash,
    signedTransaction: "0x01" as Hex,
    recovered: true,
  };
}

test("commit authorization rejects a sealed payload whose signed hash differs", () => {
  assert.throws(
    () =>
      __raterServiceTestUtils.validateAuthorization({
        roundId: "42",
        drandNetwork: "quicknet-t",
        beaconRound: 123,
        sealedPayload: "0x1234",
        sealedPayloadHash: `0x${"11".repeat(32)}`,
        sealedCommitment: `0x${"22".repeat(32)}`,
        payoutCommitment: `0x${"33".repeat(32)}`,
        panelAddress: "0x2222222222222222222222222222222222222222",
        chainId: 84532,
        nullifier: `0x${"44".repeat(32)}`,
        voteKey: "0x3333333333333333333333333333333333333333",
        voteKeySignature: `0x${"55".repeat(65)}`,
      }),
    /Sealed payload hash does not match/,
  );
});

test("commit authorization enforces the keeper-compatible 16 KiB ciphertext boundary before database work", () => {
  const authorization = (byteLength: number) => {
    const sealedPayload = toHex(new Uint8Array(byteLength));
    return {
      roundId: "42",
      drandNetwork: "quicknet-t" as const,
      beaconRound: 123,
      sealedPayload,
      sealedPayloadHash: keccak256(sealedPayload),
      sealedCommitment: `0x${"22".repeat(32)}` as const,
      payoutCommitment: `0x${"33".repeat(32)}` as const,
      panelAddress: "0x2222222222222222222222222222222222222222" as const,
      chainId: 84532,
      nullifier: `0x${"44".repeat(32)}` as const,
      voteKey: "0x3333333333333333333333333333333333333333" as const,
      voteKeySignature: `0x${"55".repeat(65)}` as const,
    };
  };
  assert.doesNotThrow(() => __raterServiceTestUtils.validateAuthorization(authorization(16_384)));
  assert.throws(
    () => __raterServiceTestUtils.validateAuthorization(authorization(16_385)),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_commit_authorization",
  );
});

test("rater commit replay lookup is voucher-scoped and cannot be preclaimed by another voucher", async () => {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const client = {
    async query(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      return { rows: [] };
    },
  };
  await __raterServiceTestUtils.lockCommitForVoucher(client as never, "voucher-b");
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.sql, /WHERE voucher_id = \$1 LIMIT 1 FOR UPDATE/u);
  assert.doesNotMatch(calls[0]!.sql, /request_idempotency_key/u);
  assert.deepEqual(calls[0]!.values, ["voucher-b"]);
});

test("a relay nonce reservation is idempotently bound to its prepared commit", async () => {
  await seedRaterCommitState({ commitId: "commit_nonce_reservation", state: "signed" });
  await dbClient.execute({
    sql: `UPDATE tokenless_rater_commits
          SET relay_nonce = NULL, relay_signed_transaction = NULL, transaction_hash = NULL, state = 'prepared'
          WHERE commit_id = 'commit_nonce_reservation'`,
  });
  const first = await __raterServiceTestUtils.reserveRelayNonce({
    commitId: "commit_nonce_reservation",
    deploymentKey: "deployment-receipt",
    signer: ACCOUNT,
    networkNonce: 5,
  });
  const replay = await __raterServiceTestUtils.reserveRelayNonce({
    commitId: "commit_nonce_reservation",
    deploymentKey: "deployment-receipt",
    signer: ACCOUNT,
    networkNonce: 99,
  });
  assert.equal(first, 5);
  assert.equal(replay, 5);
  const stored = await dbClient.execute({
    sql: `SELECT c.relay_nonce, n.next_nonce
          FROM tokenless_rater_commits c
          JOIN tokenless_chain_signer_nonces n
            ON n.deployment_key = c.deployment_key AND n.signer_address = ?
          WHERE c.commit_id = 'commit_nonce_reservation'`,
    args: [ACCOUNT.toLowerCase()],
  });
  assert.deepEqual(stored.rows[0], { next_nonce: 6, relay_nonce: 5 });
});

test("a signed rater transaction is durable before broadcast and replays exactly after acceptance ambiguity", async () => {
  const account = privateKeyToAccount(`0x${"77".repeat(32)}`);
  const panel = "0x2222222222222222222222222222222222222222" as Address;
  const data = "0x1234" as Hex;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_rater_profiles
          (rater_id, principal_id, account_address, nullifier_seed_ciphertext, nullifier_key_version,
           nullifier_key_domain, created_at, updated_at)
          VALUES ('rater_recovery', ?, ?, 'ciphertext', 'v1', 'vote_mapping', ?, ?)`,
    args: [RECOVERY_PRINCIPAL, account.address.toLowerCase(), NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_paid_vouchers
          (voucher_id, rater_id, request_idempotency_key, request_hash, chain_id,
           panel_address, issuer_address, issuer_epoch, signer_address, round_id, content_id, vote_key,
           nullifier, admission_policy_hash, assurance_snapshot_hash, expires_at, payout_account_snapshot, voucher_json,
           voucher_signature, status, issued_at)
          VALUES ('voucher_recovery', 'rater_recovery', 'voucher:recovery:1', 'request-hash', 84532,
                  ?, '0x3333333333333333333333333333333333333333', 1,
                  '0x3333333333333333333333333333333333333333', 42, ?, ?, ?, ?, ?, ?, ?, '{}',
                  '0x12', 'issued', ?)`,
    args: [
      panel,
      `0x${"11".repeat(32)}`,
      account.address,
      `0x${"22".repeat(32)}`,
      `0x${"33".repeat(32)}`,
      `sha256:${"44".repeat(32)}`,
      new Date(NOW.getTime() + 60_000),
      account.address.toLowerCase(),
      NOW,
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_rater_commits
          (commit_id, voucher_id, request_idempotency_key, request_hash, deployment_key, round_id,
           vote_key, sealed_commitment, sealed_payload_hash, payout_commitment, relay_payload_json,
           relay_nonce, state, created_at, updated_at)
          VALUES ('commit_recovery', 'voucher_recovery', 'commit:recovery:1', 'request-hash',
                  'deployment-recovery', 42, ?, ?, ?, ?, '{}', 7, 'prepared', ?, ?)`,
    args: [
      account.address.toLowerCase(),
      `0x${"55".repeat(32)}`,
      `0x${"66".repeat(32)}`,
      `0x${"77".repeat(32)}`,
      NOW,
      NOW,
    ],
  });
  const failingAccount = {
    ...account,
    async signTransaction() {
      throw new Error("injected signer outage after nonce reservation");
    },
  } as typeof account;
  const locator = {
    businessKey: "commit_recovery",
    businessKind: "rater_commit",
    deploymentKey: "deployment-recovery",
    signerRole: "gas_only_relayer",
    transactionKind: "relay",
  } as const;
  let overCapSignings = 0;
  const overCapAccount = {
    ...account,
    async signTransaction() {
      overCapSignings += 1;
      throw new Error("over-cap request reached signing");
    },
  } as typeof account;
  await assert.rejects(
    __raterServiceTestUtils.preparePersistedRaterTransaction({
      account: overCapAccount as never,
      commitId: "commit_recovery",
      data,
      nonce: 7,
      to: panel,
      locator,
      wallet: {
        async prepareTransactionRequest(transaction: Record<string, unknown>) {
          return {
            ...transaction,
            chainId: 84532,
            gas: 100_000n,
            maxFeePerGas: EVM_TRANSACTION_FEE_POLICY.maxFeePerGas + 1n,
            maxPriorityFeePerGas: 1n,
            type: "eip1559" as const,
          };
        },
      } as never,
    }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "evm_transaction_fee_policy_exhausted",
  );
  assert.equal(overCapSignings, 0);
  await assert.rejects(
    __raterServiceTestUtils.preparePersistedRaterTransaction({
      account: failingAccount as never,
      commitId: "commit_recovery",
      data,
      nonce: 7,
      to: panel,
      locator,
      wallet: {
        async prepareTransactionRequest(transaction: Record<string, unknown>) {
          return {
            ...transaction,
            chainId: 84532,
            gas: 100_000n,
            maxFeePerGas: 2n,
            maxPriorityFeePerGas: 1n,
            type: "eip1559" as const,
          };
        },
      } as never,
    }),
    /injected signer outage/u,
  );
  const unsigned = await dbClient.execute({
    sql: `SELECT relay_nonce, relay_signed_transaction, transaction_hash, state
          FROM tokenless_rater_commits WHERE commit_id = 'commit_recovery'`,
  });
  assert.deepEqual(unsigned.rows[0], {
    relay_nonce: 7,
    relay_signed_transaction: null,
    state: "prepared",
    transaction_hash: null,
  });
  let simulations = 0;
  const prepared = await __raterServiceTestUtils.preparePersistedRaterTransaction({
    account: account as never,
    commitId: "commit_recovery",
    data,
    nonce: 7,
    simulate: async () => {
      simulations += 1;
    },
    to: panel,
    locator,
    wallet: {
      async prepareTransactionRequest(transaction: Record<string, unknown>) {
        return {
          ...transaction,
          chainId: 84532,
          gas: 100_000n,
          maxFeePerGas: 2n,
          maxPriorityFeePerGas: 1n,
          type: "eip1559" as const,
        };
      },
    } as never,
  });
  assert.equal(simulations, 1);
  const durable = await dbClient.execute({
    sql: `SELECT state, relay_signed_transaction, transaction_hash
          FROM tokenless_rater_commits WHERE commit_id = 'commit_recovery'`,
  });
  assert.equal(durable.rows[0]?.state, "signed");
  assert.equal(durable.rows[0]?.relay_signed_transaction, prepared.signedTransaction);
  assert.equal(durable.rows[0]?.transaction_hash, prepared.hash);

  let accepted = false;
  const broadcasts: Hex[] = [];
  const publicClient = {
    async getTransaction({ hash }: { hash: Hash }) {
      if (!accepted) throw new Error("transaction_not_found");
      return { hash };
    },
  } as unknown as TokenlessChainRuntime["publicClient"];
  const wallet = {
    async sendRawTransaction({ serializedTransaction }: { serializedTransaction: Hex }) {
      broadcasts.push(serializedTransaction);
      accepted = true;
      throw new Error("connection dropped after acceptance");
    },
  } as unknown as TokenlessChainRuntime["relayerWallet"];
  await __raterServiceTestUtils.broadcastPersistedRaterTransaction(wallet!, publicClient, prepared);
  await __raterServiceTestUtils.broadcastPersistedRaterTransaction(wallet!, publicClient, {
    ...prepared,
    recovered: true,
  });
  assert.deepEqual(broadcasts, [prepared.signedTransaction]);
});

test("a late broadcast error cannot regress a concurrently submitted rater commit to retry", async () => {
  const transaction = await seedRaterCommitState({ commitId: "commit_retry_race", state: "signed" });
  await dbClient.execute({
    sql: "UPDATE tokenless_rater_commits SET state = 'submitted', failure_code = NULL WHERE commit_id = ?",
    args: ["commit_retry_race"],
  });

  await __raterServiceTestUtils.markRaterTransactionRetry("commit_retry_race", transaction);

  const stored = await dbClient.execute({
    sql: "SELECT state, failure_code FROM tokenless_rater_commits WHERE commit_id = ?",
    args: ["commit_retry_race"],
  });
  assert.deepEqual(stored.rows[0], { failure_code: null, state: "submitted" });

  await dbClient.execute({
    sql: "UPDATE tokenless_rater_commits SET state = 'confirmed' WHERE commit_id = ?",
    args: ["commit_retry_race"],
  });
  await __raterServiceTestUtils.markRaterTransactionRetry("commit_retry_race", transaction);
  const confirmed = await dbClient.execute({
    sql: "SELECT state, failure_code FROM tokenless_rater_commits WHERE commit_id = ?",
    args: ["commit_retry_race"],
  });
  assert.deepEqual(confirmed.rows[0], { failure_code: null, state: "confirmed" });
});

test("receipt reconciliation confirms a submitted rater commit and commits its voucher", async () => {
  const transaction = await seedRaterCommitState({ commitId: "commit_receipt_success", state: "submitted" });
  const stored = await dbClient.execute({
    sql: "SELECT * FROM tokenless_rater_commits WHERE commit_id = ?",
    args: ["commit_receipt_success"],
  });
  const settled = await __raterServiceTestUtils.reconcileSubmittedRaterCommitReceipt(stored.rows[0]!, {
    async getTransactionReceipt({ hash }: { hash: Hash }) {
      assert.equal(hash, transaction.hash);
      return { status: "success" };
    },
  } as unknown as TokenlessChainRuntime["publicClient"]);

  assert.equal(settled.state, "confirmed");
  assert.equal(settled.failure_code, null);
  assert.ok(settled.confirmed_at);
  const voucher = await dbClient.execute({
    sql: "SELECT status, committed_at FROM tokenless_paid_vouchers WHERE voucher_id = 'voucher_receipt'",
  });
  assert.equal(voucher.rows[0]?.status, "committed");
  assert.ok(voucher.rows[0]?.committed_at);
});

test("receipt reconciliation records a reverted submitted rater commit as failed", async () => {
  await seedRaterCommitState({ commitId: "commit_receipt_reverted", state: "submitted" });
  const stored = await dbClient.execute({
    sql: "SELECT * FROM tokenless_rater_commits WHERE commit_id = ?",
    args: ["commit_receipt_reverted"],
  });
  const settled = await __raterServiceTestUtils.reconcileSubmittedRaterCommitReceipt(stored.rows[0]!, {
    async getTransactionReceipt() {
      return { status: "reverted" };
    },
  } as unknown as TokenlessChainRuntime["publicClient"]);

  assert.equal(settled.state, "failed");
  assert.equal(settled.failure_code, "transaction_reverted");
  assert.equal(settled.confirmed_at, null);
  const voucher = await dbClient.execute({
    sql: "SELECT status, committed_at FROM tokenless_paid_vouchers WHERE voucher_id = 'voucher_receipt'",
  });
  assert.deepEqual(voucher.rows[0], { committed_at: null, status: "issued" });
});

async function seedTask(
  executionState: "confirmed" | "submitted" = "confirmed",
  reviewerSource: "rateloop_network" | "customer_invited" = "rateloop_network",
) {
  const frozenPolicy = freezeAdmissionPolicy(
    reviewerSource === "rateloop_network" ? paidAdmissionPolicy() : invitedPaidAdmissionPolicy(),
  );
  await dbClient.execute({
    sql: "INSERT INTO tokenless_workspaces (workspace_id, name, status, created_at, updated_at) VALUES ('ws_tasks', 'Tasks', 'active', ?, ?)",
    args: [NOW, NOW],
  });
  await dbClient.execute({
    sql: "INSERT INTO tokenless_agent_quotes (quote_id, request_hash, request_json, response_json, expires_at, created_at) VALUES ('quote_tasks', 'hash', '{\"visibility\":\"public\"}', '{}', ?, ?)",
    args: [new Date(NOW.getTime() + 60_000), NOW],
  });
  await dbClient.execute({
    sql: "INSERT INTO tokenless_agent_asks (operation_key, idempotency_key, request_hash, quote_id, request_json, economics_json, status, created_at, updated_at) VALUES ('op_tasks', 'task:test:1234', 'hash', 'quote_tasks', '{}', '{}', 'open', ?, ?)",
    args: [NOW, NOW],
  });
  await dbClient.execute({
    sql: "INSERT INTO tokenless_content_records (content_id, workspace_id, content_hash, content_json, moderation_status, created_at, updated_at) VALUES ('cnt_tasks', 'ws_tasks', ?, ?, 'approved', ?, ?)",
    args: [
      `${"11".repeat(32)}`,
      JSON.stringify({ kind: "binary", media: { kind: "youtube", videoId: "dQw4w9WgXcQ" }, prompt: "Ship it?" }),
      NOW,
      NOW,
    ],
  });
  await dbClient.execute({
    sql: "INSERT INTO tokenless_question_records (question_id, workspace_id, content_id, quote_id, terms_hash, terms_json, visibility, data_classification, confirmed_no_sensitive_data, moderation_status, created_at, updated_at) VALUES ('qst_tasks', 'ws_tasks', 'cnt_tasks', 'quote_tasks', ?, '{}', 'public', 'synthetic', true, 'approved', ?, ?)",
    args: [`${"22".repeat(32)}`, NOW, NOW],
  });
  await dbClient.execute({
    sql: "INSERT INTO tokenless_ask_ownership (operation_key, workspace_id, owner_account_address, question_id, payment_mode, payment_state, payment_reference, idempotency_key, created_at, updated_at) VALUES ('op_tasks', 'ws_tasks', ?, 'qst_tasks', 'prepaid', 'confirmed', 'payment', 'task:test:1234', ?, ?)",
    args: [ACCOUNT, NOW, NOW],
  });
  const panel = "0x2222222222222222222222222222222222222222";
  await dbClient.execute({
    sql: `INSERT INTO tokenless_chain_executions
          (execution_id, operation_key, payment_mode, payment_reference, deployment_key, chain_id, deployment_block,
           panel_address, issuer_address, x402_submitter_address, usdc_address, funder_address, content_id, terms_hash,
           round_terms_json, total_funded_atomic, state, round_id, created_at, updated_at)
          VALUES ('exec_tasks', 'op_tasks', 'prepaid', 'payment', 'deployment', 84532, 1, ?, ?, ?, ?, ?, ?, ?, ?, 31875000, ?, 42, ?, ?)`,
    args: [
      panel,
      "0x3333333333333333333333333333333333333333",
      "0x4444444444444444444444444444444444444444",
      "0x5555555555555555555555555555555555555555",
      ACCOUNT,
      `0x${"11".repeat(32)}`,
      `0x${"22".repeat(32)}`,
      JSON.stringify({
        bountyAmount: "25000000",
        attemptCompensation: "333333",
        maximumCommits: 15,
        admissionPolicyHash: frozenPolicy.admissionPolicyHash,
        beaconRound: "123",
        scoringBeaconRound: "163",
        beaconNetworkHash: `0x${"66".repeat(32)}`,
      }),
      executionState,
      NOW,
      NOW,
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_voucher_rounds
          (chain_id, panel_address, round_id, content_id, admission_policy_hash, admission_policy_json,
           maximum_commits, voucher_not_before, voucher_deadline, status, created_at, updated_at)
          VALUES (84532, ?, 42, ?, ?, ?, 15, ?, ?, 'open', ?, ?)`,
    args: [
      panel,
      `0x${"11".repeat(32)}`,
      frozenPolicy.admissionPolicyHash,
      frozenPolicy.policyJson,
      new Date(NOW.getTime() - 1_000),
      new Date(NOW.getTime() + 60_000),
      NOW,
      NOW,
    ],
  });
  return frozenPolicy;
}

async function seedCanonicalInvitedTaskBridge() {
  const frozenPolicy = await seedTask("confirmed", "customer_invited");
  const assignmentExpiresAt = new Date(NOW.getTime() + 60_000);
  const eligibilityExpiresAt = new Date(NOW.getTime() + 120_000);

  // The task-list join depends only on these five bridge records. Their production
  // services separately cover the larger workspace/project setup graph, so this
  // focused integration fixture removes only those peripheral foreign keys while
  // retaining every bridge row, state, timestamp, hash, and identity relationship.
  for (const [tableName, constraintName] of [
    ["tokenless_paid_assignment_operations", "tokenless_paid_assignment_operations_opportunity_fk"],
    ["tokenless_paid_assignment_operations", "tokenless_paid_assignment_operations_api_key_fk"],
    ["tokenless_paid_assignment_operations", "tokenless_paid_assignment_operations_policy_fk"],
    ["tokenless_paid_assignment_operations", "tokenless_paid_assignment_operations_prepaid_fk"],
    ["tokenless_paid_assignment_operations", "tokenless_paid_assignment_operations_policy_reservation_fk"],
    ["tokenless_private_unpaid_review_assignments", "tokenless_private_unpaid_review_assignments_delivery_id_fk"],
    ["tokenless_private_unpaid_review_assignments", "tokenless_private_unpaid_review_assignments_workspace_id_fk"],
    ["tokenless_private_unpaid_review_assignments", "tokenless_private_unpaid_review_assignments_project_id_fk"],
    ["tokenless_private_unpaid_review_assignments", "tokenless_private_unpaid_review_assignments_private_review_id_fk"],
    ["tokenless_private_unpaid_review_assignments", "tokenless_private_unpaid_review_assignments_private_group_id_fk"],
    ["tokenless_private_unpaid_review_assignments", "tokenless_private_unpaid_review_assignments_cohort_reviewer_fk"],
    ["tokenless_paid_review_eligibility_snapshots", "tokenless_paid_review_eligibility_snapshots_opportunity_fk"],
    ["tokenless_paid_review_eligibility_snapshots", "tokenless_paid_review_eligibility_snapshots_profile_fk"],
    ["tokenless_paid_review_voucher_issuances", "tokenless_paid_review_voucher_issuances_opportunity_fk"],
    ["tokenless_paid_review_voucher_issuances", "tokenless_paid_review_voucher_issuances_profile_fk"],
  ]) {
    await dbClient.execute(`ALTER TABLE "${tableName}" DROP CONSTRAINT "${constraintName}"`);
  }

  await dbClient.execute({
    sql: `INSERT INTO tokenless_rater_profiles
          (rater_id,principal_id,account_address,nullifier_seed_ciphertext,nullifier_key_version,
           nullifier_key_domain,created_at,updated_at)
          VALUES ('rater_invited_task',? ,?,'ciphertext','v1','vote_mapping',?,?)`,
    args: [PRINCIPAL, ACCOUNT.toLowerCase(), NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_paid_assignment_operations
          (operation_id,workspace_id,opportunity_id,lane,api_key_id,publishing_policy_id,
           publishing_policy_version,request_idempotency_key,request_hash,prepared_request_hash,
           economics_hash,reviewer_set_hash,audience_policy_hash,chain_admission_policy_hash,
           admission_policy_json,artifact_commitments_json,artifact_binding_hash,expected_amount_atomic,
           state,transition_revision,quote_id,quote_expires_at,ask_operation_key,prepaid_reservation_id,
           policy_reservation_id,deployment_key,chain_id,panel_address,round_id,content_id,terms_hash,
           round_terms_hash,payment_mode,payment_reference,commit_deadline,confirmed_at,bound_at,
           created_at,updated_at)
          VALUES ('operation_invited_task','ws_tasks','opportunity_invited_task','private_invited_paid',
                  'api_key_invited_task','publishing_policy_invited_task',1,'paid:invited:task',
                  ?,?,?,?,?,?,?,'[]',?,31875000,'round_bound',1,'quote_tasks',?,'op_tasks',
                  'prepaid_invited_task','policy_reservation_invited_task','deployment',84532,?,42,?,?,?,
                  'prepaid','prepaid_invited_task',?,?,?,?,?)`,
    args: [
      `sha256:${"1".repeat(64)}`,
      `sha256:${"2".repeat(64)}`,
      `sha256:${"3".repeat(64)}`,
      `sha256:${"4".repeat(64)}`,
      `sha256:${"5".repeat(64)}`,
      frozenPolicy.admissionPolicyHash,
      frozenPolicy.policyJson,
      `sha256:${"6".repeat(64)}`,
      assignmentExpiresAt,
      "0x2222222222222222222222222222222222222222",
      `0x${"11".repeat(32)}`,
      `0x${"22".repeat(32)}`,
      `sha256:${"7".repeat(64)}`,
      assignmentExpiresAt,
      NOW,
      NOW,
      NOW,
      NOW,
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_private_unpaid_review_assignments
          (assignment_id,delivery_id,workspace_id,project_id,private_review_id,cohort_id,private_group_id,
           reviewer_account_address,membership_joined_at,membership_expires_at,membership_allowed_projects_hash,
           qualification_snapshot_json,membership_snapshot_hash,snapshot_cutoff_at,reservation_expires_at,
           response_deadline,status,accepted_at,assignment_expires_at,lease_state,created_at,updated_at)
          VALUES ('assignment_invited_task','delivery_invited_task','ws_tasks','project_invited_task',
                  'private_review_invited_task','cohort_invited_task','group_invited_task',?,?,?,?,
                  '{}',?,?,?,?,'accepted',?,?,'issued',?,?)`,
    args: [
      ACCOUNT.toLowerCase(),
      NOW,
      assignmentExpiresAt,
      `sha256:${"8".repeat(64)}`,
      `sha256:${"9".repeat(64)}`,
      NOW,
      assignmentExpiresAt,
      assignmentExpiresAt,
      NOW,
      assignmentExpiresAt,
      NOW,
      NOW,
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_paid_review_eligibility_snapshots
          (snapshot_id,snapshot_version,workspace_id,opportunity_id,rater_id,request_profile_id,
           request_profile_version,request_profile_hash,audience_binding_hash,economics_hash,
           paid_eligibility_preflight_ref,paid_eligibility_preflight_hash,snapshot_json,snapshot_hash,
           verified_at,expires_at,created_at)
          VALUES ('snapshot_invited_task',1,'ws_tasks','opportunity_invited_task','rater_invited_task',
                  'profile_invited_task',1,?,?,?,?,?,'{}',?,?,?,?)`,
    args: [
      `sha256:${"a".repeat(64)}`,
      `sha256:${"b".repeat(64)}`,
      `sha256:${"c".repeat(64)}`,
      "preflight_invited_task",
      `sha256:${"d".repeat(64)}`,
      `sha256:${"e".repeat(64)}`,
      NOW,
      eligibilityExpiresAt,
      NOW,
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_paid_review_voucher_issuances
          (issuance_id,workspace_id,opportunity_id,rater_id,request_idempotency_key,request_hash,
           snapshot_id,snapshot_version,snapshot_hash,request_profile_id,request_profile_version,
           request_profile_hash,audience_binding_hash,economics_hash,paid_eligibility_preflight_ref,
           paid_eligibility_preflight_hash,status,created_at,updated_at)
          VALUES ('issuance_invited_task','ws_tasks','opportunity_invited_task','rater_invited_task',
                  'voucher:invited:task',?,'snapshot_invited_task',1,?,'profile_invited_task',1,
                  ?,?,?,?,?,'prepared',?,?)`,
    args: [
      `sha256:${"f".repeat(64)}`,
      `sha256:${"e".repeat(64)}`,
      `sha256:${"a".repeat(64)}`,
      `sha256:${"b".repeat(64)}`,
      `sha256:${"c".repeat(64)}`,
      "preflight_invited_task",
      `sha256:${"d".repeat(64)}`,
      NOW,
      NOW,
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_paid_assignment_seats
          (seat_id,operation_id,position,reviewer_principal_id,rater_id,payout_account,identity_commitment,
           assignment_id,voucher_issuance_id,state,transition_revision,created_at,updated_at)
          VALUES ('seat_invited_task','operation_invited_task',0,?,'rater_invited_task',?,?,
                  'assignment_invited_task','issuance_invited_task','voucher_prepared',1,?,?)`,
    args: [PRINCIPAL, ACCOUNT.toLowerCase(), `sha256:${"0".repeat(64)}`, NOW, NOW],
  });
}

test("task discovery fails closed until the real chain execution is confirmed", async () => {
  await seedTask("submitted");
  assert.deepEqual(await listPaidRaterTasks(PRINCIPAL, NOW), []);
});

test("network task discovery stays hidden until an exact selected seat exists", async () => {
  await seedTask();
  const tasks = await listPaidRaterTasks(PRINCIPAL, NOW);
  assert.deepEqual(tasks, []);
});

test("customer-invited task discovery stays hidden without its exact prepared assignment and issuance", async () => {
  await seedTask("confirmed", "customer_invited");
  assert.deepEqual(await listPaidRaterTasks(PRINCIPAL, NOW), []);
  assert.deepEqual(await listPaidRaterTasks(null, NOW), []);
});

test("customer-invited task discovery returns only the bound principal's canonical assignment and issuance", async () => {
  await seedCanonicalInvitedTaskBridge();

  const tasks = await listPaidRaterTasks(PRINCIPAL, NOW);
  assert.equal(tasks.length, 1);
  const task = tasks[0];
  assert.ok(task);
  assert.equal(task.reviewerSource, "customer_invited");
  assert.equal(task.assignmentId, "assignment_invited_task");
  assert.equal("issuanceId" in task ? task.issuanceId : null, "issuance_invited_task");
  assert.deepEqual(await listPaidRaterTasks(RECOVERY_PRINCIPAL, NOW), []);
});

function invitedTaskBindingRow(
  input: {
    assignmentExpiresAt?: Date;
    eligibilityExpiresAt?: Date;
    principalId?: string;
    issuanceStatus?: "prepared" | "issued";
  } = {},
) {
  const frozen = freezeAdmissionPolicy(invitedPaidAdmissionPolicy());
  return {
    admission_policy_json: frozen.policyJson,
    admission_policy_hash: frozen.admissionPolicyHash,
    invited_assignment_id: "assignment_invited_task",
    invited_issuance_id: "issuance_invited_task",
    invited_principal_id: input.principalId ?? PRINCIPAL,
    invited_assignment_status: "accepted",
    invited_assignment_expires_at: input.assignmentExpiresAt ?? new Date(NOW.getTime() + 60_000),
    invited_issuance_status: input.issuanceStatus ?? "prepared",
    invited_eligibility_expires_at: input.eligibilityExpiresAt ?? new Date(NOW.getTime() + 60_000),
  };
}

test("customer-invited task bindings preserve exact legitimate assignment and issuance access", () => {
  assert.deepEqual(__raterServiceTestUtils.paidTaskAssignmentBinding(invitedTaskBindingRow(), PRINCIPAL, NOW), {
    reviewerSource: "customer_invited",
    assignmentId: "assignment_invited_task",
    issuanceId: "issuance_invited_task",
  });
});

test("customer-invited task bindings reject anonymous and cross-principal access", () => {
  const row = invitedTaskBindingRow();
  assert.equal(__raterServiceTestUtils.paidTaskAssignmentBinding(row, null, NOW), null);
  assert.equal(__raterServiceTestUtils.paidTaskAssignmentBinding(row, RECOVERY_PRINCIPAL, NOW), null);
  assert.equal(
    __raterServiceTestUtils.paidTaskAssignmentBinding(
      invitedTaskBindingRow({ principalId: RECOVERY_PRINCIPAL }),
      PRINCIPAL,
      NOW,
    ),
    null,
  );
});

test("customer-invited task bindings reject expired assignments and stale prepared eligibility", () => {
  assert.equal(
    __raterServiceTestUtils.paidTaskAssignmentBinding(
      invitedTaskBindingRow({ assignmentExpiresAt: new Date(NOW.getTime() - 1) }),
      PRINCIPAL,
      NOW,
    ),
    null,
  );
  assert.equal(
    __raterServiceTestUtils.paidTaskAssignmentBinding(
      invitedTaskBindingRow({ eligibilityExpiresAt: new Date(NOW.getTime() - 1) }),
      PRINCIPAL,
      NOW,
    ),
    null,
  );
  assert.deepEqual(
    __raterServiceTestUtils.paidTaskAssignmentBinding(
      invitedTaskBindingRow({
        eligibilityExpiresAt: new Date(NOW.getTime() - 1),
        issuanceStatus: "issued",
      }),
      PRINCIPAL,
      NOW,
    ),
    {
      reviewerSource: "customer_invited",
      assignmentId: "assignment_invited_task",
      issuanceId: "issuance_invited_task",
    },
  );
});

test("paid task discovery never exposes private question material through a public network round", async () => {
  await seedTask();
  await dbClient.execute(
    "UPDATE tokenless_question_records SET visibility='private',data_classification='confidential',confirmed_no_sensitive_data=false WHERE question_id='qst_tasks'",
  );
  assert.deepEqual(await listPaidRaterTasks(PRINCIPAL, NOW), []);
});

test("public voucher requests carry the exact network assignment binding", () => {
  assert.deepEqual(
    buildPublicVoucherRequest(
      {
        roundId: "42",
        contentId: `0x${"11".repeat(32)}`,
        reviewerSource: "rateloop_network",
        assignmentId: "assignment_exact",
        selectionBindingHash: `sha256:${"a".repeat(64)}`,
      },
      {
        idempotencyKey: "voucher:web:42",
        voteKey: ACCOUNT,
      },
    ),
    {
      idempotencyKey: "voucher:web:42",
      roundId: "42",
      contentId: `0x${"11".repeat(32)}`,
      voteKey: ACCOUNT,
      reviewerSource: "rateloop_network",
      assignmentId: "assignment_exact",
      selectionBindingHash: `sha256:${"a".repeat(64)}`,
    },
  );
});

test("public voucher requests carry the exact invited assignment and issuance binding", () => {
  assert.deepEqual(
    buildPublicVoucherRequest(
      {
        roundId: "42",
        contentId: `0x${"11".repeat(32)}`,
        reviewerSource: "customer_invited",
        assignmentId: "assignment_invited_task",
        issuanceId: "issuance_invited_task",
      },
      {
        idempotencyKey: "voucher:web:42",
        voteKey: ACCOUNT,
      },
    ),
    {
      idempotencyKey: "voucher:web:42",
      roundId: "42",
      contentId: `0x${"11".repeat(32)}`,
      voteKey: ACCOUNT,
      reviewerSource: "customer_invited",
      assignmentId: "assignment_invited_task",
      issuanceId: "issuance_invited_task",
    },
  );
});

test("task discovery fails closed when the persisted reviewer source no longer matches its frozen hash", async () => {
  await seedTask();
  const stored = await dbClient.execute(
    "SELECT admission_policy_json FROM tokenless_voucher_rounds WHERE round_id = 42",
  );
  const mismatched = {
    ...(JSON.parse(String(stored.rows[0]?.admission_policy_json)) as Record<string, unknown>),
    reviewerSource: "customer_invited",
  };
  await dbClient.execute({
    sql: "UPDATE tokenless_voucher_rounds SET admission_policy_json = ? WHERE round_id = 42",
    args: [JSON.stringify(mismatched)],
  });
  assert.deepEqual(await listPaidRaterTasks(PRINCIPAL, NOW), []);
});

test("anonymous browsing cannot discover principal-bound network seats", async () => {
  await seedTask();
  const tasks = await listPaidRaterTasks(null, NOW);
  assert.deepEqual(tasks, []);
});

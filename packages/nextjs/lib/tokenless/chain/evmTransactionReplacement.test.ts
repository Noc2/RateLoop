import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { type Hash, type Hex, TransactionReceiptNotFoundError, keccak256, parseTransaction } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  type DurableEvmTransaction,
  EVM_FEE_REPLACEMENT_MIN_AGE_MS,
  EVM_TRANSACTION_FEE_POLICY,
  __evmTransactionReplacementTestUtils,
  maybeReplaceUnobservedEvmTransaction,
  persistInitialEvmTransaction,
} from "~~/lib/tokenless/chain/evmTransactionReplacement";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const ACCOUNT = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const DEPLOYMENT_KEY = "tokenless-v3:test";
const FENCING_TOKEN = 1;
const NONCE = 7;
const NOW = new Date("2026-07-20T12:00:00.000Z");
const OPERATION_KEY = "operation_fee_replacement";
const RECIPIENT = "0x1111111111111111111111111111111111111111";

const locator = {
  businessKey: OPERATION_KEY,
  businessKind: "chain_execution" as const,
  deploymentKey: DEPLOYMENT_KEY,
  fencingToken: FENCING_TOKEN,
  signerRole: "prepaid_funder" as const,
  transactionKind: "approval" as const,
};

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
});

async function seedExecution() {
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_asks
          (operation_key, idempotency_key, request_hash, quote_id, request_json, economics_json,
           status, created_at, updated_at)
          VALUES (?, ?, 'request-hash', 'quote-test', '{}', '{}', 'open', ?, ?);
          INSERT INTO tokenless_chain_executions
          (execution_id, operation_key, payment_mode, payment_reference, deployment_key, chain_id,
           deployment_block, panel_address, issuer_address, x402_submitter_address, usdc_address,
           funder_address, content_id, terms_hash, round_terms_json, total_funded_atomic, state,
           approval_nonce, transaction_recovery_version, claim_fencing_token, created_at, updated_at)
          VALUES (?, ?, 'prepaid', ?, ?, 84532, 1,
                  '0x2222222222222222222222222222222222222222',
                  '0x3333333333333333333333333333333333333333',
                  '0x4444444444444444444444444444444444444444',
                  '0x5555555555555555555555555555555555555555',
                  ?,
                  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                  '{}', 1, 'prepared', ?, 1, ?, ?, ?)`,
    args: [
      OPERATION_KEY,
      `idem:${OPERATION_KEY}`,
      NOW,
      NOW,
      `exec:${OPERATION_KEY}`,
      OPERATION_KEY,
      `payment:${OPERATION_KEY}`,
      DEPLOYMENT_KEY,
      ACCOUNT.address.toLowerCase(),
      NONCE,
      FENCING_TOKEN,
      NOW,
      NOW,
    ],
  });
}

async function signedTransaction(input: {
  gas?: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  to?: `0x${string}`;
}) {
  const signed = await ACCOUNT.signTransaction({
    chainId: 84532,
    data: "0x12345678",
    gas: input.gas ?? 75_000n,
    maxFeePerGas: input.maxFeePerGas,
    maxPriorityFeePerGas: input.maxPriorityFeePerGas,
    nonce: NONCE,
    to: input.to ?? RECIPIENT,
    type: "eip1559",
    value: 42n,
  });
  return { hash: keccak256(signed), signedTransaction: signed };
}

function countingAccount(onSign: () => void) {
  return {
    ...ACCOUNT,
    async signTransaction(transaction: Parameters<typeof ACCOUNT.signTransaction>[0]) {
      onSign();
      return ACCOUNT.signTransaction(transaction);
    },
  } as typeof ACCOUNT;
}

function pendingPublicClient(input: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }) {
  return {
    async estimateFeesPerGas() {
      return input;
    },
    async getTransaction({ hash }: { hash: Hash }) {
      return { blockNumber: null, hash };
    },
    async getTransactionCount({ blockTag }: { blockTag: string }) {
      assert.equal(blockTag, "latest");
      return NONCE;
    },
    async getTransactionReceipt({ hash }: { hash: Hash }) {
      throw new TransactionReceiptNotFoundError({ hash });
    },
  } as never;
}

test("an observed pending underpriced transaction is replaced repeatedly with one immutable intent and nonce", async () => {
  await seedExecution();
  const original = await signedTransaction({ maxFeePerGas: 100n, maxPriorityFeePerGas: 10n });
  const firstSeenAt = new Date(NOW.getTime() - EVM_FEE_REPLACEMENT_MIN_AGE_MS);
  const durable = await persistInitialEvmTransaction({
    account: ACCOUNT,
    locator,
    now: firstSeenAt,
    transaction: original,
  });

  const firstReplacement = await maybeReplaceUnobservedEvmTransaction({
    account: ACCOUNT,
    locator,
    now: NOW,
    publicClient: pendingPublicClient({ maxFeePerGas: 500n, maxPriorityFeePerGas: 25n }),
    transaction: durable,
  });
  assert.equal(firstReplacement.replaced, true);
  const secondReplacement = await maybeReplaceUnobservedEvmTransaction({
    account: ACCOUNT,
    locator,
    now: new Date(NOW.getTime() + EVM_FEE_REPLACEMENT_MIN_AGE_MS),
    publicClient: pendingPublicClient({ maxFeePerGas: 900n, maxPriorityFeePerGas: 40n }),
    transaction: firstReplacement,
  });
  assert.equal(secondReplacement.replaced, true);

  const versions = await dbClient.execute({
    sql: `SELECT generation, nonce, signed_transaction, transaction_hash, signature_hash,
                 max_fee_per_gas, max_priority_fee_per_gas
          FROM tokenless_evm_transaction_versions
          WHERE business_kind = 'chain_execution' AND business_key = ? AND transaction_kind = 'approval'
          ORDER BY generation`,
    args: [OPERATION_KEY],
  });
  assert.deepEqual(
    versions.rows.map(row => ({
      generation: Number(row.generation),
      maxFeePerGas: String(row.max_fee_per_gas),
      maxPriorityFeePerGas: String(row.max_priority_fee_per_gas),
      nonce: Number(row.nonce),
    })),
    [
      { generation: 0, maxFeePerGas: "100", maxPriorityFeePerGas: "10", nonce: NONCE },
      { generation: 1, maxFeePerGas: "500", maxPriorityFeePerGas: "25", nonce: NONCE },
      { generation: 2, maxFeePerGas: "900", maxPriorityFeePerGas: "40", nonce: NONCE },
    ],
  );
  assert.equal(new Set(versions.rows.map(row => row.transaction_hash)).size, 3);
  for (const row of versions.rows) {
    assert.equal(keccak256(row.signed_transaction as Hex), row.transaction_hash);
    assert.match(String(row.signature_hash), /^0x[0-9a-f]{64}$/u);
  }
  const identities = await Promise.all(
    versions.rows.map(row => __evmTransactionReplacementTestUtils.transactionIdentity(row.signed_transaction as Hex)),
  );
  for (const identity of identities) {
    assert.equal(identity.chainId, 84532);
    assert.equal(identity.data, "0x12345678");
    assert.equal(identity.gas, 75_000n);
    assert.equal(identity.nonce, NONCE);
    assert.equal(identity.to.toLowerCase(), RECIPIENT);
    assert.equal(identity.value, 42n);
  }
  const active = await dbClient.execute({
    sql: `SELECT approval_signed_transaction, approval_transaction_hash
          FROM tokenless_chain_executions WHERE operation_key = ?`,
    args: [OPERATION_KEY],
  });
  assert.equal(active.rows[0]?.approval_signed_transaction, secondReplacement.signedTransaction);
  assert.equal(active.rows[0]?.approval_transaction_hash, secondReplacement.hash);
});

test("a mined transaction is never fee-replaced", async () => {
  await seedExecution();
  const original = await signedTransaction({ maxFeePerGas: 100n, maxPriorityFeePerGas: 10n });
  const durable = await persistInitialEvmTransaction({
    account: ACCOUNT,
    locator,
    now: new Date(NOW.getTime() - EVM_FEE_REPLACEMENT_MIN_AGE_MS),
    transaction: original,
  });
  const unchanged = await maybeReplaceUnobservedEvmTransaction({
    account: ACCOUNT,
    locator,
    now: NOW,
    publicClient: {
      async getTransactionCount() {
        return NONCE;
      },
      async getTransactionReceipt() {
        return { blockNumber: 123n, transactionHash: original.hash };
      },
    } as never,
    transaction: durable,
  });
  assert.equal(unchanged.hash, original.hash);
  assert.equal(unchanged.replaced, undefined);
  const versions = await dbClient.execute("SELECT generation FROM tokenless_evm_transaction_versions");
  assert.deepEqual(versions.rows, [{ generation: 0 }]);
});

test("a pre-0126 durable transaction is adopted without replacement or broadcast mutation", async () => {
  await seedExecution();
  const original = await signedTransaction({ maxFeePerGas: 100n, maxPriorityFeePerGas: 10n });
  await dbClient.execute({
    sql: `UPDATE tokenless_chain_executions
          SET approval_signed_transaction = ?, approval_transaction_hash = ?, state = 'signed'
          WHERE operation_key = ?`,
    args: [original.signedTransaction, original.hash, OPERATION_KEY],
  });
  let signings = 0;
  const adopted = await maybeReplaceUnobservedEvmTransaction({
    account: countingAccount(() => (signings += 1)),
    locator,
    now: NOW,
    publicClient: {} as never,
    transaction: { ...original, recovered: true },
  });
  assert.equal(adopted.hash, original.hash);
  assert.equal(signings, 0);
  const versions = await dbClient.execute(
    "SELECT generation, transaction_hash FROM tokenless_evm_transaction_versions ORDER BY generation",
  );
  assert.deepEqual(versions.rows, [{ generation: 0, transaction_hash: original.hash }]);
});

test("an over-cap pre-policy durable transaction is recorded but blocked before replay", async () => {
  await seedExecution();
  const original = await signedTransaction({
    maxFeePerGas: EVM_TRANSACTION_FEE_POLICY.maxFeePerGas + 1n,
    maxPriorityFeePerGas: 10n,
  });
  await dbClient.execute({
    sql: `UPDATE tokenless_chain_executions
          SET approval_signed_transaction = ?, approval_transaction_hash = ?, state = 'signed'
          WHERE operation_key = ?`,
    args: [original.signedTransaction, original.hash, OPERATION_KEY],
  });
  let signings = 0;
  await assert.rejects(
    maybeReplaceUnobservedEvmTransaction({
      account: countingAccount(() => (signings += 1)),
      locator,
      now: NOW,
      publicClient: {} as never,
      transaction: { ...original, recovered: true },
    }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "evm_transaction_fee_policy_exhausted",
  );
  assert.equal(signings, 0);
  const versions = await dbClient.execute(
    "SELECT generation, transaction_hash FROM tokenless_evm_transaction_versions ORDER BY generation",
  );
  assert.deepEqual(versions.rows, [{ generation: 0, transaction_hash: original.hash }]);
  const active = await dbClient.execute({
    sql: `SELECT approval_signed_transaction, approval_transaction_hash
          FROM tokenless_chain_executions WHERE operation_key = ?`,
    args: [OPERATION_KEY],
  });
  assert.equal(active.rows[0]?.approval_signed_transaction, original.signedTransaction);
  assert.equal(active.rows[0]?.approval_transaction_hash, original.hash);
});

test("RPC estimates above either server fee cap cannot reach signing or replace durable bytes", async () => {
  await seedExecution();
  const original = await signedTransaction({ maxFeePerGas: 100n, maxPriorityFeePerGas: 10n });
  const durable = await persistInitialEvmTransaction({
    account: ACCOUNT,
    locator,
    now: new Date(NOW.getTime() - EVM_FEE_REPLACEMENT_MIN_AGE_MS),
    transaction: original,
  });
  let signings = 0;
  for (const estimate of [
    {
      maxFeePerGas: EVM_TRANSACTION_FEE_POLICY.maxFeePerGas + 1n,
      maxPriorityFeePerGas: 25n,
    },
    {
      maxFeePerGas: EVM_TRANSACTION_FEE_POLICY.maxPriorityFeePerGas + 1n,
      maxPriorityFeePerGas: EVM_TRANSACTION_FEE_POLICY.maxPriorityFeePerGas + 1n,
    },
  ]) {
    await assert.rejects(
      maybeReplaceUnobservedEvmTransaction({
        account: countingAccount(() => (signings += 1)),
        locator,
        now: NOW,
        publicClient: pendingPublicClient(estimate),
        transaction: durable,
      }),
      (error: unknown) =>
        error instanceof TokenlessServiceError && error.code === "evm_transaction_fee_policy_exhausted",
    );
  }
  assert.equal(signings, 0);
  const active = await dbClient.execute({
    sql: `SELECT approval_signed_transaction, approval_transaction_hash
          FROM tokenless_chain_executions WHERE operation_key = ?`,
    args: [OPERATION_KEY],
  });
  assert.equal(active.rows[0]?.approval_signed_transaction, original.signedTransaction);
  assert.equal(active.rows[0]?.approval_transaction_hash, original.hash);
  const versions = await dbClient.execute("SELECT generation FROM tokenless_evm_transaction_versions");
  assert.deepEqual(versions.rows, [{ generation: 0 }]);
});

test("a replacement whose frozen gas liability exceeds the total cap cannot be signed", async () => {
  await seedExecution();
  const replacementFee = 9_000_000_000n;
  const gas = EVM_TRANSACTION_FEE_POLICY.maxTotalFee / replacementFee + 1n;
  const original = await signedTransaction({
    gas,
    maxFeePerGas: 7_000_000_000n,
    maxPriorityFeePerGas: 500_000_000n,
  });
  const durable = await persistInitialEvmTransaction({
    account: ACCOUNT,
    locator,
    now: new Date(NOW.getTime() - EVM_FEE_REPLACEMENT_MIN_AGE_MS),
    transaction: original,
  });
  let signings = 0;
  await assert.rejects(
    maybeReplaceUnobservedEvmTransaction({
      account: countingAccount(() => (signings += 1)),
      locator,
      now: NOW,
      publicClient: pendingPublicClient({
        maxFeePerGas: replacementFee,
        maxPriorityFeePerGas: 1_000_000_000n,
      }),
      transaction: durable,
    }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "evm_transaction_fee_policy_exhausted",
  );
  assert.equal(signings, 0);
  const versions = await dbClient.execute("SELECT generation FROM tokenless_evm_transaction_versions");
  assert.deepEqual(versions.rows, [{ generation: 0 }]);
});

test("replacement generation exhaustion preserves the last durable version and stops signing", async () => {
  await seedExecution();
  const original = await signedTransaction({ maxFeePerGas: 100n, maxPriorityFeePerGas: 10n });
  let current: DurableEvmTransaction = await persistInitialEvmTransaction({
    account: ACCOUNT,
    locator,
    now: new Date(NOW.getTime() - EVM_FEE_REPLACEMENT_MIN_AGE_MS),
    transaction: original,
  });
  let signings = 0;
  const account = countingAccount(() => (signings += 1));
  for (let generation = 1; generation <= EVM_TRANSACTION_FEE_POLICY.maxReplacementGenerations; generation += 1) {
    current = await maybeReplaceUnobservedEvmTransaction({
      account,
      locator,
      now: new Date(NOW.getTime() + (generation - 1) * EVM_FEE_REPLACEMENT_MIN_AGE_MS),
      publicClient: pendingPublicClient({ maxFeePerGas: 100n, maxPriorityFeePerGas: 10n }),
      transaction: current,
    });
    assert.equal(current.replaced, true);
  }
  const lastDurable = current;
  await assert.rejects(
    maybeReplaceUnobservedEvmTransaction({
      account,
      locator,
      now: new Date(
        NOW.getTime() + EVM_TRANSACTION_FEE_POLICY.maxReplacementGenerations * EVM_FEE_REPLACEMENT_MIN_AGE_MS,
      ),
      publicClient: pendingPublicClient({ maxFeePerGas: 100n, maxPriorityFeePerGas: 10n }),
      transaction: lastDurable,
    }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "evm_transaction_fee_policy_exhausted",
  );
  assert.equal(signings, EVM_TRANSACTION_FEE_POLICY.maxReplacementGenerations);
  const active = await dbClient.execute({
    sql: `SELECT approval_signed_transaction, approval_transaction_hash
          FROM tokenless_chain_executions WHERE operation_key = ?`,
    args: [OPERATION_KEY],
  });
  assert.equal(active.rows[0]?.approval_signed_transaction, lastDurable.signedTransaction);
  assert.equal(active.rows[0]?.approval_transaction_hash, lastDurable.hash);
  const versions = await dbClient.execute(
    "SELECT generation FROM tokenless_evm_transaction_versions ORDER BY generation",
  );
  assert.deepEqual(
    versions.rows.map(row => Number(row.generation)),
    Array.from({ length: EVM_TRANSACTION_FEE_POLICY.maxReplacementGenerations + 1 }, (_, index) => index),
  );
});

test("earlier nonce gaps and already-consumed nonces refuse replacement before fee estimation", async () => {
  await seedExecution();
  const original = await signedTransaction({ maxFeePerGas: 100n, maxPriorityFeePerGas: 10n });
  const durable = await persistInitialEvmTransaction({
    account: ACCOUNT,
    locator,
    now: new Date(NOW.getTime() - EVM_FEE_REPLACEMENT_MIN_AGE_MS),
    transaction: original,
  });
  let estimates = 0;
  for (const networkConfirmedNonce of [NONCE - 1, NONCE + 1]) {
    const unchanged = await maybeReplaceUnobservedEvmTransaction({
      account: ACCOUNT,
      locator,
      now: NOW,
      publicClient: {
        async estimateFeesPerGas() {
          estimates += 1;
          assert.fail("an ineligible nonce must not reach fee estimation or signing");
        },
        async getTransaction() {
          assert.fail("an ineligible nonce must not be queried for replacement");
        },
        async getTransactionCount({ blockTag }: { blockTag: string }) {
          assert.equal(blockTag, "latest");
          return networkConfirmedNonce;
        },
        async getTransactionReceipt() {
          assert.fail("an ineligible nonce must not be queried for replacement");
        },
      } as never,
      transaction: durable,
    });
    assert.equal(unchanged.hash, original.hash);
    assert.equal(unchanged.replaced, undefined);
  }
  assert.equal(estimates, 0);
  const versions = await dbClient.execute("SELECT generation FROM tokenless_evm_transaction_versions");
  assert.deepEqual(versions.rows, [{ generation: 0 }]);
});

test("a valid concurrent transaction winner converges to its durable version", async () => {
  await seedExecution();
  const staleCandidate = await signedTransaction({ maxFeePerGas: 100n, maxPriorityFeePerGas: 10n });
  const winner = await signedTransaction({ maxFeePerGas: 200n, maxPriorityFeePerGas: 20n });
  const storedWinner = await persistInitialEvmTransaction({ account: ACCOUNT, locator, now: NOW, transaction: winner });
  assert.equal(storedWinner.hash, winner.hash);
  const converged = await persistInitialEvmTransaction({
    account: ACCOUNT,
    locator,
    now: new Date(NOW.getTime() + 1),
    transaction: staleCandidate,
  });
  assert.deepEqual(converged, {
    hash: winner.hash,
    recovered: true,
    signedTransaction: winner.signedTransaction,
  });
  const versions = await dbClient.execute(
    "SELECT generation, transaction_hash FROM tokenless_evm_transaction_versions ORDER BY generation",
  );
  assert.deepEqual(versions.rows, [{ generation: 0, transaction_hash: winner.hash }]);
});

test("a concurrent active version is rejected unless its hash and immutable intent are valid", async () => {
  await seedExecution();
  const expected = await signedTransaction({ maxFeePerGas: 100n, maxPriorityFeePerGas: 10n });
  const changedIntent = await signedTransaction({
    maxFeePerGas: 200n,
    maxPriorityFeePerGas: 20n,
    to: "0x9999999999999999999999999999999999999999",
  });
  await dbClient.execute({
    sql: `UPDATE tokenless_chain_executions
          SET approval_signed_transaction = ?, approval_transaction_hash = ?
          WHERE operation_key = ?`,
    args: [changedIntent.signedTransaction, expected.hash, OPERATION_KEY],
  });
  await assert.rejects(
    persistInitialEvmTransaction({ account: ACCOUNT, locator, now: NOW, transaction: expected }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "signed_transaction_mismatch",
  );
  await dbClient.execute({
    sql: `UPDATE tokenless_chain_executions SET approval_transaction_hash = ? WHERE operation_key = ?`,
    args: [changedIntent.hash, OPERATION_KEY],
  });
  await assert.rejects(
    persistInitialEvmTransaction({ account: ACCOUNT, locator, now: NOW, transaction: expected }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "signed_transaction_mismatch",
  );
  assert.equal(
    parseTransaction(expected.signedTransaction).nonce,
    parseTransaction(changedIntent.signedTransaction).nonce,
  );
});

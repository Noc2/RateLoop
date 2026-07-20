import { createHash } from "node:crypto";
import "server-only";
import {
  type Account,
  type Address,
  type Hash,
  type Hex,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  type TransactionSerializableEIP1559,
  getAddress,
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  serializeSignature,
} from "viem";
import { dbClient, dbPool } from "~~/lib/db";
import type { TokenlessChainRuntime } from "~~/lib/tokenless/chain/runtime";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const EVM_FEE_REPLACEMENT_MIN_AGE_MS = 15 * 60_000;
const FEE_BUMP_NUMERATOR = 9n;
const FEE_BUMP_DENOMINATOR = 8n;

export type EvmTransactionSignerRole = "prepaid_funder" | "gas_only_relayer" | "surprise_bonus_funder";

export type EvmTransactionLocator =
  | {
      businessKey: string;
      businessKind: "chain_execution";
      deploymentKey: string;
      fencingToken: number;
      signerRole: Extract<EvmTransactionSignerRole, "prepaid_funder" | "gas_only_relayer">;
      transactionKind: "approval" | "submission";
    }
  | {
      businessKey: string;
      businessKind: "rater_commit";
      deploymentKey: string;
      signerRole: "gas_only_relayer";
      transactionKind: "relay";
    }
  | {
      businessKey: string;
      businessKind: "surprise_bounty";
      deploymentKey: string;
      signerRole: "surprise_bonus_funder";
      transactionKind: "transfer";
    };

export type DurableEvmTransaction = {
  hash: Hash;
  recovered: boolean;
  replaced?: boolean;
  signedTransaction: Hex;
};

type TransactionIdentity = {
  chainId: number;
  data: Hex;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  nonce: number;
  signatureHash: Hash;
  signer: Address;
  to: Address;
  value: bigint;
};

function normalizedSigned(value: string | null | undefined) {
  return value?.toLowerCase() ?? null;
}

function sameSigned(left: string | null | undefined, right: string | null | undefined) {
  return normalizedSigned(left) === normalizedSigned(right);
}

function stableId(value: string) {
  return `txv_${createHash("sha256").update(value).digest("hex").slice(0, 40)}`;
}

async function transactionIdentity(signedTransaction: Hex): Promise<TransactionIdentity> {
  const parsed = parseTransaction(signedTransaction);
  const signer = await recoverTransactionAddress({
    serializedTransaction: signedTransaction as Parameters<
      typeof recoverTransactionAddress
    >[0]["serializedTransaction"],
  });
  if (
    parsed.type !== "eip1559" ||
    parsed.chainId === undefined ||
    parsed.nonce === undefined ||
    parsed.gas === undefined ||
    parsed.maxFeePerGas === undefined ||
    parsed.maxPriorityFeePerGas === undefined ||
    !parsed.to ||
    !parsed.r ||
    !parsed.s ||
    parsed.yParity === undefined
  ) {
    throw new TokenlessServiceError(
      "Durable server transactions must use signed EIP-1559 envelopes.",
      409,
      "signed_transaction_mismatch",
    );
  }
  return {
    chainId: parsed.chainId,
    data: parsed.data ?? "0x",
    gas: parsed.gas,
    maxFeePerGas: parsed.maxFeePerGas,
    maxPriorityFeePerGas: parsed.maxPriorityFeePerGas,
    nonce: parsed.nonce,
    signatureHash: keccak256(serializeSignature({ r: parsed.r, s: parsed.s, yParity: parsed.yParity })),
    signer: getAddress(signer),
    to: getAddress(parsed.to),
    value: parsed.value ?? 0n,
  };
}

export async function assertSameEvmTransactionIntent(input: { account: Account; previous: Hex; replacement: Hex }) {
  const [previous, replacement] = await Promise.all([
    transactionIdentity(input.previous),
    transactionIdentity(input.replacement),
  ]);
  if (
    previous.chainId !== replacement.chainId ||
    previous.signer !== getAddress(input.account.address) ||
    replacement.signer !== previous.signer ||
    previous.nonce !== replacement.nonce ||
    previous.to !== replacement.to ||
    previous.data.toLowerCase() !== replacement.data.toLowerCase() ||
    previous.value !== replacement.value ||
    previous.gas !== replacement.gas ||
    replacement.maxFeePerGas <= previous.maxFeePerGas ||
    replacement.maxPriorityFeePerGas <= previous.maxPriorityFeePerGas ||
    replacement.maxPriorityFeePerGas > replacement.maxFeePerGas
  ) {
    throw new TokenlessServiceError(
      "Fee replacement changed the durable transaction intent or did not increase both EIP-1559 fees.",
      409,
      "signed_transaction_mismatch",
    );
  }
}

async function assertEquivalentEvmTransactionIntent(input: { account: Account; expected: Hex; transaction: Hex }) {
  const [expected, transaction] = await Promise.all([
    transactionIdentity(input.expected),
    transactionIdentity(input.transaction),
  ]);
  if (
    expected.chainId !== transaction.chainId ||
    expected.signer !== getAddress(input.account.address) ||
    transaction.signer !== expected.signer ||
    expected.nonce !== transaction.nonce ||
    expected.to !== transaction.to ||
    expected.data.toLowerCase() !== transaction.data.toLowerCase() ||
    expected.value !== transaction.value ||
    expected.gas !== transaction.gas
  ) {
    throw new TokenlessServiceError(
      "The concurrent transaction version changed the durable transaction intent.",
      409,
      "signed_transaction_mismatch",
    );
  }
}

function locatorColumns(locator: EvmTransactionLocator) {
  if (locator.businessKind === "chain_execution") {
    return locator.transactionKind === "approval"
      ? { hash: "approval_transaction_hash", nonce: "approval_nonce", signed: "approval_signed_transaction" }
      : { hash: "submission_transaction_hash", nonce: "submission_nonce", signed: "submission_signed_transaction" };
  }
  if (locator.businessKind === "rater_commit") {
    return { hash: "transaction_hash", nonce: "relay_nonce", signed: "relay_signed_transaction" };
  }
  return { hash: "transfer_transaction_hash", nonce: "transfer_nonce", signed: "transfer_signed_transaction" };
}

async function persistTransactionVersion(input: {
  account: Account;
  expected: { hash: Hash | null; signedTransaction: Hex | null };
  locator: EvmTransactionLocator;
  now: Date;
  transaction: { hash: Hash; signedTransaction: Hex };
}) {
  const identity = await transactionIdentity(input.transaction.signedTransaction);
  if (
    identity.signer !== getAddress(input.account.address) ||
    identity.nonce < 0 ||
    keccak256(input.transaction.signedTransaction).toLowerCase() !== input.transaction.hash.toLowerCase()
  ) {
    throw new TokenlessServiceError(
      "The signed transaction version does not match its signer or hash.",
      409,
      "signed_transaction_mismatch",
    );
  }
  const columns = locatorColumns(input.locator);
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    let locked;
    if (input.locator.businessKind === "chain_execution") {
      locked = await client.query(
        `SELECT deployment_key, transaction_recovery_version, claim_fencing_token,
                ${columns.nonce} AS persisted_nonce, ${columns.hash} AS persisted_hash,
                ${columns.signed} AS persisted_signed
         FROM tokenless_chain_executions WHERE operation_key = $1 FOR UPDATE`,
        [input.locator.businessKey],
      );
    } else if (input.locator.businessKind === "rater_commit") {
      locked = await client.query(
        `SELECT deployment_key, transaction_recovery_version,
                ${columns.nonce} AS persisted_nonce, ${columns.hash} AS persisted_hash,
                ${columns.signed} AS persisted_signed
         FROM tokenless_rater_commits WHERE commit_id = $1 FOR UPDATE`,
        [input.locator.businessKey],
      );
    } else {
      locked = await client.query(
        `SELECT bounty_round_id, transaction_recovery_version,
                ${columns.nonce} AS persisted_nonce, ${columns.hash} AS persisted_hash,
                ${columns.signed} AS persisted_signed
         FROM tokenless_surprise_bounty_entitlements WHERE entitlement_id = $1 FOR UPDATE`,
        [input.locator.businessKey],
      );
      if (locked.rows[0]) {
        const deployment = await client.query(
          "SELECT deployment_key FROM tokenless_surprise_bounty_rounds WHERE bounty_round_id = $1",
          [locked.rows[0].bounty_round_id],
        );
        locked.rows[0].deployment_key = deployment.rows[0]?.deployment_key;
      }
    }
    const row = locked.rows[0] as Record<string, unknown> | undefined;
    if (
      !row ||
      String(row.deployment_key) !== input.locator.deploymentKey ||
      Number(row.transaction_recovery_version) !== 1 ||
      Number(row.persisted_nonce) !== identity.nonce ||
      (input.locator.businessKind === "chain_execution" &&
        Number(row.claim_fencing_token) !== input.locator.fencingToken)
    ) {
      throw new TokenlessServiceError(
        "The transaction version no longer matches its durable business reservation.",
        409,
        "signed_transaction_mismatch",
      );
    }
    const currentHash = row.persisted_hash === null ? null : (String(row.persisted_hash) as Hash);
    const currentSigned = row.persisted_signed === null ? null : (String(row.persisted_signed) as Hex);
    if (!sameSigned(currentHash, input.expected.hash) || !sameSigned(currentSigned, input.expected.signedTransaction)) {
      if (!currentHash || !currentSigned) {
        throw new TokenlessServiceError(
          "The durable transaction changed without a complete signed version.",
          409,
          "signed_transaction_mismatch",
        );
      }
      if (keccak256(currentSigned).toLowerCase() !== currentHash.toLowerCase()) {
        throw new TokenlessServiceError(
          "The concurrent durable transaction hash does not match its signed bytes.",
          409,
          "signed_transaction_mismatch",
        );
      }
      await assertEquivalentEvmTransactionIntent({
        account: input.account,
        expected: input.transaction.signedTransaction,
        transaction: currentSigned,
      });
      if (input.expected.signedTransaction) {
        await assertSameEvmTransactionIntent({
          account: input.account,
          previous: input.expected.signedTransaction,
          replacement: currentSigned,
        });
      }
      await client.query("COMMIT");
      return { hash: currentHash, recovered: true, signedTransaction: currentSigned } satisfies DurableEvmTransaction;
    }
    const existing = await client.query(
      `SELECT version_id FROM tokenless_evm_transaction_versions
       WHERE business_kind = $1 AND business_key = $2 AND transaction_kind = $3 AND transaction_hash = $4`,
      [input.locator.businessKind, input.locator.businessKey, input.locator.transactionKind, input.transaction.hash],
    );
    if (!existing.rows[0]) {
      const generationResult = await client.query(
        `SELECT COALESCE(MAX(generation), -1) + 1 AS generation
         FROM tokenless_evm_transaction_versions
         WHERE business_kind = $1 AND business_key = $2 AND transaction_kind = $3`,
        [input.locator.businessKind, input.locator.businessKey, input.locator.transactionKind],
      );
      const generation = Number(generationResult.rows[0]?.generation);
      if (!Number.isSafeInteger(generation) || generation < 0 || generation > 2_147_483_647) {
        throw new Error("EVM transaction replacement generation is invalid.");
      }
      await client.query(
        `INSERT INTO tokenless_evm_transaction_versions
          (version_id, deployment_key, signer_role, signer_address, business_kind, business_key,
           transaction_kind, nonce, generation, signed_transaction, transaction_hash, signature_hash,
           max_fee_per_gas, max_priority_fee_per_gas, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          stableId(
            `${input.locator.businessKind}:${input.locator.businessKey}:${input.locator.transactionKind}:${generation}:${input.transaction.hash}`,
          ),
          input.locator.deploymentKey,
          input.locator.signerRole,
          identity.signer.toLowerCase(),
          input.locator.businessKind,
          input.locator.businessKey,
          input.locator.transactionKind,
          identity.nonce,
          generation,
          input.transaction.signedTransaction,
          input.transaction.hash,
          identity.signatureHash,
          identity.maxFeePerGas.toString(),
          identity.maxPriorityFeePerGas.toString(),
          input.now,
        ],
      );
    }
    const recordOnly =
      sameSigned(currentHash, input.transaction.hash) && sameSigned(currentSigned, input.transaction.signedTransaction);
    if (!recordOnly) {
      let updated;
      if (input.locator.businessKind === "chain_execution") {
        updated = await client.query(
          `UPDATE tokenless_chain_executions
           SET ${columns.signed} = $1, ${columns.hash} = $2, state = 'signed', updated_at = $3
           WHERE operation_key = $4 AND claim_fencing_token = $5
             AND (($6 IS NULL AND ${columns.signed} IS NULL) OR ${columns.signed} = $6)
             AND (($7 IS NULL AND ${columns.hash} IS NULL) OR ${columns.hash} = $7)`,
          [
            input.transaction.signedTransaction,
            input.transaction.hash,
            input.now,
            input.locator.businessKey,
            input.locator.fencingToken,
            input.expected.signedTransaction,
            input.expected.hash,
          ],
        );
      } else if (input.locator.businessKind === "rater_commit") {
        updated = await client.query(
          `UPDATE tokenless_rater_commits
           SET relay_signed_transaction = $1, transaction_hash = $2, state = 'signed', failure_code = NULL,
               updated_at = $3
           WHERE commit_id = $4
             AND (($5 IS NULL AND relay_signed_transaction IS NULL) OR relay_signed_transaction = $5)
             AND (($6 IS NULL AND transaction_hash IS NULL) OR transaction_hash = $6)`,
          [
            input.transaction.signedTransaction,
            input.transaction.hash,
            input.now,
            input.locator.businessKey,
            input.expected.signedTransaction,
            input.expected.hash,
          ],
        );
      } else {
        updated = await client.query(
          `UPDATE tokenless_surprise_bounty_entitlements
           SET transfer_signed_transaction = $1, transfer_transaction_hash = $2, state = 'paying',
               last_error = NULL, updated_at = $3
           WHERE entitlement_id = $4
             AND (($5 IS NULL AND transfer_signed_transaction IS NULL) OR transfer_signed_transaction = $5)
             AND (($6 IS NULL AND transfer_transaction_hash IS NULL) OR transfer_transaction_hash = $6)`,
          [
            input.transaction.signedTransaction,
            input.transaction.hash,
            input.now,
            input.locator.businessKey,
            input.expected.signedTransaction,
            input.expected.hash,
          ],
        );
      }
      if (updated.rowCount !== 1) {
        throw new TokenlessServiceError(
          "The durable transaction changed before its signed replacement could be stored.",
          409,
          "signed_transaction_mismatch",
        );
      }
    }
    await client.query("COMMIT");
    return {
      hash: input.transaction.hash,
      recovered: recordOnly,
      signedTransaction: input.transaction.signedTransaction,
    } satisfies DurableEvmTransaction;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function persistInitialEvmTransaction(input: {
  account: Account;
  locator: EvmTransactionLocator;
  now?: Date;
  transaction: { hash: Hash; signedTransaction: Hex };
}) {
  return persistTransactionVersion({
    ...input,
    expected: { hash: null, signedTransaction: null },
    now: input.now ?? new Date(),
  });
}

function increasedFee(value: bigint) {
  return (value * FEE_BUMP_NUMERATOR + FEE_BUMP_DENOMINATOR - 1n) / FEE_BUMP_DENOMINATOR;
}

async function signedFeeReplacement(
  account: Account,
  current: Hex,
  feeFloor: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint },
) {
  if (account.type !== "local") {
    throw new TokenlessServiceError(
      "Fee replacement requires a recoverable local account interface.",
      503,
      "local_chain_signer_required",
      true,
    );
  }
  const parsed = parseTransaction(current);
  if (
    parsed.type !== "eip1559" ||
    parsed.chainId === undefined ||
    parsed.nonce === undefined ||
    parsed.gas === undefined ||
    parsed.maxFeePerGas === undefined ||
    parsed.maxPriorityFeePerGas === undefined ||
    !parsed.to
  ) {
    throw new TokenlessServiceError(
      "The persisted transaction cannot be safely fee-replaced.",
      409,
      "signed_transaction_mismatch",
    );
  }
  const maxPriorityFeePerGas = [increasedFee(parsed.maxPriorityFeePerGas), feeFloor.maxPriorityFeePerGas].reduce(
    (highest, candidate) => (candidate > highest ? candidate : highest),
  );
  const maxFeePerGas = [increasedFee(parsed.maxFeePerGas), feeFloor.maxFeePerGas, maxPriorityFeePerGas].reduce(
    (highest, candidate) => (candidate > highest ? candidate : highest),
  );
  const request: TransactionSerializableEIP1559 = {
    accessList: parsed.accessList ?? [],
    chainId: parsed.chainId,
    data: parsed.data ?? "0x",
    gas: parsed.gas,
    maxFeePerGas,
    maxPriorityFeePerGas,
    nonce: parsed.nonce,
    to: parsed.to,
    type: "eip1559",
    value: parsed.value ?? 0n,
  };
  return account.signTransaction(request);
}

export async function maybeReplaceUnobservedEvmTransaction(input: {
  account: Account;
  locator: EvmTransactionLocator;
  minAgeMs?: number;
  now?: Date;
  publicClient: TokenlessChainRuntime["publicClient"];
  transaction: DurableEvmTransaction;
}): Promise<DurableEvmTransaction> {
  const now = input.now ?? new Date();
  const minAgeMs = input.minAgeMs ?? EVM_FEE_REPLACEMENT_MIN_AGE_MS;
  if (!Number.isSafeInteger(minAgeMs) || minAgeMs < EVM_FEE_REPLACEMENT_MIN_AGE_MS) {
    throw new Error(`EVM fee replacement age must be at least ${EVM_FEE_REPLACEMENT_MIN_AGE_MS}ms.`);
  }
  const recorded = await persistTransactionVersion({
    account: input.account,
    expected: { hash: input.transaction.hash, signedTransaction: input.transaction.signedTransaction },
    locator: input.locator,
    now,
    transaction: input.transaction,
  });
  if (!sameSigned(recorded.hash, input.transaction.hash)) {
    return { ...recorded, replaced: true };
  }
  const latest = await dbClient.execute({
    sql: `SELECT transaction_hash, created_at FROM tokenless_evm_transaction_versions
          WHERE business_kind = ? AND business_key = ? AND transaction_kind = ?
          ORDER BY generation DESC LIMIT 1`,
    args: [input.locator.businessKind, input.locator.businessKey, input.locator.transactionKind],
  });
  const latestRow = latest.rows[0] as Record<string, unknown> | undefined;
  if (!latestRow || !sameSigned(String(latestRow.transaction_hash), recorded.hash)) {
    throw new TokenlessServiceError(
      "The durable transaction version history does not match the active transaction.",
      409,
      "signed_transaction_mismatch",
    );
  }
  const createdAt = new Date(String(latestRow.created_at));
  if (!Number.isFinite(createdAt.getTime()) || now.getTime() - createdAt.getTime() < minAgeMs) return recorded;
  const identity = await transactionIdentity(recorded.signedTransaction);
  const networkConfirmedNonce = await input.publicClient.getTransactionCount({
    address: identity.signer,
    blockTag: "latest",
  });
  if (networkConfirmedNonce !== identity.nonce) return recorded;
  try {
    const receipt = await input.publicClient.getTransactionReceipt({ hash: recorded.hash });
    if (receipt.transactionHash.toLowerCase() !== recorded.hash.toLowerCase()) {
      throw new TokenlessServiceError(
        "The RPC returned a different receipt for the durable hash.",
        409,
        "signed_transaction_mismatch",
      );
    }
    return recorded;
  } catch (error) {
    if (error instanceof TokenlessServiceError) throw error;
    if (!(error instanceof TransactionReceiptNotFoundError)) throw error;
  }
  try {
    const observed = await input.publicClient.getTransaction({ hash: recorded.hash });
    if (observed.hash.toLowerCase() !== recorded.hash.toLowerCase()) {
      throw new TokenlessServiceError(
        "The RPC returned a different transaction for the durable hash.",
        409,
        "signed_transaction_mismatch",
      );
    }
    if (observed.blockNumber !== null) return recorded;
  } catch (error) {
    if (error instanceof TokenlessServiceError) throw error;
    if (!(error instanceof TransactionNotFoundError)) throw error;
  }
  const estimatedFees = await input.publicClient.estimateFeesPerGas({ type: "eip1559" });
  if (
    estimatedFees.maxFeePerGas <= 0n ||
    estimatedFees.maxPriorityFeePerGas <= 0n ||
    estimatedFees.maxPriorityFeePerGas > estimatedFees.maxFeePerGas
  ) {
    throw new TokenlessServiceError(
      "The RPC returned invalid EIP-1559 fee estimates for transaction replacement.",
      503,
      "chain_fee_estimate_unavailable",
      true,
    );
  }
  const signedTransaction = await signedFeeReplacement(input.account, recorded.signedTransaction, estimatedFees);
  await assertSameEvmTransactionIntent({
    account: input.account,
    previous: recorded.signedTransaction,
    replacement: signedTransaction,
  });
  const replacement = await persistTransactionVersion({
    account: input.account,
    expected: { hash: recorded.hash, signedTransaction: recorded.signedTransaction },
    locator: input.locator,
    now,
    transaction: { hash: keccak256(signedTransaction), signedTransaction },
  });
  if (!sameSigned(replacement.hash, recorded.hash)) {
    await assertSameEvmTransactionIntent({
      account: input.account,
      previous: recorded.signedTransaction,
      replacement: replacement.signedTransaction,
    });
  }
  return { ...replacement, replaced: !sameSigned(replacement.hash, recorded.hash) };
}

export const __evmTransactionReplacementTestUtils = {
  increasedFee,
  transactionIdentity,
};

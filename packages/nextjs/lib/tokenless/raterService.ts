import { TOKENLESS_QUICKNET_T_CHAIN_HASH, loadTokenlessChainConfig } from "./chain/config";
import {
  type TokenlessChainRuntime,
  type TokenlessWalletClient,
  assertLiveTokenlessDeployment,
  getTokenlessChainRuntime,
} from "./chain/runtime";
import { tokenlessCommitTypedData } from "./rater/signing";
import { TOKENLESS_MAX_TLOCK_CIPHERTEXT_BYTES } from "./rater/tlock";
import { TokenlessPanelAbi } from "@rateloop/contracts/tokenless";
import { createHash, randomUUID } from "node:crypto";
import "server-only";
import {
  type Account,
  type Address,
  type Hash,
  type Hex,
  type TransactionSerializable,
  encodeFunctionData,
  getAddress,
  isHash,
  isHex,
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  recoverTypedDataAddress,
  size,
} from "viem";
import { baseSepolia } from "viem/chains";
import { dbClient, dbPool } from "~~/lib/db";
import { freezeAdmissionPolicy } from "~~/lib/tokenless/admissionPolicy";
import { preparePublicRaterResponse } from "~~/lib/tokenless/publicRaterResponses";
import type { PublicRaterResponseInput } from "~~/lib/tokenless/rater/publicResponse";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import { maximumSurpriseBonusForBase } from "~~/lib/tokenless/surpriseBounties";

type Row = Record<string, unknown>;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const SIGNATURE = /^0x[0-9a-fA-F]{130}$/;
const IDEMPOTENCY = /^[A-Za-z0-9._:-]{8,160}$/;

export type RaterCommitRequest = {
  idempotencyKey: string;
  voucherId: string;
  response: PublicRaterResponseInput;
  authorization: {
    roundId: string;
    drandNetwork: "quicknet-t";
    beaconRound: number;
    sealedPayload: Hex;
    sealedPayloadHash: Hex;
    sealedCommitment: Hex;
    payoutCommitment: Hex;
    panelAddress: Address;
    chainId: number;
    nullifier: Hex;
    voteKey: Address;
    voteKeySignature: Hex;
  };
};

function rowString(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function boundTaskReviewerSource(row: Row): "customer_invited" | "rateloop_network" | null {
  const policyJson = rowString(row, "admission_policy_json");
  const policyHash = rowString(row, "admission_policy_hash");
  if (!policyJson || !policyHash) return null;
  try {
    const frozen = freezeAdmissionPolicy(JSON.parse(policyJson));
    if (
      frozen.policyJson !== policyJson ||
      frozen.admissionPolicyHash.toLowerCase() !== policyHash.toLowerCase() ||
      frozen.policy.reviewerSource === "hybrid"
    ) {
      return null;
    }
    return frozen.policy.reviewerSource;
  } catch {
    return null;
  }
}

export async function listPaidRaterTasks(
  principalId: string | null,
  optionsOrNow: { query?: string; scope?: "all" | "public" } | Date = {},
  now = new Date(),
) {
  const options = optionsOrNow instanceof Date ? {} : optionsOrNow;
  now = optionsOrNow instanceof Date ? optionsOrNow : now;
  const query = options.query?.trim() ?? "";
  if (query.length > 120) {
    throw new TokenlessServiceError("Search query must be at most 120 characters.", 400, "invalid_search");
  }
  if (options.scope === "public") {
    // Public-only is the only source served by this endpoint. Private assignments use their own account-bound read.
  }
  const result = await dbClient.execute({
    sql: `SELECT vr.chain_id, vr.panel_address, vr.round_id, vr.content_id,
                 vr.admission_policy_hash, vr.admission_policy_json, vr.voucher_deadline,
                 c.content_json, e.round_terms_json, e.operation_key,
                 CASE WHEN v.voucher_id IS NULL THEN false ELSE true END AS already_vouchered
          FROM tokenless_voucher_rounds vr
          JOIN tokenless_chain_executions e ON e.chain_id = vr.chain_id AND e.panel_address = vr.panel_address
             AND e.round_id = vr.round_id AND e.state = 'confirmed'
          JOIN tokenless_agent_asks a ON a.operation_key = e.operation_key
          JOIN tokenless_ask_ownership o ON o.operation_key = e.operation_key
          JOIN tokenless_question_records q ON q.question_id = o.question_id
          JOIN tokenless_content_records c ON c.content_id = q.content_id
          LEFT JOIN tokenless_rater_profiles p ON p.principal_id = ?
          LEFT JOIN tokenless_paid_vouchers v ON v.rater_id = p.rater_id AND v.round_id = vr.round_id
             AND v.panel_address = vr.panel_address
          WHERE vr.status = 'open' AND vr.voucher_deadline > ? AND c.moderation_status = 'approved'
            AND q.visibility = 'public' AND q.data_classification IN ('public', 'synthetic', 'redacted')
            AND (? = '' OR c.content_json ILIKE ?)
          ORDER BY vr.voucher_deadline ASC LIMIT 50`,
    args: [principalId, now, query, `%${query}%`],
  });
  return result.rows.flatMap(value => {
    const row = value as Row;
    const reviewerSource = boundTaskReviewerSource(row);
    if (!reviewerSource) return [];
    const terms = JSON.parse(rowString(row, "round_terms_json")!) as Record<string, string | number>;
    const maximumCommits = Number(terms.maximumCommits);
    const disclosureBeaconRound = Number(terms.beaconRound);
    const scoringBeaconRound = Number(terms.scoringBeaconRound);
    if (
      !Number.isSafeInteger(disclosureBeaconRound) ||
      disclosureBeaconRound <= 0 ||
      !Number.isSafeInteger(scoringBeaconRound) ||
      scoringBeaconRound <= disclosureBeaconRound
    ) {
      return [];
    }
    const guaranteedBaseAtomic = (BigInt(String(terms.bountyAmount)) * 8n) / 10n / BigInt(maximumCommits);
    return [
      {
        operationKey: rowString(row, "operation_key")!,
        chainId: Number(row.chain_id),
        panelAddress: getAddress(rowString(row, "panel_address")!),
        roundId: rowString(row, "round_id")!,
        contentId: rowString(row, "content_id") as Hex,
        question: JSON.parse(rowString(row, "content_json")!),
        admissionPolicyHash: rowString(row, "admission_policy_hash"),
        reviewerSource,
        voucherDeadline: new Date(String(row.voucher_deadline)).toISOString(),
        alreadyVouchered: Boolean(row.already_vouchered),
        earnings: {
          guaranteedBaseAtomic: guaranteedBaseAtomic.toString(),
          possibleBonusAtomic: ((BigInt(String(terms.bountyAmount)) * 2n) / 10n / BigInt(maximumCommits)).toString(),
          possibleSurpriseBonusAtomic: maximumSurpriseBonusForBase(guaranteedBaseAtomic).toString(),
          attemptCompensationAtomic: String(terms.attemptCompensation),
        },
        disclosureBeacon: { network: "quicknet-t" as const, round: disclosureBeaconRound },
        scoringBeacon: { network: "quicknet-t" as const, round: scoringBeaconRound },
        visibility: "public" as const,
      },
    ];
  });
}

function validateAuthorization(input: RaterCommitRequest["authorization"]) {
  if (
    !/^[1-9]\d*$/.test(input.roundId) ||
    input.drandNetwork !== "quicknet-t" ||
    !Number.isSafeInteger(input.beaconRound) ||
    input.beaconRound <= 0 ||
    !isHex(input.sealedPayload, { strict: true }) ||
    size(input.sealedPayload) < 1 ||
    size(input.sealedPayload) > TOKENLESS_MAX_TLOCK_CIPHERTEXT_BYTES ||
    !BYTES32.test(input.sealedPayloadHash) ||
    !BYTES32.test(input.sealedCommitment) ||
    !BYTES32.test(input.payoutCommitment) ||
    !BYTES32.test(input.nullifier) ||
    !SIGNATURE.test(input.voteKeySignature)
  ) {
    throw new TokenlessServiceError("Commit authorization is malformed.", 400, "invalid_commit_authorization");
  }
  if (keccak256(input.sealedPayload) !== input.sealedPayloadHash.toLowerCase()) {
    throw new TokenlessServiceError("Sealed payload hash does not match.", 400, "invalid_commit_authorization");
  }
}

async function allocateRelayNonce(deploymentKey: string, signer: Address, networkNonce: number) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO tokenless_chain_signer_nonces (deployment_key, signer_address, next_nonce, updated_at)
       VALUES ($1, $2, $3, $4) ON CONFLICT (deployment_key, signer_address) DO NOTHING`,
      [deploymentKey, signer.toLowerCase(), networkNonce, new Date()],
    );
    const locked = await client.query(
      "SELECT next_nonce FROM tokenless_chain_signer_nonces WHERE deployment_key = $1 AND signer_address = $2 FOR UPDATE",
      [deploymentKey, signer.toLowerCase()],
    );
    const nonce = Math.max(networkNonce, Number(locked.rows[0].next_nonce));
    await client.query(
      "UPDATE tokenless_chain_signer_nonces SET next_nonce = $1, updated_at = $2 WHERE deployment_key = $3 AND signer_address = $4",
      [nonce + 1, new Date(), deploymentKey, signer.toLowerCase()],
    );
    await client.query("COMMIT");
    return nonce;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function publicCommit(row: Row) {
  return {
    commitId: rowString(row, "commit_id"),
    voucherId: rowString(row, "voucher_id"),
    roundId: rowString(row, "round_id"),
    state: rowString(row, "state"),
    transactionHash: rowString(row, "transaction_hash"),
    failureCode: rowString(row, "failure_code"),
    createdAt: new Date(String(row.created_at)).toISOString(),
    confirmedAt: row.confirmed_at ? new Date(String(row.confirmed_at)).toISOString() : null,
  };
}

async function lockCommitForVoucher(client: Pick<import("pg").PoolClient, "query">, voucherId: string) {
  return client.query("SELECT * FROM tokenless_rater_commits WHERE voucher_id = $1 LIMIT 1 FOR UPDATE", [voucherId]);
}

function paidCommitData(voucherRow: Row, authorization: RaterCommitRequest["authorization"]) {
  const voucher = JSON.parse(rowString(voucherRow, "voucher_json")!) as Record<string, string | number>;
  return encodeFunctionData({
    abi: TokenlessPanelAbi,
    functionName: "commit",
    args: [
      {
        voteKey: getAddress(String(voucher.voteKey)),
        contentId: String(voucher.contentId) as Hex,
        roundId: BigInt(String(voucher.roundId)),
        nullifier: String(voucher.nullifier) as Hex,
        admissionPolicyHash: String(voucher.admissionPolicyHash) as Hex,
        issuerEpoch: BigInt(String(voucher.issuerEpoch)),
        expiresAt: BigInt(String(voucher.expiresAt)),
      },
      authorization.sealedCommitment,
      authorization.sealedPayload,
      authorization.payoutCommitment,
      rowString(voucherRow, "voucher_signature") as Hex,
      authorization.voteKeySignature,
    ],
  });
}

async function assertSignedRaterTransactionIntent(input: {
  account: Account;
  data: Hex;
  nonce: number;
  signedTransaction: Hex;
  to: Address;
}) {
  try {
    const transaction = parseTransaction(input.signedTransaction);
    const signer = await recoverTransactionAddress({
      serializedTransaction: input.signedTransaction as Parameters<
        typeof recoverTransactionAddress
      >[0]["serializedTransaction"],
    });
    if (
      transaction.chainId !== baseSepolia.id ||
      getAddress(signer) !== getAddress(input.account.address) ||
      transaction.nonce !== input.nonce ||
      !transaction.to ||
      getAddress(transaction.to) !== getAddress(input.to) ||
      (transaction.data ?? "0x").toLowerCase() !== input.data.toLowerCase() ||
      (transaction.value ?? 0n) !== 0n
    ) {
      throw new Error("intent mismatch");
    }
  } catch {
    throw new TokenlessServiceError(
      "The persisted rater transaction does not match the intended sponsored commit.",
      409,
      "rater_signed_transaction_mismatch",
    );
  }
}

type PersistedRaterTransaction = { hash: Hash; signedTransaction: Hex; recovered: boolean };

async function preparePersistedRaterTransaction(input: {
  account: Account;
  commitId: string;
  data: Hex;
  nonce: number;
  simulate?: () => Promise<unknown>;
  to: Address;
  wallet: TokenlessWalletClient;
}): Promise<PersistedRaterTransaction> {
  const existing = await dbClient.execute({
    sql: `SELECT relay_signed_transaction, transaction_hash, transaction_recovery_version
          FROM tokenless_rater_commits WHERE commit_id = ? LIMIT 1`,
    args: [input.commitId],
  });
  const row = existing.rows[0] as Row | undefined;
  const persistedHash = rowString(row, "transaction_hash") as Hash | null;
  const persistedSigned = rowString(row, "relay_signed_transaction") as Hex | null;
  if (persistedSigned) {
    const derivedHash = keccak256(persistedSigned);
    if (!persistedHash || !isHash(persistedHash) || derivedHash.toLowerCase() !== persistedHash.toLowerCase()) {
      throw new TokenlessServiceError(
        "The persisted rater transaction does not match its transaction hash.",
        409,
        "rater_signed_transaction_mismatch",
      );
    }
    await assertSignedRaterTransactionIntent({ ...input, signedTransaction: persistedSigned });
    return { hash: derivedHash, signedTransaction: persistedSigned, recovered: true };
  }
  if (persistedHash) {
    throw new TokenlessServiceError(
      "This legacy rater transaction has no durable signed bytes and requires explicit reconciliation.",
      409,
      "rater_transaction_reconciliation_required",
    );
  }
  if (Number(row?.transaction_recovery_version ?? 0) !== 1) {
    throw new TokenlessServiceError(
      "This legacy rater attempt cannot be broadcast without durable transaction recovery.",
      409,
      "rater_transaction_reconciliation_required",
    );
  }
  if (input.account.type !== "local") {
    throw new TokenlessServiceError(
      "Sponsored commits require a local signing account for durable recovery.",
      503,
      "local_commit_relayer_required",
    );
  }
  if (input.simulate) await input.simulate();
  const request = await input.wallet.prepareTransactionRequest({
    account: input.account,
    chain: baseSepolia,
    data: input.data,
    nonce: input.nonce,
    to: input.to,
    value: 0n,
  });
  const signableRequest = Object.fromEntries(
    Object.entries(request).filter(([key]) => key !== "account" && key !== "chain" && key !== "from"),
  ) as TransactionSerializable;
  const signedTransaction = await input.account.signTransaction(signableRequest);
  const hash = keccak256(signedTransaction);
  await assertSignedRaterTransactionIntent({ ...input, signedTransaction });
  const stored = await dbClient.execute({
    sql: `UPDATE tokenless_rater_commits
          SET relay_signed_transaction = ?, transaction_hash = ?, state = 'signed', failure_code = NULL, updated_at = ?
          WHERE commit_id = ? AND relay_nonce = ? AND relay_signed_transaction IS NULL AND transaction_hash IS NULL`,
    args: [signedTransaction, hash, new Date(), input.commitId, input.nonce],
  });
  if (stored.rowCount !== 1) {
    const winner = await dbClient.execute({
      sql: `SELECT relay_signed_transaction, transaction_hash
            FROM tokenless_rater_commits WHERE commit_id = ? LIMIT 1`,
      args: [input.commitId],
    });
    const winnerRow = winner.rows[0] as Row | undefined;
    const winnerSigned = rowString(winnerRow, "relay_signed_transaction") as Hex | null;
    const winnerHash = rowString(winnerRow, "transaction_hash") as Hash | null;
    if (winnerSigned && winnerHash && isHash(winnerHash) && keccak256(winnerSigned) === winnerHash.toLowerCase()) {
      await assertSignedRaterTransactionIntent({ ...input, signedTransaction: winnerSigned });
      return { hash: winnerHash, signedTransaction: winnerSigned, recovered: true };
    }
    throw new TokenlessServiceError(
      "The rater transaction state changed before the signed transaction could be stored.",
      409,
      "rater_commit_state_superseded",
      true,
    );
  }
  return { hash, signedTransaction, recovered: false };
}

async function broadcastPersistedRaterTransaction(
  wallet: TokenlessWalletClient,
  publicClient: TokenlessChainRuntime["publicClient"],
  transaction: PersistedRaterTransaction,
) {
  let observedHash: string | null = null;
  try {
    const observed = await publicClient.getTransaction({ hash: transaction.hash });
    observedHash = observed.hash;
  } catch {
    // The exact transaction is not currently observable. The persisted bytes
    // are the only mutation a recovery attempt may replay.
  }
  if (observedHash !== null) {
    if (observedHash.toLowerCase() !== transaction.hash.toLowerCase()) {
      throw new TokenlessServiceError(
        "The RPC returned a different hash for the persisted rater transaction.",
        409,
        "rater_signed_transaction_mismatch",
      );
    }
    return;
  }
  try {
    const broadcastHash = await wallet.sendRawTransaction({ serializedTransaction: transaction.signedTransaction });
    if (broadcastHash.toLowerCase() !== transaction.hash.toLowerCase()) {
      throw new TokenlessServiceError(
        "The RPC returned a different hash for the persisted rater transaction.",
        409,
        "rater_signed_transaction_mismatch",
      );
    }
  } catch (error) {
    if (error instanceof TokenlessServiceError) throw error;
    try {
      const observed = await publicClient.getTransaction({ hash: transaction.hash });
      if (observed.hash.toLowerCase() === transaction.hash.toLowerCase()) return;
    } catch {
      // Acceptance remains ambiguous. Keep the exact signed bytes retryable.
    }
    throw new TokenlessServiceError(
      "The RPC did not confirm acceptance of the persisted rater transaction.",
      502,
      "rater_broadcast_unconfirmed",
      true,
    );
  }
}

async function markRaterTransactionSubmitted(commitId: string, transaction: PersistedRaterTransaction) {
  const stored = await dbClient.execute({
    sql: `UPDATE tokenless_rater_commits
          SET state = 'submitted', failure_code = NULL, updated_at = ?
          WHERE commit_id = ? AND transaction_hash = ? AND relay_signed_transaction = ?
            AND state IN ('prepared', 'signed', 'retry')`,
    args: [new Date(), commitId, transaction.hash, transaction.signedTransaction],
  });
  if (stored.rowCount === 1) return;
  const current = await dbClient.execute({
    sql: "SELECT state, transaction_hash FROM tokenless_rater_commits WHERE commit_id = ? LIMIT 1",
    args: [commitId],
  });
  const row = current.rows[0] as Row | undefined;
  if (
    new Set(["submitted", "confirmed"]).has(rowString(row, "state") ?? "") &&
    rowString(row, "transaction_hash")?.toLowerCase() === transaction.hash.toLowerCase()
  ) {
    return;
  }
  throw new TokenlessServiceError(
    "The rater transaction state changed before submission could be recorded.",
    409,
    "rater_commit_state_superseded",
    true,
  );
}

async function markRaterTransactionRetry(commitId: string, transaction: PersistedRaterTransaction) {
  await dbClient.execute({
    sql: `UPDATE tokenless_rater_commits
          SET state = 'retry', failure_code = 'relay_failed', updated_at = ?
          WHERE commit_id = ? AND transaction_hash = ? AND relay_signed_transaction = ?
            AND state IN ('prepared', 'signed', 'retry')`,
    args: [new Date(), commitId, transaction.hash, transaction.signedTransaction],
  });
}

async function reconcileSubmittedRaterCommitReceipt(row: Row, publicClient: TokenlessChainRuntime["publicClient"]) {
  const commitId = rowString(row, "commit_id");
  const hash = rowString(row, "transaction_hash");
  if (rowString(row, "state") !== "submitted" || !commitId || !hash || !isHash(hash)) return row;

  let receipt: Awaited<ReturnType<TokenlessChainRuntime["publicClient"]["getTransactionReceipt"]>>;
  try {
    receipt = await publicClient.getTransactionReceipt({ hash });
  } catch {
    // Receipt is not available yet. The scheduled recovery item remains due.
    return row;
  }

  const success = receipt.status === "success";
  const now = new Date();
  const settled = await dbClient.execute({
    sql: `UPDATE tokenless_rater_commits
          SET state = ?, failure_code = ?, confirmed_at = ?, updated_at = ?
          WHERE commit_id = ? AND transaction_hash = ? AND state = 'submitted'
          RETURNING *`,
    args: [
      success ? "confirmed" : "failed",
      success ? null : "transaction_reverted",
      success ? now : null,
      now,
      commitId,
      hash,
    ],
  });
  const settledRow = settled.rows[0] as Row | undefined;
  if (settledRow && success) {
    await dbClient.execute({
      sql: "UPDATE tokenless_paid_vouchers SET status = 'committed', committed_at = ? WHERE voucher_id = ?",
      args: [now, rowString(settledRow, "voucher_id")],
    });
  }
  if (settledRow) return settledRow;

  const current = await dbClient.execute({
    sql: "SELECT * FROM tokenless_rater_commits WHERE commit_id = ? LIMIT 1",
    args: [commitId],
  });
  return (current.rows[0] as Row | undefined) ?? row;
}

function assertIsolatedCommitRelayer(runtime: TokenlessChainRuntime) {
  if (
    runtime.relayerAccount &&
    runtime.prepaidAccount &&
    getAddress(runtime.relayerAccount.address) === getAddress(runtime.prepaidAccount.address)
  ) {
    throw new TokenlessServiceError(
      "The sponsored commit relayer must not reuse the prepaid funder account.",
      503,
      "commit_relayer_role_conflict",
    );
  }
}

export async function relayPaidRaterCommit(input: { principalId: string; request: RaterCommitRequest }) {
  if (!IDEMPOTENCY.test(input.request.idempotencyKey)) {
    throw new TokenlessServiceError("Commit idempotency key is invalid.", 400, "invalid_idempotency_key");
  }
  validateAuthorization(input.request.authorization);
  const config = loadTokenlessChainConfig();
  const runtime = getTokenlessChainRuntime(config);
  if (!runtime.relayerAccount || !runtime.relayerWallet) {
    throw new TokenlessServiceError("Sponsored commit relay is unavailable.", 503, "commit_relayer_unavailable", true);
  }
  assertIsolatedCommitRelayer(runtime);
  await assertLiveTokenlessDeployment(config, runtime);
  const voucherResult = await dbClient.execute({
    sql: `SELECT v.*, p.principal_id, vr.voucher_deadline,
                 vr.admission_policy_hash AS round_admission_policy_hash, e.round_terms_json,
                 e.operation_key, o.question_id, c.content_json
          FROM tokenless_paid_vouchers v
          JOIN tokenless_rater_profiles p ON p.rater_id = v.rater_id
          JOIN tokenless_voucher_rounds vr ON vr.chain_id = v.chain_id AND vr.panel_address = v.panel_address AND vr.round_id = v.round_id
          JOIN tokenless_chain_executions e ON e.chain_id = v.chain_id AND e.panel_address = v.panel_address AND e.round_id = v.round_id
          JOIN tokenless_ask_ownership o ON o.operation_key = e.operation_key
          JOIN tokenless_question_records q ON q.question_id = o.question_id
          JOIN tokenless_content_records c ON c.content_id = q.content_id
          WHERE v.voucher_id = ? LIMIT 1`,
    args: [input.request.voucherId],
  });
  const voucherRow = voucherResult.rows[0] as Row | undefined;
  if (!voucherRow || rowString(voucherRow, "principal_id") !== input.principalId) {
    throw new TokenlessServiceError("Voucher not found.", 404, "voucher_not_found");
  }
  const voucher = JSON.parse(rowString(voucherRow, "voucher_json")!) as Record<string, string | number>;
  const auth = input.request.authorization;
  const terms = JSON.parse(rowString(voucherRow, "round_terms_json")!) as Record<string, string | number>;
  if (
    rowString(voucherRow, "status") !== "issued" ||
    new Date(String(voucherRow.voucher_deadline)) <= new Date() ||
    Number(terms.beaconRound) !== auth.beaconRound ||
    String(terms.beaconNetworkHash).toLowerCase() !== TOKENLESS_QUICKNET_T_CHAIN_HASH.toLowerCase() ||
    auth.roundId !== String(voucher.roundId) ||
    getAddress(auth.voteKey) !== getAddress(String(voucher.voteKey)) ||
    auth.nullifier.toLowerCase() !== String(voucher.nullifier).toLowerCase() ||
    String(voucher.admissionPolicyHash).toLowerCase() !== String(voucherRow.admission_policy_hash).toLowerCase() ||
    String(voucher.admissionPolicyHash).toLowerCase() !==
      String(voucherRow.round_admission_policy_hash).toLowerCase() ||
    auth.chainId !== config.chainId ||
    getAddress(auth.panelAddress) !== config.panelAddress
  ) {
    throw new TokenlessServiceError(
      "Commit does not match its live voucher and round.",
      409,
      "commit_voucher_mismatch",
    );
  }
  const recovered = await recoverTypedDataAddress({
    ...tokenlessCommitTypedData({
      chainId: auth.chainId,
      panelAddress: auth.panelAddress,
      roundId: BigInt(auth.roundId),
      sealedCommitment: auth.sealedCommitment,
      sealedPayloadHash: auth.sealedPayloadHash,
      payoutCommitment: auth.payoutCommitment,
      nullifier: auth.nullifier,
    }),
    signature: auth.voteKeySignature,
  });
  if (getAddress(recovered) !== getAddress(auth.voteKey)) {
    throw new TokenlessServiceError("Vote key signature is invalid.", 401, "invalid_vote_key_signature");
  }
  const requestJson = stableJson(input.request);
  const requestHash = digest(requestJson);
  let commitId: string;
  let persistedNonce: number | null = null;
  let terminalPrevious: Row | null = null;
  const preparationClient = await dbPool.connect();
  try {
    await preparationClient.query("BEGIN");
    const previous = await lockCommitForVoucher(preparationClient, input.request.voucherId);
    const previousRow = previous.rows[0] as Row | undefined;
    const now = new Date();
    if (previousRow) {
      if (rowString(previousRow, "request_hash") !== requestHash) {
        throw new TokenlessServiceError("Commit request conflicts with the existing attempt.", 409, "commit_conflict");
      }
      commitId = rowString(previousRow, "commit_id")!;
      persistedNonce = rowString(previousRow, "relay_nonce") === null ? null : Number(previousRow.relay_nonce);
      if (!new Set(["prepared", "signed", "retry"]).has(rowString(previousRow, "state") ?? "")) {
        terminalPrevious = previousRow;
      }
    } else {
      commitId = `cmt_${randomUUID().replaceAll("-", "")}`;
      const relayPayloadJson = stableJson({
        idempotencyKey: input.request.idempotencyKey,
        voucherId: input.request.voucherId,
        authorization: input.request.authorization,
      });
      await preparationClient.query(
        `INSERT INTO tokenless_rater_commits
          (commit_id, voucher_id, request_idempotency_key, request_hash, deployment_key, round_id, vote_key,
           sealed_commitment, sealed_payload_hash, payout_commitment, relay_payload_json, state, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'prepared', $12, $12)`,
        [
          commitId,
          input.request.voucherId,
          input.request.idempotencyKey,
          requestHash,
          config.deploymentKey,
          auth.roundId,
          auth.voteKey.toLowerCase(),
          auth.sealedCommitment,
          auth.sealedPayloadHash,
          auth.payoutCommitment,
          relayPayloadJson,
          now,
        ],
      );
    }
    const question = JSON.parse(rowString(voucherRow, "content_json")!) as {
      rationale?: { mode: "off" | "optional" | "required"; minLength?: number; maxLength?: number };
    };
    await preparePublicRaterResponse(preparationClient, {
      voucherId: input.request.voucherId,
      operationKey: rowString(voucherRow, "operation_key")!,
      questionId: rowString(voucherRow, "question_id")!,
      roundId: auth.roundId,
      contentId: String(voucher.contentId) as Hex,
      voteKey: auth.voteKey,
      rationale: question.rationale,
      response: input.request.response,
      now,
    });
    await preparationClient.query("COMMIT");
  } catch (error) {
    await preparationClient.query("ROLLBACK");
    throw error;
  } finally {
    preparationClient.release();
  }
  if (terminalPrevious) return publicCommit(terminalPrevious);
  const data = paidCommitData(voucherRow, auth);
  const simulateCommit = async () =>
    runtime.publicClient.simulateContract({
      account: runtime.relayerAccount,
      abi: TokenlessPanelAbi,
      address: config.panelAddress,
      functionName: "commit",
      args: [
        {
          voteKey: getAddress(String(voucher.voteKey)),
          contentId: String(voucher.contentId) as Hex,
          roundId: BigInt(String(voucher.roundId)),
          nullifier: String(voucher.nullifier) as Hex,
          admissionPolicyHash: String(voucher.admissionPolicyHash) as Hex,
          issuerEpoch: BigInt(String(voucher.issuerEpoch)),
          expiresAt: BigInt(String(voucher.expiresAt)),
        },
        auth.sealedCommitment,
        auth.sealedPayload,
        auth.payoutCommitment,
        rowString(voucherRow, "voucher_signature") as Hex,
        auth.voteKeySignature,
      ],
    });
  let nonce = persistedNonce;
  if (persistedNonce === null) {
    await simulateCommit();
    const candidate = await allocateRelayNonce(
      config.deploymentKey,
      runtime.relayerAccount.address,
      await runtime.publicClient.getTransactionCount({ address: runtime.relayerAccount.address, blockTag: "pending" }),
    );
    const reserved = await dbClient.execute({
      sql: `UPDATE tokenless_rater_commits SET relay_nonce = ?, updated_at = ?
            WHERE commit_id = ? AND relay_nonce IS NULL RETURNING relay_nonce`,
      args: [candidate, new Date(), commitId],
    });
    if (reserved.rows[0]) nonce = Number((reserved.rows[0] as Row).relay_nonce);
    else {
      const current = await dbClient.execute({
        sql: "SELECT relay_nonce FROM tokenless_rater_commits WHERE commit_id = ? LIMIT 1",
        args: [commitId],
      });
      nonce = Number((current.rows[0] as Row | undefined)?.relay_nonce);
    }
  }
  if (nonce === null || !Number.isSafeInteger(nonce) || nonce < 0) {
    throw new TokenlessServiceError(
      "The sponsored commit nonce is unavailable.",
      503,
      "commit_nonce_unavailable",
      true,
    );
  }
  const transaction = await preparePersistedRaterTransaction({
    account: runtime.relayerAccount,
    commitId,
    data,
    nonce,
    simulate: persistedNonce === null ? undefined : simulateCommit,
    to: config.panelAddress,
    wallet: runtime.relayerWallet,
  });
  try {
    await broadcastPersistedRaterTransaction(runtime.relayerWallet, runtime.publicClient, transaction);
  } catch (error) {
    await markRaterTransactionRetry(commitId, transaction);
    throw error;
  }
  await markRaterTransactionSubmitted(commitId, transaction);
  const stored = await dbClient.execute({
    sql: "SELECT * FROM tokenless_rater_commits WHERE commit_id = ?",
    args: [commitId],
  });
  return publicCommit(stored.rows[0] as Row);
}

export async function reconcilePaidRaterCommit(commitId: string) {
  const result = await dbClient.execute({
    sql: `SELECT c.*, v.voucher_json, v.voucher_signature
          FROM tokenless_rater_commits c
          JOIN tokenless_paid_vouchers v ON v.voucher_id = c.voucher_id
          WHERE c.commit_id = ? LIMIT 1`,
    args: [commitId],
  });
  const row = result.rows[0] as Row | undefined;
  if (!row) return null;
  const state = rowString(row, "state");
  if (state === "confirmed" || state === "failed") return publicCommit(row);
  if (state === "submitted") {
    const config = loadTokenlessChainConfig();
    const runtime = getTokenlessChainRuntime(config);
    return publicCommit(await reconcileSubmittedRaterCommitReceipt(row, runtime.publicClient));
  }
  const signedTransaction = rowString(row, "relay_signed_transaction") as Hex | null;
  const transactionHash = rowString(row, "transaction_hash") as Hash | null;
  const nonceValue = rowString(row, "relay_nonce");
  if (!signedTransaction || !transactionHash || nonceValue === null) {
    throw new TokenlessServiceError(
      "The rater commit has no durable signed transaction to recover.",
      409,
      "rater_transaction_reconciliation_required",
    );
  }
  const nonce = Number(nonceValue);
  if (!Number.isSafeInteger(nonce) || nonce < 0) {
    throw new TokenlessServiceError(
      "The persisted rater relay nonce is invalid.",
      409,
      "rater_signed_transaction_mismatch",
    );
  }
  const payload = JSON.parse(rowString(row, "relay_payload_json") ?? "null") as {
    authorization?: RaterCommitRequest["authorization"];
  } | null;
  if (!payload?.authorization) {
    throw new TokenlessServiceError(
      "The persisted rater relay payload is unavailable.",
      409,
      "rater_signed_transaction_mismatch",
    );
  }
  validateAuthorization(payload.authorization);
  const config = loadTokenlessChainConfig();
  if (
    rowString(row, "deployment_key") !== config.deploymentKey ||
    payload.authorization.chainId !== config.chainId ||
    getAddress(payload.authorization.panelAddress) !== getAddress(config.panelAddress)
  ) {
    throw new TokenlessServiceError(
      "The persisted rater transaction belongs to another deployment.",
      409,
      "rater_signed_transaction_mismatch",
    );
  }
  const runtime = getTokenlessChainRuntime(config);
  if (!runtime.relayerAccount || !runtime.relayerWallet) {
    throw new TokenlessServiceError("Sponsored commit relay is unavailable.", 503, "commit_relayer_unavailable", true);
  }
  assertIsolatedCommitRelayer(runtime);
  await assertLiveTokenlessDeployment(config, runtime);
  const transaction = await preparePersistedRaterTransaction({
    account: runtime.relayerAccount,
    commitId,
    data: paidCommitData(row, payload.authorization),
    nonce,
    to: config.panelAddress,
    wallet: runtime.relayerWallet,
  });
  await broadcastPersistedRaterTransaction(runtime.relayerWallet, runtime.publicClient, transaction);
  await markRaterTransactionSubmitted(commitId, transaction);
  const stored = await dbClient.execute({
    sql: "SELECT * FROM tokenless_rater_commits WHERE commit_id = ? LIMIT 1",
    args: [commitId],
  });
  return publicCommit(stored.rows[0] as Row);
}

export async function getPaidRaterCommit(input: { principalId: string; commitId: string }) {
  const result = await dbClient.execute({
    sql: `SELECT c.*, p.principal_id FROM tokenless_rater_commits c
          JOIN tokenless_paid_vouchers v ON v.voucher_id = c.voucher_id
          JOIN tokenless_rater_profiles p ON p.rater_id = v.rater_id WHERE c.commit_id = ? LIMIT 1`,
    args: [input.commitId],
  });
  const row = result.rows[0] as Row | undefined;
  if (!row || rowString(row, "principal_id") !== input.principalId) {
    throw new TokenlessServiceError("Commit not found.", 404, "commit_not_found");
  }
  if (rowString(row, "state") === "submitted") {
    const config = loadTokenlessChainConfig();
    const runtime = getTokenlessChainRuntime(config);
    return publicCommit(await reconcileSubmittedRaterCommitReceipt(row, runtime.publicClient));
  }
  return publicCommit(row);
}

export const __raterServiceTestUtils = {
  assertSignedRaterTransactionIntent,
  broadcastPersistedRaterTransaction,
  lockCommitForVoucher,
  markRaterTransactionRetry,
  preparePersistedRaterTransaction,
  reconcileSubmittedRaterCommitReceipt,
  validateAuthorization,
};

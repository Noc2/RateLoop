import { createHash } from "node:crypto";
import "server-only";
import {
  type Account,
  type Address,
  type Hash,
  type Hex,
  type TransactionSerializable,
  decodeEventLog,
  encodeFunctionData,
  getAddress,
  isAddress,
  isHash,
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
} from "viem";
import { baseSepolia } from "viem/chains";
import { dbClient, dbPool } from "~~/lib/db";
import { type TokenlessChainConfig, loadTokenlessChainConfig } from "~~/lib/tokenless/chain/config";
import {
  type EvmTransactionLocator,
  maybeReplaceUnobservedEvmTransaction,
  persistInitialEvmTransaction,
} from "~~/lib/tokenless/chain/evmTransactionReplacement";
import {
  type TokenlessChainRuntime,
  type TokenlessWalletClient,
  assertLiveTokenlessDeployment,
  getTokenlessChainRuntime,
} from "~~/lib/tokenless/chain/runtime";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import {
  DEFAULT_SURPRISE_MINIMUM_SAMPLE,
  DEFAULT_SURPRISE_SATURATION_BPS,
  DEFAULT_SURPRISE_THRESHOLD_BPS,
  SURPRISE_BOUNTY_VERSION,
  type SurpriseBountyReport,
  computeSurpriseBountyRound,
  maximumSurpriseBonusForBase,
} from "~~/lib/tokenless/surpriseBounties";

const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { indexed: true, name: "from", type: "address" },
      { indexed: true, name: "to", type: "address" },
      { indexed: false, name: "value", type: "uint256" },
    ],
  },
] as const;

const MAX_ATTEMPTS = 20;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
type Row = Record<string, unknown>;

export type SurpriseBountyClaim = {
  deploymentKey: string;
  roundId: string;
  commitKey: `0x${string}`;
  payoutAddress: Address;
  amountAtomic: string;
  transactionHash: Hash;
};

type SurprisePayment = {
  entitlementId: string;
  operationKey: string;
  payoutAddress: Address;
  amountAtomic: bigint;
  config: TokenlessChainConfig;
  runtime: TokenlessChainRuntime;
};

function rowString(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function policy(input: { guaranteedBasePerReportAtomic: bigint; maximumReports: number; feeAmountAtomic: bigint }) {
  const formulaMaximumBonus = maximumSurpriseBonusForBase(input.guaranteedBasePerReportAtomic);
  const feeBackedMaximumBonus = input.feeAmountAtomic / BigInt(input.maximumReports);
  const maximumBonusPerReportAtomic =
    formulaMaximumBonus < feeBackedMaximumBonus ? formulaMaximumBonus : feeBackedMaximumBonus;
  return {
    version: SURPRISE_BOUNTY_VERSION,
    minimumSampleSize: DEFAULT_SURPRISE_MINIMUM_SAMPLE,
    qualificationThresholdBps: DEFAULT_SURPRISE_THRESHOLD_BPS,
    saturationMarginBps: DEFAULT_SURPRISE_SATURATION_BPS,
    guaranteedBasePerReportAtomic: input.guaranteedBasePerReportAtomic.toString(),
    maximumBonusPerReportAtomic: maximumBonusPerReportAtomic.toString(),
    reservedReportCapacity: input.maximumReports,
    feeAmountAtomic: input.feeAmountAtomic.toString(),
    maximumLiabilityAtomic: (maximumBonusPerReportAtomic * BigInt(input.maximumReports)).toString(),
    verdictEffect: "none" as const,
    funding: "centralized_platform_usdc" as const,
  };
}

function assertBonusRuntime(runtime: TokenlessChainRuntime) {
  if (!runtime.surpriseBonusAccount) {
    throw new TokenlessServiceError(
      "TOKENLESS_SURPRISE_BONUS_FUNDER_PRIVATE_KEY is required before a paid round can be prepared.",
      503,
      "surprise_bonus_funder_unavailable",
      true,
    );
  }
  return runtime.surpriseBonusAccount;
}

export async function reserveSurpriseBountyCapacity(input: {
  operationKey: string;
  guaranteedBasePerReportAtomic: bigint;
  maximumReports: number;
  feeAmountAtomic: bigint;
  config?: TokenlessChainConfig;
  runtime?: TokenlessChainRuntime;
  now?: Date;
  expiresAt: Date;
}) {
  if (!Number.isSafeInteger(input.maximumReports) || input.maximumReports < 1 || input.maximumReports > 500) {
    throw new Error("Surprise-bounty report capacity must be between 1 and 500.");
  }
  const config = input.config ?? loadTokenlessChainConfig();
  const runtime = input.runtime ?? getTokenlessChainRuntime(config);
  const account = assertBonusRuntime(runtime);
  if (input.feeAmountAtomic < 1n) {
    throw new TokenlessServiceError(
      "The frozen round fee cannot support surprise-bounty liability.",
      409,
      "surprise_bonus_invalid_economics",
    );
  }
  const frozenPolicy = policy(input);
  const maximumBonusPerReportAtomic = BigInt(frozenPolicy.maximumBonusPerReportAtomic);
  if (maximumBonusPerReportAtomic <= 0n) {
    throw new TokenlessServiceError(
      "The guaranteed base is too small to fund the frozen surprise-bounty increment.",
      409,
      "surprise_bonus_invalid_economics",
    );
  }
  const maximumLiabilityAtomic = maximumBonusPerReportAtomic * BigInt(input.maximumReports);
  if (maximumLiabilityAtomic > input.feeAmountAtomic) {
    throw new Error("Surprise-bounty liability exceeds the frozen round fee.");
  }
  const now = input.now ?? new Date();
  if (!Number.isFinite(input.expiresAt.getTime()) || input.expiresAt <= now) {
    throw new TokenlessServiceError(
      "The payment instructions can no longer reserve surprise-bounty capacity.",
      409,
      "surprise_bonus_reservation_expired",
    );
  }
  const client = await dbPool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [`surprise-bounty:${config.deploymentKey}`]);
    await client.query(
      `UPDATE tokenless_surprise_bounty_rounds
       SET state = 'expired', reservation_expires_at = NULL, updated_at = $1
       WHERE deployment_key = $2 AND state = 'reserved' AND reservation_expires_at <= $1`,
      [now, config.deploymentKey],
    );
    const existing = await client.query(
      `SELECT * FROM tokenless_surprise_bounty_rounds WHERE operation_key = $1 LIMIT 1`,
      [input.operationKey],
    );
    let existingBountyRoundId: string | null = null;
    let renewExpiredReservation = false;
    if (existing.rows[0]) {
      const row = existing.rows[0] as Row;
      if (
        rowString(row, "deployment_key") !== config.deploymentKey ||
        rowString(row, "policy_json") !== stableJson(frozenPolicy) ||
        rowString(row, "maximum_liability_atomic") !== maximumLiabilityAtomic.toString()
      ) {
        throw new TokenlessServiceError(
          "The operation already has a different frozen surprise-bounty reservation.",
          409,
          "surprise_bonus_reservation_conflict",
        );
      }
      existingBountyRoundId = rowString(row, "bounty_round_id")!;
      renewExpiredReservation = rowString(row, "state") === "expired";
    }
    await assertLiveTokenlessDeployment(config, runtime);
    const onchainBalance = await runtime.publicClient.readContract({
      abi: ERC20_ABI,
      address: config.usdcAddress,
      functionName: "balanceOf",
      args: [account.address],
    });
    const outstanding = await client.query(
      `SELECT COALESCE(SUM(
         CASE WHEN state IN ('reserved', 'funded') THEN maximum_liability_atomic
              WHEN state IN ('allocated', 'complete') THEN COALESCE(total_bonus_atomic, 0) - paid_bonus_atomic
              ELSE 0 END
       ), 0) AS amount
       FROM tokenless_surprise_bounty_rounds
       WHERE deployment_key = $1`,
      [config.deploymentKey],
    );
    const outstandingAtomic = BigInt(String(outstanding.rows[0]?.amount ?? "0"));
    const requiredCoverageAtomic =
      outstandingAtomic + (!existingBountyRoundId || renewExpiredReservation ? maximumLiabilityAtomic : 0n);
    if (BigInt(onchainBalance) < requiredCoverageAtomic) {
      throw new TokenlessServiceError(
        "The dedicated surprise-bonus funder does not cover existing reservations plus this round's maximum liability.",
        503,
        "surprise_bonus_capacity_unavailable",
        true,
      );
    }
    if (existingBountyRoundId && !renewExpiredReservation) {
      return { bountyRoundId: existingBountyRoundId, maximumLiabilityAtomic: maximumLiabilityAtomic.toString() };
    }
    if (existingBountyRoundId) {
      await client.query(
        `UPDATE tokenless_surprise_bounty_rounds
         SET state = 'reserved', reservation_expires_at = $1, updated_at = $2
         WHERE bounty_round_id = $3 AND state = 'expired'`,
        [input.expiresAt, now, existingBountyRoundId],
      );
      return { bountyRoundId: existingBountyRoundId, maximumLiabilityAtomic: maximumLiabilityAtomic.toString() };
    }
    const bountyRoundId = `sbr_${digest(input.operationKey).slice(0, 40)}`;
    await client.query(
      `INSERT INTO tokenless_surprise_bounty_rounds
       (bounty_round_id, operation_key, deployment_key, version, state, policy_json,
        guaranteed_base_per_report_atomic, maximum_bonus_per_report_atomic, reserved_report_capacity,
        maximum_liability_atomic, paid_bonus_atomic, reservation_expires_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'reserved', $5, $6, $7, $8, $9, 0, $10, $11, $11)`,
      [
        bountyRoundId,
        input.operationKey,
        config.deploymentKey,
        SURPRISE_BOUNTY_VERSION,
        stableJson(frozenPolicy),
        input.guaranteedBasePerReportAtomic.toString(),
        maximumBonusPerReportAtomic.toString(),
        input.maximumReports,
        maximumLiabilityAtomic.toString(),
        input.expiresAt,
        now,
      ],
    );
    return { bountyRoundId, maximumLiabilityAtomic: maximumLiabilityAtomic.toString() };
  } finally {
    await client
      .query("SELECT pg_advisory_unlock(hashtext($1))", [`surprise-bounty:${config.deploymentKey}`])
      .catch(() => undefined);
    client.release();
  }
}

export async function finalizeSurpriseBountyRound(input: {
  operationKey: string;
  deploymentKey: string;
  roundId: string;
  reports: SurpriseBountyReport[];
  now?: Date;
}) {
  const reserved = await dbClient.execute({
    sql: "SELECT * FROM tokenless_surprise_bounty_rounds WHERE operation_key = ? LIMIT 1",
    args: [input.operationKey],
  });
  const row = reserved.rows[0] as Row | undefined;
  if (!row) return { status: "not_reserved" as const };
  if (rowString(row, "deployment_key") !== input.deploymentKey) {
    throw new TokenlessServiceError(
      "Surprise-bounty deployment identity does not match.",
      409,
      "evidence_identity_mismatch",
    );
  }
  const reservedReportCapacity = Number(rowString(row, "reserved_report_capacity"));
  if (!Number.isSafeInteger(reservedReportCapacity) || input.reports.length > reservedReportCapacity) {
    throw new TokenlessServiceError(
      "Surprise-bounty evidence exceeds the frozen report capacity.",
      409,
      "evidence_conflict",
    );
  }
  const result = computeSurpriseBountyRound(input.reports, {
    guaranteedBasePerReportAtomic: BigInt(rowString(row, "guaranteed_base_per_report_atomic")!),
    maximumBonusPerReportAtomic: BigInt(rowString(row, "maximum_bonus_per_report_atomic")!),
    minimumSampleSize: DEFAULT_SURPRISE_MINIMUM_SAMPLE,
    qualificationThresholdBps: DEFAULT_SURPRISE_THRESHOLD_BPS,
    saturationMarginBps: DEFAULT_SURPRISE_SATURATION_BPS,
  });
  if (BigInt(result.totalBonusAtomic) > BigInt(rowString(row, "maximum_liability_atomic")!)) {
    throw new TokenlessServiceError(
      "Surprise-bounty allocation exceeds the frozen round liability.",
      409,
      "evidence_conflict",
    );
  }
  const existingHash = rowString(row, "evidence_hash");
  if (existingHash) {
    if (existingHash !== result.evidenceHash || rowString(row, "round_id") !== input.roundId) {
      throw new TokenlessServiceError(
        "Surprise-bounty evidence is immutable for this round.",
        409,
        "evidence_conflict",
      );
    }
    return { status: rowString(row, "state")!, result };
  }
  const now = input.now ?? new Date();
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query(
      "SELECT evidence_hash FROM tokenless_surprise_bounty_rounds WHERE bounty_round_id = $1 FOR UPDATE",
      [rowString(row, "bounty_round_id")],
    );
    if (locked.rows[0]?.evidence_hash && String(locked.rows[0].evidence_hash) !== result.evidenceHash) {
      throw new TokenlessServiceError(
        "Surprise-bounty evidence is immutable for this round.",
        409,
        "evidence_conflict",
      );
    }
    if (!locked.rows[0]?.evidence_hash) {
      for (const allocation of result.allocations.filter(value => BigInt(value.bonusAtomic) > 0n)) {
        await client.query(
          `INSERT INTO tokenless_surprise_bounty_entitlements
           (entitlement_id, bounty_round_id, operation_key, commit_key, vote,
            leave_one_out_actual_side_bps, leave_one_out_predicted_side_bps,
            leave_one_out_surprise_margin_bps, surprise_score_bps, bonus_atomic,
            state, attempt_count, next_attempt_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending_claim', 0, $11, $11, $11)`,
          [
            `sbe_${digest(`${rowString(row, "bounty_round_id")}:${allocation.commitKey}`).slice(0, 40)}`,
            rowString(row, "bounty_round_id"),
            input.operationKey,
            allocation.commitKey,
            allocation.vote,
            allocation.leaveOneOutActualSideBps,
            allocation.leaveOneOutPredictedSideBps,
            allocation.leaveOneOutSurpriseMarginBps,
            allocation.surpriseScoreBps,
            allocation.bonusAtomic,
            now,
          ],
        );
      }
      const persistedState =
        result.state === "allocated"
          ? "allocated"
          : result.state === "insufficient_sample"
            ? "insufficient_sample"
            : "no_qualifying_outcome";
      await client.query(
        `UPDATE tokenless_surprise_bounty_rounds
         SET round_id = $1, state = $2, sample_size = $3, actual_up_bps = $4,
             mean_predicted_up_bps = $5, surprisingly_popular_outcome = $6,
             allocation_hash = $7, evidence_hash = $8, total_bonus_atomic = $9,
             finalized_at = $10, completed_at = $11, reservation_expires_at = NULL, updated_at = $10
         WHERE bounty_round_id = $12`,
        [
          input.roundId,
          persistedState,
          result.sampleSize,
          result.actualUpBps,
          result.meanPredictedUpBps,
          result.surprisinglyPopularOutcome,
          result.allocationHash,
          result.evidenceHash,
          result.totalBonusAtomic,
          now,
          result.state === "allocated" ? null : now,
          rowString(row, "bounty_round_id"),
        ],
      );
    }
    await client.query("COMMIT");
    return { status: result.state, result };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function configuredPonderUrl(raw = process.env.TOKENLESS_PONDER_URL ?? process.env.NEXT_PUBLIC_PONDER_URL) {
  const value = raw?.trim() || (process.env.NODE_ENV === "production" ? "" : "http://127.0.0.1:42069");
  if (!value)
    throw new TokenlessServiceError("Ponder claim source is not configured.", 503, "ponder_unavailable", true);
  const url = new URL(value);
  if (url.username || url.password || url.hash || !["http:", "https:"].includes(url.protocol)) {
    throw new TokenlessServiceError("Ponder claim source is invalid.", 503, "ponder_unavailable", true);
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new TokenlessServiceError("Ponder claim source must use HTTPS.", 503, "ponder_unavailable", true);
  }
  return url;
}

async function fetchClaims(input: { roundId: string; ponderUrl?: string; fetchImpl?: typeof fetch }) {
  const url = configuredPonderUrl(input.ponderUrl);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/rounds/${encodeURIComponent(input.roundId)}/claims`;
  url.search = "";
  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(url, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new TokenlessServiceError("Indexed claims are not available.", 409, "indexed_claims_pending", true);
  }
  if (!response.ok) {
    throw new TokenlessServiceError("Indexed claims are not available.", 409, "indexed_claims_pending", true);
  }
  const raw = (await response.json()) as unknown;
  if (!Array.isArray(raw))
    throw new TokenlessServiceError("Indexed claims are malformed.", 409, "indexed_claims_invalid");
  return raw.map((value, index) => {
    const claim = value as Row;
    const deploymentKey = rowString(claim, "deploymentKey");
    const roundId = rowString(claim, "roundId");
    const commitKey = rowString(claim, "commitKey");
    const payoutAddress = rowString(claim, "payoutAddress");
    const amountAtomic = rowString(claim, "amount");
    const transactionHash = rowString(claim, "txHash");
    if (
      !deploymentKey ||
      !/^\d+$/.test(roundId ?? "") ||
      !BYTES32.test(commitKey ?? "") ||
      !isAddress(payoutAddress ?? "") ||
      !/^[1-9]\d*$/.test(amountAtomic ?? "") ||
      !isHash(transactionHash ?? "")
    ) {
      throw new TokenlessServiceError(`Indexed claim ${index} is malformed.`, 409, "indexed_claims_invalid");
    }
    return {
      deploymentKey,
      roundId: roundId!,
      commitKey: commitKey!.toLowerCase() as `0x${string}`,
      payoutAddress: getAddress(payoutAddress!),
      amountAtomic: amountAtomic!,
      transactionHash: transactionHash as Hash,
    } satisfies SurpriseBountyClaim;
  });
}

async function allocateTransferNonce(input: SurprisePayment) {
  const account = assertBonusRuntime(input.runtime);
  const networkNonce = await input.runtime.publicClient.getTransactionCount({
    address: account.address,
    blockTag: "pending",
  });
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const entitlement = await client.query(
      `SELECT operation_key, payout_address, bonus_atomic, transfer_nonce
       FROM tokenless_surprise_bounty_entitlements WHERE entitlement_id = $1 FOR UPDATE`,
      [input.entitlementId],
    );
    if (!entitlement.rows[0]) throw new Error("Surprise-bonus entitlement not found.");
    if (
      String(entitlement.rows[0].operation_key) !== input.operationKey ||
      getAddress(String(entitlement.rows[0].payout_address)) !== input.payoutAddress ||
      BigInt(String(entitlement.rows[0].bonus_atomic)) !== input.amountAtomic
    ) {
      throw new TokenlessServiceError(
        "The surprise-bonus nonce reservation does not match its durable entitlement.",
        409,
        "surprise_bonus_signed_transaction_mismatch",
      );
    }
    if (entitlement.rows[0]?.transfer_nonce !== null && entitlement.rows[0]?.transfer_nonce !== undefined) {
      await client.query("COMMIT");
      return Number(entitlement.rows[0].transfer_nonce);
    }
    await client.query(
      `INSERT INTO tokenless_chain_signer_nonces (deployment_key, signer_address, next_nonce, updated_at)
       VALUES ($1, $2, $3, $4) ON CONFLICT (deployment_key, signer_address) DO NOTHING`,
      [input.config.deploymentKey, account.address.toLowerCase(), networkNonce, new Date()],
    );
    const locked = await client.query(
      "SELECT next_nonce FROM tokenless_chain_signer_nonces WHERE deployment_key = $1 AND signer_address = $2 FOR UPDATE",
      [input.config.deploymentKey, account.address.toLowerCase()],
    );
    const nonce = Math.max(networkNonce, Number(locked.rows[0].next_nonce));
    await client.query(
      "UPDATE tokenless_chain_signer_nonces SET next_nonce = $1, updated_at = $2 WHERE deployment_key = $3 AND signer_address = $4",
      [nonce + 1, new Date(), input.config.deploymentKey, account.address.toLowerCase()],
    );
    await client.query(
      "UPDATE tokenless_surprise_bounty_entitlements SET transfer_nonce = $1, state = 'paying', updated_at = $2 WHERE entitlement_id = $3",
      [nonce, new Date(), input.entitlementId],
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

function surpriseTransferData(input: Pick<SurprisePayment, "amountAtomic" | "payoutAddress" | "config">) {
  return encodeFunctionData({
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [input.payoutAddress, input.amountAtomic],
  });
}

async function assertSignedSurpriseTransactionIntent(input: {
  account: Account;
  data: Hex;
  nonce: number;
  signedTransaction: Hex;
  token: Address;
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
      getAddress(transaction.to) !== getAddress(input.token) ||
      (transaction.data ?? "0x").toLowerCase() !== input.data.toLowerCase() ||
      (transaction.value ?? 0n) !== 0n
    ) {
      throw new Error("intent mismatch");
    }
  } catch {
    throw new TokenlessServiceError(
      "The persisted surprise-bonus transaction does not match its entitlement.",
      409,
      "surprise_bonus_signed_transaction_mismatch",
    );
  }
}

type PersistedSurpriseTransaction = { hash: Hash; signedTransaction: Hex; recovered: boolean };

async function preparePersistedSurpriseTransaction(input: {
  account: Account;
  data: Hex;
  entitlementId: string;
  nonce: number;
  token: Address;
  wallet: TokenlessWalletClient;
  locator: EvmTransactionLocator;
}): Promise<PersistedSurpriseTransaction> {
  const existing = await dbClient.execute({
    sql: `SELECT transfer_nonce, transfer_signed_transaction, transfer_transaction_hash,
                 transaction_recovery_version
          FROM tokenless_surprise_bounty_entitlements WHERE entitlement_id = ? LIMIT 1`,
    args: [input.entitlementId],
  });
  const row = existing.rows[0] as Row | undefined;
  const persistedNonce = rowString(row, "transfer_nonce");
  if (persistedNonce === null || Number(persistedNonce) !== input.nonce) {
    throw new TokenlessServiceError(
      "The persisted surprise-bonus nonce does not match its entitlement.",
      409,
      "surprise_bonus_signed_transaction_mismatch",
    );
  }
  const persistedSigned = rowString(row, "transfer_signed_transaction") as Hex | null;
  const persistedHash = rowString(row, "transfer_transaction_hash") as Hash | null;
  if (persistedSigned) {
    const derivedHash = keccak256(persistedSigned);
    if (!persistedHash || !isHash(persistedHash) || derivedHash.toLowerCase() !== persistedHash.toLowerCase()) {
      throw new TokenlessServiceError(
        "The persisted surprise-bonus transaction does not match its hash.",
        409,
        "surprise_bonus_signed_transaction_mismatch",
      );
    }
    await assertSignedSurpriseTransactionIntent({ ...input, signedTransaction: persistedSigned });
    return { hash: derivedHash, signedTransaction: persistedSigned, recovered: true };
  }
  if (persistedHash || Number(row?.transaction_recovery_version ?? 0) !== 1) {
    throw new TokenlessServiceError(
      "This legacy surprise-bonus transfer has no durable signed transaction.",
      409,
      "surprise_bonus_reconciliation_required",
    );
  }
  if (input.account.type !== "local") {
    throw new TokenlessServiceError(
      "Surprise-bonus transfers require a recoverable local account interface.",
      503,
      "surprise_bonus_signer_unavailable",
      true,
    );
  }
  const request = await input.wallet.prepareTransactionRequest({
    account: input.account,
    chain: baseSepolia,
    data: input.data,
    nonce: input.nonce,
    to: input.token,
    value: 0n,
  });
  const signableRequest = Object.fromEntries(
    Object.entries(request).filter(([key]) => key !== "account" && key !== "chain" && key !== "from"),
  ) as TransactionSerializable;
  const signedTransaction = await input.account.signTransaction(signableRequest);
  const hash = keccak256(signedTransaction);
  await assertSignedSurpriseTransactionIntent({ ...input, signedTransaction });
  const stored = await persistInitialEvmTransaction({
    account: input.account,
    locator: input.locator,
    transaction: { hash, signedTransaction },
  });
  await assertSignedSurpriseTransactionIntent({ ...input, signedTransaction: stored.signedTransaction });
  return stored;
}

async function broadcastPersistedSurpriseTransaction(
  wallet: TokenlessWalletClient,
  publicClient: TokenlessChainRuntime["publicClient"],
  transaction: PersistedSurpriseTransaction,
) {
  let observedHash: string | null = null;
  try {
    const observed = await publicClient.getTransaction({ hash: transaction.hash });
    observedHash = observed.hash;
  } catch {
    // The exact transaction is not observable yet. Its persisted bytes are the
    // only chain mutation that this entitlement may replay.
  }
  if (observedHash !== null) {
    if (observedHash.toLowerCase() !== transaction.hash.toLowerCase()) {
      throw new TokenlessServiceError(
        "The RPC returned a different hash for the surprise-bonus transaction.",
        409,
        "surprise_bonus_signed_transaction_mismatch",
      );
    }
    return;
  }
  try {
    const broadcastHash = await wallet.sendRawTransaction({ serializedTransaction: transaction.signedTransaction });
    if (broadcastHash.toLowerCase() !== transaction.hash.toLowerCase()) {
      throw new TokenlessServiceError(
        "The RPC returned a different hash for the surprise-bonus transaction.",
        409,
        "surprise_bonus_signed_transaction_mismatch",
      );
    }
  } catch (error) {
    if (error instanceof TokenlessServiceError) throw error;
    try {
      const observed = await publicClient.getTransaction({ hash: transaction.hash });
      if (observed.hash.toLowerCase() === transaction.hash.toLowerCase()) return;
    } catch {
      // Acceptance remains ambiguous; preserve the exact bytes for retry.
    }
    throw new TokenlessServiceError(
      "The RPC did not confirm the surprise-bonus transaction.",
      502,
      "surprise_bonus_broadcast_unconfirmed",
      true,
    );
  }
}

async function defaultPay(input: SurprisePayment) {
  const account = assertBonusRuntime(input.runtime);
  if (!input.runtime.surpriseBonusWallet) throw new Error("Surprise-bonus wallet is unavailable.");
  await assertLiveTokenlessDeployment(input.config, input.runtime);
  const nonce = await allocateTransferNonce(input);
  const locator = {
    businessKey: input.entitlementId,
    businessKind: "surprise_bounty",
    deploymentKey: input.config.deploymentKey,
    signerRole: "surprise_bonus_funder",
    transactionKind: "transfer",
  } as const;
  let transaction = await preparePersistedSurpriseTransaction({
    account,
    data: surpriseTransferData(input),
    entitlementId: input.entitlementId,
    nonce,
    token: input.config.usdcAddress,
    wallet: input.runtime.surpriseBonusWallet,
    locator,
  });
  transaction = await maybeReplaceUnobservedEvmTransaction({
    account,
    locator,
    publicClient: input.runtime.publicClient,
    transaction,
  });
  await broadcastPersistedSurpriseTransaction(
    input.runtime.surpriseBonusWallet,
    input.runtime.publicClient,
    transaction,
  );
  const transactionHash = transaction.hash;
  const receipt = await input.runtime.publicClient.waitForTransactionReceipt({ hash: transactionHash });
  if (receipt.status !== "success") throw new Error("Surprise-bonus USDC transfer reverted.");
  const matchingTransfers = receipt.logs.filter(log => {
    if (log.address.toLowerCase() !== input.config.usdcAddress.toLowerCase()) return false;
    try {
      const decoded = decodeEventLog({
        abi: ERC20_ABI,
        eventName: "Transfer",
        data: log.data,
        topics: log.topics,
        strict: true,
      });
      return (
        getAddress(decoded.args.from) === getAddress(account.address) &&
        getAddress(decoded.args.to) === input.payoutAddress &&
        decoded.args.value === input.amountAtomic
      );
    } catch {
      return false;
    }
  });
  if (matchingTransfers.length !== 1)
    throw new Error("Surprise-bonus receipt does not contain the exact USDC transfer.");
  return transactionHash;
}

function retryAt(now: Date, attempt: number) {
  return new Date(now.getTime() + Math.min(30_000 * 2 ** Math.min(Math.max(attempt - 1, 0), 7), 3_600_000));
}

export async function processSurpriseBountyPayments(
  input: {
    now?: Date;
    limit?: number;
    ponderUrl?: string;
    fetchImpl?: typeof fetch;
    config?: TokenlessChainConfig;
    runtime?: TokenlessChainRuntime;
    claimSource?: (roundId: string) => Promise<SurpriseBountyClaim[]>;
    payer?: (payment: SurprisePayment) => Promise<Hash>;
  } = {},
) {
  const now = input.now ?? new Date();
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const due = await dbClient.execute({
    sql: `SELECT e.*, r.deployment_key, r.round_id
          FROM tokenless_surprise_bounty_entitlements e
          JOIN tokenless_surprise_bounty_rounds r ON r.bounty_round_id = e.bounty_round_id
          WHERE e.state IN ('pending_claim', 'ready', 'retry', 'paying') AND e.next_attempt_at <= ?
          ORDER BY e.next_attempt_at ASC, e.created_at ASC LIMIT ?`,
    args: [now, limit],
  });
  if (due.rows.length === 0) return { paid: 0, pendingClaim: 0, retry: 0, reconciliationRequired: 0 };
  const config = input.config ?? loadTokenlessChainConfig();
  const runtime = input.runtime ?? getTokenlessChainRuntime(config);
  const claimCache = new Map<string, Promise<SurpriseBountyClaim[]>>();
  const summary = { paid: 0, pendingClaim: 0, retry: 0, reconciliationRequired: 0 };
  for (const value of due.rows) {
    const row = value as Row;
    const entitlementId = rowString(row, "entitlement_id")!;
    const roundId = rowString(row, "round_id")!;
    const deploymentKey = rowString(row, "deployment_key")!;
    const commitKey = rowString(row, "commit_key")!.toLowerCase();
    try {
      if (deploymentKey !== config.deploymentKey) {
        throw new TokenlessServiceError(
          "Surprise-bounty entitlement belongs to a stale deployment.",
          409,
          "stale_deployment",
        );
      }
      let claims = claimCache.get(roundId);
      if (!claims) {
        claims = input.claimSource
          ? input.claimSource(roundId)
          : fetchClaims({ roundId, ponderUrl: input.ponderUrl, fetchImpl: input.fetchImpl });
        claimCache.set(roundId, claims);
      }
      const claim = (await claims).find(
        candidate =>
          candidate.deploymentKey === deploymentKey &&
          candidate.roundId === roundId &&
          candidate.commitKey === commitKey,
      );
      if (!claim) {
        summary.pendingClaim += 1;
        continue;
      }
      const boundClaim = await dbClient.execute({
        sql: `UPDATE tokenless_surprise_bounty_entitlements
              SET state = CASE WHEN state = 'pending_claim' THEN 'ready' ELSE state END,
                  payout_address = COALESCE(payout_address, ?),
                  claim_transaction_hash = COALESCE(claim_transaction_hash, ?), updated_at = ?
              WHERE entitlement_id = ?
                AND (payout_address IS NULL OR payout_address = ?)
                AND (claim_transaction_hash IS NULL OR claim_transaction_hash = ?)
              RETURNING entitlement_id`,
        args: [
          claim.payoutAddress.toLowerCase(),
          claim.transactionHash,
          now,
          entitlementId,
          claim.payoutAddress.toLowerCase(),
          claim.transactionHash,
        ],
      });
      if (boundClaim.rowCount !== 1) {
        throw new TokenlessServiceError(
          "The indexed claim conflicts with the entitlement's durable payout binding.",
          409,
          "surprise_bonus_claim_conflict",
        );
      }
      const transactionHash = await (input.payer ?? defaultPay)({
        entitlementId,
        operationKey: rowString(row, "operation_key")!,
        payoutAddress: claim.payoutAddress,
        amountAtomic: BigInt(rowString(row, "bonus_atomic")!),
        config,
        runtime,
      });
      if (!isHash(transactionHash)) throw new Error("Surprise-bonus payer returned an invalid transaction hash.");
      const client = await dbPool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `UPDATE tokenless_surprise_bounty_entitlements
           SET state = 'paid', transfer_transaction_hash = COALESCE(transfer_transaction_hash, $1),
               paid_at = $2, last_error = NULL, updated_at = $2
           WHERE entitlement_id = $3 AND state <> 'paid'`,
          [transactionHash, now, entitlementId],
        );
        const totals = await client.query(
          `SELECT COALESCE(SUM(bonus_atomic), 0) AS paid
           FROM tokenless_surprise_bounty_entitlements WHERE bounty_round_id = $1 AND state = 'paid'`,
          [rowString(row, "bounty_round_id")],
        );
        const paidAtomic = String(totals.rows[0]?.paid ?? "0");
        const round = await client.query(
          "SELECT total_bonus_atomic FROM tokenless_surprise_bounty_rounds WHERE bounty_round_id = $1 FOR UPDATE",
          [rowString(row, "bounty_round_id")],
        );
        const complete = paidAtomic === String(round.rows[0]?.total_bonus_atomic);
        await client.query(
          `UPDATE tokenless_surprise_bounty_rounds
           SET paid_bonus_atomic = $1, state = CASE WHEN $2 THEN 'complete' ELSE state END,
               completed_at = CASE WHEN $2 THEN $3 ELSE completed_at END, updated_at = $3
           WHERE bounty_round_id = $4`,
          [paidAtomic, complete, now, rowString(row, "bounty_round_id")],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      summary.paid += 1;
    } catch (error) {
      const attempt = Number(row.attempt_count) + 1;
      const currentRecovery = await dbClient.execute({
        sql: `SELECT transfer_nonce, transaction_recovery_version
              FROM tokenless_surprise_bounty_entitlements WHERE entitlement_id = ? LIMIT 1`,
        args: [entitlementId],
      });
      const recoveryRow = currentRecovery.rows[0] as Row | undefined;
      const reconciliation =
        error instanceof TokenlessServiceError &&
        new Set([
          "surprise_bonus_claim_conflict",
          "surprise_bonus_reconciliation_required",
          "surprise_bonus_signed_transaction_mismatch",
        ]).has(error.code);
      const recoverableNonceReservation =
        Number(recoveryRow?.transaction_recovery_version ?? 0) === 1 &&
        rowString(recoveryRow, "transfer_nonce") !== null;
      // A reserved nonce cannot be abandoned: later transactions from this
      // signer would remain queued behind it. Keep the exact durable intent
      // retryable until its signed bytes are accepted or an operator resolves
      // an explicit integrity/reconciliation failure.
      const state = reconciliation
        ? "reconciliation_required"
        : attempt >= MAX_ATTEMPTS && !recoverableNonceReservation
          ? "reconciliation_required"
          : "retry";
      await dbClient.execute({
        sql: `UPDATE tokenless_surprise_bounty_entitlements
              SET state = ?, attempt_count = ?, next_attempt_at = ?, last_error = ?, updated_at = ?
              WHERE entitlement_id = ? AND state <> 'paid'`,
        args: [
          state,
          Math.min(attempt, MAX_ATTEMPTS),
          retryAt(now, attempt),
          error instanceof Error ? error.message.slice(0, 500) : "Surprise-bonus payment failed",
          now,
          entitlementId,
        ],
      });
      summary[state === "retry" ? "retry" : "reconciliationRequired"] += 1;
    }
  }
  return summary;
}

export async function getSurpriseBountySummary(operationKey: string) {
  const result = await dbClient.execute({
    sql: `SELECT version, state, round_id, guaranteed_base_per_report_atomic,
                 maximum_bonus_per_report_atomic, maximum_liability_atomic, sample_size,
                 actual_up_bps, mean_predicted_up_bps, surprisingly_popular_outcome,
                 allocation_hash, evidence_hash, total_bonus_atomic, paid_bonus_atomic,
                 finalized_at, completed_at
          FROM tokenless_surprise_bounty_rounds WHERE operation_key = ? LIMIT 1`,
    args: [operationKey],
  });
  const row = result.rows[0] as Row | undefined;
  if (!row) return null;
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]),
  );
}

export const __surpriseBountyServiceTestUtils = {
  allocateTransferNonce,
  assertSignedSurpriseTransactionIntent,
  broadcastPersistedSurpriseTransaction,
  fetchClaims,
  policy,
  preparePersistedSurpriseTransaction,
  stableJson,
  surpriseTransferData,
};

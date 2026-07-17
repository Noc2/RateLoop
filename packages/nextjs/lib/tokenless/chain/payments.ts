import { TOKENLESS_QUICKNET_T_CHAIN_HASH, type TokenlessChainConfig, loadTokenlessChainConfig } from "./config";
import { type TokenlessChainRuntime, assertLiveTokenlessDeployment, getTokenlessChainRuntime } from "./runtime";
import { TokenlessPanelAbi, X402PanelSubmitterAbi } from "@rateloop/contracts/tokenless";
import {
  TOKENLESS_PAYMENT_AUTHORIZATION_SCHEMA_VERSION,
  type TokenlessPaymentInstructions,
  type TokenlessQuoteResponse,
} from "@rateloop/sdk";
import { randomBytes, randomUUID } from "node:crypto";
import "server-only";
import { type Address, type Hash, type Hex, decodeEventLog, encodeFunctionData, getAddress, isHash } from "viem";
import { baseSepolia } from "viem/chains";
import { dbClient, dbPool } from "~~/lib/db";
import { freezeAdmissionPolicy } from "~~/lib/tokenless/admissionPolicy";
import { normalizedX402Authorization } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import { reserveSurpriseBountyCapacity } from "~~/lib/tokenless/surpriseBountyService";

const QUICKNET_T_GENESIS_SECONDS = 1_689_232_296;
const QUICKNET_T_PERIOD_SECONDS = 3;
// A single server-funded execution holds an exclusive claim lease for this long.
// It must comfortably cover approval + createRound broadcast and receipt
// confirmation so a live worker is never displaced, yet still expire so a truly
// crashed worker can be resumed. Fencing tokens guarantee a resumed worker can
// never overwrite a newer claim's writes even if the lease lapses mid-flight.
const CLAIM_LEASE_MS = 10 * 60 * 1_000;
const MAX_FENCING_TOKEN = 2_147_483_647;
const APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;
const ERC20_BALANCE_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

type QueryRow = Record<string, unknown>;

export type PersistedRoundTerms = {
  contentId: Hex;
  termsHash: Hex;
  beaconNetworkHash: Hex;
  bountyAmount: string;
  feeAmount: string;
  attemptReserve: string;
  attemptCompensation: string;
  minimumReveals: number;
  maximumCommits: number;
  admissionPolicyHash: Hex;
  commitDeadline: string;
  revealDeadline: string;
  beaconFailureDeadline: string;
  beaconRound: string;
  claimGracePeriod: string;
  feeRecipient: Address;
};

export type ChainPaymentInstructions = {
  operationKey: string;
  paymentMode: "wallet" | "x402" | "prepaid";
  paymentState: string;
  deploymentKey: string;
  chainId: number;
  panelAddress: Address;
  x402SubmitterAddress: Address;
  usdcAddress: Address;
  funderAddress: Address;
  totalFundedAtomic: string;
  roundTerms: PersistedRoundTerms;
  roundId: string | null;
  transactionHash: Hash | null;
  authorizationSpec?: TokenlessPaymentInstructions["authorizationSpec"];
};

function rowString(row: QueryRow | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
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

function bytes32(value: string | null, name: string): Hex {
  const normalized = value?.startsWith("0x") ? value : `0x${value ?? ""}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized) || /^0x0{64}$/.test(normalized)) {
    throw new TokenlessServiceError(`${name} is not a non-zero bytes32 value.`, 409, "invalid_round_terms");
  }
  return normalized.toLowerCase() as Hex;
}

function toOnchainTerms(terms: PersistedRoundTerms) {
  return {
    ...terms,
    bountyAmount: BigInt(terms.bountyAmount),
    feeAmount: BigInt(terms.feeAmount),
    attemptReserve: BigInt(terms.attemptReserve),
    attemptCompensation: BigInt(terms.attemptCompensation),
    commitDeadline: BigInt(terms.commitDeadline),
    revealDeadline: BigInt(terms.revealDeadline),
    beaconFailureDeadline: BigInt(terms.beaconFailureDeadline),
    beaconRound: BigInt(terms.beaconRound),
    claimGracePeriod: BigInt(terms.claimGracePeriod),
  };
}

function parseTerms(value: string): PersistedRoundTerms {
  return JSON.parse(value) as PersistedRoundTerms;
}

async function operationSource(operationKey: string) {
  const result = await dbClient.execute({
    sql: `SELECT o.operation_key, o.payment_mode, o.payment_reference, o.payment_state,
                 o.question_id, q.terms_hash, q.terms_json, q.moderation_status AS question_moderation_status,
                 c.content_hash, c.moderation_status AS content_moderation_status,
                 a.quote_id, a.economics_json, aq.response_json,
                 pi.payer_address, pi.payload_json, pi.amount_atomic AS intent_amount_atomic,
                 pr.amount_atomic AS reservation_amount_atomic
          FROM tokenless_ask_ownership o
          JOIN tokenless_agent_asks a ON a.operation_key = o.operation_key
          JOIN tokenless_question_records q ON q.question_id = o.question_id
          JOIN tokenless_content_records c ON c.content_id = q.content_id
          JOIN tokenless_agent_quotes aq ON aq.quote_id = a.quote_id
          LEFT JOIN tokenless_payment_intents pi ON pi.payment_intent_id = o.payment_reference
          LEFT JOIN tokenless_prepaid_reservations pr ON pr.reservation_id = o.payment_reference
          WHERE o.operation_key = ? LIMIT 1`,
    args: [operationKey],
  });
  const row = result.rows[0] as QueryRow | undefined;
  if (!row) throw new TokenlessServiceError("Ask not found.", 404, "ask_not_found");
  if (
    rowString(row, "content_moderation_status") !== "approved" ||
    rowString(row, "question_moderation_status") !== "approved"
  ) {
    throw new TokenlessServiceError(
      "The question must pass pre-round moderation before funding.",
      409,
      "content_not_approved",
      true,
    );
  }
  return row;
}

function buildRoundTerms(row: QueryRow, config: TokenlessChainConfig, now: Date): PersistedRoundTerms {
  const quote = JSON.parse(rowString(row, "response_json") ?? "null") as TokenlessQuoteResponse | null;
  if (!quote) throw new TokenlessServiceError("The ask has no quote snapshot.", 409, "invalid_round_terms");
  const bountyAmount = BigInt(quote.economics.bounty.fundedAtomic);
  const feeAmount = BigInt(quote.economics.fee.fundedAtomic);
  const attemptReserve = BigInt(quote.economics.attemptReserve.fundedAtomic);
  const maximumCommits = quote.panel.requestedSize;
  const minimumReveals = quote.panel.minimumReveals;
  const maximumSeatPay = maximumCommits > 0 ? bountyAmount / BigInt(maximumCommits) : 0n;
  const attemptCompensation = (maximumSeatPay * 8_000n) / 10_000n;
  const minimumAttemptReserve = attemptCompensation * BigInt(maximumCommits);
  const frozenProductTerms = JSON.parse(rowString(row, "terms_json") ?? "null") as {
    audiencePolicy?: unknown;
    responseWindowSeconds?: unknown;
  } | null;
  if (!frozenProductTerms?.audiencePolicy) {
    throw new TokenlessServiceError(
      "Live execution requires an exact v2 admission policy; legacy identity tiers are not converted.",
      409,
      "capability_policy_required",
    );
  }
  const admissionPolicy = freezeAdmissionPolicy(frozenProductTerms.audiencePolicy);
  const responseWindowSeconds = frozenProductTerms.responseWindowSeconds;
  if (
    typeof responseWindowSeconds !== "number" ||
    !Number.isSafeInteger(responseWindowSeconds) ||
    responseWindowSeconds < 1_200 ||
    responseWindowSeconds > 86_400
  ) {
    throw new TokenlessServiceError(
      "The frozen response window must be an integer from 1200 to 86400 seconds.",
      409,
      "invalid_response_window",
    );
  }
  if (quote.responseWindowSeconds !== responseWindowSeconds) {
    throw new TokenlessServiceError(
      "The quoted and frozen response windows do not match.",
      409,
      "response_window_mismatch",
    );
  }
  if (quote.audience.admissionPolicyHash.toLowerCase() !== admissionPolicy.admissionPolicyHash.toLowerCase()) {
    throw new TokenlessServiceError(
      "The quoted audience does not match the frozen admission policy.",
      409,
      "admission_policy_mismatch",
    );
  }
  if (
    bountyAmount <= 0n ||
    attemptCompensation <= 0n ||
    attemptReserve < minimumAttemptReserve ||
    minimumReveals < 3 ||
    maximumCommits < minimumReveals ||
    maximumCommits > 500
  ) {
    throw new TokenlessServiceError(
      "The quote cannot produce valid immutable round terms.",
      409,
      "invalid_round_terms",
    );
  }
  const total = bountyAmount + feeAmount + attemptReserve;
  const paymentAmount = BigInt(
    rowString(row, "intent_amount_atomic") ?? rowString(row, "reservation_amount_atomic") ?? "-1",
  );
  if (paymentAmount !== total || rowString(row, "economics_json") !== JSON.stringify(quote.economics)) {
    throw new TokenlessServiceError("Payment and quote economics do not match exactly.", 409, "payment_terms_mismatch");
  }
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  const commitDeadline = nowSeconds + responseWindowSeconds;
  const revealDeadline = commitDeadline + config.revealWindowSeconds;
  const beaconFailureDeadline = revealDeadline + config.beaconFailureGraceSeconds;
  const beaconRound = Math.floor((commitDeadline - QUICKNET_T_GENESIS_SECONDS) / QUICKNET_T_PERIOD_SECONDS) + 1;
  return {
    contentId: bytes32(rowString(row, "content_hash"), "content hash"),
    termsHash: bytes32(rowString(row, "terms_hash"), "terms hash"),
    beaconNetworkHash: TOKENLESS_QUICKNET_T_CHAIN_HASH,
    bountyAmount: bountyAmount.toString(),
    feeAmount: feeAmount.toString(),
    attemptReserve: attemptReserve.toString(),
    attemptCompensation: attemptCompensation.toString(),
    minimumReveals,
    maximumCommits,
    admissionPolicyHash: admissionPolicy.admissionPolicyHash,
    commitDeadline: String(commitDeadline),
    revealDeadline: String(revealDeadline),
    beaconFailureDeadline: String(beaconFailureDeadline),
    beaconRound: String(beaconRound),
    claimGracePeriod: String(config.claimGracePeriodSeconds),
    feeRecipient: config.feeRecipient,
  };
}

async function executionRow(operationKey: string) {
  const result = await dbClient.execute({
    sql: "SELECT * FROM tokenless_chain_executions WHERE operation_key = ? LIMIT 1",
    args: [operationKey],
  });
  return result.rows[0] as QueryRow | undefined;
}

function instructions(row: QueryRow): ChainPaymentInstructions {
  const paymentMode = rowString(row, "payment_mode") as ChainPaymentInstructions["paymentMode"];
  const authorizationNonce = rowString(row, "authorization_nonce");
  const authorizationValidAfter = rowString(row, "authorization_valid_after");
  const authorizationValidBefore = rowString(row, "authorization_valid_before");
  const authorizationSpec =
    paymentMode === "x402" && authorizationNonce && authorizationValidAfter && authorizationValidBefore
      ? {
          schemaVersion: TOKENLESS_PAYMENT_AUTHORIZATION_SCHEMA_VERSION,
          eip3009Domain: {
            name: rowString(row, "authorization_eip712_name") ?? "RateLoop Tokenless Test USDC",
            version: rowString(row, "authorization_eip712_version") ?? "2",
            chainId: Number(row.chain_id),
            verifyingContract: getAddress(rowString(row, "usdc_address")!),
          },
          roundAuthorizationDomain: {
            name: "RateLoop X402 Panel Submitter",
            version: "1",
            chainId: Number(row.chain_id),
            verifyingContract: getAddress(rowString(row, "x402_submitter_address")!),
          },
          validAfter: authorizationValidAfter,
          validBefore: authorizationValidBefore,
          nonce: authorizationNonce as Hex,
        }
      : undefined;
  return {
    operationKey: rowString(row, "operation_key")!,
    paymentMode,
    paymentState: rowString(row, "state")!,
    deploymentKey: rowString(row, "deployment_key")!,
    chainId: Number(row.chain_id),
    panelAddress: getAddress(rowString(row, "panel_address")!),
    x402SubmitterAddress: getAddress(rowString(row, "x402_submitter_address")!),
    usdcAddress: getAddress(rowString(row, "usdc_address")!),
    funderAddress: getAddress(rowString(row, "funder_address")!),
    totalFundedAtomic: rowString(row, "total_funded_atomic")!,
    roundTerms: parseTerms(rowString(row, "round_terms_json")!),
    roundId: rowString(row, "round_id"),
    transactionHash: rowString(row, "submission_transaction_hash") as Hash | null,
    ...(authorizationSpec ? { authorizationSpec } : {}),
  };
}

export async function prepareChainPayment(
  operationKey: string,
  options: { config?: TokenlessChainConfig; now?: Date; runtime?: TokenlessChainRuntime } = {},
) {
  const config = options.config ?? loadTokenlessChainConfig();
  const runtime = options.runtime ?? getTokenlessChainRuntime(config);
  await assertLiveTokenlessDeployment(config, runtime);
  const existing = await executionRow(operationKey);
  if (existing) {
    if (
      rowString(existing, "deployment_key") !== config.deploymentKey ||
      Number(existing.chain_id) !== config.chainId ||
      rowString(existing, "panel_address")?.toLowerCase() !== config.panelAddress.toLowerCase() ||
      rowString(existing, "issuer_address")?.toLowerCase() !== config.issuerAddress.toLowerCase() ||
      rowString(existing, "x402_submitter_address")?.toLowerCase() !== config.x402SubmitterAddress.toLowerCase() ||
      rowString(existing, "usdc_address")?.toLowerCase() !== config.usdcAddress.toLowerCase()
    ) {
      throw new TokenlessServiceError(
        "This operation is pinned to a different tokenless deployment and cannot be migrated implicitly.",
        409,
        "stale_deployment",
      );
    }
    const existingInstructions = instructions(existing);
    const maximumSeatPay =
      BigInt(existingInstructions.roundTerms.bountyAmount) / BigInt(existingInstructions.roundTerms.maximumCommits);
    await reserveSurpriseBountyCapacity({
      operationKey,
      guaranteedBasePerReportAtomic: (maximumSeatPay * 8_000n) / 10_000n,
      maximumReports: existingInstructions.roundTerms.maximumCommits,
      config,
      runtime,
      now: options.now,
    });
    return existingInstructions;
  }
  const source = await operationSource(operationKey);
  const paymentMode = rowString(source, "payment_mode") as ChainPaymentInstructions["paymentMode"];
  const paymentReference = rowString(source, "payment_reference")!;
  let funderAddress: Address;
  if (paymentMode === "prepaid") {
    if (!runtime.prepaidAccount) {
      throw new TokenlessServiceError(
        "TOKENLESS_PREPAID_FUNDER_PRIVATE_KEY is required for prepaid chain execution.",
        503,
        "prepaid_executor_unavailable",
        true,
      );
    }
    funderAddress = runtime.prepaidAccount.address;
  } else {
    funderAddress = getAddress(rowString(source, "payer_address")!);
  }
  const terms = buildRoundTerms(source, config, options.now ?? new Date());
  const totalFundedAtomic = (
    BigInt(terms.bountyAmount) +
    BigInt(terms.feeAmount) +
    BigInt(terms.attemptReserve)
  ).toString();
  const authorizationNow = Math.floor((options.now ?? new Date()).getTime() / 1_000);
  const authorizationValidAfter = (authorizationNow - 30).toString();
  const authorizationValidBefore = (authorizationNow + 10 * 60).toString();
  const authorizationNonce = `0x${randomBytes(32).toString("hex")}` as Hex;
  const executionId = `chx_${randomUUID().replaceAll("-", "")}`;
  const now = new Date();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_chain_executions
          (execution_id, operation_key, payment_mode, payment_reference, deployment_key, chain_id,
           deployment_block, panel_address, issuer_address, x402_submitter_address, usdc_address,
           funder_address, content_id, terms_hash, round_terms_json, total_funded_atomic, state,
           authorization_valid_after, authorization_valid_before, authorization_nonce,
           authorization_eip712_name, authorization_eip712_version, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                  ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (operation_key) DO NOTHING`,
    args: [
      executionId,
      operationKey,
      paymentMode,
      paymentReference,
      config.deploymentKey,
      config.chainId,
      config.deploymentBlock.toString(),
      config.panelAddress.toLowerCase(),
      config.issuerAddress.toLowerCase(),
      config.x402SubmitterAddress.toLowerCase(),
      config.usdcAddress.toLowerCase(),
      funderAddress.toLowerCase(),
      terms.contentId,
      terms.termsHash,
      stableJson(terms),
      totalFundedAtomic,
      paymentMode === "wallet"
        ? "awaiting_wallet"
        : paymentMode === "x402" && rowString(source, "payment_state") === "pending_chain_authorization"
          ? "awaiting_authorization"
          : "prepared",
      paymentMode === "x402" ? authorizationValidAfter : null,
      paymentMode === "x402" ? authorizationValidBefore : null,
      paymentMode === "x402" ? authorizationNonce : null,
      paymentMode === "x402" ? config.usdcEip712Name : null,
      paymentMode === "x402" ? config.usdcEip712Version : null,
      now,
      now,
    ],
  });
  const persisted = await executionRow(operationKey);
  if (!persisted)
    throw new TokenlessServiceError("Chain execution could not be stored.", 500, "chain_persistence_failed");
  const persistedInstructions = instructions(persisted);
  const maximumSeatPay =
    BigInt(persistedInstructions.roundTerms.bountyAmount) / BigInt(persistedInstructions.roundTerms.maximumCommits);
  await reserveSurpriseBountyCapacity({
    operationKey,
    guaranteedBasePerReportAtomic: (maximumSeatPay * 8_000n) / 10_000n,
    maximumReports: persistedInstructions.roundTerms.maximumCommits,
    config,
    runtime,
    now: options.now,
  });
  return persistedInstructions;
}

function exactRoundCreated(input: {
  logs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[];
  expected: ChainPaymentInstructions;
}) {
  const terms = input.expected.roundTerms;
  const maximumSeatPay = BigInt(terms.bountyAmount) / BigInt(terms.maximumCommits);
  const fixedBasePay = (maximumSeatPay * 8_000n) / 10_000n;
  const maximumBonus = maximumSeatPay - fixedBasePay;
  const matches: { roundId: bigint }[] = [];
  for (const log of input.logs) {
    if (log.address.toLowerCase() !== input.expected.panelAddress.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: TokenlessPanelAbi,
        data: log.data,
        topics: [...log.topics] as [] | [Hex, ...Hex[]],
        strict: true,
      });
      if (decoded.eventName !== "RoundCreated") continue;
      const args = decoded.args;
      if (
        getAddress(args.funder) === getAddress(input.expected.funderAddress) &&
        args.contentId.toLowerCase() === terms.contentId.toLowerCase() &&
        args.termsHash.toLowerCase() === terms.termsHash.toLowerCase() &&
        args.admissionPolicyHash.toLowerCase() === terms.admissionPolicyHash.toLowerCase() &&
        args.bountyAmount === BigInt(terms.bountyAmount) &&
        args.feeAmount === BigInt(terms.feeAmount) &&
        args.attemptReserve === BigInt(terms.attemptReserve) &&
        args.fixedBasePay === fixedBasePay &&
        args.maximumBonus === maximumBonus &&
        args.scoringVersion === 2
      ) {
        matches.push({ roundId: args.roundId });
      }
    } catch {
      // Ignore unrelated logs; only an exact TokenlessPanel RoundCreated event is accepted.
    }
  }
  if (matches.length !== 1) {
    throw new TokenlessServiceError(
      "The transaction did not emit exactly one RoundCreated event matching the quoted terms.",
      409,
      "payment_receipt_mismatch",
    );
  }
  return matches[0];
}

async function assertCompleteRoundMatches(input: {
  expected: ChainPaymentInstructions;
  roundId: bigint;
  runtime: TokenlessChainRuntime;
}) {
  const round = await input.runtime.publicClient.readContract({
    abi: TokenlessPanelAbi,
    address: input.expected.panelAddress,
    functionName: "getRound",
    args: [input.roundId],
  });
  const terms = toOnchainTerms(input.expected.roundTerms);
  const maximumSeatPay = terms.bountyAmount / BigInt(terms.maximumCommits);
  const fixedBasePay = (maximumSeatPay * 8_000n) / 10_000n;
  const maximumBonus = maximumSeatPay - fixedBasePay;
  if (
    getAddress(round.funder) !== getAddress(input.expected.funderAddress) ||
    round.contentId.toLowerCase() !== terms.contentId.toLowerCase() ||
    round.termsHash.toLowerCase() !== terms.termsHash.toLowerCase() ||
    round.beaconNetworkHash.toLowerCase() !== terms.beaconNetworkHash.toLowerCase() ||
    getAddress(round.feeRecipient) !== getAddress(terms.feeRecipient) ||
    round.bountyAmount !== terms.bountyAmount ||
    round.feeAmount !== terms.feeAmount ||
    round.attemptReserve !== terms.attemptReserve ||
    round.attemptCompensation !== terms.attemptCompensation ||
    round.fixedBasePay !== fixedBasePay ||
    round.maximumBonus !== maximumBonus ||
    round.commitDeadline !== terms.commitDeadline ||
    round.revealDeadline !== terms.revealDeadline ||
    round.beaconFailureDeadline !== terms.beaconFailureDeadline ||
    round.beaconRound !== terms.beaconRound ||
    round.claimGracePeriod !== terms.claimGracePeriod ||
    round.minimumReveals !== terms.minimumReveals ||
    round.maximumCommits !== terms.maximumCommits ||
    round.admissionPolicyHash.toLowerCase() !== terms.admissionPolicyHash.toLowerCase()
  ) {
    throw new TokenlessServiceError(
      "The created on-chain round does not match the complete quoted terms.",
      409,
      "round_terms_mismatch",
    );
  }
}

async function persistConfirmation(input: {
  expected: ChainPaymentInstructions;
  transactionHash: Hash;
  roundId: bigint;
  blockNumber: bigint;
  blockHash: Hash;
  fencingToken?: number;
}) {
  const client = await dbPool.connect();
  const now = new Date();
  try {
    await client.query("BEGIN");
    const locked = await client.query(
      "SELECT state, round_id, submission_transaction_hash, payment_reference, claim_fencing_token FROM tokenless_chain_executions WHERE operation_key = $1 FOR UPDATE",
      [input.expected.operationKey],
    );
    const row = locked.rows[0] as QueryRow | undefined;
    if (!row) throw new TokenlessServiceError("Chain execution not found.", 404, "chain_execution_not_found");
    // Server-funded confirmations carry the claim generation; refuse to persist
    // if a newer claim has superseded this worker so a stale/resumed worker can
    // never overwrite the winning claim's receipt binding. Wallet confirmations
    // are user-broadcast and rely on the round_id conflict guard below instead.
    if (input.fencingToken !== undefined && Number(row.claim_fencing_token ?? 0) !== input.fencingToken) {
      throw new TokenlessServiceError(
        "The chain execution claim was superseded before confirmation.",
        409,
        "execution_claim_superseded",
        true,
      );
    }
    const existingRound = rowString(row, "round_id");
    const existingHash = rowString(row, "submission_transaction_hash");
    if (
      existingRound &&
      (existingRound !== input.roundId.toString() ||
        existingHash?.toLowerCase() !== input.transactionHash.toLowerCase())
    ) {
      throw new TokenlessServiceError(
        "The operation is already bound to another round.",
        409,
        "round_reconciliation_conflict",
      );
    }
    await client.query(
      `UPDATE tokenless_chain_executions
       SET state = 'confirmed', submission_transaction_hash = $1, round_id = $2,
           receipt_block_number = $3, receipt_block_hash = $4, failure_code = NULL,
           claim_owner = NULL, claim_expires_at = NULL,
           confirmed_at = $5, updated_at = $5
       WHERE operation_key = $6`,
      [
        input.transactionHash,
        input.roundId.toString(),
        input.blockNumber.toString(),
        input.blockHash,
        now,
        input.expected.operationKey,
      ],
    );
    await client.query(
      "UPDATE tokenless_agent_asks SET status = 'open', round_id = $1, updated_at = $2 WHERE operation_key = $3",
      [input.roundId.toString(), now, input.expected.operationKey],
    );
    await client.query(
      "UPDATE tokenless_ask_ownership SET payment_state = 'confirmed', updated_at = $1 WHERE operation_key = $2",
      [now, input.expected.operationKey],
    );
    if (input.expected.paymentMode === "prepaid") {
      await client.query(
        "UPDATE tokenless_prepaid_reservations SET status = 'consumed', updated_at = $1 WHERE reservation_id = $2",
        [now, rowString(row, "payment_reference")],
      );
      await client.query(
        `INSERT INTO tokenless_prepaid_ledger_entries
         (entry_id, workspace_id, delta_atomic, settlement_status, source, external_reference, created_at, settled_at)
         SELECT $1, workspace_id, $2::numeric, 'settled', 'chain_round', $3, $4::timestamptz, $4::timestamptz
         FROM tokenless_prepaid_reservations WHERE reservation_id = $5
         ON CONFLICT (external_reference) DO NOTHING`,
        [
          `led_${randomUUID().replaceAll("-", "")}`,
          `-${input.expected.totalFundedAtomic}`,
          `round:${input.expected.deploymentKey}:${input.roundId}`,
          now,
          rowString(row, "payment_reference"),
        ],
      );
    } else {
      await client.query(
        "UPDATE tokenless_payment_intents SET state = 'confirmed', updated_at = $1 WHERE payment_intent_id = (SELECT payment_reference FROM tokenless_chain_executions WHERE operation_key = $2)",
        [now, input.expected.operationKey],
      );
    }
    const admissionSource = await client.query(
      `SELECT q.terms_json FROM tokenless_ask_ownership o
       JOIN tokenless_question_records q ON q.question_id = o.question_id
       WHERE o.operation_key = $1 LIMIT 1`,
      [input.expected.operationKey],
    );
    const productTerms = JSON.parse(String(admissionSource.rows[0]?.terms_json ?? "null")) as {
      audiencePolicy?: unknown;
    } | null;
    if (!productTerms?.audiencePolicy) {
      throw new TokenlessServiceError(
        "The confirmed round has no frozen admission policy.",
        409,
        "capability_policy_required",
      );
    }
    const frozenPolicy = freezeAdmissionPolicy(productTerms.audiencePolicy);
    if (
      frozenPolicy.admissionPolicyHash.toLowerCase() !== input.expected.roundTerms.admissionPolicyHash.toLowerCase()
    ) {
      throw new TokenlessServiceError(
        "The confirmed round admission policy does not match its immutable terms.",
        409,
        "admission_policy_mismatch",
      );
    }
    await client.query(
      `INSERT INTO tokenless_voucher_rounds
       (chain_id, panel_address, round_id, content_id, admission_policy_hash,
        admission_policy_json, maximum_commits, voucher_not_before, voucher_deadline,
        status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'open', $8, $8)
       ON CONFLICT (chain_id, panel_address, round_id) DO NOTHING`,
      [
        input.expected.chainId,
        input.expected.panelAddress.toLowerCase(),
        input.roundId.toString(),
        input.expected.roundTerms.contentId,
        input.expected.roundTerms.admissionPolicyHash,
        frozenPolicy.policyJson,
        input.expected.roundTerms.maximumCommits,
        now,
        new Date(Number(input.expected.roundTerms.commitDeadline) * 1_000),
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function confirmWalletChainPayment(
  operationKey: string,
  transactionHash: string,
  options: { config?: TokenlessChainConfig; runtime?: TokenlessChainRuntime } = {},
) {
  if (!isHash(transactionHash)) {
    throw new TokenlessServiceError(
      "transactionHash must be a 32-byte transaction hash.",
      400,
      "invalid_transaction_hash",
    );
  }
  const config = options.config ?? loadTokenlessChainConfig();
  const runtime = options.runtime ?? getTokenlessChainRuntime(config);
  const expected = await prepareChainPayment(operationKey, { config, runtime });
  if (expected.paymentMode !== "wallet") {
    throw new TokenlessServiceError("Only wallet payment intents can be confirmed here.", 409, "payment_mode_mismatch");
  }
  const receipt = await runtime.publicClient.getTransactionReceipt({ hash: transactionHash });
  if (receipt.status !== "success" || receipt.blockNumber < config.deploymentBlock) {
    throw new TokenlessServiceError(
      "The payment transaction was not successful on the configured deployment.",
      409,
      "payment_failed",
    );
  }
  const match = exactRoundCreated({ logs: receipt.logs, expected });
  await assertCompleteRoundMatches({ expected, roundId: match.roundId, runtime });
  await persistConfirmation({
    expected,
    transactionHash,
    roundId: match.roundId,
    blockNumber: receipt.blockNumber,
    blockHash: receipt.blockHash,
  });
  return { ...(await getChainPaymentInstructions(operationKey)), paymentState: "confirmed" };
}

async function allocateNonce(input: {
  executionId: string;
  column: "approval_nonce" | "submission_nonce";
  config: TokenlessChainConfig;
  signer: Address;
  runtime: TokenlessChainRuntime;
  fencingToken: number;
}) {
  const existing = await dbClient.execute({
    sql: `SELECT ${input.column} FROM tokenless_chain_executions WHERE execution_id = ? LIMIT 1`,
    args: [input.executionId],
  });
  const persisted = rowString(existing.rows[0] as QueryRow | undefined, input.column);
  if (persisted) return Number(persisted);
  const networkNonce = await input.runtime.publicClient.getTransactionCount({
    address: input.signer,
    blockTag: "pending",
  });
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO tokenless_chain_signer_nonces (deployment_key, signer_address, next_nonce, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (deployment_key, signer_address) DO NOTHING`,
      [input.config.deploymentKey, input.signer.toLowerCase(), networkNonce, new Date()],
    );
    const nonceRow = await client.query(
      "SELECT next_nonce FROM tokenless_chain_signer_nonces WHERE deployment_key = $1 AND signer_address = $2 FOR UPDATE",
      [input.config.deploymentKey, input.signer.toLowerCase()],
    );
    const storedNext = Number(nonceRow.rows[0].next_nonce);
    const nonce = Math.max(networkNonce, storedNext);
    await client.query(
      `UPDATE tokenless_chain_signer_nonces SET next_nonce = $1, updated_at = $2
       WHERE deployment_key = $3 AND signer_address = $4`,
      [nonce + 1, new Date(), input.config.deploymentKey, input.signer.toLowerCase()],
    );
    // Fence the per-execution nonce write by the active claim generation. If a
    // newer claim has superseded this worker the update matches zero rows and we
    // roll back, releasing the shared signer nonce we just reserved so a stale
    // worker can never burn a nonce or broadcast against a superseded claim.
    const fenced = await client.query(
      `UPDATE tokenless_chain_executions SET ${input.column} = $1, updated_at = $2
       WHERE execution_id = $3 AND claim_fencing_token = $4`,
      [nonce, new Date(), input.executionId, input.fencingToken],
    );
    if (fenced.rowCount !== 1) {
      throw new TokenlessServiceError(
        "The chain execution claim was superseded before the nonce could be fenced.",
        409,
        "execution_claim_superseded",
        true,
      );
    }
    await client.query("COMMIT");
    return nonce;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function storeTransactionHash(
  executionId: string,
  column: "approval_transaction_hash" | "submission_transaction_hash",
  hash: Hash,
  fencingToken: number,
) {
  const result = await dbClient.execute({
    sql: `UPDATE tokenless_chain_executions SET ${column} = ?, state = 'broadcast', updated_at = ?
          WHERE execution_id = ? AND claim_fencing_token = ?`,
    args: [hash, new Date(), executionId, fencingToken],
  });
  if (result.rowCount !== 1) {
    throw new TokenlessServiceError(
      "The chain execution claim was superseded before the transaction hash could be fenced.",
      409,
      "execution_claim_superseded",
      true,
    );
  }
}

type ChainExecutionClaim = { fencingToken: number; owner: string; token: string };

// Atomically acquire the exclusive execution claim before any chain work. Uses a
// compare-and-swap on the monotonic fencing token under a row lock: exactly one
// concurrent caller can advance the generation, so a second request observing the
// same pre-broadcast state cannot also broadcast. An expired lease (crashed
// worker) may be re-claimed, which is safe because persisted hashes/nonces are
// reused on resume and every write is fenced by the claim generation.
async function claimChainExecution(
  operationKey: string,
  now: Date,
): Promise<{ status: "claimed"; claim: ChainExecutionClaim } | { status: "confirmed" } | { status: "in_progress" }> {
  const owner = `chx-worker-${randomUUID()}`;
  const token = `chl_${randomBytes(16).toString("hex")}`;
  const expiresAt = new Date(now.getTime() + CLAIM_LEASE_MS);
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query(
      `SELECT state, claim_owner, claim_expires_at, claim_fencing_token
       FROM tokenless_chain_executions WHERE operation_key = $1 FOR UPDATE`,
      [operationKey],
    );
    const row = locked.rows[0] as QueryRow | undefined;
    if (!row) {
      await client.query("ROLLBACK");
      throw new TokenlessServiceError("Chain execution not found.", 404, "chain_execution_not_found");
    }
    if (rowString(row, "state") === "confirmed") {
      await client.query("COMMIT");
      return { status: "confirmed" };
    }
    const leaseExpiry = row.claim_expires_at ? new Date(String(row.claim_expires_at)) : null;
    const leaseHeld = rowString(row, "claim_owner") !== null && leaseExpiry !== null && leaseExpiry > now;
    if (leaseHeld) {
      await client.query("COMMIT");
      return { status: "in_progress" };
    }
    const previousFence = Number(row.claim_fencing_token ?? 0);
    if (previousFence >= MAX_FENCING_TOKEN) {
      await client.query("ROLLBACK");
      throw new TokenlessServiceError(
        "The chain execution claim generation is exhausted.",
        409,
        "execution_claim_exhausted",
      );
    }
    const fencingToken = previousFence + 1;
    const claimed = await client.query(
      `UPDATE tokenless_chain_executions
       SET claim_owner = $2, claim_token = $3, claim_expires_at = $4, claim_fencing_token = $5, updated_at = $6
       WHERE operation_key = $1 AND claim_fencing_token = $7`,
      [operationKey, owner, token, expiresAt, fencingToken, now, previousFence],
    );
    if (claimed.rowCount !== 1) {
      await client.query("ROLLBACK");
      return { status: "in_progress" };
    }
    await client.query("COMMIT");
    return { status: "claimed", claim: { fencingToken, owner, token } };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function executeServerChainPayment(
  operationKey: string,
  options: { config?: TokenlessChainConfig; runtime?: TokenlessChainRuntime } = {},
) {
  const config = options.config ?? loadTokenlessChainConfig();
  const runtime = options.runtime ?? getTokenlessChainRuntime(config);
  const expected = await prepareChainPayment(operationKey, { config, runtime });
  if (expected.paymentMode === "wallet") return expected;

  // Take the exclusive claim before reading any nonce or broadcasting. A second
  // concurrent request cannot claim and must not broadcast: it either observes
  // the already-confirmed result or is told the execution is in flight and should
  // retry. This is the primary defense against double-funding one reservation.
  const claimOutcome = await claimChainExecution(operationKey, new Date());
  if (claimOutcome.status === "confirmed") {
    return { ...(await getChainPaymentInstructions(operationKey)), paymentState: "confirmed" };
  }
  if (claimOutcome.status === "in_progress") {
    throw new TokenlessServiceError(
      "This payment is already being executed on-chain. Retry shortly.",
      409,
      "execution_in_progress",
      true,
    );
  }
  const { fencingToken } = claimOutcome.claim;

  // Re-read under the fresh claim so a resumed worker reuses any persisted
  // approval/submission hash instead of broadcasting a duplicate transaction.
  const row = await executionRow(operationKey);
  const executionId = rowString(row, "execution_id")!;
  const terms = toOnchainTerms(expected.roundTerms);
  let submissionHash = rowString(row, "submission_transaction_hash") as Hash | null;

  if (expected.paymentMode === "prepaid") {
    if (!runtime.prepaidAccount || !runtime.prepaidWallet) {
      throw new TokenlessServiceError("Prepaid executor is unavailable.", 503, "prepaid_executor_unavailable", true);
    }
    const balance = await runtime.publicClient.readContract({
      abi: ERC20_BALANCE_ABI,
      address: config.usdcAddress,
      functionName: "balanceOf",
      args: [runtime.prepaidAccount.address],
    });
    if (balance < BigInt(expected.totalFundedAtomic)) {
      throw new TokenlessServiceError(
        "The isolated prepaid funder lacks settled USDC.",
        503,
        "prepaid_liquidity_unavailable",
        true,
      );
    }
    let approvalHash = rowString(row, "approval_transaction_hash") as Hash | null;
    if (!approvalHash) {
      const nonce = await allocateNonce({
        executionId,
        column: "approval_nonce",
        config,
        signer: runtime.prepaidAccount.address,
        runtime,
        fencingToken,
      });
      approvalHash = await runtime.prepaidWallet.sendTransaction({
        account: runtime.prepaidAccount,
        chain: baseSepolia,
        to: config.usdcAddress,
        data: encodeFunctionData({
          abi: APPROVE_ABI,
          functionName: "approve",
          args: [config.panelAddress, BigInt(expected.totalFundedAtomic)],
        }),
        nonce,
        value: 0n,
      });
      await storeTransactionHash(executionId, "approval_transaction_hash", approvalHash, fencingToken);
    }
    const approvalReceipt = await runtime.publicClient.waitForTransactionReceipt({ hash: approvalHash });
    if (approvalReceipt.status !== "success") {
      throw new TokenlessServiceError("The prepaid USDC approval failed.", 502, "prepaid_approval_failed", true);
    }
    if (!submissionHash) {
      await runtime.publicClient.simulateContract({
        account: runtime.prepaidAccount,
        abi: TokenlessPanelAbi,
        address: config.panelAddress,
        functionName: "createRound",
        args: [terms],
      });
      const nonce = await allocateNonce({
        executionId,
        column: "submission_nonce",
        config,
        signer: runtime.prepaidAccount.address,
        runtime,
        fencingToken,
      });
      submissionHash = await runtime.prepaidWallet.sendTransaction({
        account: runtime.prepaidAccount,
        chain: baseSepolia,
        to: config.panelAddress,
        data: encodeFunctionData({ abi: TokenlessPanelAbi, functionName: "createRound", args: [terms] }),
        nonce,
        value: 0n,
      });
      await storeTransactionHash(executionId, "submission_transaction_hash", submissionHash, fencingToken);
    }
  } else {
    if (!runtime.relayerAccount || !runtime.relayerWallet) {
      throw new TokenlessServiceError(
        "The x402 gas-only relayer is unavailable.",
        503,
        "x402_relayer_unavailable",
        true,
      );
    }
    if (!submissionHash) {
      const source = await operationSource(operationKey);
      const payload = JSON.parse(rowString(source, "payload_json") ?? "null") as {
        authorization?: Record<string, unknown>;
      } | null;
      const authorization = payload?.authorization;
      if (!authorization) throw new TokenlessServiceError("x402 authorization is missing.", 409, "invalid_payment");
      const roundAuthorizationSignature = String(authorization.roundAuthorizationSignature ?? "") as Hex;
      const adapterAuthorization = {
        validAfter: BigInt(String(authorization.validAfter)),
        validBefore: BigInt(String(authorization.validBefore)),
        nonce: String(authorization.nonce) as Hex,
        v: Number(authorization.v),
        r: String(authorization.r) as Hex,
        s: String(authorization.s) as Hex,
      };
      await runtime.publicClient.simulateContract({
        account: runtime.relayerAccount,
        abi: X402PanelSubmitterAbi,
        address: config.x402SubmitterAddress,
        functionName: "createRoundWithAuthorization",
        args: [expected.funderAddress, terms, adapterAuthorization, roundAuthorizationSignature],
      });
      const nonce = await allocateNonce({
        executionId,
        column: "submission_nonce",
        config,
        signer: runtime.relayerAccount.address,
        runtime,
        fencingToken,
      });
      submissionHash = await runtime.relayerWallet.sendTransaction({
        account: runtime.relayerAccount,
        chain: baseSepolia,
        to: config.x402SubmitterAddress,
        data: encodeFunctionData({
          abi: X402PanelSubmitterAbi,
          functionName: "createRoundWithAuthorization",
          args: [expected.funderAddress, terms, adapterAuthorization, roundAuthorizationSignature],
        }),
        nonce,
        value: 0n,
      });
      await storeTransactionHash(executionId, "submission_transaction_hash", submissionHash, fencingToken);
    }
  }

  const receipt = await runtime.publicClient.waitForTransactionReceipt({ hash: submissionHash });
  if (receipt.status !== "success" || receipt.blockNumber < config.deploymentBlock) {
    throw new TokenlessServiceError("Round submission failed on-chain.", 502, "round_submission_failed", true);
  }
  const match = exactRoundCreated({ logs: receipt.logs, expected });
  await assertCompleteRoundMatches({ expected, roundId: match.roundId, runtime });
  await persistConfirmation({
    expected,
    transactionHash: submissionHash,
    roundId: match.roundId,
    blockNumber: receipt.blockNumber,
    blockHash: receipt.blockHash,
    fencingToken,
  });
  return { ...(await getChainPaymentInstructions(operationKey)), paymentState: "confirmed" };
}

export async function getChainPaymentInstructions(operationKey: string) {
  const row = await executionRow(operationKey);
  if (!row) throw new TokenlessServiceError("Chain payment is not prepared.", 404, "chain_execution_not_found");
  return instructions(row);
}

export async function attachX402Authorization(operationKey: string, value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TokenlessServiceError("authorization must be an object.", 400, "invalid_payment");
  }
  const normalized = normalizedX402Authorization(value as Record<string, unknown>);
  const result = await dbClient.execute({
    sql: `SELECT e.payment_mode, e.payment_reference, p.payload_json
          FROM tokenless_chain_executions e
          JOIN tokenless_payment_intents p ON p.payment_intent_id = e.payment_reference
          WHERE e.operation_key = ? LIMIT 1`,
    args: [operationKey],
  });
  const row = result.rows[0] as QueryRow | undefined;
  if (!row || rowString(row, "payment_mode") !== "x402") {
    throw new TokenlessServiceError("The operation is not an x402 payment.", 409, "payment_mode_mismatch");
  }
  const payload = JSON.parse(rowString(row, "payload_json") ?? "null") as Record<string, unknown> | null;
  if (!payload) throw new TokenlessServiceError("x402 payment intent is missing.", 409, "invalid_payment");
  if (payload.authorization && stableJson(payload.authorization) !== stableJson(normalized)) {
    throw new TokenlessServiceError(
      "The x402 authorization conflicts with the one already attached.",
      409,
      "payment_conflict",
    );
  }
  const payloadJson = stableJson({ ...payload, authorization: normalized });
  await dbClient.execute({
    sql: `UPDATE tokenless_payment_intents
          SET payload_json = ?, state = 'pending_chain_execution', updated_at = ?
          WHERE payment_intent_id = ?`,
    args: [payloadJson, new Date(), rowString(row, "payment_reference")],
  });
  await dbClient.execute({
    sql: "UPDATE tokenless_ask_ownership SET payment_state = 'pending_chain_execution', updated_at = ? WHERE operation_key = ?",
    args: [new Date(), operationKey],
  });
  await dbClient.execute({
    sql: "UPDATE tokenless_chain_executions SET state = 'prepared', updated_at = ? WHERE operation_key = ?",
    args: [new Date(), operationKey],
  });
}

export async function reconcileChainPayment(
  operationKey: string,
  options: { config?: TokenlessChainConfig; runtime?: TokenlessChainRuntime } = {},
) {
  const existing = await executionRow(operationKey);
  if (!existing) return null;
  const current = await prepareChainPayment(operationKey, options);
  if (current.paymentState === "confirmed") return current;
  if (current.paymentMode === "x402" && current.paymentState === "awaiting_authorization") return current;
  if (current.paymentMode !== "wallet") return executeServerChainPayment(operationKey, options);
  return current;
}

export const __chainPaymentTestUtils = {
  assertCompleteRoundMatches,
  buildRoundTerms,
  exactRoundCreated,
  toOnchainTerms,
};

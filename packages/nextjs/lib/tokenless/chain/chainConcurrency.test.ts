import { type TokenlessChainConfig, buildTokenlessDeploymentKey } from "./config";
import { __chainPaymentTestUtils, executeServerChainPayment, prepareChainPayment } from "./payments";
import { type TokenlessChainRuntime } from "./runtime";
import { TokenlessPanelAbi } from "@rateloop/contracts/tokenless";
import { HUMAN_ASSURANCE_SCHEMA_VERSION } from "@rateloop/sdk";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import {
  type Address,
  type Hash,
  type Hex,
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  keccak256,
  parseTransaction,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { freezeAdmissionPolicy } from "~~/lib/tokenless/admissionPolicy";
import { attachProductAsk, createWorkspace, prepareProductAsk } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError, createTokenlessAsk, createTokenlessQuote } from "~~/lib/tokenless/server";

const PANEL = getAddress("0x1111111111111111111111111111111111111111");
const ISSUER = getAddress("0x2222222222222222222222222222222222222222");
const ADAPTER = getAddress("0x3333333333333333333333333333333333333333");
const USDC = getAddress("0x4444444444444444444444444444444444444444");
const FEEDBACK_BONUS = getAddress("0x7777777777777777777777777777777777777777");
const FUNDER = getAddress("0x5555555555555555555555555555555555555555");
const FEE_RECIPIENT = getAddress("0x6666666666666666666666666666666666666666");
const SURPRISE_BONUS_ACCOUNT = privateKeyToAccount(`0x${"77".repeat(32)}`);
const PREPAID_ACCOUNT = privateKeyToAccount(`0x${"88".repeat(32)}`);

type Prepared = Awaited<ReturnType<typeof prepareChainPayment>>;
type Broadcast = { to: Address; kind: "approval" | "createRound" };

function config(): TokenlessChainConfig {
  return {
    chainId: 84_532,
    claimGracePeriodSeconds: 604_800,
    deploymentBlock: 100n,
    deploymentKey: buildTokenlessDeploymentKey({
      chainId: 84_532,
      panelAddress: PANEL,
      issuerAddress: ISSUER,
      x402SubmitterAddress: ADAPTER,
      feedbackBonusAddress: FEEDBACK_BONUS,
    }),
    feeRecipient: FEE_RECIPIENT,
    feedbackBonusAddress: FEEDBACK_BONUS,
    issuerAddress: ISSUER,
    panelAddress: PANEL,
    revealWindowSeconds: 120,
    beaconFailureGraceSeconds: 21_600,
    rpcFallbackUrls: ["https://base-sepolia-fallback.example/"],
    rpcUrl: "https://sepolia.base.org/",
    schemaVersion: "rateloop-tokenless-deployment-v4",
    usdcAddress: USDC,
    usdcEip712Name: "RateLoop Tokenless Test USDC",
    usdcEip712Version: "2",
    x402SubmitterAddress: ADAPTER,
  };
}

function admissionPolicy() {
  return {
    schemaVersion: HUMAN_ASSURANCE_SCHEMA_VERSION,
    policyId: "policy_chain_prepaid_network",
    version: 1,
    reviewerSource: "rateloop_network" as const,
    integrity: {
      schemaVersion: "rateloop.integrity-assignment.v1" as const,
      epochId: "integrity:2026-07-13:001",
      epochManifestHash: `sha256:${"a".repeat(64)}` as const,
      maxClusterShareBps: 2_000,
      allowedRiskBands: ["low", "medium"] as const,
      recentCoassignmentWindowSeconds: 2_592_000,
      maxRecentCoassignments: 1,
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

async function prepaidAsk() {
  const { workspaceId } = await createWorkspace({ name: "Prepaid team", ownerAddress: FUNDER });
  const now = new Date();
  await dbClient.execute({
    sql: `UPDATE tokenless_workspace_subscriptions
          SET plan_key = 'early_access', price_version = 'early_access_usd_99_2026_07',
              provider_status = 'active', current_period_start = ?, current_period_end = ?, updated_at = ?
          WHERE workspace_id = ?`,
    args: [new Date(now.getTime() - 60_000), new Date(now.getTime() + 86_400_000), now, workspaceId],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_prepaid_ledger_entries
          (entry_id, workspace_id, delta_atomic, settlement_status, source, external_reference, created_at, settled_at)
          VALUES (?, ?, ?, 'settled', 'manual_topup', ?, ?, ?)`,
    args: [`led_${randomUUID().replaceAll("-", "")}`, workspaceId, "1000000000", `topup:${workspaceId}`, now, now],
  });
  const quote = await createTokenlessQuote({
    audience: {
      admissionPolicyHash: freezeAdmissionPolicy(admissionPolicy()).admissionPolicyHash,
      source: "rateloop_network",
    },
    audiencePolicy: admissionPolicy(),
    confirmedNoSensitiveData: true,
    dataClassification: "synthetic",
    budget: { attemptReserveAtomic: "20000000", bountyAtomic: "25000000", feeBps: 750 },
    question: { kind: "binary" as const, prompt: "Ship this?", rationale: { mode: "optional" as const } },
    requestedPanelSize: 15,
    responseWindowSeconds: 7_200,
    visibility: "public",
  });
  const request = {
    idempotencyKey: "chain:prepaid:12345678",
    payment: { mode: "prepaid" as const, workspaceId },
    quoteId: quote.quoteId,
  };
  const prepared = await prepareProductAsk({
    principal: { kind: "session", accountAddress: FUNDER, walletAddress: FUNDER },
    request,
  });
  const ask = await createTokenlessAsk(request, request.idempotencyKey, "https://tokenless.example");
  await attachProductAsk(prepared, ask);
  await dbClient.execute("UPDATE tokenless_content_records SET moderation_status = 'approved'");
  await dbClient.execute("UPDATE tokenless_question_records SET moderation_status = 'approved'");
  return { operationKey: ask.operationKey, workspaceId };
}

function roundCreatedLog(expected: Prepared, roundId: bigint) {
  const topics = encodeEventTopics({
    abi: TokenlessPanelAbi,
    eventName: "RoundCreated",
    args: { roundId, funder: expected.funderAddress, contentId: expected.roundTerms.contentId },
  });
  const seatPay = BigInt(expected.roundTerms.bountyAmount) / BigInt(expected.roundTerms.maximumCommits);
  const data = encodeAbiParameters(
    [
      { name: "termsHash", type: "bytes32" },
      { name: "admissionPolicyHash", type: "bytes32" },
      { name: "bountyAmount", type: "uint256" },
      { name: "feeAmount", type: "uint256" },
      { name: "attemptReserve", type: "uint256" },
      { name: "fixedBasePay", type: "uint256" },
      { name: "maximumBonus", type: "uint256" },
      { name: "scoringVersion", type: "uint8" },
    ],
    [
      expected.roundTerms.termsHash,
      expected.roundTerms.admissionPolicyHash,
      BigInt(expected.roundTerms.bountyAmount),
      BigInt(expected.roundTerms.feeAmount),
      BigInt(expected.roundTerms.attemptReserve),
      (seatPay * 8_000n) / 10_000n,
      seatPay - (seatPay * 8_000n) / 10_000n,
      2,
    ],
  );
  return { address: PANEL, data, topics: topics.filter((topic): topic is Hex => topic !== null) };
}

// A prepaid runtime that records every broadcast and lets a test hook pause or
// fail inside sendRawTransaction / waitForTransactionReceipt to drive an exact
// concurrency or crash schedule. A single round id is minted for the one and
// only createRound so both broadcasts (if the bug regressed) would collide.
function prepaidRuntime(input: {
  expected: () => Prepared;
  broadcasts: Broadcast[];
  serializedBroadcasts?: Hex[];
  onAcceptedBroadcast?: (kind: Broadcast["kind"], hash: Hash) => Promise<void>;
  onBroadcast?: (kind: Broadcast["kind"]) => Promise<void>;
  onSubmissionReceipt?: () => Promise<void>;
  onTransactionLookup?: (hash: Hash) => Promise<void>;
}): TokenlessChainRuntime {
  let nonce = 0;
  const acceptedHashes = new Set<Hash>();
  const hashRounds = new Map<Hash, bigint>();
  const publicClient = {
    getChainId: async () => 84_532,
    getBlockNumber: async () => 500n,
    getBytecode: async () => "0x6000" as Hex,
    getTransactionCount: async () => nonce++,
    getTransaction: async ({ hash }: { hash: Hash }) => {
      if (input.onTransactionLookup) await input.onTransactionLookup(hash);
      if (!acceptedHashes.has(hash)) throw new Error("transaction_not_found");
      return { hash };
    },
    simulateContract: async () => ({ request: {} }),
    readContract: async ({ address, functionName }: { address: Address; functionName: string }) => {
      if (address === PANEL && functionName === "usdc") return USDC;
      if (address === PANEL && functionName === "credentialIssuer") return ISSUER;
      if (address === PANEL && functionName === "SCORING_VERSION") return 2;
      if (address === PANEL && functionName === "BASE_PAY_BPS") return 8_000;
      if (address === PANEL && functionName === "MAXIMUM_COMMITS") return 500;
      if (address === ADAPTER && functionName === "panel") return PANEL;
      if (address === ADAPTER && (functionName === "usdc" || functionName === "authorizationToken")) return USDC;
      if (address === FEEDBACK_BONUS && functionName === "usdc") return USDC;
      if (address === FEEDBACK_BONUS && functionName === "credentialIssuer") return ISSUER;
      if (address === USDC && functionName === "balanceOf") return 1_000_000_000n;
      if (address === PANEL && functionName === "getRound") {
        const expected = input.expected();
        const terms = __chainPaymentTestUtils.toOnchainTerms(expected.roundTerms);
        const seatPay = terms.bountyAmount / BigInt(terms.maximumCommits);
        return {
          funder: expected.funderAddress,
          contentId: terms.contentId,
          termsHash: terms.termsHash,
          beaconNetworkHash: terms.beaconNetworkHash,
          feeRecipient: terms.feeRecipient,
          bountyAmount: terms.bountyAmount,
          feeAmount: terms.feeAmount,
          attemptReserve: terms.attemptReserve,
          attemptCompensation: terms.attemptCompensation,
          fixedBasePay: (seatPay * 8_000n) / 10_000n,
          maximumBonus: seatPay - (seatPay * 8_000n) / 10_000n,
          commitDeadline: terms.commitDeadline,
          revealDeadline: terms.revealDeadline,
          beaconFailureDeadline: terms.beaconFailureDeadline,
          beaconRound: terms.beaconRound,
          claimGracePeriod: terms.claimGracePeriod,
          minimumReveals: terms.minimumReveals,
          maximumCommits: terms.maximumCommits,
          admissionPolicyHash: terms.admissionPolicyHash,
        };
      }
      throw new Error(`Unexpected read ${address}:${functionName}`);
    },
    waitForTransactionReceipt: async ({ hash }: { hash: Hash }) => {
      const roundId = hashRounds.get(hash);
      if (roundId !== undefined && input.onSubmissionReceipt) await input.onSubmissionReceipt();
      const logs = roundId !== undefined ? [roundCreatedLog(input.expected(), roundId)] : [];
      return { blockHash: `0x${"bb".repeat(32)}` as Hash, blockNumber: 200n, logs, status: "success" as const };
    },
  };
  const sendRaw = async ({ serializedTransaction }: { serializedTransaction: Hex }) => {
    const transaction = parseTransaction(serializedTransaction);
    const to = getAddress(transaction.to!);
    const kind: Broadcast["kind"] = to === PANEL ? "createRound" : "approval";
    input.broadcasts.push({ to, kind });
    input.serializedBroadcasts?.push(serializedTransaction);
    if (input.onBroadcast) await input.onBroadcast(kind);
    const hash = keccak256(serializedTransaction);
    acceptedHashes.add(hash);
    if (kind === "createRound") hashRounds.set(hash, 7n);
    if (input.onAcceptedBroadcast) await input.onAcceptedBroadcast(kind, hash);
    return hash;
  };
  const wallet = {
    prepareTransactionRequest: async (transaction: Record<string, unknown>) => {
      const request = Object.fromEntries(
        Object.entries(transaction).filter(([key]) => key !== "account" && key !== "chain" && key !== "from"),
      );
      return {
        ...request,
        chainId: 84_532,
        gas: 1_000_000n,
        maxFeePerGas: 2n,
        maxPriorityFeePerGas: 1n,
        type: "eip1559" as const,
      };
    },
    sendRawTransaction: sendRaw,
  };
  return {
    publicClient: publicClient as unknown as TokenlessChainRuntime["publicClient"],
    prepaidAccount: PREPAID_ACCOUNT,
    prepaidWallet: wallet as unknown as TokenlessChainRuntime["prepaidWallet"],
    surpriseBonusAccount: SURPRISE_BONUS_ACCOUNT,
  };
}

async function prepaidDebitEntries(workspaceId: string) {
  const result = await dbClient.execute({
    sql: `SELECT delta_atomic, external_reference FROM tokenless_prepaid_ledger_entries
          WHERE workspace_id = ? AND source = 'chain_round'`,
    args: [workspaceId],
  });
  return result.rows;
}

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

test("two concurrent prepaid executions produce exactly one approval and one createRound", async () => {
  const { operationKey, workspaceId } = await prepaidAsk();
  const holder: { current?: Prepared } = {};
  const broadcasts: Broadcast[] = [];
  let firstApprovalEntered!: () => void;
  const firstApprovalEnteredP = new Promise<void>(resolve => (firstApprovalEntered = resolve));
  let releaseFirstApproval!: () => void;
  const releaseFirstApprovalP = new Promise<void>(resolve => (releaseFirstApproval = resolve));
  let approvalArrivals = 0;
  const runtime = prepaidRuntime({
    expected: () => holder.current!,
    broadcasts,
    onBroadcast: async kind => {
      if (kind === "approval") {
        approvalArrivals += 1;
        const persisted = await dbClient.execute({
          sql: `SELECT approval_signed_transaction,approval_transaction_hash
                FROM tokenless_chain_executions WHERE operation_key=?`,
          args: [operationKey],
        });
        const signed = String(persisted.rows[0]?.approval_signed_transaction ?? "") as Hex;
        assert.match(signed, /^0x[0-9a-f]+$/u, "signed bytes must exist before the RPC broadcast");
        assert.equal(persisted.rows[0]?.approval_transaction_hash, keccak256(signed));
        firstApprovalEntered();
        // The winning worker parks mid-broadcast so the second request must make
        // its claim decision while the first is still in flight.
        await releaseFirstApprovalP;
      }
    },
  });
  holder.current = await prepareChainPayment(operationKey, { config: config(), runtime });

  // Request A wins the claim and parks inside the approval broadcast.
  const requestA = executeServerChainPayment(operationKey, { config: config(), runtime });
  await firstApprovalEnteredP;

  // Request B runs to completion while A holds the lease: it must fail to claim
  // and must not broadcast anything.
  const requestBError = await executeServerChainPayment(operationKey, { config: config(), runtime }).then(
    () => null,
    (error: unknown) => error,
  );
  assert.ok(requestBError instanceof TokenlessServiceError, "the second request should be rejected");
  assert.equal((requestBError as TokenlessServiceError).code, "execution_in_progress");
  assert.equal((requestBError as TokenlessServiceError).retryable, true);
  assert.equal(approvalArrivals, 1, "only the winning request may broadcast the approval");
  assert.equal(broadcasts.filter(b => b.kind === "createRound").length, 0);

  releaseFirstApproval();
  const confirmed = await requestA;
  assert.equal(confirmed.paymentState, "confirmed");
  assert.equal(confirmed.roundId, "7");

  assert.equal(broadcasts.filter(b => b.kind === "approval").length, 1, "exactly one approval broadcast");
  assert.equal(broadcasts.filter(b => b.kind === "createRound").length, 1, "exactly one createRound broadcast");

  const debits = await prepaidDebitEntries(workspaceId);
  assert.equal(debits.length, 1, "the reservation must be debited exactly once");
  assert.equal(String(debits[0]?.delta_atomic), `-${confirmed.totalFundedAtomic}`);
  const reservation = await dbClient.execute("SELECT status FROM tokenless_prepaid_reservations");
  assert.equal(String(reservation.rows[0]?.status), "consumed");
});

test("a crashed execution reconciles exact persisted transactions before replay", async () => {
  const { operationKey, workspaceId } = await prepaidAsk();
  const holder: { current?: Prepared } = {};
  const broadcasts: Broadcast[] = [];
  const serializedBroadcasts: Hex[] = [];
  let crashOnSubmissionReceipt = true;
  const runtime = prepaidRuntime({
    expected: () => holder.current!,
    broadcasts,
    serializedBroadcasts,
    onSubmissionReceipt: async () => {
      // Simulate a crash after both transactions were broadcast and their hashes
      // persisted, but before the round could be confirmed.
      if (crashOnSubmissionReceipt) {
        crashOnSubmissionReceipt = false;
        throw new Error("simulated_worker_crash");
      }
    },
  });
  holder.current = await prepareChainPayment(operationKey, { config: config(), runtime });

  await assert.rejects(
    () => executeServerChainPayment(operationKey, { config: config(), runtime }),
    /simulated_worker_crash/,
  );
  const afterCrash = [...serializedBroadcasts];
  assert.equal(broadcasts.filter(b => b.kind === "approval").length, 1);
  assert.equal(broadcasts.filter(b => b.kind === "createRound").length, 1);
  const persisted = await dbClient.execute({
    sql: `SELECT approval_transaction_hash,approval_signed_transaction,
                 submission_transaction_hash,submission_signed_transaction,state
          FROM tokenless_chain_executions WHERE operation_key = ?`,
    args: [operationKey],
  });
  assert.ok(persisted.rows[0]?.submission_transaction_hash, "the submission hash must be persisted before the crash");
  assert.ok(persisted.rows[0]?.approval_signed_transaction, "the signed approval must be persisted before broadcast");
  assert.ok(
    persisted.rows[0]?.submission_signed_transaction,
    "the signed submission must be persisted before broadcast",
  );
  assert.equal(String(persisted.rows[0]?.state), "broadcast");

  // The crashed worker's lease must lapse before another worker can resume it.
  await dbClient.execute({
    sql: "UPDATE tokenless_chain_executions SET claim_expires_at = ? WHERE operation_key = ?",
    args: [new Date(Date.now() - 60_000), operationKey],
  });

  const resumed = await executeServerChainPayment(operationKey, { config: config(), runtime });
  assert.equal(resumed.paymentState, "confirmed");
  assert.equal(resumed.roundId, "7");
  // Recovery reconciles the exact hashes before deciding whether a byte-identical
  // replay is necessary. Both transactions are already observable here.
  assert.equal(broadcasts.filter(b => b.kind === "approval").length, 1, "accepted approval is not rebroadcast");
  assert.equal(broadcasts.filter(b => b.kind === "createRound").length, 1, "accepted submission is not rebroadcast");
  assert.deepEqual(serializedBroadcasts, afterCrash, "reconciliation does not create replacement bytes");

  const debits = await prepaidDebitEntries(workspaceId);
  assert.equal(debits.length, 1, "the reservation is debited exactly once across crash and resume");
  assert.equal(String(debits[0]?.delta_atomic), `-${resumed.totalFundedAtomic}`);
});

test("a crash before RPC acceptance leaves signed state and replays the exact bytes", async () => {
  const { operationKey } = await prepaidAsk();
  const holder: { current?: Prepared } = {};
  const broadcasts: Broadcast[] = [];
  const serializedBroadcasts: Hex[] = [];
  let crashBeforeAcceptance = true;
  const runtime = prepaidRuntime({
    expected: () => holder.current!,
    broadcasts,
    serializedBroadcasts,
    onBroadcast: async kind => {
      if (kind === "approval" && crashBeforeAcceptance) {
        crashBeforeAcceptance = false;
        throw new Error("simulated_pre_acceptance_disconnect");
      }
    },
  });
  holder.current = await prepareChainPayment(operationKey, { config: config(), runtime });

  await assert.rejects(
    () => executeServerChainPayment(operationKey, { config: config(), runtime }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "chain_broadcast_unconfirmed",
  );
  const persisted = await dbClient.execute({
    sql: `SELECT approval_signed_transaction,state FROM tokenless_chain_executions WHERE operation_key = ?`,
    args: [operationKey],
  });
  assert.equal(String(persisted.rows[0]?.state), "signed");
  assert.equal(String(persisted.rows[0]?.approval_signed_transaction), serializedBroadcasts[0]);
  await dbClient.execute({
    sql: "UPDATE tokenless_chain_executions SET claim_expires_at = ? WHERE operation_key = ?",
    args: [new Date(Date.now() - 60_000), operationKey],
  });

  const resumed = await executeServerChainPayment(operationKey, { config: config(), runtime });
  assert.equal(resumed.paymentState, "confirmed");
  assert.equal(serializedBroadcasts[1], serializedBroadcasts[0], "retry uses the exact pre-crash approval bytes");
});

test("accept-then-throw ambiguity reconciles the accepted transaction before recovery replay", async () => {
  const { operationKey } = await prepaidAsk();
  const holder: { current?: Prepared } = {};
  const broadcasts: Broadcast[] = [];
  const serializedBroadcasts: Hex[] = [];
  let throwAfterAcceptance = true;
  let failExactHashLookup = true;
  const runtime = prepaidRuntime({
    expected: () => holder.current!,
    broadcasts,
    serializedBroadcasts,
    onAcceptedBroadcast: async kind => {
      if (kind === "createRound" && throwAfterAcceptance) {
        throwAfterAcceptance = false;
        throw new Error("simulated_accept_then_disconnect");
      }
    },
    onTransactionLookup: async hash => {
      if (failExactHashLookup && keccak256(serializedBroadcasts[1]!) === hash) {
        failExactHashLookup = false;
        throw new Error("simulated_reconciliation_transport_failure");
      }
    },
  });
  holder.current = await prepareChainPayment(operationKey, { config: config(), runtime });

  await assert.rejects(
    () => executeServerChainPayment(operationKey, { config: config(), runtime }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "chain_broadcast_unconfirmed",
  );
  await dbClient.execute({
    sql: "UPDATE tokenless_chain_executions SET claim_expires_at = ? WHERE operation_key = ?",
    args: [new Date(Date.now() - 60_000), operationKey],
  });

  const resumed = await executeServerChainPayment(operationKey, { config: config(), runtime });
  assert.equal(resumed.paymentState, "confirmed");
  assert.equal(serializedBroadcasts.length, 2, "observable accepted transactions are reconciled before replay");
  assert.equal(broadcasts.filter(broadcast => broadcast.kind === "approval").length, 1);
  assert.equal(broadcasts.filter(broadcast => broadcast.kind === "createRound").length, 1);
});

test("accept-then-throw advances only after the exact derived hash is observable", async () => {
  const { operationKey } = await prepaidAsk();
  const holder: { current?: Prepared } = {};
  const broadcasts: Broadcast[] = [];
  let throwAfterAcceptance = true;
  const runtime = prepaidRuntime({
    expected: () => holder.current!,
    broadcasts,
    onAcceptedBroadcast: async kind => {
      if (kind === "approval" && throwAfterAcceptance) {
        throwAfterAcceptance = false;
        throw new Error("simulated_accept_then_disconnect");
      }
    },
  });
  holder.current = await prepareChainPayment(operationKey, { config: config(), runtime });

  const confirmed = await executeServerChainPayment(operationKey, { config: config(), runtime });
  assert.equal(confirmed.paymentState, "confirmed");
  assert.equal(broadcasts.filter(broadcast => broadcast.kind === "approval").length, 1);
  assert.equal(broadcasts.filter(broadcast => broadcast.kind === "createRound").length, 1);
});

test("legacy nonce-only executions fail closed instead of signing a possibly duplicated transaction", async () => {
  const { operationKey } = await prepaidAsk();
  const holder: { current?: Prepared } = {};
  const broadcasts: Broadcast[] = [];
  const runtime = prepaidRuntime({ expected: () => holder.current!, broadcasts });
  holder.current = await prepareChainPayment(operationKey, { config: config(), runtime });
  await dbClient.execute({
    sql: `UPDATE tokenless_chain_executions
          SET transaction_recovery_version = 0, approval_nonce = 0
          WHERE operation_key = ?`,
    args: [operationKey],
  });

  await assert.rejects(
    () => executeServerChainPayment(operationKey, { config: config(), runtime }),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.code === "chain_transaction_reconciliation_required",
  );
  assert.equal(broadcasts.length, 0);
});

test("persisted signed transactions are rejected when their decoded intent changes", async () => {
  const { operationKey } = await prepaidAsk();
  const holder: { current?: Prepared } = {};
  const broadcasts: Broadcast[] = [];
  let crashOnSubmissionReceipt = true;
  const runtime = prepaidRuntime({
    expected: () => holder.current!,
    broadcasts,
    onSubmissionReceipt: async () => {
      if (crashOnSubmissionReceipt) {
        crashOnSubmissionReceipt = false;
        throw new Error("simulated_worker_crash");
      }
    },
  });
  holder.current = await prepareChainPayment(operationKey, { config: config(), runtime });
  await assert.rejects(() => executeServerChainPayment(operationKey, { config: config(), runtime }));
  await dbClient.execute({
    sql: `UPDATE tokenless_chain_executions
          SET approval_signed_transaction = submission_signed_transaction,
              approval_transaction_hash = submission_transaction_hash,
              claim_expires_at = ?
          WHERE operation_key = ?`,
    args: [new Date(Date.now() - 60_000), operationKey],
  });

  await assert.rejects(
    () => executeServerChainPayment(operationKey, { config: config(), runtime }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "signed_transaction_mismatch",
  );
});

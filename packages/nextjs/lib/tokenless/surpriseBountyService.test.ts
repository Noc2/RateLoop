import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { type Address, type Hash, type Hex, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { type TokenlessChainConfig, buildTokenlessDeploymentKey } from "~~/lib/tokenless/chain/config";
import type { TokenlessChainRuntime } from "~~/lib/tokenless/chain/runtime";
import {
  finalizeSurpriseBountyRound,
  processSurpriseBountyPayments,
  reserveSurpriseBountyCapacity,
} from "~~/lib/tokenless/surpriseBountyService";

const PANEL = getAddress("0x1111111111111111111111111111111111111111");
const ISSUER = getAddress("0x2222222222222222222222222222222222222222");
const ADAPTER = getAddress("0x3333333333333333333333333333333333333333");
const FEEDBACK_BONUS = getAddress("0x7777777777777777777777777777777777777777");
const USDC = getAddress("0x4444444444444444444444444444444444444444");
const FEE_RECIPIENT = getAddress("0x5555555555555555555555555555555555555555");
const PAYOUT = getAddress("0x6666666666666666666666666666666666666666");
const BONUS_ACCOUNT = privateKeyToAccount(`0x${"77".repeat(32)}`);
const CLAIM_TX = `0x${"aa".repeat(32)}` as Hash;
const BONUS_TX = `0x${"bb".repeat(32)}` as Hash;
const NOW = new Date("2026-07-14T15:00:00.000Z");

function key(index: number) {
  return `0x${index.toString(16).padStart(64, "0")}` as `0x${string}`;
}

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

function runtime(balance = 100_000_000n): TokenlessChainRuntime {
  const publicClient = {
    getChainId: async () => 84_532,
    getBlockNumber: async () => 500n,
    getBytecode: async () => "0x6000" as Hex,
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
      if (address === USDC && functionName === "balanceOf") return balance;
      throw new Error(`Unexpected read ${address}:${functionName}`);
    },
  };
  return {
    publicClient: publicClient as unknown as TokenlessChainRuntime["publicClient"],
    surpriseBonusAccount: BONUS_ACCOUNT,
  };
}

async function seedAsk(operationKey: string) {
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_asks
          (operation_key, idempotency_key, request_hash, quote_id, request_json, economics_json,
           status, created_at, updated_at)
          VALUES (?, ?, 'request-hash', 'quote-id', '{}', '{}', 'open', ?, ?)`,
    args: [operationKey, `idem:${operationKey}`, NOW, NOW],
  });
}

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
});

test("central surprise bounties reserve capacity, freeze evidence, and pay only after the base claim", async () => {
  const operationKey = "operation-surprise-1";
  await seedAsk(operationKey);
  const reservation = await reserveSurpriseBountyCapacity({
    operationKey,
    guaranteedBasePerReportAtomic: 1_000_000n,
    maximumReports: 10,
    feeAmountAtomic: 1_250_000n,
    config: config(),
    runtime: runtime(),
    now: NOW,
    expiresAt: new Date(NOW.getTime() + 600_000),
  });
  assert.equal(reservation.maximumLiabilityAtomic, "1250000");
  assert.deepEqual(
    await reserveSurpriseBountyCapacity({
      operationKey,
      guaranteedBasePerReportAtomic: 1_000_000n,
      maximumReports: 10,
      feeAmountAtomic: 1_250_000n,
      config: config(),
      runtime: runtime(),
      now: NOW,
      expiresAt: new Date(NOW.getTime() + 600_000),
    }),
    reservation,
  );

  const reports = [
    ...Array.from({ length: 4 }, (_, index) => ({
      commitKey: key(index + 1),
      vote: 1 as const,
      predictedUpBps: 2_000,
    })),
    ...Array.from({ length: 6 }, (_, index) => ({
      commitKey: key(index + 5),
      vote: 0 as const,
      predictedUpBps: 2_000,
    })),
  ];
  const finalized = await finalizeSurpriseBountyRound({
    operationKey,
    deploymentKey: config().deploymentKey,
    roundId: "42",
    reports,
    now: NOW,
  });
  assert.equal(finalized.status, "allocated");
  const entitlements = await dbClient.execute({
    sql: "SELECT entitlement_id, commit_key, bonus_atomic, state FROM tokenless_surprise_bounty_entitlements ORDER BY commit_key",
  });
  assert.equal(entitlements.rows.length, 4);
  assert.ok(entitlements.rows.every(row => row.state === "pending_claim"));

  const pending = await processSurpriseBountyPayments({
    now: NOW,
    config: config(),
    runtime: runtime(),
    claimSource: async () => [],
    payer: async () => assert.fail("unclaimed entitlement must not be paid"),
  });
  assert.deepEqual(pending, { paid: 0, pendingClaim: 4, retry: 0, reconciliationRequired: 0 });

  const payableCommit = String(entitlements.rows[0].commit_key).toLowerCase() as `0x${string}`;
  const paid = await processSurpriseBountyPayments({
    now: NOW,
    limit: 1,
    config: config(),
    runtime: runtime(),
    claimSource: async roundId => [
      {
        deploymentKey: config().deploymentKey,
        roundId,
        commitKey: payableCommit,
        payoutAddress: PAYOUT,
        amountAtomic: "1000000",
        transactionHash: CLAIM_TX,
      },
    ],
    payer: async payment => {
      assert.equal(payment.payoutAddress, PAYOUT);
      await dbClient.execute({
        sql: "UPDATE tokenless_surprise_bounty_entitlements SET transfer_nonce = 7 WHERE entitlement_id = ?",
        args: [payment.entitlementId],
      });
      return BONUS_TX;
    },
  });
  assert.deepEqual(paid, { paid: 1, pendingClaim: 0, retry: 0, reconciliationRequired: 0 });
  const payment = await dbClient.execute({
    sql: "SELECT state, payout_address, claim_transaction_hash, transfer_transaction_hash FROM tokenless_surprise_bounty_entitlements WHERE commit_key = ?",
    args: [payableCommit],
  });
  assert.deepEqual(payment.rows[0], {
    state: "paid",
    payout_address: PAYOUT.toLowerCase(),
    claim_transaction_hash: CLAIM_TX,
    transfer_transaction_hash: BONUS_TX,
  });
});

test("reservation fails before a paid round when the dedicated funder is under-collateralized", async () => {
  await seedAsk("operation-surprise-underfunded");
  await assert.rejects(
    reserveSurpriseBountyCapacity({
      operationKey: "operation-surprise-underfunded",
      guaranteedBasePerReportAtomic: 1_000_000n,
      maximumReports: 10,
      feeAmountAtomic: 1_250_000n,
      config: config(),
      runtime: runtime(1_249_999n),
      now: NOW,
      expiresAt: new Date(NOW.getTime() + 600_000),
    }),
    /does not cover existing reservations/,
  );
});

test("reservation caps frozen liability at the exact round fee and conflicts when that fee changes", async () => {
  const operationKey = "operation-surprise-fee-cap";
  await seedAsk(operationKey);
  const input = {
    operationKey,
    guaranteedBasePerReportAtomic: 1_000_000n,
    maximumReports: 10,
    feeAmountAtomic: 500_000n,
    config: config(),
    runtime: runtime(),
    now: NOW,
    expiresAt: new Date(NOW.getTime() + 600_000),
  };
  const reserved = await reserveSurpriseBountyCapacity(input);
  assert.equal(reserved.maximumLiabilityAtomic, "500000");
  assert.deepEqual(await reserveSurpriseBountyCapacity(input), reserved);

  const persisted = await dbClient.execute({
    sql: `SELECT policy_json, maximum_bonus_per_report_atomic, maximum_liability_atomic
          FROM tokenless_surprise_bounty_rounds WHERE operation_key = ?`,
    args: [operationKey],
  });
  const frozenPolicy = JSON.parse(String(persisted.rows[0]?.policy_json));
  assert.equal(String(persisted.rows[0]?.maximum_bonus_per_report_atomic), "50000");
  assert.equal(String(persisted.rows[0]?.maximum_liability_atomic), "500000");
  assert.equal(frozenPolicy.feeAmountAtomic, "500000");
  assert.equal(frozenPolicy.maximumLiabilityAtomic, "500000");

  await assert.rejects(
    reserveSurpriseBountyCapacity({ ...input, feeAmountAtomic: 600_000n }),
    /different frozen surprise-bounty reservation/u,
  );
});

test("finalization cannot exceed the report capacity reserved from the round fee", async () => {
  const operationKey = "operation-surprise-report-capacity";
  await seedAsk(operationKey);
  await reserveSurpriseBountyCapacity({
    operationKey,
    guaranteedBasePerReportAtomic: 1_000_000n,
    maximumReports: 10,
    feeAmountAtomic: 500_000n,
    config: config(),
    runtime: runtime(),
    now: NOW,
    expiresAt: new Date(NOW.getTime() + 600_000),
  });

  await assert.rejects(
    finalizeSurpriseBountyRound({
      operationKey,
      deploymentKey: config().deploymentKey,
      roundId: "99",
      reports: Array.from({ length: 11 }, (_, index) => ({
        commitKey: key(index + 100),
        vote: index < 5 ? (1 as const) : (0 as const),
        predictedUpBps: 2_000,
      })),
    }),
    (error: unknown) => error instanceof Error && /exceeds the frozen report capacity/u.test(error.message),
  );
});

test("expired abandoned reservations release deployment capacity for another operation", async () => {
  await seedAsk("operation-surprise-abandoned");
  await seedAsk("operation-surprise-successor");
  const expiresAt = new Date(NOW.getTime() + 600_000);
  await reserveSurpriseBountyCapacity({
    operationKey: "operation-surprise-abandoned",
    guaranteedBasePerReportAtomic: 1_000_000n,
    maximumReports: 10,
    feeAmountAtomic: 1_250_000n,
    config: config(),
    runtime: runtime(1_250_000n),
    now: NOW,
    expiresAt,
  });
  await assert.rejects(
    reserveSurpriseBountyCapacity({
      operationKey: "operation-surprise-successor",
      guaranteedBasePerReportAtomic: 1_000_000n,
      maximumReports: 10,
      feeAmountAtomic: 1_250_000n,
      config: config(),
      runtime: runtime(1_250_000n),
      now: new Date(NOW.getTime() + 599_999),
      expiresAt: new Date(NOW.getTime() + 1_200_000),
    }),
    /does not cover existing reservations/u,
  );

  await reserveSurpriseBountyCapacity({
    operationKey: "operation-surprise-successor",
    guaranteedBasePerReportAtomic: 1_000_000n,
    maximumReports: 10,
    feeAmountAtomic: 1_250_000n,
    config: config(),
    runtime: runtime(1_250_000n),
    now: new Date(NOW.getTime() + 600_001),
    expiresAt: new Date(NOW.getTime() + 1_200_000),
  });
  const states = await dbClient.execute({
    sql: `SELECT operation_key,state,reservation_expires_at
          FROM tokenless_surprise_bounty_rounds ORDER BY operation_key`,
    args: [],
  });
  assert.deepEqual(
    states.rows.map(row => ({
      operationKey: row.operation_key,
      state: row.state,
      expires: row.reservation_expires_at instanceof Date,
    })),
    [
      { operationKey: "operation-surprise-abandoned", state: "expired", expires: false },
      { operationKey: "operation-surprise-successor", state: "reserved", expires: true },
    ],
  );
});

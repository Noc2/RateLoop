import { type TokenlessChainConfig, buildTokenlessDeploymentKey, loadTokenlessChainConfig } from "./config";
import {
  __chainPaymentTestUtils,
  attachX402Authorization,
  confirmWalletChainPayment,
  getChainPaymentInstructions,
  prepareChainPayment,
  reconcileChainPayment,
} from "./payments";
import { type TokenlessChainRuntime, assertLiveTokenlessDeployment } from "./runtime";
import { TokenlessPanelAbi } from "@rateloop/contracts/tokenless";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { type Address, type Hash, type Hex, encodeAbiParameters, encodeEventTopics, getAddress } from "viem";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { attachProductAsk, createWorkspace, prepareProductAsk } from "~~/lib/tokenless/productCore";
import { createTokenlessAsk, createTokenlessQuote } from "~~/lib/tokenless/server";

const PANEL = getAddress("0x1111111111111111111111111111111111111111");
const ISSUER = getAddress("0x2222222222222222222222222222222222222222");
const ADAPTER = getAddress("0x3333333333333333333333333333333333333333");
const USDC = getAddress("0x4444444444444444444444444444444444444444");
const FUNDER = getAddress("0x5555555555555555555555555555555555555555");
const FEE_RECIPIENT = getAddress("0x6666666666666666666666666666666666666666");
const TX_HASH = `0x${"aa".repeat(32)}` as Hash;
const BLOCK_HASH = `0x${"bb".repeat(32)}` as Hash;
const originalSandbox = process.env.TOKENLESS_SANDBOX_MODE;

function config(overrides: Partial<TokenlessChainConfig> = {}): TokenlessChainConfig {
  return {
    chainId: 84_532,
    claimGracePeriodSeconds: 604_800,
    deploymentBlock: 100n,
    deploymentKey: buildTokenlessDeploymentKey({
      chainId: 84_532,
      panelAddress: PANEL,
      issuerAddress: ISSUER,
      x402SubmitterAddress: ADAPTER,
    }),
    feeRecipient: FEE_RECIPIENT,
    issuerAddress: ISSUER,
    panelAddress: PANEL,
    revealWindowSeconds: 120,
    beaconFailureGraceSeconds: 300,
    rpcUrl: "https://sepolia.base.org/",
    schemaVersion: "rateloop-tokenless-deployment-v2",
    usdcAddress: USDC,
    x402SubmitterAddress: ADAPTER,
    ...overrides,
  };
}

function mockRuntime(
  overrides: Record<string, unknown> = {},
  expectedRound?: Awaited<ReturnType<typeof prepareChainPayment>>,
): TokenlessChainRuntime {
  const publicClient = {
    getChainId: async () => 84_532,
    getBlockNumber: async () => 500n,
    getBytecode: async () => "0x6000" as Hex,
    readContract: async ({ address, functionName }: { address: Address; functionName: string }) => {
      if (address === PANEL && functionName === "usdc") return USDC;
      if (address === PANEL && functionName === "credentialIssuer") return ISSUER;
      if (address === ADAPTER && functionName === "panel") return PANEL;
      if (address === ADAPTER && (functionName === "usdc" || functionName === "authorizationToken")) return USDC;
      if (address === PANEL && functionName === "getRound" && expectedRound) {
        const terms = __chainPaymentTestUtils.toOnchainTerms(expectedRound.roundTerms);
        return {
          funder: expectedRound.funderAddress,
          contentId: terms.contentId,
          termsHash: terms.termsHash,
          beaconNetworkHash: terms.beaconNetworkHash,
          feeRecipient: terms.feeRecipient,
          bountyAmount: terms.bountyAmount,
          feeAmount: terms.feeAmount,
          attemptReserve: terms.attemptReserve,
          attemptCompensation: terms.attemptCompensation,
          commitDeadline: terms.commitDeadline,
          revealDeadline: terms.revealDeadline,
          beaconFailureDeadline: terms.beaconFailureDeadline,
          beaconRound: terms.beaconRound,
          claimGracePeriod: terms.claimGracePeriod,
          minimumReveals: terms.minimumReveals,
          maximumCommits: terms.maximumCommits,
          requiredTier: terms.requiredTier,
        };
      }
      throw new Error(`Unexpected read ${address}:${functionName}`);
    },
    ...overrides,
  };
  return { publicClient: publicClient as unknown as TokenlessChainRuntime["publicClient"] };
}

beforeEach(() => {
  process.env.TOKENLESS_SANDBOX_MODE = "false";
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
  if (originalSandbox === undefined) delete process.env.TOKENLESS_SANDBOX_MODE;
  else process.env.TOKENLESS_SANDBOX_MODE = originalSandbox;
});

test("deployment config binds the complete bundle and forbids credential key reuse", () => {
  const key = `0x${"11".repeat(32)}`;
  const env = {
    TOKENLESS_DEPLOYMENT_SCHEMA: "rateloop-tokenless-deployment-v2",
    TOKENLESS_CHAIN_ID: "84532",
    TOKENLESS_PANEL_ADDRESS: PANEL,
    TOKENLESS_CREDENTIAL_ISSUER_ADDRESS: ISSUER,
    TOKENLESS_X402_PANEL_SUBMITTER_ADDRESS: ADAPTER,
    TOKENLESS_USDC_ADDRESS: USDC,
    TOKENLESS_FEE_RECIPIENT: FEE_RECIPIENT,
    TOKENLESS_DEPLOYMENT_KEY: config().deploymentKey,
    TOKENLESS_DEPLOYMENT_BLOCK: "100",
    BASE_SEPOLIA_RPC_URL: "https://sepolia.base.org",
    TOKENLESS_CREDENTIAL_ISSUER_SIGNER_PRIVATE_KEY: key,
    TOKENLESS_X402_RELAYER_PRIVATE_KEY: key,
  } as unknown as NodeJS.ProcessEnv;
  assert.throws(() => loadTokenlessChainConfig(env), /must never reuse the credential issuer signer/);
  assert.throws(
    () =>
      loadTokenlessChainConfig({
        ...env,
        TOKENLESS_X402_RELAYER_PRIVATE_KEY: undefined,
        TOKENLESS_DEPLOYMENT_KEY: "wrong",
      }),
    /does not match the complete configured tokenless contract bundle/,
  );
  assert.throws(
    () =>
      loadTokenlessChainConfig({
        ...env,
        TOKENLESS_X402_RELAYER_PRIVATE_KEY: undefined,
        TOKENLESS_DEPLOYMENT_SCHEMA: "rateloop-tokenless-deployment-v1",
      }),
    /must be rateloop-tokenless-deployment-v2/,
  );
});

test("deployment validation rejects on-chain immutable wiring from a mixed bundle", async () => {
  const runtime = mockRuntime({
    readContract: async ({ address, functionName }: { address: Address; functionName: string }) => {
      if (address === PANEL && functionName === "credentialIssuer") return FEE_RECIPIENT;
      if (address === PANEL && functionName === "usdc") return USDC;
      if (address === ADAPTER && functionName === "panel") return PANEL;
      return USDC;
    },
  });
  await assert.rejects(() => assertLiveTokenlessDeployment(config(), runtime), /mixed deployment bundle/);
});

async function walletAsk() {
  await createWorkspace({ name: "Wallet team", ownerAddress: FUNDER });
  const quote = await createTokenlessQuote({
    audience: { tierId: "passport" },
    budget: { attemptReserveAtomic: "5000000", bountyAtomic: "25000000", feeBps: 750 },
    question: { kind: "binary" as const, prompt: "Ship this?", rationale: { mode: "optional" as const } },
    requestedPanelSize: 15,
  });
  const request = {
    idempotencyKey: "chain:wallet:12345678",
    payment: { mode: "wallet" as const, payerAddress: FUNDER },
    quoteId: quote.quoteId,
  };
  const prepared = await prepareProductAsk({ principal: { kind: "session", accountAddress: FUNDER }, request });
  const ask = await createTokenlessAsk(request, request.idempotencyKey, "https://tokenless.example");
  await attachProductAsk(prepared, ask);
  await dbClient.execute("UPDATE tokenless_content_records SET moderation_status = 'approved'");
  await dbClient.execute("UPDATE tokenless_question_records SET moderation_status = 'approved'");
  return ask.operationKey;
}

function roundCreatedLog(expected: Awaited<ReturnType<typeof prepareChainPayment>>, roundId = 7n) {
  const topics = encodeEventTopics({
    abi: TokenlessPanelAbi,
    eventName: "RoundCreated",
    args: {
      roundId,
      funder: expected.funderAddress,
      contentId: expected.roundTerms.contentId,
    },
  });
  const data = encodeAbiParameters(
    [
      { name: "termsHash", type: "bytes32" },
      { name: "bountyAmount", type: "uint256" },
      { name: "feeAmount", type: "uint256" },
      { name: "attemptReserve", type: "uint256" },
    ],
    [
      expected.roundTerms.termsHash,
      BigInt(expected.roundTerms.bountyAmount),
      BigInt(expected.roundTerms.feeAmount),
      BigInt(expected.roundTerms.attemptReserve),
    ],
  );
  return { address: PANEL, data, topics: topics.filter((topic): topic is Hex => topic !== null) };
}

test("wallet confirmation accepts only the exact quoted RoundCreated evidence and reconciles the operation", async () => {
  const operationKey = await walletAsk();
  const runtime = mockRuntime();
  const expected = await prepareChainPayment(operationKey, {
    config: config(),
    runtime,
    now: new Date("2026-07-12T20:00:00Z"),
  });
  assert.equal(expected.paymentMode, "wallet");
  assert.equal(expected.totalFundedAtomic, "31875000");
  assert.equal(expected.roundTerms.attemptCompensation, "333333");
  const receiptRuntime = mockRuntime(
    {
      getTransactionReceipt: async () => ({
        blockHash: BLOCK_HASH,
        blockNumber: 200n,
        logs: [roundCreatedLog(expected)],
        status: "success",
      }),
    },
    expected,
  );
  const confirmed = await confirmWalletChainPayment(operationKey, TX_HASH, {
    config: config(),
    runtime: receiptRuntime,
  });
  assert.equal(confirmed.roundId, "7");
  assert.equal(confirmed.paymentState, "confirmed");
  const ask = await dbClient.execute({
    sql: "SELECT status, round_id FROM tokenless_agent_asks WHERE operation_key = ?",
    args: [operationKey],
  });
  assert.deepEqual(
    { status: ask.rows[0]?.status, roundId: String(ask.rows[0]?.round_id) },
    { status: "open", roundId: "7" },
  );
  const voucherRound = await dbClient.execute("SELECT round_id, content_id FROM tokenless_voucher_rounds");
  assert.equal(String(voucherRound.rows[0]?.round_id), "7");
  assert.equal(voucherRound.rows[0]?.content_id, expected.roundTerms.contentId);
});

test("receipt reconciliation rejects altered economics even when the panel and funder match", async () => {
  const operationKey = await walletAsk();
  const runtime = mockRuntime();
  const expected = await prepareChainPayment(operationKey, { config: config(), runtime });
  const altered = { ...expected, roundTerms: { ...expected.roundTerms, bountyAmount: "1" } };
  assert.throws(
    () => __chainPaymentTestUtils.exactRoundCreated({ logs: [roundCreatedLog(altered)], expected }),
    /exactly one RoundCreated event matching the quoted terms/,
  );
});

test("round reconciliation reads back and rejects altered non-event terms", async () => {
  const operationKey = await walletAsk();
  const runtime = mockRuntime();
  const expected = await prepareChainPayment(operationKey, { config: config(), runtime });
  const altered = {
    ...expected,
    roundTerms: {
      ...expected.roundTerms,
      commitDeadline: (BigInt(expected.roundTerms.commitDeadline) + 1n).toString(),
    },
  };
  await assert.rejects(
    () =>
      __chainPaymentTestUtils.assertCompleteRoundMatches({
        expected,
        roundId: 7n,
        runtime: mockRuntime({}, altered),
      }),
    /does not match the complete quoted terms/,
  );
});

test("x402 authorization attaches after exact terms without breaking ask idempotency", async () => {
  await createWorkspace({ name: "x402 team", ownerAddress: FUNDER });
  const quote = await createTokenlessQuote({
    audience: { tierId: "passport" },
    budget: { attemptReserveAtomic: "5000000", bountyAtomic: "25000000", feeBps: 750 },
    question: { kind: "binary" as const, prompt: "Fund this?", rationale: { mode: "optional" as const } },
    requestedPanelSize: 15,
  });
  const request = {
    idempotencyKey: "chain:x402:12345678",
    payment: { mode: "x402" as const, payerAddress: FUNDER },
    quoteId: quote.quoteId,
  };
  const principal = { kind: "session" as const, accountAddress: FUNDER };
  const product = await prepareProductAsk({ principal, request });
  assert.equal(product.paymentState, "pending_chain_authorization");
  const ask = await createTokenlessAsk(request, request.idempotencyKey, "https://tokenless.example");
  await attachProductAsk(product, ask);
  await dbClient.execute("UPDATE tokenless_content_records SET moderation_status = 'approved'");
  await dbClient.execute("UPDATE tokenless_question_records SET moderation_status = 'approved'");
  const runtime = mockRuntime();
  assert.equal(
    (await prepareChainPayment(ask.operationKey, { config: config(), runtime })).paymentState,
    "awaiting_authorization",
  );
  assert.equal(
    (await reconcileChainPayment(ask.operationKey, { config: config(), runtime }))?.paymentState,
    "awaiting_authorization",
  );
  await attachX402Authorization(ask.operationKey, {
    validAfter: "1",
    validBefore: "2000000000",
    nonce: `0x${"44".repeat(32)}`,
    v: 27,
    r: `0x${"55".repeat(32)}`,
    s: `0x${"66".repeat(32)}`,
    roundAuthorizationSignature: `0x${"77".repeat(65)}`,
  });
  assert.equal((await getChainPaymentInstructions(ask.operationKey)).paymentState, "prepared");
  const replay = await prepareProductAsk({ principal, request });
  assert.equal(replay.paymentReference, product.paymentReference);
  assert.equal(replay.createdPayment, false);
});

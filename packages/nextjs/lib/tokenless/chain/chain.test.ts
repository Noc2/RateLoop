import { type TokenlessChainConfig, buildTokenlessDeploymentKey, loadTokenlessChainConfig } from "./config";
import {
  __chainPaymentTestUtils,
  attachX402Authorization,
  confirmWalletChainPayment,
  executeServerChainPayment,
  getChainPaymentInstructions,
  prepareChainPayment,
  reconcileChainPayment,
} from "./payments";
import { type TokenlessChainRuntime, assertLiveTokenlessDeployment } from "./runtime";
import { TokenlessPanelAbi, X402PanelSubmitterAbi } from "@rateloop/contracts/tokenless";
import { HUMAN_ASSURANCE_SCHEMA_VERSION } from "@rateloop/sdk";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import {
  type Address,
  type Hash,
  type Hex,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  getAddress,
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
const TX_HASH = `0x${"aa".repeat(32)}` as Hash;
const BLOCK_HASH = `0x${"bb".repeat(32)}` as Hash;

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
      feedbackBonusAddress: FEEDBACK_BONUS,
    }),
    feeRecipient: FEE_RECIPIENT,
    feedbackBonusAddress: FEEDBACK_BONUS,
    issuerAddress: ISSUER,
    panelAddress: PANEL,
    revealWindowSeconds: 120,
    beaconFailureGraceSeconds: 300,
    rpcFallbackUrls: ["https://base-sepolia-fallback.example/"],
    rpcUrl: "https://sepolia.base.org/",
    schemaVersion: "rateloop-tokenless-deployment-v4",
    usdcAddress: USDC,
    usdcEip712Name: "RateLoop Tokenless Test USDC",
    usdcEip712Version: "2",
    x402SubmitterAddress: ADAPTER,
    ...overrides,
  };
}

function mockRuntime(
  overrides: Record<string, unknown> = {},
  expectedRound?: Awaited<ReturnType<typeof prepareChainPayment>>,
  authorizationUsed = false,
): TokenlessChainRuntime {
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
      if (address === USDC && functionName === "balanceOf") return 1_000_000_000n;
      if (address === USDC && functionName === "authorizationState") return authorizationUsed;
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
          fixedBasePay: ((terms.bountyAmount / BigInt(terms.maximumCommits)) * 8_000n) / 10_000n,
          maximumBonus:
            terms.bountyAmount / BigInt(terms.maximumCommits) -
            ((terms.bountyAmount / BigInt(terms.maximumCommits)) * 8_000n) / 10_000n,
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
    ...overrides,
  };
  return {
    publicClient: publicClient as unknown as TokenlessChainRuntime["publicClient"],
    surpriseBonusAccount: SURPRISE_BONUS_ACCOUNT,
  };
}

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
});

test("deployment config binds the complete bundle and forbids credential key reuse", () => {
  const key = `0x${"11".repeat(32)}`;
  const env = {
    TOKENLESS_DEPLOYMENT_SCHEMA: "rateloop-tokenless-deployment-v4",
    TOKENLESS_CHAIN_ID: "84532",
    TOKENLESS_PANEL_ADDRESS: PANEL,
    TOKENLESS_CREDENTIAL_ISSUER_ADDRESS: ISSUER,
    TOKENLESS_X402_PANEL_SUBMITTER_ADDRESS: ADAPTER,
    TOKENLESS_FEEDBACK_BONUS_ADDRESS: FEEDBACK_BONUS,
    TOKENLESS_USDC_ADDRESS: USDC,
    TOKENLESS_FEE_RECIPIENT: FEE_RECIPIENT,
    TOKENLESS_DEPLOYMENT_KEY: config().deploymentKey,
    TOKENLESS_DEPLOYMENT_BLOCK: "100",
    BASE_SEPOLIA_RPC_URL: "https://sepolia.base.org",
    BASE_SEPOLIA_RPC_FALLBACK_URLS: "https://base-sepolia-fallback.example",
    TOKENLESS_CREDENTIAL_ISSUER_SIGNER_PRIVATE_KEY: key,
    TOKENLESS_X402_RELAYER_PRIVATE_KEY: key,
  } as unknown as NodeJS.ProcessEnv;
  assert.throws(() => loadTokenlessChainConfig(env), /must never reuse the credential issuer signer/);
  assert.throws(
    () =>
      loadTokenlessChainConfig({
        ...env,
        TOKENLESS_X402_RELAYER_PRIVATE_KEY: `0x${"22".repeat(32)}`,
        TOKENLESS_PREPAID_FUNDER_PRIVATE_KEY: `0x${"33".repeat(32)}`,
        TOKENLESS_SURPRISE_BONUS_FUNDER_PRIVATE_KEY: `0x${"33".repeat(32)}`,
      }),
    /must use distinct keys/,
  );
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
        TOKENLESS_DEPLOYMENT_SCHEMA: "rateloop-tokenless-deployment-v2",
      }),
    /must be rateloop-tokenless-deployment-v4/,
  );
});

test("production deployment config requires distinct HTTPS RPC fallbacks", () => {
  const base = {
    NODE_ENV: "production",
    TOKENLESS_DEPLOYMENT_SCHEMA: "rateloop-tokenless-deployment-v4",
    TOKENLESS_CHAIN_ID: "84532",
    TOKENLESS_PANEL_ADDRESS: PANEL,
    TOKENLESS_CREDENTIAL_ISSUER_ADDRESS: ISSUER,
    TOKENLESS_X402_PANEL_SUBMITTER_ADDRESS: ADAPTER,
    TOKENLESS_FEEDBACK_BONUS_ADDRESS: FEEDBACK_BONUS,
    TOKENLESS_USDC_ADDRESS: USDC,
    TOKENLESS_FEE_RECIPIENT: FEE_RECIPIENT,
    TOKENLESS_DEPLOYMENT_KEY: config().deploymentKey,
    TOKENLESS_DEPLOYMENT_BLOCK: "100",
    BASE_SEPOLIA_RPC_URL: "https://primary.example",
  } as unknown as NodeJS.ProcessEnv;

  assert.throws(() => loadTokenlessChainConfig(base), /must contain at least one independent HTTPS RPC/i);
  assert.throws(
    () =>
      loadTokenlessChainConfig({
        ...base,
        BASE_SEPOLIA_RPC_FALLBACK_URLS: "http://fallback.example",
      }),
    /must use HTTPS/i,
  );
  assert.throws(
    () =>
      loadTokenlessChainConfig({
        ...base,
        BASE_SEPOLIA_RPC_FALLBACK_URLS: "https://primary.example",
      }),
    /must be distinct/i,
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

test("deployment validation rejects a relabeled panel with different mechanism constants", async () => {
  const runtime = mockRuntime();
  const readContract = runtime.publicClient.readContract.bind(runtime.publicClient);
  runtime.publicClient.readContract = (async args =>
    args.functionName === "SCORING_VERSION" ? 1 : readContract(args)) as typeof runtime.publicClient.readContract;
  await assert.rejects(() => assertLiveTokenlessDeployment(config(), runtime), /mixed deployment bundle/);
});

function admissionPolicy() {
  return {
    schemaVersion: HUMAN_ASSURANCE_SCHEMA_VERSION,
    policyId: "policy_chain_paid_network",
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

async function freezeAskAdmissionPolicy(operationKey: string) {
  const source = await dbClient.execute({
    sql: `SELECT q.question_id, q.terms_json FROM tokenless_ask_ownership o
          JOIN tokenless_question_records q ON q.question_id = o.question_id
          WHERE o.operation_key = ? LIMIT 1`,
    args: [operationKey],
  });
  const row = source.rows[0];
  assert.ok(row);
  const terms = {
    ...(JSON.parse(String(row.terms_json)) as Record<string, unknown>),
    audiencePolicy: admissionPolicy(),
  };
  const termsJson = stableJson(terms);
  const termsHash = createHash("sha256").update(termsJson).digest("hex");
  await dbClient.execute({
    sql: "UPDATE tokenless_question_records SET terms_json = ?, terms_hash = ?, updated_at = ? WHERE question_id = ?",
    args: [termsJson, termsHash, new Date(), row.question_id],
  });
}

async function setAskFrozenResponseWindow(operationKey: string, responseWindowSeconds: unknown, present = true) {
  const source = await dbClient.execute({
    sql: `SELECT q.question_id, q.terms_json FROM tokenless_ask_ownership o
          JOIN tokenless_question_records q ON q.question_id = o.question_id
          WHERE o.operation_key = ? LIMIT 1`,
    args: [operationKey],
  });
  const row = source.rows[0];
  assert.ok(row);
  const terms = JSON.parse(String(row.terms_json)) as Record<string, unknown>;
  if (present) terms.responseWindowSeconds = responseWindowSeconds;
  else delete terms.responseWindowSeconds;
  const termsJson = stableJson(terms);
  const termsHash = createHash("sha256").update(termsJson).digest("hex");
  await dbClient.execute({
    sql: "UPDATE tokenless_question_records SET terms_json = ?, terms_hash = ?, updated_at = ? WHERE question_id = ?",
    args: [termsJson, termsHash, new Date(), row.question_id],
  });
}

async function walletAsk(
  options: {
    attemptReserveAtomic?: string;
    feeBps?: number;
    includeAdmissionPolicy?: boolean;
    responseWindowSeconds?: unknown;
  } = {},
) {
  const { workspaceId } = await createWorkspace({ name: "Wallet team", ownerAddress: FUNDER });
  const now = new Date();
  await dbClient.execute({
    sql: `UPDATE tokenless_workspace_subscriptions
          SET plan_key = 'early_access', price_version = 'early_access_usd_99_2026_07',
              provider_status = 'active', current_period_start = ?, current_period_end = ?, updated_at = ?
          WHERE workspace_id = ?`,
    args: [new Date(now.getTime() - 60_000), new Date(now.getTime() + 86_400_000), now, workspaceId],
  });
  const quote = await createTokenlessQuote({
    audience: {
      admissionPolicyHash: freezeAdmissionPolicy(admissionPolicy()).admissionPolicyHash,
      source: "rateloop_network",
    },
    budget: {
      attemptReserveAtomic: options.attemptReserveAtomic ?? "20000000",
      bountyAtomic: "25000000",
      feeBps: options.feeBps ?? 750,
    },
    question: { kind: "binary" as const, prompt: "Ship this?", rationale: { mode: "optional" as const } },
    requestedPanelSize: 15,
    responseWindowSeconds: options.responseWindowSeconds ?? 7_200,
  });
  const request = {
    idempotencyKey: "chain:wallet:12345678",
    payment: { mode: "wallet" as const, payerAddress: FUNDER },
    quoteId: quote.quoteId,
  };
  const prepared = await prepareProductAsk({
    principal: { kind: "session", accountAddress: FUNDER, walletAddress: FUNDER },
    request,
  });
  const ask = await createTokenlessAsk(request, request.idempotencyKey, "https://tokenless.example");
  await attachProductAsk(prepared, ask);
  if (options.includeAdmissionPolicy !== false) await freezeAskAdmissionPolicy(ask.operationKey);
  await dbClient.execute("UPDATE tokenless_content_records SET moderation_status = 'approved'");
  await dbClient.execute("UPDATE tokenless_question_records SET moderation_status = 'approved'");
  return ask.operationKey;
}

test("legacy tier-only asks fail closed instead of being converted into capability admission", async () => {
  const operationKey = await walletAsk({ includeAdmissionPolicy: false });
  await assert.rejects(
    () => prepareChainPayment(operationKey, { config: config(), runtime: mockRuntime() }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "capability_policy_required",
  );
  const executions = await dbClient.execute("SELECT COUNT(*) AS count FROM tokenless_chain_executions");
  assert.equal(Number(executions.rows[0]?.count), 0);
});

test("the explicit frozen response window creates one immutable deadline across retries", async () => {
  const operationKey = await walletAsk({ responseWindowSeconds: 7_200 });
  const source = await dbClient.execute({
    sql: `SELECT q.terms_json FROM tokenless_ask_ownership o
          JOIN tokenless_question_records q ON q.question_id = o.question_id
          WHERE o.operation_key = ? LIMIT 1`,
    args: [operationKey],
  });
  assert.equal(JSON.parse(String(source.rows[0]?.terms_json)).responseWindowSeconds, 7_200);

  const createdAt = new Date("2026-07-12T20:00:00.900Z");
  const expectedDeadline = String(Math.floor(createdAt.getTime() / 1_000) + 7_200);
  const first = await prepareChainPayment(operationKey, { config: config(), runtime: mockRuntime(), now: createdAt });
  assert.equal(first.roundTerms.commitDeadline, expectedDeadline);
  assert.notEqual(first.roundTerms.commitDeadline, String(Math.floor(createdAt.getTime() / 1_000) + 3_600));

  const replay = await prepareChainPayment(operationKey, {
    config: config(),
    runtime: mockRuntime(),
    now: new Date(createdAt.getTime() + 3_600_000),
  });
  assert.equal(replay.roundTerms.commitDeadline, expectedDeadline);
  assert.equal((await getChainPaymentInstructions(operationKey)).roundTerms.commitDeadline, expectedDeadline);
  const stored = await dbClient.execute({
    sql: "SELECT round_terms_json FROM tokenless_chain_executions WHERE operation_key = ?",
    args: [operationKey],
  });
  assert.equal(JSON.parse(String(stored.rows[0]?.round_terms_json)).commitDeadline, expectedDeadline);
});

test("chain preparation fails closed for missing or invalid frozen response windows", async () => {
  const operationKey = await walletAsk();
  for (const candidate of [
    { present: false, value: undefined },
    { present: true, value: 1_199 },
    { present: true, value: 86_401 },
    { present: true, value: 3_600.5 },
    { present: true, value: "3600" },
  ]) {
    await setAskFrozenResponseWindow(operationKey, candidate.value, candidate.present);
    await assert.rejects(
      () => prepareChainPayment(operationKey, { config: config(), runtime: mockRuntime() }),
      (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_response_window",
    );
  }
  const executions = await dbClient.execute("SELECT COUNT(*) AS count FROM tokenless_chain_executions");
  assert.equal(Number(executions.rows[0]?.count), 0);
});

test("underfunded fixed-base guarantees fail before chain funding", async () => {
  const operationKey = await walletAsk({ attemptReserveAtomic: "5000000" });
  await assert.rejects(
    () => prepareChainPayment(operationKey, { config: config(), runtime: mockRuntime() }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_round_terms",
  );
  const executions = await dbClient.execute("SELECT COUNT(*) AS count FROM tokenless_chain_executions");
  assert.equal(Number(executions.rows[0]?.count), 0);
});

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
      ((BigInt(expected.roundTerms.bountyAmount) / BigInt(expected.roundTerms.maximumCommits)) * 8_000n) / 10_000n,
      BigInt(expected.roundTerms.bountyAmount) / BigInt(expected.roundTerms.maximumCommits) -
        ((BigInt(expected.roundTerms.bountyAmount) / BigInt(expected.roundTerms.maximumCommits)) * 8_000n) / 10_000n,
      2,
    ],
  );
  return { address: PANEL, data, topics: topics.filter((topic): topic is Hex => topic !== null) };
}

test("zero-fee rounds skip surprise-bounty reservation and still confirm the base round", async () => {
  const operationKey = await walletAsk({ feeBps: 0 });
  const runtime = mockRuntime();
  delete runtime.surpriseBonusAccount;
  const prepared = await prepareChainPayment(operationKey, { config: config(), runtime });
  assert.equal(prepared.roundTerms.feeAmount, "0");
  assert.equal(prepared.totalFundedAtomic, "45000000");

  const preparedReservation = await dbClient.execute({
    sql: "SELECT COUNT(*) AS count FROM tokenless_surprise_bounty_rounds WHERE operation_key = ?",
    args: [operationKey],
  });
  assert.equal(Number(preparedReservation.rows[0]?.count), 0);

  const receiptRuntime = mockRuntime(
    {
      getTransactionReceipt: async () => ({
        blockHash: BLOCK_HASH,
        blockNumber: 200n,
        logs: [roundCreatedLog(prepared)],
        status: "success",
      }),
    },
    prepared,
  );
  delete receiptRuntime.surpriseBonusAccount;
  const confirmed = await confirmWalletChainPayment(operationKey, TX_HASH, {
    config: config(),
    runtime: receiptRuntime,
  });
  assert.equal(confirmed.paymentState, "confirmed");

  const confirmedReservation = await dbClient.execute({
    sql: "SELECT COUNT(*) AS count FROM tokenless_surprise_bounty_rounds WHERE operation_key = ?",
    args: [operationKey],
  });
  assert.equal(Number(confirmedReservation.rows[0]?.count), 0);
});

test("wallet confirmation accepts only the exact quoted RoundCreated evidence and reconciles the operation", async () => {
  const operationKey = await walletAsk();
  const runtime = mockRuntime();
  const preparedAt = new Date();
  const expected = await prepareChainPayment(operationKey, {
    config: config(),
    runtime,
    now: preparedAt,
  });
  assert.equal(expected.paymentMode, "wallet");
  assert.equal(expected.totalFundedAtomic, "46875000");
  assert.equal(expected.roundTerms.attemptCompensation, "1333332");
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
  const bonusReservation = await dbClient.execute({
    sql: "SELECT state,reservation_expires_at FROM tokenless_surprise_bounty_rounds WHERE operation_key = ?",
    args: [operationKey],
  });
  assert.deepEqual(bonusReservation.rows[0], { state: "funded", reservation_expires_at: null });
  const ask = await dbClient.execute({
    sql: "SELECT status, round_id FROM tokenless_agent_asks WHERE operation_key = ?",
    args: [operationKey],
  });
  assert.deepEqual(
    { status: ask.rows[0]?.status, roundId: String(ask.rows[0]?.round_id) },
    { status: "open", roundId: "7" },
  );
  const voucherRound = await dbClient.execute(
    "SELECT round_id, content_id, voucher_deadline FROM tokenless_voucher_rounds",
  );
  assert.equal(String(voucherRound.rows[0]?.round_id), "7");
  assert.equal(voucherRound.rows[0]?.content_id, expected.roundTerms.contentId);
  assert.equal(
    new Date(String(voucherRound.rows[0]?.voucher_deadline)).toISOString(),
    new Date(Number(expected.roundTerms.commitDeadline) * 1_000).toISOString(),
  );
  const storedAsk = await dbClient.execute({
    sql: "SELECT idempotency_key, request_json FROM tokenless_agent_asks WHERE operation_key = ?",
    args: [operationKey],
  });
  const resumedAsk = await createTokenlessAsk(
    JSON.parse(String(storedAsk.rows[0]?.request_json)),
    String(storedAsk.rows[0]?.idempotency_key),
    "https://tokenless.example",
  );
  assert.equal(resumedAsk.responseWindowSeconds, 7_200);
  assert.equal(resumedAsk.commitDeadline, new Date(Number(expected.roundTerms.commitDeadline) * 1_000).toISOString());
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

test("receipt reconciliation rejects an altered admission policy hash", async () => {
  const operationKey = await walletAsk();
  const runtime = mockRuntime();
  const expected = await prepareChainPayment(operationKey, { config: config(), runtime });
  const altered = {
    ...expected,
    roundTerms: { ...expected.roundTerms, admissionPolicyHash: `0x${"99".repeat(32)}` as Hex },
  };
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

test("x402 used authorizations reconcile exact receipts or stop as possibly paid without retry", async () => {
  const { workspaceId } = await createWorkspace({ name: "x402 team", ownerAddress: FUNDER });
  const now = new Date();
  await dbClient.execute({
    sql: `UPDATE tokenless_workspace_subscriptions
          SET plan_key = 'early_access', price_version = 'early_access_usd_99_2026_07',
              provider_status = 'active', current_period_start = ?, current_period_end = ?, updated_at = ?
          WHERE workspace_id = ?`,
    args: [new Date(now.getTime() - 60_000), new Date(now.getTime() + 86_400_000), now, workspaceId],
  });
  const quote = await createTokenlessQuote({
    audience: {
      admissionPolicyHash: freezeAdmissionPolicy(admissionPolicy()).admissionPolicyHash,
      source: "rateloop_network",
    },
    budget: { attemptReserveAtomic: "20000000", bountyAtomic: "25000000", feeBps: 750 },
    question: { kind: "binary" as const, prompt: "Fund this?", rationale: { mode: "optional" as const } },
    requestedPanelSize: 15,
    responseWindowSeconds: 5_400,
  });
  const request = {
    idempotencyKey: "chain:x402:12345678",
    payment: { mode: "x402" as const, payerAddress: FUNDER },
    quoteId: quote.quoteId,
  };
  const principal = { kind: "session" as const, accountAddress: FUNDER, walletAddress: FUNDER };
  const product = await prepareProductAsk({ principal, request });
  assert.equal(product.paymentState, "pending_chain_authorization");
  const ask = await createTokenlessAsk(request, request.idempotencyKey, "https://tokenless.example");
  await attachProductAsk(product, ask);
  await freezeAskAdmissionPolicy(ask.operationKey);
  await dbClient.execute("UPDATE tokenless_content_records SET moderation_status = 'approved'");
  await dbClient.execute("UPDATE tokenless_question_records SET moderation_status = 'approved'");
  const runtime = mockRuntime();
  const prepared = await prepareChainPayment(ask.operationKey, { config: config(), runtime });
  assert.equal(prepared.paymentState, "awaiting_authorization");
  assert.equal(prepared.authorizationSpec?.schemaVersion, "rateloop.tokenless.payment-authorization.v1");
  assert.equal(prepared.authorizationSpec?.eip3009Domain.verifyingContract, USDC);
  assert.equal(prepared.authorizationSpec?.roundAuthorizationDomain.verifyingContract, ADAPTER);
  assert.equal(prepared.authorizationSpec?.eip3009Domain.version, "2");
  assert.equal(
    (await reconcileChainPayment(ask.operationKey, { config: config(), runtime }))?.paymentState,
    "awaiting_authorization",
  );
  assert.ok(prepared.authorizationSpec);
  const authorization = {
    validAfter: prepared.authorizationSpec.validAfter,
    validBefore: prepared.authorizationSpec.validBefore,
    nonce: prepared.authorizationSpec.nonce,
    v: 27,
    r: `0x${"55".repeat(32)}`,
    s: `0x${"66".repeat(32)}`,
    roundAuthorizationSignature: `0x${"77".repeat(65)}`,
  } as const;
  await assert.rejects(
    () => attachX402Authorization(ask.operationKey, { ...authorization, nonce: `0x${"44".repeat(32)}` }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "payment_conflict",
  );
  await attachX402Authorization(ask.operationKey, authorization);
  assert.equal((await getChainPaymentInstructions(ask.operationKey)).paymentState, "prepared");
  const replay = await prepareProductAsk({ principal, request });
  assert.equal(replay.paymentReference, product.paymentReference);
  assert.equal(replay.createdPayment, false);

  const transactionHash = `0x${"99".repeat(32)}` as Hash;
  const adapterInput = encodeFunctionData({
    abi: X402PanelSubmitterAbi,
    functionName: "createRoundWithAuthorization",
    args: [
      prepared.funderAddress,
      __chainPaymentTestUtils.toOnchainTerms(prepared.roundTerms),
      {
        validAfter: BigInt(authorization.validAfter),
        validBefore: BigInt(authorization.validBefore),
        nonce: authorization.nonce,
        v: authorization.v,
        r: authorization.r,
        s: authorization.s,
      },
      authorization.roundAuthorizationSignature,
    ],
  });
  const reconciledRuntime = mockRuntime(
    {
      getLogs: async ({ address }: { address: Address }) => (address === USDC ? [] : [{ transactionHash }]),
      getTransaction: async () => ({ input: adapterInput, to: ADAPTER }),
      getTransactionReceipt: async () => ({
        blockHash: BLOCK_HASH,
        blockNumber: 200n,
        logs: [roundCreatedLog(prepared)],
        status: "success" as const,
      }),
    },
    prepared,
    true,
  );
  const usage = await __chainPaymentTestUtils.inspectX402AuthorizationUsage({
    authorization: __chainPaymentTestUtils.persistedX402Authorization(authorization, prepared),
    config: config(),
    expected: prepared,
    runtime: reconciledRuntime,
  });
  assert.deepEqual(usage, {
    status: "reconciled",
    transactionHash,
    roundId: 7n,
    blockNumber: 200n,
    blockHash: BLOCK_HASH,
  });

  const wrongNonceInput = encodeFunctionData({
    abi: X402PanelSubmitterAbi,
    functionName: "createRoundWithAuthorization",
    args: [
      prepared.funderAddress,
      __chainPaymentTestUtils.toOnchainTerms(prepared.roundTerms),
      {
        validAfter: BigInt(authorization.validAfter),
        validBefore: BigInt(authorization.validBefore),
        nonce: `0x${"44".repeat(32)}`,
        v: authorization.v,
        r: authorization.r,
        s: authorization.s,
      },
      authorization.roundAuthorizationSignature,
    ],
  });
  const unresolvedRuntime = mockRuntime(
    {
      getLogs: async ({ address }: { address: Address }) => (address === USDC ? [] : [{ transactionHash }]),
      getTransaction: async () => ({ input: wrongNonceInput, to: ADAPTER }),
      getTransactionReceipt: async () => ({
        blockHash: BLOCK_HASH,
        blockNumber: 200n,
        logs: [roundCreatedLog(prepared)],
        status: "success" as const,
      }),
    },
    prepared,
    true,
  );
  await assert.rejects(
    () => executeServerChainPayment(ask.operationKey, { config: config(), runtime: unresolvedRuntime }),
    (error: unknown) =>
      error instanceof TokenlessServiceError &&
      error.code === "x402_authorization_used_reconciliation_required" &&
      error.retryable === false,
  );
  const stopped = await dbClient.execute({
    sql: `SELECT e.state, e.failure_code, e.claim_owner, e.claim_fencing_token,
                 p.state AS intent_state, o.payment_state
          FROM tokenless_chain_executions e
          JOIN tokenless_payment_intents p ON p.payment_intent_id = e.payment_reference
          JOIN tokenless_ask_ownership o ON o.operation_key = e.operation_key
          WHERE e.operation_key = ?`,
    args: [ask.operationKey],
  });
  assert.deepEqual(stopped.rows[0], {
    state: "authorization_reconciliation_required",
    failure_code: "x402_authorization_used_reconciliation_required",
    claim_owner: null,
    claim_fencing_token: 1,
    intent_state: "possibly_paid",
    payment_state: "possibly_paid",
  });
  await assert.rejects(
    () => executeServerChainPayment(ask.operationKey, { config: config(), runtime: unresolvedRuntime }),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.code === "x402_authorization_used_reconciliation_required",
  );
  await assert.rejects(
    () => attachX402Authorization(ask.operationKey, authorization),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.code === "x402_authorization_used_reconciliation_required",
  );
  const stillStopped = await dbClient.execute({
    sql: "SELECT state, claim_fencing_token FROM tokenless_chain_executions WHERE operation_key = ?",
    args: [ask.operationKey],
  });
  assert.deepEqual(stillStopped.rows[0], {
    state: "authorization_reconciliation_required",
    claim_fencing_token: 1,
  });
});

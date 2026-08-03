import {
  TOKENLESS_DEFAULT_REVEAL_WINDOW_SECONDS,
  TOKENLESS_MINIMUM_BEACON_FAILURE_GRACE_SECONDS,
  TOKENLESS_MINIMUM_REVEAL_WINDOW_SECONDS,
  TOKENLESS_QUICKNET_T_CHAIN_HASH,
  TOKENLESS_SCORING_BEACON_SAFETY_MARGIN_SECONDS,
  type TokenlessChainConfig,
  buildTokenlessDeploymentKey,
  loadTokenlessChainConfig,
} from "./config";
import {
  __chainPaymentTestUtils,
  attachX402Authorization,
  confirmWalletChainPayment,
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
import { derivePaidLaneActivationReference } from "~~/lib/tokenless/paidLaneActivation";
import { attachProductAsk, createWorkspace, prepareProductAsk } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError, createTokenlessAsk, createTokenlessQuote } from "~~/lib/tokenless/server";
import { verifyBusinessWorkspaceForTest } from "~~/test/helpers/verifiedBusinessWorkspace";

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
const PAID_LANE_ENV_NAMES = [
  "TOKENLESS_PRIVATE_PAID_REVIEWS_ENABLED",
  "TOKENLESS_NETWORK_PANELS_ENABLED",
  "TOKENLESS_HYBRID_REVIEWS_ENABLED",
  "NEXT_PUBLIC_TOKENLESS_PRIVATE_PAID_REVIEWS_ENABLED",
  "NEXT_PUBLIC_TOKENLESS_NETWORK_PANELS_ENABLED",
  "NEXT_PUBLIC_TOKENLESS_HYBRID_REVIEWS_ENABLED",
  "TOKENLESS_PAID_LANES_DPIA_APPROVAL_REFERENCE",
  "TOKENLESS_PAID_LANES_TRANSFER_INVENTORY_APPROVAL_REFERENCE",
  "TOKENLESS_PAID_LANES_FUNDING_VALIDATION_REFERENCE",
  "TOKENLESS_INVITED_PAID_ADULTHOOD_APPROVAL_REFERENCE",
  "TOKENLESS_PAID_LANES_COMPLIANCE_APPROVED_AT",
  "NEXT_PUBLIC_TOKENLESS_PAID_LANES_ACTIVATION_REFERENCE",
  "WORLD_ID_APP_ID",
  "WORLD_ID_RP_ID",
  "WORLD_ID_ENVIRONMENT",
] as const;
const originalPaidLaneEnv = new Map(PAID_LANE_ENV_NAMES.map(name => [name, process.env[name]]));

function activatePrivatePaidLane() {
  Object.assign(process.env, {
    TOKENLESS_PRIVATE_PAID_REVIEWS_ENABLED: "true",
    TOKENLESS_NETWORK_PANELS_ENABLED: "false",
    TOKENLESS_HYBRID_REVIEWS_ENABLED: "false",
    NEXT_PUBLIC_TOKENLESS_PRIVATE_PAID_REVIEWS_ENABLED: "true",
    NEXT_PUBLIC_TOKENLESS_NETWORK_PANELS_ENABLED: "false",
    NEXT_PUBLIC_TOKENLESS_HYBRID_REVIEWS_ENABLED: "false",
    TOKENLESS_PAID_LANES_DPIA_APPROVAL_REFERENCE: `sha256:${"a".repeat(64)}`,
    TOKENLESS_PAID_LANES_TRANSFER_INVENTORY_APPROVAL_REFERENCE: `sha256:${"b".repeat(64)}`,
    TOKENLESS_PAID_LANES_FUNDING_VALIDATION_REFERENCE: `sha256:${"c".repeat(64)}`,
    TOKENLESS_INVITED_PAID_ADULTHOOD_APPROVAL_REFERENCE: `sha256:${"d".repeat(64)}`,
    TOKENLESS_PAID_LANES_COMPLIANCE_APPROVED_AT: "2026-07-01T00:00:00.000Z",
    WORLD_ID_APP_ID: "app_ratelooptest",
    WORLD_ID_RP_ID: "rp_ratelooptest",
    WORLD_ID_ENVIRONMENT: "production",
  });
  process.env.NEXT_PUBLIC_TOKENLESS_PAID_LANES_ACTIVATION_REFERENCE = derivePaidLaneActivationReference(process.env);
}

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
    revealWindowSeconds: TOKENLESS_MINIMUM_REVEAL_WINDOW_SECONDS,
    beaconFailureGraceSeconds: TOKENLESS_MINIMUM_BEACON_FAILURE_GRACE_SECONDS,
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
      if (address === PANEL && functionName === "QUICKNET_T_NETWORK_HASH") return TOKENLESS_QUICKNET_T_CHAIN_HASH;
      if (address === PANEL && functionName === "QUICKNET_T_GENESIS") return 1_689_232_296;
      if (address === PANEL && functionName === "QUICKNET_T_PERIOD") return 3;
      if (address === PANEL && functionName === "MIN_BEACON_GRACE") return 21_600;
      if (address === PANEL && functionName === "SCORING_BEACON_SAFETY_MARGIN") return 86_400;
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
          scoringBeaconRound: terms.scoringBeaconRound,
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
  activatePrivatePaidLane();
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
  for (const name of PAID_LANE_ENV_NAMES) {
    const value = originalPaidLaneEnv.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test("deployment config binds the complete bundle and forbids credential key reuse", () => {
  const key = `0x${"11".repeat(32)}` as Hex;
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
    TOKENLESS_X402_RELAYER_EXPECTED_ADDRESS: privateKeyToAccount(key).address,
    TOKENLESS_X402_RELAYER_KEY_VERSION: "test-v1",
  } as unknown as NodeJS.ProcessEnv;
  assert.throws(() => loadTokenlessChainConfig(env), /must never reuse the credential issuer signer/);
  assert.throws(
    () =>
      loadTokenlessChainConfig({
        ...env,
        TOKENLESS_X402_RELAYER_PRIVATE_KEY: `0x${"22".repeat(32)}`,
        TOKENLESS_X402_RELAYER_EXPECTED_ADDRESS: privateKeyToAccount(`0x${"22".repeat(32)}`).address,
        TOKENLESS_PREPAID_FUNDER_PRIVATE_KEY: `0x${"33".repeat(32)}`,
        TOKENLESS_PREPAID_FUNDER_EXPECTED_ADDRESS: privateKeyToAccount(`0x${"33".repeat(32)}`).address,
        TOKENLESS_PREPAID_FUNDER_KEY_VERSION: "test-v1",
        TOKENLESS_SURPRISE_BONUS_FUNDER_PRIVATE_KEY: `0x${"33".repeat(32)}`,
        TOKENLESS_SURPRISE_BONUS_FUNDER_EXPECTED_ADDRESS: privateKeyToAccount(`0x${"33".repeat(32)}`).address,
        TOKENLESS_SURPRISE_BONUS_FUNDER_KEY_VERSION: "test-v1",
      }),
    /must use distinct keys/,
  );
  assert.throws(
    () =>
      loadTokenlessChainConfig({
        ...env,
        TOKENLESS_X402_RELAYER_PRIVATE_KEY: undefined,
        TOKENLESS_X402_RELAYER_EXPECTED_ADDRESS: undefined,
        TOKENLESS_X402_RELAYER_KEY_VERSION: undefined,
        TOKENLESS_DEPLOYMENT_KEY: "wrong",
      }),
    /does not match the complete configured tokenless contract bundle/,
  );
  assert.throws(
    () =>
      loadTokenlessChainConfig({
        ...env,
        TOKENLESS_X402_RELAYER_PRIVATE_KEY: undefined,
        TOKENLESS_X402_RELAYER_EXPECTED_ADDRESS: undefined,
        TOKENLESS_X402_RELAYER_KEY_VERSION: undefined,
        TOKENLESS_DEPLOYMENT_SCHEMA: "rateloop-tokenless-deployment-v2",
      }),
    /must be rateloop-tokenless-deployment-v4/,
  );
});

test("deployment config defaults to and enforces the contract beacon-failure grace floor", () => {
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
  } as unknown as NodeJS.ProcessEnv;

  assert.equal(loadTokenlessChainConfig(env).beaconFailureGraceSeconds, 21_600);
  assert.throws(
    () =>
      loadTokenlessChainConfig({
        ...env,
        TOKENLESS_BEACON_FAILURE_GRACE_SECONDS: "21599",
      }),
    /must be at least 21600 seconds/,
  );
});

test("deployment config defaults to one hour while enforcing the immutable five-minute reveal floor", () => {
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
  } as unknown as NodeJS.ProcessEnv;

  assert.equal(loadTokenlessChainConfig(env).revealWindowSeconds, TOKENLESS_DEFAULT_REVEAL_WINDOW_SECONDS);
  assert.equal(
    loadTokenlessChainConfig({ ...env, TOKENLESS_REVEAL_WINDOW_SECONDS: "300" }).revealWindowSeconds,
    TOKENLESS_MINIMUM_REVEAL_WINDOW_SECONDS,
  );
  assert.throws(
    () => loadTokenlessChainConfig({ ...env, TOKENLESS_REVEAL_WINDOW_SECONDS: "299" }),
    /must be at least 300 seconds/,
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

function invitedAdmissionPolicy() {
  return {
    schemaVersion: HUMAN_ASSURANCE_SCHEMA_VERSION,
    policyId: "policy_chain_private_paid",
    version: 1,
    reviewerSource: "customer_invited" as const,
    compensation: "paid" as const,
    cohorts: [{ cohortId: "cohort_chain_private_paid", minimumReviewers: 2, maximumReviewers: 15 }],
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
      minimumAggregationSize: 2,
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

async function stripAskAdmissionPolicy(operationKey: string) {
  const source = await dbClient.execute({
    sql: `SELECT q.question_id, q.terms_json FROM tokenless_ask_ownership o
          JOIN tokenless_question_records q ON q.question_id = o.question_id
          WHERE o.operation_key = ? LIMIT 1`,
    args: [operationKey],
  });
  const row = source.rows[0];
  assert.ok(row);
  const terms = JSON.parse(String(row.terms_json)) as Record<string, unknown>;
  delete terms.audiencePolicy;
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

async function activatePaidWorkspace(workspaceId: string) {
  const now = new Date();
  await verifyBusinessWorkspaceForTest({
    accountAddress: FUNDER,
    now,
    workspaceId,
  });
  await dbClient.execute({
    sql: `UPDATE tokenless_workspace_subscriptions
          SET plan_key = 'early_access', price_version = 'early_access_usd_99_2026_07',
              provider_status = 'active', current_period_start = ?, current_period_end = ?, updated_at = ?
          WHERE workspace_id = ?`,
    args: [new Date(now.getTime() - 60_000), new Date(now.getTime() + 86_400_000), now, workspaceId],
  });
}

async function walletAsk(
  options: {
    attemptReserveAtomic?: string;
    feeBps?: number;
    stripAdmissionPolicy?: boolean;
    responseWindowSeconds?: unknown;
  } = {},
) {
  const { workspaceId } = await createWorkspace({ name: "Wallet team", ownerAddress: FUNDER });
  await activatePaidWorkspace(workspaceId);
  const policy = invitedAdmissionPolicy();
  const quote = await createTokenlessQuote({
    audience: {
      admissionPolicyHash: freezeAdmissionPolicy(policy).admissionPolicyHash,
      source: policy.reviewerSource,
    },
    audiencePolicy: policy,
    confirmedNoSensitiveData: true,
    dataClassification: "synthetic",
    budget: {
      attemptReserveAtomic: options.attemptReserveAtomic ?? "20000000",
      bountyAtomic: "25000000",
      feeBps: options.feeBps ?? 750,
    },
    question: { kind: "binary" as const, prompt: "Ship this?", rationale: { mode: "optional" as const } },
    requestedPanelSize: 15,
    responseWindowSeconds: options.responseWindowSeconds ?? 7_200,
    visibility: "public",
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
  if (options.stripAdmissionPolicy) await stripAskAdmissionPolicy(ask.operationKey);
  await dbClient.execute("UPDATE tokenless_content_records SET moderation_status = 'approved'");
  await dbClient.execute("UPDATE tokenless_question_records SET moderation_status = 'approved'");
  return { operationKey: ask.operationKey, workspaceId };
}

test("legacy tier-only asks fail closed instead of being converted into capability admission", async () => {
  const { operationKey } = await walletAsk({ stripAdmissionPolicy: true });
  await assert.rejects(
    () => prepareChainPayment(operationKey, { config: config(), runtime: mockRuntime() }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "capability_policy_required",
  );
  const executions = await dbClient.execute("SELECT COUNT(*) AS count FROM tokenless_chain_executions");
  assert.equal(Number(executions.rows[0]?.count), 0);
});

test("the explicit frozen response window creates one immutable deadline across retries", async () => {
  const { operationKey } = await walletAsk({ responseWindowSeconds: 7_200 });
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
  const commitDeadline = BigInt(first.roundTerms.commitDeadline);
  const revealDeadline = BigInt(first.roundTerms.revealDeadline);
  const expectedDisclosureRound = (commitDeadline - 1_689_232_296n) / 3n + 2n;
  const protectedScoringCutoff = revealDeadline + BigInt(TOKENLESS_SCORING_BEACON_SAFETY_MARGIN_SECONDS);
  const expectedScoringRound = (protectedScoringCutoff - 1_689_232_296n) / 3n + 2n;
  const scoringBeaconTimestamp = 1_689_232_296n + (expectedScoringRound - 1n) * 3n;
  assert.equal(first.roundTerms.beaconRound, expectedDisclosureRound.toString());
  assert.equal(first.roundTerms.scoringBeaconRound, expectedScoringRound.toString());
  assert.ok(1_689_232_296n + (expectedDisclosureRound - 1n) * 3n > commitDeadline);
  assert.ok(scoringBeaconTimestamp > protectedScoringCutoff);
  assert.ok(scoringBeaconTimestamp <= protectedScoringCutoff + 3n);
  assert.equal(first.roundTerms.beaconFailureDeadline, (scoringBeaconTimestamp + 21_600n).toString());

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
  const { operationKey } = await walletAsk();
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
  const { operationKey } = await walletAsk({ attemptReserveAtomic: "5000000" });
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
  const { operationKey } = await walletAsk({ feeBps: 0 });
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
  const { operationKey } = await walletAsk();
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

test("an invited paid round is registered with its exact owning workspace", async () => {
  const { operationKey, workspaceId } = await walletAsk();
  const runtime = mockRuntime();
  const expected = await prepareChainPayment(operationKey, { config: config(), runtime });
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

  await confirmWalletChainPayment(operationKey, TX_HASH, {
    config: config(),
    runtime: receiptRuntime,
  });

  const voucherRound = await dbClient.execute({
    sql: "SELECT workspace_id,admission_policy_json FROM tokenless_voucher_rounds WHERE round_id = '7'",
  });
  assert.equal(voucherRound.rows[0]?.workspace_id, workspaceId);
  assert.equal(JSON.parse(String(voucherRound.rows[0]?.admission_policy_json)).reviewerSource, "customer_invited");
});

test("receipt reconciliation rejects altered economics even when the panel and funder match", async () => {
  const { operationKey } = await walletAsk();
  const runtime = mockRuntime();
  const expected = await prepareChainPayment(operationKey, { config: config(), runtime });
  const altered = { ...expected, roundTerms: { ...expected.roundTerms, bountyAmount: "1" } };
  assert.throws(
    () => __chainPaymentTestUtils.exactRoundCreated({ logs: [roundCreatedLog(altered)], expected }),
    /exactly one RoundCreated event matching the quoted terms/,
  );
});

test("receipt reconciliation rejects an altered admission policy hash", async () => {
  const { operationKey } = await walletAsk();
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
  const { operationKey } = await walletAsk();
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

  const alteredScoringRound = {
    ...expected,
    roundTerms: {
      ...expected.roundTerms,
      scoringBeaconRound: (BigInt(expected.roundTerms.scoringBeaconRound) + 1n).toString(),
    },
  };
  await assert.rejects(
    () =>
      __chainPaymentTestUtils.assertCompleteRoundMatches({
        expected,
        roundId: 7n,
        runtime: mockRuntime({}, alteredScoringRound),
      }),
    /does not match the complete quoted terms/,
  );
});

test("x402 authorization inspection reconciles exact receipts and fails unresolved use closed", async () => {
  const { workspaceId } = await createWorkspace({ name: "x402 team", ownerAddress: FUNDER });
  await activatePaidWorkspace(workspaceId);
  const policy = invitedAdmissionPolicy();
  const quote = await createTokenlessQuote({
    audience: {
      admissionPolicyHash: freezeAdmissionPolicy(policy).admissionPolicyHash,
      source: "customer_invited",
    },
    audiencePolicy: policy,
    confirmedNoSensitiveData: true,
    dataClassification: "synthetic",
    budget: { attemptReserveAtomic: "20000000", bountyAtomic: "25000000", feeBps: 750 },
    question: { kind: "binary" as const, prompt: "Fund this?", rationale: { mode: "optional" as const } },
    requestedPanelSize: 15,
    responseWindowSeconds: 5_400,
    visibility: "public",
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
  assert.deepEqual(
    await __chainPaymentTestUtils.inspectX402AuthorizationUsage({
      authorization: __chainPaymentTestUtils.persistedX402Authorization(authorization, prepared),
      config: config(),
      expected: prepared,
      runtime: unresolvedRuntime,
    }),
    {
      status: "used_unresolved",
    },
  );
});

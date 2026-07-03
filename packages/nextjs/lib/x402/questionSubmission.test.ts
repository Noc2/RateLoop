import { ContentRegistryAbi, X402QuestionSubmitterAbi } from "@rateloop/contracts/abis";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import {
  type Address,
  type Hex,
  type TransactionReceipt,
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
} from "viem";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { resolveProtocolDeploymentScope } from "~~/lib/protocolDeployment";
import { CONFIDENTIALITY_FLAG_PRIVATE_FOREVER } from "~~/lib/questionSubmissionCommitment";
import { X402QuestionInputError, type X402QuestionPayload } from "~~/lib/x402/questionPayload";
import {
  X402QuestionConfigError,
  __setX402QuestionSubmissionTestOverridesForTests,
  buildPermissionlessWalletClientRequestId,
  confirmAgentWalletQuestionSubmissionRequest,
  getX402QuestionSubmissionByClientRequest,
  prepareAgentWalletQuestionSubmissionRequest,
  prepareNativeX402QuestionSubmissionRequest,
  preparePermissionlessNativeX402QuestionSubmissionRequest,
  preparePermissionlessWalletQuestionSubmissionRequest,
  x402QuestionSubmissionRecordBody,
} from "~~/lib/x402/questionSubmission";
import { PonderMetadataSyncRequiredError, ponderApi } from "~~/services/ponder/client";

const env = process.env as Record<string, string | undefined>;
const originalDatabaseUrl = env.DATABASE_URL;
const originalSyncQuestionMetadata = ponderApi.syncQuestionMetadata;
const EMPTY_BOUNTY_ELIGIBILITY_DATA_HASH = `0x${"0".repeat(64)}` as const;

function submissionRewardAssetIdForTest(asset: X402QuestionPayload["bounty"]["asset"]) {
  return asset === "LREP" ? 0 : 1;
}

function buildPayload(clientRequestId: string): X402QuestionPayload {
  return {
    bounty: {
      amount: 1_000_000n,
      asset: "USDC" as const,
      bountyEligibility: 0,
      bountyStartBy: 0n,
      bountyWindowSeconds: 1_200n,
      feedbackWindowSeconds: 1_200n,
      requiredSettledRounds: 1n,
      requiredVoters: 3n,
    },
    chainId: 8453,
    clientRequestId,
    questions: [
      {
        categoryId: 5n,
        confidentiality: {
          bond: null,
          disclosurePolicy: null,
          visibility: "public",
        },
        contextUrl: "https://example.com/context",
        detailsHash: `0x${"0".repeat(64)}` as const,
        detailsUrl: "",
        imageUrls: [] as string[],
        questionMetadataHash: `0x${"2".repeat(64)}` as const,
        resultSpecHash: `0x${"3".repeat(64)}` as const,
        tagList: ["agents"],
        tags: "agents",
        targetAudience: null,
        templateId: "generic_rating",
        templateInputs: null,
        templateVersion: 1,
        title: "Agent action approval",
        videoUrl: "",
      },
    ],
    roundConfig: {
      epochDuration: 1_200n,
      maxDuration: 1_200n,
      maxVoters: 5n,
      minVoters: 3n,
    },
  };
}

function buildPayloadWithImageUrl(clientRequestId: string, imageUrl: string): X402QuestionPayload {
  const payload = buildPayload(clientRequestId);
  const [question] = payload.questions;
  assert.ok(question);
  return {
    ...payload,
    questions: [{ ...question, imageUrls: [imageUrl] }],
  };
}

async function insertQuestionImageAttachment(params: {
  agentId?: string | null;
  id: string;
  ownerWalletAddress?: string | null;
  status: string;
}) {
  const now = new Date();
  await dbClient.execute({
    sql: `
      INSERT INTO question_image_attachments (
        id,
        uploader_kind,
        owner_wallet_address,
        agent_id,
        original_filename,
        mime_type,
        size_bytes,
        sha256,
        status,
        moderation_status,
        created_at,
        updated_at,
        approved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      params.id,
      params.agentId ? "agent" : "wallet",
      params.ownerWalletAddress ?? null,
      params.agentId ?? null,
      "mockup.webp",
      "image/webp",
      128,
      "a".repeat(64),
      params.status,
      params.status === "approved" ? "approved" : "pending",
      now,
      now,
      params.status === "approved" ? now : null,
    ],
  });
}

const TEST_CONFIG = {
  chainId: 8453,
  contentRegistryAddress: "0x0000000000000000000000000000000000000011" as const,
  contentRegistryDeploymentKey: "8453:0x0000000000000000000000000000000000000011",
  feedbackBonusEscrowAddress: "0x0000000000000000000000000000000000000012" as const,
  lrepAddress: "0x0000000000000000000000000000000000000016" as const,
  questionRewardPoolEscrowAddress: "0x0000000000000000000000000000000000000013" as const,
  rpcUrl: "http://localhost:8545",
  submissionMediaValidatorAddress: "0x0000000000000000000000000000000000000017" as const,
  targetNetwork: { id: 8453 } as never,
  usdcAddress: "0x0000000000000000000000000000000000000014" as const,
  x402QuestionSubmitterAddress: "0x0000000000000000000000000000000000000015" as const,
};

function createPlanningPublicClient() {
  return {
    readContract: async ({ functionName }: { functionName: string }) => {
      switch (functionName) {
        case "submissionMediaValidator":
          return TEST_CONFIG.submissionMediaValidatorAddress;
        case "protocolConfig":
          return "0x0000000000000000000000000000000000000018" as const;
        case "minSubmissionLrepPool":
        case "minSubmissionUsdcPool":
          return 1_000_000n;
        case "config":
          return { maxVoters: 100n };
        case "validateRoundConfig":
          return undefined;
        case "submissionKeyUsed":
          return false;
        default:
          throw new Error(`Unexpected readContract call: ${functionName}`);
      }
    },
  } as never;
}

function setDefaultTestOverrides(
  overrides: NonNullable<Parameters<typeof __setX402QuestionSubmissionTestOverridesForTests>[0]> = {},
) {
  __setX402QuestionSubmissionTestOverridesForTests({
    buildAgentWalletQuestionSubmissionPlan: async ({ payload, walletAddress }) => ({
      calls: [
        {
          data: `0x${"a".repeat(8)}` as const,
          description: "Approve escrow",
          functionName: "approve",
          id: "approve-usdc",
          phase: "approve_usdc",
          to: TEST_CONFIG.usdcAddress,
          value: "0",
        },
      ],
      chainId: payload.chainId,
      operationKey: `0x${payload.clientRequestId.padEnd(64, "0").slice(0, 64)}` as `0x${string}`,
      payment: {
        amount: payload.bounty.amount.toString(),
        asset: "USDC",
        bountyAmount: payload.bounty.amount.toString(),
        decimals: 6,
        spender: TEST_CONFIG.questionRewardPoolEscrowAddress,
        tokenAddress: TEST_CONFIG.usdcAddress,
      },
      payloadHash: `payload:${payload.clientRequestId}`,
      questionCount: payload.questions.length,
      requiresOrderedExecution: true,
      revealCommitment: `0x${"9".repeat(64)}` as const,
      roundConfig: {
        questionDurationSeconds: payload.roundConfig.maxDuration.toString(),
        maxVoters: payload.roundConfig.maxVoters.toString(),
        minVoters: payload.roundConfig.minVoters.toString(),
      },
      submissionKeys: [`0x${"2".repeat(64)}` as const],
      walletAddress,
    }),
    createPublicQuestionClient: () =>
      ({
        readContract: async () => TEST_CONFIG.submissionMediaValidatorAddress,
      }) as never,
    resolveX402QuestionConfig: () => TEST_CONFIG,
    ...overrides,
  });
}

function getExpectedContentHashes(record: { paymentReceipt: string | null }): Hex[] {
  const receipt = JSON.parse(record.paymentReceipt ?? "{}") as { expectedContentHashes?: string[] };
  const contentHashes = receipt.expectedContentHashes ?? [];
  assert.ok(contentHashes.length > 0);
  for (const contentHash of contentHashes) {
    assert.match(contentHash, /^0x[a-fA-F0-9]{64}$/);
  }
  return contentHashes as Hex[];
}

function getExpectedContentHash(record: { paymentReceipt: string | null }): Hex {
  return getExpectedContentHashes(record)[0] as Hex;
}

function buildContentSubmittedLog(params: {
  address: Address;
  contentHash?: Hex;
  contentId: bigint;
  submitter: Address;
}) {
  return {
    address: params.address,
    data: encodeAbiParameters(
      [
        { name: "contentHash", type: "bytes32" },
        { name: "url", type: "string" },
        { name: "title", type: "string" },
        { name: "tags", type: "string" },
      ],
      [params.contentHash ?? `0x${"1".repeat(64)}`, "https://example.com/context", "Question", "agents"],
    ),
    topics: encodeEventTopics({
      abi: ContentRegistryAbi,
      eventName: "ContentSubmitted",
      args: {
        categoryId: 5n,
        contentId: params.contentId,
        submitter: params.submitter,
      },
    }).filter((topic): topic is Hex => !!topic),
  };
}

function buildContentRoundConfigSetLog(params: { address: Address; contentId: bigint; payload: X402QuestionPayload }) {
  return {
    address: params.address,
    data: encodeAbiParameters(
      [
        { name: "epochDuration", type: "uint32" },
        { name: "maxDuration", type: "uint32" },
        { name: "minVoters", type: "uint16" },
        { name: "maxVoters", type: "uint16" },
      ],
      [
        Number(params.payload.roundConfig.epochDuration),
        Number(params.payload.roundConfig.maxDuration),
        Number(params.payload.roundConfig.minVoters),
        Number(params.payload.roundConfig.maxVoters),
      ],
    ),
    topics: encodeEventTopics({
      abi: ContentRegistryAbi,
      eventName: "ContentRoundConfigSet",
      args: {
        contentId: params.contentId,
      },
    }).filter((topic): topic is Hex => !!topic),
  };
}

function buildContentDetailsSubmittedLog(params: {
  address: Address;
  contentId: bigint;
  detailsHash: Hex;
  detailsUrl: string;
}) {
  return {
    address: params.address,
    data: encodeAbiParameters(
      [
        { name: "detailsUrl", type: "string" },
        { name: "detailsHash", type: "bytes32" },
      ],
      [params.detailsUrl, params.detailsHash],
    ),
    topics: encodeEventTopics({
      abi: ContentRegistryAbi,
      eventName: "ContentDetailsSubmitted",
      args: {
        contentId: params.contentId,
      },
    }).filter((topic): topic is Hex => !!topic),
  };
}

function buildSubmissionRewardPoolAttachedLog(params: {
  address: Address;
  bountyStartBy?: bigint;
  contentId: bigint;
  payload: X402QuestionPayload;
  rewardPoolId?: bigint;
  submitter: Address;
}) {
  return {
    address: params.address,
    data: encodeAbiParameters(
      [
        { name: "amount", type: "uint256" },
        { name: "requiredVoters", type: "uint256" },
        { name: "requiredSettledRounds", type: "uint256" },
        { name: "bountyStartBy", type: "uint256" },
        { name: "bountyWindowSeconds", type: "uint256" },
        { name: "feedbackWindowSeconds", type: "uint256" },
        { name: "bountyEligibility", type: "uint8" },
        { name: "bountyEligibilityDataHash", type: "bytes32" },
        { name: "rewardPoolId", type: "uint256" },
      ],
      [
        params.payload.bounty.amount,
        params.payload.bounty.requiredVoters,
        params.payload.bounty.requiredSettledRounds,
        params.bountyStartBy ?? params.payload.bounty.bountyStartBy,
        params.payload.bounty.bountyWindowSeconds,
        params.payload.bounty.feedbackWindowSeconds,
        params.payload.bounty.bountyEligibility,
        EMPTY_BOUNTY_ELIGIBILITY_DATA_HASH,
        params.rewardPoolId ?? 77n,
      ],
    ),
    topics: encodeEventTopics({
      abi: ContentRegistryAbi,
      eventName: "SubmissionRewardPoolAttached",
      args: {
        contentId: params.contentId,
        rewardAsset: submissionRewardAssetIdForTest(params.payload.bounty.asset),
        submitter: params.submitter,
      },
    }).filter((topic): topic is Hex => !!topic),
  };
}

function buildQuestionBundleSubmittedLog(params: {
  address: Address;
  bountyStartBy?: bigint;
  bundleId: bigint;
  payload: X402QuestionPayload;
  rewardPoolId?: bigint;
  submitter: Address;
}) {
  return {
    address: params.address,
    data: encodeAbiParameters(
      [
        { name: "questionCount", type: "uint256" },
        { name: "amount", type: "uint256" },
        { name: "requiredCompleters", type: "uint256" },
        { name: "bountyStartBy", type: "uint256" },
        { name: "bountyWindowSeconds", type: "uint256" },
        { name: "feedbackWindowSeconds", type: "uint256" },
        { name: "bountyEligibility", type: "uint8" },
        { name: "bountyEligibilityDataHash", type: "bytes32" },
        { name: "bundleHash", type: "bytes32" },
        { name: "rewardPoolId", type: "uint256" },
      ],
      [
        BigInt(params.payload.questions.length),
        params.payload.bounty.amount,
        params.payload.bounty.requiredVoters * params.payload.bounty.requiredSettledRounds,
        params.bountyStartBy ?? params.payload.bounty.bountyStartBy,
        params.payload.bounty.bountyWindowSeconds,
        params.payload.bounty.feedbackWindowSeconds,
        params.payload.bounty.bountyEligibility,
        EMPTY_BOUNTY_ELIGIBILITY_DATA_HASH,
        `0x${"b".repeat(64)}`,
        params.rewardPoolId ?? 77n,
      ],
    ),
    topics: encodeEventTopics({
      abi: ContentRegistryAbi,
      eventName: "QuestionBundleSubmitted",
      args: {
        bundleId: params.bundleId,
        rewardAsset: submissionRewardAssetIdForTest(params.payload.bounty.asset),
        submitter: params.submitter,
      },
    }).filter((topic): topic is Hex => !!topic),
  };
}

function buildQuestionBundleContentLinkedLog(params: {
  address: Address;
  bundleId: bigint;
  bundleIndex: bigint;
  contentId: bigint;
}) {
  return {
    address: params.address,
    data: "0x",
    topics: encodeEventTopics({
      abi: ContentRegistryAbi,
      eventName: "QuestionBundleContentLinked",
      args: {
        bundleId: params.bundleId,
        bundleIndex: params.bundleIndex,
        contentId: params.contentId,
      },
    }).filter((topic): topic is Hex => !!topic),
  };
}

function buildQuestionContentAnchoredLog(params: {
  address: Address;
  contentId: bigint;
  mediaIndex?: bigint;
  mediaType?: number;
  questionMetadataHash?: Hex;
  resultSpecHash?: Hex;
  url?: string;
}) {
  return {
    address: params.address,
    data: encodeAbiParameters(
      [
        { name: "mediaIndex", type: "uint256" },
        { name: "url", type: "string" },
        { name: "questionMetadataHash", type: "bytes32" },
        { name: "resultSpecHash", type: "bytes32" },
      ],
      [
        params.mediaIndex ?? 0n,
        params.url ?? "https://evil.example/spoof.webp",
        params.questionMetadataHash ?? (`0x${"f".repeat(64)}` as const),
        params.resultSpecHash ?? (`0x${"e".repeat(64)}` as const),
      ],
    ),
    topics: encodeEventTopics({
      abi: ContentRegistryAbi,
      eventName: "QuestionContentAnchored",
      args: {
        contentId: params.contentId,
        mediaType: params.mediaType ?? 1,
      },
    }).filter((topic): topic is Hex => !!topic),
  };
}

function buildSubmittedQuestionLogs(params: {
  address: Address;
  contentHash: Hex;
  contentId: bigint;
  payload: X402QuestionPayload;
  submitter: Address;
}) {
  return [
    buildContentSubmittedLog(params),
    buildContentRoundConfigSetLog(params),
    buildSubmissionRewardPoolAttachedLog(params),
  ];
}

function buildReceipt(hash: Hex, logs: unknown[]): TransactionReceipt {
  return {
    logs: logs as TransactionReceipt["logs"],
    status: "success",
    transactionHash: hash,
  } as TransactionReceipt;
}

before(() => {
  env.DATABASE_URL = "memory:";
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

beforeEach(async () => {
  setDefaultTestOverrides();
  ponderApi.syncQuestionMetadata = async metadata => ({
    errors: [],
    requested: metadata.length,
    skipped: 0,
    updated: metadata.length,
  });
  await dbClient.execute("DELETE FROM question_details");
  await dbClient.execute("DELETE FROM question_image_attachments");
  await dbClient.execute("DELETE FROM x402_question_submissions");
});

after(() => {
  __setX402QuestionSubmissionTestOverridesForTests(null);
  ponderApi.syncQuestionMetadata = originalSyncQuestionMetadata;
  __setDatabaseResourcesForTests(null);
  if (originalDatabaseUrl === undefined) {
    delete env.DATABASE_URL;
  } else {
    env.DATABASE_URL = originalDatabaseUrl;
  }
});

test("prepareAgentWalletQuestionSubmissionRequest stores a direct wallet plan without service fees", async () => {
  const payload = buildPayload("wallet-plan");
  const walletAddress = "0x00000000000000000000000000000000000000aa" as const;

  const prepared = await prepareAgentWalletQuestionSubmissionRequest({
    agentId: "agent-wallet",
    payload,
    walletAddress,
  });
  const body = prepared.body as {
    payment: Record<string, unknown>;
    status: string;
    transactionPlan: { calls: unknown[] };
    wallet: { address: string };
  };

  assert.equal(prepared.status, 202);
  assert.equal(body.status, "awaiting_wallet_signature");
  assert.equal(body.wallet.address, walletAddress);
  assert.equal(body.transactionPlan.calls.length, 1);
  assert.equal(body.payment.amount, payload.bounty.amount.toString());
  assert.equal("serviceFeeAmount" in body.payment, false);

  const record = await getX402QuestionSubmissionByClientRequest({
    chainId: payload.chainId,
    clientRequestId: payload.clientRequestId,
  });
  assert.equal(record?.status, "awaiting_wallet_signature");
  assert.equal(record?.payerAddress, walletAddress);
  assert.equal(record?.paymentAmount, payload.bounty.amount.toString());
});

test("prepareAgentWalletQuestionSubmissionRequest accepts large open bounty eligibility", async () => {
  const basePayload = buildPayload("wallet-plan-large-open-bounty");
  const payload = {
    ...basePayload,
    bounty: {
      ...basePayload.bounty,
      amount: 500_000_000n,
      bountyEligibility: 0,
    },
  };
  const walletAddress = "0x00000000000000000000000000000000000000aa" as const;

  const prepared = await prepareAgentWalletQuestionSubmissionRequest({
    agentId: "agent-wallet",
    payload,
    walletAddress,
  });
  const body = prepared.body as {
    bounty: { amount: string; bountyEligibility: string };
    payment: { amount: string };
    status: string;
  };

  assert.equal(prepared.status, 202);
  assert.equal(body.status, "awaiting_wallet_signature");
  assert.equal(body.bounty.amount, "500000000");
  assert.equal(body.bounty.bountyEligibility, "0");
  assert.equal(body.payment.amount, "500000000");

  const record = await getX402QuestionSubmissionByClientRequest({
    chainId: payload.chainId,
    clientRequestId: payload.clientRequestId,
  });
  assert.equal(record?.paymentAmount, "500000000");
});

test("prepareAgentWalletQuestionSubmissionRequest plans LREP bounty wallet calls", async () => {
  setDefaultTestOverrides({
    buildAgentWalletQuestionSubmissionPlan: undefined as never,
    createPublicQuestionClient: () => createPlanningPublicClient(),
  });
  const basePayload = buildPayload("wallet-plan-lrep-bounty");
  const payload = {
    ...basePayload,
    bounty: { ...basePayload.bounty, asset: "LREP" as const },
  };
  const walletAddress = "0x00000000000000000000000000000000000000aa" as const;
  const transactionHash = `0x${"8".repeat(64)}` as const;

  const prepared = await prepareAgentWalletQuestionSubmissionRequest({
    agentId: "agent-wallet",
    payload,
    walletAddress,
  });
  const body = prepared.body as {
    payment: { asset: string; tokenAddress: string };
    transactionPlan: { calls: Array<{ data: Hex; functionName: string; id: string; phase: string; to: string }> };
  };

  assert.equal(prepared.status, 202);
  assert.equal(body.payment.asset, "LREP");
  assert.equal(body.payment.tokenAddress, TEST_CONFIG.lrepAddress);
  assert.equal(body.transactionPlan.calls.length, 3);
  assert.equal(body.transactionPlan.calls[0]?.id, "reserve-submission");
  assert.equal(body.transactionPlan.calls[0]?.phase, "reserve_submission");
  assert.equal(body.transactionPlan.calls[1]?.id, "approve-lrep");
  assert.equal(body.transactionPlan.calls[1]?.phase, "approve_lrep");
  assert.equal(body.transactionPlan.calls[1]?.to, TEST_CONFIG.lrepAddress);

  const submitCall = body.transactionPlan.calls.find(
    call => call.functionName === "submitQuestionWithRewardAndRoundConfig",
  );
  assert.ok(submitCall);
  const decoded = decodeFunctionData({
    abi: ContentRegistryAbi,
    data: submitCall.data,
  });
  assert.equal(decoded.functionName, "submitQuestionWithRewardAndRoundConfig");
  const submitArgs = decoded.args as readonly unknown[];
  const rewardTerms = submitArgs[8] as { 0?: bigint | number; asset?: bigint | number };
  assert.equal(Number(rewardTerms.asset ?? rewardTerms[0]), 0);

  const record = await getX402QuestionSubmissionByClientRequest({
    chainId: payload.chainId,
    clientRequestId: payload.clientRequestId,
  });
  assert.ok(record);
  assert.equal(record.paymentAsset, TEST_CONFIG.lrepAddress);
  const receipt = JSON.parse(record?.paymentReceipt ?? "{}") as {
    expectedRewardTerms?: { asset?: string };
  };
  assert.equal(receipt.expectedRewardTerms?.asset, "0");
  const statusBody = x402QuestionSubmissionRecordBody(record) as {
    bounty: { asset: string };
    payment: { asset: string };
  };
  assert.equal(statusBody.bounty.asset, "LREP");
  assert.equal(statusBody.payment.asset, TEST_CONFIG.lrepAddress);
  const expectedContentHash = getExpectedContentHash(record);

  setDefaultTestOverrides({
    waitForSuccessfulReceipt: async (_publicClient, hash) =>
      buildReceipt(hash, [
        ...buildSubmittedQuestionLogs({
          address: TEST_CONFIG.contentRegistryAddress,
          contentHash: expectedContentHash,
          contentId: 123n,
          payload,
          submitter: walletAddress,
        }),
      ]),
  });

  const confirmed = await confirmAgentWalletQuestionSubmissionRequest({
    operationKey: record.operationKey,
    transactionHashes: [transactionHash],
  });
  const confirmedBody = confirmed.body as {
    bounty: { asset: string };
    contentId: string;
    payment: { asset: string };
    rewardPoolId: string;
    status: string;
  };

  assert.equal(confirmed.status, 200);
  assert.equal(confirmedBody.status, "submitted");
  assert.equal(confirmedBody.bounty.asset, "LREP");
  assert.equal(confirmedBody.payment.asset, TEST_CONFIG.lrepAddress);
  assert.equal(confirmedBody.contentId, "123");
  assert.equal(confirmedBody.rewardPoolId, "77");

  const repeated = await prepareAgentWalletQuestionSubmissionRequest({
    agentId: "agent-wallet",
    payload,
    walletAddress,
  });
  const repeatedBody = repeated.body as {
    bounty: { asset: string };
    payment: { asset: string };
    status: string;
  };
  assert.equal(repeated.status, 200);
  assert.equal(repeatedBody.status, "submitted");
  assert.equal(repeatedBody.bounty.asset, "LREP");
  assert.equal(repeatedBody.payment.asset, TEST_CONFIG.lrepAddress);
});

test("prepareAgentWalletQuestionSubmissionRequest stores wallet-call feedback bonus requests", async () => {
  const payload = buildPayload("wallet-plan-feedback-bonus");
  const walletAddress = "0x00000000000000000000000000000000000000aa" as const;

  const result = await prepareAgentWalletQuestionSubmissionRequest({
    agentId: "agent-wallet",
    feedbackBonus: {
      amount: 2_000_000n,
      asset: "USDC",
      awarder: walletAddress,
    },
    payload,
    walletAddress,
  });
  const body = result.body as { status: string; transactionPlan: { calls: unknown[] } };
  const record = await getX402QuestionSubmissionByClientRequest({
    chainId: payload.chainId,
    clientRequestId: payload.clientRequestId,
  });
  const receipt = JSON.parse(record?.paymentReceipt ?? "{}") as {
    feedbackBonus?: { amount: string; asset: string; status: string };
  };

  assert.equal(result.status, 202);
  assert.equal(body.status, "awaiting_wallet_signature");
  assert.equal(body.transactionPlan.calls.length, 1);
  assert.equal(receipt.feedbackBonus?.amount, "2000000");
  assert.equal(receipt.feedbackBonus?.asset, "USDC");
  assert.equal(receipt.feedbackBonus?.status, "pending_question_confirmation");
});

test("prepareAgentWalletQuestionSubmissionRequest marks gated hosted attachments before confirm", async () => {
  const walletAddress = "0x00000000000000000000000000000000000000aa" as const;
  const payload = buildPayload("wallet-prepare-gated-attachments");
  setDefaultTestOverrides({
    buildAgentWalletQuestionSubmissionPlan: undefined as never,
    createPublicQuestionClient: () =>
      ({
        readContract: async ({ functionName }: { functionName: string }) => {
          if (functionName === "protocolConfig") return "0x00000000000000000000000000000000000000bb";
          if (functionName === "minSubmissionUsdcPool") return 0n;
          if (functionName === "config") return { maxVoters: payload.roundConfig.maxVoters };
          if (functionName === "submissionKeyUsed") return false;
          return undefined;
        },
      }) as never,
  });
  const detailsId = "det_preparegateddetail";
  const detailsHash = `0x${"7".repeat(64)}` as const;
  const detailsUrl = `https://www.rateloop.ai/api/attachments/details/${detailsId}`;
  const imageId = "att_preparegatedimg1";
  const imageUrl = `https://www.rateloop.ai/api/attachments/images/${imageId}.webp#sha256=0x${"a".repeat(64)}`;
  const [question] = payload.questions;
  assert.ok(question);
  payload.questions = [
    {
      ...question,
      confidentiality: {
        bond: { amount: "0", asset: "LREP" },
        disclosurePolicy: "private_forever",
        visibility: "gated",
      },
      contextUrl: "",
      detailsHash,
      detailsUrl,
      imageUrls: [imageUrl],
    },
  ];
  const now = new Date();
  await dbClient.execute({
    sql: `
      INSERT INTO question_details (
        id,
        uploader_kind,
        owner_wallet_address,
        agent_id,
        size_bytes,
        sha256,
        normalized_text,
        status,
        moderation_status,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      detailsId,
      "agent",
      walletAddress,
      "agent-wallet",
      18,
      detailsHash.slice(2),
      "Expanded details",
      "approved",
      "approved",
      now,
      now,
    ],
  });
  await insertQuestionImageAttachment({
    agentId: "agent-wallet",
    id: imageId,
    ownerWalletAddress: walletAddress,
    status: "approved",
  });

  const response = await prepareAgentWalletQuestionSubmissionRequest({
    agentId: "agent-wallet",
    payload,
    walletAddress,
  });
  assert.equal(response.status, 202);
  const plan = response.body as {
    transactionPlan: { calls: Array<{ data: Hex; functionName: string; id: string }> };
  };
  const submitCall = plan.transactionPlan.calls.find(
    call => call.functionName === "submitQuestionWithRewardAndRoundConfig",
  );
  assert.ok(submitCall);
  const decoded = decodeFunctionData({
    abi: ContentRegistryAbi,
    data: submitCall.data,
  });
  assert.equal(decoded.functionName, "submitQuestionWithRewardAndRoundConfig");
  const submitArgs = decoded.args as readonly unknown[];
  assert.equal(submitArgs[0], "");
  assert.deepEqual(submitArgs[1], []);
  assert.equal(submitArgs[2], "");
  const submittedDetails = submitArgs[6] as { 0?: string; 1?: Hex; detailsHash?: Hex; detailsUrl?: string };
  assert.equal(submittedDetails.detailsUrl ?? submittedDetails[0], "");
  assert.equal(submittedDetails.detailsHash ?? submittedDetails[1], detailsHash);
  const submittedConfidentiality = submitArgs[11] as { 3?: number; flags?: number };
  assert.equal(
    Number(submittedConfidentiality.flags ?? submittedConfidentiality[3]),
    CONFIDENTIALITY_FLAG_PRIVATE_FOREVER,
  );

  const details = await dbClient.execute({
    sql: "SELECT requires_gated_access FROM question_details WHERE id = ?",
    args: [detailsId],
  });
  assert.equal(details.rows[0]?.requires_gated_access, true);
  const image = await dbClient.execute({
    sql: "SELECT requires_gated_access FROM question_image_attachments WHERE id = ?",
    args: [imageId],
  });
  assert.equal(image.rows[0]?.requires_gated_access, true);
});

test("confirmAgentWalletQuestionSubmissionRequest ignores spoofed submission logs", async () => {
  const payload = buildPayload("wallet-confirm-spoof");
  const walletAddress = "0x00000000000000000000000000000000000000aa" as const;
  const transactionHash = `0x${"a".repeat(64)}` as const;
  await prepareAgentWalletQuestionSubmissionRequest({
    agentId: "agent-wallet",
    payload,
    walletAddress,
  });
  const record = await getX402QuestionSubmissionByClientRequest({
    chainId: payload.chainId,
    clientRequestId: payload.clientRequestId,
  });
  assert.ok(record);
  const operationKey = record.operationKey;
  const expectedContentHash = getExpectedContentHash(record);

  setDefaultTestOverrides({
    waitForSuccessfulReceipt: async (_publicClient, hash) =>
      buildReceipt(hash, [
        buildContentSubmittedLog({
          address: "0x0000000000000000000000000000000000000999",
          contentId: 999n,
          submitter: walletAddress,
        }),
        buildQuestionContentAnchoredLog({
          address: "0x0000000000000000000000000000000000000999",
          contentId: 123n,
        }),
        ...buildSubmittedQuestionLogs({
          address: TEST_CONFIG.contentRegistryAddress,
          contentHash: expectedContentHash,
          contentId: 123n,
          payload,
          submitter: walletAddress,
        }),
      ]),
  });

  const confirmed = await confirmAgentWalletQuestionSubmissionRequest({
    operationKey,
    transactionHashes: [transactionHash],
  });
  const body = confirmed.body as { contentId: string; contentIds: string[]; status: string };

  assert.equal(confirmed.status, 200);
  assert.equal(body.status, "submitted");
  assert.equal(body.contentId, "123");
  assert.deepEqual(body.contentIds, ["123"]);
});

test("confirmAgentWalletQuestionSubmissionRequest accepts creation-anchored reward close timestamps", async () => {
  const payload = buildPayload("wallet-confirm-creation-anchored-single");
  const walletAddress = "0x00000000000000000000000000000000000000aa" as const;
  const transactionHash = `0x${"f".repeat(64)}` as const;
  await prepareAgentWalletQuestionSubmissionRequest({
    agentId: "agent-wallet",
    payload,
    walletAddress,
  });
  const record = await getX402QuestionSubmissionByClientRequest({
    chainId: payload.chainId,
    clientRequestId: payload.clientRequestId,
  });
  assert.ok(record);
  const expectedContentHash = getExpectedContentHash(record);

  setDefaultTestOverrides({
    waitForSuccessfulReceipt: async (_publicClient, hash) =>
      buildReceipt(hash, [
        buildContentSubmittedLog({
          address: TEST_CONFIG.contentRegistryAddress,
          contentHash: expectedContentHash,
          contentId: 321n,
          submitter: walletAddress,
        }),
        buildContentRoundConfigSetLog({
          address: TEST_CONFIG.contentRegistryAddress,
          contentId: 321n,
          payload,
        }),
        buildSubmissionRewardPoolAttachedLog({
          address: TEST_CONFIG.contentRegistryAddress,
          bountyStartBy: 1_782_789_200n,
          contentId: 321n,
          payload,
          rewardPoolId: 99n,
          submitter: walletAddress,
        }),
      ]),
  });

  const confirmed = await confirmAgentWalletQuestionSubmissionRequest({
    operationKey: record.operationKey,
    transactionHashes: [transactionHash],
  });
  const body = confirmed.body as { contentId: string; rewardPoolId: string; status: string };

  assert.equal(confirmed.status, 200);
  assert.equal(body.status, "submitted");
  assert.equal(body.contentId, "321");
  assert.equal(body.rewardPoolId, "99");
});

test("confirmAgentWalletQuestionSubmissionRequest confirms LREP wallet-call reward plans", async () => {
  setDefaultTestOverrides({
    buildAgentWalletQuestionSubmissionPlan: undefined as never,
    createPublicQuestionClient: () => createPlanningPublicClient(),
  });
  const basePayload = buildPayload("wallet-confirm-lrep-bounty");
  const payload = {
    ...basePayload,
    bounty: { ...basePayload.bounty, asset: "LREP" as const },
  };
  const walletAddress = "0x00000000000000000000000000000000000000aa" as const;
  const transactionHash = `0x${"c".repeat(64)}` as const;
  await prepareAgentWalletQuestionSubmissionRequest({
    agentId: "agent-wallet",
    payload,
    walletAddress,
  });
  const record = await getX402QuestionSubmissionByClientRequest({
    chainId: payload.chainId,
    clientRequestId: payload.clientRequestId,
  });
  assert.ok(record);
  const receipt = JSON.parse(record.paymentReceipt ?? "{}") as {
    expectedRewardTerms?: { asset?: string };
  };
  assert.equal(receipt.expectedRewardTerms?.asset, "0");
  const expectedContentHash = getExpectedContentHash(record);

  setDefaultTestOverrides({
    waitForSuccessfulReceipt: async (_publicClient, hash) =>
      buildReceipt(hash, [
        ...buildSubmittedQuestionLogs({
          address: TEST_CONFIG.contentRegistryAddress,
          contentHash: expectedContentHash,
          contentId: 456n,
          payload,
          submitter: walletAddress,
        }),
      ]),
  });

  const confirmed = await confirmAgentWalletQuestionSubmissionRequest({
    operationKey: record.operationKey,
    transactionHashes: [transactionHash],
  });
  const body = confirmed.body as {
    bounty: { asset: string };
    contentId: string;
    payment: { asset: string };
    rewardPoolId: string;
    status: string;
  };

  assert.equal(confirmed.status, 200);
  assert.equal(body.status, "submitted");
  assert.equal(body.contentId, "456");
  assert.equal(body.rewardPoolId, "77");
  assert.equal(body.bounty.asset, "LREP");
  assert.equal(body.payment.asset, TEST_CONFIG.lrepAddress);
});

test("confirmAgentWalletQuestionSubmissionRequest accepts creation-anchored bundle completer events", async () => {
  const payload = buildPayload("wallet-confirm-creation-anchored-bundle");
  const [firstQuestion] = payload.questions;
  assert.ok(firstQuestion);
  payload.questions = [
    firstQuestion,
    {
      ...firstQuestion,
      contextUrl: "https://example.com/second",
      title: "Second bundled question",
    },
  ];
  const walletAddress = "0x00000000000000000000000000000000000000aa" as const;
  const transactionHash = `0x${"e".repeat(64)}` as const;
  await prepareAgentWalletQuestionSubmissionRequest({
    agentId: "agent-wallet",
    payload,
    walletAddress,
  });
  const record = await getX402QuestionSubmissionByClientRequest({
    chainId: payload.chainId,
    clientRequestId: payload.clientRequestId,
  });
  assert.ok(record);
  const [firstContentHash, secondContentHash] = getExpectedContentHashes(record);
  assert.ok(firstContentHash);
  assert.ok(secondContentHash);

  setDefaultTestOverrides({
    waitForSuccessfulReceipt: async (_publicClient, hash) =>
      buildReceipt(hash, [
        buildContentSubmittedLog({
          address: TEST_CONFIG.contentRegistryAddress,
          contentHash: firstContentHash,
          contentId: 123n,
          submitter: walletAddress,
        }),
        buildContentRoundConfigSetLog({
          address: TEST_CONFIG.contentRegistryAddress,
          contentId: 123n,
          payload,
        }),
        buildContentSubmittedLog({
          address: TEST_CONFIG.contentRegistryAddress,
          contentHash: secondContentHash,
          contentId: 124n,
          submitter: walletAddress,
        }),
        buildContentRoundConfigSetLog({
          address: TEST_CONFIG.contentRegistryAddress,
          contentId: 124n,
          payload,
        }),
        buildQuestionBundleContentLinkedLog({
          address: TEST_CONFIG.contentRegistryAddress,
          bundleId: 55n,
          bundleIndex: 1n,
          contentId: 124n,
        }),
        buildQuestionBundleContentLinkedLog({
          address: TEST_CONFIG.contentRegistryAddress,
          bundleId: 55n,
          bundleIndex: 0n,
          contentId: 123n,
        }),
        buildQuestionBundleSubmittedLog({
          address: TEST_CONFIG.contentRegistryAddress,
          bountyStartBy: 1_782_789_200n,
          bundleId: 55n,
          payload,
          rewardPoolId: 88n,
          submitter: walletAddress,
        }),
      ]),
  });

  const confirmed = await confirmAgentWalletQuestionSubmissionRequest({
    operationKey: record.operationKey,
    transactionHashes: [transactionHash],
  });
  const body = confirmed.body as { bundleId: string; contentId: string; contentIds: string[]; rewardPoolId: string };

  assert.equal(confirmed.status, 200);
  assert.equal(body.bundleId, "55");
  assert.equal(body.contentId, "123");
  assert.deepEqual(body.contentIds, ["123", "124"]);
  assert.equal(body.rewardPoolId, "88");
});

test("confirmAgentWalletQuestionSubmissionRequest rejects swapped bundle content links", async () => {
  const payload = buildPayload("wallet-confirm-swapped-bundle-links");
  const [firstQuestion] = payload.questions;
  assert.ok(firstQuestion);
  payload.questions = [
    firstQuestion,
    {
      ...firstQuestion,
      contextUrl: "https://example.com/swapped-second",
      title: "Second bundled question",
    },
  ];
  const walletAddress = "0x00000000000000000000000000000000000000aa" as const;
  const transactionHash = `0x${"9".repeat(64)}` as const;
  await prepareAgentWalletQuestionSubmissionRequest({
    agentId: "agent-wallet",
    payload,
    walletAddress,
  });
  const record = await getX402QuestionSubmissionByClientRequest({
    chainId: payload.chainId,
    clientRequestId: payload.clientRequestId,
  });
  assert.ok(record);
  const [firstContentHash, secondContentHash] = getExpectedContentHashes(record);
  assert.ok(firstContentHash);
  assert.ok(secondContentHash);

  setDefaultTestOverrides({
    waitForSuccessfulReceipt: async (_publicClient, hash) =>
      buildReceipt(hash, [
        buildContentSubmittedLog({
          address: TEST_CONFIG.contentRegistryAddress,
          contentHash: firstContentHash,
          contentId: 123n,
          submitter: walletAddress,
        }),
        buildContentRoundConfigSetLog({
          address: TEST_CONFIG.contentRegistryAddress,
          contentId: 123n,
          payload,
        }),
        buildContentSubmittedLog({
          address: TEST_CONFIG.contentRegistryAddress,
          contentHash: secondContentHash,
          contentId: 124n,
          submitter: walletAddress,
        }),
        buildContentRoundConfigSetLog({
          address: TEST_CONFIG.contentRegistryAddress,
          contentId: 124n,
          payload,
        }),
        buildQuestionBundleContentLinkedLog({
          address: TEST_CONFIG.contentRegistryAddress,
          bundleId: 55n,
          bundleIndex: 0n,
          contentId: 124n,
        }),
        buildQuestionBundleContentLinkedLog({
          address: TEST_CONFIG.contentRegistryAddress,
          bundleId: 55n,
          bundleIndex: 1n,
          contentId: 123n,
        }),
        buildQuestionBundleSubmittedLog({
          address: TEST_CONFIG.contentRegistryAddress,
          bundleId: 55n,
          payload,
          rewardPoolId: 88n,
          submitter: walletAddress,
        }),
      ]),
  });

  await assert.rejects(
    () =>
      confirmAgentWalletQuestionSubmissionRequest({
        operationKey: record.operationKey,
        transactionHashes: [transactionHash],
      }),
    /Confirmed bundle content linkage did not match the planned question order/,
  );
});

test("confirmAgentWalletQuestionSubmissionRequest attaches approved question details and image rows", async () => {
  const payload = buildPayload("wallet-confirm-details");
  const walletAddress = "0x00000000000000000000000000000000000000aa" as const;
  const transactionHash = `0x${"d".repeat(64)}` as const;
  const detailsId = "det_x402attachdetail";
  const detailsHash = `0x${"8".repeat(64)}` as const;
  const detailsUrl = `https://www.rateloop.ai/api/attachments/details/${detailsId}`;
  const imageId = "att_x402attachimage1";
  const imageUrl = `https://www.rateloop.ai/api/attachments/images/${imageId}.webp#sha256=0x${"a".repeat(64)}`;
  const [question] = payload.questions;
  assert.ok(question);
  payload.questions = [
    {
      ...question,
      detailsHash,
      detailsUrl,
      imageUrls: [imageUrl],
    },
  ];
  const now = new Date();
  await dbClient.execute({
    sql: `
      INSERT INTO question_details (
        id,
        uploader_kind,
        owner_wallet_address,
        agent_id,
        size_bytes,
        sha256,
        normalized_text,
        status,
        moderation_status,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      detailsId,
      "agent",
      walletAddress,
      "agent-wallet",
      18,
      detailsHash.slice(2),
      "Expanded details",
      "approved",
      "approved",
      now,
      now,
    ],
  });
  await insertQuestionImageAttachment({
    agentId: "agent-wallet",
    id: imageId,
    ownerWalletAddress: walletAddress,
    status: "approved",
  });
  await prepareAgentWalletQuestionSubmissionRequest({
    agentId: "agent-wallet",
    payload,
    walletAddress,
  });
  const record = await getX402QuestionSubmissionByClientRequest({
    chainId: payload.chainId,
    clientRequestId: payload.clientRequestId,
  });
  assert.ok(record);
  const expectedContentHash = getExpectedContentHash(record);

  setDefaultTestOverrides({
    waitForSuccessfulReceipt: async (_publicClient, hash) =>
      buildReceipt(hash, [
        ...buildSubmittedQuestionLogs({
          address: TEST_CONFIG.contentRegistryAddress,
          contentHash: expectedContentHash,
          contentId: 123n,
          payload,
          submitter: walletAddress,
        }),
        buildQuestionContentAnchoredLog({
          address: TEST_CONFIG.submissionMediaValidatorAddress,
          contentId: 123n,
          url: imageUrl,
        }),
        buildContentDetailsSubmittedLog({
          address: TEST_CONFIG.contentRegistryAddress,
          contentId: 123n,
          detailsHash,
          detailsUrl,
        }),
      ]),
  });

  const protocolDeployment = resolveProtocolDeploymentScope(payload.chainId);
  assert.ok(protocolDeployment);
  const originalSyncQuestionMetadata = ponderApi.syncQuestionMetadata;
  const syncCalls: Parameters<typeof ponderApi.syncQuestionMetadata>[] = [];
  ponderApi.syncQuestionMetadata = async (...args) => {
    syncCalls.push(args);
    return { errors: [], requested: 1, skipped: 0, updated: 1 };
  };

  try {
    await confirmAgentWalletQuestionSubmissionRequest({
      operationKey: record.operationKey,
      transactionHashes: [transactionHash],
    });
  } finally {
    ponderApi.syncQuestionMetadata = originalSyncQuestionMetadata;
  }

  const result = await dbClient.execute({
    sql: "SELECT content_id FROM question_details WHERE id = ?",
    args: [detailsId],
  });
  assert.equal(result.rows[0]?.content_id, "123");
  const imageResult = await dbClient.execute({
    sql: "SELECT content_id FROM question_image_attachments WHERE id = ?",
    args: [imageId],
  });
  assert.equal(imageResult.rows[0]?.content_id, "123");
  assert.equal(syncCalls.length, 1);
  assert.equal(syncCalls[0]?.[1]?.deploymentKey, protocolDeployment.deploymentKey);
});

test("confirmAgentWalletQuestionSubmissionRequest fails when production metadata sync auth is misconfigured", async () => {
  const payload = buildPayload("native-x402-confirm-metadata-sync-required");
  const walletAddress = "0x00000000000000000000000000000000000000aa" as const;
  const transactionHash = `0x${"7".repeat(64)}` as const;
  await prepareAgentWalletQuestionSubmissionRequest({
    agentId: "agent-wallet",
    payload,
    walletAddress,
  });
  const record = await getX402QuestionSubmissionByClientRequest({
    chainId: payload.chainId,
    clientRequestId: payload.clientRequestId,
  });
  assert.ok(record);
  const expectedContentHash = getExpectedContentHash(record);

  setDefaultTestOverrides({
    waitForSuccessfulReceipt: async (_publicClient, hash) =>
      buildReceipt(hash, [
        ...buildSubmittedQuestionLogs({
          address: TEST_CONFIG.contentRegistryAddress,
          contentHash: expectedContentHash,
          contentId: 123n,
          payload,
          submitter: walletAddress,
        }),
      ]),
  });

  const originalSyncQuestionMetadata = ponderApi.syncQuestionMetadata;
  ponderApi.syncQuestionMetadata = async () => {
    throw new PonderMetadataSyncRequiredError("metadata sync token required");
  };

  try {
    await assert.rejects(
      () =>
        confirmAgentWalletQuestionSubmissionRequest({
          operationKey: record.operationKey,
          transactionHashes: [transactionHash],
        }),
      (error: unknown) =>
        error instanceof X402QuestionConfigError && /metadata sync token required/.test(error.message),
    );
  } finally {
    ponderApi.syncQuestionMetadata = originalSyncQuestionMetadata;
  }
});

test("confirmAgentWalletQuestionSubmissionRequest stays retryable when Ponder skips metadata", async () => {
  const payload = buildPayload("native-x402-confirm-metadata-sync-skipped");
  const walletAddress = "0x00000000000000000000000000000000000000aa" as const;
  const transactionHash = `0x${"7".repeat(64)}` as const;
  await prepareAgentWalletQuestionSubmissionRequest({
    agentId: "agent-wallet",
    payload,
    walletAddress,
  });
  const record = await getX402QuestionSubmissionByClientRequest({
    chainId: payload.chainId,
    clientRequestId: payload.clientRequestId,
  });
  assert.ok(record);
  const expectedContentHash = getExpectedContentHash(record);

  setDefaultTestOverrides({
    waitForSuccessfulReceipt: async (_publicClient, hash) =>
      buildReceipt(hash, [
        ...buildSubmittedQuestionLogs({
          address: TEST_CONFIG.contentRegistryAddress,
          contentHash: expectedContentHash,
          contentId: 123n,
          payload,
          submitter: walletAddress,
        }),
      ]),
  });

  const originalSyncQuestionMetadata = ponderApi.syncQuestionMetadata;
  ponderApi.syncQuestionMetadata = async () => ({ errors: [], requested: 1, skipped: 1, updated: 0 });

  try {
    await assert.rejects(
      () =>
        confirmAgentWalletQuestionSubmissionRequest({
          operationKey: record.operationKey,
          transactionHashes: [transactionHash],
        }),
      (error: unknown) =>
        error instanceof X402QuestionConfigError &&
        /Question metadata sync to Ponder did not complete/.test(error.message),
    );
  } finally {
    ponderApi.syncQuestionMetadata = originalSyncQuestionMetadata;
  }

  const retryableRecord = await getX402QuestionSubmissionByClientRequest({
    chainId: payload.chainId,
    clientRequestId: payload.clientRequestId,
  });
  assert.equal(retryableRecord?.status, "awaiting_wallet_signature");
});

test("confirmAgentWalletQuestionSubmissionRequest links gated native x402 attachments from stored receipt", async () => {
  const payload = buildPayload("native-x402-confirm-gated-attachments");
  const walletAddress = "0x00000000000000000000000000000000000000aa" as const;
  const transactionHash = `0x${"7".repeat(64)}` as const;
  const detailsId = "det_nativex402gated1";
  const detailsHash = `0x${"6".repeat(64)}` as const;
  const detailsUrl = `https://www.rateloop.ai/api/attachments/details/${detailsId}`;
  const imageId = "att_nativex402gated1";
  const imageUrl = `https://www.rateloop.ai/api/attachments/images/${imageId}.webp#sha256=0x${"a".repeat(64)}`;
  const [question] = payload.questions;
  assert.ok(question);
  payload.questions = [
    {
      ...question,
      confidentiality: {
        bond: { amount: "0", asset: "LREP" },
        disclosurePolicy: "private_forever",
        visibility: "gated",
      },
      contextUrl: "",
      detailsHash,
      detailsUrl,
      imageUrls: [imageUrl],
    },
  ];
  const now = new Date();
  await dbClient.execute({
    sql: `
      INSERT INTO question_details (
        id,
        uploader_kind,
        owner_wallet_address,
        agent_id,
        size_bytes,
        sha256,
        normalized_text,
        status,
        moderation_status,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      detailsId,
      "agent",
      walletAddress,
      "native-agent",
      18,
      detailsHash.slice(2),
      "Expanded native details",
      "approved",
      "approved",
      now,
      now,
    ],
  });
  await insertQuestionImageAttachment({
    agentId: "native-agent",
    id: imageId,
    ownerWalletAddress: walletAddress,
    status: "approved",
  });

  setDefaultTestOverrides({
    buildNativeX402QuestionSubmissionPlan: async ({ paymentAuthorization, payload, walletAddress }) => ({
      authorization: {
        from: walletAddress,
        nonce: `0x${"4".repeat(64)}` as const,
        signature:
          paymentAuthorization && typeof paymentAuthorization.signature === "string"
            ? (paymentAuthorization.signature as `0x${string}`)
            : undefined,
        to: TEST_CONFIG.x402QuestionSubmitterAddress,
        validAfter: "0",
        validBefore: "1762000000",
        value: payload.bounty.amount.toString(),
      },
      calls: [
        {
          data: `0x${"b".repeat(8)}` as const,
          description: "Submit x402 question",
          functionName: "submitQuestionWithX402Payment",
          id: "submit-x402-question",
          phase: "submit_x402_question",
          to: TEST_CONFIG.x402QuestionSubmitterAddress,
          value: "0",
        },
      ],
      chainId: payload.chainId,
      operationKey: `0x${payload.clientRequestId.padEnd(64, "0").slice(0, 64)}` as `0x${string}`,
      payment: {
        amount: payload.bounty.amount.toString(),
        asset: "USDC",
        bountyAmount: payload.bounty.amount.toString(),
        decimals: 6,
        spender: TEST_CONFIG.x402QuestionSubmitterAddress,
        tokenAddress: TEST_CONFIG.usdcAddress,
      },
      payloadHash: `payload:${payload.clientRequestId}`,
      questionCount: payload.questions.length,
      requiresOrderedExecution: true,
      revealCommitment: `0x${"9".repeat(64)}` as const,
      roundConfig: {
        questionDurationSeconds: payload.roundConfig.maxDuration.toString(),
        maxVoters: payload.roundConfig.maxVoters.toString(),
        minVoters: payload.roundConfig.minVoters.toString(),
      },
      submissionKey: `0x${"2".repeat(64)}` as const,
      walletAddress,
    }),
  });

  await prepareNativeX402QuestionSubmissionRequest({
    agentId: "native-agent",
    paymentAuthorization: { signature: `0x${"5".repeat(130)}` },
    payload,
    walletAddress,
  });
  const record = await getX402QuestionSubmissionByClientRequest({
    chainId: payload.chainId,
    clientRequestId: payload.clientRequestId,
  });
  assert.ok(record);
  const storedReceipt = JSON.parse(record.paymentReceipt ?? "{}") as {
    questionAttachments?: Array<{ detailsUrl?: string; imageUrls?: string[] }>;
  };
  assert.equal(storedReceipt.questionAttachments?.[0]?.detailsUrl, detailsUrl);
  assert.deepEqual(storedReceipt.questionAttachments?.[0]?.imageUrls, [imageUrl]);
  const expectedContentHash = getExpectedContentHash(record);

  setDefaultTestOverrides({
    waitForSuccessfulReceipt: async (_publicClient, hash) =>
      buildReceipt(hash, [
        ...buildSubmittedQuestionLogs({
          address: TEST_CONFIG.contentRegistryAddress,
          contentHash: expectedContentHash,
          contentId: 123n,
          payload,
          submitter: walletAddress,
        }),
      ]),
  });

  await confirmAgentWalletQuestionSubmissionRequest({
    operationKey: record.operationKey,
    transactionHashes: [transactionHash],
  });

  const result = await dbClient.execute({
    sql: "SELECT content_id FROM question_details WHERE id = ?",
    args: [detailsId],
  });
  assert.equal(result.rows[0]?.content_id, "123");
  const imageResult = await dbClient.execute({
    sql: "SELECT content_id FROM question_image_attachments WHERE id = ?",
    args: [imageId],
  });
  assert.equal(imageResult.rows[0]?.content_id, "123");
});

test("confirmAgentWalletQuestionSubmissionRequest keeps image submissions retryable when media validator lookup fails", async () => {
  const imageId = "att_x402retryimage01";
  const imageUrl = `https://www.rateloop.ai/api/attachments/images/${imageId}.webp#sha256=0x${"a".repeat(64)}`;
  const payload = buildPayloadWithImageUrl("wallet-confirm-media-validator-retry", imageUrl);
  const walletAddress = "0x00000000000000000000000000000000000000aa" as const;
  const transactionHash = `0x${"c".repeat(64)}` as const;

  await insertQuestionImageAttachment({
    agentId: "agent-wallet",
    id: imageId,
    ownerWalletAddress: walletAddress,
    status: "approved",
  });
  await prepareAgentWalletQuestionSubmissionRequest({
    agentId: "agent-wallet",
    payload,
    walletAddress,
  });
  const record = await getX402QuestionSubmissionByClientRequest({
    chainId: payload.chainId,
    clientRequestId: payload.clientRequestId,
  });
  assert.ok(record);

  setDefaultTestOverrides({
    createPublicQuestionClient: () =>
      ({
        readContract: async () => {
          throw new Error("RPC unavailable");
        },
      }) as never,
    waitForSuccessfulReceipt: async (_publicClient, hash) =>
      buildReceipt(hash, [
        ...buildSubmittedQuestionLogs({
          address: TEST_CONFIG.contentRegistryAddress,
          contentHash: getExpectedContentHash(record),
          contentId: 123n,
          payload,
          submitter: walletAddress,
        }),
        buildQuestionContentAnchoredLog({
          address: TEST_CONFIG.submissionMediaValidatorAddress,
          contentId: 123n,
          url: imageUrl,
        }),
      ]),
  });

  await assert.rejects(
    () =>
      confirmAgentWalletQuestionSubmissionRequest({
        operationKey: record.operationKey,
        transactionHashes: [transactionHash],
      }),
    /Could not confirm submitted question media attachments/,
  );

  const retryableRecord = await getX402QuestionSubmissionByClientRequest({
    chainId: payload.chainId,
    clientRequestId: payload.clientRequestId,
  });
  assert.equal(retryableRecord?.status, "awaiting_wallet_signature");
  const imageResult = await dbClient.execute({
    sql: "SELECT content_id FROM question_image_attachments WHERE id = ?",
    args: [imageId],
  });
  assert.equal(imageResult.rows[0]?.content_id, null);
});

test("confirmAgentWalletQuestionSubmissionRequest rejects unrelated same-wallet submission logs", async () => {
  const payload = buildPayload("wallet-confirm-unrelated-same-wallet");
  const walletAddress = "0x00000000000000000000000000000000000000aa" as const;
  const transactionHash = `0x${"c".repeat(64)}` as const;
  await prepareAgentWalletQuestionSubmissionRequest({
    agentId: "agent-wallet",
    payload,
    walletAddress,
  });
  const record = await getX402QuestionSubmissionByClientRequest({
    chainId: payload.chainId,
    clientRequestId: payload.clientRequestId,
  });
  assert.ok(record);

  setDefaultTestOverrides({
    waitForSuccessfulReceipt: async (_publicClient, hash) =>
      buildReceipt(
        hash,
        buildSubmittedQuestionLogs({
          address: TEST_CONFIG.contentRegistryAddress,
          contentHash: `0x${"4".repeat(64)}`,
          contentId: 456n,
          payload,
          submitter: walletAddress,
        }),
      ),
  });

  await assert.rejects(
    () =>
      confirmAgentWalletQuestionSubmissionRequest({
        operationKey: record.operationKey,
        transactionHashes: [transactionHash],
      }),
    /Confirmed submission did not match the planned question payload/,
  );
});

test("confirmAgentWalletQuestionSubmissionRequest rejects only spoofed submission logs", async () => {
  const payload = buildPayload("wallet-confirm-only-spoof");
  const walletAddress = "0x00000000000000000000000000000000000000aa" as const;
  const transactionHash = `0x${"b".repeat(64)}` as const;
  await prepareAgentWalletQuestionSubmissionRequest({
    agentId: "agent-wallet",
    payload,
    walletAddress,
  });
  const record = await getX402QuestionSubmissionByClientRequest({
    chainId: payload.chainId,
    clientRequestId: payload.clientRequestId,
  });
  assert.ok(record);
  const operationKey = record.operationKey;

  setDefaultTestOverrides({
    waitForSuccessfulReceipt: async (_publicClient, hash) =>
      buildReceipt(hash, [
        buildContentSubmittedLog({
          address: "0x0000000000000000000000000000000000000999",
          contentId: 999n,
          submitter: walletAddress,
        }),
      ]),
  });

  await assert.rejects(
    () =>
      confirmAgentWalletQuestionSubmissionRequest({
        operationKey,
        transactionHashes: [transactionHash],
      }),
    /Confirmed transactions did not include a RateLoop question submission/,
  );
});

test("preparePermissionlessWalletQuestionSubmissionRequest namespaces idempotency by wallet", async () => {
  const payload = buildPayload("same-client-request");
  const firstWallet = "0x00000000000000000000000000000000000000aa" as const;
  const secondWallet = "0x00000000000000000000000000000000000000bb" as const;

  const first = await preparePermissionlessWalletQuestionSubmissionRequest({
    payload,
    walletAddress: firstWallet,
  });
  const second = await preparePermissionlessWalletQuestionSubmissionRequest({
    payload,
    walletAddress: secondWallet,
  });
  const firstBody = first.body as { clientRequestId: string; operationKey: string; status: string };
  const secondBody = second.body as { clientRequestId: string; operationKey: string; status: string };

  assert.equal(first.status, 202);
  assert.equal(second.status, 202);
  assert.equal(firstBody.clientRequestId, payload.clientRequestId);
  assert.equal(secondBody.clientRequestId, payload.clientRequestId);
  assert.notEqual(firstBody.operationKey, secondBody.operationKey);

  const storedClientRequestId = buildPermissionlessWalletClientRequestId({
    chainId: payload.chainId,
    clientRequestId: payload.clientRequestId,
    walletAddress: firstWallet,
  });
  const record = await getX402QuestionSubmissionByClientRequest({
    chainId: payload.chainId,
    clientRequestId: storedClientRequestId,
  });
  assert.equal(record?.payerAddress, firstWallet);
  assert.equal(record?.status, "awaiting_wallet_signature");
  assert.equal(x402QuestionSubmissionRecordBody(record).clientRequestId, payload.clientRequestId);
  assert.match(record?.paymentReceipt ?? "", /permissionless-wallet-plan/);
});

test("preparePermissionlessWalletQuestionSubmissionRequest rejects invalid uploaded image URLs", async () => {
  const attachmentId = "att_pendingUpload0001";
  const walletAddress = "0x00000000000000000000000000000000000000aa" as const;
  const payload = buildPayloadWithImageUrl(
    "pending-image-upload",
    `https://www.rateloop.ai/api/attachments/images/${attachmentId}.webp`,
  );
  await insertQuestionImageAttachment({
    id: attachmentId,
    ownerWalletAddress: walletAddress,
    status: "processing",
  });

  await assert.rejects(
    () =>
      preparePermissionlessWalletQuestionSubmissionRequest({
        payload,
        walletAddress,
      }),
    (error: unknown) =>
      error instanceof X402QuestionInputError &&
      error.message === "imageUrls must come from RateLoop uploads. Upload bytes with rateloop_upload_image first.",
  );
});

test("preparePermissionlessWalletQuestionSubmissionRequest rejects uploaded images from another wallet", async () => {
  const attachmentId = "att_foreignUpload001";
  const walletAddress = "0x00000000000000000000000000000000000000aa" as const;
  const payload = buildPayloadWithImageUrl(
    "foreign-image-upload",
    `https://www.rateloop.ai/api/attachments/images/${attachmentId}.webp#sha256=0x${"a".repeat(64)}`,
  );
  await insertQuestionImageAttachment({
    id: attachmentId,
    ownerWalletAddress: "0x00000000000000000000000000000000000000bb",
    status: "approved",
  });

  await assert.rejects(
    () =>
      preparePermissionlessWalletQuestionSubmissionRequest({
        payload,
        walletAddress,
      }),
    (error: unknown) =>
      error instanceof X402QuestionInputError &&
      error.message === "Uploaded imageUrls must belong to the submitting wallet or agent.",
  );
});

test("prepareNativeX402QuestionSubmissionRequest rejects overlong validBefore before storing a plan", async () => {
  const payload = buildPayload("native-x402-valid-before-cap");
  const walletAddress = "0x00000000000000000000000000000000000000aa" as const;
  const overlongValidBefore = BigInt(Math.floor(Date.now() / 1000)) + 24n * 60n * 60n + 60n;

  __setX402QuestionSubmissionTestOverridesForTests({
    resolveX402QuestionConfig: () => TEST_CONFIG,
  });

  await assert.rejects(
    () =>
      prepareNativeX402QuestionSubmissionRequest({
        agentId: "native-agent",
        paymentAuthorization: {
          validBefore: overlongValidBefore.toString(),
        },
        payload,
        walletAddress,
      }),
    (error: unknown) =>
      error instanceof Error &&
      error.name === "X402QuestionConflictError" &&
      error.message.includes("validBefore must be within 86400 seconds"),
  );

  const record = await getX402QuestionSubmissionByClientRequest({
    chainId: payload.chainId,
    clientRequestId: payload.clientRequestId,
  });
  assert.equal(record, null);
});

test("prepareNativeX402QuestionSubmissionRequest rejects LREP bounties", async () => {
  const basePayload = buildPayload("native-x402-lrep-bounty");
  const payload = {
    ...basePayload,
    bounty: { ...basePayload.bounty, asset: "LREP" as const },
  };
  const walletAddress = "0x00000000000000000000000000000000000000aa" as const;

  await assert.rejects(
    () =>
      prepareNativeX402QuestionSubmissionRequest({
        agentId: "native-agent",
        payload,
        walletAddress,
      }),
    (error: unknown) =>
      error instanceof X402QuestionInputError && error.message === "LREP bounties require wallet_calls funding mode.",
  );
});

test("prepareNativeX402QuestionSubmissionRequest returns an authorization request before signature", async () => {
  const payload = buildPayload("native-x402-plan");
  const walletAddress = "0x00000000000000000000000000000000000000aa" as const;

  __setX402QuestionSubmissionTestOverridesForTests({
    buildNativeX402QuestionSubmissionPlan: async ({ paymentAuthorization, payload, walletAddress }) => {
      const signature =
        paymentAuthorization && typeof paymentAuthorization.signature === "string"
          ? (paymentAuthorization.signature as `0x${string}`)
          : undefined;
      return {
        authorization: {
          from: walletAddress,
          nonce: `0x${"4".repeat(64)}` as const,
          signature,
          to: TEST_CONFIG.x402QuestionSubmitterAddress,
          validAfter: "0",
          validBefore: "1762000000",
          value: payload.bounty.amount.toString(),
        },
        calls: signature
          ? [
              {
                data: `0x${"b".repeat(8)}` as const,
                description: "Submit x402 question",
                functionName: "submitQuestionWithX402Payment",
                id: "submit-x402-question",
                phase: "submit_x402_question",
                to: TEST_CONFIG.x402QuestionSubmitterAddress,
                value: "0",
              },
            ]
          : [],
        chainId: payload.chainId,
        operationKey: `0x${payload.clientRequestId.padEnd(64, "0").slice(0, 64)}` as `0x${string}`,
        payment: {
          amount: payload.bounty.amount.toString(),
          asset: "USDC",
          bountyAmount: payload.bounty.amount.toString(),
          decimals: 6,
          spender: TEST_CONFIG.x402QuestionSubmitterAddress,
          tokenAddress: TEST_CONFIG.usdcAddress,
        },
        payloadHash: `payload:${payload.clientRequestId}`,
        questionCount: payload.questions.length,
        requiresOrderedExecution: true,
        revealCommitment: `0x${"9".repeat(64)}` as const,
        roundConfig: {
          questionDurationSeconds: payload.roundConfig.maxDuration.toString(),
          maxVoters: payload.roundConfig.maxVoters.toString(),
          minVoters: payload.roundConfig.minVoters.toString(),
        },
        submissionKey: `0x${"2".repeat(64)}` as const,
        walletAddress,
      };
    },
    resolveX402QuestionConfig: () => TEST_CONFIG,
  });

  const prepared = await prepareNativeX402QuestionSubmissionRequest({
    agentId: "native-agent",
    payload,
    walletAddress,
  });
  const body = prepared.body as {
    nextAction: string;
    paymentMode: string;
    paymentScheme: string;
    questionMetadataBaseUrl?: string;
    transactionPlan: null | { calls: unknown[] };
    x402AuthorizationRequest: {
      authorization: { nonce: string };
      eip712: { domain: { name?: string; version?: string; verifyingContract?: string } };
      questionMetadataBaseUrl?: string;
      scheme: string;
    };
  };

  assert.equal(prepared.status, 202);
  assert.equal(body.paymentMode, "x402_authorization");
  assert.equal(body.paymentScheme, "eip3009_usdc_authorization");
  assert.equal(body.nextAction, "sign_x402_authorization");
  assert.equal(body.transactionPlan, null);
  assert.equal(body.x402AuthorizationRequest.authorization.nonce, `0x${"4".repeat(64)}`);
  assert.equal(body.x402AuthorizationRequest.questionMetadataBaseUrl, body.questionMetadataBaseUrl);
  assert.equal(body.x402AuthorizationRequest.scheme, "eip3009_usdc_authorization");
  assert.equal(body.x402AuthorizationRequest.eip712.domain.name, "USD Coin");
  assert.equal(body.x402AuthorizationRequest.eip712.domain.version, "2");
  assert.equal(body.x402AuthorizationRequest.eip712.domain.verifyingContract, TEST_CONFIG.usdcAddress);

  const submitFunction = X402QuestionSubmitterAbi.find(
    (item: (typeof X402QuestionSubmitterAbi)[number]) =>
      item.type === "function" && item.name === "submitQuestionWithX402Payment",
  );
  assert.ok(submitFunction && "inputs" in submitFunction);
  const paymentAuthorizationInput = submitFunction.inputs.at(-1);
  assert.deepEqual(
    paymentAuthorizationInput && "components" in paymentAuthorizationInput
      ? paymentAuthorizationInput.components.map((component: { name: string; type: string }) => [
          component.name,
          component.type,
        ])
      : [],
    [
      ["from", "address"],
      ["to", "address"],
      ["value", "uint256"],
      ["validAfter", "uint256"],
      ["validBefore", "uint256"],
      ["nonce", "bytes32"],
      ["v", "uint8"],
      ["r", "bytes32"],
      ["s", "bytes32"],
    ],
  );

  const signed = await prepareNativeX402QuestionSubmissionRequest({
    agentId: "native-agent",
    paymentAuthorization: { signature: `0x${"5".repeat(130)}` },
    payload,
    walletAddress,
  });
  const signedBody = signed.body as {
    nextAction: string;
    transactionPlan: { calls: unknown[] };
  };
  assert.equal(signedBody.nextAction, "submit_x402_transaction");
  assert.equal(signedBody.transactionPlan.calls.length, 1);

  const permissionlessPayload = buildPayload("native-x402-public");
  const permissionless = await preparePermissionlessNativeX402QuestionSubmissionRequest({
    payload: permissionlessPayload,
    walletAddress,
  });
  const permissionlessBody = permissionless.body as {
    clientRequestId: string;
    paymentMode: string;
    paymentScheme: string;
    x402AuthorizationRequest: { authorization: { nonce: string } };
  };
  assert.equal(permissionless.status, 202);
  assert.equal(permissionlessBody.clientRequestId, permissionlessPayload.clientRequestId);
  assert.equal(permissionlessBody.paymentMode, "x402_authorization");
  assert.equal(permissionlessBody.paymentScheme, "eip3009_usdc_authorization");

  const storedClientRequestId = buildPermissionlessWalletClientRequestId({
    chainId: permissionlessPayload.chainId,
    clientRequestId: permissionlessPayload.clientRequestId,
    walletAddress,
  });
  const record = await getX402QuestionSubmissionByClientRequest({
    chainId: permissionlessPayload.chainId,
    clientRequestId: storedClientRequestId,
  });
  assert.equal(x402QuestionSubmissionRecordBody(record).clientRequestId, permissionlessPayload.clientRequestId);
  assert.match(record?.paymentReceipt ?? "", /permissionless-x402-authorization/);

  await preparePermissionlessNativeX402QuestionSubmissionRequest({
    paymentAuthorization: { signature: `0x${"6".repeat(130)}` },
    payload: permissionlessPayload,
    walletAddress,
  });

  const reusedPermissionless = await preparePermissionlessNativeX402QuestionSubmissionRequest({
    payload: permissionlessPayload,
    walletAddress,
  });
  const reusedPermissionlessBody = reusedPermissionless.body as {
    nextAction: string;
    transactionPlan: { calls: unknown[] };
  };
  assert.equal(reusedPermissionlessBody.nextAction, "submit_x402_transaction");
  assert.equal(reusedPermissionlessBody.transactionPlan.calls.length, 1);
});

test("prepareNativeX402QuestionSubmissionRequest one-shots USDC Feedback Bonus funding", async () => {
  const payload = buildPayload("native-x402-one-shot-feedback-bonus");
  const walletAddress = "0x00000000000000000000000000000000000000aa" as const;
  const feedbackBonus = {
    amount: 2_000_000n,
    asset: "USDC" as const,
    awarder: walletAddress,
  };
  const readFunctions: string[] = [];

  setDefaultTestOverrides({
    buildNativeX402QuestionSubmissionPlan: undefined as never,
    createPublicQuestionClient: () =>
      ({
        readContract: async ({ functionName }: { functionName: string }) => {
          readFunctions.push(functionName);
          if (functionName === "protocolConfig") return "0x0000000000000000000000000000000000000020";
          if (functionName === "minSubmissionUsdcPool") return 0n;
          if (functionName === "config") return { maxVoters: payload.roundConfig.maxVoters };
          if (functionName === "validateRoundConfig") return undefined;
          if (functionName === "submissionKeyUsed") return false;
          if (functionName === "computeX402QuestionOneShotPaymentNonce") return `0x${"6".repeat(64)}`;
          throw new Error(`Unexpected readContract call: ${functionName}`);
        },
      }) as never,
  });

  const prepared = await prepareNativeX402QuestionSubmissionRequest({
    agentId: "native-agent",
    feedbackBonus,
    paymentAuthorization: { signature: `0x${"1".repeat(64)}${"3".repeat(64)}1b` },
    payload,
    walletAddress,
  });
  const body = prepared.body as {
    payment: { amount: string; bountyAmount: string };
    transactionPlan: { calls: Array<{ functionName: string; id: string }> };
    x402AuthorizationRequest: { authorization: { nonce: string; value: string } };
  };

  assert.equal(prepared.status, 202);
  assert.equal(body.payment.amount, "3000000");
  assert.equal(body.payment.bountyAmount, "1000000");
  assert.equal(body.x402AuthorizationRequest.authorization.value, "3000000");
  assert.equal(body.x402AuthorizationRequest.authorization.nonce, `0x${"6".repeat(64)}`);
  assert.equal(body.transactionPlan.calls.length, 1);
  assert.equal(body.transactionPlan.calls[0]?.functionName, "submitQuestionWithX402OneShotPayment");
  assert.equal(body.transactionPlan.calls[0]?.id, "submit-x402-one-shot-question");
  assert.ok(readFunctions.includes("computeX402QuestionOneShotPaymentNonce"));
  assert.equal(readFunctions.includes("computeX402QuestionPaymentNonce"), false);

  const record = await getX402QuestionSubmissionByClientRequest({
    chainId: payload.chainId,
    clientRequestId: payload.clientRequestId,
  });
  assert.equal(record?.paymentAmount, "3000000");
  assert.equal(record?.bountyAmount, "1000000");
});

test("preparePermissionlessNativeX402QuestionSubmissionRequest preserves pending callback on signed follow-up", async () => {
  const payload = buildPayload("native-x402-webhook-followup");
  const walletAddress = "0x00000000000000000000000000000000000000aa" as const;
  const pendingCallback = {
    agentId: "public-wallet:8453:0x00000000000000000000000000000000000000aa",
    callbackUrl: "https://agent.example/rateloop",
    eventTypes: ["question.submitting"],
    secret: "webhook-secret",
  };

  setDefaultTestOverrides({
    buildNativeX402QuestionSubmissionPlan: async ({ paymentAuthorization, payload, walletAddress }) => {
      const signature =
        paymentAuthorization && typeof paymentAuthorization.signature === "string"
          ? (paymentAuthorization.signature as `0x${string}`)
          : undefined;
      return {
        authorization: {
          from: walletAddress,
          nonce: `0x${"4".repeat(64)}` as const,
          signature,
          to: TEST_CONFIG.x402QuestionSubmitterAddress,
          validAfter: "0",
          validBefore: "1762000000",
          value: payload.bounty.amount.toString(),
        },
        calls: signature
          ? [
              {
                data: `0x${"a".repeat(8)}` as const,
                description: "Submit x402 question",
                functionName: "submitQuestionWithX402Payment",
                id: "submit-x402-question",
                phase: "submit_x402_question",
                to: TEST_CONFIG.x402QuestionSubmitterAddress,
                value: "0",
              },
            ]
          : [],
        chainId: payload.chainId,
        operationKey: `0x${payload.clientRequestId.padEnd(64, "0").slice(0, 64)}` as `0x${string}`,
        payment: {
          amount: payload.bounty.amount.toString(),
          asset: "USDC",
          bountyAmount: payload.bounty.amount.toString(),
          decimals: 6,
          spender: TEST_CONFIG.x402QuestionSubmitterAddress,
          tokenAddress: TEST_CONFIG.usdcAddress,
        },
        payloadHash: `payload:${payload.clientRequestId}`,
        questionCount: payload.questions.length,
        requiresOrderedExecution: true,
        revealCommitment: `0x${"9".repeat(64)}` as const,
        roundConfig: {
          questionDurationSeconds: payload.roundConfig.maxDuration.toString(),
          maxVoters: payload.roundConfig.maxVoters.toString(),
          minVoters: payload.roundConfig.minVoters.toString(),
        },
        submissionKey: `0x${"2".repeat(64)}` as const,
        walletAddress,
      };
    },
  });

  await preparePermissionlessNativeX402QuestionSubmissionRequest({
    payload,
    pendingCallback,
    walletAddress,
  });

  await preparePermissionlessNativeX402QuestionSubmissionRequest({
    paymentAuthorization: { signature: `0x${"6".repeat(130)}` },
    payload,
    walletAddress,
  });

  const storedClientRequestId = buildPermissionlessWalletClientRequestId({
    chainId: payload.chainId,
    clientRequestId: payload.clientRequestId,
    walletAddress,
  });
  const record = await getX402QuestionSubmissionByClientRequest({
    chainId: payload.chainId,
    clientRequestId: storedClientRequestId,
  });
  const receipt = JSON.parse(record?.paymentReceipt ?? "{}") as {
    authorization?: { signature?: string };
    pendingCallback?: typeof pendingCallback;
  };

  assert.deepEqual(receipt.pendingCallback, pendingCallback);
  assert.equal(receipt.authorization?.signature, `0x${"6".repeat(130)}`);
});

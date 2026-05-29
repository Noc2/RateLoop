import { questionImageAttachments } from "../db/schema";
import deployedContracts from "@rateloop/contracts/deployedContracts";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { type Abi, encodeAbiParameters, encodeEventTopics, encodeFunctionData, parseAbi, parseAbiItem } from "viem";

const env = process.env as Record<string, string | undefined>;
const originalAppEnv = env.APP_ENV;
const originalDatabaseUrl = env.DATABASE_URL;
const originalFreeTransactionLimit = env.FREE_TRANSACTION_LIMIT;
const originalNodeEnv = env.NODE_ENV;
const originalTargetNetworks = env.NEXT_PUBLIC_TARGET_NETWORKS;

env.APP_ENV = "test";
env.DATABASE_URL = "memory:";
env.FREE_TRANSACTION_LIMIT = "2";
env.NODE_ENV = "test";
env.NEXT_PUBLIC_TARGET_NETWORKS = "31337";

type DbModule = typeof import("../db");
type DatabaseResources = import("../db").DatabaseResources;
type DbTestMemoryModule = typeof import("../db/testMemory");
type FreeTransactionsModule = typeof import("./freeTransactions");
type OperationModule = typeof import("./freeTransactionOperation");

type ContractRecord = {
  address: `0x${string}`;
  abi: Abi;
};

type EncodedCall = {
  data: `0x${string}`;
  to: `0x${string}`;
  value?: `0x${string}`;
};

const CHAIN_ID = 31337;
const ENTRY_POINT = "0x1111111111111111111111111111111111111111" as const;
const EXECUTOR = "0x2222222222222222222222222222222222222222" as const;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const SUCCESS_HASH = `0x${"1".repeat(64)}` as const;
const WALLET = "0x1234567890abcdef1234567890abcdef12345678" as const;
const USER_OPERATION_EVENT = parseAbiItem(
  "event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)",
);
const EXECUTED_EVENT = parseAbiItem(
  "event Executed(address indexed user, address indexed signer, address indexed executor, uint256 batchSize)",
);
const contractsForChain = (deployedContracts as Record<number, Record<string, ContractRecord>>)[CHAIN_ID];
const lrepContract = contractsForChain.LoopReputation;
const contentRegistryContract = contractsForChain.ContentRegistry;
const frontendRegistryContract = contractsForChain.FrontendRegistry;
const profileRegistryContract = contractsForChain.ProfileRegistry;
const raterRegistryContract = contractsForChain.RaterRegistry;
const rewardEscrowContract = contractsForChain.QuestionRewardPoolEscrow;
const rewardDistributorContract = contractsForChain.RoundRewardDistributor;
const votingEngineContract = contractsForChain.RoundVotingEngine;
const arbitraryTokenContract = {
  address: "0x9999999999999999999999999999999999999999" as const,
  abi: parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]),
};
const APPROVED_IMAGE_ID = "att_sponsoredimage01";
const APPROVED_IMAGE_URL = `https://www.rateloop.xyz/api/attachments/images/${APPROVED_IMAGE_ID}.webp`;
const submitQuestionWithRewardAndRoundConfigAbi = [
  {
    type: "function",
    name: "submitQuestionWithRewardAndRoundConfig",
    inputs: [
      { name: "contextUrl", type: "string" },
      { name: "imageUrls", type: "string[]" },
      { name: "videoUrl", type: "string" },
      { name: "title", type: "string" },
      { name: "description", type: "string" },
      { name: "tags", type: "string" },
      { name: "categoryId", type: "uint256" },
      { name: "salt", type: "bytes32" },
      {
        name: "rewardTerms",
        type: "tuple",
        components: [
          { name: "asset", type: "uint8" },
          { name: "amount", type: "uint256" },
          { name: "requiredVoters", type: "uint256" },
          { name: "requiredSettledRounds", type: "uint256" },
          { name: "bountyClosesAt", type: "uint256" },
          { name: "feedbackClosesAt", type: "uint256" },
          { name: "bountyEligibility", type: "uint8" },
        ],
      },
      {
        name: "roundConfig",
        type: "tuple",
        components: [
          { name: "epochDuration", type: "uint32" },
          { name: "maxDuration", type: "uint32" },
          { name: "minVoters", type: "uint16" },
          { name: "maxVoters", type: "uint16" },
        ],
      },
      {
        name: "spec",
        type: "tuple",
        components: [
          { name: "questionMetadataHash", type: "bytes32" },
          { name: "resultSpecHash", type: "bytes32" },
        ],
      },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "nonpayable",
  },
] as const;

let dbModule: DbModule;
let dbTestMemory: DbTestMemoryModule;
let freeTransactions: FreeTransactionsModule;
let operationModule: OperationModule;
let memoryResources: DatabaseResources;

function encodeCall(
  contract: ContractRecord,
  functionName: string,
  args: readonly unknown[] = [],
  value?: `0x${string}`,
): EncodedCall {
  return {
    data: encodeFunctionData({
      abi: contract.abi,
      functionName: functionName as never,
      args: args as never,
    }),
    to: contract.address,
    ...(value ? { value } : {}),
  };
}

function buildRequest(calls: readonly EncodedCall[]) {
  return {
    chainId: CHAIN_ID,
    userOp: {
      sender: WALLET,
      data: {
        targets: calls.map(call => call.to),
        callDatas: calls.map(call => call.data),
        values: calls.map(call => call.value ?? "0x0"),
      },
    },
  };
}

function buildOperationKey(calls: readonly EncodedCall[]) {
  const operationKey = operationModule.buildFreeTransactionOperationKey({
    chainId: CHAIN_ID,
    calls: calls.map(call => ({
      data: call.data,
      to: call.to,
      value: call.value ?? "0x0",
    })),
    sender: WALLET,
  });

  assert.ok(operationKey, "operation key should be derived from the verifier payload");
  return operationKey;
}

function buildUserOperationEventLog(sender: `0x${string}`) {
  return {
    address: ENTRY_POINT,
    data: encodeAbiParameters(
      [
        { name: "nonce", type: "uint256" },
        { name: "success", type: "bool" },
        { name: "actualGasCost", type: "uint256" },
        { name: "actualGasUsed", type: "uint256" },
      ],
      [0n, true, 0n, 0n],
    ),
    topics: encodeEventTopics({
      abi: [USER_OPERATION_EVENT],
      eventName: "UserOperationEvent",
      args: {
        paymaster: ZERO_ADDRESS,
        sender,
        userOpHash: SUCCESS_HASH,
      },
    }).filter((topic): topic is `0x${string}` => !!topic),
  };
}

function buildExecutedEventLog(user: `0x${string}`) {
  return {
    address: EXECUTOR,
    data: encodeAbiParameters([{ name: "batchSize", type: "uint256" }], [1n]),
    topics: encodeEventTopics({
      abi: [EXECUTED_EVENT],
      eventName: "Executed",
      args: {
        executor: EXECUTOR,
        signer: WALLET,
        user,
      },
    }).filter((topic): topic is `0x${string}` => !!topic),
  };
}

const voteCall = (voteMarker: `0x${string}`) =>
  encodeCall(votingEngineContract, "commitVote", [
    1n,
    1n,
    1n,
    `0x${"1".repeat(64)}`,
    `0x${"2".repeat(64)}`,
    voteMarker,
    1n,
    WALLET,
  ]);

function submitQuestionWithRewardCall(
  overrides: Partial<{
    contextUrl: string;
    description: string;
    imageUrls: string[];
    tags: string;
    title: string;
    videoUrl: string;
  }> = {},
) {
  const question = {
    contextUrl: "https://example.com/product",
    description: "Vote based on the source material.",
    imageUrls: [] as string[],
    tags: "Products,Value",
    title: "Is this product worth recommending?",
    videoUrl: "",
    ...overrides,
  };

  return encodeCall(
    { address: contentRegistryContract.address, abi: submitQuestionWithRewardAndRoundConfigAbi },
    "submitQuestionWithRewardAndRoundConfig",
    [
      question.contextUrl,
      question.imageUrls,
      question.videoUrl,
      question.title,
      question.description,
      question.tags,
      1n,
      `0x${"5".repeat(64)}`,
      {
        asset: 0,
        amount: 1_000_000n,
        requiredVoters: 3n,
        requiredSettledRounds: 1n,
        bountyClosesAt: 0n,
        feedbackClosesAt: 0n,
        bountyEligibility: 0,
      },
      { epochDuration: 1200, maxDuration: 604800, minVoters: 3, maxVoters: 100 },
      {
        questionMetadataHash: `0x${"6".repeat(64)}`,
        resultSpecHash: `0x${"7".repeat(64)}`,
      },
    ],
  );
}

async function insertApprovedImageAttachment(params: { id?: string; ownerWalletAddress?: `0x${string}` }) {
  const now = new Date();
  await dbModule.db.insert(questionImageAttachments).values({
    id: params.id ?? APPROVED_IMAGE_ID,
    uploaderKind: "wallet",
    ownerWalletAddress: params.ownerWalletAddress ?? WALLET,
    originalFilename: "mockup.png",
    mimeType: "image/webp",
    sizeBytes: 1024,
    status: "approved",
    moderationStatus: "approved",
    createdAt: now,
    updatedAt: now,
  });
}

function createStoreUnavailableError() {
  return new Error("database offline", {
    cause: {
      code: "SELF_SIGNED_CERT_IN_CHAIN",
    },
  });
}

function createStoreUnavailableResources(base: DatabaseResources): DatabaseResources {
  const storeUnavailableError = createStoreUnavailableError();
  const database = new Proxy(base.database as object, {
    get(target, property, receiver) {
      if (property === "insert" || property === "transaction") {
        return () => {
          throw storeUnavailableError;
        };
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as DatabaseResources["database"];

  return {
    client: base.client,
    database,
    pool: base.pool,
  };
}

before(async () => {
  dbModule = await import("../db");
  dbTestMemory = await import("../db/testMemory");
  memoryResources = dbTestMemory.createMemoryDatabaseResources();
  dbModule.__setDatabaseResourcesForTests(memoryResources);
  freeTransactions = await import("./freeTransactions");
  operationModule = await import("./freeTransactionOperation");
});

beforeEach(async () => {
  dbModule.__setDatabaseResourcesForTests(memoryResources);
  freeTransactions.__setFreeTransactionTestOverridesForTests({
    allTransactionHashesSucceeded: async () => true,
    resolveRaterIdentityKey: async () => "0x1111111111111111111111111111111111111111111111111111111111111111",
  });

  await dbModule.dbClient.execute("DELETE FROM free_transaction_reservations");
  await dbModule.dbClient.execute("DELETE FROM free_transaction_quotas");
  await dbModule.dbClient.execute("DELETE FROM question_image_attachments");
});

after(() => {
  freeTransactions.__setFreeTransactionTestOverridesForTests(null);
  dbModule.__setDatabaseResourcesForTests(null);

  if (originalAppEnv === undefined) {
    delete env.APP_ENV;
  } else {
    env.APP_ENV = originalAppEnv;
  }

  if (originalDatabaseUrl === undefined) {
    delete env.DATABASE_URL;
  } else {
    env.DATABASE_URL = originalDatabaseUrl;
  }

  if (originalFreeTransactionLimit === undefined) {
    delete env.FREE_TRANSACTION_LIMIT;
  } else {
    env.FREE_TRANSACTION_LIMIT = originalFreeTransactionLimit;
  }

  if (originalNodeEnv === undefined) {
    delete env.NODE_ENV;
  } else {
    env.NODE_ENV = originalNodeEnv;
  }

  if (originalTargetNetworks === undefined) {
    delete env.NEXT_PUBLIC_TARGET_NETWORKS;
  } else {
    env.NEXT_PUBLIC_TARGET_NETWORKS = originalTargetNetworks;
  }
});

test("pending reservations are idempotent and reserve capacity without incrementing confirmed quota", async () => {
  const firstCalls = [voteCall("0x01")];
  const secondCalls = [voteCall("0x02")];
  const thirdCalls = [voteCall("0x03")];

  const firstDecision = await freeTransactions.evaluateFreeTransactionAllowance(buildRequest(firstCalls) as never);
  assert.equal(firstDecision.isAllowed, true);
  if (!firstDecision.isAllowed) return;
  assert.equal(firstDecision.summary.used, 1);
  assert.equal(firstDecision.summary.remaining, 1);

  const quotaAfterFirst = await dbModule.dbClient.execute("SELECT free_tx_used FROM free_transaction_quotas");
  assert.equal(Number(quotaAfterFirst.rows[0]?.free_tx_used), 0);

  const repeatedDecision = await freeTransactions.evaluateFreeTransactionAllowance(buildRequest(firstCalls) as never);
  assert.equal(repeatedDecision.isAllowed, true);
  if (!repeatedDecision.isAllowed) return;
  assert.equal(repeatedDecision.summary.used, 1);
  assert.equal(repeatedDecision.summary.remaining, 1);

  const secondDecision = await freeTransactions.evaluateFreeTransactionAllowance(buildRequest(secondCalls) as never);
  assert.equal(secondDecision.isAllowed, true);
  if (!secondDecision.isAllowed) return;
  assert.equal(secondDecision.summary.used, 2);
  assert.equal(secondDecision.summary.remaining, 0);

  const deniedDecision = await freeTransactions.evaluateFreeTransactionAllowance(buildRequest(thirdCalls) as never);
  assert.equal(deniedDecision.isAllowed, false);
  if (deniedDecision.isAllowed) return;
  assert.equal(deniedDecision.debugCode, "free_tx_exhausted");
  assert.equal(deniedDecision.summary?.used, 2);
});

test("confirm increments confirmed quota exactly once", async () => {
  const calls = [voteCall("0x04")];
  const initialDecision = await freeTransactions.evaluateFreeTransactionAllowance(buildRequest(calls) as never);
  assert.equal(initialDecision.isAllowed, true);
  if (!initialDecision.isAllowed) return;
  assert.equal(initialDecision.summary.used, 1);

  await freeTransactions.confirmFreeTransactionReservation({
    address: WALLET,
    chainId: CHAIN_ID,
    operationKey: buildOperationKey(calls),
    transactionHashes: [SUCCESS_HASH],
  });

  await freeTransactions.confirmFreeTransactionReservation({
    address: WALLET,
    chainId: CHAIN_ID,
    operationKey: buildOperationKey(calls),
    transactionHashes: [SUCCESS_HASH],
  });

  const quotaRows = await dbModule.dbClient.execute("SELECT free_tx_used FROM free_transaction_quotas");
  assert.equal(Number(quotaRows.rows[0]?.free_tx_used), 1);

  const reservationRows = await dbModule.dbClient.execute("SELECT status FROM free_transaction_reservations");
  assert.equal(reservationRows.rows[0]?.status, "confirmed");

  const repeatedDecision = await freeTransactions.evaluateFreeTransactionAllowance(buildRequest(calls) as never);
  assert.equal(repeatedDecision.isAllowed, true);
  if (!repeatedDecision.isAllowed) return;
  assert.equal(repeatedDecision.summary.used, 1);
  assert.equal(repeatedDecision.summary.remaining, 1);
});

test("confirm accepts relayed 7702 receipts when the executed event proves the wallet", async () => {
  const calls = [voteCall("0x0a")];
  const initialDecision = await freeTransactions.evaluateFreeTransactionAllowance(buildRequest(calls) as never);
  assert.equal(initialDecision.isAllowed, true);

  freeTransactions.__setFreeTransactionTestOverridesForTests({
    getTransactionVerificationClient: async () => ({
      getTransaction: async () => ({
        chainId: CHAIN_ID,
        from: EXECUTOR,
      }),
      getTransactionReceipt: async () => ({
        logs: [buildExecutedEventLog(WALLET)],
        status: "success",
      }),
    }),
    resolveRaterIdentityKey: async () => "0x1111111111111111111111111111111111111111111111111111111111111111",
  });

  await freeTransactions.confirmFreeTransactionReservation({
    address: WALLET,
    chainId: CHAIN_ID,
    operationKey: buildOperationKey(calls),
    transactionHashes: [SUCCESS_HASH],
  });

  const quotaRows = await dbModule.dbClient.execute("SELECT free_tx_used FROM free_transaction_quotas");
  assert.equal(Number(quotaRows.rows[0]?.free_tx_used), 1);
});

test("confirm accepts relayed 4337 receipts when the user operation event proves the wallet", async () => {
  const calls = [voteCall("0x0b")];
  const initialDecision = await freeTransactions.evaluateFreeTransactionAllowance(buildRequest(calls) as never);
  assert.equal(initialDecision.isAllowed, true);

  freeTransactions.__setFreeTransactionTestOverridesForTests({
    getTransactionVerificationClient: async () => ({
      getTransaction: async () => ({
        chainId: CHAIN_ID,
        from: ENTRY_POINT,
      }),
      getTransactionReceipt: async () => ({
        logs: [buildUserOperationEventLog(WALLET)],
        status: "success",
      }),
    }),
    resolveRaterIdentityKey: async () => "0x1111111111111111111111111111111111111111111111111111111111111111",
  });

  await freeTransactions.confirmFreeTransactionReservation({
    address: WALLET,
    chainId: CHAIN_ID,
    operationKey: buildOperationKey(calls),
    transactionHashes: [SUCCESS_HASH],
  });

  const quotaRows = await dbModule.dbClient.execute("SELECT free_tx_used FROM free_transaction_quotas");
  assert.equal(Number(quotaRows.rows[0]?.free_tx_used), 1);
});

test("confirm still rejects relayed receipts without wallet execution proof", async () => {
  const calls = [voteCall("0x0c")];
  const initialDecision = await freeTransactions.evaluateFreeTransactionAllowance(buildRequest(calls) as never);
  assert.equal(initialDecision.isAllowed, true);

  freeTransactions.__setFreeTransactionTestOverridesForTests({
    getTransactionVerificationClient: async () => ({
      getTransaction: async () => ({
        chainId: CHAIN_ID,
        from: EXECUTOR,
      }),
      getTransactionReceipt: async () => ({
        logs: [],
        status: "success",
      }),
    }),
    resolveRaterIdentityKey: async () => "0x1111111111111111111111111111111111111111111111111111111111111111",
  });

  await assert.rejects(
    freeTransactions.confirmFreeTransactionReservation({
      address: WALLET,
      chainId: CHAIN_ID,
      operationKey: buildOperationKey(calls),
      transactionHashes: [SUCCESS_HASH],
    }),
    /could not be verified/i,
  );
});

test("expired pending reservations release held capacity for new operations", async () => {
  const expiredCalls = [voteCall("0x05")];
  const freshCalls = [voteCall("0x06")];

  const initialDecision = await freeTransactions.evaluateFreeTransactionAllowance(buildRequest(expiredCalls) as never);
  assert.equal(initialDecision.isAllowed, true);

  await dbModule.dbClient.execute({
    sql: "UPDATE free_transaction_reservations SET expires_at = ?",
    args: [new Date(Date.now() - 60_000)],
  });

  const freshDecision = await freeTransactions.evaluateFreeTransactionAllowance(buildRequest(freshCalls) as never);
  assert.equal(freshDecision.isAllowed, true);
  if (!freshDecision.isAllowed) return;
  assert.equal(freshDecision.summary.used, 1);
  assert.equal(freshDecision.summary.remaining, 1);

  const quotaRows = await dbModule.dbClient.execute("SELECT free_tx_used FROM free_transaction_quotas");
  assert.equal(Number(quotaRows.rows[0]?.free_tx_used), 0);
});

test("supported sponsored operation families are allowlisted", async () => {
  const payoutWeight = {
    domain: 1,
    rewardPoolId: 1n,
    contentId: 1n,
    roundId: 1n,
    commitKey: `0x${"a".repeat(64)}` as const,
    identityKey: `0x${"b".repeat(64)}` as const,
    account: WALLET,
    baseWeight: 10_000n,
    independenceBps: 10_000,
    effectiveWeight: 10_000n,
    reasonHash: `0x${"c".repeat(64)}` as const,
  };
  const supportedCases = [
    [voteCall("0x07")],
    [
      encodeCall(lrepContract, "approve", [rewardEscrowContract.address, 1_000_000n]),
      encodeCall(contentRegistryContract, "reserveSubmission", [`0x${"1".repeat(64)}`]),
    ],
    [encodeCall(lrepContract, "approve", [votingEngineContract.address, 1_000_000n]), voteCall("0x08")],
    [encodeCall(contentRegistryContract, "cancelReservedSubmission", [`0x${"2".repeat(64)}`])],
    [submitQuestionWithRewardCall()],
    [encodeCall(frontendRegistryContract, "register")],
    [encodeCall(frontendRegistryContract, "claimFees")],
    [
      encodeCall(profileRegistryContract, "setProfile", [
        "EthHealth",
        '{"v":1,"ageGroup":"25-34","residenceCountry":"US"}',
      ]),
    ],
    [encodeCall(profileRegistryContract, "setAvatarAccent", [0x76bb40])],
    [encodeCall(profileRegistryContract, "clearAvatarAccent")],
    [encodeCall(raterRegistryContract, "setProfile", [2, `0x${"0".repeat(64)}`])],
    [encodeCall(votingEngineContract, "claimCancelledRoundRefund", [1n, 1n])],
    [encodeCall(rewardDistributorContract, "claimFrontendFee", [1n, 1n, WALLET])],
    [encodeCall(rewardDistributorContract, "claimReward", [1n, 1n])],
    [encodeCall(rewardEscrowContract, "claimQuestionReward", [1n, 1n])],
    [encodeCall(rewardEscrowContract, "claimQuestionReward", [1n, 1n, payoutWeight, []])],
    [encodeCall(rewardEscrowContract, "claimQuestionBundleReward", [1n, 0n])],
  ] as const;

  for (const calls of supportedCases) {
    const decision = await freeTransactions.evaluateFreeTransactionAllowance(buildRequest(calls) as never);
    assert.equal(decision.isAllowed, true);

    await dbModule.dbClient.execute("DELETE FROM free_transaction_reservations");
    await dbModule.dbClient.execute("DELETE FROM free_transaction_quotas");
  }
});

test("validates sponsored ContentRegistry submit question media", async () => {
  const allowedVideoOnlyDecision = await freeTransactions.evaluateFreeTransactionAllowance(
    buildRequest([
      submitQuestionWithRewardCall({
        contextUrl: "",
        videoUrl: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
      }),
    ]) as never,
  );
  assert.equal(allowedVideoOnlyDecision.isAllowed, true);

  await dbModule.dbClient.execute("DELETE FROM free_transaction_reservations");
  await dbModule.dbClient.execute("DELETE FROM free_transaction_quotas");

  const invalidImageDecision = await freeTransactions.evaluateFreeTransactionAllowance(
    buildRequest([
      submitQuestionWithRewardCall({ contextUrl: "", imageUrls: ["https://example.com/question-a.jpg"] }),
    ]) as never,
  );
  assert.equal(invalidImageDecision.isAllowed, false);
  if (invalidImageDecision.isAllowed) return;
  assert.equal(invalidImageDecision.debugCode, "unsupported_operation");

  const invalidContextImageDecision = await freeTransactions.evaluateFreeTransactionAllowance(
    buildRequest([submitQuestionWithRewardCall({ contextUrl: "https://example.com/question-a.jpg" })]) as never,
  );
  assert.equal(invalidContextImageDecision.isAllowed, false);
  if (invalidContextImageDecision.isAllowed) return;
  assert.equal(invalidContextImageDecision.debugCode, "unsupported_operation");
});

test("validates sponsored ContentRegistry submit question text and tags", async () => {
  const blockedTitleDecision = await freeTransactions.evaluateFreeTransactionAllowance(
    buildRequest([submitQuestionWithRewardCall({ title: "NSFW highlights" })]) as never,
  );
  assert.equal(blockedTitleDecision.isAllowed, false);
  if (blockedTitleDecision.isAllowed) return;
  assert.equal(blockedTitleDecision.debugCode, "unsupported_operation");

  const blockedTagsDecision = await freeTransactions.evaluateFreeTransactionAllowance(
    buildRequest([submitQuestionWithRewardCall({ tags: "Products,nsfw" })]) as never,
  );
  assert.equal(blockedTagsDecision.isAllowed, false);
  if (blockedTagsDecision.isAllowed) return;
  assert.equal(blockedTagsDecision.debugCode, "unsupported_operation");
});

test("validates sponsored ContentRegistry uploaded image ownership and origin", async () => {
  await insertApprovedImageAttachment({});

  const allowedImageDecision = await freeTransactions.evaluateFreeTransactionAllowance(
    buildRequest([submitQuestionWithRewardCall({ contextUrl: "", imageUrls: [APPROVED_IMAGE_URL] })]) as never,
  );
  assert.equal(allowedImageDecision.isAllowed, true);

  await dbModule.dbClient.execute("DELETE FROM free_transaction_reservations");
  await dbModule.dbClient.execute("DELETE FROM free_transaction_quotas");

  const untrustedOriginDecision = await freeTransactions.evaluateFreeTransactionAllowance(
    buildRequest([
      submitQuestionWithRewardCall({
        contextUrl: "",
        imageUrls: [`https://evil.example/api/attachments/images/${APPROVED_IMAGE_ID}.webp`],
      }),
    ]) as never,
  );
  assert.equal(untrustedOriginDecision.isAllowed, false);
  if (untrustedOriginDecision.isAllowed) return;
  assert.equal(untrustedOriginDecision.debugCode, "unsupported_operation");
});

test("rejects token approvals to unsupported spenders", async () => {
  const decision = await freeTransactions.evaluateFreeTransactionAllowance(
    buildRequest([encodeCall(lrepContract, "approve", [WALLET, 10n])]) as never,
  );

  assert.equal(decision.isAllowed, false);
  if (decision.isAllowed) return;
  assert.equal(decision.debugCode, "unsupported_operation");
});

test("rejects approvals from arbitrary token contracts to supported spenders", async () => {
  const decision = await freeTransactions.evaluateFreeTransactionAllowance(
    buildRequest([encodeCall(arbitraryTokenContract, "approve", [rewardEscrowContract.address, 10n])]) as never,
  );

  assert.equal(decision.isAllowed, false);
  if (decision.isAllowed) return;
  assert.equal(decision.debugCode, "target_not_allowlisted");
});

test("rejects arbitrary token methods even on allowlisted contracts", async () => {
  const decision = await freeTransactions.evaluateFreeTransactionAllowance(
    buildRequest([encodeCall(lrepContract, "transfer", [WALLET, 10n])]) as never,
  );

  assert.equal(decision.isAllowed, false);
  if (decision.isAllowed) return;
  assert.equal(decision.debugCode, "unsupported_operation");
});

test("rejects nonzero call values for sponsored operations", async () => {
  const decision = await freeTransactions.evaluateFreeTransactionAllowance(
    buildRequest([encodeCall(frontendRegistryContract, "register", [], "0x1")]) as never,
  );

  assert.equal(decision.isAllowed, false);
  if (decision.isAllowed) return;
  assert.equal(decision.debugCode, "unsupported_operation");
});

test("confirm leaves the reservation pending when receipt verification fails", async () => {
  const calls = [voteCall("0x08")];
  const initialDecision = await freeTransactions.evaluateFreeTransactionAllowance(buildRequest(calls) as never);
  assert.equal(initialDecision.isAllowed, true);

  freeTransactions.__setFreeTransactionTestOverridesForTests({
    allTransactionHashesSucceeded: async () => false,
    resolveRaterIdentityKey: async () => "0x1111111111111111111111111111111111111111111111111111111111111111",
  });

  await assert.rejects(
    freeTransactions.confirmFreeTransactionReservation({
      address: WALLET,
      chainId: CHAIN_ID,
      operationKey: buildOperationKey(calls),
      transactionHashes: [SUCCESS_HASH],
    }),
    /could not be verified/i,
  );

  const quotaRows = await dbModule.dbClient.execute("SELECT free_tx_used FROM free_transaction_quotas");
  assert.equal(Number(quotaRows.rows[0]?.free_tx_used), 0);

  const reservationRows = await dbModule.dbClient.execute("SELECT status FROM free_transaction_reservations");
  assert.equal(reservationRows.rows[0]?.status, "pending");
});

test("confirm fails closed when the quota store is unavailable after receipts verify", async () => {
  const calls = [voteCall("0x0d")];
  const initialDecision = await freeTransactions.evaluateFreeTransactionAllowance(buildRequest(calls) as never);
  assert.equal(initialDecision.isAllowed, true);

  dbModule.__setDatabaseResourcesForTests(createStoreUnavailableResources(memoryResources));

  try {
    await assert.rejects(
      freeTransactions.confirmFreeTransactionReservation({
        address: WALLET,
        chainId: CHAIN_ID,
        operationKey: buildOperationKey(calls),
        transactionHashes: [SUCCESS_HASH],
      }),
      /database offline/i,
    );
  } finally {
    dbModule.__setDatabaseResourcesForTests(memoryResources);
  }

  const quotaRows = await dbModule.dbClient.execute("SELECT free_tx_used FROM free_transaction_quotas");
  assert.equal(Number(quotaRows.rows[0]?.free_tx_used), 0);

  const reservationRows = await dbModule.dbClient.execute("SELECT status FROM free_transaction_reservations");
  assert.equal(reservationRows.rows[0]?.status, "pending");
});

test("summary fails closed for verified voters when the quota store is unavailable", async () => {
  dbModule.__setDatabaseResourcesForTests(createStoreUnavailableResources(memoryResources));

  try {
    await assert.rejects(
      freeTransactions.getFreeTransactionAllowanceSummary({
        address: WALLET,
        chainId: CHAIN_ID,
      }),
      /database offline/i,
    );
  } finally {
    dbModule.__setDatabaseResourcesForTests(memoryResources);
  }
});

test("verifier fails closed for verified voters when the quota store is unavailable", async () => {
  dbModule.__setDatabaseResourcesForTests(createStoreUnavailableResources(memoryResources));

  try {
    const decision = await freeTransactions.evaluateFreeTransactionAllowance(buildRequest([voteCall("0x09")]) as never);

    assert.equal(decision.isAllowed, false);
    if (decision.isAllowed) return;
    assert.equal(decision.debugCode, "quota_store_unavailable");
    assert.equal(decision.reason, "Transaction not sponsored.");
    assert.equal(decision.summary, undefined);
  } finally {
    dbModule.__setDatabaseResourcesForTests(memoryResources);
  }
});

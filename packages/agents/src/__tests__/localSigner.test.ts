import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  ContentRegistryAbi,
  X402QuestionSubmitterAbi,
} from "@rateloop/contracts/abis";
import {
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  keccak256,
  parseSignature,
  stringToHex,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { buildQuestionSpecHashes } from "../questionSpecs.js";
import { findAgentResultTemplate } from "../templates.js";
import {
  askHumansWithLocalSigner,
  signX402AuthorizationRequest,
  validateLocalSignerTransactionPlan,
  withLocalSignerWallet,
} from "../localSigner.js";
import type {
  AskHumansRequest,
  AskHumansResponse,
  RateLoopAgentClient,
} from "@rateloop/sdk/agent";

const PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const account = privateKeyToAccount(PRIVATE_KEY);
const X402_SUBMITTER_ADDRESS =
  "0x00000000000000000000000000000000000000bb" as const;
const X402_USDC_ADDRESS = "0x00000000000000000000000000000000000000cc" as const;
const CONTENT_REGISTRY_ADDRESS =
  "0x00000000000000000000000000000000000000dd" as const;
const QUESTION_REWARD_ESCROW_ADDRESS =
  "0x00000000000000000000000000000000000000ee" as const;
const X402_AMOUNT = "1500000";
const CLIENT_REQUEST_ID = "local-signer-test";
const QUESTION_CONTEXT_URL = "https://example.com/context";
const QUESTION_TITLE = "Should this agent proceed?";
const QUESTION_TAG = "agent";
const BOUNTY_START_BY = 1_893_456_000n;
const BOUNTY_WINDOW_SECONDS = 1_200n;
const FEEDBACK_WINDOW_SECONDS = 1_200n;
const X402_VALID_AFTER = "0";
const X402_VALID_BEFORE = "9999999999";
const TEST_SIGNATURE = `0x${"1".repeat(64)}${"3".repeat(64)}1b` as const;
const EMPTY_DETAILS_HASH = `0x${"0".repeat(64)}` as const;
const EMPTY_DETAILS = { detailsUrl: "", detailsHash: EMPTY_DETAILS_HASH } as const;
const QUESTION_CONTEXT_DOMAIN = keccak256(
  stringToHex("rateloop-question-context-v4"),
);
const QUESTION_REVEAL_DOMAIN = keccak256(
  stringToHex("rateloop-question-reveal-v6"),
);
const X402_SIGN_OPTIONS: NonNullable<
  Parameters<typeof signX402AuthorizationRequest>[2]
> = {
  expectedAmount: X402_AMOUNT,
  expectedChainId: 480,
  expectedUsdcAddress: X402_USDC_ADDRESS,
  expectedX402QuestionSubmitterAddress: X402_SUBMITTER_ADDRESS,
};

type TestX402AuthorizationRequest = {
  authorization: Record<string, string>;
  typedData: {
    domain: Record<string, number | string>;
    message: Record<string, string>;
    primaryType: string;
    types: Record<string, Array<{ name: string; type: string }>>;
  };
};

const BYTES32_ONE = `0x${"1".repeat(64)}` as const;

function rewardTerms(amount = BigInt(X402_AMOUNT)) {
  return {
    amount,
    asset: 1,
    bountyStartBy: BOUNTY_START_BY,
    bountyWindowSeconds: BOUNTY_WINDOW_SECONDS,
    bountyEligibility: 0,
    feedbackWindowSeconds: FEEDBACK_WINDOW_SECONDS,
    requiredSettledRounds: 1n,
    requiredVoters: 3n,
  };
}

function roundConfigBigInt() {
  return {
    epochDuration: 1_200n,
    maxDuration: 1_200n,
    maxVoters: 100n,
    minVoters: 3n,
  };
}

function roundConfig() {
  return {
    epochDuration: 1_200,
    maxDuration: 1_200,
    maxVoters: 100,
    minVoters: 3,
  };
}

function questionSpec() {
  const template = findAgentResultTemplate("generic_rating");
  if (!template) throw new Error("Missing generic_rating template.");
  return buildQuestionSpecHashes({
    bounty: {
      amount: BigInt(X402_AMOUNT),
      asset: "USDC",
      bountyEligibility: 0,
      requiredSettledRounds: 1n,
      requiredVoters: 3n,
    },
    categoryId: 1n,
    contextUrl: QUESTION_CONTEXT_URL,
    description: "",
    imageUrls: [],
    roundConfig: roundConfigBigInt(),
    study: { bundleIndex: 0 },
    tags: [QUESTION_TAG],
    targetAudience: null,
    templateId: "generic_rating",
    templateInputs: null,
    templateVersion: 1,
    title: QUESTION_TITLE,
    videoUrl: "",
    voteSemantics: template.voteSemantics,
  });
}

function canonicalPayload() {
  const spec = questionSpec();
  return {
    bounty: {
      amount: X402_AMOUNT,
      asset: "USDC",
      requiredSettledRounds: "1",
      requiredVoters: "3",
      bountyStartBy: BOUNTY_START_BY.toString(),
      bountyWindowSeconds: BOUNTY_WINDOW_SECONDS.toString(),
      feedbackWindowSeconds: FEEDBACK_WINDOW_SECONDS.toString(),
      bountyEligibility: "0",
    },
    chainId: 480,
    clientRequestId: CLIENT_REQUEST_ID,
    questions: [
      {
        categoryId: "1",
        contextUrl: QUESTION_CONTEXT_URL,
        description: "",
        detailsHash: EMPTY_DETAILS_HASH,
        detailsUrl: "",
        imageUrls: [],
        questionMetadataHash: spec.questionMetadataHash,
        resultSpecHash: spec.resultSpecHash,
        tags: [QUESTION_TAG],
        targetAudience: null,
        templateId: "generic_rating",
        templateInputs: null,
        templateVersion: 1,
        title: QUESTION_TITLE,
        videoUrl: "",
      },
    ],
    roundConfig: {
      epochDuration: "1200",
      maxDuration: "1200",
      minVoters: "3",
      maxVoters: "100",
    },
  };
}

function expectedPayloadHash() {
  return createHash("sha256")
    .update(JSON.stringify(canonicalPayload()))
    .digest("hex");
}

function expectedOperationKey() {
  return `0x${createHash("sha256").update(`rateloop:x402-question:${expectedPayloadHash()}`).digest("hex")}` as const;
}

function expectedSubmissionKey() {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "string" },
        { type: "string" },
        { type: "string" },
        { type: "string" },
      ],
      [
        QUESTION_CONTEXT_DOMAIN,
        1n,
        keccak256(
          encodeAbiParameters(
            [{ type: "string[]" }, { type: "string" }],
            [[], ""],
          ),
        ),
        submissionDetailsHash(),
        QUESTION_CONTEXT_URL,
        QUESTION_TITLE,
        "",
        QUESTION_TAG,
      ],
    ),
  );
}

function expectedSalt() {
  return `0x${createHash("sha256")
    .update(
      [
        "rateloop",
        "agent-wallet-question-salt",
        expectedOperationKey(),
        expectedPayloadHash(),
        account.address.toLowerCase(),
        expectedSubmissionKey(),
        "0",
      ].join(":"),
    )
    .digest("hex")}` as const;
}

function rewardTermsHash() {
  const terms = rewardTerms();
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint8" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint8" },
      ],
      [
        terms.asset,
        terms.amount,
        terms.requiredVoters,
        terms.requiredSettledRounds,
        terms.bountyStartBy,
        terms.bountyWindowSeconds,
        terms.feedbackWindowSeconds,
        terms.bountyEligibility,
      ],
    ),
  );
}

function roundConfigHash() {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint32" },
        { type: "uint32" },
        { type: "uint16" },
        { type: "uint16" },
      ],
      [1_200, 1_200, 3, 100],
    ),
  );
}

function submissionDetailsHash() {
  return keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "bytes32" }],
      ["", EMPTY_DETAILS_HASH],
    ),
  );
}

function expectedRevealCommitment() {
  const spec = questionSpec();
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "address" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [
        QUESTION_REVEAL_DOMAIN,
        expectedSubmissionKey(),
        keccak256(
          encodeAbiParameters(
            [{ type: "string[]" }, { type: "string" }],
            [[], ""],
          ),
        ),
        keccak256(
          encodeAbiParameters(
            [{ type: "string" }, { type: "string" }, { type: "string" }],
            [QUESTION_TITLE, "", QUESTION_TAG],
          ),
        ),
        submissionDetailsHash(),
        1n,
        expectedSalt(),
        account.address,
        rewardTermsHash(),
        roundConfigHash(),
        spec.questionMetadataHash,
        spec.resultSpecHash,
      ],
    ),
  );
}

function x402StringArrayHash(values: readonly string[]) {
  return keccak256(
    `0x${values.map((value) => keccak256(stringToHex(value)).slice(2)).join("")}` as Hex,
  );
}

function x402PaymentNonce(from = account.address) {
  const spec = questionSpec();
  const submissionPayloadHash = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "bytes32" },
      ],
      [
        keccak256(stringToHex(QUESTION_CONTEXT_URL)),
        x402StringArrayHash([]),
        keccak256(stringToHex("")),
        keccak256(stringToHex("")),
        EMPTY_DETAILS_HASH,
        keccak256(stringToHex(QUESTION_TITLE)),
        keccak256(stringToHex("")),
        keccak256(stringToHex(QUESTION_TAG)),
        1n,
        expectedSalt(),
      ],
    ),
  );
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [
        keccak256(stringToHex("rateloop-x402-question-payment-v3")),
        480n,
        CONTENT_REGISTRY_ADDRESS,
        QUESTION_REWARD_ESCROW_ADDRESS,
        X402_SUBMITTER_ADDRESS,
        from,
        X402_SUBMITTER_ADDRESS,
        BigInt(X402_AMOUNT),
        BigInt(X402_VALID_AFTER),
        BigInt(X402_VALID_BEFORE),
        submissionPayloadHash,
        rewardTermsHash(),
        roundConfigHash(),
        spec.questionMetadataHash,
        spec.resultSpecHash,
      ],
    ),
  );
}

function reserveSubmissionData(revealCommitment = expectedRevealCommitment()) {
  return encodeFunctionData({
    abi: ContentRegistryAbi,
    args: [revealCommitment],
    functionName: "reserveSubmission",
  });
}

function submitQuestionData(amount = BigInt(X402_AMOUNT)) {
  return encodeFunctionData({
    abi: ContentRegistryAbi,
    args: [
      QUESTION_CONTEXT_URL,
      [],
      "",
      QUESTION_TITLE,
      "",
      QUESTION_TAG,
      1n,
      EMPTY_DETAILS,
      expectedSalt(),
      rewardTerms(amount),
      roundConfig(),
      questionSpec(),
    ],
    functionName: "submitQuestionWithRewardAndRoundConfig",
  });
}

function submitX402QuestionData(amount = BigInt(X402_AMOUNT)) {
  const signature = parseSignature(TEST_SIGNATURE);
  return encodeFunctionData({
    abi: X402QuestionSubmitterAbi,
    args: [
      QUESTION_CONTEXT_URL,
      [],
      "",
      QUESTION_TITLE,
      "",
      QUESTION_TAG,
      1n,
      EMPTY_DETAILS,
      expectedSalt(),
      rewardTerms(amount),
      roundConfig(),
      questionSpec(),
      {
        from: account.address,
        nonce: x402PaymentNonce(),
        r: signature.r,
        s: signature.s,
        to: X402_SUBMITTER_ADDRESS,
        v: Number(signature.v ?? BigInt(signature.yParity + 27)),
        validAfter: BigInt(X402_VALID_AFTER),
        validBefore: BigInt(X402_VALID_BEFORE),
        value: amount,
      },
    ],
    functionName: "submitQuestionWithX402Payment",
  });
}

function signedX402Authorization(
  overrides: Partial<
    Record<
      keyof ReturnType<typeof x402AuthorizationRequest>["authorization"],
      string
    >
  > = {},
) {
  return {
    ...x402AuthorizationRequest().authorization,
    ...overrides,
    signature: TEST_SIGNATURE,
  };
}

function walletCallsResponse(
  overrides: Partial<AskHumansResponse> = {},
): AskHumansResponse {
  return {
    chainId: 480,
    operationKey: expectedOperationKey(),
    payment: {
      amount: X402_AMOUNT,
      asset: "USDC",
      spender: QUESTION_REWARD_ESCROW_ADDRESS,
      tokenAddress: X402_USDC_ADDRESS,
    },
    paymentMode: "wallet_calls",
    payloadHash: expectedPayloadHash(),
    status: "awaiting_wallet_signature",
    transactionPlan: {
      calls: [
        {
          data: encodeFunctionData({
            abi: erc20Abi,
            args: [QUESTION_REWARD_ESCROW_ADDRESS, BigInt(X402_AMOUNT)],
            functionName: "approve",
          }),
          phase: "approve_usdc",
          to: X402_USDC_ADDRESS,
          value: "0",
        },
        {
          data: reserveSubmissionData(),
          phase: "reserve_submission",
          to: CONTENT_REGISTRY_ADDRESS,
          value: "0",
        },
        {
          data: submitQuestionData(),
          phase: "submit_question",
          to: CONTENT_REGISTRY_ADDRESS,
          value: "0",
        },
      ],
      requiresOrderedExecution: true,
    },
    wallet: { address: account.address, fundingMode: "agent_wallet" },
    ...overrides,
  };
}

function x402CallsResponse(
  overrides: Partial<AskHumansResponse> = {},
): AskHumansResponse {
  return {
    chainId: 480,
    operationKey: expectedOperationKey(),
    payment: {
      amount: X402_AMOUNT,
      asset: "USDC",
      spender: X402_SUBMITTER_ADDRESS,
      tokenAddress: X402_USDC_ADDRESS,
    },
    paymentMode: "x402_authorization",
    payloadHash: expectedPayloadHash(),
    status: "awaiting_wallet_signature",
    transactionPlan: {
      calls: [
        {
          data: reserveSubmissionData(),
          phase: "reserve_submission",
          to: CONTENT_REGISTRY_ADDRESS,
          value: "0",
        },
        {
          data: submitX402QuestionData(),
          phase: "submit_x402_question",
          to: X402_SUBMITTER_ADDRESS,
          value: "0",
        },
      ],
      requiresOrderedExecution: true,
    },
    wallet: { address: account.address, fundingMode: "x402_authorization" },
    ...overrides,
  };
}

function validationConfig() {
  return {
    contentRegistryAddress: CONTENT_REGISTRY_ADDRESS,
    questionRewardPoolEscrowAddress: QUESTION_REWARD_ESCROW_ADDRESS,
    usdcAddress: X402_USDC_ADDRESS,
    x402QuestionSubmitterAddress: X402_SUBMITTER_ADDRESS,
  };
}

function x402AuthorizationRequest(
  from = account.address,
): TestX402AuthorizationRequest {
  const authorization = {
    from,
    nonce: x402PaymentNonce(from),
    to: X402_SUBMITTER_ADDRESS,
    validAfter: X402_VALID_AFTER,
    validBefore: X402_VALID_BEFORE,
    value: X402_AMOUNT,
  };

  return {
    authorization,
    typedData: {
      domain: {
        chainId: 480,
        name: "USDC",
        verifyingContract: X402_USDC_ADDRESS,
        version: "2",
      },
      message: { ...authorization },
      primaryType: "ReceiveWithAuthorization",
      types: {
        ReceiveWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
    },
  };
}

function askPayload(walletAddress?: string): AskHumansRequest {
  return {
    bounty: {
      amount: X402_AMOUNT,
      bountyEligibility: "0",
      bountyStartBy: BOUNTY_START_BY.toString(),
      bountyWindowSeconds: BOUNTY_WINDOW_SECONDS.toString(),
      feedbackWindowSeconds: FEEDBACK_WINDOW_SECONDS.toString(),
      requiredSettledRounds: "1",
      requiredVoters: "3",
    },
    clientRequestId: CLIENT_REQUEST_ID,
    question: {
      categoryId: "1",
      contextUrl: QUESTION_CONTEXT_URL,
      tags: [QUESTION_TAG],
      title: QUESTION_TITLE,
    },
    roundConfig: {
      epochDuration: "1200",
      maxDuration: "1200",
      maxVoters: "100",
      minVoters: "3",
    },
    walletAddress,
  };
}

describe("local signer", () => {
  it("sets and guards the ask wallet address", () => {
    expect(
      withLocalSignerWallet(askPayload(), account.address).walletAddress,
    ).toBe(account.address);

    expect(() =>
      withLocalSignerWallet(
        askPayload("0x00000000000000000000000000000000000000aa"),
        account.address,
      ),
    ).toThrow(/does not match local signer/);
  });

  it("signs native x402 authorization requests", async () => {
    const paymentAuthorization = await signX402AuthorizationRequest(
      account,
      x402AuthorizationRequest(),
      X402_SIGN_OPTIONS,
    );

    expect(paymentAuthorization).toMatchObject({
      from: account.address,
      nonce: x402PaymentNonce(),
      to: X402_SUBMITTER_ADDRESS,
      validAfter: X402_VALID_AFTER,
      validBefore: X402_VALID_BEFORE,
      value: X402_AMOUNT,
    });
    expect(paymentAuthorization.signature).toMatch(/^0x[0-9a-f]{130}$/i);
  });

  it("rejects x402 authorizations for the wrong chain", async () => {
    await expect(
      signX402AuthorizationRequest(account, x402AuthorizationRequest(), {
        ...X402_SIGN_OPTIONS,
        expectedChainId: 4801,
      }),
    ).rejects.toThrow(/does not match local signer chain 4801/);
  });

  it("rejects x402 authorizations with an unexpected typed-data shape", async () => {
    const request = x402AuthorizationRequest();
    request.typedData.primaryType = "Permit";

    await expect(
      signX402AuthorizationRequest(account, request, X402_SIGN_OPTIONS),
    ).rejects.toThrow(/primaryType must be ReceiveWithAuthorization/);
  });

  it("rejects x402 authorizations for an untrusted USDC contract", async () => {
    const request = x402AuthorizationRequest();
    request.typedData.domain.verifyingContract =
      "0x00000000000000000000000000000000000000dd";

    await expect(
      signX402AuthorizationRequest(account, request, X402_SIGN_OPTIONS),
    ).rejects.toThrow(/verifyingContract must be the configured USDC token/);
  });

  it("rejects x402 authorizations when authorization and message differ", async () => {
    const request = x402AuthorizationRequest();
    request.typedData.message.value = "1500001";

    await expect(
      signX402AuthorizationRequest(account, request, X402_SIGN_OPTIONS),
    ).rejects.toThrow(/authorization.value must match typedData.message.value/);
  });

  it("rejects x402 authorizations for the wrong submitter or amount", async () => {
    await expect(
      signX402AuthorizationRequest(account, x402AuthorizationRequest(), {
        ...X402_SIGN_OPTIONS,
        expectedAmount: "1500001",
      }),
    ).rejects.toThrow(/value must equal the requested bounty amount/);

    await expect(
      signX402AuthorizationRequest(account, x402AuthorizationRequest(), {
        ...X402_SIGN_OPTIONS,
        expectedX402QuestionSubmitterAddress:
          "0x00000000000000000000000000000000000000dd",
      }),
    ).rejects.toThrow(
      /authorization.to must be the configured RateLoop x402 submitter/,
    );
  });

  it("rejects x402 authorizations with an invalid validity window", async () => {
    const request = x402AuthorizationRequest();
    request.authorization.validBefore = "0";
    request.typedData.message.validBefore = "0";

    await expect(
      signX402AuthorizationRequest(account, request, X402_SIGN_OPTIONS),
    ).rejects.toThrow(/validBefore must be greater than validAfter/);
  });

  it("rejects x402 authorizations whose nonce is not bound to the ask payload", async () => {
    await expect(
      signX402AuthorizationRequest(account, x402AuthorizationRequest(), {
        ...X402_SIGN_OPTIONS,
        expectedNonce: BYTES32_ONE,
      }),
    ).rejects.toThrow(/nonce does not match/);
  });

  it("validates wallet-call transaction plans before execution", () => {
    const calls = validateLocalSignerTransactionPlan({
      accountAddress: account.address,
      ask: walletCallsResponse(),
      config: validationConfig(),
      expectedBountyAmount: BigInt(X402_AMOUNT),
      expectedChainId: 480,
      expectedPayload: askPayload(),
    });

    expect(calls).toHaveLength(3);
  });

  it("validates signed x402 transaction plans before execution", () => {
    const calls = validateLocalSignerTransactionPlan({
      accountAddress: account.address,
      ask: x402CallsResponse(),
      config: validationConfig(),
      expectedBountyAmount: BigInt(X402_AMOUNT),
      expectedChainId: 480,
      expectedPaymentAuthorization: signedX402Authorization(),
      expectedPayload: askPayload(),
    });

    expect(calls).toHaveLength(2);
  });

  it("rejects transaction plans whose submission calldata differs from the ask payload", () => {
    const changedTitleData = encodeFunctionData({
      abi: ContentRegistryAbi,
      args: [
        QUESTION_CONTEXT_URL,
        [],
        "",
        "Changed question title",
        "",
        QUESTION_TAG,
        1n,
        EMPTY_DETAILS,
        expectedSalt(),
        rewardTerms(),
        roundConfig(),
        questionSpec(),
      ],
      functionName: "submitQuestionWithRewardAndRoundConfig",
    });

    expect(() =>
      validateLocalSignerTransactionPlan({
        accountAddress: account.address,
        ask: walletCallsResponse({
          transactionPlan: {
            ...walletCallsResponse().transactionPlan,
            calls: [
              walletCallsResponse().transactionPlan!.calls![0]!,
              walletCallsResponse().transactionPlan!.calls![1]!,
              {
                ...walletCallsResponse().transactionPlan!.calls![2]!,
                data: changedTitleData,
              },
            ],
            requiresOrderedExecution: true,
          },
        }),
        config: validationConfig(),
        expectedBountyAmount: BigInt(X402_AMOUNT),
        expectedChainId: 480,
        expectedPayload: askPayload(),
      }),
    ).toThrow(/title must match/);
  });

  it("rejects transaction plans with reserve commitments not derived from the ask payload", () => {
    expect(() =>
      validateLocalSignerTransactionPlan({
        accountAddress: account.address,
        ask: walletCallsResponse({
          transactionPlan: {
            ...walletCallsResponse().transactionPlan,
            calls: [
              walletCallsResponse().transactionPlan!.calls![0]!,
              {
                ...walletCallsResponse().transactionPlan!.calls![1]!,
                data: reserveSubmissionData(BYTES32_ONE),
              },
              walletCallsResponse().transactionPlan!.calls![2]!,
            ],
            requiresOrderedExecution: true,
          },
        }),
        config: validationConfig(),
        expectedBountyAmount: BigInt(X402_AMOUNT),
        expectedChainId: 480,
        expectedPayload: askPayload(),
      }),
    ).toThrow(/revealCommitment must match/);
  });

  it("rejects x402 transaction plans that do not use the exact signed authorization", () => {
    expect(() =>
      validateLocalSignerTransactionPlan({
        accountAddress: account.address,
        ask: x402CallsResponse(),
        config: validationConfig(),
        expectedBountyAmount: BigInt(X402_AMOUNT),
        expectedChainId: 480,
        expectedPaymentAuthorization: {
          ...signedX402Authorization(),
          signature: `0x${"2".repeat(64)}${"4".repeat(64)}1c`,
        },
        expectedPayload: askPayload(),
      }),
    ).toThrow(/paymentAuthorization.r must match/);
  });

  it("rejects transaction plans with untrusted targets or spend amounts", () => {
    const wrongTarget = walletCallsResponse({
      transactionPlan: {
        ...walletCallsResponse().transactionPlan,
        calls: [
          {
            ...walletCallsResponse().transactionPlan!.calls![0]!,
            to: "0x00000000000000000000000000000000000000ff",
          },
          ...walletCallsResponse().transactionPlan!.calls!.slice(1),
        ],
        requiresOrderedExecution: true,
      },
    });
    expect(() =>
      validateLocalSignerTransactionPlan({
        accountAddress: account.address,
        ask: wrongTarget,
        config: validationConfig(),
        expectedBountyAmount: BigInt(X402_AMOUNT),
        expectedChainId: 480,
        expectedPayload: askPayload(),
      }),
    ).toThrow(/to must be/);

    const wrongAmount = walletCallsResponse({
      transactionPlan: {
        ...walletCallsResponse().transactionPlan,
        calls: [
          {
            ...walletCallsResponse().transactionPlan!.calls![0]!,
            data: encodeFunctionData({
              abi: erc20Abi,
              args: [QUESTION_REWARD_ESCROW_ADDRESS, BigInt(X402_AMOUNT) + 1n],
              functionName: "approve",
            }),
          },
          ...walletCallsResponse().transactionPlan!.calls!.slice(1),
        ],
        requiresOrderedExecution: true,
      },
    });
    expect(() =>
      validateLocalSignerTransactionPlan({
        accountAddress: account.address,
        ask: wrongAmount,
        config: validationConfig(),
        expectedBountyAmount: BigInt(X402_AMOUNT),
        expectedChainId: 480,
        expectedPayload: askPayload(),
      }),
    ).toThrow(/approve amount must equal/);
  });

  it("rejects transaction plans with unknown selectors or mismatched wallets", () => {
    expect(() =>
      validateLocalSignerTransactionPlan({
        accountAddress: account.address,
        ask: walletCallsResponse({
          wallet: { address: "0x00000000000000000000000000000000000000ff" },
        }),
        config: validationConfig(),
        expectedBountyAmount: BigInt(X402_AMOUNT),
        expectedChainId: 480,
        expectedPayload: askPayload(),
      }),
    ).toThrow(/does not match local signer/);

    const badSelector = x402CallsResponse({
      transactionPlan: {
        ...x402CallsResponse().transactionPlan,
        calls: [
          x402CallsResponse().transactionPlan!.calls![0]!,
          {
            ...x402CallsResponse().transactionPlan!.calls![1]!,
            data: reserveSubmissionData(),
          },
        ],
        requiresOrderedExecution: true,
      },
    });
    expect(() =>
      validateLocalSignerTransactionPlan({
        accountAddress: account.address,
        ask: badSelector,
        config: validationConfig(),
        expectedBountyAmount: BigInt(X402_AMOUNT),
        expectedChainId: 480,
        expectedPaymentAuthorization: signedX402Authorization(),
        expectedPayload: askPayload(),
      }),
    ).toThrow(/unexpected function selector/);
  });

  it("re-calls askHumans with a signed x402 authorization", async () => {
    const askCalls: AskHumansRequest[] = [];
    const agent = {
      askHumans: async (
        request: AskHumansRequest,
      ): Promise<AskHumansResponse> => {
        askCalls.push(request);
        if (!request.paymentAuthorization) {
          return {
            operationKey: expectedOperationKey(),
            payloadHash: expectedPayloadHash(),
            paymentMode: "x402_authorization",
            x402AuthorizationRequest: x402AuthorizationRequest(),
          };
        }

        return {
          operationKey: expectedOperationKey(),
          paymentMode: "x402_authorization",
          transactionPlan: { calls: [], requiresOrderedExecution: true },
        };
      },
      confirmAskTransactions: async () => {
        throw new Error(
          "confirmAskTransactions should not run without transaction hashes.",
        );
      },
    } satisfies Pick<
      RateLoopAgentClient,
      "askHumans" | "confirmAskTransactions"
    >;

    const result = await askHumansWithLocalSigner({
      account,
      agent,
      config: {
        chainId: 480,
        chainName: "test",
        contentRegistryAddress: CONTENT_REGISTRY_ADDRESS,
        pollingIntervalMs: 1,
        questionRewardPoolEscrowAddress: QUESTION_REWARD_ESCROW_ADDRESS,
        receiptTimeoutMs: 1,
        usdcAddress: X402_USDC_ADDRESS,
        x402QuestionSubmitterAddress: X402_SUBMITTER_ADDRESS,
      },
      payload: askPayload(),
      paymentMode: "x402_authorization",
    });

    expect(result.signedX402Authorization).toBe(true);
    expect(askCalls).toHaveLength(2);
    expect(askCalls[0]).toMatchObject({
      chainId: 480,
      paymentMode: "x402_authorization",
      walletAddress: account.address,
    });
    expect(askCalls[1].paymentAuthorization?.signature).toMatch(
      /^0x[0-9a-f]{130}$/i,
    );
    expect(result.transactions).toBeUndefined();
  });

  it("rejects ask payloads that target a different configured chain", async () => {
    const agent = {
      askHumans: async () => {
        throw new Error("askHumans should not run for a chain mismatch.");
      },
      confirmAskTransactions: async () => {
        throw new Error(
          "confirmAskTransactions should not run for a chain mismatch.",
        );
      },
    } satisfies Pick<
      RateLoopAgentClient,
      "askHumans" | "confirmAskTransactions"
    >;

    await expect(
      askHumansWithLocalSigner({
        account,
        agent,
        config: {
          chainId: 480,
          chainName: "test",
          pollingIntervalMs: 1,
          receiptTimeoutMs: 1,
        },
        payload: {
          ...askPayload(),
          chainId: 4801,
        },
      }),
    ).rejects.toThrow(/chainId 4801 does not match local signer chain 480/);
  });
});

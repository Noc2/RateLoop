import { describe, expect, it } from "vitest";
import { ContentRegistryAbi, X402QuestionSubmitterAbi } from "@rateloop/contracts/abis";
import { encodeFunctionData, erc20Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  askHumansWithLocalSigner,
  signX402AuthorizationRequest,
  validateLocalSignerTransactionPlan,
  withLocalSignerWallet,
} from "../localSigner.js";
import type { AskHumansRequest, AskHumansResponse, RateLoopAgentClient } from "@rateloop/sdk/agent";

const PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const account = privateKeyToAccount(PRIVATE_KEY);
const X402_SUBMITTER_ADDRESS = "0x00000000000000000000000000000000000000bb" as const;
const X402_USDC_ADDRESS = "0x00000000000000000000000000000000000000cc" as const;
const CONTENT_REGISTRY_ADDRESS = "0x00000000000000000000000000000000000000dd" as const;
const QUESTION_REWARD_ESCROW_ADDRESS = "0x00000000000000000000000000000000000000ee" as const;
const X402_AMOUNT = "1500000";
const X402_SIGN_OPTIONS: NonNullable<Parameters<typeof signX402AuthorizationRequest>[2]> = {
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
const BYTES32_TWO = `0x${"2".repeat(64)}` as const;
const BYTES32_THREE = `0x${"3".repeat(64)}` as const;

function rewardTerms(amount = BigInt(X402_AMOUNT)) {
  return {
    amount,
    asset: 1,
    bountyClosesAt: 1_893_456_000n,
    bountyEligibility: 0,
    feedbackClosesAt: 0n,
    requiredSettledRounds: 1n,
    requiredVoters: 3n,
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
  return {
    questionMetadataHash: BYTES32_TWO,
    resultSpecHash: BYTES32_THREE,
  };
}

function reserveSubmissionData() {
  return encodeFunctionData({
    abi: ContentRegistryAbi,
    args: [BYTES32_ONE],
    functionName: "reserveSubmission",
  });
}

function submitQuestionData(amount = BigInt(X402_AMOUNT)) {
  return encodeFunctionData({
    abi: ContentRegistryAbi,
    args: [
      "https://example.com/context",
      [],
      "",
      "Should this agent proceed?",
      "",
      "agent",
      1n,
      BYTES32_ONE,
      rewardTerms(amount),
      roundConfig(),
      questionSpec(),
    ],
    functionName: "submitQuestionWithRewardAndRoundConfig",
  });
}

function submitX402QuestionData(amount = BigInt(X402_AMOUNT)) {
  return encodeFunctionData({
    abi: X402QuestionSubmitterAbi,
    args: [
      "https://example.com/context",
      [],
      "",
      "Should this agent proceed?",
      "",
      "agent",
      1n,
      BYTES32_ONE,
      rewardTerms(amount),
      roundConfig(),
      questionSpec(),
      {
        from: account.address,
        nonce: BYTES32_TWO,
        r: BYTES32_ONE,
        s: BYTES32_THREE,
        to: X402_SUBMITTER_ADDRESS,
        v: 27,
        validAfter: 0n,
        validBefore: 9_999_999_999n,
        value: amount,
      },
    ],
    functionName: "submitQuestionWithX402Payment",
  });
}

function walletCallsResponse(overrides: Partial<AskHumansResponse> = {}): AskHumansResponse {
  return {
    chainId: 480,
    operationKey: `0x${"4".repeat(64)}`,
    payment: {
      amount: X402_AMOUNT,
      asset: "USDC",
      spender: QUESTION_REWARD_ESCROW_ADDRESS,
      tokenAddress: X402_USDC_ADDRESS,
    },
    paymentMode: "wallet_calls",
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
        { data: reserveSubmissionData(), phase: "reserve_submission", to: CONTENT_REGISTRY_ADDRESS, value: "0" },
        { data: submitQuestionData(), phase: "submit_question", to: CONTENT_REGISTRY_ADDRESS, value: "0" },
      ],
      requiresOrderedExecution: true,
    },
    wallet: { address: account.address, fundingMode: "agent_wallet" },
    ...overrides,
  };
}

function x402CallsResponse(overrides: Partial<AskHumansResponse> = {}): AskHumansResponse {
  return {
    chainId: 480,
    operationKey: `0x${"5".repeat(64)}`,
    payment: {
      amount: X402_AMOUNT,
      asset: "USDC",
      spender: X402_SUBMITTER_ADDRESS,
      tokenAddress: X402_USDC_ADDRESS,
    },
    paymentMode: "x402_authorization",
    status: "awaiting_wallet_signature",
    transactionPlan: {
      calls: [
        { data: reserveSubmissionData(), phase: "reserve_submission", to: CONTENT_REGISTRY_ADDRESS, value: "0" },
        { data: submitX402QuestionData(), phase: "submit_x402_question", to: X402_SUBMITTER_ADDRESS, value: "0" },
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

function x402AuthorizationRequest(from = account.address): TestX402AuthorizationRequest {
  const authorization = {
    from,
    nonce: `0x${"1".repeat(64)}`,
    to: X402_SUBMITTER_ADDRESS,
    validAfter: "0",
    validBefore: "9999999999",
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
    bounty: { amount: "1500000", requiredVoters: "3" },
    clientRequestId: "local-signer-test",
    question: {
      categoryId: "1",
      contextUrl: "https://example.com",
      tags: ["agent"],
      title: "Should this agent proceed?",
    },
    walletAddress,
  };
}

describe("local signer", () => {
  it("sets and guards the ask wallet address", () => {
    expect(withLocalSignerWallet(askPayload(), account.address).walletAddress).toBe(account.address);

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
      nonce: `0x${"1".repeat(64)}`,
      to: X402_SUBMITTER_ADDRESS,
      validAfter: "0",
      validBefore: "9999999999",
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

    await expect(signX402AuthorizationRequest(account, request, X402_SIGN_OPTIONS)).rejects.toThrow(
      /primaryType must be ReceiveWithAuthorization/,
    );
  });

  it("rejects x402 authorizations for an untrusted USDC contract", async () => {
    const request = x402AuthorizationRequest();
    request.typedData.domain.verifyingContract = "0x00000000000000000000000000000000000000dd";

    await expect(signX402AuthorizationRequest(account, request, X402_SIGN_OPTIONS)).rejects.toThrow(
      /verifyingContract must be the configured USDC token/,
    );
  });

  it("rejects x402 authorizations when authorization and message differ", async () => {
    const request = x402AuthorizationRequest();
    request.typedData.message.value = "1500001";

    await expect(signX402AuthorizationRequest(account, request, X402_SIGN_OPTIONS)).rejects.toThrow(
      /authorization.value must match typedData.message.value/,
    );
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
        expectedX402QuestionSubmitterAddress: "0x00000000000000000000000000000000000000dd",
      }),
    ).rejects.toThrow(/authorization.to must be the configured RateLoop x402 submitter/);
  });

  it("rejects x402 authorizations with an invalid validity window", async () => {
    const request = x402AuthorizationRequest();
    request.authorization.validBefore = "0";
    request.typedData.message.validBefore = "0";

    await expect(signX402AuthorizationRequest(account, request, X402_SIGN_OPTIONS)).rejects.toThrow(
      /validBefore must be greater than validAfter/,
    );
  });

  it("validates wallet-call transaction plans before execution", () => {
    const calls = validateLocalSignerTransactionPlan({
      accountAddress: account.address,
      ask: walletCallsResponse(),
      config: validationConfig(),
      expectedBountyAmount: BigInt(X402_AMOUNT),
      expectedChainId: 480,
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
    });

    expect(calls).toHaveLength(2);
  });

  it("rejects transaction plans with untrusted targets or spend amounts", () => {
    const wrongTarget = walletCallsResponse({
      transactionPlan: {
        ...walletCallsResponse().transactionPlan,
        calls: [
          { ...walletCallsResponse().transactionPlan!.calls![0]!, to: "0x00000000000000000000000000000000000000ff" },
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
      }),
    ).toThrow(/does not match local signer/);

    const badSelector = x402CallsResponse({
      transactionPlan: {
        ...x402CallsResponse().transactionPlan,
        calls: [
          x402CallsResponse().transactionPlan!.calls![0]!,
          { ...x402CallsResponse().transactionPlan!.calls![1]!, data: reserveSubmissionData() },
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
      }),
    ).toThrow(/unexpected function selector/);
  });

  it("re-calls askHumans with a signed x402 authorization", async () => {
    const askCalls: AskHumansRequest[] = [];
    const agent = {
      askHumans: async (request: AskHumansRequest): Promise<AskHumansResponse> => {
        askCalls.push(request);
        if (!request.paymentAuthorization) {
          return {
            operationKey: `0x${"2".repeat(64)}`,
            paymentMode: "x402_authorization",
            x402AuthorizationRequest: x402AuthorizationRequest(),
          };
        }

        return {
          operationKey: `0x${"2".repeat(64)}`,
          paymentMode: "x402_authorization",
          transactionPlan: { calls: [], requiresOrderedExecution: true },
        };
      },
      confirmAskTransactions: async () => {
        throw new Error("confirmAskTransactions should not run without transaction hashes.");
      },
    } satisfies Pick<RateLoopAgentClient, "askHumans" | "confirmAskTransactions">;

    const result = await askHumansWithLocalSigner({
      account,
      agent,
      config: {
        chainId: 480,
        chainName: "test",
        pollingIntervalMs: 1,
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
    expect(askCalls[1].paymentAuthorization?.signature).toMatch(/^0x[0-9a-f]{130}$/i);
    expect(result.transactions).toBeUndefined();
  });

  it("rejects ask payloads that target a different configured chain", async () => {
    const agent = {
      askHumans: async () => {
        throw new Error("askHumans should not run for a chain mismatch.");
      },
      confirmAskTransactions: async () => {
        throw new Error("confirmAskTransactions should not run for a chain mismatch.");
      },
    } satisfies Pick<RateLoopAgentClient, "askHumans" | "confirmAskTransactions">;

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

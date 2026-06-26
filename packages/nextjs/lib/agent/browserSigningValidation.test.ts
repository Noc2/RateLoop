import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBrowserSigningExpectedX402Nonce,
  readBrowserSigningBountyAmount,
  readBrowserSigningExpectedX402Amount,
  validateBrowserX402AuthorizationRequest,
} from "~~/lib/agent/browserSigningValidation";

const wallet = "0x00000000000000000000000000000000000000aa";
const submitter = "0x00000000000000000000000000000000000000bb";
const usdc = "0x00000000000000000000000000000000000000cc";
const contentRegistry = "0x00000000000000000000000000000000000000dd";
const rewardEscrow = "0x00000000000000000000000000000000000000ee";
const feedbackBonusEscrow = "0x00000000000000000000000000000000000000ff";
const amount = "1500000";

function validBefore(secondsFromNow = 3600) {
  return String(Math.floor(Date.now() / 1000) + secondsFromNow);
}

function askRequestBody(overrides: Record<string, unknown> = {}) {
  return {
    clientRequestId: "browser-signing-test",
    chainId: 480,
    question: {
      categoryId: "5",
      contextUrl: "https://example.com/product/spec",
      tags: "product",
      title: "Which product launch option is stronger?",
    },
    bounty: {
      amount,
      bountyEligibility: "0",
      bountyStartBy: "1900000000",
      bountyWindowSeconds: "7200",
      feedbackWindowSeconds: "3600",
      requiredSettledRounds: "1",
      requiredVoters: "3",
    },
    ...overrides,
  };
}

function authorizationRequest(
  overrides: {
    amount?: string;
    authorization?: Record<string, unknown>;
    domain?: Record<string, unknown>;
    message?: Record<string, unknown>;
    primaryType?: string;
    requestBody?: Record<string, unknown>;
    types?: unknown;
  } = {},
) {
  const requestBody = overrides.requestBody ?? askRequestBody();
  const chainId = typeof requestBody.chainId === "number" ? requestBody.chainId : 480;
  const authorization = {
    from: wallet,
    nonce: `0x${"0".repeat(64)}` as `0x${string}`,
    to: submitter,
    validAfter: "0",
    validBefore: validBefore(),
    value: overrides.amount ?? amount,
    ...overrides.authorization,
  };

  if (!overrides.authorization || !("nonce" in overrides.authorization)) {
    authorization.nonce = buildBrowserSigningExpectedX402Nonce({
      expectedChainId: chainId,
      expectedContentRegistryAddress: contentRegistry,
      expectedFeedbackBonusEscrowAddress: feedbackBonusEscrow,
      expectedQuestionRewardPoolEscrowAddress: rewardEscrow,
      expectedSubmitterAddress: submitter,
      expectedWalletAddress: wallet,
      requestBody,
      x402Authorization: authorization,
    });
  }

  const request = {
    authorization,
    eip712: {
      domain: {
        chainId,
        name: "USDC",
        verifyingContract: usdc,
        version: "2",
        ...overrides.domain,
      },
      message: {
        ...authorization,
        ...overrides.message,
      },
      primaryType: overrides.primaryType ?? "ReceiveWithAuthorization",
      types: overrides.types ?? {
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
  return { request, requestBody };
}

function validate(input = authorizationRequest()) {
  return validateBrowserX402AuthorizationRequest({
    expectedAmount: readBrowserSigningExpectedX402Amount(input.requestBody),
    expectedChainId: Number(input.requestBody.chainId),
    expectedContentRegistryAddress: contentRegistry,
    expectedFeedbackBonusEscrowAddress: feedbackBonusEscrow,
    expectedQuestionRewardPoolEscrowAddress: rewardEscrow,
    expectedSubmitterAddress: submitter,
    expectedUsdcAddress: usdc,
    expectedWalletAddress: wallet,
    request: input.request,
    requestBody: input.requestBody,
  });
}

test("validateBrowserX402AuthorizationRequest accepts exact RateLoop EIP-3009 typed data", () => {
  const result = validate();

  assert.equal(result.authorization.from, wallet);
  assert.equal(result.authorization.value, amount);
  assert.equal(result.typedData.domain.verifyingContract, usdc);
  assert.equal(readBrowserSigningBountyAmount({ bounty: { amount } }), amount);
  assert.equal(readBrowserSigningExpectedX402Amount({ bounty: { amount } }), amount);
  assert.equal(
    readBrowserSigningExpectedX402Amount({
      bounty: { amount },
      feedbackBonus: { amount: "500000", asset: "USDC" },
    }),
    "2000000",
  );
  assert.throws(
    () =>
      readBrowserSigningExpectedX402Amount({
        bounty: { amount },
        feedbackBonus: { amount: "500000", asset: "LREP" },
      }),
    /LREP Feedback Bonuses require wallet_calls/,
  );
});

test("validateBrowserX402AuthorizationRequest accepts USDC Feedback Bonus one-shot typed data", () => {
  const requestBody = askRequestBody({
    feedbackBonus: {
      amount: "500000",
      asset: "USDC",
      awarder: wallet,
      feedbackClosesAt: "1900001800",
    },
  });
  const result = validate(
    authorizationRequest({
      amount: "2000000",
      requestBody,
    }),
  );

  assert.equal(result.authorization.value, "2000000");
});

test("validateBrowserX402AuthorizationRequest accepts Base mainnet USDC's USD Coin domain", () => {
  const requestBody = askRequestBody({ chainId: 8453, clientRequestId: "browser-signing-base-mainnet" });
  const input = authorizationRequest({ domain: { name: "USD Coin" }, requestBody });
  const result = validate(input);

  assert.equal(result.typedData.domain.name, "USD Coin");
  assert.equal(result.typedData.domain.chainId, 8453);
});

test("validateBrowserX402AuthorizationRequest rejects non-EIP-3009 typed data", () => {
  assert.throws(
    () =>
      validate(
        authorizationRequest({
          primaryType: "Permit",
          types: {
            Permit: [
              { name: "owner", type: "address" },
              { name: "spender", type: "address" },
              { name: "value", type: "uint256" },
            ],
          },
        }),
      ),
    /primaryType must be ReceiveWithAuthorization/,
  );
});

test("validateBrowserX402AuthorizationRequest rejects wrong contracts, amounts, and validity windows", () => {
  const overlongValidBefore = validBefore(90_000);

  assert.throws(
    () =>
      validate(
        authorizationRequest({
          domain: { chainId: 8453, name: "USDC" },
          requestBody: askRequestBody({ chainId: 8453 }),
        }),
      ),
    /domain.name must be USD Coin/,
  );
  assert.throws(
    () =>
      validate(
        authorizationRequest({
          domain: { verifyingContract: "0x0000000000000000000000000000000000000001" },
        }),
      ),
    /verifyingContract must be the configured USDC token/,
  );
  assert.throws(
    () =>
      validate(
        authorizationRequest({
          amount: "1500001",
        }),
      ),
    /value must equal the requested x402 payment amount/,
  );
  assert.throws(
    () =>
      validate(
        authorizationRequest({
          authorization: { to: "0x0000000000000000000000000000000000000001" },
          message: { to: "0x0000000000000000000000000000000000000001" },
        }),
      ),
    /to must be the configured RateLoop submitter/,
  );
  assert.throws(
    () =>
      validate(
        authorizationRequest({
          authorization: { validBefore: overlongValidBefore },
          message: { validBefore: overlongValidBefore },
        }),
      ),
    /within 86400 seconds/,
  );
});

test("validateBrowserX402AuthorizationRequest rejects authorization and payload nonce mismatch", () => {
  assert.throws(
    () => validate(authorizationRequest({ message: { nonce: `0x${"2".repeat(64)}` } })),
    /authorization.nonce must match/,
  );
  assert.throws(
    () =>
      validate(
        authorizationRequest({
          authorization: { nonce: `0x${"2".repeat(64)}` },
          message: { nonce: `0x${"2".repeat(64)}` },
        }),
      ),
    /authorization.nonce does not match the RateLoop ask payload/,
  );
});

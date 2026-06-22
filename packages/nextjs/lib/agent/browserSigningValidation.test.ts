import assert from "node:assert/strict";
import test from "node:test";
import {
  readBrowserSigningBountyAmount,
  readBrowserSigningExpectedX402Amount,
  validateBrowserX402AuthorizationRequest,
} from "~~/lib/agent/browserSigningValidation";

const wallet = "0x00000000000000000000000000000000000000aa";
const submitter = "0x00000000000000000000000000000000000000bb";
const usdc = "0x00000000000000000000000000000000000000cc";
const amount = "1500000";

function authorizationRequest(overrides: Record<string, unknown> = {}) {
  const authorization = {
    from: wallet,
    nonce: `0x${"1".repeat(64)}`,
    to: submitter,
    validAfter: "0",
    validBefore: "9999999999",
    value: amount,
    ...(overrides.authorization as Record<string, unknown> | undefined),
  };

  return {
    authorization,
    eip712: {
      domain: {
        chainId: 480,
        name: "USDC",
        verifyingContract: usdc,
        version: "2",
        ...(overrides.domain as Record<string, unknown> | undefined),
      },
      message: {
        ...authorization,
        ...(overrides.message as Record<string, unknown> | undefined),
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
}

function validate(request = authorizationRequest()) {
  return validateBrowserX402AuthorizationRequest({
    expectedAmount: amount,
    expectedChainId: 480,
    expectedSubmitterAddress: submitter,
    expectedUsdcAddress: usdc,
    expectedWalletAddress: wallet,
    request,
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

test("validateBrowserX402AuthorizationRequest accepts Base mainnet USDC's USD Coin domain", () => {
  const request = authorizationRequest({ domain: { chainId: 8453, name: "USD Coin" } });
  const result = validateBrowserX402AuthorizationRequest({
    expectedAmount: amount,
    expectedChainId: 8453,
    expectedSubmitterAddress: submitter,
    expectedUsdcAddress: usdc,
    expectedWalletAddress: wallet,
    request,
  });

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

test("validateBrowserX402AuthorizationRequest rejects wrong contracts and amounts", () => {
  assert.throws(
    () =>
      validateBrowserX402AuthorizationRequest({
        expectedAmount: amount,
        expectedChainId: 8453,
        expectedSubmitterAddress: submitter,
        expectedUsdcAddress: usdc,
        expectedWalletAddress: wallet,
        request: authorizationRequest({ domain: { chainId: 8453, name: "USDC" } }),
      }),
    /domain.name must be USD Coin/,
  );
  assert.throws(
    () =>
      validate(authorizationRequest({ domain: { verifyingContract: "0x00000000000000000000000000000000000000dd" } })),
    /verifyingContract must be the configured USDC token/,
  );
  assert.throws(
    () => validate(authorizationRequest({ authorization: { value: "1500001" }, message: { value: "1500001" } })),
    /value must equal the requested x402 payment amount/,
  );
  assert.throws(
    () =>
      validate(
        authorizationRequest({
          authorization: { to: "0x00000000000000000000000000000000000000dd" },
          message: { to: "0x00000000000000000000000000000000000000dd" },
        }),
      ),
    /to must be the configured RateLoop submitter/,
  );
});

test("validateBrowserX402AuthorizationRequest rejects authorization and message mismatch", () => {
  assert.throws(
    () => validate(authorizationRequest({ message: { nonce: `0x${"2".repeat(64)}` } })),
    /authorization.nonce must match/,
  );
});

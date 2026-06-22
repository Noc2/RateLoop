import assert from "node:assert/strict";
import test from "node:test";
import { hashDomain } from "viem";
import {
  buildLrepPermitTypedData,
  buildRaterDelegateAuthorizationTypedData,
  buildUsdcReceiveWithAuthorizationTypedData,
  getDefaultSignatureDeadline,
  getSignatureParts,
} from "~~/lib/walletSignatures";

const owner = "0x0000000000000000000000000000000000000001";
const spender = "0x0000000000000000000000000000000000000002";
const tokenAddress = "0x0000000000000000000000000000000000000003";
const baseUsdcAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

test("buildLrepPermitTypedData binds the LREP permit domain and spender", () => {
  const typedData = buildLrepPermitTypedData({
    chainId: 480,
    deadline: 1234n,
    nonce: 7n,
    owner,
    spender,
    tokenAddress,
    value: 10n,
  });

  assert.equal(typedData.domain.name, "Loop Reputation");
  assert.equal(typedData.domain.version, "1");
  assert.equal(typedData.domain.chainId, 480);
  assert.equal(typedData.domain.verifyingContract, tokenAddress);
  assert.equal(typedData.message.owner, owner);
  assert.equal(typedData.message.spender, spender);
  assert.equal(typedData.message.value, 10n);
});

test("buildRaterDelegateAuthorizationTypedData binds the holder and smart-account delegate", () => {
  const registryAddress = "0x0000000000000000000000000000000000000004";
  const typedData = buildRaterDelegateAuthorizationTypedData({
    chainId: 480,
    deadline: 1234n,
    delegate: spender,
    holder: owner,
    nonce: 7n,
    registryAddress,
  });

  assert.equal(typedData.domain.name, "RateLoop RaterRegistry");
  assert.equal(typedData.domain.version, "1");
  assert.equal(typedData.domain.chainId, 480);
  assert.equal(typedData.domain.verifyingContract, registryAddress);
  assert.equal(typedData.primaryType, "DelegateAuthorization");
  assert.equal(typedData.message.holder, owner);
  assert.equal(typedData.message.delegate, spender);
  assert.equal(typedData.message.nonce, 7n);
});

test("buildUsdcReceiveWithAuthorizationTypedData builds Circle EIP-3009 typed data", () => {
  const typedData = buildUsdcReceiveWithAuthorizationTypedData({
    authorization: {
      from: owner,
      nonce: `0x${"a".repeat(64)}`,
      to: spender,
      validAfter: 1n,
      validBefore: 2n,
      value: 10n,
    },
    chainId: 480,
    tokenAddress,
  });

  assert.equal(typedData.domain.name, "USDC");
  assert.equal(typedData.domain.version, "2");
  assert.equal(typedData.primaryType, "ReceiveWithAuthorization");
  assert.equal(typedData.message.to, spender);
  assert.equal(typedData.message.nonce, `0x${"a".repeat(64)}`);
});

test("buildUsdcReceiveWithAuthorizationTypedData uses Base mainnet USDC's live EIP-712 domain", () => {
  const typedData = buildUsdcReceiveWithAuthorizationTypedData({
    authorization: {
      from: owner,
      nonce: `0x${"b".repeat(64)}`,
      to: spender,
      validAfter: 1n,
      validBefore: 2n,
      value: 10n,
    },
    chainId: 8453,
    tokenAddress: baseUsdcAddress,
  });

  assert.equal(typedData.domain.name, "USD Coin");
  assert.equal(
    hashDomain({
      domain: typedData.domain,
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
      },
    }),
    "0x02fa7265e7c5d81118673727957699e4d68f74cd74b7db77da710fe8a2c7834f",
  );
});

test("getSignatureParts normalizes a 65-byte signature", () => {
  const parts = getSignatureParts(`0x${"1".repeat(64)}${"2".repeat(64)}1b`);

  assert.equal(parts.r, `0x${"1".repeat(64)}`);
  assert.equal(parts.s, `0x${"2".repeat(64)}`);
  assert.equal(parts.v, 27);
});

test("getDefaultSignatureDeadline adds the shared validity window", () => {
  assert.equal(getDefaultSignatureDeadline(1000), 2800n);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTokenlessEip3009TypedData,
  buildTokenlessRoundAuthorizationTypedData,
  buildTokenlessRoundTermsTypedData,
  buildTokenlessX402Authorization,
  hashTokenlessRoundTerms,
  serializeTokenlessX402Authorization,
  validateTokenlessPaymentInstructions,
} from "./tokenlessPayment";
import type { TokenlessPaymentInstructions } from "./tokenlessTypes";

const addresses = {
  panelAddress: "0x1111111111111111111111111111111111111111" as const,
  x402SubmitterAddress: "0x2222222222222222222222222222222222222222" as const,
  usdcAddress: "0x3333333333333333333333333333333333333333" as const,
  funderAddress: "0x4444444444444444444444444444444444444444" as const,
};

function instructions(
  overrides: Partial<TokenlessPaymentInstructions> = {},
): TokenlessPaymentInstructions {
  return {
    operationKey: "op_payment",
    paymentMode: "x402",
    paymentState: "awaiting_authorization",
    deploymentKey: "tokenless-v3:84532:0x1111:0x2222:0x3333",
    chainId: 84532,
    ...addresses,
    totalFundedAtomic: "31875000",
    roundTerms: {
      contentId: `0x${"11".repeat(32)}`,
      termsHash: `0x${"22".repeat(32)}`,
      beaconNetworkHash: `0x${"33".repeat(32)}`,
      bountyAmount: "25000000",
      feeAmount: "1875000",
      attemptReserve: "5000000",
      attemptCompensation: "333333",
      minimumReveals: 12,
      maximumCommits: 15,
      admissionPolicyHash: `0x${"44".repeat(32)}`,
      commitDeadline: "2000000000",
      revealDeadline: "2000000120",
      beaconFailureDeadline: "2000000420",
      beaconRound: "1000",
      claimGracePeriod: "604800",
      feeRecipient: "0x5555555555555555555555555555555555555555",
    },
    roundId: null,
    transactionHash: null,
    ...overrides,
  };
}

const authorizationSpec = {
  schemaVersion: "rateloop.tokenless.payment-authorization.v1" as const,
  eip3009Domain: {
    name: "RateLoop Tokenless Test USDC",
    version: "2",
    chainId: 84532,
    verifyingContract: addresses.usdcAddress,
  },
  roundAuthorizationDomain: {
    name: "RateLoop X402 Panel Submitter",
    version: "1",
    chainId: 84532,
    verifyingContract: addresses.x402SubmitterAddress,
  },
  validAfter: "2000000000",
  validBefore: "2000000600",
  nonce: `0x${"aa".repeat(32)}` as const,
};

test("reconstructs the Solidity RoundTerms and two x402 typed-data envelopes", () => {
  const payment = instructions({ authorizationSpec });
  const roundTerms = buildTokenlessRoundTermsTypedData(payment);
  assert.equal(roundTerms.primaryType, "RoundTerms");
  assert.equal(roundTerms.message.bountyAmount, 25_000_000n);
  assert.equal(roundTerms.message.minimumReveals, 12);
  assert.equal(roundTerms.message.commitDeadline, 2_000_000_000n);

  const eip3009 = buildTokenlessEip3009TypedData(payment);
  assert.equal(eip3009.domain.verifyingContract, addresses.usdcAddress);
  assert.equal(eip3009.message.from, addresses.funderAddress);
  assert.equal(eip3009.message.to, addresses.x402SubmitterAddress);
  assert.equal(eip3009.message.value, 31_875_000n);
  assert.equal(eip3009.message.nonce, authorizationSpec.nonce);

  const roundAuthorization = buildTokenlessRoundAuthorizationTypedData(payment);
  assert.equal(
    roundAuthorization.domain.verifyingContract,
    addresses.x402SubmitterAddress,
  );
  assert.equal(roundAuthorization.message.funder, addresses.funderAddress);
  assert.equal(roundAuthorization.message.panel, addresses.panelAddress);
  assert.equal(
    roundAuthorization.message.roundTermsDigest,
    hashTokenlessRoundTerms(payment),
  );

  const built = buildTokenlessX402Authorization(payment);
  assert.equal(built.roundTermsDigest, roundAuthorization.message.roundTermsDigest);
});

test("fails closed on stale deployment facts and mismatched payment totals", () => {
  const payment = instructions({ authorizationSpec });
  assert.throws(
    () =>
      validateTokenlessPaymentInstructions(payment, {
        deploymentKey: "tokenless-v3:stale",
        chainId: 84532,
        ...addresses,
      }),
    /deploymentKey does not match/,
  );
  assert.throws(
    () =>
      buildTokenlessX402Authorization(payment, undefined, {
        deploymentKey: payment.deploymentKey,
        chainId: payment.chainId,
        panelAddress: "0x9999999999999999999999999999999999999999",
        x402SubmitterAddress: payment.x402SubmitterAddress,
        usdcAddress: payment.usdcAddress,
      }),
    /panelAddress does not match/,
  );
  assert.throws(
    () =>
      buildTokenlessEip3009TypedData({
        ...payment,
        totalFundedAtomic: "1",
      }),
    /totalFundedAtomic must equal/,
  );
  assert.throws(
    () =>
      buildTokenlessEip3009TypedData({
        ...payment,
        authorizationSpec: {
          ...authorizationSpec,
          eip3009Domain: {
            ...authorizationSpec.eip3009Domain,
            verifyingContract: addresses.x402SubmitterAddress,
          },
        },
      }),
    /verifyingContract does not match/,
  );
});

test("serializes only the exact server-side x402 evidence shape", () => {
  const nonce = `0x${"bb".repeat(32)}` as const;
  const signature = `0x${"cc".repeat(65)}` as const;
  assert.deepEqual(
    serializeTokenlessX402Authorization({
      validAfter: "10",
      validBefore: "20",
      nonce,
      v: 27,
      r: `0x${"dd".repeat(32)}`,
      s: `0x${"ee".repeat(32)}`,
      roundAuthorizationSignature: signature,
    }),
    {
      validAfter: "10",
      validBefore: "20",
      nonce,
      v: 27,
      r: `0x${"dd".repeat(32)}`,
      s: `0x${"ee".repeat(32)}`,
      roundAuthorizationSignature: signature,
    },
  );
  assert.throws(
    () =>
      serializeTokenlessX402Authorization({
        validAfter: "10",
        validBefore: "20",
        nonce,
        v: 29,
        r: `0x${"dd".repeat(32)}`,
        s: `0x${"ee".repeat(32)}`,
        roundAuthorizationSignature: signature,
      }),
    /v must be 27 or 28/,
  );
});

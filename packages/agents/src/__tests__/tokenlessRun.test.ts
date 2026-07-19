import type {
  TokenlessDeploymentIdentity,
  TokenlessPaymentInstructions,
  TokenlessQuoteRequest,
  TokenlessRateLoopClient,
} from "@rateloop/sdk";
import {
  buildTokenlessQuoteIntent,
  TOKENLESS_SCHEMA_VERSION,
} from "@rateloop/sdk";
import { describe, expect, it, vi } from "vitest";
import type { PrivateKeyAccount } from "viem/accounts";
import { runTokenlessAutonomous } from "../tokenlessRun";

const walletAddress = "0x4444444444444444444444444444444444444444" as const;
const deployment = {
  deploymentKey: "rateloop-tokenless-deployment-v4:test",
  chainId: 84532,
  panelAddress: "0x1111111111111111111111111111111111111111",
  x402SubmitterAddress: "0x2222222222222222222222222222222222222222",
  usdcAddress: "0x3333333333333333333333333333333333333333",
} satisfies TokenlessDeploymentIdentity;

const quoteRequest = {
  audience: {
    admissionPolicyHash: `0x${"44".repeat(32)}`,
    source: "customer_invited",
  },
  budget: {
    attemptReserveAtomic: "636",
    bountyAtomic: "800",
    feeBps: 1_250,
  },
  question: {
    kind: "binary",
    prompt: "Is this safe?",
    rationale: { mode: "off" },
  },
  requestedPanelSize: 3,
  responseWindowSeconds: 3_600,
} satisfies TokenlessQuoteRequest;

const quoteResponse = {
  schemaVersion: TOKENLESS_SCHEMA_VERSION,
  quoteId: "quote_test",
  expiresAt: "2099-01-01T00:00:00.000Z",
  economics: {
    asset: "USDC" as const,
    decimals: 6 as const,
    bounty: { fundedAtomic: "800", paidAtomic: "0", refundedAtomic: "0" },
    fee: {
      bps: 1_250,
      fundedAtomic: "100",
      paidAtomic: "0",
      refundedAtomic: "0",
    },
    attemptReserve: {
      compensatedAtomic: "0",
      fundedAtomic: "636",
      refundedAtomic: "0",
    },
    refund: {
      attemptReserveAtomic: "0",
      bountyAtomic: "0",
      feeAtomic: "0",
      totalAtomic: "0",
    },
    compensation: {
      perAcceptedRevealCapAtomic: "212",
      recipientCount: 0,
      totalAtomic: "0",
    },
    totalFundedAtomic: "1536",
  },
  audience: {
    admissionPolicyHash: quoteRequest.audience.admissionPolicyHash,
    label: "Customer-invited reviewers",
    source: "customer_invited" as const,
  },
  panel: { minimumReveals: 3, requestedSize: 3 },
  responseWindowSeconds: 3_600,
  requestProfile: null,
  reviewEconomics: null,
  slo: { estimatedSeconds: 1_800 },
};

const roundPolicy = {
  beaconNetworkHash: `0x${"33".repeat(32)}` as const,
  beaconGenesisSeconds: 1_689_232_296,
  beaconPeriodSeconds: 3,
  revealWindowSeconds: 120,
  beaconFailureGraceSeconds: 300,
  claimGracePeriodSeconds: 604_800,
  feeRecipient: "0x5555555555555555555555555555555555555555" as const,
};

function paymentInstructions(
  overrides: Partial<TokenlessPaymentInstructions> = {},
): TokenlessPaymentInstructions {
  const now = Math.floor(Date.now() / 1_000);
  const commitDeadline = now + quoteRequest.responseWindowSeconds;
  const intent = buildTokenlessQuoteIntent(quoteRequest, quoteResponse);
  return {
    operationKey: "op_test",
    paymentMode: "x402",
    paymentState: "awaiting_authorization",
    ...deployment,
    funderAddress: walletAddress,
    totalFundedAtomic: "1536",
    roundTerms: {
      contentId: intent.contentId,
      termsHash: intent.termsHash,
      beaconNetworkHash: roundPolicy.beaconNetworkHash,
      bountyAmount: "800",
      feeAmount: "100",
      attemptReserve: "636",
      attemptCompensation: "212",
      minimumReveals: 3,
      maximumCommits: 3,
      admissionPolicyHash: `0x${"44".repeat(32)}`,
      commitDeadline: String(commitDeadline),
      revealDeadline: String(commitDeadline + roundPolicy.revealWindowSeconds),
      beaconFailureDeadline: String(
        commitDeadline +
          roundPolicy.revealWindowSeconds +
          roundPolicy.beaconFailureGraceSeconds,
      ),
      beaconRound: String(
        Math.floor(
          (commitDeadline - roundPolicy.beaconGenesisSeconds) /
            roundPolicy.beaconPeriodSeconds,
        ) + 1,
      ),
      claimGracePeriod: "604800",
      feeRecipient: roundPolicy.feeRecipient,
    },
    roundId: null,
    transactionHash: null,
    authorizationSpec: {
      schemaVersion: "rateloop.tokenless.payment-authorization.v1",
      eip3009Domain: {
        name: "USDC",
        version: "2",
        chainId: deployment.chainId,
        verifyingContract: deployment.usdcAddress,
      },
      roundAuthorizationDomain: {
        name: "RateLoop X402 Panel Submitter",
        version: "1",
        chainId: deployment.chainId,
        verifyingContract: deployment.x402SubmitterAddress,
      },
      validAfter: String(now - 1),
      validBefore: String(now + 300),
      nonce: `0x${"aa".repeat(32)}`,
    },
    ...overrides,
  };
}

function harness(instructions = paymentInstructions()) {
  const signTypedData = vi.fn();
  const client = {
    quote: vi.fn().mockResolvedValue({
      ...quoteResponse,
    }),
    ask: vi.fn().mockResolvedValue({ operationKey: "op_test" }),
    paymentInstructions: vi.fn().mockResolvedValue(instructions),
    submitPayment: vi.fn(),
  };
  return {
    account: {
      address: walletAddress,
      signTypedData,
    } as unknown as PrivateKeyAccount,
    client: client as unknown as TokenlessRateLoopClient,
    mocks: { ...client, signTypedData },
  };
}

function run(
  h: ReturnType<typeof harness>,
  requestOverrides: Record<string, unknown> = {},
) {
  return runTokenlessAutonomous({
    account: h.account,
    apiBaseUrl: "https://tokenless.example",
    client: h.client,
    request: {
      deployment,
      idempotencyKey: "run:test",
      maxTotalFundedAtomic: "1536",
      quote: quoteRequest,
      roundPolicy,
      ...requestOverrides,
    },
  });
}

describe("autonomous x402 custody guard", () => {
  it.each(["short", "run contains spaces", `run:${"x".repeat(157)}`])(
    "matches the SDK idempotency-key boundary before making requests: %s",
    async idempotencyKey => {
      const h = harness();

      await expect(run(h, { idempotencyKey })).rejects.toThrow(/8-160 characters/);
      expect(h.mocks.quote).not.toHaveBeenCalled();
      expect(h.mocks.signTypedData).not.toHaveBeenCalled();
    },
  );

  it("refuses server-supplied contracts that differ from the local deployment pin", async () => {
    const h = harness(
      paymentInstructions({
        panelAddress: "0x9999999999999999999999999999999999999999",
      }),
    );

    await expect(run(h)).rejects.toThrow(/panelAddress does not match/);
    expect(h.mocks.signTypedData).not.toHaveBeenCalled();
    expect(h.mocks.submitPayment).not.toHaveBeenCalled();
  });

  it("refuses a quote above the local ceiling before creating an ask", async () => {
    const h = harness();

    await expect(run(h, { maxTotalFundedAtomic: "1535" })).rejects.toThrow(
      /exceeds the local autonomous spend ceiling/,
    );
    expect(h.mocks.ask).not.toHaveBeenCalled();
    expect(h.mocks.signTypedData).not.toHaveBeenCalled();
  });

  it("refuses payment terms whose total differs from the accepted quote", async () => {
    const h = harness(
      paymentInstructions({
        totalFundedAtomic: "1001",
        roundTerms: {
          ...paymentInstructions().roundTerms,
          bountyAmount: "801",
          feeAmount: "100",
          attemptReserve: "636",
        },
      }),
    );

    await expect(run(h, { maxTotalFundedAtomic: "2000" })).rejects.toThrow(
      /do not match the accepted quote total/,
    );
    expect(h.mocks.signTypedData).not.toHaveBeenCalled();
  });

  it.each([
    ["question content", { contentId: `0x${"91".repeat(32)}` }],
    ["review terms", { termsHash: `0x${"92".repeat(32)}` }],
    ["audience", { admissionPolicyHash: `0x${"93".repeat(32)}` }],
    [
      "fee recipient",
      { feeRecipient: "0x9999999999999999999999999999999999999999" },
    ],
    ["approved beacon network", { beaconNetworkHash: `0x${"94".repeat(32)}` }],
    ["bounty allocation", { bountyAmount: "799", feeAmount: "101" }],
    [
      "approved reveal window",
      { revealDeadline: paymentInstructions().roundTerms.commitDeadline },
    ],
  ])(
    "refuses same-total signed terms that change the %s",
    async (_name, termOverrides) => {
      const baseline = paymentInstructions();
      const h = harness(
        paymentInstructions({
          roundTerms: { ...baseline.roundTerms, ...termOverrides },
        }),
      );

      await expect(run(h)).rejects.toThrow(/changed/);
      expect(h.mocks.signTypedData).not.toHaveBeenCalled();
      expect(h.mocks.submitPayment).not.toHaveBeenCalled();
    },
  );

  it("refuses a server-shifted deadline even when all relative windows remain valid", async () => {
    const baseline = paymentInstructions();
    const commitDeadline = BigInt(baseline.roundTerms.commitDeadline) + 1_800n;
    const h = harness(
      paymentInstructions({
        roundTerms: {
          ...baseline.roundTerms,
          commitDeadline: commitDeadline.toString(),
          revealDeadline: (commitDeadline + 120n).toString(),
          beaconFailureDeadline: (commitDeadline + 420n).toString(),
          beaconRound: ((commitDeadline - 1_689_232_296n) / 3n + 1n).toString(),
        },
      }),
    );

    await expect(run(h)).rejects.toThrow(/response deadline/);
    expect(h.mocks.signTypedData).not.toHaveBeenCalled();
  });
});

import type {
  TokenlessDeploymentIdentity,
  TokenlessPaymentInstructions,
  TokenlessQuoteRequest,
  TokenlessRateLoopClient,
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
    attemptReserveAtomic: "100",
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

function paymentInstructions(
  overrides: Partial<TokenlessPaymentInstructions> = {},
): TokenlessPaymentInstructions {
  const now = Math.floor(Date.now() / 1_000);
  return {
    operationKey: "op_test",
    paymentMode: "x402",
    paymentState: "awaiting_authorization",
    ...deployment,
    funderAddress: walletAddress,
    totalFundedAtomic: "1000",
    roundTerms: {
      contentId: `0x${"11".repeat(32)}`,
      termsHash: `0x${"22".repeat(32)}`,
      beaconNetworkHash: `0x${"33".repeat(32)}`,
      bountyAmount: "800",
      feeAmount: "100",
      attemptReserve: "100",
      attemptCompensation: "25",
      minimumReveals: 2,
      maximumCommits: 3,
      admissionPolicyHash: `0x${"44".repeat(32)}`,
      commitDeadline: String(now + 300),
      revealDeadline: String(now + 600),
      beaconFailureDeadline: String(now + 900),
      beaconRound: "1000",
      claimGracePeriod: "604800",
      feeRecipient: "0x5555555555555555555555555555555555555555",
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
      quoteId: "quote_test",
      economics: { totalFundedAtomic: "1000" },
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
      maxTotalFundedAtomic: "1000",
      quote: quoteRequest,
      ...requestOverrides,
    },
  });
}

describe("autonomous x402 custody guard", () => {
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

    await expect(run(h, { maxTotalFundedAtomic: "999" })).rejects.toThrow(
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
        },
      }),
    );

    await expect(run(h, { maxTotalFundedAtomic: "2000" })).rejects.toThrow(
      /do not match the accepted quote total/,
    );
    expect(h.mocks.signTypedData).not.toHaveBeenCalled();
  });
});

import {
  TOKENLESS_SCHEMA_VERSION,
  type TokenlessEconomics,
  type TokenlessEconomicsAccountingStage,
  type TokenlessVerdictStatus,
  parseTokenlessQuoteResponse,
  parseTokenlessResult,
} from "@rateloop/sdk";
import assert from "node:assert/strict";
import test from "node:test";
import { assertTokenlessSettlementAccounting } from "~~/lib/tokenless/tokenlessSettlementAccounting";

const POLICY_HASH = `0x${"11".repeat(32)}`;
type TestStage = "quote" | TokenlessVerdictStatus;

function quotedEconomics(): TokenlessEconomics {
  return {
    asset: "USDC",
    decimals: 6,
    bounty: { fundedAtomic: "100", paidAtomic: "0", refundedAtomic: "0" },
    fee: {
      bps: 1_000,
      fundedAtomic: "10",
      paidAtomic: "0",
      refundedAtomic: "0",
    },
    attemptReserve: {
      compensatedAtomic: "0",
      fundedAtomic: "20",
      refundedAtomic: "0",
    },
    refund: {
      attemptReserveAtomic: "0",
      bountyAtomic: "0",
      feeAtomic: "0",
      totalAtomic: "0",
    },
    compensation: {
      perAcceptedRevealCapAtomic: "5",
      recipientCount: 0,
      totalAtomic: "0",
    },
    totalFundedAtomic: "130",
  };
}

function economicsForStage(stage: TestStage): TokenlessEconomics {
  const quote = quotedEconomics();
  if (stage === "quote") return quote;
  if (stage === "zero_commit_refunded") {
    return {
      ...quote,
      bounty: { ...quote.bounty, refundedAtomic: "100" },
      fee: { ...quote.fee, refundedAtomic: "10" },
      attemptReserve: { ...quote.attemptReserve, refundedAtomic: "20" },
      refund: {
        attemptReserveAtomic: "20",
        bountyAtomic: "100",
        feeAtomic: "10",
        totalAtomic: "130",
      },
    };
  }
  if (stage === "under_quorum_compensated" || stage === "beacon_failure_compensated") {
    return {
      ...quote,
      bounty: { ...quote.bounty, refundedAtomic: "100" },
      fee: { ...quote.fee, refundedAtomic: "10" },
      attemptReserve: {
        compensatedAtomic: "10",
        fundedAtomic: "20",
        refundedAtomic: "10",
      },
      refund: {
        attemptReserveAtomic: "10",
        bountyAtomic: "100",
        feeAtomic: "10",
        totalAtomic: "120",
      },
      compensation: {
        perAcceptedRevealCapAtomic: "5",
        recipientCount: 2,
        totalAtomic: "10",
      },
    };
  }
  return {
    ...quote,
    bounty: {
      fundedAtomic: "100",
      paidAtomic: "60",
      refundedAtomic: "40",
    },
    fee: { ...quote.fee, paidAtomic: "10" },
    attemptReserve: { ...quote.attemptReserve, refundedAtomic: "20" },
    refund: {
      attemptReserveAtomic: "20",
      bountyAtomic: "40",
      feeAtomic: "0",
      totalAtomic: "60",
    },
  };
}

function quoteEnvelope(economics: TokenlessEconomics) {
  return {
    schemaVersion: TOKENLESS_SCHEMA_VERSION,
    quoteId: "quote_accounting",
    expiresAt: "2099-01-01T00:00:00.000Z",
    economics,
    audience: {
      admissionPolicyHash: POLICY_HASH,
      label: "RateLoop network",
      source: "rateloop_network",
    },
    panel: { minimumReveals: 2, requestedSize: 3 },
    responseWindowSeconds: 3_600,
    requestProfile: null,
    reviewEconomics: null,
    slo: { estimatedSeconds: 300 },
  };
}

function resultEnvelope(stage: Exclude<TestStage, "quote">, economics: TokenlessEconomics) {
  return {
    schemaVersion: TOKENLESS_SCHEMA_VERSION,
    operationKey: "op_accounting",
    roundId: "42",
    verdictStatus: stage,
    terminal: stage !== "pending",
    responseWindowSeconds: 3_600,
    commitDeadline: "2099-01-01T00:00:00.000Z",
    requestProfile: null,
    reviewEconomics: null,
    economics,
    audience: {
      admissionPolicyHash: POLICY_HASH,
      label: "RateLoop network",
      participantCount: 3,
      source: "rateloop_network",
    },
    verdict:
      stage === "publishable"
        ? {
            intervalBps: { lower: 4_000, upper: 8_000 },
            preferenceShareBps: 6_000,
            selected: "yes",
          }
        : null,
    feedback: { items: [], redactedCount: 0 },
    methodologyUrl: "https://rateloop.example.test/docs/evidence",
    updatedAt: "2099-01-01T01:00:00.000Z",
  };
}

function sdkAccepts(stage: TestStage, economics: TokenlessEconomics) {
  try {
    if (stage === "quote") {
      parseTokenlessQuoteResponse(quoteEnvelope(economics));
    } else {
      parseTokenlessResult(resultEnvelope(stage, economics));
    }
    return true;
  } catch {
    return false;
  }
}

function accountingStage(stage: TestStage): TokenlessEconomicsAccountingStage {
  if (stage === "quote" || stage === "zero_commit_refunded") return stage;
  if (stage === "under_quorum_compensated" || stage === "beacon_failure_compensated") {
    return "compensated";
  }
  return "scored";
}

function evidenceBoundaryAccepts(stage: TestStage, economics: TokenlessEconomics) {
  try {
    assertTokenlessSettlementAccounting(economics, accountingStage(stage));
    return true;
  } catch {
    return false;
  }
}

test("SDK and indexed-evidence consumers share every settlement conservation boundary", () => {
  const stages: TestStage[] = [
    "quote",
    "pending",
    "publishable",
    "inconclusive",
    "delisted",
    "zero_commit_refunded",
    "under_quorum_compensated",
    "beacon_failure_compensated",
  ];
  for (const stage of stages) {
    const economics = economicsForStage(stage);
    assert.equal(sdkAccepts(stage, economics), true, `${stage}: sdk`);
    assert.equal(evidenceBoundaryAccepts(stage, economics), true, `${stage}: evidence`);
  }

  const invalidCases: Array<{
    economics: TokenlessEconomics;
    name: string;
    stage: TestStage;
  }> = [
    {
      name: "total funding",
      stage: "quote",
      economics: { ...quotedEconomics(), totalFundedAtomic: "129" },
    },
    {
      name: "fee rate",
      stage: "quote",
      economics: {
        ...quotedEconomics(),
        fee: { ...quotedEconomics().fee, fundedAtomic: "11" },
        totalFundedAtomic: "131",
      },
    },
    {
      name: "bounty overallocation",
      stage: "publishable",
      economics: {
        ...economicsForStage("publishable"),
        bounty: {
          fundedAtomic: "100",
          paidAtomic: "61",
          refundedAtomic: "40",
        },
      },
    },
    {
      name: "refund component mismatch",
      stage: "publishable",
      economics: {
        ...economicsForStage("publishable"),
        refund: {
          ...economicsForStage("publishable").refund,
          bountyAtomic: "39",
          totalAtomic: "59",
        },
      },
    },
    {
      name: "refund total mismatch",
      stage: "publishable",
      economics: {
        ...economicsForStage("publishable"),
        refund: {
          ...economicsForStage("publishable").refund,
          totalAtomic: "59",
        },
      },
    },
    {
      name: "compensation reserve mismatch",
      stage: "under_quorum_compensated",
      economics: {
        ...economicsForStage("under_quorum_compensated"),
        compensation: {
          ...economicsForStage("under_quorum_compensated").compensation,
          totalAtomic: "9",
        },
      },
    },
    {
      name: "compensation recipient mismatch",
      stage: "under_quorum_compensated",
      economics: {
        ...economicsForStage("under_quorum_compensated"),
        compensation: {
          ...economicsForStage("under_quorum_compensated").compensation,
          recipientCount: 1,
        },
      },
    },
    {
      name: "quote allocation",
      stage: "quote",
      economics: {
        ...quotedEconomics(),
        bounty: {
          fundedAtomic: "100",
          paidAtomic: "1",
          refundedAtomic: "0",
        },
      },
    },
    {
      name: "terminal underallocation",
      stage: "publishable",
      economics: {
        ...economicsForStage("publishable"),
        bounty: {
          fundedAtomic: "100",
          paidAtomic: "59",
          refundedAtomic: "40",
        },
      },
    },
    {
      name: "zero-commit payment",
      stage: "zero_commit_refunded",
      economics: {
        ...economicsForStage("zero_commit_refunded"),
        bounty: {
          fundedAtomic: "100",
          paidAtomic: "1",
          refundedAtomic: "99",
        },
        refund: {
          attemptReserveAtomic: "20",
          bountyAtomic: "99",
          feeAtomic: "10",
          totalAtomic: "129",
        },
      },
    },
    {
      name: "compensation terminal fee payment",
      stage: "beacon_failure_compensated",
      economics: {
        ...economicsForStage("beacon_failure_compensated"),
        fee: {
          ...economicsForStage("beacon_failure_compensated").fee,
          paidAtomic: "1",
          refundedAtomic: "9",
        },
        refund: {
          ...economicsForStage("beacon_failure_compensated").refund,
          feeAtomic: "9",
          totalAtomic: "119",
        },
      },
    },
    {
      name: "scored terminal fee refund",
      stage: "inconclusive",
      economics: {
        ...economicsForStage("inconclusive"),
        fee: {
          ...economicsForStage("inconclusive").fee,
          paidAtomic: "9",
          refundedAtomic: "1",
        },
        refund: {
          ...economicsForStage("inconclusive").refund,
          feeAtomic: "1",
          totalAtomic: "61",
        },
      },
    },
  ];

  for (const testCase of invalidCases) {
    assert.equal(sdkAccepts(testCase.stage, testCase.economics), false, `${testCase.name}: sdk`);
    assert.equal(evidenceBoundaryAccepts(testCase.stage, testCase.economics), false, `${testCase.name}: evidence`);
  }
});

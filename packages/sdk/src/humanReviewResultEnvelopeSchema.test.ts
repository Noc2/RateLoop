import assert from "node:assert/strict";
import test from "node:test";
import { RateLoopSdkError } from "./errors";
import { parseHumanReviewResultEnvelope } from "./humanReviewResultEnvelopeSchema";
import type {
  HumanReviewResultEnvelope,
  HumanReviewResultLane,
  HumanReviewResultOutcome,
  HumanReviewResultTerminalState,
} from "./humanReviewResultEnvelopeTypes";

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;

const paidEconomics = {
  asset: "USDC" as const,
  decimals: 6 as const,
  guaranteedBase: {
    mode: "usdc" as const,
    fundedAtomic: "800000",
    paidAtomic: "800000",
    refundedAtomic: "0",
  },
  automaticQualityAllocation: {
    mode: "usdc" as const,
    availableAtomic: "200000",
    awardedAtomic: "150000",
    refundedAtomic: "50000",
  },
  feedbackBonus: {
    mode: "off" as const,
    fundedAtomic: "0" as const,
    awardedAtomic: "0" as const,
    refundedAtomic: "0" as const,
    awards: [] as [],
  },
};

function fixture(
  lane: HumanReviewResultLane,
  outcome: HumanReviewResultOutcome = "positive",
  state: HumanReviewResultTerminalState = "completed",
): HumanReviewResultEnvelope {
  const sources =
    lane === "public_paid"
      ? (["network"] as const)
      : lane === "hybrid"
        ? (["invited", "network"] as const)
        : (["invited"] as const);
  const cohorts = sources.map((source) => ({
    source,
    requestedCount: lane === "hybrid" ? 2 : 3,
    assignedCount: lane === "hybrid" ? 2 : 3,
    responseCount: lane === "hybrid" ? 1 : 2,
  }));
  const privateUnpaid = lane === "private_unpaid";
  return {
    schemaVersion: "rateloop.human-review-result.v1",
    workspaceId: "ws_result_fixture",
    integrationId: "ain_result_fixture",
    opportunityId: `aop_${lane}`,
    lane,
    lifecycle: {
      state,
      terminal: true,
      revision: 4,
      reasonCodes: ["result_finalized"],
      startedAt: "2026-07-16T08:00:00.000Z",
      stateEnteredAt: "2026-07-16T08:30:00.000Z",
      finalizedAt: "2026-07-16T08:30:01.000Z",
    },
    frozen: {
      selectionPolicy: { id: "sel_fixture", version: 3, hash: digest("1") },
      binding: { id: "arb_fixture", version: 5, hash: digest("2") },
      requestProfile: { id: "arp_fixture", version: 7, hash: digest("3") },
      responseDeadline: "2026-07-16T09:00:00.000Z",
    },
    panel: {
      requestedCount: cohorts.reduce(
        (sum, cohort) => sum + cohort.requestedCount,
        0,
      ),
      assignedCount: cohorts.reduce(
        (sum, cohort) => sum + cohort.assignedCount,
        0,
      ),
      responseCount: cohorts.reduce(
        (sum, cohort) => sum + cohort.responseCount,
        0,
      ),
      cohorts,
    },
    outcome,
    rationale: {
      mode: "aggregate_summary",
      summary: "Reviewers found the proposal clear and safe.",
    },
    economics: privateUnpaid
      ? {
          asset: "USDC",
          decimals: 6,
          guaranteedBase: {
            mode: "off",
            fundedAtomic: "0",
            paidAtomic: "0",
            refundedAtomic: "0",
          },
          automaticQualityAllocation: {
            mode: "off",
            availableAtomic: "0",
            awardedAtomic: "0",
            refundedAtomic: "0",
          },
          feedbackBonus: {
            mode: "usdc",
            fundedAtomic: "300000",
            awardedAtomic: "200000",
            refundedAtomic: "100000",
            awards: [
              {
                awardId: "fba_private_unpaid",
                responseCommitment: digest("a"),
                amountAtomic: "200000",
              },
            ],
          },
        }
      : paidEconomics,
    commitments: {
      sourceArtifact: digest("4"),
      suggestionArtifact: digest("5"),
      responseSet: digest("6"),
      result: digest("7"),
    },
    terminalEvidence: null,
  };
}

test("all four review lanes round-trip through one exact result envelope", () => {
  const cases = [
    fixture("public_paid", "positive", "completed"),
    fixture("private_paid", "negative", "completed"),
    fixture("private_unpaid", "inconclusive", "inconclusive"),
    fixture("hybrid", "failed", "failed_terminal"),
  ];
  for (const value of cases) {
    assert.deepEqual(parseHumanReviewResultEnvelope(value), value);
  }
});

test("cancelled results are terminal but carry no implied review outcome", () => {
  const value = fixture(
    "private_unpaid",
    "cancelled",
    "cancelled_before_commit",
  );
  value.panel.assignedCount = 0;
  value.panel.responseCount = 0;
  value.panel.cohorts[0]!.assignedCount = 0;
  value.panel.cohorts[0]!.responseCount = 0;
  value.rationale = { mode: "withheld", summary: null };
  value.economics.feedbackBonus = {
    mode: "usdc",
    fundedAtomic: "300000",
    awardedAtomic: "0",
    refundedAtomic: "300000",
    awards: [],
  };
  assert.deepEqual(parseHumanReviewResultEnvelope(value), value);
});

test("base-off and optional Feedback Bonus-on remain independent", () => {
  const parsed = parseHumanReviewResultEnvelope(
    fixture("private_unpaid", "inconclusive", "inconclusive"),
  );
  assert.equal(parsed.economics.guaranteedBase.mode, "off");
  assert.equal(parsed.economics.automaticQualityAllocation.mode, "off");
  assert.equal(parsed.economics.feedbackBonus.mode, "usdc");
  assert.equal(parsed.economics.feedbackBonus.awardedAtomic, "200000");
});

test("cross-lane cohort and compensation shapes fail closed", () => {
  const paidAsUnpaid = structuredClone(fixture("public_paid")) as Record<
    string,
    any
  >;
  paidAsUnpaid.lane = "private_unpaid";
  assert.throws(
    () => parseHumanReviewResultEnvelope(paidAsUnpaid),
    RateLoopSdkError,
  );

  const privateAsPublic = structuredClone(fixture("private_paid")) as Record<
    string,
    any
  >;
  privateAsPublic.lane = "public_paid";
  assert.throws(
    () => parseHumanReviewResultEnvelope(privateAsPublic),
    /cohort sources/,
  );

  const collapsedHybrid = structuredClone(
    fixture("hybrid", "failed", "failed_terminal"),
  ) as Record<string, any>;
  collapsedHybrid.panel.cohorts = [collapsedHybrid.panel.cohorts[1]];
  assert.throws(
    () => parseHumanReviewResultEnvelope(collapsedHybrid),
    /cohort sources/,
  );
});

test("conflicting lifecycle outcomes and tampered commitments are rejected", () => {
  const outcome = structuredClone(fixture("public_paid")) as Record<
    string,
    any
  >;
  outcome.outcome = "failed";
  assert.throws(
    () => parseHumanReviewResultEnvelope(outcome),
    /compatible with lifecycle/,
  );

  const commitment = structuredClone(fixture("private_paid")) as Record<
    string,
    any
  >;
  commitment.commitments.result = "sha256:not-a-digest";
  assert.throws(
    () => parseHumanReviewResultEnvelope(commitment),
    /sha256 commitment/,
  );

  const bonus = structuredClone(
    fixture("private_unpaid", "inconclusive", "inconclusive"),
  ) as Record<string, any>;
  bonus.economics.feedbackBonus.awardedAtomic = "200001";
  assert.throws(() => parseHumanReviewResultEnvelope(bonus), /awards summing/);

  const oversized = structuredClone(fixture("public_paid")) as Record<
    string,
    any
  >;
  oversized.economics.guaranteedBase.fundedAtomic = (1n << 256n).toString();
  assert.throws(() => parseHumanReviewResultEnvelope(oversized), /uint256/);
});

test("awards and aggregate rationale require recorded responses", () => {
  const value = structuredClone(
    fixture("private_unpaid", "inconclusive", "inconclusive"),
  ) as Record<string, any>;
  value.panel.responseCount = 0;
  value.panel.cohorts[0].responseCount = 0;
  assert.throws(
    () => parseHumanReviewResultEnvelope(value),
    /backed by recorded responses/,
  );

  value.economics.feedbackBonus.awardedAtomic = "0";
  value.economics.feedbackBonus.awards = [];
  assert.throws(
    () => parseHumanReviewResultEnvelope(value),
    /withheld rationale/,
  );
});

test("unknown plaintext and reviewer identity fields are rejected at every privacy boundary", () => {
  const topLevel = {
    ...fixture("private_paid"),
    source: "private source text",
  };
  assert.throws(() => parseHumanReviewResultEnvelope(topLevel), /exactly/);

  const panel = structuredClone(fixture("public_paid")) as Record<string, any>;
  panel.panel.cohorts[0].reviewerIdentity = "acct_private_reviewer";
  assert.throws(() => parseHumanReviewResultEnvelope(panel), /exactly/);

  const rationale = structuredClone(
    fixture("private_unpaid", "inconclusive", "inconclusive"),
  ) as Record<string, any>;
  rationale.rationale.mode = "withheld";
  rationale.rationale.summary = "private written feedback";
  assert.throws(
    () => parseHumanReviewResultEnvelope(rationale),
    /null when withheld/,
  );
});

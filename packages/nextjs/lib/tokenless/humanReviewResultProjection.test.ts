import type {
  HumanReviewResultEnvelope,
  HumanReviewResultLane,
  HumanReviewResultOutcome,
  HumanReviewResultTerminalState,
} from "@rateloop/sdk";
import assert from "node:assert/strict";
import test from "node:test";
import {
  type HumanReviewResultProjectionInput,
  projectHumanReviewResultEnvelope,
  projectPrivateHumanReviewResultEnvelope,
  projectPublicHumanReviewResultEnvelope,
} from "~~/lib/tokenless/humanReviewResultProjection";

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;

function input(
  lane: HumanReviewResultLane,
  outcome: HumanReviewResultOutcome = "positive",
  state: HumanReviewResultTerminalState = "completed",
): HumanReviewResultProjectionInput {
  const sources =
    lane === "public_paid"
      ? (["network"] as const)
      : lane === "hybrid"
        ? (["invited", "network"] as const)
        : (["invited"] as const);
  const cohorts = sources.map(source => ({
    source,
    requestedCount: 2,
    assignedCount: 2,
    responseCount: 1,
  }));
  const paid = lane !== "private_unpaid";
  return {
    workspaceId: "ws_projection",
    integrationId: "ain_projection",
    opportunityId: `aop_projection_${lane}`,
    lane,
    lifecycle: {
      state,
      terminal: true,
      revision: 8,
      reasonCodes: ["terminal_result_ready", "adapter_complete"],
      startedAt: "2026-07-16T09:00:00.000Z",
      stateEnteredAt: "2026-07-16T09:20:00.000Z",
      finalizedAt: "2026-07-16T09:20:01.000Z",
    },
    frozen: {
      selectionPolicy: { id: "sel_projection", version: 2, hash: digest("1") },
      binding: { id: "arb_projection", version: 4, hash: digest("2") },
      requestProfile: { id: "arp_projection", version: 6, hash: digest("3") },
      responseDeadline: "2026-07-16T10:00:00.000Z",
    },
    panel: {
      requestedCount: cohorts.length * 2,
      assignedCount: cohorts.length * 2,
      responseCount: cohorts.length,
      cohorts,
    },
    outcome,
    rationale: { summaryAllowed: true, aggregateSummary: "  Aggregate rationale only.  " },
    economics: paid
      ? {
          asset: "USDC",
          decimals: 6,
          guaranteedBase: {
            mode: "usdc",
            fundedAtomic: "800000",
            paidAtomic: "800000",
            refundedAtomic: "0",
          },
          automaticQualityAllocation: {
            mode: "usdc",
            availableAtomic: "200000",
            awardedAtomic: "200000",
            refundedAtomic: "0",
          },
          feedbackBonus: {
            mode: "off",
            fundedAtomic: "0",
            awardedAtomic: "0",
            refundedAtomic: "0",
            awards: [],
          },
        }
      : {
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
            fundedAtomic: "100000",
            awardedAtomic: "0",
            refundedAtomic: "0",
            awards: [],
          },
        },
    commitments: {
      sourceArtifact: digest("4"),
      suggestionArtifact: digest("5"),
      responseSet: digest("6"),
      result: digest("7"),
    },
    terminalEvidence: null,
  };
}

test("one projection contract emits every lane and canonicalizes aggregate-only fields", () => {
  const cases: Array<[HumanReviewResultLane, HumanReviewResultOutcome, HumanReviewResultTerminalState]> = [
    ["public_paid", "positive", "completed"],
    ["private_paid", "negative", "completed"],
    ["private_unpaid", "inconclusive", "inconclusive"],
    ["hybrid", "failed", "failed_terminal"],
  ];
  for (const [lane, outcome, state] of cases) {
    const result = projectHumanReviewResultEnvelope(input(lane, outcome, state));
    assert.equal(result.schemaVersion, "rateloop.human-review-result.v1");
    assert.equal(result.lane, lane);
    assert.equal(result.outcome, outcome);
    assert.deepEqual(result.lifecycle.reasonCodes, ["adapter_complete", "terminal_result_ready"]);
    assert.deepEqual(result.rationale, {
      mode: "aggregate_summary",
      summary: "Aggregate rationale only.",
    });
    assert.equal(result.terminalEvidence, null);
  }
});

test("public and private projections cannot be crossed at runtime", () => {
  assert.throws(
    () =>
      projectPublicHumanReviewResultEnvelope(
        input("private_paid") as Parameters<typeof projectPublicHumanReviewResultEnvelope>[0],
      ),
    /public_paid or hybrid/,
  );
  assert.throws(
    () =>
      projectPrivateHumanReviewResultEnvelope(
        input("public_paid") as Parameters<typeof projectPrivateHumanReviewResultEnvelope>[0],
      ),
    /private_paid or private_unpaid/,
  );
});

test("private projections enumerate safe fields and discard plaintext, identities, and disallowed rationale", () => {
  const unsafe = input("private_unpaid", "inconclusive", "inconclusive") as HumanReviewResultProjectionInput & {
    lane: "private_unpaid";
  } & Record<string, unknown>;
  unsafe.rationale = {
    summaryAllowed: false,
    aggregateSummary: "This private rationale must not leave the workspace.",
  };
  unsafe.sourcePlaintext = "confidential source";
  unsafe.suggestionPlaintext = "confidential suggestion";
  unsafe.reviewerIdentity = "acct_named_reviewer";
  unsafe.individualFeedback = ["private written response"];
  (unsafe.panel.cohorts[0] as unknown as Record<string, unknown>).reviewerIdentity = "acct_named_reviewer";

  const result = projectPrivateHumanReviewResultEnvelope(unsafe);
  const serialized = JSON.stringify(result);
  assert.deepEqual(result.rationale, { mode: "withheld", summary: null });
  for (const secret of [
    "confidential source",
    "confidential suggestion",
    "acct_named_reviewer",
    "private written response",
    "This private rationale",
  ]) {
    assert.equal(serialized.includes(secret), false);
  }
});

test("public projections also omit reviewer identity and individual feedback", () => {
  const unsafe = input("public_paid") as HumanReviewResultProjectionInput & { lane: "public_paid" } & Record<
      string,
      unknown
    >;
  unsafe.reviewerIdentity = "acct_public_reviewer";
  unsafe.individualFeedback = ["non-aggregate response"];
  const result = projectPublicHumanReviewResultEnvelope(unsafe);
  assert.equal(JSON.stringify(result).includes("acct_public_reviewer"), false);
  assert.equal(JSON.stringify(result).includes("non-aggregate response"), false);
});

test("the projection rejects cross-lane economics and outcome tampering", () => {
  const economics = input("private_unpaid", "inconclusive", "inconclusive");
  economics.economics = input("public_paid").economics;
  assert.throws(() => projectHumanReviewResultEnvelope(economics), /compatible with private_unpaid/);

  const outcome = input("hybrid", "failed", "failed_terminal");
  outcome.outcome = "positive";
  assert.throws(() => projectHumanReviewResultEnvelope(outcome), /compatible with lifecycle/);
});

test("projection output remains a fully typed envelope", () => {
  const result: HumanReviewResultEnvelope = projectHumanReviewResultEnvelope(input("public_paid"));
  assert.equal(result.commitments.result, digest("7"));
});

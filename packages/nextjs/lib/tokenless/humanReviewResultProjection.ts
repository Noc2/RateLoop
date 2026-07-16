import {
  HUMAN_REVIEW_RESULT_ENVELOPE_SCHEMA_VERSION,
  type HumanReviewFrozenReference,
  type HumanReviewResultCommitments,
  type HumanReviewResultEconomics,
  type HumanReviewResultEnvelope,
  type HumanReviewResultLane,
  type HumanReviewResultLifecycle,
  type HumanReviewResultOutcome,
  type HumanReviewResultPanelCounts,
  type HumanReviewTerminalEvidence,
  parseHumanReviewResultEnvelope,
} from "@rateloop/sdk";
import "server-only";
import { assertResultPreservesAcceptedWorkPayment } from "~~/lib/tokenless/acceptedWorkPaymentGuarantees";

export type HumanReviewResultProjectionInput = {
  workspaceId: string;
  integrationId: string;
  opportunityId: string;
  lane: HumanReviewResultLane;
  lifecycle: HumanReviewResultLifecycle;
  frozen: {
    selectionPolicy: HumanReviewFrozenReference;
    binding: HumanReviewFrozenReference;
    requestProfile: HumanReviewFrozenReference;
    responseDeadline: string;
  };
  panel: HumanReviewResultPanelCounts;
  outcome: HumanReviewResultOutcome;
  rationale: {
    summaryAllowed: boolean;
    aggregateSummary: string | null;
  };
  economics: HumanReviewResultEconomics;
  commitments: HumanReviewResultCommitments;
  terminalEvidence?: HumanReviewTerminalEvidence | null;
};

type PublicResultInput = HumanReviewResultProjectionInput & {
  lane: "public_paid" | "hybrid";
};

type PrivateResultInput = HumanReviewResultProjectionInput & {
  lane: "private_paid" | "private_unpaid";
};

function copyReference(value: HumanReviewFrozenReference): HumanReviewFrozenReference {
  return { id: value.id, version: value.version, hash: value.hash };
}

function copyLifecycle(value: HumanReviewResultLifecycle): HumanReviewResultLifecycle {
  return {
    state: value.state,
    terminal: true,
    revision: value.revision,
    reasonCodes: [...new Set(value.reasonCodes)].sort(),
    startedAt: value.startedAt,
    stateEnteredAt: value.stateEnteredAt,
    finalizedAt: value.finalizedAt,
  };
}

function copyPanel(value: HumanReviewResultPanelCounts): HumanReviewResultPanelCounts {
  return {
    requestedCount: value.requestedCount,
    assignedCount: value.assignedCount,
    responseCount: value.responseCount,
    cohorts: value.cohorts.map(cohort => ({
      source: cohort.source,
      requestedCount: cohort.requestedCount,
      assignedCount: cohort.assignedCount,
      responseCount: cohort.responseCount,
    })),
  };
}

function copyEconomics(value: HumanReviewResultEconomics): HumanReviewResultEconomics {
  return {
    asset: "USDC",
    decimals: 6,
    guaranteedBase: { ...value.guaranteedBase },
    automaticQualityAllocation: { ...value.automaticQualityAllocation },
    feedbackBonus:
      value.feedbackBonus.mode === "off"
        ? {
            mode: "off",
            fundedAtomic: "0",
            awardedAtomic: "0",
            refundedAtomic: "0",
            awards: [],
          }
        : {
            mode: "usdc",
            fundedAtomic: value.feedbackBonus.fundedAtomic,
            awardedAtomic: value.feedbackBonus.awardedAtomic,
            refundedAtomic: value.feedbackBonus.refundedAtomic,
            awards: value.feedbackBonus.awards.map(award => ({
              awardId: award.awardId,
              responseCommitment: award.responseCommitment,
              amountAtomic: award.amountAtomic,
            })),
          },
  };
}

/**
 * Produces the only result shape exposed to agents and owners. Every field is
 * copied explicitly. Unknown database or adapter fields therefore cannot leak
 * source material, suggestions, individual rationales, reviewer accounts, or
 * payout destinations through object spreading.
 */
export function projectHumanReviewResultEnvelope(input: HumanReviewResultProjectionInput): HumanReviewResultEnvelope {
  assertResultPreservesAcceptedWorkPayment({
    lane: input.lane,
    outcome: input.outcome,
    responseCount: input.panel.responseCount,
    guaranteedBase: input.economics.guaranteedBase,
  });
  const aggregateSummary = input.rationale.aggregateSummary?.trim() || null;
  const projected = {
    schemaVersion: HUMAN_REVIEW_RESULT_ENVELOPE_SCHEMA_VERSION,
    workspaceId: input.workspaceId,
    integrationId: input.integrationId,
    opportunityId: input.opportunityId,
    lane: input.lane,
    lifecycle: copyLifecycle(input.lifecycle),
    frozen: {
      selectionPolicy: copyReference(input.frozen.selectionPolicy),
      binding: copyReference(input.frozen.binding),
      requestProfile: copyReference(input.frozen.requestProfile),
      responseDeadline: input.frozen.responseDeadline,
    },
    panel: copyPanel(input.panel),
    outcome: input.outcome,
    rationale:
      input.rationale.summaryAllowed && aggregateSummary
        ? { mode: "aggregate_summary" as const, summary: aggregateSummary }
        : { mode: "withheld" as const, summary: null },
    economics: copyEconomics(input.economics),
    commitments: {
      sourceArtifact: input.commitments.sourceArtifact,
      suggestionArtifact: input.commitments.suggestionArtifact,
      responseSet: input.commitments.responseSet,
      result: input.commitments.result,
    },
    terminalEvidence: input.terminalEvidence ?? null,
  };
  return parseHumanReviewResultEnvelope(projected);
}

export function projectPublicHumanReviewResultEnvelope(input: PublicResultInput): HumanReviewResultEnvelope {
  if (input.lane !== "public_paid" && input.lane !== "hybrid") {
    throw new Error("A public result projection requires the public_paid or hybrid lane.");
  }
  return projectHumanReviewResultEnvelope(input);
}

export function projectPrivateHumanReviewResultEnvelope(input: PrivateResultInput): HumanReviewResultEnvelope {
  if (input.lane !== "private_paid" && input.lane !== "private_unpaid") {
    throw new Error("A private result projection requires the private_paid or private_unpaid lane.");
  }
  return projectHumanReviewResultEnvelope(input);
}

export const HUMAN_REVIEW_RESULT_ENVELOPE_SCHEMA_VERSION =
  "rateloop.human-review-result.v1" as const;

export const HUMAN_REVIEW_TERMINAL_EVIDENCE_SCHEMA_VERSION =
  "rateloop.human-review-terminal-evidence.v1" as const;

export const HUMAN_REVIEW_RESULT_LANES = [
  "public_paid",
  "private_paid",
  "private_unpaid",
  "hybrid",
] as const;

export type HumanReviewResultLane = (typeof HUMAN_REVIEW_RESULT_LANES)[number];

export const HUMAN_REVIEW_RESULT_OUTCOMES = [
  "positive",
  "negative",
  "inconclusive",
  "failed",
  "cancelled",
] as const;

export type HumanReviewResultOutcome =
  (typeof HUMAN_REVIEW_RESULT_OUTCOMES)[number];

export const HUMAN_REVIEW_RESULT_TERMINAL_STATES = [
  "completed",
  "inconclusive",
  "failed_terminal",
  "cancelled_before_commit",
] as const;

export type HumanReviewResultTerminalState =
  (typeof HUMAN_REVIEW_RESULT_TERMINAL_STATES)[number];

export type HumanReviewResultCommitment = `sha256:${string}`;

export interface HumanReviewFrozenReference {
  id: string;
  version: number;
  hash: HumanReviewResultCommitment;
}

export interface HumanReviewResultLifecycle {
  state: HumanReviewResultTerminalState;
  terminal: true;
  revision: number;
  reasonCodes: string[];
  startedAt: string;
  stateEnteredAt: string;
  finalizedAt: string;
}

export type HumanReviewResultCohortSource = "invited" | "network";

export interface HumanReviewResultCohortCounts {
  source: HumanReviewResultCohortSource;
  requestedCount: number;
  assignedCount: number;
  responseCount: number;
}

export interface HumanReviewResultPanelCounts {
  requestedCount: number;
  assignedCount: number;
  responseCount: number;
  cohorts: HumanReviewResultCohortCounts[];
}

export type HumanReviewRationaleProjection =
  | { mode: "withheld"; summary: null }
  | { mode: "aggregate_summary"; summary: string };

export type HumanReviewGuaranteedBaseAccounting =
  | {
      mode: "off";
      fundedAtomic: "0";
      paidAtomic: "0";
      refundedAtomic: "0";
    }
  | {
      mode: "usdc";
      fundedAtomic: string;
      paidAtomic: string;
      refundedAtomic: string;
    };

export type HumanReviewAutomaticQualityAccounting =
  | {
      mode: "off";
      availableAtomic: "0";
      awardedAtomic: "0";
      refundedAtomic: "0";
    }
  | {
      mode: "usdc";
      availableAtomic: string;
      awardedAtomic: string;
      refundedAtomic: string;
    };

export interface HumanReviewFeedbackBonusAward {
  awardId: string;
  responseCommitment: HumanReviewResultCommitment;
  amountAtomic: string;
}

export type HumanReviewFeedbackBonusAccounting =
  | {
      mode: "off";
      fundedAtomic: "0";
      awardedAtomic: "0";
      refundedAtomic: "0";
      awards: [];
    }
  | {
      mode: "usdc";
      fundedAtomic: string;
      awardedAtomic: string;
      refundedAtomic: string;
      awards: HumanReviewFeedbackBonusAward[];
    };

export interface HumanReviewResultEconomics {
  asset: "USDC";
  decimals: 6;
  guaranteedBase: HumanReviewGuaranteedBaseAccounting;
  automaticQualityAllocation: HumanReviewAutomaticQualityAccounting;
  feedbackBonus: HumanReviewFeedbackBonusAccounting;
}

export interface HumanReviewResultCommitments {
  sourceArtifact: HumanReviewResultCommitment;
  suggestionArtifact: HumanReviewResultCommitment;
  responseSet: HumanReviewResultCommitment;
  result: HumanReviewResultCommitment;
}

export interface HumanReviewTerminalEvidence {
  schemaVersion: typeof HUMAN_REVIEW_TERMINAL_EVIDENCE_SCHEMA_VERSION;
  algorithm: "Ed25519";
  keyId: string;
  payloadCommitment: HumanReviewResultCommitment;
  signature: string;
}

/**
 * A lane-neutral, privacy-safe terminal projection. It deliberately contains
 * commitments and aggregate counts only: never source material, a submitted
 * suggestion, individual feedback, a payout destination, or reviewer identity.
 */
export interface HumanReviewResultEnvelope {
  schemaVersion: typeof HUMAN_REVIEW_RESULT_ENVELOPE_SCHEMA_VERSION;
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
  rationale: HumanReviewRationaleProjection;
  economics: HumanReviewResultEconomics;
  commitments: HumanReviewResultCommitments;
  terminalEvidence: HumanReviewTerminalEvidence | null;
}

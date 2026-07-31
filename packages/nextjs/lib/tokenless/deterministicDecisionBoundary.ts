export const DETERMINISTIC_DECISION_BOUNDARY_VERSION = "rateloop.deterministic-decision-boundary.v1" as const;

export type DeterministicDecisionModule = {
  path: string;
  role: "reviewer_scoring" | "routing" | "triage";
  requiredSourceMarkers: readonly string[];
};

export type SeparatelyLicensedInferenceModule = {
  activationEnvironmentVariable: string;
  assessmentDocumentPath: string;
  boundarySourcePath: string;
  defaultConfigurationPath: string;
  enabledByDefault: false;
  licenseMode: "separate_contract_required";
  manifestPath: string;
  sourceRoot: string;
};

const SEPARATELY_LICENSED_INFERENCE_MODULES: readonly SeparatelyLicensedInferenceModule[] = [];

/**
 * Product boundary for reviewer scoring, routing, and triage.
 *
 * Core decisions use frozen inputs, integer arithmetic, hashes, explicit
 * thresholds, and human-authored policy. A future inference feature must live
 * in its own workspace package and satisfy the separate boundary below before
 * its dependency manifest or source is exempted from the repository gate.
 */
export const DETERMINISTIC_DECISION_BOUNDARY = {
  schemaVersion: DETERMINISTIC_DECISION_BOUNDARY_VERSION,
  coreInferenceMode: "forbidden" as const,
  coreModules: [
    {
      path: "packages/nextjs/lib/tokenless/adaptiveReview.ts",
      role: "triage",
      requiredSourceMarkers: ["createDeterministicReviewSample", "ADAPTIVE_REVIEW_STAGE_RATE_BPS", "sampleBucket"],
    },
    {
      path: "packages/nextjs/lib/tokenless/reviewSampling.ts",
      role: "triage",
      requiredSourceMarkers: ["createHmac", "ReviewSamplerDomain", "sampleBucket"],
    },
    {
      path: "packages/nextjs/lib/tokenless/adaptiveReviewService.ts",
      role: "triage",
      requiredSourceMarkers: ["decideAdaptiveReview", "requiredRiskTiers.includes", "selectionProbabilityBps"],
    },
    {
      path: "packages/nextjs/lib/tokenless/goldQuality.ts",
      role: "reviewer_scoring",
      requiredSourceMarkers: ["createHmac", "goldInjectionCount", "GOLD_CALIBRATED_ACCURACY_BPS"],
    },
    {
      path: "packages/nextjs/lib/tokenless/crowdForecastIntegrity.ts",
      role: "reviewer_scoring",
      requiredSourceMarkers: ["BPS_SQUARED", "evaluateForecastCalibration", "forecastConsequence"],
    },
    {
      path: "packages/nextjs/lib/tokenless/crowdForecastPersistence.ts",
      role: "routing",
      requiredSourceMarkers: [
        "evaluateForecastCalibration",
        "restrictionConsequence",
        "forecast_integrity_assignment_restricted",
      ],
    },
    {
      path: "packages/nextjs/lib/tokenless/integrityAssignment.ts",
      role: "routing",
      requiredSourceMarkers: ["createHash", "effectiveClusterMemberCap", "selectionCommitment"],
    },
    {
      path: "packages/nextjs/lib/tokenless/reviewerExpertiseCoverage.ts",
      role: "routing",
      requiredSourceMarkers: ["chooseExpertiseCoveredPanel", "lexicographicallyEarlier", "minimumSeats"],
    },
    {
      path: "packages/nextjs/lib/tokenless/workspacePrivateReviewRouting.ts",
      role: "routing",
      requiredSourceMarkers: ["deterministicId", "chooseExpertiseCoveredPanel", "selectedReviewerCount"],
    },
    {
      path: "packages/nextjs/lib/tokenless/humanReviewRequestRouter.ts",
      role: "routing",
      requiredSourceMarkers: ["getEffectiveAgentReviewContext", "HUMAN_REVIEW_LANE_IMPLEMENTATION", "context.decision"],
    },
    {
      path: "packages/nextjs/lib/tokenless/surpriseBounties.ts",
      role: "reviewer_scoring",
      requiredSourceMarkers: ["computeSurpriseBountyRound", "leaveOneOutSurpriseMarginBps", 'verdictEffect: "none"'],
    },
    {
      path: "packages/nextjs/lib/tokenless/transparency.ts",
      role: "reviewer_scoring",
      requiredSourceMarkers: ["recomputeRbtsSettlement", "quadraticScoreBps", "scoringSeed"],
    },
    {
      path: "packages/foundry/scripts-js/tokenlessRbts.js",
      role: "reviewer_scoring",
      requiredSourceMarkers: ["rbtsScoreBps", "deterministicPermutation", "solidityScoringSeed"],
    },
  ] satisfies readonly DeterministicDecisionModule[],
  separatelyLicensedInferenceModules: SEPARATELY_LICENSED_INFERENCE_MODULES,
} as const;

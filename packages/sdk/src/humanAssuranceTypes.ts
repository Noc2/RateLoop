export const HUMAN_ASSURANCE_SCHEMA_VERSION =
  "rateloop.human-assurance.v2" as const;
export const HUMAN_ASSURANCE_INTEGRITY_ASSIGNMENT_SCHEMA_VERSION =
  "rateloop.integrity-assignment.v1" as const;

export const HUMAN_ASSURANCE_CAPABILITIES = [
  "account_control",
  "customer_invitation",
  "live_human",
  "unique_human",
  "document_holder",
  "minimum_age",
  "issuing_country",
  "nationality",
] as const;

export type HumanAssuranceCapability =
  (typeof HUMAN_ASSURANCE_CAPABILITIES)[number];
export type HumanAssuranceDataClassification =
  | "public"
  | "internal"
  | "confidential"
  | "restricted"
  | "regulated";
export type HumanAssuranceReviewerSource =
  | "customer_invited"
  | "rateloop_network"
  | "hybrid";

export interface HumanAssuranceArtifact {
  schemaVersion: typeof HUMAN_ASSURANCE_SCHEMA_VERSION;
  artifactId: string;
  projectId: string;
  role: "baseline" | "candidate" | "context" | "reference";
  label: string;
  digest: `sha256:${string}`;
  contentType: string;
  sizeBytes: number;
  storageRef: string;
  redactionStatus: "not_required" | "pending" | "approved" | "rejected";
  rendererPolicy: "plain_text" | "sanitized_html" | "image" | "download";
  createdAt: string;
}

export interface HumanAssuranceCase {
  schemaVersion: typeof HUMAN_ASSURANCE_SCHEMA_VERSION;
  caseId: string;
  projectId: string;
  title: string;
  instructions: string;
  baselineArtifactId: string;
  candidateArtifactId: string;
  contextArtifactIds: string[];
  objectiveReference?: string;
  status: "draft" | "ready" | "retired";
}

export interface HumanAssuranceRubricTag {
  key: string;
  label: string;
  description?: string;
}

export interface HumanAssuranceRubric {
  schemaVersion: typeof HUMAN_ASSURANCE_SCHEMA_VERSION;
  rubricId: string;
  projectId: string;
  version: number;
  prompt: string;
  choices: ["baseline", "candidate", "tie"];
  failureTags: HumanAssuranceRubricTag[];
  rationale:
    | { mode: "off" }
    | {
        mode: "optional" | "required";
        minLength?: number;
        maxLength: number;
      };
  passRule: {
    metric: "candidate_preference_share_bps";
    operator: "gte";
    thresholdBps: number;
    minimumValidResponses: number;
  };
}

export interface HumanAssuranceAudiencePolicy {
  schemaVersion: typeof HUMAN_ASSURANCE_SCHEMA_VERSION;
  policyId: string;
  version: number;
  reviewerSource: HumanAssuranceReviewerSource;
  compensation: "paid" | "unpaid" | "mixed";
  cohorts: Array<{
    cohortId: string;
    minimumReviewers: number;
    maximumReviewers: number;
  }>;
  selection: "randomized" | "customer_named";
  fallbacks: {
    allowed: boolean;
    sources: HumanAssuranceReviewerSource[];
  };
  requiredQualifications: Array<{
    key: string;
    operator: "equals" | "one_of" | "at_least" | "attested";
    value: string | number | boolean | string[];
  }>;
  assurance: {
    requirements: Array<{
      capability: HumanAssuranceCapability;
      reviewerSources: Array<Exclude<HumanAssuranceReviewerSource, "hybrid">>;
      allowedProviders: string[];
      freshnessSeconds?: number;
    }>;
  };
  integrity?: {
    schemaVersion: typeof HUMAN_ASSURANCE_INTEGRITY_ASSIGNMENT_SCHEMA_VERSION;
    epochId: string;
    epochManifestHash: `sha256:${string}`;
    maxClusterShareBps: number;
    allowedRiskBands: Array<"low" | "medium" | "high">;
    recentCoassignmentWindowSeconds: number;
    maxRecentCoassignments: number;
    maxPerCustomer: number;
    onePerProviderSubject: true;
  };
  buyerPrivacy: {
    visibleFields: Array<
      | "reviewer_source"
      | "qualification_summary"
      | "assurance_summary"
      | "country_bucket"
    >;
    minimumAggregationSize: number;
    suppressSmallCells: boolean;
  };
  legalEligibilityRequired: boolean;
}

export interface HumanAssuranceProject {
  schemaVersion: typeof HUMAN_ASSURANCE_SCHEMA_VERSION;
  projectId: string;
  workspaceId: string;
  name: string;
  description?: string;
  dataClassification: HumanAssuranceDataClassification;
  status: "active" | "archived";
  retentionDays: number;
  createdAt: string;
  updatedAt: string;
}

export interface HumanAssuranceSuite {
  schemaVersion: typeof HUMAN_ASSURANCE_SCHEMA_VERSION;
  suiteId: string;
  projectId: string;
  name: string;
  version: number;
  status: "draft" | "frozen" | "retired";
  caseIds: string[];
  rubricId: string;
  rubricVersion: number;
  frozenAt: string | null;
}

export interface HumanAssuranceRun {
  schemaVersion: typeof HUMAN_ASSURANCE_SCHEMA_VERSION;
  runId: string;
  projectId: string;
  suiteId: string;
  suiteVersion: number;
  audiencePolicyId: string;
  audiencePolicyVersion: number;
  status:
    | "draft"
    | "frozen"
    | "recruiting"
    | "collecting"
    | "aggregating"
    | "completed"
    | "cancelled";
  policyHash: `sha256:${string}`;
  manifestHash: `sha256:${string}` | null;
  previousRunId: string | null;
  createdAt: string;
  frozenAt: string | null;
  completedAt: string | null;
}

export interface HumanAssuranceResponse {
  schemaVersion: typeof HUMAN_ASSURANCE_SCHEMA_VERSION;
  responseId: string;
  runId: string;
  caseId: string;
  choice: "baseline" | "candidate" | "tie";
  failureTagKeys: string[];
  rationale: string | null;
  reviewer: {
    source: Exclude<HumanAssuranceReviewerSource, "hybrid">;
    qualificationKeys: string[];
    assuranceCapabilities: HumanAssuranceCapability[];
  };
  responseDigest: `sha256:${string}`;
  settlementReference: string | null;
  validity: "pending" | "valid" | "invalid" | "withdrawn";
  submittedAt: string;
}

export interface HumanAssuranceEvidencePacket {
  schemaVersion: typeof HUMAN_ASSURANCE_SCHEMA_VERSION;
  packetId: string;
  runId: string;
  manifestHash: `sha256:${string}`;
  caseRoot: `sha256:${string}`;
  responseRoot: `sha256:${string}`;
  aggregationVersion: string;
  result: {
    method: "descriptive_per_case";
    reviewerCoverage: {
      targetReviewerCount: number;
      assignedReviewerCount: number;
      paidReviewerCount: number;
      respondingReviewerCount: number;
      completeJudgmentSetReviewerCount: number;
    };
    judgmentCoverage: {
      caseCount: number;
      targetExpectedJudgmentCount: number;
      assignedExpectedJudgmentCount: number;
      submittedJudgmentCount: number;
      validJudgmentCount: number;
      invalidJudgmentCount: number;
      pendingJudgmentCount: number;
      missingTargetJudgmentCount: number;
      missingAssignedJudgmentCount: number;
    };
    cases: {
      caseId: string;
      targetReviewerCount: number;
      assignedReviewerCount: number;
      submittedJudgmentCount: number;
      validReviewerCount: number;
      invalidJudgmentCount: number;
      pendingJudgmentCount: number;
      missingTargetJudgmentCount: number;
      missingAssignedJudgmentCount: number;
      quorum: {
        requiredValidReviewers: number;
        met: boolean;
      };
      candidatePreferenceShareBps: number | null;
      disagreementBps: number | null;
      outcome: "pass" | "fail" | "insufficient";
    }[];
    suite: {
      method: "all_cases_must_pass";
      evaluatedCaseCount: number;
      passCaseCount: number;
      failCaseCount: number;
      insufficientCaseCount: number;
      outcome: "pass" | "fail" | "insufficient";
    };
  };
  limitations: string[];
  chainReferences: string[];
  generatedAt: string;
  signature: string;
}

export interface HumanAssuranceClientDecision {
  schemaVersion: typeof HUMAN_ASSURANCE_SCHEMA_VERSION;
  decisionId: string;
  runId: string;
  decision: "go" | "revise" | "stop" | "no_decision";
  note?: string;
  decidedBy: string;
  evidencePacketId: string;
  decidedAt: string;
}

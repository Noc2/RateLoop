import type {
  HUMAN_ASSURANCE_SCHEMA_VERSION,
  HumanAssuranceAudiencePolicy,
  HumanAssuranceDataClassification,
  HumanAssuranceRubric,
} from "./humanAssuranceTypes";
import type { TokenlessRequestProfileReference } from "./tokenlessTypes";

export interface HumanAssuranceProjectCreateRequest {
  name: string;
  description?: string;
  dataClassification: HumanAssuranceDataClassification;
  retentionDays: number;
}

export interface HumanAssuranceProjectCreateResponse {
  schemaVersion: typeof HUMAN_ASSURANCE_SCHEMA_VERSION;
  projectId: string;
  workspaceId: string;
}

export type HumanAssurancePrivateArtifactInput = {
  contentType: string;
  bytesBase64: string;
};

export interface HumanAssurancePrivateReviewCreateRequest {
  idempotencyKey: string;
  integrationId: string;
  projectId: string;
  requestProfile: TokenlessRequestProfileReference;
  cohortId: string;
  dataClassification: Extract<
    HumanAssuranceDataClassification,
    "internal" | "confidential" | "restricted" | "regulated"
  >;
  source: HumanAssurancePrivateArtifactInput;
  suggestion: HumanAssurancePrivateArtifactInput;
}

export interface HumanAssurancePrivateReviewCreateResponse {
  schemaVersion: typeof HUMAN_ASSURANCE_SCHEMA_VERSION;
  privateReviewId: string;
  status: "ready_for_assignment" | "awaiting_owner_rebind";
  lane: "private";
  task: { kind: "binary_review"; commitment: `sha256:${string}` };
  bindings: {
    bindingHash: `sha256:${string}`;
    project: { projectId: string; hash: `sha256:${string}` };
    requestProfile: TokenlessRequestProfileReference;
    privateGroup: {
      groupId: string;
      policyVersion: number;
      policyHash: `sha256:${string}`;
      allowlistHash: `sha256:${string}`;
      allowlistStatus: "allowed" | "excluded";
    };
    cohort: { cohortId: string; hash: `sha256:${string}` };
  };
  artifacts: { sourceArtifactId: string; suggestionArtifactId: string };
  responseWindowSeconds: number;
  responseDeadline: string;
}

export interface HumanAssuranceProjectSummary {
  projectId: string;
  name: string;
  description?: string;
  dataClassification: HumanAssuranceDataClassification;
  status: "active" | "archived";
  retentionDays: number;
  suiteCount: number;
  runCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface HumanAssuranceProjectListResponse {
  schemaVersion: typeof HUMAN_ASSURANCE_SCHEMA_VERSION;
  workspaceId: string;
  projects: HumanAssuranceProjectSummary[];
}

export interface HumanAssuranceProjectResourcesResponse {
  schemaVersion: typeof HUMAN_ASSURANCE_SCHEMA_VERSION;
  projectId: string;
  suites: Array<{
    suiteId: string;
    name: string;
    version: number;
    status: "draft" | "frozen" | "retired";
    manifestHash: `sha256:${string}` | null;
    caseCount: number;
    frozenAt: string | null;
  }>;
  policies: Array<{
    policyId: string;
    version: number;
    reviewerSource: "customer_invited" | "rateloop_network" | "hybrid";
    compensation: HumanAssuranceAudiencePolicy["compensation"];
    selection: HumanAssuranceAudiencePolicy["selection"];
    policyHash: `sha256:${string}`;
  }>;
  runs: Array<{
    runId: string;
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
    manifestHash: `sha256:${string}` | null;
    previousRunId: string | null;
    createdAt: string;
    updatedAt: string;
    completedAt: string | null;
  }>;
}

export interface HumanAssuranceRunStatusResponse {
  schemaVersion: typeof HUMAN_ASSURANCE_SCHEMA_VERSION;
  runId: string;
  runStatus:
    | "draft"
    | "frozen"
    | "recruiting"
    | "collecting"
    | "aggregating"
    | "completed"
    | "cancelled";
  totalCases: number;
  roundStates: Partial<
    Record<
      | "planned"
      | "submitted"
      | "open"
      | "revealable"
      | "settling"
      | "finalized"
      | "terminal"
      | "failed",
      number
    >
  >;
  deterministicChecks: {
    notApplicable: number;
    pending: number;
    passed: number;
    failed: number;
  };
  responses: {
    baseline: number;
    candidate: number;
    tie: number;
    valid: number;
  };
  candidatePreferenceShareBps: number | null;
  passRule: HumanAssuranceRubric["passRule"];
  decision: "pending" | "passed" | "failed";
  rerun: {
    rootRunId: string;
    previousRunId: string | null;
    previousManifestHash: `sha256:${string}` | null;
    ordinal: number;
  } | null;
}

export interface HumanAssuranceApiClient {
  listProjects(): Promise<HumanAssuranceProjectListResponse>;
  createProject(
    request: HumanAssuranceProjectCreateRequest,
  ): Promise<HumanAssuranceProjectCreateResponse>;
  createPrivateReview(
    request: HumanAssurancePrivateReviewCreateRequest,
  ): Promise<HumanAssurancePrivateReviewCreateResponse>;
  getProject(request: {
    projectId: string;
  }): Promise<HumanAssuranceProjectResourcesResponse>;
  getRunStatus(request: {
    runId: string;
  }): Promise<HumanAssuranceRunStatusResponse>;
}

export const DSA_REFERENCE_PANEL_RULES = {
  responsePolarity: {
    policyMatches: "fail",
    policyDoesNotMatch: "pass",
  },
  uncertaintyRule: "reviewers_binary_adjudicator_may_choose_uncertain",
  adjudicationRule: "qualified_non_panel_principal_required_on_disagreement",
} as const;

export type DsaReferencePanelDefinition = {
  version: number;
  question: string;
  standardId: string;
  standardVersion: string;
  standardHash: `sha256:${string}`;
  definitionHash: `sha256:${string}`;
  createdAt: string;
};

export type DsaReferencePanelCandidate = {
  unitId: string;
  publicDesignation: string;
  decisionAt: string;
  sourceRecordsReady: boolean;
  registered: boolean;
};

export type DsaReferencePanelPreparedRun = {
  runId: string;
  caseId: string;
  suiteName: string;
  caseTitle: string;
  reviewerCount: number;
  compatibleUnitIds: string[];
};

export type DsaReferencePanelManagerReadiness = {
  selectedUnitCount: number;
  sourceReadyUnitCount: number;
  registeredUnitCount: number;
  candidates: DsaReferencePanelCandidate[];
  preparedRuns: DsaReferencePanelPreparedRun[];
  registeredUnits: DsaReferencePanelManagerUnit[];
  terminalUnitCount: number;
  labelSetFrozen: boolean;
  canFreezeLabelSet: boolean;
};

export type DsaReferencePanelRegisteredUnitBase = {
  unitId: string;
  publicDesignation: string;
  requiredReviewerCount: number;
  assignedReviewerCount: number;
  responseCount: number;
  responseMaterializationState: "ready" | "retrying" | "cooldown";
  responseMaterializationFailureCount: number;
  responseMaterializationNextRetryAt: string | null;
  assignmentDeadline: string | null;
  terminal: boolean;
};

export type DsaReferencePanelManagerUnit = DsaReferencePanelRegisteredUnitBase & {
  needsAdjudication: boolean;
  adjudicatorPrincipalId: string | null;
  adjudicationDeadline: string | null;
  canFreezeOutcome: boolean;
};

export type DsaReferencePanelAuditorUnit = DsaReferencePanelRegisteredUnitBase & {
  canDeclareGap: boolean;
  canDeclareAdjudicatorGap: boolean;
  contentSelfIdentificationReportCount: number;
  canDeclareContentSelfIdentificationGap: boolean;
  needsAdjudicatorAssignment: boolean;
  adjudicatorPrincipalId: string | null;
  adjudicationDeadline: string | null;
};

export type DsaReferencePanelAuditorReadiness = {
  registeredUnitCount: number;
  terminalUnitCount: number;
  units: DsaReferencePanelAuditorUnit[];
};

export type DsaReferencePanelAdjudicationTask = {
  workspaceId: string;
  epochId: string;
  unitId: string;
  question: string;
  adjudicationDeadline: string;
};

type DsaReferencePanelEpochBase = {
  workspaceId: string;
  workspaceName: string;
  projectId: string;
  projectName: string;
  epochId: string;
  reportingWindowStart: string;
  reportingWindowEnd: string;
  definition: DsaReferencePanelDefinition | null;
  rules: typeof DSA_REFERENCE_PANEL_RULES;
};

export type DsaReferencePanelEpoch =
  | (DsaReferencePanelEpochBase & {
      role: "auditor";
      auditorReadiness: DsaReferencePanelAuditorReadiness;
    })
  | (DsaReferencePanelEpochBase & {
      role: "manager";
      managerReadiness: DsaReferencePanelManagerReadiness;
    });

export type DsaReferencePanelPilotResponse = {
  epochs: DsaReferencePanelEpoch[];
  adjudications: DsaReferencePanelAdjudicationTask[];
};

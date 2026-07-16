import { sql } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const time = (name: string) => timestamp(name, { mode: "date", withTimezone: true });

export const tokenlessWorkspaceEvidenceRetentionPolicies = pgTable(
  "tokenless_workspace_evidence_retention_policies",
  {
    workspaceId: text("workspace_id").notNull(),
    version: integer("version").notNull(),
    evidenceRetentionMonths: integer("evidence_retention_months").notNull().default(12),
    auditRetentionMonths: integer("audit_retention_months").notNull().default(12),
    basisJson: text("basis_json").notNull(),
    effectiveAt: time("effective_at").notNull(),
    supersededAt: time("superseded_at"),
    createdBy: text("created_by").notNull(),
    createdAt: time("created_at").notNull(),
  },
  table => ({
    pk: primaryKey({ columns: [table.workspaceId, table.version] }),
    activeUnique: uniqueIndex("tokenless_workspace_evidence_retention_policies_active_idx")
      .on(table.workspaceId)
      .where(sql`${table.supersededAt} IS NULL`),
  }),
);

export const tokenlessEvidenceRetentionEnforcementRuns = pgTable(
  "tokenless_evidence_retention_enforcement_runs",
  {
    runId: text("run_id").primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    workspaceId: text("workspace_id").notNull(),
    policyVersion: integer("policy_version").notNull(),
    evidenceRetentionMonths: integer("evidence_retention_months").notNull(),
    auditRetentionMonths: integer("audit_retention_months").notNull(),
    evidenceCutoffAt: time("evidence_cutoff_at").notNull(),
    auditCutoffAt: time("audit_cutoff_at").notNull(),
    state: text("state").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: time("next_attempt_at").notNull(),
    leaseExpiresAt: time("lease_expires_at"),
    objectsQueued: integer("objects_queued").notNull().default(0),
    accessLogsPruned: integer("access_logs_pruned").notNull().default(0),
    objectsHeld: integer("objects_held").notNull().default(0),
    accessLogsHeld: integer("access_logs_held").notNull().default(0),
    backlogCount: integer("backlog_count").notNull().default(0),
    auditEventsPreserved: integer("audit_events_preserved").notNull().default(0),
    evidencePacketsPreserved: integer("evidence_packets_preserved").notNull().default(0),
    attestationsPreserved: integer("attestations_preserved").notNull().default(0),
    wormReceiptsPreserved: integer("worm_receipts_preserved").notNull().default(0),
    lastError: text("last_error"),
    prunedAt: time("pruned_at"),
    completedAt: time("completed_at"),
    deadAt: time("dead_at"),
    createdAt: time("created_at").notNull(),
    updatedAt: time("updated_at").notNull(),
  },
  table => ({
    idempotencyUnique: uniqueIndex("tokenless_evidence_retention_enforcement_runs_idempotency_key_unique").on(
      table.idempotencyKey,
    ),
    activeUnique: uniqueIndex("tokenless_evidence_retention_enforcement_runs_active_idx")
      .on(table.workspaceId)
      .where(sql`${table.state} IN ('pending', 'processing', 'retry')`),
    dueIdx: index("tokenless_evidence_retention_enforcement_runs_due_idx").on(
      table.state,
      table.nextAttemptAt,
      table.leaseExpiresAt,
    ),
    workspaceIdx: index("tokenless_evidence_retention_enforcement_runs_workspace_idx").on(
      table.workspaceId,
      table.createdAt,
      table.runId,
    ),
  }),
);

export const tokenlessAssuranceProjects = pgTable(
  "tokenless_assurance_projects",
  {
    projectId: text("project_id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    dataClassification: text("data_classification").notNull(),
    visibility: text("visibility").notNull().default("private"),
    materialKind: text("material_kind"),
    privateSensitivity: text("private_sensitivity"),
    homeRegion: text("home_region").notNull().default("eu"),
    retentionPolicyId: text("retention_policy_id").notNull().default("retention-default-v1"),
    legalHoldState: text("legal_hold_state").notNull().default("none"),
    dataUsePolicyVersion: text("data_use_policy_version").notNull().default("data-use-v1"),
    status: text("status").notNull().default("active"),
    retentionDays: integer("retention_days").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: time("created_at").notNull(),
    updatedAt: time("updated_at").notNull(),
  },
  table => ({
    workspaceStatusIdx: index("tokenless_assurance_projects_workspace_status_idx").on(
      table.workspaceId,
      table.status,
      table.updatedAt,
    ),
    dimensionsIdx: index("tokenless_assurance_projects_dimensions_idx").on(
      table.workspaceId,
      table.visibility,
      table.privateSensitivity,
      table.status,
    ),
  }),
);

export const tokenlessProjectAccessAssignments = pgTable(
  "tokenless_project_access_assignments",
  {
    assignmentId: text("assignment_id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => tokenlessAssuranceProjects.projectId),
    subjectKind: text("subject_kind").notNull(),
    subjectReference: text("subject_reference").notNull(),
    role: text("role").notNull(),
    status: text("status").notNull().default("active"),
    expiresAt: time("expires_at"),
    grantedBy: text("granted_by").notNull(),
    reason: text("reason").notNull(),
    createdAt: time("created_at").notNull(),
    revokedAt: time("revoked_at"),
    revokedBy: text("revoked_by"),
  },
  table => ({
    lookupIdx: index("tokenless_project_access_assignments_lookup_idx").on(
      table.workspaceId,
      table.projectId,
      table.subjectKind,
      table.subjectReference,
      table.status,
    ),
  }),
);

export const tokenlessAssuranceArtifacts = pgTable(
  "tokenless_assurance_artifacts",
  {
    artifactId: text("artifact_id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => tokenlessAssuranceProjects.projectId),
    role: text("role").notNull(),
    label: text("label").notNull(),
    digest: text("digest").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storageRef: text("storage_ref").notNull(),
    redactionStatus: text("redaction_status").notNull(),
    rendererPolicy: text("renderer_policy").notNull(),
    createdAt: time("created_at").notNull(),
    updatedAt: time("updated_at").notNull(),
  },
  table => ({
    projectDigestRoleUnique: uniqueIndex("tokenless_assurance_artifacts_project_digest_unique").on(
      table.projectId,
      table.digest,
      table.role,
    ),
    projectIdx: index("tokenless_assurance_artifacts_project_idx").on(table.projectId, table.createdAt),
  }),
);

export const tokenlessAssuranceRubrics = pgTable(
  "tokenless_assurance_rubrics",
  {
    rubricId: text("rubric_id").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => tokenlessAssuranceProjects.projectId),
    version: integer("version").notNull(),
    prompt: text("prompt").notNull(),
    failureTagsJson: text("failure_tags_json").notNull(),
    rationaleJson: text("rationale_json").notNull(),
    passRuleJson: text("pass_rule_json").notNull(),
    rubricJson: text("rubric_json").notNull(),
    createdAt: time("created_at").notNull(),
  },
  table => ({
    pk: primaryKey({ columns: [table.rubricId, table.version] }),
    projectIdx: index("tokenless_assurance_rubrics_project_idx").on(table.projectId, table.rubricId, table.version),
  }),
);

export const tokenlessAssuranceSuites = pgTable(
  "tokenless_assurance_suites",
  {
    suiteId: text("suite_id").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => tokenlessAssuranceProjects.projectId),
    name: text("name").notNull(),
    version: integer("version").notNull(),
    status: text("status").notNull().default("draft"),
    rubricId: text("rubric_id").notNull(),
    rubricVersion: integer("rubric_version").notNull(),
    manifestHash: text("manifest_hash"),
    manifestJson: text("manifest_json"),
    frozenAt: time("frozen_at"),
    createdAt: time("created_at").notNull(),
    updatedAt: time("updated_at").notNull(),
  },
  table => ({
    pk: primaryKey({ columns: [table.suiteId, table.version] }),
    rubricFk: foreignKey({
      columns: [table.rubricId, table.rubricVersion],
      foreignColumns: [tokenlessAssuranceRubrics.rubricId, tokenlessAssuranceRubrics.version],
    }),
    projectStatusIdx: index("tokenless_assurance_suites_project_status_idx").on(
      table.projectId,
      table.status,
      table.updatedAt,
    ),
  }),
);

export const tokenlessAssuranceCases = pgTable(
  "tokenless_assurance_cases",
  {
    caseId: text("case_id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => tokenlessAssuranceProjects.projectId),
    suiteId: text("suite_id").notNull(),
    suiteVersion: integer("suite_version").notNull(),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    instructions: text("instructions").notNull(),
    baselineArtifactId: text("baseline_artifact_id")
      .notNull()
      .references(() => tokenlessAssuranceArtifacts.artifactId),
    candidateArtifactId: text("candidate_artifact_id")
      .notNull()
      .references(() => tokenlessAssuranceArtifacts.artifactId),
    contextArtifactIdsJson: text("context_artifact_ids_json").notNull(),
    objectiveReference: text("objective_reference"),
    status: text("status").notNull().default("draft"),
    createdAt: time("created_at").notNull(),
    updatedAt: time("updated_at").notNull(),
  },
  table => ({
    suiteFk: foreignKey({
      columns: [table.suiteId, table.suiteVersion],
      foreignColumns: [tokenlessAssuranceSuites.suiteId, tokenlessAssuranceSuites.version],
    }),
    suitePositionUnique: uniqueIndex("tokenless_assurance_cases_suite_position_unique").on(
      table.suiteId,
      table.suiteVersion,
      table.position,
    ),
    suiteIdx: index("tokenless_assurance_cases_suite_idx").on(
      table.suiteId,
      table.suiteVersion,
      table.status,
      table.position,
    ),
  }),
);

export const tokenlessAssuranceAudiencePolicies = pgTable(
  "tokenless_assurance_audience_policies",
  {
    policyId: text("policy_id").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => tokenlessAssuranceProjects.projectId),
    version: integer("version").notNull(),
    reviewerSource: text("reviewer_source").notNull(),
    compensation: text("compensation").notNull(),
    cohortsJson: text("cohorts_json").notNull(),
    selection: text("selection").notNull(),
    fallbacksJson: text("fallbacks_json").notNull(),
    requiredQualificationsJson: text("required_qualifications_json").notNull(),
    assuranceJson: text("assurance_json").notNull(),
    buyerPrivacyJson: text("buyer_privacy_json").notNull(),
    legalEligibilityRequired: boolean("legal_eligibility_required").notNull(),
    policyHash: text("policy_hash").notNull(),
    policyJson: text("policy_json").notNull(),
    createdAt: time("created_at").notNull(),
  },
  table => ({
    pk: primaryKey({ columns: [table.policyId, table.version] }),
    projectIdx: index("tokenless_assurance_audience_policies_project_idx").on(
      table.projectId,
      table.policyId,
      table.version,
    ),
  }),
);

export const tokenlessAssuranceRuns = pgTable(
  "tokenless_assurance_runs",
  {
    runId: text("run_id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => tokenlessAssuranceProjects.projectId),
    suiteId: text("suite_id").notNull(),
    suiteVersion: integer("suite_version").notNull(),
    audiencePolicyId: text("audience_policy_id").notNull(),
    audiencePolicyVersion: integer("audience_policy_version").notNull(),
    status: text("status").notNull().default("draft"),
    policyHash: text("policy_hash").notNull(),
    manifestHash: text("manifest_hash"),
    manifestJson: text("manifest_json"),
    previousRunId: text("previous_run_id"),
    createdBy: text("created_by").notNull(),
    createdAt: time("created_at").notNull(),
    updatedAt: time("updated_at").notNull(),
    frozenAt: time("frozen_at"),
    completedAt: time("completed_at"),
  },
  table => ({
    previousRunFk: foreignKey({
      columns: [table.previousRunId],
      foreignColumns: [table.runId],
    }),
    suiteFk: foreignKey({
      columns: [table.suiteId, table.suiteVersion],
      foreignColumns: [tokenlessAssuranceSuites.suiteId, tokenlessAssuranceSuites.version],
    }),
    audiencePolicyFk: foreignKey({
      columns: [table.audiencePolicyId, table.audiencePolicyVersion],
      foreignColumns: [tokenlessAssuranceAudiencePolicies.policyId, tokenlessAssuranceAudiencePolicies.version],
    }),
    projectStatusIdx: index("tokenless_assurance_runs_project_status_idx").on(
      table.projectId,
      table.status,
      table.updatedAt,
    ),
  }),
);

export const tokenlessAssuranceResponses = pgTable(
  "tokenless_assurance_responses",
  {
    responseId: text("response_id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => tokenlessAssuranceRuns.runId),
    caseId: text("case_id")
      .notNull()
      .references(() => tokenlessAssuranceCases.caseId),
    reviewerKey: text("reviewer_key").notNull(),
    reviewerSource: text("reviewer_source").notNull(),
    choice: text("choice").notNull(),
    failureTagKeysJson: text("failure_tag_keys_json").notNull(),
    rationaleCiphertext: text("rationale_ciphertext"),
    rationaleKeyRef: text("rationale_key_ref"),
    rationaleDigest: text("rationale_digest"),
    qualificationKeysJson: text("qualification_keys_json").notNull(),
    assuranceCapabilitiesJson: text("assurance_capabilities_json").notNull(),
    responseDigest: text("response_digest").notNull(),
    settlementReference: text("settlement_reference"),
    validity: text("validity").notNull().default("pending"),
    submittedAt: time("submitted_at").notNull(),
    updatedAt: time("updated_at").notNull(),
  },
  table => ({
    runCaseReviewerUnique: uniqueIndex("tokenless_assurance_responses_run_case_reviewer_unique").on(
      table.runId,
      table.caseId,
      table.reviewerKey,
    ),
    runValidityIdx: index("tokenless_assurance_responses_run_validity_idx").on(
      table.runId,
      table.validity,
      table.submittedAt,
    ),
  }),
);

export const tokenlessAssuranceEvidencePackets = pgTable(
  "tokenless_assurance_evidence_packets",
  {
    packetId: text("packet_id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => tokenlessAssuranceRuns.runId),
    manifestHash: text("manifest_hash").notNull(),
    caseRoot: text("case_root").notNull(),
    responseRoot: text("response_root").notNull(),
    aggregationVersion: text("aggregation_version").notNull(),
    resultJson: text("result_json").notNull(),
    limitationsJson: text("limitations_json").notNull(),
    chainReferencesJson: text("chain_references_json").notNull(),
    signature: text("signature").notNull(),
    generatedAt: time("generated_at").notNull(),
    packetDigest: text("packet_digest"),
    packetJson: text("packet_json"),
    signatureAlgorithm: text("signature_algorithm"),
    signingKeyId: text("signing_key_id"),
    signingPublicKey: text("signing_public_key"),
  },
  table => ({
    runUnique: uniqueIndex("tokenless_assurance_evidence_packets_run_unique").on(table.runId),
    packetDigestUnique: uniqueIndex("tokenless_assurance_evidence_packets_digest_unique").on(table.packetDigest),
  }),
);

export const tokenlessAssuranceClientDecisions = pgTable(
  "tokenless_assurance_client_decisions",
  {
    decisionId: text("decision_id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => tokenlessAssuranceRuns.runId),
    evidencePacketId: text("evidence_packet_id")
      .notNull()
      .references(() => tokenlessAssuranceEvidencePackets.packetId),
    decision: text("decision").notNull(),
    note: text("note"),
    decidedBy: text("decided_by").notNull(),
    decidedAt: time("decided_at").notNull(),
    evidencePacketDigest: text("evidence_packet_digest"),
    decisionDigest: text("decision_digest"),
    decisionJson: text("decision_json"),
  },
  table => ({
    runUnique: uniqueIndex("tokenless_assurance_client_decisions_run_unique").on(table.runId),
    decisionDigestUnique: uniqueIndex("tokenless_assurance_client_decisions_digest_unique").on(table.decisionDigest),
  }),
);

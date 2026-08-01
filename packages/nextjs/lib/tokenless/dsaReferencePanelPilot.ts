import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { type DatabaseClient, dbClient } from "~~/lib/db";
import { readEncryptedArtifact } from "~~/lib/tokenless/artifactPrivacy";
import { projectDsaNamedPanelMaterializationRetry } from "~~/lib/tokenless/dsaNamedPanelMaterializationRetry";
import {
  DSA_REFERENCE_PANEL_RULES,
  type DsaReferencePanelAdjudicationTask,
  type DsaReferencePanelAuditorUnit,
  type DsaReferencePanelCandidate,
  type DsaReferencePanelDefinition,
  type DsaReferencePanelEpoch,
  type DsaReferencePanelManagerUnit,
  type DsaReferencePanelPilotResponse,
  type DsaReferencePanelPreparedRun,
} from "~~/lib/tokenless/dsaReferencePanelPilotTypes";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;
type InternalRegisteredUnit = DsaReferencePanelManagerUnit & DsaReferencePanelAuditorUnit;
type CefrLevel = "B2" | "C1" | "C2";
type QualificationEntry = {
  key?: unknown;
  value?: unknown;
  verifiedAt?: unknown;
  expiresAt?: unknown;
  source?: unknown;
  assertedBy?: unknown;
  evidenceVersion?: unknown;
  evidenceReferenceHash?: unknown;
};

const CEFR_ORDER: readonly CefrLevel[] = ["B2", "C1", "C2"];
const HASH = /^sha256:[0-9a-f]{64}$/u;

function requiredText(row: Row, key: string) {
  const value = row[key];
  if (typeof value !== "string" || !value) throw new Error(`Stored ${key} is invalid.`);
  return value;
}

function nullableText(row: Row, key: string) {
  if (row[key] === null || row[key] === undefined) return null;
  return requiredText(row, key);
}

function requiredInteger(row: Row, key: string) {
  const value = Number(row[key]);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Stored ${key} is invalid.`);
  return value;
}

function requiredInstant(row: Row, key: string) {
  const value = row[key] instanceof Date ? row[key] : new Date(String(row[key]));
  if (!Number.isFinite(value.getTime())) throw new Error(`Stored ${key} is invalid.`);
  return value.toISOString();
}

function nullableInstant(row: Row, key: string) {
  if (row[key] === null || row[key] === undefined) return null;
  return requiredInstant(row, key);
}

function requiredBoolean(row: Row, key: string) {
  if (typeof row[key] !== "boolean") throw new Error(`Stored ${key} is invalid.`);
  return row[key];
}

function exactQualification(
  provenance: unknown,
  input: { key: string; currentTime: Date; accepts: (value: unknown) => boolean },
) {
  if (!Array.isArray(provenance)) return false;
  const matches = (provenance as QualificationEntry[]).filter(entry => {
    if (!entry || typeof entry !== "object" || entry.key !== input.key || !input.accepts(entry.value)) return false;
    const verifiedAt = new Date(String(entry.verifiedAt));
    const expiresAt = new Date(String(entry.expiresAt));
    return (
      typeof entry.source === "string" &&
      entry.source.length > 0 &&
      typeof entry.assertedBy === "string" &&
      entry.assertedBy.length > 0 &&
      typeof entry.evidenceVersion === "string" &&
      entry.evidenceVersion.length > 0 &&
      entry.evidenceVersion.length <= 80 &&
      Number.isFinite(verifiedAt.getTime()) &&
      verifiedAt <= input.currentTime &&
      Number.isFinite(expiresAt.getTime()) &&
      expiresAt > input.currentTime &&
      typeof entry.evidenceReferenceHash === "string" &&
      HASH.test(entry.evidenceReferenceHash)
    );
  });
  return matches.length === 1;
}

function qualifiedForAdjudication(row: Row) {
  let provenance: unknown;
  try {
    provenance = JSON.parse(requiredText(row, "qualification_provenance_json"));
  } catch {
    return false;
  }
  const requiredCefr = requiredText(row, "required_cefr_level") as CefrLevel;
  const requiredIndex = CEFR_ORDER.indexOf(requiredCefr);
  if (requiredIndex < 0) return false;
  const currentTime = new Date(requiredInstant(row, "projection_now"));
  const language = exactQualification(provenance, {
    key: `language:${requiredText(row, "language_tag").toLowerCase()}:reading:cefr`,
    currentTime,
    accepts: value => typeof value === "string" && CEFR_ORDER.indexOf(value as CefrLevel) >= requiredIndex,
  });
  const category = exactQualification(provenance, {
    key: `dsa-policy-category:${requiredText(row, "policy_category_code")}`,
    currentTime,
    accepts: value => value === true,
  });
  return language && category;
}

function definitionFromRow(row: Row): DsaReferencePanelDefinition | null {
  const fields = [
    "definition_version",
    "definition_question",
    "standard_id",
    "standard_version",
    "standard_hash",
    "definition_hash",
    "definition_created_at",
  ] as const;
  const present = fields.filter(field => row[field] !== null && row[field] !== undefined);
  if (present.length === 0) return null;
  if (present.length !== fields.length) throw new Error("Stored DSA reference definition is incomplete.");
  const standardHash = requiredText(row, "standard_hash");
  const definitionHash = requiredText(row, "definition_hash");
  if (!/^sha256:[0-9a-f]{64}$/u.test(standardHash) || !/^sha256:[0-9a-f]{64}$/u.test(definitionHash)) {
    throw new Error("Stored DSA reference definition hash is invalid.");
  }
  return {
    version: requiredInteger(row, "definition_version"),
    question: requiredText(row, "definition_question"),
    standardId: requiredText(row, "standard_id"),
    standardVersion: requiredText(row, "standard_version"),
    standardHash: standardHash as `sha256:${string}`,
    definitionHash: definitionHash as `sha256:${string}`,
    createdAt: requiredInstant(row, "definition_created_at"),
  };
}

export async function readDsaReferencePanelPilot(
  input: { accountAddress: string },
  client: DatabaseClient = dbClient,
): Promise<DsaReferencePanelPilotResponse> {
  const principal = normalizeAccountSubject(input.accountAddress);
  const epochsResult = await client.execute({
    sql: `/* dsa-reference-panel:epochs */
      SELECT epoch.workspace_id,workspace.name AS workspace_name,epoch.project_id,project.name AS project_name,
             epoch.epoch_id,epoch.reporting_window_start,epoch.reporting_window_end,
             CASE WHEN EXISTS (
               SELECT 1 FROM tokenless_workspace_members manager
               WHERE manager.workspace_id=epoch.workspace_id AND manager.account_address=?
                 AND manager.role IN ('owner','admin')
             ) THEN 'manager' ELSE 'auditor' END AS access_role,
             definition.version AS definition_version,definition.question AS definition_question,
             definition.standard_id,definition.standard_version,definition.standard_hash,
             definition.definition_hash,definition.created_at AS definition_created_at,
             EXISTS (SELECT 1 FROM tokenless_dsa_reference_label_sets label_set
                     WHERE label_set.workspace_id=epoch.workspace_id AND label_set.epoch_id=epoch.epoch_id)
               AS label_set_frozen
      FROM tokenless_dsa_reference_sampling_epochs epoch
      JOIN tokenless_workspaces workspace ON workspace.workspace_id=epoch.workspace_id AND workspace.status='active'
      JOIN tokenless_assurance_projects project
        ON project.workspace_id=epoch.workspace_id AND project.project_id=epoch.project_id AND project.status='active'
      LEFT JOIN tokenless_dsa_named_panel_reference_definitions definition
        ON definition.workspace_id=epoch.workspace_id AND definition.project_id=epoch.project_id
       AND definition.epoch_id=epoch.epoch_id
      WHERE EXISTS (
        SELECT 1 FROM tokenless_workspace_members manager
        WHERE manager.workspace_id=epoch.workspace_id AND manager.account_address=?
          AND manager.role IN ('owner','admin')
      ) OR (
        NOT EXISTS (
          SELECT 1 FROM tokenless_workspace_members member
          WHERE member.workspace_id=epoch.workspace_id AND member.account_address=?
        )
        AND EXISTS (
          SELECT 1 FROM tokenless_project_access_assignments access
          WHERE access.workspace_id=epoch.workspace_id AND access.project_id=epoch.project_id
            AND access.subject_kind='principal' AND access.subject_reference=?
            AND access.role='auditor' AND access.status='active'
            AND (access.expires_at IS NULL OR access.expires_at>CURRENT_TIMESTAMP)
        )
      )
      ORDER BY epoch.reporting_window_end DESC,epoch.epoch_id`,
    args: [principal, principal, principal, principal],
  });

  const candidateResult = await client.execute({
    sql: `/* dsa-reference-panel:candidates */
      SELECT manifest.workspace_id,epoch.project_id,manifest.epoch_id,manifest.unit_id,
             manifest.public_designation,manifest.decision_at,
             (evaluation.evaluation_id IS NOT NULL
               AND evaluation.disposition='eligible_draw' AND evaluation.reference_label_state='unlabeled'
               AND projection.provider_decision_id IS NOT NULL
               AND engagement.engagement_id IS NOT NULL
               AND engagement_source.engagement_id IS NOT NULL
               AND decision.provider_decision_id IS NOT NULL
               AND (engagement.transparency_payload_version IS NULL OR payload.payload_version IS NOT NULL))
               AS source_records_ready,
             (registered.unit_id IS NOT NULL) AS registered
      FROM tokenless_dsa_reference_sample_manifest manifest
      JOIN tokenless_dsa_reference_sampling_epochs epoch
        ON epoch.workspace_id=manifest.workspace_id AND epoch.epoch_id=manifest.epoch_id
      LEFT JOIN tokenless_dsa_reference_evaluation_projections evaluation
        ON evaluation.workspace_id=manifest.workspace_id AND evaluation.epoch_id=manifest.epoch_id
       AND evaluation.unit_id=manifest.unit_id
       AND evaluation.source_decision_binding=manifest.source_decision_binding
       AND evaluation.source_evaluation_binding=manifest.source_evaluation_binding
       AND evaluation.source_evaluation_hash=manifest.source_evaluation_hash
       AND evaluation.system_identity=manifest.system_identity
       AND evaluation.automated_outcome=manifest.automated_outcome
      LEFT JOIN tokenless_dsa_reference_decision_projections projection
        ON projection.workspace_id=evaluation.workspace_id AND projection.epoch_id=evaluation.epoch_id
       AND projection.provider_decision_id=evaluation.provider_decision_id
       AND projection.decision_version=evaluation.decision_version
      LEFT JOIN tokenless_dsa_engagement_versions engagement
        ON engagement.workspace_id=projection.workspace_id
       AND engagement.population_id=projection.population_id
       AND engagement.population_version=projection.population_version
       AND engagement.engagement_id=projection.engagement_id
       AND engagement.engagement_version=projection.engagement_version
       AND engagement.provider_decision_id=projection.provider_decision_id
       AND engagement.decision_version=projection.decision_version
      LEFT JOIN tokenless_dsa_source_engagement_versions engagement_source
        ON engagement_source.workspace_id=engagement.workspace_id
       AND engagement_source.engagement_id=engagement.engagement_id
       AND engagement_source.engagement_version=engagement.engagement_version
       AND engagement_source.engagement_hash=projection.engagement_hash
      LEFT JOIN tokenless_dsa_source_decision_versions decision
        ON decision.workspace_id=projection.workspace_id
       AND decision.provider_decision_id=projection.provider_decision_id
       AND decision.decision_version=projection.decision_version
       AND decision.source_decision_hash=projection.source_decision_hash
      LEFT JOIN tokenless_dsa_transparency_payload_versions payload
        ON payload.workspace_id=engagement.workspace_id
       AND payload.provider_decision_id=engagement.provider_decision_id
       AND payload.decision_version=engagement.decision_version
       AND payload.payload_version=engagement.transparency_payload_version
      LEFT JOIN tokenless_dsa_named_panel_units registered
        ON registered.workspace_id=manifest.workspace_id AND registered.epoch_id=manifest.epoch_id
       AND registered.unit_id=manifest.unit_id
      WHERE manifest.selected=true AND EXISTS (
        SELECT 1 FROM tokenless_workspace_members manager
        WHERE manager.workspace_id=manifest.workspace_id AND manager.account_address=?
          AND manager.role IN ('owner','admin')
      )
      ORDER BY manifest.epoch_id,manifest.selection_rank`,
    args: [principal],
  });

  const runResult = await client.execute({
    sql: `/* dsa-reference-panel:runs */
      WITH source_units AS (
        SELECT manifest.workspace_id,epoch.project_id,manifest.epoch_id,manifest.unit_id,
               engagement_source.engagement_json
        FROM tokenless_dsa_reference_sample_manifest manifest
        JOIN tokenless_dsa_reference_sampling_epochs epoch
          ON epoch.workspace_id=manifest.workspace_id AND epoch.epoch_id=manifest.epoch_id
        JOIN tokenless_dsa_reference_evaluation_projections evaluation
          ON evaluation.workspace_id=manifest.workspace_id AND evaluation.epoch_id=manifest.epoch_id
         AND evaluation.unit_id=manifest.unit_id
         AND evaluation.source_decision_binding=manifest.source_decision_binding
         AND evaluation.source_evaluation_binding=manifest.source_evaluation_binding
         AND evaluation.source_evaluation_hash=manifest.source_evaluation_hash
         AND evaluation.system_identity=manifest.system_identity
         AND evaluation.automated_outcome=manifest.automated_outcome
         AND evaluation.disposition='eligible_draw' AND evaluation.reference_label_state='unlabeled'
        JOIN tokenless_dsa_reference_decision_projections projection
          ON projection.workspace_id=evaluation.workspace_id AND projection.epoch_id=evaluation.epoch_id
         AND projection.provider_decision_id=evaluation.provider_decision_id
         AND projection.decision_version=evaluation.decision_version
        JOIN tokenless_dsa_engagement_versions engagement
          ON engagement.workspace_id=projection.workspace_id
         AND engagement.population_id=projection.population_id
         AND engagement.population_version=projection.population_version
         AND engagement.engagement_id=projection.engagement_id
         AND engagement.engagement_version=projection.engagement_version
         AND engagement.provider_decision_id=projection.provider_decision_id
         AND engagement.decision_version=projection.decision_version
        JOIN tokenless_dsa_source_engagement_versions engagement_source
          ON engagement_source.workspace_id=engagement.workspace_id
         AND engagement_source.engagement_id=engagement.engagement_id
         AND engagement_source.engagement_version=engagement.engagement_version
         AND engagement_source.engagement_hash=projection.engagement_hash
        JOIN tokenless_dsa_source_decision_versions decision
          ON decision.workspace_id=projection.workspace_id
         AND decision.provider_decision_id=projection.provider_decision_id
         AND decision.decision_version=projection.decision_version
         AND decision.source_decision_hash=projection.source_decision_hash
        LEFT JOIN tokenless_dsa_transparency_payload_versions payload
          ON payload.workspace_id=engagement.workspace_id
         AND payload.provider_decision_id=engagement.provider_decision_id
         AND payload.decision_version=engagement.decision_version
         AND payload.payload_version=engagement.transparency_payload_version
        WHERE manifest.selected=true
          AND (engagement.transparency_payload_version IS NULL OR payload.payload_version IS NOT NULL)
          AND NOT EXISTS (
            SELECT 1 FROM tokenless_dsa_named_panel_units registered
            WHERE registered.workspace_id=manifest.workspace_id AND registered.epoch_id=manifest.epoch_id
              AND registered.unit_id=manifest.unit_id
          )
          AND EXISTS (
            SELECT 1 FROM tokenless_workspace_members manager
            WHERE manager.workspace_id=manifest.workspace_id AND manager.account_address=?
              AND manager.role IN ('owner','admin')
          )
      )
      SELECT source.workspace_id,source.project_id,source.epoch_id,source.unit_id,
             run.run_id,run_case.case_id,
             suite.name AS suite_name,assurance_case.title AS case_title,
             (SELECT COALESCE(sum(subpanel.target_count),0) FROM tokenless_assurance_run_subpanels subpanel
              WHERE subpanel.run_id=run.run_id)::integer AS reviewer_count
      FROM source_units source
      JOIN tokenless_assurance_projects project
        ON project.workspace_id=source.workspace_id AND project.project_id=source.project_id AND project.status='active'
      JOIN tokenless_assurance_cases assurance_case ON assurance_case.project_id=source.project_id
      JOIN tokenless_assurance_artifacts artifact
        ON artifact.project_id=assurance_case.project_id AND artifact.artifact_id=assurance_case.candidate_artifact_id
       AND artifact.digest=source.engagement_json::jsonb->>'contentHash'
       AND artifact.content_type=source.engagement_json::jsonb->>'contentFormat'
      JOIN tokenless_assurance_run_cases run_case ON run_case.case_id=assurance_case.case_id
      JOIN tokenless_assurance_runs run ON run.run_id=run_case.run_id AND run.project_id=source.project_id
      JOIN tokenless_assurance_audience_policies audience_policy
        ON audience_policy.policy_id=run.audience_policy_id
       AND audience_policy.version=run.audience_policy_version
       AND audience_policy.compensation='unpaid'
      JOIN tokenless_assurance_suites suite
        ON suite.project_id=run.project_id AND suite.suite_id=run.suite_id AND suite.version=run.suite_version
      WHERE run.status='frozen'
        AND (SELECT count(*) FROM tokenless_assurance_run_cases counted WHERE counted.run_id=run.run_id)=1
        AND EXISTS (SELECT 1 FROM tokenless_assurance_run_subpanels subpanel WHERE subpanel.run_id=run.run_id)
        AND NOT EXISTS (
          SELECT 1 FROM tokenless_assurance_run_subpanels subpanel
          WHERE subpanel.run_id=run.run_id
            AND (subpanel.workspace_id<>project.workspace_id OR subpanel.project_id<>run.project_id
              OR subpanel.source<>'customer_invited' OR subpanel.selection<>'customer_named'
              OR subpanel.run_manifest_hash<>run.manifest_hash OR subpanel.policy_hash<>run.policy_hash)
        )
        AND (SELECT COALESCE(sum(subpanel.target_count),0) FROM tokenless_assurance_run_subpanels subpanel
             WHERE subpanel.run_id=run.run_id) BETWEEN 2 AND 20
        AND NOT EXISTS (SELECT 1 FROM tokenless_assurance_assignments assignment WHERE assignment.run_id=run.run_id)
        AND NOT EXISTS (SELECT 1 FROM tokenless_assurance_responses response WHERE response.run_id=run.run_id)
        AND NOT EXISTS (SELECT 1 FROM tokenless_dsa_named_panel_units unit WHERE unit.run_id=run.run_id)
      ORDER BY source.epoch_id,source.unit_id,suite.name,assurance_case.title,run.run_id`,
    args: [principal],
  });

  const unitStatusResult = await client.execute({
    sql: `/* dsa-reference-panel:unit-statuses */
      SELECT unit.workspace_id,unit.project_id,unit.epoch_id,unit.unit_id,manifest.public_designation,
             unit.required_reviewer_count,
             CASE WHEN EXISTS (
               SELECT 1 FROM tokenless_workspace_members manager
               WHERE manager.workspace_id=unit.workspace_id AND manager.account_address=?
                 AND manager.role IN ('owner','admin')
             ) THEN 'manager' ELSE 'auditor' END AS access_role,
             (SELECT count(*) FROM tokenless_dsa_named_panel_selections assignment
              WHERE assignment.workspace_id=unit.workspace_id AND assignment.epoch_id=unit.epoch_id
                AND assignment.unit_id=unit.unit_id)::integer AS assignment_count,
             (SELECT count(DISTINCT assignment.reviewer_principal_id)
              FROM tokenless_dsa_named_panel_selections assignment
              WHERE assignment.workspace_id=unit.workspace_id AND assignment.epoch_id=unit.epoch_id
                AND assignment.unit_id=unit.unit_id)::integer AS assigned_reviewer_count,
             (SELECT max(assignment.panel_deadline) FROM tokenless_dsa_named_panel_selections assignment
              WHERE assignment.workspace_id=unit.workspace_id AND assignment.epoch_id=unit.epoch_id
                AND assignment.unit_id=unit.unit_id) AS assignment_deadline,
             (SELECT count(*) FROM tokenless_dsa_named_panel_selections selection
              WHERE selection.workspace_id=unit.workspace_id AND selection.epoch_id=unit.epoch_id
                AND selection.unit_id=unit.unit_id AND (
                  EXISTS (SELECT 1 FROM tokenless_dsa_named_panel_assignment_response_bindings binding
                          WHERE binding.workspace_id=selection.workspace_id
                            AND binding.epoch_id=selection.epoch_id AND binding.unit_id=selection.unit_id
                            AND binding.assignment_id=selection.assignment_id
                            AND binding.reviewer_principal_id=selection.reviewer_principal_id
                            AND binding.response_validity='valid')
                  OR (selection.response_binding_required=false AND EXISTS (
                    SELECT 1 FROM tokenless_dsa_named_panel_response_evidence evidence
                    WHERE evidence.workspace_id=selection.workspace_id AND evidence.epoch_id=selection.epoch_id
                      AND evidence.unit_id=selection.unit_id AND evidence.assignment_id=selection.assignment_id
                      AND evidence.reviewer_principal_id=selection.reviewer_principal_id))))::integer AS response_count,
             (SELECT count(DISTINCT CASE COALESCE(
                       (SELECT evidence.response_choice FROM tokenless_dsa_named_panel_response_evidence evidence
                        WHERE evidence.workspace_id=selection.workspace_id AND evidence.epoch_id=selection.epoch_id
                          AND evidence.unit_id=selection.unit_id AND evidence.assignment_id=selection.assignment_id),
                       (SELECT binding.response_choice FROM tokenless_dsa_named_panel_assignment_response_bindings binding
                        WHERE binding.workspace_id=selection.workspace_id AND binding.epoch_id=selection.epoch_id
                          AND binding.unit_id=selection.unit_id AND binding.assignment_id=selection.assignment_id)
                     ) WHEN 'candidate' THEN 'pass' WHEN 'baseline' THEN 'fail' END)
              FROM tokenless_dsa_named_panel_selections selection
              WHERE selection.workspace_id=unit.workspace_id AND selection.epoch_id=unit.epoch_id
                AND selection.unit_id=unit.unit_id)::integer AS response_choice_count,
             (SELECT count(DISTINCT access.assignment_id) FROM tokenless_dsa_named_panel_artifact_accesses access
              WHERE access.workspace_id=unit.workspace_id AND access.epoch_id=unit.epoch_id
                AND access.unit_id=unit.unit_id)::integer AS access_count,
             (SELECT count(*) FROM tokenless_dsa_named_panel_content_self_identification_reports report
              WHERE report.workspace_id=unit.workspace_id AND report.epoch_id=unit.epoch_id
                AND report.unit_id=unit.unit_id)::integer AS content_self_identification_report_count,
             (outcome.unit_id IS NOT NULL) AS terminal,
             (adjudication.unit_id IS NOT NULL) AS adjudicated,
             (SELECT assigned.adjudicator_principal_id
              FROM tokenless_dsa_named_panel_adjudicator_assignments assigned
              WHERE assigned.workspace_id=unit.workspace_id AND assigned.epoch_id=unit.epoch_id
                AND assigned.unit_id=unit.unit_id) AS adjudicator_principal_id,
             (SELECT assigned.adjudication_deadline
              FROM tokenless_dsa_named_panel_adjudicator_assignments assigned
              WHERE assigned.workspace_id=unit.workspace_id AND assigned.epoch_id=unit.epoch_id
                AND assigned.unit_id=unit.unit_id) AS adjudication_deadline,
             materialization.state AS response_materialization_state,
             materialization.failure_count AS response_materialization_failure_count,
             materialization.next_retry_at AS response_materialization_next_retry_at,
             CURRENT_TIMESTAMP AS projection_now
      FROM tokenless_dsa_named_panel_units unit
      JOIN tokenless_dsa_reference_sample_manifest manifest
        ON manifest.workspace_id=unit.workspace_id AND manifest.epoch_id=unit.epoch_id
       AND manifest.unit_id=unit.unit_id AND manifest.selected=true
      LEFT JOIN tokenless_dsa_named_panel_unit_outcomes outcome
        ON outcome.workspace_id=unit.workspace_id AND outcome.epoch_id=unit.epoch_id AND outcome.unit_id=unit.unit_id
      LEFT JOIN tokenless_dsa_named_panel_adjudications adjudication
        ON adjudication.workspace_id=unit.workspace_id AND adjudication.epoch_id=unit.epoch_id
       AND adjudication.unit_id=unit.unit_id
      LEFT JOIN tokenless_dsa_named_panel_materialization_retries materialization
        ON materialization.workspace_id=unit.workspace_id AND materialization.epoch_id=unit.epoch_id
       AND materialization.unit_id=unit.unit_id
      WHERE EXISTS (
        SELECT 1 FROM tokenless_workspace_members manager
        WHERE manager.workspace_id=unit.workspace_id AND manager.account_address=?
          AND manager.role IN ('owner','admin')
      ) OR (
        NOT EXISTS (
          SELECT 1 FROM tokenless_workspace_members member
          WHERE member.workspace_id=unit.workspace_id AND member.account_address=?
        )
        AND EXISTS (
          SELECT 1 FROM tokenless_project_access_assignments access
          WHERE access.workspace_id=unit.workspace_id AND access.project_id=unit.project_id
            AND access.subject_kind='principal' AND access.subject_reference=?
            AND access.role='auditor' AND access.status='active'
            AND (access.expires_at IS NULL OR access.expires_at>CURRENT_TIMESTAMP)
        )
      )
      ORDER BY unit.epoch_id,unit.selection_rank`,
    args: [principal, principal, principal, principal],
  });

  const adjudicationResult = await client.execute({
    sql: `/* dsa-reference-panel:adjudications */
      SELECT unit.workspace_id,unit.project_id,unit.epoch_id,unit.unit_id,definition.question,
             assigned.adjudication_deadline,
             unit.language_tag,unit.required_cefr_level,unit.policy_category_code,
             cohort_reviewer.qualification_provenance_json,CURRENT_TIMESTAMP AS projection_now
      FROM tokenless_dsa_named_panel_units unit
      JOIN tokenless_dsa_named_panel_reference_definitions definition
        ON definition.workspace_id=unit.workspace_id AND definition.epoch_id=unit.epoch_id
       AND definition.project_id=unit.project_id
      JOIN tokenless_dsa_named_panel_adjudicator_assignments assigned
        ON assigned.workspace_id=unit.workspace_id AND assigned.project_id=unit.project_id
       AND assigned.epoch_id=unit.epoch_id AND assigned.unit_id=unit.unit_id
       AND assigned.adjudicator_principal_id=? AND assigned.adjudication_deadline>CURRENT_TIMESTAMP
      JOIN tokenless_principals principal
        ON principal.principal_id=assigned.adjudicator_principal_id AND principal.status='active'
      JOIN tokenless_workspace_reviewers reviewer
        ON reviewer.workspace_id=unit.workspace_id AND reviewer.principal_address=principal.principal_id
       AND reviewer.status='active'
      JOIN tokenless_assurance_cohort_reviewers cohort_reviewer
        ON cohort_reviewer.project_id=unit.project_id
       AND cohort_reviewer.reviewer_account_address=principal.principal_id
       AND cohort_reviewer.status='active'
      WHERE NOT EXISTS (
              SELECT 1 FROM tokenless_workspace_members member
              WHERE member.workspace_id=unit.workspace_id AND member.account_address=principal.principal_id)
        AND NOT EXISTS (
              SELECT 1 FROM tokenless_project_access_assignments access
              WHERE access.workspace_id=unit.workspace_id AND access.project_id=unit.project_id
                AND access.subject_kind='principal' AND access.subject_reference=principal.principal_id
                AND access.status='active'
                AND (access.expires_at IS NULL OR access.expires_at>CURRENT_TIMESTAMP))
        AND definition.created_by<>principal.principal_id
        AND NOT EXISTS (
              SELECT 1 FROM tokenless_dsa_named_panel_selections panel
              WHERE panel.workspace_id=unit.workspace_id AND panel.epoch_id=unit.epoch_id
                AND panel.unit_id=unit.unit_id AND panel.reviewer_principal_id=principal.principal_id)
        AND (SELECT count(DISTINCT response.derived_label)
             FROM tokenless_dsa_named_panel_response_evidence response
             WHERE response.workspace_id=unit.workspace_id AND response.epoch_id=unit.epoch_id
               AND response.unit_id=unit.unit_id)>=2
        AND NOT EXISTS (
              SELECT 1 FROM tokenless_dsa_named_panel_adjudications adjudication
              WHERE adjudication.workspace_id=unit.workspace_id AND adjudication.epoch_id=unit.epoch_id
                AND adjudication.unit_id=unit.unit_id)
        AND NOT EXISTS (
              SELECT 1 FROM tokenless_dsa_named_panel_unit_outcomes outcome
              WHERE outcome.workspace_id=unit.workspace_id AND outcome.epoch_id=unit.epoch_id
                AND outcome.unit_id=unit.unit_id)
      ORDER BY unit.epoch_id,unit.selection_rank`,
    args: [principal],
  });

  const candidatesByEpoch = new Map<string, DsaReferencePanelCandidate[]>();
  for (const row of candidateResult.rows as Row[]) {
    const key = `${requiredText(row, "workspace_id")}:${requiredText(row, "epoch_id")}`;
    const candidates = candidatesByEpoch.get(key) ?? [];
    candidates.push({
      unitId: requiredText(row, "unit_id"),
      publicDesignation: requiredText(row, "public_designation"),
      decisionAt: requiredInstant(row, "decision_at"),
      sourceRecordsReady: requiredBoolean(row, "source_records_ready"),
      registered: requiredBoolean(row, "registered"),
    });
    candidatesByEpoch.set(key, candidates);
  }

  const runsByEpoch = new Map<string, DsaReferencePanelPreparedRun[]>();
  for (const row of runResult.rows as Row[]) {
    const key = `${requiredText(row, "workspace_id")}:${requiredText(row, "epoch_id")}`;
    const runs = runsByEpoch.get(key) ?? [];
    const runId = requiredText(row, "run_id");
    const unitId = requiredText(row, "unit_id");
    const existing = runs.find(run => run.runId === runId);
    if (existing) {
      if (!existing.compatibleUnitIds.includes(unitId)) existing.compatibleUnitIds.push(unitId);
      continue;
    }
    runs.push({
      runId,
      caseId: requiredText(row, "case_id"),
      suiteName: requiredText(row, "suite_name"),
      caseTitle: requiredText(row, "case_title"),
      reviewerCount: requiredInteger(row, "reviewer_count"),
      compatibleUnitIds: [unitId],
    });
    runsByEpoch.set(key, runs);
  }

  const unitStatusesByEpoch = new Map<string, InternalRegisteredUnit[]>();
  for (const row of unitStatusResult.rows as Row[]) {
    const key = `${requiredText(row, "workspace_id")}:${requiredText(row, "epoch_id")}`;
    const requiredReviewerCount = requiredInteger(row, "required_reviewer_count");
    const assignmentCount = requiredInteger(row, "assignment_count");
    const assignedReviewerCount = requiredInteger(row, "assigned_reviewer_count");
    const responseCount = requiredInteger(row, "response_count");
    const responseChoiceCount = requiredInteger(row, "response_choice_count");
    const accessCount = requiredInteger(row, "access_count");
    const contentSelfIdentificationReportCount = requiredInteger(row, "content_self_identification_report_count");
    const terminal = requiredBoolean(row, "terminal");
    const adjudicated = requiredBoolean(row, "adjudicated");
    const adjudicatorPrincipalId = nullableText(row, "adjudicator_principal_id");
    const adjudicationDeadline = nullableInstant(row, "adjudication_deadline");
    const assignmentDeadline = nullableInstant(row, "assignment_deadline");
    const projectionNow = new Date(requiredInstant(row, "projection_now"));
    const exactPanel = assignmentCount === requiredReviewerCount && assignedReviewerCount === requiredReviewerCount;
    const fullResponses = responseCount === requiredReviewerCount;
    const responseMaterialization = projectDsaNamedPanelMaterializationRetry({
      storedState: row.response_materialization_state,
      failureCount: row.response_materialization_failure_count,
      nextRetryAt: row.response_materialization_next_retry_at,
      responseComplete: fullResponses || terminal,
    });
    const units = unitStatusesByEpoch.get(key) ?? [];
    units.push({
      unitId: requiredText(row, "unit_id"),
      publicDesignation: requiredText(row, "public_designation"),
      requiredReviewerCount,
      assignedReviewerCount,
      responseCount,
      responseMaterializationState: responseMaterialization.state,
      responseMaterializationFailureCount: responseMaterialization.failureCount,
      responseMaterializationNextRetryAt: responseMaterialization.nextRetryAt,
      assignmentDeadline,
      terminal,
      needsAdjudication: !terminal && fullResponses && responseChoiceCount >= 2 && !adjudicated,
      needsAdjudicatorAssignment:
        !terminal && fullResponses && responseChoiceCount >= 2 && !adjudicated && adjudicatorPrincipalId === null,
      adjudicatorPrincipalId,
      adjudicationDeadline,
      canFreezeOutcome:
        !terminal &&
        exactPanel &&
        fullResponses &&
        accessCount === requiredReviewerCount &&
        (responseChoiceCount === 1 || adjudicated),
      canDeclareGap:
        !terminal &&
        exactPanel &&
        assignmentDeadline !== null &&
        new Date(assignmentDeadline) < projectionNow &&
        responseCount < requiredReviewerCount,
      canDeclareAdjudicatorGap:
        !terminal &&
        fullResponses &&
        responseChoiceCount >= 2 &&
        !adjudicated &&
        adjudicationDeadline !== null &&
        new Date(adjudicationDeadline) < projectionNow,
      contentSelfIdentificationReportCount,
      canDeclareContentSelfIdentificationGap:
        !terminal && exactPanel && contentSelfIdentificationReportCount > 0 && responseCount < requiredReviewerCount,
    });
    unitStatusesByEpoch.set(key, units);
  }

  const adjudications: DsaReferencePanelAdjudicationTask[] = [];
  const seenAdjudications = new Set<string>();
  for (const row of adjudicationResult.rows as Row[]) {
    if (!qualifiedForAdjudication(row)) continue;
    const workspaceId = requiredText(row, "workspace_id");
    const epochId = requiredText(row, "epoch_id");
    const unitId = requiredText(row, "unit_id");
    const key = `${workspaceId}:${epochId}:${unitId}`;
    if (seenAdjudications.has(key)) continue;
    seenAdjudications.add(key);
    adjudications.push({
      workspaceId,
      epochId,
      unitId,
      question: requiredText(row, "question"),
      adjudicationDeadline: requiredInstant(row, "adjudication_deadline"),
    });
  }

  const epochs: DsaReferencePanelEpoch[] = (epochsResult.rows as Row[]).map(row => {
    const workspaceId = requiredText(row, "workspace_id");
    const projectId = requiredText(row, "project_id");
    const epochId = requiredText(row, "epoch_id");
    const role = requiredText(row, "access_role");
    const base = {
      workspaceId,
      workspaceName: requiredText(row, "workspace_name"),
      projectId,
      projectName: requiredText(row, "project_name"),
      epochId,
      reportingWindowStart: requiredInstant(row, "reporting_window_start"),
      reportingWindowEnd: requiredInstant(row, "reporting_window_end"),
      definition: definitionFromRow(row),
      rules: DSA_REFERENCE_PANEL_RULES,
    };
    const registeredUnits = unitStatusesByEpoch.get(`${workspaceId}:${epochId}`) ?? [];
    if (role === "auditor") {
      return {
        ...base,
        role,
        auditorReadiness: {
          registeredUnitCount: registeredUnits.length,
          terminalUnitCount: registeredUnits.filter(unit => unit.terminal).length,
          units: registeredUnits.map(
            ({
              canDeclareGap,
              canDeclareAdjudicatorGap,
              contentSelfIdentificationReportCount,
              canDeclareContentSelfIdentificationGap,
              needsAdjudicatorAssignment,
              adjudicatorPrincipalId,
              adjudicationDeadline,
              unitId,
              publicDesignation,
              requiredReviewerCount,
              assignedReviewerCount,
              responseCount,
              responseMaterializationState,
              responseMaterializationFailureCount,
              responseMaterializationNextRetryAt,
              assignmentDeadline,
              terminal,
            }) => ({
              unitId,
              publicDesignation,
              requiredReviewerCount,
              assignedReviewerCount,
              responseCount,
              responseMaterializationState,
              responseMaterializationFailureCount,
              responseMaterializationNextRetryAt,
              assignmentDeadline,
              terminal,
              canDeclareGap,
              canDeclareAdjudicatorGap,
              contentSelfIdentificationReportCount,
              canDeclareContentSelfIdentificationGap,
              needsAdjudicatorAssignment,
              adjudicatorPrincipalId,
              adjudicationDeadline,
            }),
          ),
        },
      };
    }
    if (role !== "manager") throw new Error("Stored DSA reference-panel access role is invalid.");
    const candidates = candidatesByEpoch.get(`${workspaceId}:${epochId}`) ?? [];
    const terminalUnitCount = registeredUnits.filter(unit => unit.terminal).length;
    const labelSetFrozen = requiredBoolean(row, "label_set_frozen");
    return {
      ...base,
      role,
      managerReadiness: {
        selectedUnitCount: candidates.length,
        sourceReadyUnitCount: candidates.filter(candidate => candidate.sourceRecordsReady).length,
        registeredUnitCount: candidates.filter(candidate => candidate.registered).length,
        candidates,
        preparedRuns: runsByEpoch.get(`${workspaceId}:${epochId}`) ?? [],
        registeredUnits: registeredUnits.map(
          ({
            canFreezeOutcome,
            needsAdjudication,
            adjudicatorPrincipalId,
            adjudicationDeadline,
            unitId,
            publicDesignation,
            requiredReviewerCount,
            assignedReviewerCount,
            responseCount,
            responseMaterializationState,
            responseMaterializationFailureCount,
            responseMaterializationNextRetryAt,
            assignmentDeadline,
            terminal,
          }) => ({
            unitId,
            publicDesignation,
            requiredReviewerCount,
            assignedReviewerCount,
            responseCount,
            responseMaterializationState,
            responseMaterializationFailureCount,
            responseMaterializationNextRetryAt,
            assignmentDeadline,
            terminal,
            needsAdjudication,
            adjudicatorPrincipalId,
            adjudicationDeadline,
            canFreezeOutcome,
          }),
        ),
        terminalUnitCount,
        labelSetFrozen,
        canFreezeLabelSet:
          !labelSetFrozen &&
          candidates.length > 0 &&
          registeredUnits.length === candidates.length &&
          terminalUnitCount === candidates.length,
      },
    };
  });
  return { epochs, adjudications };
}

export async function readDsaReferencePanelAdjudicationArtifact(
  input: {
    accountAddress: string;
    workspaceId: string;
    epochId: string;
    unitId: string;
    leaseId: string;
  },
  dependencies: {
    client?: DatabaseClient;
    readArtifact?: typeof readEncryptedArtifact;
  } = {},
) {
  const principal = normalizeAccountSubject(input.accountAddress);
  const client = dependencies.client ?? dbClient;
  const markerResult = await client.execute({
    sql: `/* dsa-reference-panel:adjudication-artifact */
      SELECT marker.project_id,marker.artifact_id
      FROM tokenless_dsa_named_panel_adjudication_artifact_leases marker
      JOIN tokenless_assurance_artifact_leases lease
        ON lease.lease_id=marker.lease_id AND lease.artifact_id=marker.artifact_id
       AND lease.workspace_id=marker.workspace_id AND lease.project_id=marker.project_id
       AND lease.account_address=marker.adjudicator_principal_id
       AND lease.purpose='dsa_named_panel_adjudication'
      WHERE marker.workspace_id=? AND marker.epoch_id=? AND marker.unit_id=?
        AND marker.lease_id=? AND marker.adjudicator_principal_id=?
        AND marker.qualification_expires_at>CURRENT_TIMESTAMP
        AND lease.revoked_at IS NULL AND lease.expires_at>CURRENT_TIMESTAMP
        AND NOT EXISTS (
          SELECT 1 FROM tokenless_dsa_named_panel_adjudications adjudication
          WHERE adjudication.workspace_id=marker.workspace_id AND adjudication.epoch_id=marker.epoch_id
            AND adjudication.unit_id=marker.unit_id)
        AND NOT EXISTS (
          SELECT 1 FROM tokenless_dsa_named_panel_unit_outcomes outcome
          WHERE outcome.workspace_id=marker.workspace_id AND outcome.epoch_id=marker.epoch_id
            AND outcome.unit_id=marker.unit_id)
      LIMIT 1`,
    args: [input.workspaceId, input.epochId, input.unitId, input.leaseId, principal],
  });
  const marker = markerResult.rows[0] as Row | undefined;
  if (!marker) throw new TokenlessServiceError("Artifact not found.", 404, "artifact_not_found");
  return (dependencies.readArtifact ?? readEncryptedArtifact)({
    accountAddress: principal,
    artifactId: requiredText(marker, "artifact_id"),
    dsaNamedPanelAdjudication: { epochId: input.epochId, unitId: input.unitId },
    leaseId: input.leaseId,
    projectId: requiredText(marker, "project_id"),
    purpose: "read",
    workspaceId: input.workspaceId,
  });
}

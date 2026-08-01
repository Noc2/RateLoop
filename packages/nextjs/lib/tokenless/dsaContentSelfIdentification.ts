import { canonicalizeRfc8785, sha256Rfc8785 } from "@rateloop/node-utils/jcs";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbPool } from "~~/lib/db";
import { assertDsaNamedPanelPrincipalEligible } from "~~/lib/tokenless/dsaNamedPanelEligibility";
import { dsaNamedPanelResponseEvidenceRoot } from "~~/lib/tokenless/dsaNamedPanelResponseRoot.mjs";
import { materializeDsaNamedPanelResponses } from "~~/lib/tokenless/dsaNamedReferencePanel";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;

const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/u;
const EPOCH_ID = /^rse_[0-9a-f]{40}$/u;
const UNIT_ID = /^rsu_[A-Za-z0-9_-]{22}$/u;
const REPORT_REASON = "content_self_identification" as const;

function fail(message: string, code = "dsa_named_panel_invalid", status = 400): never {
  throw new TokenlessServiceError(message, status, code);
}

function principal(value: string) {
  try {
    return normalizeAccountSubject(value);
  } catch {
    fail("A valid signed-in account is required.", "invalid_account", 401);
  }
}

function exactId(value: string, field: string, pattern = ID) {
  if (!pattern.test(value)) fail(`${field} is invalid.`);
  return value;
}

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function count(row: Row | undefined, key: string) {
  const value = Number(row?.[key]);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Stored ${key} is invalid.`);
  return value;
}

function instant(row: Row | undefined, key: string) {
  const value = row?.[key] instanceof Date ? (row[key] as Date) : new Date(String(row?.[key]));
  if (!Number.isFinite(value.getTime())) throw new Error(`Stored ${key} is invalid.`);
  return value;
}

function canonical(value: unknown) {
  try {
    return canonicalizeRfc8785(value);
  } catch {
    fail("DSA content self-identification evidence is not canonicalizable.");
  }
}

async function transaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query(
      `SELECT set_config('lock_timeout','2s',true),set_config('statement_timeout','30s',true),
              set_config('idle_in_transaction_session_timeout','30s',true)`,
    );
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function databaseNow(client: PoolClient) {
  const result = await client.query("SELECT date_trunc('milliseconds',transaction_timestamp()) AS now");
  return instant(result.rows[0] as Row | undefined, "now");
}

function responseEvidenceRoot(rows: readonly Row[]) {
  return dsaNamedPanelResponseEvidenceRoot(
    rows.map(value => [
      text(value, "assignment_id")!,
      text(value, "reviewer_principal_id")!,
      text(value, "response_id")!,
      text(value, "response_digest")!,
      text(value, "derived_label")!,
      text(value, "evidence_hash")!,
    ]),
  );
}

export function dsaContentSelfIdentificationReportRoot(rows: readonly Row[]) {
  const body = rows
    .map(row => ["assignment_id", "report_id", "access_id", "report_hash"].map(key => text(row, key)!).join("|"))
    .join("\n");
  const payload = `rateloop.dsa-named-panel-content-self-identification-report-root.v1\0${body}\n`;
  return `sha256:${createHash("sha256").update(payload, "utf8").digest("hex")}` as const;
}

export async function submitDsaContentSelfIdentificationReportIfExists(input: {
  accountAddress: string;
  assignmentId: string;
  reason: typeof REPORT_REASON | undefined;
}) {
  const reporter = principal(input.accountAddress);
  exactId(input.assignmentId, "assignmentId");
  if (input.reason !== REPORT_REASON) fail("The content self-identification report is invalid.");
  return transaction(async client => {
    const reportedAt = await databaseNow(client);
    const location = await client.query(
      `SELECT workspace_id,project_id,epoch_id,unit_id,reviewer_principal_id
       FROM tokenless_dsa_named_panel_selections
       WHERE assignment_id=$1 AND reviewer_principal_id=$2`,
      [input.assignmentId, reporter],
    );
    if (location.rowCount === 0) return null;
    if (location.rowCount !== 1)
      fail(
        "The assignment has more than one named-panel seat.",
        "dsa_named_panel_content_self_identification_conflict",
        409,
      );
    const exactLocation = location.rows[0] as Row;
    const unitLock = await client.query(
      `SELECT 1 FROM tokenless_dsa_named_panel_units
       WHERE workspace_id=$1 AND project_id=$2 AND epoch_id=$3 AND unit_id=$4 FOR UPDATE`,
      [
        text(exactLocation, "workspace_id"),
        text(exactLocation, "project_id"),
        text(exactLocation, "epoch_id"),
        text(exactLocation, "unit_id"),
      ],
    );
    if (unitLock.rowCount !== 1)
      fail("The exact named-panel unit is unavailable.", "dsa_named_panel_content_self_identification_conflict", 409);
    await client.query(
      `SELECT assignment_id FROM tokenless_assurance_assignments
       WHERE assignment_id=$1 AND reviewer_account_address=$2 FOR UPDATE`,
      [input.assignmentId, reporter],
    );
    const result = await client.query(
      `SELECT unit.workspace_id,unit.project_id,unit.epoch_id,unit.unit_id,unit.run_id,unit.case_id,
              unit.mapping_commitment,unit.content_artifact_id,unit.content_artifact_digest,
              selection.panel_deadline,assignment.status AS assignment_status,assignment.lease_state,
              assignment.paid_assignment,assignment.subpanel_id,assignment.cohort_id,
              panel.assignment_id AS accepted_panel_assignment_id,
              access.access_id,access.accessed_at,
              report.report_id AS existing_report_id,report.report_hash AS existing_report_hash,
              (outcome.unit_id IS NOT NULL) AS terminal
       FROM tokenless_assurance_assignments assignment
       JOIN tokenless_dsa_named_panel_selections selection
         ON selection.workspace_id=assignment.workspace_id AND selection.project_id=assignment.project_id
        AND selection.run_id=assignment.run_id AND selection.assignment_id=assignment.assignment_id
        AND selection.reviewer_principal_id=assignment.reviewer_account_address
       JOIN tokenless_dsa_named_panel_units unit
         ON unit.workspace_id=selection.workspace_id AND unit.project_id=selection.project_id
        AND unit.epoch_id=selection.epoch_id AND unit.unit_id=selection.unit_id
        AND unit.run_id=selection.run_id AND unit.case_id=selection.case_id
        AND unit.mapping_commitment=selection.mapping_commitment
       LEFT JOIN tokenless_dsa_named_panel_assignments panel
         ON panel.workspace_id=selection.workspace_id AND panel.epoch_id=selection.epoch_id
        AND panel.unit_id=selection.unit_id AND panel.assignment_id=selection.assignment_id
        AND panel.reviewer_principal_id=selection.reviewer_principal_id
       LEFT JOIN tokenless_dsa_named_panel_artifact_accesses access
         ON access.workspace_id=selection.workspace_id AND access.epoch_id=selection.epoch_id
        AND access.unit_id=selection.unit_id AND access.assignment_id=selection.assignment_id
        AND access.reviewer_principal_id=selection.reviewer_principal_id
        AND access.artifact_id=unit.content_artifact_id AND access.artifact_digest=unit.content_artifact_digest
       LEFT JOIN tokenless_dsa_named_panel_content_self_identification_reports report
         ON report.workspace_id=selection.workspace_id AND report.epoch_id=selection.epoch_id
        AND report.unit_id=selection.unit_id AND report.assignment_id=selection.assignment_id
       LEFT JOIN tokenless_dsa_named_panel_unit_outcomes outcome
         ON outcome.workspace_id=selection.workspace_id AND outcome.epoch_id=selection.epoch_id
        AND outcome.unit_id=selection.unit_id
       WHERE assignment.assignment_id=$1 AND assignment.reviewer_account_address=$2`,
      [input.assignmentId, reporter],
    );
    const row = result.rows[0] as Row | undefined;
    if (result.rowCount !== 1 || !row)
      fail(
        "The exact named-panel assignment changed while locking.",
        "dsa_named_panel_content_self_identification_conflict",
        409,
      );
    const existingReportId = text(row, "existing_report_id");
    if (existingReportId) {
      return {
        assignmentId: input.assignmentId,
        accepted: true as const,
        replay: true,
        responseCount: 0,
        compensation: "unpaid" as const,
        settlementStatus: "not_applicable" as const,
        terminalKind: "content_self_identification_gap" as const,
        reportId: existingReportId,
        reportHash: text(row, "existing_report_hash")!,
      };
    }
    if (
      text(row, "accepted_panel_assignment_id") !== input.assignmentId ||
      text(row, "assignment_status") !== "accepted" ||
      text(row, "lease_state") !== "issued" ||
      row.paid_assignment !== false ||
      row.terminal === true ||
      instant(row, "panel_deadline") < reportedAt ||
      !text(row, "access_id")
    ) {
      fail(
        "Only an active, unpaid named-panel reviewer who opened the exact case can report content self-identification.",
        "dsa_named_panel_content_self_identification_unavailable",
        409,
      );
    }
    await assertDsaNamedPanelPrincipalEligible(client, {
      workspaceId: text(row, "workspace_id")!,
      projectId: text(row, "project_id")!,
      epochId: text(row, "epoch_id")!,
      principalId: reporter,
      now: reportedAt,
    });
    const reportId = `dsapa_selfid_${sha256Rfc8785({
      assignmentId: input.assignmentId,
      mappingCommitment: text(row, "mapping_commitment"),
      reason: REPORT_REASON,
    }).slice(7, 47)}`;
    const report = {
      schemaVersion: "rateloop.dsa-named-panel-content-self-identification-report.v1",
      workspaceId: text(row, "workspace_id"),
      projectId: text(row, "project_id"),
      epochId: text(row, "epoch_id"),
      unitId: text(row, "unit_id"),
      runId: text(row, "run_id"),
      caseId: text(row, "case_id"),
      mappingCommitment: text(row, "mapping_commitment"),
      reportId,
      reason: REPORT_REASON,
      assignmentId: input.assignmentId,
      reviewerPrincipalId: reporter,
      artifactId: text(row, "content_artifact_id"),
      artifactDigest: text(row, "content_artifact_digest"),
      accessId: text(row, "access_id"),
      accessedAt: instant(row, "accessed_at").toISOString(),
      panelDeadline: instant(row, "panel_deadline").toISOString(),
      reportedAt: reportedAt.toISOString(),
    } as const;
    const reportJson = canonical(report);
    const reportHash = sha256Rfc8785(report);
    await client.query(
      `INSERT INTO tokenless_dsa_named_panel_content_self_identification_reports
       (workspace_id,project_id,epoch_id,unit_id,run_id,case_id,mapping_commitment,
        assignment_id,reviewer_principal_id,report_id,gap_reason,artifact_id,artifact_digest,
        access_id,accessed_at,panel_deadline,report_json,report_hash,reported_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'content_self_identification',$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        text(row, "workspace_id"),
        text(row, "project_id"),
        text(row, "epoch_id"),
        text(row, "unit_id"),
        text(row, "run_id"),
        text(row, "case_id"),
        text(row, "mapping_commitment"),
        input.assignmentId,
        reporter,
        reportId,
        text(row, "content_artifact_id"),
        text(row, "content_artifact_digest"),
        text(row, "access_id"),
        instant(row, "accessed_at"),
        instant(row, "panel_deadline"),
        reportJson,
        reportHash,
        reportedAt,
      ],
    );
    const openAssignments = await client.query(
      `SELECT assignment.assignment_id,assignment.status,assignment.subpanel_id,assignment.cohort_id,
              assignment.reviewer_account_address,assignment.paid_assignment
       FROM tokenless_dsa_named_panel_selections selection
       JOIN tokenless_assurance_assignments assignment
         ON assignment.workspace_id=selection.workspace_id AND assignment.project_id=selection.project_id
        AND assignment.run_id=selection.run_id AND assignment.assignment_id=selection.assignment_id
        AND assignment.reviewer_account_address=selection.reviewer_principal_id
       WHERE selection.workspace_id=$1 AND selection.epoch_id=$2 AND selection.unit_id=$3
         AND assignment.status IN ('reserved','accepted')
       ORDER BY encode(convert_to(assignment.assignment_id,'UTF8'),'hex') FOR UPDATE OF assignment`,
      [text(row, "workspace_id"), text(row, "epoch_id"), text(row, "unit_id")],
    );
    for (const value of openAssignments.rows) {
      const assignment = value as Row;
      const assignmentId = text(assignment, "assignment_id")!;
      const reviewerPrincipalId = text(assignment, "reviewer_account_address")!;
      const priorStatus = text(assignment, "status")!;
      const releasedStatus = assignmentId === input.assignmentId ? "completed" : "released";
      if (assignment.paid_assignment !== false || (assignmentId === input.assignmentId && priorStatus !== "accepted"))
        fail(
          "The self-identification quarantine can close only exact unpaid assignments.",
          "dsa_named_panel_content_self_identification_conflict",
          409,
        );
      await client.query(
        `INSERT INTO tokenless_dsa_named_panel_capacity_releases
         (workspace_id,project_id,epoch_id,unit_id,assignment_id,subpanel_id,cohort_id,reviewer_principal_id,
          prior_status,released_status,release_reason,terminal_evidence_id,released_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'content_self_identification_quarantine',$11,$12)`,
        [
          text(row, "workspace_id"),
          text(row, "project_id"),
          text(row, "epoch_id"),
          text(row, "unit_id"),
          assignmentId,
          text(assignment, "subpanel_id"),
          text(assignment, "cohort_id"),
          reviewerPrincipalId,
          priorStatus,
          releasedStatus,
          reportId,
          reportedAt,
        ],
      );
      const released = await client.query(
        `UPDATE tokenless_assurance_assignments
         SET status=$1,lease_state='expired',updated_at=$2
         WHERE assignment_id=$3 AND reviewer_account_address=$4 AND status=$5`,
        [releasedStatus, reportedAt, assignmentId, reviewerPrincipalId, priorStatus],
      );
      const subpanelReleased = await client.query(
        `UPDATE tokenless_assurance_run_subpanels SET active_reservations=active_reservations-1
         WHERE subpanel_id=$1 AND active_reservations>0`,
        [text(assignment, "subpanel_id")],
      );
      const cohortReleased = await client.query(
        `UPDATE tokenless_assurance_cohorts SET active_reservations=active_reservations-1
         WHERE project_id=$1 AND cohort_id=$2 AND active_reservations>0`,
        [text(row, "project_id"), text(assignment, "cohort_id")],
      );
      const reviewerReleased = await client.query(
        `UPDATE tokenless_assurance_cohort_reviewers SET active_reservations=active_reservations-1
         WHERE project_id=$1 AND cohort_id=$2 AND reviewer_account_address=$3 AND active_reservations>0`,
        [text(row, "project_id"), text(assignment, "cohort_id"), reviewerPrincipalId],
      );
      if (
        released.rowCount !== 1 ||
        subpanelReleased.rowCount !== 1 ||
        cohortReleased.rowCount !== 1 ||
        reviewerReleased.rowCount !== 1
      )
        fail(
          "The report could not release every exact assignment capacity.",
          "dsa_named_panel_content_self_identification_capacity_conflict",
          409,
        );
    }
    await client.query(
      `UPDATE tokenless_assurance_artifact_leases SET revoked_at=$1
       WHERE assignment_id IN (
         SELECT selection.assignment_id FROM tokenless_dsa_named_panel_selections selection
         WHERE selection.workspace_id=$2 AND selection.epoch_id=$3 AND selection.unit_id=$4)
         AND revoked_at IS NULL AND expires_at>$1`,
      [reportedAt, text(row, "workspace_id"), text(row, "epoch_id"), text(row, "unit_id")],
    );
    return {
      assignmentId: input.assignmentId,
      accepted: true as const,
      replay: false,
      responseCount: 0,
      compensation: "unpaid" as const,
      settlementStatus: "not_applicable" as const,
      terminalKind: "content_self_identification_gap" as const,
      reportId,
      reportHash,
    };
  });
}

export async function declareDsaContentSelfIdentificationGap(input: {
  accountAddress: string;
  workspaceId: string;
  epochId: string;
  unitId: string;
  reason: typeof REPORT_REASON;
}) {
  const auditor = principal(input.accountAddress);
  exactId(input.workspaceId, "workspaceId");
  exactId(input.epochId, "epochId", EPOCH_ID);
  exactId(input.unitId, "unitId", UNIT_ID);
  if (input.reason !== REPORT_REASON) fail("The sampled-unit gap reason is unsupported.");
  return transaction(async client => {
    const declaredAt = await databaseNow(client);
    const unitResult = await client.query(
      `SELECT unit.*,definition.version AS reference_definition_version,
              definition.definition_hash AS reference_definition_hash,
              definition.question AS reference_definition_question
       FROM tokenless_dsa_named_panel_units unit
       JOIN tokenless_dsa_named_panel_reference_definitions definition
         ON definition.workspace_id=unit.workspace_id AND definition.epoch_id=unit.epoch_id
       WHERE unit.workspace_id=$1 AND unit.epoch_id=$2 AND unit.unit_id=$3
       FOR UPDATE OF unit`,
      [input.workspaceId, input.epochId, input.unitId],
    );
    const unit = unitResult.rows[0] as Row | undefined;
    if (!unit) fail("DSA reference-panel assignment not found.", "dsa_named_panel_assignment_not_found", 404);
    const authority = await client.query(
      `SELECT access.assignment_id
       FROM tokenless_dsa_reference_sampling_epochs epoch
       JOIN tokenless_project_access_assignments access
         ON access.workspace_id=epoch.workspace_id AND access.project_id=epoch.project_id
        AND access.subject_kind='principal' AND access.subject_reference=$4
        AND access.role='auditor' AND access.status='active'
        AND (access.expires_at IS NULL OR access.expires_at>$5)
       LEFT JOIN tokenless_workspace_members member
         ON member.workspace_id=epoch.workspace_id AND member.account_address=$4
       WHERE epoch.workspace_id=$1 AND epoch.project_id=$2 AND epoch.epoch_id=$3
         AND member.account_address IS NULL
       LIMIT 1 FOR SHARE OF epoch,access`,
      [input.workspaceId, text(unit, "project_id"), input.epochId, auditor, declaredAt],
    );
    const auditorAccessAssignmentId = text(authority.rows[0] as Row | undefined, "assignment_id");
    if (!auditorAccessAssignmentId)
      fail(
        "An active project auditor without workspace membership must confirm a content self-identification gap.",
        "dsa_named_panel_gap_authority_required",
        403,
      );
    const existing = await client.query(
      `SELECT outcome.outcome_hash,gap.gap_evidence_id,gap.gap_hash,gap.gap_reason
       FROM tokenless_dsa_named_panel_unit_outcomes outcome
       LEFT JOIN tokenless_dsa_named_panel_unit_gaps gap
         ON gap.workspace_id=outcome.workspace_id AND gap.epoch_id=outcome.epoch_id AND gap.unit_id=outcome.unit_id
       WHERE outcome.workspace_id=$1 AND outcome.epoch_id=$2 AND outcome.unit_id=$3 FOR SHARE OF outcome`,
      [input.workspaceId, input.epochId, input.unitId],
    );
    if (existing.rowCount) {
      const row = existing.rows[0] as Row;
      if (text(row, "gap_reason") !== REPORT_REASON)
        fail("This sampled unit already has a different terminal outcome.", "dsa_named_panel_outcome_conflict", 409);
      return {
        unitId: input.unitId,
        reason: REPORT_REASON,
        gapEvidenceId: text(row, "gap_evidence_id")!,
        gapHash: text(row, "gap_hash")!,
        outcomeHash: text(row, "outcome_hash")!,
        idempotent: true,
      };
    }
    await materializeDsaNamedPanelResponses(
      client,
      { workspaceId: input.workspaceId, epochId: input.epochId, unitId: input.unitId },
      { allowIncomplete: true },
    );
    const coverage = await client.query(
      `SELECT count(*) AS assignment_count,count(DISTINCT selection.reviewer_principal_id) AS reviewer_count,
              max(selection.panel_deadline) AS assignment_deadline,
              (SELECT count(*) FROM tokenless_dsa_named_panel_assignments accepted
                WHERE accepted.workspace_id=$1 AND accepted.epoch_id=$2 AND accepted.unit_id=$3)
                AS accepted_assignment_count,
              (SELECT count(*) FROM tokenless_dsa_named_panel_response_evidence response
                WHERE response.workspace_id=$1 AND response.epoch_id=$2 AND response.unit_id=$3) AS response_count,
              (SELECT count(DISTINCT access.assignment_id) FROM tokenless_dsa_named_panel_artifact_accesses access
                WHERE access.workspace_id=$1 AND access.epoch_id=$2 AND access.unit_id=$3) AS access_count,
              (SELECT count(*) FROM tokenless_dsa_named_panel_content_self_identification_reports report
                WHERE report.workspace_id=$1 AND report.epoch_id=$2 AND report.unit_id=$3) AS report_count
       FROM tokenless_dsa_named_panel_selections selection
       WHERE selection.workspace_id=$1 AND selection.epoch_id=$2 AND selection.unit_id=$3`,
      [input.workspaceId, input.epochId, input.unitId],
    );
    const coverageRow = coverage.rows[0] as Row;
    const requiredReviewerCount = count(unit, "required_reviewer_count");
    const assignmentCount = count(coverageRow, "assignment_count");
    const reviewerCount = count(coverageRow, "reviewer_count");
    const acceptedAssignmentCount = count(coverageRow, "accepted_assignment_count");
    const responseCount = count(coverageRow, "response_count");
    const accessCount = count(coverageRow, "access_count");
    const reportCount = count(coverageRow, "report_count");
    if (assignmentCount !== requiredReviewerCount || reviewerCount !== requiredReviewerCount)
      fail("The exact frozen reviewer panel is required before declaring a gap.", "dsa_named_panel_incomplete", 409);
    if (reportCount < 1 || reportCount > acceptedAssignmentCount || responseCount >= requiredReviewerCount)
      fail(
        "An authenticated selected-reviewer report is required before confirming content self-identification.",
        "dsa_named_panel_content_self_identification_report_required",
        409,
      );
    const reports = await client.query(
      `SELECT assignment_id,report_id,access_id,report_hash
       FROM tokenless_dsa_named_panel_content_self_identification_reports
       WHERE workspace_id=$1 AND epoch_id=$2 AND unit_id=$3
       ORDER BY encode(convert_to(assignment_id,'UTF8'),'hex') FOR SHARE`,
      [input.workspaceId, input.epochId, input.unitId],
    );
    const reportRoot = dsaContentSelfIdentificationReportRoot(reports.rows as Row[]);
    const responses = await client.query(
      `SELECT assignment_id,reviewer_principal_id,response_id,response_digest,derived_label,evidence_hash
       FROM tokenless_dsa_named_panel_response_evidence
       WHERE workspace_id=$1 AND epoch_id=$2 AND unit_id=$3
       ORDER BY encode(convert_to(assignment_id,'UTF8'),'hex') FOR SHARE`,
      [input.workspaceId, input.epochId, input.unitId],
    );
    const partialResponseRoot = responseEvidenceRoot(responses.rows as Row[]);
    const assignmentDeadline = instant(coverageRow, "assignment_deadline");
    const gapEvidenceId = `dsapa_gap_${sha256Rfc8785({
      workspaceId: input.workspaceId,
      epochId: input.epochId,
      unitId: input.unitId,
      reason: REPORT_REASON,
      reportRoot,
    }).slice(7, 47)}`;
    const gap = {
      schemaVersion: "rateloop.dsa-named-panel-unit-gap.v2",
      workspaceId: input.workspaceId,
      projectId: text(unit, "project_id"),
      epochId: input.epochId,
      unitId: input.unitId,
      gapEvidenceId,
      reason: REPORT_REASON,
      referenceDefinitionVersion: count(unit, "reference_definition_version"),
      referenceDefinitionHash: text(unit, "reference_definition_hash"),
      referenceDefinitionQuestion: text(unit, "reference_definition_question"),
      requiredReviewerCount,
      assignmentCount,
      acceptedAssignmentCount,
      responseCount,
      accessCount,
      assignmentDeadline: assignmentDeadline.toISOString(),
      partialResponseRoot,
      contentSelfIdentificationReportCount: reportCount,
      contentSelfIdentificationReportRoot: reportRoot,
      reportingMode: "authenticated_reviewer_report_auditor_confirmed",
      authorityKind: "project_auditor_without_workspace_membership",
      auditorAccessAssignmentId,
      declaredBy: auditor,
      declaredAt: declaredAt.toISOString(),
    } as const;
    const gapJson = canonical(gap);
    const gapHash = sha256Rfc8785(gap);
    await client.query(
      `INSERT INTO tokenless_dsa_named_panel_unit_gaps
       (workspace_id,project_id,epoch_id,unit_id,run_id,case_id,mapping_commitment,gap_evidence_id,gap_reason,
        reference_definition_version,reference_definition_hash,reference_definition_question,
        required_reviewer_count,assignment_count,accepted_assignment_count,response_count,access_count,assignment_deadline,
        partial_response_root,content_self_identification_report_count,content_self_identification_report_root,
        authority_kind,auditor_access_assignment_id,gap_json,gap_hash,declared_by,declared_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'content_self_identification',$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
               'project_auditor_without_workspace_membership',$21,$22,$23,$24,$25)`,
      [
        input.workspaceId,
        text(unit, "project_id"),
        input.epochId,
        input.unitId,
        text(unit, "run_id"),
        text(unit, "case_id"),
        text(unit, "mapping_commitment"),
        gapEvidenceId,
        count(unit, "reference_definition_version"),
        text(unit, "reference_definition_hash"),
        text(unit, "reference_definition_question"),
        requiredReviewerCount,
        assignmentCount,
        acceptedAssignmentCount,
        responseCount,
        accessCount,
        assignmentDeadline,
        partialResponseRoot,
        reportCount,
        reportRoot,
        auditorAccessAssignmentId,
        gapJson,
        gapHash,
        auditor,
        declaredAt,
      ],
    );
    const outcome = {
      schemaVersion: "rateloop.dsa-named-panel-outcome.v1",
      workspaceId: input.workspaceId,
      epochId: input.epochId,
      unitId: input.unitId,
      requiredReviewerCount,
      responseCount,
      referenceLabel: "uncertain",
      agreementState: "gap",
      adjudicationId: null,
      gapEvidenceId,
      responseEvidenceRoot: partialResponseRoot,
      adjudicationEvidenceDigest: gapHash,
      frozenBy: auditor,
      frozenAt: declaredAt.toISOString(),
    } as const;
    const outcomeJson = canonical(outcome);
    const outcomeHash = sha256Rfc8785(outcome);
    await client.query(
      `INSERT INTO tokenless_dsa_named_panel_unit_outcomes
       (workspace_id,project_id,epoch_id,unit_id,run_id,case_id,mapping_commitment,required_reviewer_count,
        response_count,reference_label,agreement_state,adjudication_id,gap_evidence_id,response_evidence_root,
        adjudication_evidence_digest,outcome_json,outcome_hash,frozen_by,frozen_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'uncertain','gap',NULL,$10,$11,$12,$13,$14,$15,$16)`,
      [
        input.workspaceId,
        text(unit, "project_id"),
        input.epochId,
        input.unitId,
        text(unit, "run_id"),
        text(unit, "case_id"),
        text(unit, "mapping_commitment"),
        requiredReviewerCount,
        responseCount,
        gapEvidenceId,
        partialResponseRoot,
        gapHash,
        outcomeJson,
        outcomeHash,
        auditor,
        declaredAt,
      ],
    );
    return {
      unitId: input.unitId,
      reason: REPORT_REASON,
      gapEvidenceId,
      gapHash,
      outcomeHash,
      idempotent: false,
    };
  });
}

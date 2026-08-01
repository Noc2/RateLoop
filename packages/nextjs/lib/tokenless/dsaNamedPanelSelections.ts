import { canonicalizeRfc8785, sha256Rfc8785 } from "@rateloop/node-utils/jcs";
import type { PoolClient } from "pg";
import "server-only";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;

function value(row: Row | undefined, key: string) {
  const stored = row?.[key];
  return stored === null || stored === undefined ? null : String(stored);
}

function instant(row: Row, key: string) {
  const stored = row[key] instanceof Date ? (row[key] as Date) : new Date(String(row[key]));
  if (!Number.isFinite(stored.getTime())) throw new Error(`Stored ${key} is invalid.`);
  return stored;
}

/**
 * Freezes a named-panel seat in the same transaction that creates its generic
 * assurance reservation. Acceptance is deliberately later and optional.
 */
export async function freezeDsaNamedPanelSelectionAtReservation(client: PoolClient, assignmentId: string) {
  const result = await client.query(
    `SELECT unit.workspace_id,unit.project_id,unit.epoch_id,unit.unit_id,unit.run_id,unit.case_id,
            unit.mapping_commitment,assignment.assignment_id,assignment.subpanel_id,assignment.cohort_id,
            unit.response_window_ms,
            assignment.reviewer_account_address,assignment.source,assignment.selection,assignment.status,
            assignment.paid_assignment,assignment.assurance_snapshot_hash,
            assignment.reservation_expires_at,assignment.created_at
     FROM tokenless_assurance_assignments assignment
     JOIN tokenless_dsa_named_panel_units unit
       ON unit.workspace_id=assignment.workspace_id AND unit.project_id=assignment.project_id
      AND unit.run_id=assignment.run_id
     WHERE assignment.assignment_id=$1 FOR UPDATE OF unit FOR SHARE OF assignment`,
    [assignmentId],
  );
  if (result.rowCount === 0) return null;
  if (result.rowCount !== 1) throw new Error("A named-panel reservation matched multiple frozen units.");
  const row = result.rows[0] as Row;
  if (
    value(row, "source") !== "customer_invited" ||
    value(row, "selection") !== "customer_named" ||
    value(row, "status") !== "reserved" ||
    row.paid_assignment !== false
  ) {
    throw new TokenlessServiceError(
      "DSA named-panel seats require exact unpaid customer-named invited reservations.",
      409,
      "dsa_named_panel_selection_invalid",
    );
  }
  const selectedAt = instant(row, "created_at");
  const acceptanceDeadline = instant(row, "reservation_expires_at");
  const responseWindowMs = Number(row.response_window_ms);
  if (
    !Number.isSafeInteger(responseWindowMs) ||
    responseWindowMs < 86_400_000 ||
    responseWindowMs > 604_800_000 ||
    responseWindowMs % 1_000 !== 0
  ) {
    throw new Error("Stored DSA named-panel response window is invalid.");
  }
  const panelDeadline = new Date(selectedAt.getTime() + responseWindowMs);
  if (acceptanceDeadline <= selectedAt || acceptanceDeadline > panelDeadline) {
    throw new TokenlessServiceError(
      "DSA named-panel reservation deadline is invalid.",
      409,
      "dsa_named_panel_selection_invalid",
    );
  }
  const snapshot = {
    schemaVersion: "rateloop.dsa-named-panel-selection.v1",
    workspaceId: value(row, "workspace_id"),
    projectId: value(row, "project_id"),
    epochId: value(row, "epoch_id"),
    unitId: value(row, "unit_id"),
    runId: value(row, "run_id"),
    caseId: value(row, "case_id"),
    mappingCommitment: value(row, "mapping_commitment"),
    assignmentId: value(row, "assignment_id"),
    subpanelId: value(row, "subpanel_id"),
    cohortId: value(row, "cohort_id"),
    reviewerPrincipalId: value(row, "reviewer_account_address"),
    reviewerSource: "customer_invited",
    selection: "customer_named",
    statusAtSelection: "reserved",
    assuranceSnapshotHash: value(row, "assurance_snapshot_hash"),
    acceptanceDeadline: acceptanceDeadline.toISOString(),
    responseWindowMs,
    panelDeadline: panelDeadline.toISOString(),
    selectedAt: selectedAt.toISOString(),
  } as const;
  const snapshotJson = canonicalizeRfc8785(snapshot);
  const snapshotHash = sha256Rfc8785(snapshot);
  await client.query(
    `INSERT INTO tokenless_dsa_named_panel_selections
     (workspace_id,project_id,epoch_id,unit_id,run_id,case_id,mapping_commitment,assignment_id,subpanel_id,cohort_id,
      reviewer_principal_id,reviewer_source,selection,status_at_selection,assurance_snapshot_hash,panel_deadline,
      acceptance_deadline,response_window_ms,selection_snapshot_json,selection_snapshot_hash,selected_at,
      response_binding_required)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'customer_invited','customer_named','reserved',$12,$13,$14,$15,$16,$17,$18,true)
     ON CONFLICT (workspace_id,epoch_id,unit_id,assignment_id) DO NOTHING`,
    [
      snapshot.workspaceId,
      snapshot.projectId,
      snapshot.epochId,
      snapshot.unitId,
      snapshot.runId,
      snapshot.caseId,
      snapshot.mappingCommitment,
      snapshot.assignmentId,
      snapshot.subpanelId,
      snapshot.cohortId,
      snapshot.reviewerPrincipalId,
      snapshot.assuranceSnapshotHash,
      panelDeadline,
      acceptanceDeadline,
      responseWindowMs,
      snapshotJson,
      snapshotHash,
      selectedAt,
    ],
  );
  const stored = await client.query(
    `SELECT selection_snapshot_hash FROM tokenless_dsa_named_panel_selections
     WHERE workspace_id=$1 AND epoch_id=$2 AND unit_id=$3 AND assignment_id=$4`,
    [snapshot.workspaceId, snapshot.epochId, snapshot.unitId, snapshot.assignmentId],
  );
  if (value(stored.rows[0] as Row | undefined, "selection_snapshot_hash") !== snapshotHash) {
    throw new TokenlessServiceError(
      "This DSA named-panel seat already has different immutable selection evidence.",
      409,
      "dsa_named_panel_selection_conflict",
    );
  }
  return { assignmentId, panelDeadline: panelDeadline.toISOString(), selectionSnapshotHash: snapshotHash };
}

import "server-only";
import { dbClient } from "~~/lib/db";
import { listDirectPrivateReviewAssignments } from "~~/lib/tokenless/privateReviewResponses";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;

function stringValue(row: Row, key: string) {
  const value = row[key];
  return value === null || value === undefined ? null : String(value);
}

function dateValue(row: Row, key: string) {
  const value = row[key];
  if (value === null || value === undefined) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function listReviewerAssignments(input: {
  accountAddress: string;
  query?: string;
  state?: string;
  view?: string;
  limit?: number;
}) {
  const principalId = input.accountAddress.trim();
  if (!principalId) throw new TokenlessServiceError("Account is invalid.", 400, "invalid_account");
  const query = input.query?.trim() ?? "";
  const state = input.state?.trim() ?? "";
  const view = input.view?.trim() || "all";
  const now = new Date();
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 50);
  if (query.length > 120) {
    throw new TokenlessServiceError("Search query must be at most 120 characters.", 400, "invalid_search");
  }
  if (state && !new Set(["reserved", "accepted", "expired", "completed", "released"]).has(state)) {
    throw new TokenlessServiceError("Assignment state is unsupported.", 400, "invalid_assignment_state");
  }
  if (!new Set(["active", "history", "all"]).has(view)) {
    throw new TokenlessServiceError("Assignment view is unsupported.", 400, "invalid_assignment_view");
  }
  const viewFilter =
    view === "active"
      ? {
          sql: `AND CASE
                 WHEN a.status = 'reserved' THEN a.reservation_expires_at > ?
                 WHEN a.status = 'accepted' THEN a.assignment_expires_at > ? AND a.lease_state = 'issued'
                 ELSE FALSE
               END`,
          args: [now, now],
        }
      : view === "history"
        ? {
            sql: `AND CASE
                   WHEN a.status IN ('completed','expired','released') THEN TRUE
                   WHEN a.status = 'reserved' THEN a.reservation_expires_at <= ?
                   WHEN a.status = 'accepted' THEN a.assignment_expires_at <= ? OR a.lease_state <> 'issued'
                   ELSE FALSE
                 END`,
            args: [now, now],
          }
        : { sql: "", args: [] };
  const result = await dbClient.execute({
    sql: `SELECT a.assignment_id,
                 CASE WHEN named_unit.unit_id IS NULL THEN a.project_id ELSE NULL END AS project_id,
                 CASE WHEN named_unit.unit_id IS NULL THEN p.name ELSE 'Blinded policy review' END AS project_name,
                 CASE WHEN named_unit.unit_id IS NULL THEN p.data_classification ELSE NULL END AS data_classification,
                 a.source, a.status, a.paid_assignment,
                 CASE WHEN named_unit.unit_id IS NULL THEN a.confidentiality_terms_hash ELSE NULL END
                   AS confidentiality_terms_hash,
                 CASE WHEN named_unit.unit_id IS NULL THEN a.private_group_id ELSE NULL END AS private_group_id,
                 CASE WHEN named_unit.unit_id IS NULL THEN a.private_group_policy_version ELSE NULL END
                   AS private_group_policy_version,
                 CASE WHEN named_unit.unit_id IS NULL THEN a.private_group_policy_hash ELSE NULL END
                   AS private_group_policy_hash,
                 a.reservation_expires_at, a.assignment_expires_at, a.created_at, a.updated_at,
                 CASE WHEN named_unit.unit_id IS NULL THEN COUNT(c.case_id) ELSE 1 END AS case_count,
                 CASE WHEN named_unit.unit_id IS NULL THEN MIN(c.title) ELSE 'Blinded policy review' END AS review_question,
                 (named_unit.unit_id IS NOT NULL) AS requires_dsa_reference_panel_acceptance
          FROM tokenless_assurance_assignments a
          JOIN tokenless_assurance_projects p ON p.project_id = a.project_id
          LEFT JOIN tokenless_rater_profiles owner_profile ON owner_profile.rater_id = a.rater_id
          LEFT JOIN tokenless_assurance_run_cases rc ON rc.run_id=a.run_id
          LEFT JOIN tokenless_assurance_cases c ON c.case_id=rc.case_id AND c.status='ready'
          LEFT JOIN tokenless_dsa_named_panel_units named_unit
            ON named_unit.workspace_id=a.workspace_id AND named_unit.project_id=a.project_id AND named_unit.run_id=a.run_id
          LEFT JOIN tokenless_private_group_memberships gm
            ON gm.group_id = a.private_group_id AND gm.principal_address = a.reviewer_account_address
           AND gm.status = 'active'
           AND (gm.membership_expires_at IS NULL OR gm.membership_expires_at > ?)
          LEFT JOIN tokenless_private_groups g ON g.group_id = gm.group_id AND g.status = 'active'
            WHERE ((a.rater_id IS NOT NULL AND owner_profile.principal_id = ?)
                   OR (a.rater_id IS NULL AND a.reviewer_account_address = ?))
              AND (a.private_group_id IS NULL OR a.status IN ('accepted', 'completed') OR g.group_id IS NOT NULL)
              AND (? = '' OR a.status = ?)
            ${viewFilter.sql}
            AND (? = '' OR a.assignment_id ILIKE ? OR (named_unit.unit_id IS NULL AND p.name ILIKE ?))
          GROUP BY a.assignment_id, a.project_id, p.name, p.data_classification, a.source, a.status,
                   a.paid_assignment, a.confidentiality_terms_hash, a.reservation_expires_at,
                   a.assignment_expires_at, a.created_at, a.updated_at, a.private_group_id,
                   a.private_group_policy_version, a.private_group_policy_hash, named_unit.unit_id
          ORDER BY a.created_at DESC, a.assignment_id DESC LIMIT ?`,
    args: [now, principalId, principalId, state, state, ...viewFilter.args, query, `%${query}%`, `%${query}%`, limit],
  });
  const standardAssignments = result.rows.map(row => {
    const value = row as Row;
    const requiresDsaReferencePanelAcceptance = value.requires_dsa_reference_panel_acceptance === true;
    return {
      assignmentId: stringValue(value, "assignment_id"),
      projectId: requiresDsaReferencePanelAcceptance ? null : stringValue(value, "project_id"),
      projectName: requiresDsaReferencePanelAcceptance ? "Blinded policy review" : stringValue(value, "project_name"),
      dataClassification: requiresDsaReferencePanelAcceptance ? null : stringValue(value, "data_classification"),
      source: stringValue(value, "source"),
      status: stringValue(value, "status"),
      paidAssignment: value.paid_assignment === true,
      confidentialityTermsHash: requiresDsaReferencePanelAcceptance
        ? null
        : stringValue(value, "confidentiality_terms_hash"),
      privateGroup:
        requiresDsaReferencePanelAcceptance || stringValue(value, "private_group_id") === null
          ? null
          : {
              groupId: stringValue(value, "private_group_id"),
              policyVersion: Number(value.private_group_policy_version),
              policyHash: stringValue(value, "private_group_policy_hash"),
            },
      reservationExpiresAt: dateValue(value, "reservation_expires_at"),
      assignmentExpiresAt: dateValue(value, "assignment_expires_at"),
      createdAt: dateValue(value, "created_at"),
      updatedAt: dateValue(value, "updated_at"),
      caseCount: Number(value.case_count ?? 0),
      reviewQuestion: requiresDsaReferencePanelAcceptance
        ? "Blinded policy review"
        : stringValue(value, "review_question"),
      requiresDsaReferencePanelAcceptance,
    };
  });
  const directAssignments = await listDirectPrivateReviewAssignments(input);
  return [...directAssignments, ...standardAssignments]
    .sort((left, right) => String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")))
    .slice(0, limit);
}

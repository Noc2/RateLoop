import "server-only";
import { dbClient } from "~~/lib/db";
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
  limit?: number;
}) {
  const principalId = input.accountAddress.trim();
  if (!principalId) throw new TokenlessServiceError("Account is invalid.", 400, "invalid_account");
  const query = input.query?.trim() ?? "";
  const state = input.state?.trim() ?? "";
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 50);
  if (query.length > 120) {
    throw new TokenlessServiceError("Search query must be at most 120 characters.", 400, "invalid_search");
  }
  if (state && !new Set(["reserved", "accepted", "expired", "completed", "released"]).has(state)) {
    throw new TokenlessServiceError("Assignment state is unsupported.", 400, "invalid_assignment_state");
  }
  const result = await dbClient.execute({
    sql: `SELECT a.assignment_id, a.project_id, p.name AS project_name, p.data_classification,
                 a.source, a.status, a.paid_assignment, a.confidentiality_terms_hash,
                 a.private_group_id, a.private_group_policy_version, a.private_group_policy_hash,
                 a.reservation_expires_at, a.assignment_expires_at, a.created_at,
                 COUNT(c.case_id) AS case_count
          FROM tokenless_assurance_assignments a
          JOIN tokenless_assurance_projects p ON p.project_id = a.project_id
          LEFT JOIN tokenless_rater_profiles owner_profile ON owner_profile.rater_id = a.rater_id
          LEFT JOIN tokenless_assurance_cases c ON c.project_id = a.project_id AND c.status = 'ready'
          LEFT JOIN tokenless_private_group_memberships gm
            ON gm.group_id = a.private_group_id AND gm.principal_address = a.reviewer_account_address
           AND gm.status = 'active'
           AND (gm.membership_expires_at IS NULL OR gm.membership_expires_at > ?)
          LEFT JOIN tokenless_private_groups g ON g.group_id = gm.group_id AND g.status = 'active'
          WHERE ((a.rater_id IS NOT NULL AND owner_profile.principal_id = ?)
                 OR (a.rater_id IS NULL AND a.reviewer_account_address = ?))
            AND (a.private_group_id IS NULL OR a.status IN ('accepted', 'completed') OR g.group_id IS NOT NULL)
            AND (? = '' OR a.status = ?)
            AND (? = '' OR a.assignment_id ILIKE ? OR p.name ILIKE ?)
          GROUP BY a.assignment_id, a.project_id, p.name, p.data_classification, a.source, a.status,
                   a.paid_assignment, a.confidentiality_terms_hash, a.reservation_expires_at,
                   a.assignment_expires_at, a.created_at, a.private_group_id,
                   a.private_group_policy_version, a.private_group_policy_hash
          ORDER BY a.created_at DESC, a.assignment_id DESC LIMIT ?`,
    args: [new Date(), principalId, principalId, state, state, query, `%${query}%`, `%${query}%`, limit],
  });
  return result.rows.map(row => {
    const value = row as Row;
    return {
      assignmentId: stringValue(value, "assignment_id"),
      projectId: stringValue(value, "project_id"),
      projectName: stringValue(value, "project_name"),
      dataClassification: stringValue(value, "data_classification"),
      source: stringValue(value, "source"),
      status: stringValue(value, "status"),
      paidAssignment: value.paid_assignment === true,
      confidentialityTermsHash: stringValue(value, "confidentiality_terms_hash"),
      privateGroup:
        stringValue(value, "private_group_id") === null
          ? null
          : {
              groupId: stringValue(value, "private_group_id"),
              policyVersion: Number(value.private_group_policy_version),
              policyHash: stringValue(value, "private_group_policy_hash"),
            },
      reservationExpiresAt: dateValue(value, "reservation_expires_at"),
      assignmentExpiresAt: dateValue(value, "assignment_expires_at"),
      createdAt: dateValue(value, "created_at"),
      caseCount: Number(value.case_count ?? 0),
    };
  });
}

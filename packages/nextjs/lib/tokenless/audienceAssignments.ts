import {
  type HumanAssuranceAudiencePolicy,
  type HumanAssuranceCapability,
  parseHumanAssuranceRubric,
} from "@rateloop/sdk";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbClient, dbPool } from "~~/lib/db";
import { evaluateFrozenAdmissionPolicy } from "~~/lib/tokenless/admissionPolicy";
import { issueArtifactLease } from "~~/lib/tokenless/artifactPrivacy";
import { selectDiversifiedIntegrityPanel } from "~~/lib/tokenless/integrityAssignment";
import { integrityReviewerLookup } from "~~/lib/tokenless/integrityEpochs";
import { requirePaidReviewEligibilityInTransaction } from "~~/lib/tokenless/paidReviewEligibilityPreflight";
import { exactReviewerExpertiseDefinitionKey } from "~~/lib/tokenless/reviewerExpertiseAssignments";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const AUDIENCE_SOURCES = ["customer_invited", "rateloop_network", "hybrid"] as const;
export type AudienceSource = (typeof AUDIENCE_SOURCES)[number];
export type CohortSource = Exclude<AudienceSource, "hybrid">;
export type AudienceSelection = "customer_named" | "randomized";
export const ASSURANCE_ASSIGNMENT_SETTLEMENT_UNAVAILABLE_CODE = "assurance_assignment_settlement_unavailable";

export type QualificationRule = HumanAssuranceAudiencePolicy["requiredQualifications"][number];
export type QualificationProvenance = {
  key: string;
  value: string | number | boolean | string[];
  source: string;
  assertedBy: string;
  verifiedAt: string;
  expiresAt?: string;
};

const COHORT_SOURCE_SET = new Set<CohortSource>(["customer_invited", "rateloop_network"]);
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const INVITE_TOKEN_PATTERN = /^rli_[a-f0-9]{16}_[A-Za-z0-9_-]{40,64}$/;
const DEFAULT_INVITE_TTL_MS = 7 * 86_400_000;
const MAX_INVITE_TTL_MS = 30 * 86_400_000;
const DEFAULT_RESERVATION_TTL_MS = 15 * 60_000;
const MAX_RESERVATION_TTL_MS = 60 * 60_000;
const ACCEPTED_ASSIGNMENT_TTL_MS = 24 * 60 * 60_000;
const ARTIFACT_LEASE_TTL_MS = 10 * 60_000;

type QueryRow = Record<string, unknown>;

export function assertAssuranceAssignmentSettlementAvailable(input: {
  policy: Pick<HumanAssuranceAudiencePolicy, "compensation" | "reviewerSource">;
  source?: CohortSource;
  paidAssignment?: boolean;
}) {
  const invitedUnpaid =
    input.policy.reviewerSource === "customer_invited" &&
    input.policy.compensation === "unpaid" &&
    (!input.source || input.source === "customer_invited") &&
    input.paidAssignment !== true;
  if (invitedUnpaid) return;
  throw new TokenlessServiceError(
    "Paid, hybrid, and network assurance assignments are unavailable until assignment policy snapshots are bound through settlement and receipts.",
    409,
    ASSURANCE_ASSIGNMENT_SETTLEMENT_UNAVAILABLE_CODE,
  );
}

function rowString(row: QueryRow | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function rowNumber(row: QueryRow | undefined, key: string) {
  const value = row?.[key];
  const result = Number(value);
  return Number.isSafeInteger(result) ? result : null;
}

function rowDate(row: QueryRow | undefined, key: string) {
  const value = row?.[key];
  if (value === null || value === undefined) return null;
  const result = new Date(String(value));
  return Number.isNaN(result.getTime()) ? null : result;
}

function normalizeAddress(value: string, field = "accountAddress") {
  try {
    return normalizeAccountSubject(value);
  } catch {
    throw new TokenlessServiceError(`${field} must be a valid account address.`, 400, "invalid_account");
  }
}

function requiredText(value: string, field: string, maxLength: number) {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new TokenlessServiceError(`${field} must be 1-${maxLength} characters.`, 400, "invalid_audience");
  }
  return normalized;
}

function integer(value: number, field: string, minimum: number, maximum: number) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TokenlessServiceError(
      `${field} must be an integer from ${minimum} to ${maximum}.`,
      400,
      "invalid_audience",
    );
  }
  return value;
}

function hashToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function parseJson<T>(value: unknown, field: string): T {
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    throw new Error(`Database returned invalid ${field}.`);
  }
}

function validateQualificationRules(rules: QualificationRule[]) {
  if (!Array.isArray(rules) || rules.length > 50) {
    throw new TokenlessServiceError("Qualification rules are invalid.", 400, "invalid_qualifications");
  }
  return rules.map(rule => {
    const key = requiredText(rule.key, "qualification key", 80);
    if (!["equals", "one_of", "at_least", "attested"].includes(rule.operator)) {
      throw new TokenlessServiceError("Qualification operator is unsupported.", 400, "invalid_qualifications");
    }
    return { ...rule, key };
  });
}

function validateProvenance(values: QualificationProvenance[], now = new Date()) {
  if (!Array.isArray(values) || values.length > 100) {
    throw new TokenlessServiceError("Qualification provenance is invalid.", 400, "invalid_qualifications");
  }
  const seen = new Set<string>();
  return values.map(value => {
    const key = requiredText(value.key, "qualification provenance key", 80);
    if (seen.has(key)) {
      throw new TokenlessServiceError("Qualification provenance keys must be unique.", 400, "invalid_qualifications");
    }
    seen.add(key);
    const verifiedAt = new Date(value.verifiedAt);
    const expiresAt = value.expiresAt ? new Date(value.expiresAt) : null;
    if (
      Number.isNaN(verifiedAt.getTime()) ||
      verifiedAt > now ||
      (expiresAt && (Number.isNaN(expiresAt.getTime()) || expiresAt <= verifiedAt))
    ) {
      throw new TokenlessServiceError(
        "Qualification provenance timestamps are invalid.",
        400,
        "invalid_qualifications",
      );
    }
    return {
      key,
      value: value.value,
      source: requiredText(value.source, "qualification provenance source", 120),
      assertedBy: requiredText(value.assertedBy, "qualification provenance issuer", 160),
      verifiedAt: verifiedAt.toISOString(),
      ...(expiresAt ? { expiresAt: expiresAt.toISOString() } : {}),
    };
  });
}

function provenanceExpiry(values: QualificationProvenance[]) {
  const expiries = values.flatMap(value => (value.expiresAt ? [new Date(value.expiresAt).getTime()] : []));
  return expiries.length ? new Date(Math.min(...expiries)) : null;
}

function valuesEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function satisfiesQualifications(rules: QualificationRule[], provenance: QualificationProvenance[], now: Date) {
  const byKey = new Map(
    provenance
      .filter(value => !value.expiresAt || new Date(value.expiresAt) > now)
      .map(value => [value.key, value] as const),
  );
  return rules.every(rule => {
    const assertion = byKey.get(rule.key);
    if (!assertion) return false;
    if (rule.operator === "attested") return assertion.value === true;
    if (rule.operator === "equals") return valuesEqual(assertion.value, rule.value);
    if (rule.operator === "at_least") {
      return typeof assertion.value === "number" && typeof rule.value === "number" && assertion.value >= rule.value;
    }
    const permitted = Array.isArray(rule.value) ? rule.value : [rule.value];
    if (Array.isArray(assertion.value)) return assertion.value.some(value => permitted.includes(String(value)));
    return permitted.some(value => valuesEqual(value, assertion.value));
  });
}

async function requireProjectManager(input: { accountAddress: string; workspaceId: string; projectId: string }) {
  const accountAddress = normalizeAddress(input.accountAddress);
  const result = await dbClient.execute({
    sql: `SELECT p.project_id FROM tokenless_assurance_projects p
          JOIN tokenless_workspaces w ON w.workspace_id = p.workspace_id
          JOIN tokenless_workspace_members m ON m.workspace_id = p.workspace_id
          WHERE p.project_id = ? AND p.workspace_id = ? AND p.status = 'active'
            AND w.status = 'active' AND m.account_address = ? AND m.role IN ('owner', 'admin') LIMIT 1`,
    args: [input.projectId, input.workspaceId, accountAddress],
  });
  if (!result.rowCount) throw new TokenlessServiceError("Project not found.", 404, "project_not_found");
  return accountAddress;
}

async function requireCohort(input: { projectId: string; cohortId: string; source?: CohortSource }) {
  const result = await dbClient.execute({
    sql: `SELECT * FROM tokenless_assurance_cohorts
          WHERE project_id = ? AND cohort_id = ? AND status = 'active' LIMIT 1`,
    args: [input.projectId, input.cohortId],
  });
  const row = result.rows[0] as QueryRow | undefined;
  if (!row || (input.source && rowString(row, "source") !== input.source)) {
    throw new TokenlessServiceError("Cohort not found.", 404, "cohort_not_found");
  }
  return row;
}

export async function createProjectCohort(input: {
  accountAddress: string;
  workspaceId: string;
  projectId: string;
  name: string;
  source: CohortSource;
  selection: AudienceSelection;
  capacity: number;
  qualificationRules?: QualificationRule[];
  privateGroupId?: string;
}) {
  const manager = await requireProjectManager(input);
  if (!COHORT_SOURCE_SET.has(input.source)) {
    throw new TokenlessServiceError("Hybrid audiences use separate source cohorts.", 400, "invalid_audience_source");
  }
  if (input.selection === "customer_named" && input.source !== "customer_invited") {
    throw new TokenlessServiceError(
      "customer_named selection is available only for customer-invited cohorts.",
      400,
      "invalid_audience_selection",
    );
  }
  if (input.selection !== "customer_named" && input.selection !== "randomized") {
    throw new TokenlessServiceError("Audience selection is unsupported.", 400, "invalid_audience_selection");
  }
  const privateGroupId = input.privateGroupId ? requiredText(input.privateGroupId, "privateGroupId", 160) : null;
  if (privateGroupId && input.source !== "customer_invited") {
    throw new TokenlessServiceError(
      "Private groups can back only customer-invited cohorts.",
      400,
      "invalid_private_group_audience",
    );
  }
  if (privateGroupId) {
    const group = await dbClient.execute({
      sql: `SELECT g.group_id, gp.allowed_project_ids_json, gp.data_classifications_json
            FROM tokenless_private_groups g
            JOIN tokenless_private_group_policy_versions gp
              ON gp.group_id = g.group_id AND gp.version = g.current_policy_version
            JOIN tokenless_assurance_projects p ON p.project_id = ? AND p.workspace_id = g.workspace_id
            WHERE g.group_id = ? AND g.workspace_id = ? AND g.status = 'active'
              AND p.status = 'active' LIMIT 1`,
      args: [input.projectId, privateGroupId, input.workspaceId],
    });
    const row = group.rows[0] as QueryRow | undefined;
    const allowedProjects = parseJson<string[]>(row?.allowed_project_ids_json ?? "[]", "allowed project ids");
    const classifications = parseJson<string[]>(
      row?.data_classifications_json ?? "[]",
      "private-group data classifications",
    );
    const project = await dbClient.execute({
      sql: "SELECT data_classification FROM tokenless_assurance_projects WHERE project_id = ? LIMIT 1",
      args: [input.projectId],
    });
    if (
      !row ||
      (allowedProjects.length > 0 && !allowedProjects.includes(input.projectId)) ||
      !classifications.includes(rowString(project.rows[0] as QueryRow | undefined, "data_classification") ?? "")
    ) {
      throw new TokenlessServiceError(
        "Private group does not allow this assurance project.",
        409,
        "private_group_project_not_allowed",
      );
    }
  }
  const cohortId = `hacoh_${randomUUID().replaceAll("-", "")}`;
  const now = new Date();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_cohorts
          (cohort_id, project_id, name, source, selection, capacity, active_reservations, private_group_id,
           qualification_rules_json, status, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 'active', ?, ?, ?)`,
    args: [
      cohortId,
      input.projectId,
      requiredText(input.name, "cohort name", 160),
      input.source,
      input.selection,
      integer(input.capacity, "capacity", 1, 10_000),
      privateGroupId,
      JSON.stringify(validateQualificationRules(input.qualificationRules ?? [])),
      manager,
      now,
      now,
    ],
  });
  return {
    cohortId,
    projectId: input.projectId,
    source: input.source,
    selection: input.selection,
    privateGroupId,
  };
}

export async function listProjectCohorts(input: { accountAddress: string; workspaceId: string; projectId: string }) {
  await requireProjectManager(input);
  const result = await dbClient.execute({
    sql: `SELECT cohort_id, name, source, selection, capacity, active_reservations, private_group_id,
                 qualification_rules_json, status
          FROM tokenless_assurance_cohorts WHERE project_id = ? ORDER BY created_at ASC`,
    args: [input.projectId],
  });
  return result.rows.map(value => {
    const row = value as QueryRow;
    return {
      cohortId: rowString(row, "cohort_id"),
      name: rowString(row, "name"),
      source: rowString(row, "source"),
      selection: rowString(row, "selection"),
      capacity: rowNumber(row, "capacity"),
      activeReservations: rowNumber(row, "active_reservations"),
      privateGroupId: rowString(row, "private_group_id"),
      qualificationRules: parseJson(row.qualification_rules_json, "qualification rules"),
      status: rowString(row, "status"),
    };
  });
}

export async function registerProjectCohortReviewer(input: {
  accountAddress: string;
  workspaceId: string;
  projectId: string;
  cohortId: string;
  reviewerAccountAddress: string;
  qualificationProvenance: QualificationProvenance[];
  maximumActiveAssignments?: number;
}) {
  const manager = await requireProjectManager(input);
  const cohort = await requireCohort(input);
  if (rowString(cohort, "source") === "customer_invited") {
    throw new TokenlessServiceError(
      "Customer-invited reviewers must redeem a one-time invitation.",
      409,
      "invitation_required",
    );
  }
  const reviewer = normalizeAddress(input.reviewerAccountAddress, "reviewerAccountAddress");
  const provenance = validateProvenance(input.qualificationProvenance);
  const now = new Date();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_cohort_reviewers
          (project_id, cohort_id, reviewer_account_address, qualification_provenance_json,
           qualification_expires_at, maximum_active_assignments, active_reservations,
           status, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 0, 'active', ?, ?, ?)
          ON CONFLICT (project_id, cohort_id, reviewer_account_address) DO UPDATE SET
            qualification_provenance_json = EXCLUDED.qualification_provenance_json,
            qualification_expires_at = EXCLUDED.qualification_expires_at,
            maximum_active_assignments = EXCLUDED.maximum_active_assignments,
            status = 'active', updated_at = EXCLUDED.updated_at`,
    args: [
      input.projectId,
      input.cohortId,
      reviewer,
      JSON.stringify(provenance),
      provenanceExpiry(provenance),
      integer(input.maximumActiveAssignments ?? 1, "maximumActiveAssignments", 1, 100),
      manager,
      now,
      now,
    ],
  });
  return { cohortId: input.cohortId, reviewerAccountAddress: reviewer };
}

export async function createReviewerInvitation(input: {
  accountAddress: string;
  workspaceId: string;
  projectId: string;
  cohortId: string;
  intendedAccountAddress?: string | null;
  qualificationProvenance?: QualificationProvenance[];
  maximumActiveAssignments?: number;
  expiresAt?: Date;
}) {
  const manager = await requireProjectManager(input);
  const cohort = await requireCohort({ ...input, source: "customer_invited" });
  if (rowString(cohort, "private_group_id")) {
    throw new TokenlessServiceError(
      "This cohort uses durable private-group invitations.",
      409,
      "private_group_invitation_required",
    );
  }
  const intended = input.intendedAccountAddress
    ? normalizeAddress(input.intendedAccountAddress, "intendedAccountAddress")
    : null;
  const now = new Date();
  const expiresAt = input.expiresAt ?? new Date(now.getTime() + DEFAULT_INVITE_TTL_MS);
  const ttl = expiresAt.getTime() - now.getTime();
  if (Number.isNaN(expiresAt.getTime()) || ttl < 60_000 || ttl > MAX_INVITE_TTL_MS) {
    throw new TokenlessServiceError("Invitation expiry must be between one minute and 30 days.", 400, "invalid_invite");
  }
  const provenance = validateProvenance([
    {
      key: "customer_invitation",
      value: true,
      source: "customer_attestation",
      assertedBy: manager,
      verifiedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    },
    ...(input.qualificationProvenance ?? []),
  ]);
  const suffix = randomBytes(8).toString("hex");
  const token = `rli_${suffix}_${randomBytes(32).toString("base64url")}`;
  const invitationId = `hri_${suffix}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_reviewer_invitations
          (invitation_id, workspace_id, project_id, cohort_id, token_hash, intended_account_address,
           qualification_provenance_json, maximum_active_assignments, expires_at, created_by, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      invitationId,
      input.workspaceId,
      input.projectId,
      input.cohortId,
      hashToken(token),
      intended,
      JSON.stringify(provenance),
      integer(input.maximumActiveAssignments ?? 1, "maximumActiveAssignments", 1, 100),
      expiresAt,
      manager,
      now,
    ],
  });
  return { invitationId, token, expiresAt: expiresAt.toISOString() };
}

export async function redeemReviewerInvitationWithBaseAccount(input: {
  token: string;
  baseAccountAddress: string;
  now?: Date;
}) {
  const reviewer = normalizeAddress(input.baseAccountAddress, "baseAccountAddress");
  if (!INVITE_TOKEN_PATTERN.test(input.token)) {
    throw new TokenlessServiceError("Invitation not found.", 404, "invite_not_found");
  }
  const now = input.now ?? new Date();
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT i.*, p.status AS project_status, c.status AS cohort_status
       FROM tokenless_assurance_reviewer_invitations i
       JOIN tokenless_assurance_projects p ON p.project_id = i.project_id AND p.workspace_id = i.workspace_id
       JOIN tokenless_assurance_cohorts c ON c.project_id = i.project_id AND c.cohort_id = i.cohort_id
       WHERE i.token_hash = $1 LIMIT 1 FOR UPDATE`,
      [hashToken(input.token)],
    );
    const row = result.rows[0] as QueryRow | undefined;
    const invitationId = rowString(row, "invitation_id");
    const projectId = rowString(row, "project_id");
    const cohortId = rowString(row, "cohort_id");
    const expiresAt = rowDate(row, "expires_at");
    if (!invitationId || !projectId || !cohortId || !expiresAt) {
      throw new TokenlessServiceError("Invitation not found.", 404, "invite_not_found");
    }
    if (
      rowString(row, "project_status") !== "active" ||
      rowString(row, "cohort_status") !== "active" ||
      rowDate(row, "redeemed_at") ||
      rowDate(row, "revoked_at") ||
      expiresAt <= now
    ) {
      throw new TokenlessServiceError("Invitation is no longer available.", 410, "invite_unavailable");
    }
    const intended = rowString(row, "intended_account_address");
    if (intended && intended !== reviewer) {
      throw new TokenlessServiceError(
        "Invitation is bound to another signed-in account.",
        403,
        "invite_account_mismatch",
      );
    }
    await client.query(
      `INSERT INTO tokenless_assurance_cohort_reviewers
       (project_id, cohort_id, reviewer_account_address, qualification_provenance_json,
        qualification_expires_at, maximum_active_assignments, active_reservations,
        status, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 0, 'active', $7, $8, $8)
       ON CONFLICT (project_id, cohort_id, reviewer_account_address) DO NOTHING`,
      [
        projectId,
        cohortId,
        reviewer,
        rowString(row, "qualification_provenance_json"),
        provenanceExpiry(
          parseJson<QualificationProvenance[]>(row?.qualification_provenance_json, "qualification provenance"),
        ),
        rowNumber(row, "maximum_active_assignments"),
        rowString(row, "created_by"),
        now,
      ],
    );
    const redeemed = await client.query(
      `UPDATE tokenless_assurance_reviewer_invitations
       SET redeemed_at = $1, redeemed_by_account_address = $2
       WHERE invitation_id = $3 AND redeemed_at IS NULL AND revoked_at IS NULL`,
      [now, reviewer, invitationId],
    );
    if (redeemed.rowCount !== 1) {
      throw new TokenlessServiceError("Invitation is no longer available.", 410, "invite_unavailable");
    }
    await client.query("COMMIT");
    return { invitationId, projectId, cohortId, reviewerAccountAddress: reviewer };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listReviewerMemberships(input: { accountAddress: string }) {
  const reviewer = normalizeAddress(input.accountAddress, "accountAddress");
  const memberships = await dbClient.execute({
    sql: `SELECT p.project_id, p.name AS project_name, c.cohort_id, c.name AS cohort_name,
                 c.source, cr.status, cr.qualification_expires_at,
                 COUNT(a.assignment_id) AS assignment_count,
                 SUM(CASE WHEN a.status IN ('reserved', 'accepted') THEN 1 ELSE 0 END) AS active_assignment_count
          FROM tokenless_assurance_cohort_reviewers cr
          JOIN tokenless_assurance_cohorts c ON c.project_id = cr.project_id AND c.cohort_id = cr.cohort_id
          JOIN tokenless_assurance_projects p ON p.project_id = cr.project_id
          LEFT JOIN tokenless_assurance_assignments a
            ON a.project_id = cr.project_id AND a.cohort_id = cr.cohort_id
            AND a.reviewer_account_address = cr.reviewer_account_address
          WHERE cr.reviewer_account_address = ?
          GROUP BY p.project_id, p.name, c.cohort_id, c.name, c.source, cr.status, cr.qualification_expires_at
          ORDER BY p.name ASC, c.name ASC`,
    args: [reviewer],
  });
  const invitations = await dbClient.execute({
    sql: `SELECT i.invitation_id, i.project_id, p.name AS project_name, i.cohort_id,
                 c.name AS cohort_name, i.redeemed_at, i.expires_at
          FROM tokenless_assurance_reviewer_invitations i
          JOIN tokenless_assurance_projects p ON p.project_id = i.project_id
          JOIN tokenless_assurance_cohorts c ON c.project_id = i.project_id AND c.cohort_id = i.cohort_id
          WHERE i.redeemed_by_account_address = ?
          ORDER BY i.redeemed_at DESC`,
    args: [reviewer],
  });
  return {
    memberships: memberships.rows.map(row => {
      const value = row as QueryRow;
      return {
        projectId: rowString(value, "project_id"),
        projectName: rowString(value, "project_name"),
        cohortId: rowString(value, "cohort_id"),
        cohortName: rowString(value, "cohort_name"),
        source: rowString(value, "source"),
        status: rowString(value, "status"),
        qualificationExpiresAt: rowDate(value, "qualification_expires_at")?.toISOString() ?? null,
        assignmentCount: rowNumber(value, "assignment_count") ?? 0,
        activeAssignmentCount: rowNumber(value, "active_assignment_count") ?? 0,
      };
    }),
    invitations: invitations.rows.map(row => {
      const value = row as QueryRow;
      return {
        invitationId: rowString(value, "invitation_id"),
        projectId: rowString(value, "project_id"),
        projectName: rowString(value, "project_name"),
        cohortId: rowString(value, "cohort_id"),
        cohortName: rowString(value, "cohort_name"),
        redeemedAt: rowDate(value, "redeemed_at")?.toISOString() ?? null,
        expiresAt: rowDate(value, "expires_at")?.toISOString() ?? null,
      };
    }),
  };
}

function validatePolicySourceRules(policy: HumanAssuranceAudiencePolicy, cohorts: QueryRow[]) {
  const sources = cohorts.map(row => rowString(row, "source") as CohortSource);
  if (policy.reviewerSource === "hybrid") {
    const unique = new Set(sources);
    if (
      policy.selection !== "randomized" ||
      unique.size !== 2 ||
      !unique.has("customer_invited") ||
      !unique.has("rateloop_network")
    ) {
      throw new TokenlessServiceError(
        "Hybrid audiences require separate randomized customer_invited and rateloop_network subpanels.",
        409,
        "invalid_hybrid_audience",
      );
    }
  } else if (sources.some(source => source !== policy.reviewerSource)) {
    throw new TokenlessServiceError("Policy and cohort sources do not match.", 409, "audience_source_mismatch");
  }
  if (policy.selection === "customer_named" && policy.reviewerSource !== "customer_invited") {
    throw new TokenlessServiceError(
      "customer_named selection is restricted to customer-invited panels.",
      409,
      "invalid_audience_selection",
    );
  }
}

export async function prepareRunAudience(input: {
  accountAddress: string;
  workspaceId: string;
  projectId: string;
  runId: string;
}) {
  await requireProjectManager(input);
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const runResult = await client.query(
      `SELECT r.*, p.policy_json, p.policy_hash AS current_policy_hash
       FROM tokenless_assurance_runs r
       JOIN tokenless_assurance_audience_policies p
         ON p.policy_id = r.audience_policy_id AND p.version = r.audience_policy_version
       WHERE r.run_id = $1 AND r.project_id = $2 AND r.status = 'frozen'
         AND r.manifest_hash IS NOT NULL AND r.frozen_at IS NOT NULL
       LIMIT 1 FOR UPDATE`,
      [input.runId, input.projectId],
    );
    const run = runResult.rows[0] as QueryRow | undefined;
    const policyHash = rowString(run, "policy_hash");
    if (!run || !policyHash || policyHash !== rowString(run, "current_policy_hash")) {
      throw new TokenlessServiceError("Frozen run not found.", 404, "run_not_found");
    }
    const policy = parseJson<HumanAssuranceAudiencePolicy>(run.policy_json, "audience policy");
    const cohortBindings = await client.query(
      `SELECT cohort_id, private_group_id FROM tokenless_assurance_cohorts
       WHERE project_id = $1 AND cohort_id = ANY($2::text[])`,
      [input.projectId, policy.cohorts.map(cohort => cohort.cohortId)],
    );
    const privateGroupByCohort = new Map(
      cohortBindings.rows.map(value => {
        const row = value as QueryRow;
        return [rowString(row, "cohort_id")!, rowString(row, "private_group_id")] as const;
      }),
    );
    const existing = await client.query(
      "SELECT * FROM tokenless_assurance_run_subpanels WHERE run_id = $1 ORDER BY source, cohort_id",
      [input.runId],
    );
    if (existing.rowCount) {
      const expectedCohorts = new Set(policy.cohorts.map(cohort => cohort.cohortId));
      if (
        existing.rowCount !== policy.cohorts.length ||
        existing.rows.some(value => {
          const row = value as QueryRow;
          return (
            rowString(row, "workspace_id") !== input.workspaceId ||
            rowString(row, "project_id") !== input.projectId ||
            rowString(row, "policy_id") !== rowString(run, "audience_policy_id") ||
            rowNumber(row, "policy_version") !== rowNumber(run, "audience_policy_version") ||
            rowString(row, "policy_hash") !== policyHash ||
            rowString(row, "run_manifest_hash") !== rowString(run, "manifest_hash") ||
            rowString(row, "selection") !== policy.selection ||
            rowString(row, "private_group_id") !==
              (privateGroupByCohort.get(rowString(row, "cohort_id") ?? "") ?? null) ||
            (rowString(row, "private_group_id") !== null &&
              (!rowNumber(row, "private_group_policy_version") || !rowString(row, "private_group_policy_hash"))) ||
            (rowString(row, "source") === "rateloop_network" &&
              (rowString(row, "integrity_epoch_id") !== policy.integrity?.epochId ||
                rowString(row, "integrity_manifest_hash") !== policy.integrity?.epochManifestHash ||
                rowString(row, "integrity_constraints_json") !== canonicalJson(policy.integrity))) ||
            (rowString(row, "source") !== "rateloop_network" && rowString(row, "integrity_epoch_id") !== null) ||
            !expectedCohorts.delete(rowString(row, "cohort_id") ?? "")
          );
        }) ||
        expectedCohorts.size > 0
      ) {
        throw new TokenlessServiceError(
          "Prepared audience no longer matches the frozen run.",
          409,
          "audience_binding_mismatch",
        );
      }
      await client.query("COMMIT");
      return existing.rows.map(value => ({
        subpanelId: rowString(value as QueryRow, "subpanel_id"),
        cohortId: rowString(value as QueryRow, "cohort_id"),
        source: rowString(value as QueryRow, "source"),
        targetCount: rowNumber(value as QueryRow, "target_count"),
        ...(rowString(value as QueryRow, "private_group_id")
          ? {
              privateGroup: {
                groupId: rowString(value as QueryRow, "private_group_id"),
                policyVersion: rowNumber(value as QueryRow, "private_group_policy_version"),
                policyHash: rowString(value as QueryRow, "private_group_policy_hash"),
              },
            }
          : {}),
        ...(rowString(value as QueryRow, "source") === "rateloop_network"
          ? {
              integrity: {
                epochId: rowString(value as QueryRow, "integrity_epoch_id"),
                manifestHash: rowString(value as QueryRow, "integrity_manifest_hash"),
              },
            }
          : {}),
      }));
    }
    const cohorts: QueryRow[] = [];
    for (const requested of policy.cohorts) {
      const cohortResult = await client.query(
        `SELECT c.*, g.workspace_id AS private_group_workspace_id, g.status AS private_group_status,
                g.current_policy_version AS private_group_current_policy_version,
                gp.policy_hash AS private_group_policy_hash, gp.policy_json AS private_group_policy_json,
                pr.data_classification AS project_data_classification
         FROM tokenless_assurance_cohorts c
         JOIN tokenless_assurance_projects pr ON pr.project_id = c.project_id
         LEFT JOIN tokenless_private_groups g ON g.group_id = c.private_group_id
         LEFT JOIN tokenless_private_group_policy_versions gp
           ON gp.group_id = g.group_id AND gp.version = g.current_policy_version
         WHERE c.project_id = $1 AND c.cohort_id = $2 AND c.status = 'active' LIMIT 1 FOR UPDATE`,
        [input.projectId, requested.cohortId],
      );
      const cohort = cohortResult.rows[0] as QueryRow | undefined;
      if (!cohort || requested.maximumReviewers > (rowNumber(cohort, "capacity") ?? 0)) {
        throw new TokenlessServiceError(
          "Policy cohort is unavailable or undersized.",
          409,
          "cohort_capacity_unavailable",
        );
      }
      if (rowString(cohort, "selection") !== policy.selection) {
        throw new TokenlessServiceError(
          "Policy and cohort selection do not match.",
          409,
          "audience_selection_mismatch",
        );
      }
      const privateGroupId = rowString(cohort, "private_group_id");
      if (privateGroupId) {
        const privateGroupPolicy = parseJson<{
          allowedProjectIds: string[];
          dataClassifications: string[];
          defaultCompensation: "paid" | "unpaid";
        }>(cohort.private_group_policy_json, "private-group policy");
        const source = rowString(cohort, "source") as CohortSource;
        const paid = assignmentIsPaid(policy.compensation, source);
        if (
          source !== "customer_invited" ||
          rowString(cohort, "private_group_workspace_id") !== input.workspaceId ||
          rowString(cohort, "private_group_status") !== "active" ||
          (privateGroupPolicy.allowedProjectIds.length > 0 &&
            !privateGroupPolicy.allowedProjectIds.includes(input.projectId)) ||
          !privateGroupPolicy.dataClassifications.includes(rowString(cohort, "project_data_classification") ?? "") ||
          privateGroupPolicy.defaultCompensation !== (paid ? "paid" : "unpaid")
        ) {
          throw new TokenlessServiceError(
            "Private-group policy does not permit this frozen audience.",
            409,
            "private_group_policy_mismatch",
          );
        }
      }
      cohorts.push(cohort);
    }
    validatePolicySourceRules(policy, cohorts);
    const now = new Date();
    if (policy.integrity) {
      const epoch = await client.query(
        `SELECT epoch_id FROM tokenless_integrity_epochs
         WHERE epoch_id = $1 AND manifest_hash = $2 AND cutoff_at <= $3
           AND private_features_expire_at > $4 LIMIT 1`,
        [policy.integrity.epochId, policy.integrity.epochManifestHash, rowDate(run, "frozen_at"), now],
      );
      if (epoch.rowCount !== 1) {
        throw new TokenlessServiceError(
          "The frozen integrity epoch is missing, expired, or newer than the run.",
          409,
          "integrity_epoch_unavailable",
        );
      }
    }
    const subpanels = [];
    for (let index = 0; index < cohorts.length; index += 1) {
      const cohort = cohorts[index]!;
      const requested = policy.cohorts[index]!;
      const subpanelId = `hasp_${randomUUID().replaceAll("-", "")}`;
      await client.query(
        `INSERT INTO tokenless_assurance_run_subpanels
         (subpanel_id, workspace_id, project_id, run_id, cohort_id, source, selection,
          target_count, active_reservations, policy_id, policy_version, policy_hash,
          run_manifest_hash, private_group_id, private_group_policy_version, private_group_policy_hash,
          integrity_epoch_id, integrity_manifest_hash,
          integrity_constraints_json, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
        [
          subpanelId,
          input.workspaceId,
          input.projectId,
          input.runId,
          requested.cohortId,
          rowString(cohort, "source"),
          policy.selection,
          requested.maximumReviewers,
          rowString(run, "audience_policy_id"),
          rowNumber(run, "audience_policy_version"),
          policyHash,
          rowString(run, "manifest_hash"),
          rowString(cohort, "private_group_id"),
          rowString(cohort, "private_group_id") ? rowNumber(cohort, "private_group_current_policy_version") : null,
          rowString(cohort, "private_group_policy_hash"),
          rowString(cohort, "source") === "rateloop_network" ? policy.integrity?.epochId : null,
          rowString(cohort, "source") === "rateloop_network" ? policy.integrity?.epochManifestHash : null,
          rowString(cohort, "source") === "rateloop_network" ? canonicalJson(policy.integrity) : null,
          now,
        ],
      );
      subpanels.push({
        subpanelId,
        cohortId: requested.cohortId,
        source: rowString(cohort, "source"),
        targetCount: requested.maximumReviewers,
        ...(rowString(cohort, "private_group_id")
          ? {
              privateGroup: {
                groupId: rowString(cohort, "private_group_id"),
                policyVersion: rowNumber(cohort, "private_group_current_policy_version"),
                policyHash: rowString(cohort, "private_group_policy_hash"),
              },
            }
          : {}),
        ...(rowString(cohort, "source") === "rateloop_network"
          ? {
              integrity: {
                epochId: policy.integrity?.epochId,
                manifestHash: policy.integrity?.epochManifestHash,
              },
            }
          : {}),
      });
    }
    await client.query("COMMIT");
    return subpanels;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function paidEligibility(client: PoolClient, accountAddress: string, now: Date) {
  const preflight = await requirePaidReviewEligibilityInTransaction(client, accountAddress, now);
  const raterId = preflight.raterId;
  const assertions = await client.query(
    `SELECT a.assertion_id, a.binding_id, a.provider_id, a.provider_namespace,
            b.subject_reference_hash, a.capabilities_json, a.evidence_verified_at, a.evidence_expires_at,
            a.assurance_validity_model
     FROM tokenless_assurance_assertions a
     JOIN tokenless_provider_subject_bindings b ON b.binding_id = a.binding_id
     WHERE a.rater_id = $1 AND a.status = 'active' AND b.status = 'active'
       AND (a.assurance_validity_model = 'durable_enrollment' OR a.evidence_expires_at > $2)`,
    [raterId, now],
  );
  return {
    raterId,
    preflight,
    assertions: assertions.rows.map(value => {
      const assertion = value as QueryRow;
      return {
        assertionId: rowString(assertion, "assertion_id")!,
        bindingId: rowString(assertion, "binding_id")!,
        providerId: rowString(assertion, "provider_id")!,
        providerNamespace: rowString(assertion, "provider_namespace")!,
        subjectReferenceHash: rowString(assertion, "subject_reference_hash")!,
        capabilities: parseJson<HumanAssuranceCapability[]>(
          assertion.capabilities_json,
          "assurance capabilities",
        ).sort(),
        verifiedAt: rowDate(assertion, "evidence_verified_at")!.toISOString(),
        expiresAt: rowDate(assertion, "evidence_expires_at")!.toISOString(),
        validityModel: rowString(assertion, "assurance_validity_model") as "expiring" | "durable_enrollment",
      };
    }),
  };
}

async function expireLockedAssignment(client: PoolClient, row: QueryRow, now: Date) {
  const assignmentId = rowString(row, "assignment_id")!;
  const updated = await client.query(
    `UPDATE tokenless_assurance_assignments SET status = 'expired', lease_state = 'expired', updated_at = $1
     WHERE assignment_id = $2 AND status = 'reserved'`,
    [now, assignmentId],
  );
  if (!updated.rowCount) return false;
  await client.query(
    "UPDATE tokenless_assurance_run_subpanels SET active_reservations = active_reservations - 1 WHERE subpanel_id = $1 AND active_reservations > 0",
    [rowString(row, "subpanel_id")],
  );
  await client.query(
    "UPDATE tokenless_assurance_cohorts SET active_reservations = active_reservations - 1 WHERE project_id = $1 AND cohort_id = $2 AND active_reservations > 0",
    [rowString(row, "project_id"), rowString(row, "cohort_id")],
  );
  await client.query(
    `UPDATE tokenless_assurance_cohort_reviewers SET active_reservations = active_reservations - 1
     WHERE project_id = $1 AND cohort_id = $2 AND reviewer_account_address = $3 AND active_reservations > 0`,
    [rowString(row, "project_id"), rowString(row, "cohort_id"), rowString(row, "reviewer_account_address")],
  );
  return true;
}

export async function expireAudienceAssignments(now = new Date()) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT * FROM tokenless_assurance_assignments
       WHERE status = 'reserved' AND reservation_expires_at <= $1 ORDER BY created_at ASC FOR UPDATE`,
      [now],
    );
    let expired = 0;
    for (const value of result.rows) {
      if (await expireLockedAssignment(client, value as QueryRow, now)) expired += 1;
    }
    await client.query("COMMIT");
    return { expired };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function assignmentIsPaid(compensation: HumanAssuranceAudiencePolicy["compensation"], source: CohortSource) {
  return compensation === "paid" || (compensation === "mixed" && source === "rateloop_network");
}

type PrivateGroupCandidate = {
  joinedAt: Date;
  membershipExpiresAt: Date | null;
  provenance: QualificationProvenance[];
};

async function activePrivateGroupCandidates(
  client: PoolClient,
  input: { projectId: string; subpanel: QueryRow; now: Date },
) {
  const groupId = rowString(input.subpanel, "private_group_id");
  if (!groupId) return null;
  const policyVersion = rowNumber(input.subpanel, "private_group_policy_version");
  const policyHash = rowString(input.subpanel, "private_group_policy_hash");
  const groupResult = await client.query(
    `SELECT g.status,g.workspace_id, gp.policy_hash, gp.policy_json
     FROM tokenless_private_groups g
     JOIN tokenless_private_group_policy_versions gp ON gp.group_id = g.group_id AND gp.version = $2
     WHERE g.group_id = $1 LIMIT 1 FOR SHARE`,
    [groupId, policyVersion],
  );
  const group = groupResult.rows[0] as QueryRow | undefined;
  if (!group || rowString(group, "status") !== "active" || rowString(group, "policy_hash") !== policyHash) {
    throw new TokenlessServiceError("Private group is unavailable.", 409, "private_group_unavailable");
  }
  const policy = parseJson<{ worldIdRequired: boolean }>(group.policy_json, "private-group policy");
  const memberships = await client.query(
    `SELECT principal_address, allowed_project_ids_json, membership_expires_at, joined_at, created_by
     FROM tokenless_private_group_memberships
     WHERE group_id = $1 AND status = 'active'
       AND (membership_expires_at IS NULL OR membership_expires_at > $2)
     FOR SHARE`,
    [groupId, input.now],
  );
  const candidates = new Map<string, PrivateGroupCandidate>();
  for (const value of memberships.rows) {
    const membership = value as QueryRow;
    const address = rowString(membership, "principal_address")!;
    const allowedProjects = parseJson<string[]>(membership.allowed_project_ids_json, "membership project ids");
    if (allowedProjects.length > 0 && !allowedProjects.includes(input.projectId)) continue;
    if (policy.worldIdRequired) {
      const worldId = await client.query(
        `SELECT a.assertion_id FROM tokenless_rater_profiles p
         JOIN tokenless_provider_subject_bindings b ON b.rater_id = p.rater_id
         JOIN tokenless_assurance_assertions a ON a.binding_id = b.binding_id
         WHERE p.account_address = $1 AND b.provider_id = 'world:poh' AND b.status = 'active'
           AND a.status = 'active' AND a.assurance_validity_model = 'durable_enrollment'
           AND a.capabilities_json LIKE '%"unique_human"%' LIMIT 1`,
        [address],
      );
      if (worldId.rowCount !== 1) continue;
    }
    const joinedAt = rowDate(membership, "joined_at")!;
    const membershipExpiresAt = rowDate(membership, "membership_expires_at");
    const provenance: QualificationProvenance[] = [
      {
        key: "customer_invitation",
        value: true,
        source: "private_group_membership",
        assertedBy: rowString(membership, "created_by")!,
        verifiedAt: joinedAt.toISOString(),
        ...(membershipExpiresAt ? { expiresAt: membershipExpiresAt.toISOString() } : {}),
      },
      {
        key: "private_group_membership",
        value: groupId,
        source: "private_group_membership",
        assertedBy: rowString(membership, "created_by")!,
        verifiedAt: joinedAt.toISOString(),
        ...(membershipExpiresAt ? { expiresAt: membershipExpiresAt.toISOString() } : {}),
      },
    ];
    const qualifications = await client.query(
      `SELECT qualification_keys_json,evidence_kind,evidence_reference_hash,verified_at,expires_at,
              expertise_record_schema_version,expertise_definition_id,expertise_definition_version,
              expertise_definition_hash,asserted_by
       FROM tokenless_reviewer_qualifications
       WHERE workspace_id=$1 AND reviewer_account_address=$2 AND reviewer_source='customer_invited'
         AND qualification_kind='expertise' AND status='active' AND expires_at>$3
       ORDER BY expertise_record_schema_version,expertise_definition_id`,
      [rowString(group, "workspace_id"), address, input.now],
    );
    for (const value of qualifications.rows) {
      const qualification = value as QueryRow;
      const verifiedAt = rowDate(qualification, "verified_at");
      const expiresAt = rowDate(qualification, "expires_at");
      const assertedBy = rowString(qualification, "asserted_by") ?? "workspace_owner";
      const schemaVersion = rowNumber(qualification, "expertise_record_schema_version");
      if (!verifiedAt || !expiresAt || (schemaVersion !== 1 && schemaVersion !== 2)) {
        throw new Error("Stored reviewer expertise qualification is invalid.");
      }
      let keys: string[];
      if (schemaVersion === 2) {
        const definitionId = rowString(qualification, "expertise_definition_id");
        const definitionVersion = rowNumber(qualification, "expertise_definition_version");
        const definitionHash = rowString(qualification, "expertise_definition_hash");
        if (
          !definitionId ||
          definitionVersion === null ||
          definitionVersion < 1 ||
          !definitionHash ||
          !HASH_PATTERN.test(definitionHash)
        ) {
          throw new Error("Stored exact reviewer expertise qualification is invalid.");
        }
        keys = [
          exactReviewerExpertiseDefinitionKey({
            definitionId,
            definitionVersion,
            definitionHash: definitionHash as `sha256:${string}`,
          }),
        ];
      } else {
        keys = parseJson<string[]>(qualification.qualification_keys_json, "qualification keys");
      }
      for (const key of keys) {
        provenance.push({
          key,
          value: true,
          source: rowString(qualification, "evidence_kind") ?? "owner_attested",
          assertedBy,
          verifiedAt: verifiedAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
        });
      }
    }
    await client.query(
      `INSERT INTO tokenless_assurance_cohort_reviewers
       (project_id, cohort_id, reviewer_account_address, qualification_provenance_json,
        qualification_expires_at, maximum_active_assignments, active_reservations,
        status, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,1,0,'active',$6,$7,$8)
       ON CONFLICT (project_id, cohort_id, reviewer_account_address) DO UPDATE SET
         qualification_provenance_json = EXCLUDED.qualification_provenance_json,
         qualification_expires_at = EXCLUDED.qualification_expires_at,
         status = 'active', updated_at = EXCLUDED.updated_at`,
      [
        input.projectId,
        rowString(input.subpanel, "cohort_id"),
        address,
        JSON.stringify(provenance),
        membershipExpiresAt,
        rowString(membership, "created_by"),
        joinedAt,
        input.now,
      ],
    );
    candidates.set(address, { joinedAt, membershipExpiresAt, provenance });
  }
  return candidates;
}

async function requireCurrentPrivateGroupAssignmentMembership(
  client: PoolClient,
  assignment: QueryRow,
  reviewer: string,
  now: Date,
) {
  const groupId = rowString(assignment, "private_group_id");
  if (!groupId || (rowString(assignment, "status") === "accepted" && rowDate(assignment, "accepted_at"))) return;
  const membership = await client.query(
    `SELECT m.joined_at FROM tokenless_private_group_memberships m
     JOIN tokenless_private_groups g ON g.group_id = m.group_id AND g.status = 'active'
     WHERE m.group_id = $1 AND m.principal_address = $2 AND m.status = 'active'
       AND (m.membership_expires_at IS NULL OR m.membership_expires_at > $3)
     LIMIT 1 FOR SHARE`,
    [groupId, reviewer, now],
  );
  if (
    membership.rowCount !== 1 ||
    rowDate(membership.rows[0] as QueryRow | undefined, "joined_at")?.getTime() !==
      rowDate(assignment, "private_group_membership_joined_at")?.getTime()
  ) {
    throw new TokenlessServiceError(
      "Private-group membership is no longer active.",
      403,
      "private_group_membership_required",
    );
  }
}

export function assertMatchingPrivateGroupSnapshot(row: QueryRow) {
  const assignmentGroupId = rowString(row, "private_group_id");
  const subpanelGroupId = rowString(row, "subpanel_private_group_id");
  if (
    assignmentGroupId !== subpanelGroupId ||
    (assignmentGroupId !== null &&
      (rowNumber(row, "private_group_policy_version") !== rowNumber(row, "subpanel_private_group_policy_version") ||
        rowString(row, "private_group_policy_hash") !== rowString(row, "subpanel_private_group_policy_hash")))
  ) {
    throw new TokenlessServiceError(
      "Assignment private-group binding is invalid.",
      409,
      "private_group_binding_mismatch",
    );
  }
}

function integrityLookupRuntime() {
  const encoded = process.env.TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEY?.trim();
  const version = process.env.TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEY_VERSION?.trim();
  const key = encoded ? Buffer.from(encoded, "base64url") : Buffer.alloc(0);
  if (!version || key.byteLength < 32) {
    throw new TokenlessServiceError(
      "Integrity reviewer lookup is not configured.",
      503,
      "integrity_lookup_unavailable",
    );
  }
  return { key, version };
}

async function beginIntegrityAssignmentTransaction(client: PoolClient, workspaceId: string) {
  await client.query("BEGIN");
  const workspace = await client.query(
    `SELECT workspace_id FROM tokenless_workspaces
     WHERE workspace_id = $1 AND status = 'active' LIMIT 1 FOR UPDATE`,
    [workspaceId],
  );
  if (workspace.rowCount !== 1) {
    throw new TokenlessServiceError("Workspace is unavailable.", 409, "workspace_unavailable");
  }
}

export const __integrityAssignmentConcurrencyTestUtils = { beginIntegrityAssignmentTransaction };

/**
 * Complete, hidden, epoch-diversified network-panel reservation. The current
 * product deliberately calls the settlement guard before any mutation: this
 * routine becomes reachable only after vouchers and receipts bind this exact
 * batch/provenance commitment end to end.
 */
export async function reserveDiversifiedNetworkSubpanel(input: {
  accountAddress: string;
  workspaceId: string;
  projectId: string;
  runId: string;
  subpanelId: string;
  confidentialityTermsHash: string;
  reservationTtlMs?: number;
  now?: Date;
}) {
  const manager = await requireProjectManager(input);
  if (!HASH_PATTERN.test(input.confidentialityTermsHash)) {
    throw new TokenlessServiceError("Confidentiality terms hash is invalid.", 400, "invalid_confidentiality_terms");
  }
  const now = input.now ?? new Date();
  const ttl = integer(
    input.reservationTtlMs ?? DEFAULT_RESERVATION_TTL_MS,
    "reservationTtlMs",
    60_000,
    MAX_RESERVATION_TTL_MS,
  );
  // This is intentionally before BEGIN: paid work must not be reserved until
  // its voucher and receipt carry selectionBatchId + integrityProvenanceHash.
  assertAssuranceAssignmentSettlementAvailable({
    paidAssignment: true,
    policy: { compensation: "paid", reviewerSource: "rateloop_network" },
    source: "rateloop_network",
  });
  const lookup = integrityLookupRuntime();
  const client = await dbPool.connect();
  try {
    await beginIntegrityAssignmentTransaction(client, input.workspaceId);
    const locked = await client.query(
      `SELECT sp.*, c.qualification_rules_json, r.status AS run_status, r.manifest_hash AS current_run_manifest_hash,
              r.policy_hash AS current_policy_hash, p.policy_json, e.lookup_key_version,
              e.private_features_expire_at
       FROM tokenless_assurance_run_subpanels sp
       JOIN tokenless_assurance_runs r ON r.run_id = sp.run_id AND r.project_id = sp.project_id
       JOIN tokenless_assurance_audience_policies p
         ON p.policy_id = sp.policy_id AND p.version = sp.policy_version
       JOIN tokenless_assurance_cohorts c ON c.project_id = sp.project_id AND c.cohort_id = sp.cohort_id
       JOIN tokenless_integrity_epochs e ON e.epoch_id = sp.integrity_epoch_id
       WHERE sp.subpanel_id = $1 AND sp.run_id = $2 AND sp.project_id = $3 AND sp.workspace_id = $4
       LIMIT 1 FOR UPDATE`,
      [input.subpanelId, input.runId, input.projectId, input.workspaceId],
    );
    const subpanel = locked.rows[0] as QueryRow | undefined;
    const policy = subpanel ? parseJson<HumanAssuranceAudiencePolicy>(subpanel.policy_json, "audience policy") : null;
    if (
      !subpanel ||
      !policy?.integrity ||
      rowString(subpanel, "source") !== "rateloop_network" ||
      rowString(subpanel, "selection") !== "randomized" ||
      rowString(subpanel, "selection_status") !== "pending" ||
      rowString(subpanel, "run_status") !== "frozen" ||
      rowString(subpanel, "run_manifest_hash") !== rowString(subpanel, "current_run_manifest_hash") ||
      rowString(subpanel, "policy_hash") !== rowString(subpanel, "current_policy_hash") ||
      rowString(subpanel, "integrity_epoch_id") !== policy.integrity.epochId ||
      rowString(subpanel, "integrity_manifest_hash") !== policy.integrity.epochManifestHash ||
      rowString(subpanel, "integrity_constraints_json") !== canonicalJson(policy.integrity) ||
      rowString(subpanel, "lookup_key_version") !== lookup.version ||
      (rowDate(subpanel, "private_features_expire_at")?.getTime() ?? 0) <= now.getTime()
    ) {
      throw new TokenlessServiceError("Frozen network subpanel is unavailable.", 409, "integrity_subpanel_unavailable");
    }
    const targetCount = rowNumber(subpanel, "target_count")!;
    const reviewers = await client.query(
      `SELECT * FROM tokenless_assurance_cohort_reviewers
       WHERE project_id = $1 AND cohort_id = $2 AND status = 'active'
         AND active_reservations < maximum_active_assignments
         AND (qualification_expires_at IS NULL OR qualification_expires_at > $3)
       FOR UPDATE`,
      [input.projectId, rowString(subpanel, "cohort_id"), now],
    );
    const since = new Date(now.getTime() - policy.integrity.recentCoassignmentWindowSeconds * 1_000);
    const history = await client.query(
      `SELECT reviewer_lookup, run_id FROM tokenless_integrity_assignment_history
       WHERE workspace_id = $1 AND selected_at >= $2 ORDER BY run_id, reviewer_lookup`,
      [input.workspaceId, since],
    );
    const priorRuns = new Map<string, string[]>();
    const customerCounts = new Map<string, number>();
    for (const value of history.rows) {
      const row = value as QueryRow;
      const reviewerLookup = rowString(row, "reviewer_lookup")!;
      const runId = rowString(row, "run_id")!;
      priorRuns.set(runId, [...(priorRuns.get(runId) ?? []), reviewerLookup]);
      customerCounts.set(reviewerLookup, (customerCounts.get(reviewerLookup) ?? 0) + 1);
    }
    const recentPairs = new Map<string, Map<string, number>>();
    for (const members of priorRuns.values()) {
      for (const left of members) {
        const counts = recentPairs.get(left) ?? new Map<string, number>();
        for (const right of members) if (right !== left) counts.set(right, (counts.get(right) ?? 0) + 1);
        recentPairs.set(left, counts);
      }
    }
    const cohortRules = validateQualificationRules(
      parseJson<QualificationRule[]>(subpanel.qualification_rules_json ?? "[]", "cohort rules"),
    );
    const rules = [...cohortRules, ...validateQualificationRules(policy.requiredQualifications)];
    const candidates: Array<{
      reviewerAccountAddress: string;
      reviewerLookup: string;
      clusterPseudonym: string;
      riskBand: "low" | "medium" | "high";
      providerSubjectHashes: string[];
      activeCustomerAssignments: number;
      recentCoassignmentsByReviewerLookup: Record<string, number>;
      assuranceSnapshot: Record<string, unknown>;
      provenance: QualificationProvenance[];
    }> = [];
    for (const value of reviewers.rows) {
      const reviewer = value as QueryRow;
      const address = rowString(reviewer, "reviewer_account_address")!;
      const reviewerLookup = integrityReviewerLookup({ key: lookup.key, reviewerId: address });
      const memberResult = await client.query(
        `SELECT cluster_pseudonym, risk_band FROM tokenless_integrity_epoch_members
         WHERE epoch_id = $1 AND reviewer_lookup = $2 AND eligibility_status = 'eligible' LIMIT 1`,
        [policy.integrity.epochId, reviewerLookup],
      );
      const member = memberResult.rows[0] as QueryRow | undefined;
      if (!member) continue;
      const provenance = parseJson<QualificationProvenance[]>(
        reviewer.qualification_provenance_json,
        "qualification provenance",
      );
      if (!satisfiesQualifications(rules, provenance, now)) continue;
      let eligibility: Awaited<ReturnType<typeof paidEligibility>>;
      try {
        eligibility = await paidEligibility(client, address, now);
      } catch {
        continue;
      }
      const riskBand = rowString(member, "risk_band") as "low" | "medium" | "high";
      const allProviderSubjects = [...new Set(eligibility.assertions.map(assertion => assertion.subjectReferenceHash))];
      const admission = evaluateFrozenAdmissionPolicy({
        policy,
        evidence: {
          assertions: eligibility.assertions.map(assertion => ({
            ...assertion,
            verifiedAt: new Date(assertion.verifiedAt),
            expiresAt: new Date(assertion.expiresAt),
          })),
          reviewerSource: "rateloop_network",
          cohortIds: [rowString(subpanel, "cohort_id")!],
          qualifications: provenance.map(item => ({ key: item.key, value: item.value })),
          integrity: {
            epochId: policy.integrity.epochId,
            epochManifestHash: policy.integrity.epochManifestHash,
            reviewerLookup,
            clusterPseudonym: rowString(member, "cluster_pseudonym")!,
            riskBand,
            providerSubjectHashes: allProviderSubjects,
            recentCoassignments: 0,
            activeCustomerAssignments: customerCounts.get(reviewerLookup) ?? 0,
          },
        },
        maximumCommits: targetCount,
        now,
      });
      if (!admission.eligible) continue;
      const usedAssertions = eligibility.assertions.filter(assertion =>
        admission.usedAssertionIds.includes(assertion.assertionId),
      );
      const providerSubjectHashes = [
        ...new Set(usedAssertions.map(assertion => assertion.subjectReferenceHash)),
      ].sort();
      if (!providerSubjectHashes.length) continue;
      candidates.push({
        reviewerAccountAddress: address,
        reviewerLookup,
        clusterPseudonym: rowString(member, "cluster_pseudonym")!,
        riskBand,
        providerSubjectHashes,
        activeCustomerAssignments: customerCounts.get(reviewerLookup) ?? 0,
        recentCoassignmentsByReviewerLookup: Object.fromEntries(recentPairs.get(reviewerLookup) ?? []),
        assuranceSnapshot: {
          schemaVersion: "rateloop.assignment-assurance-snapshot.v1",
          reviewerSource: "rateloop_network",
          assertions: usedAssertions,
          qualifications: provenance.filter(item => admission.usedQualificationKeys.includes(item.key)),
          capturedAt: now.toISOString(),
        },
        provenance,
      });
    }
    const seed = randomBytes(32).toString("hex");
    const selection = selectDiversifiedIntegrityPanel({ candidates, constraints: policy.integrity, targetCount, seed });
    const batchId = `hasb_${randomUUID().replaceAll("-", "")}`;
    const reservationExpiresAt = new Date(now.getTime() + ttl);
    for (const chosen of selection.selected) {
      const assignmentId = `haas_${randomUUID().replaceAll("-", "")}`;
      const integrityProvenance = {
        schemaVersion: "rateloop.assignment-integrity-provenance.v1",
        epochId: policy.integrity.epochId,
        epochManifestHash: policy.integrity.epochManifestHash,
        constraints: policy.integrity,
        reviewerLookup: chosen.reviewerLookup,
        clusterPseudonym: chosen.clusterPseudonym,
        riskBand: chosen.riskBand,
        providerSubjectHashes: chosen.providerSubjectHashes,
        activeCustomerAssignments: chosen.activeCustomerAssignments,
        recentCoassignments: Math.max(
          0,
          ...selection.selected
            .filter(peer => peer.reviewerLookup !== chosen.reviewerLookup)
            .map(peer => chosen.recentCoassignmentsByReviewerLookup[peer.reviewerLookup] ?? 0),
        ),
        selectionBatchId: batchId,
        selectionCommitment: selection.selectionCommitment,
      };
      const integrityJson = canonicalJson(integrityProvenance);
      const integrityHash = `sha256:${hashToken(integrityJson)}`;
      const assuranceJson = canonicalJson(chosen.assuranceSnapshot);
      await client.query(
        `INSERT INTO tokenless_assurance_assignments
         (assignment_id, workspace_id, project_id, run_id, subpanel_id, cohort_id,
          reviewer_account_address, source, selection, status, confidentiality_terms_hash,
          qualification_provenance_json, assurance_snapshot_json, assurance_snapshot_hash,
          blinding_json, paid_assignment, paid_eligibility_checked_at, voucher_marker,
          reservation_expires_at, lease_issuer_account_address, lease_state, recovery_count,
          integrity_epoch_id, integrity_manifest_hash, integrity_reviewer_lookup,
          integrity_cluster_pseudonym, integrity_risk_band, provider_subject_hashes_json,
          integrity_provenance_json, integrity_provenance_hash, selection_batch_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'rateloop_network','randomized','reserved',$8,$9,$10,$11,
                 $12,true,$13,NULL,$14,$15,'pending',0,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$25)`,
        [
          assignmentId,
          input.workspaceId,
          input.projectId,
          input.runId,
          input.subpanelId,
          rowString(subpanel, "cohort_id"),
          chosen.reviewerAccountAddress,
          input.confidentialityTermsHash,
          JSON.stringify(chosen.provenance),
          assuranceJson,
          `sha256:${hashToken(assuranceJson)}`,
          JSON.stringify({ swap: randomInt(2) === 1 }),
          now,
          reservationExpiresAt,
          manager,
          policy.integrity.epochId,
          policy.integrity.epochManifestHash,
          chosen.reviewerLookup,
          chosen.clusterPseudonym,
          chosen.riskBand,
          JSON.stringify(chosen.providerSubjectHashes),
          integrityJson,
          integrityHash,
          batchId,
          now,
        ],
      );
      await client.query(
        `INSERT INTO tokenless_integrity_assignment_history
         (history_id, selection_batch_id, workspace_id, project_id, run_id, subpanel_id,
          assignment_id, epoch_id, manifest_hash, reviewer_lookup, cluster_pseudonym,
          provider_subject_hashes_json, selected_at, response_window_closes_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          `hiah_${randomUUID().replaceAll("-", "")}`,
          batchId,
          input.workspaceId,
          input.projectId,
          input.runId,
          input.subpanelId,
          assignmentId,
          policy.integrity.epochId,
          policy.integrity.epochManifestHash,
          chosen.reviewerLookup,
          chosen.clusterPseudonym,
          JSON.stringify(chosen.providerSubjectHashes),
          now,
          reservationExpiresAt,
        ],
      );
      await client.query(
        `UPDATE tokenless_assurance_cohort_reviewers SET active_reservations = active_reservations + 1
         WHERE project_id = $1 AND cohort_id = $2 AND reviewer_account_address = $3`,
        [input.projectId, rowString(subpanel, "cohort_id"), chosen.reviewerAccountAddress],
      );
    }
    await client.query(
      `UPDATE tokenless_assurance_run_subpanels
       SET active_reservations = $1, selected_count = $1, selection_batch_id = $2,
           selection_seed_hash = $3, selection_commitment = $4, selection_status = 'reserved'
       WHERE subpanel_id = $5 AND selection_status = 'pending'`,
      [targetCount, batchId, selection.selectionSeedHash, selection.selectionCommitment, input.subpanelId],
    );
    await client.query(
      `UPDATE tokenless_assurance_cohorts SET active_reservations = active_reservations + $1
       WHERE project_id = $2 AND cohort_id = $3`,
      [targetCount, input.projectId, rowString(subpanel, "cohort_id")],
    );
    await client.query("COMMIT");
    return {
      subpanelId: input.subpanelId,
      source: "rateloop_network" as const,
      selectedCount: selection.aggregate.selectedCount,
      selectionCommitment: selection.selectionCommitment,
      integrity: {
        epochId: policy.integrity.epochId,
        manifestHash: policy.integrity.epochManifestHash,
        independentClusterCount: selection.aggregate.independentClusterCount,
        largestClusterShareBps: selection.aggregate.largestClusterShareBps,
        riskBandCounts: selection.aggregate.riskBandCounts,
      },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function reserveAudienceAssignment(input: {
  accountAddress: string;
  workspaceId: string;
  projectId: string;
  runId: string;
  subpanelId: string;
  confidentialityTermsHash: string;
  reviewerAccountAddress?: string;
  reservationTtlMs?: number;
  now?: Date;
}) {
  const manager = await requireProjectManager(input);
  if (!HASH_PATTERN.test(input.confidentialityTermsHash)) {
    throw new TokenlessServiceError("Confidentiality terms hash is invalid.", 400, "invalid_confidentiality_terms");
  }
  const now = input.now ?? new Date();
  const ttl = integer(
    input.reservationTtlMs ?? DEFAULT_RESERVATION_TTL_MS,
    "reservationTtlMs",
    60_000,
    MAX_RESERVATION_TTL_MS,
  );
  const namedReviewer = input.reviewerAccountAddress
    ? normalizeAddress(input.reviewerAccountAddress, "reviewerAccountAddress")
    : null;
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const subpanelResult = await client.query(
      `SELECT sp.*, r.status AS run_status, r.manifest_hash AS current_run_manifest_hash,
              r.policy_hash AS current_policy_hash, p.policy_json
       FROM tokenless_assurance_run_subpanels sp
       JOIN tokenless_assurance_runs r ON r.run_id = sp.run_id AND r.project_id = sp.project_id
       JOIN tokenless_assurance_audience_policies p
         ON p.policy_id = sp.policy_id AND p.version = sp.policy_version
       WHERE sp.subpanel_id = $1 AND sp.run_id = $2 AND sp.project_id = $3 AND sp.workspace_id = $4
       LIMIT 1 FOR UPDATE`,
      [input.subpanelId, input.runId, input.projectId, input.workspaceId],
    );
    const subpanel = subpanelResult.rows[0] as QueryRow | undefined;
    if (
      !subpanel ||
      !["frozen", "recruiting"].includes(rowString(subpanel, "run_status") ?? "") ||
      rowString(subpanel, "run_manifest_hash") !== rowString(subpanel, "current_run_manifest_hash") ||
      rowString(subpanel, "policy_hash") !== rowString(subpanel, "current_policy_hash")
    ) {
      throw new TokenlessServiceError("Audience subpanel not found.", 404, "subpanel_not_found");
    }
    const policy = parseJson<HumanAssuranceAudiencePolicy>(subpanel.policy_json, "audience policy");
    const source = rowString(subpanel, "source") as CohortSource;
    const isPaid = assignmentIsPaid(policy.compensation, source);
    assertAssuranceAssignmentSettlementAvailable({ paidAssignment: isPaid, policy, source });
    const selection = rowString(subpanel, "selection") as AudienceSelection;
    if ((selection === "customer_named") !== Boolean(namedReviewer)) {
      throw new TokenlessServiceError(
        selection === "customer_named"
          ? "customer_named reservations require an explicit invited reviewer."
          : "randomized reservations must not name a reviewer.",
        400,
        "invalid_audience_selection",
      );
    }
    const expired = await client.query(
      `SELECT * FROM tokenless_assurance_assignments
       WHERE subpanel_id = $1 AND status = 'reserved' AND reservation_expires_at <= $2 FOR UPDATE`,
      [input.subpanelId, now],
    );
    for (const value of expired.rows) await expireLockedAssignment(client, value as QueryRow, now);

    const currentSubpanelResult = await client.query(
      "SELECT active_reservations, target_count FROM tokenless_assurance_run_subpanels WHERE subpanel_id = $1 FOR UPDATE",
      [input.subpanelId],
    );
    const currentSubpanel = currentSubpanelResult.rows[0] as QueryRow;

    const cohortResult = await client.query(
      `SELECT * FROM tokenless_assurance_cohorts
       WHERE project_id = $1 AND cohort_id = $2 AND status = 'active' LIMIT 1 FOR UPDATE`,
      [input.projectId, rowString(subpanel, "cohort_id")],
    );
    const cohort = cohortResult.rows[0] as QueryRow;
    if (
      (rowNumber(currentSubpanel, "active_reservations") ?? 0) >= (rowNumber(currentSubpanel, "target_count") ?? 0) ||
      (rowNumber(cohort, "active_reservations") ?? 0) >= (rowNumber(cohort, "capacity") ?? 0)
    ) {
      throw new TokenlessServiceError("Audience capacity is exhausted.", 409, "audience_capacity_exhausted");
    }
    const privateGroupCandidates = await activePrivateGroupCandidates(client, {
      projectId: input.projectId,
      subpanel,
      now,
    });
    const privateGroupAddresses = privateGroupCandidates ? [...privateGroupCandidates.keys()] : null;
    const reviewerResult = await client.query(
      `SELECT cr.* FROM tokenless_assurance_cohort_reviewers cr
       WHERE cr.project_id = $1 AND cr.cohort_id = $2 AND cr.status = 'active'
         AND cr.active_reservations < cr.maximum_active_assignments
         AND (cr.qualification_expires_at IS NULL OR cr.qualification_expires_at > $3)
         ${privateGroupAddresses ? "AND cr.reviewer_account_address = ANY($4::text[])" : ""}
         ${namedReviewer ? `AND cr.reviewer_account_address = $${privateGroupAddresses ? 5 : 4}` : ""}
       FOR UPDATE`,
      [
        input.projectId,
        rowString(subpanel, "cohort_id"),
        now,
        ...(privateGroupAddresses ? [privateGroupAddresses] : []),
        ...(namedReviewer ? [namedReviewer] : []),
      ],
    );
    const reviewerAddresses = reviewerResult.rows.map(value =>
      rowString(value as QueryRow, "reviewer_account_address"),
    );
    const alreadyAssignedResult = reviewerAddresses.length
      ? await client.query(
          `SELECT reviewer_account_address FROM tokenless_assurance_assignments
           WHERE run_id = $1 AND reviewer_account_address = ANY($2::text[])`,
          [input.runId, reviewerAddresses],
        )
      : { rows: [] };
    const alreadyAssigned = new Set(
      alreadyAssignedResult.rows.map(value => rowString(value as QueryRow, "reviewer_account_address")),
    );
    const rules = [
      ...validateQualificationRules(parseJson<QualificationRule[]>(cohort.qualification_rules_json, "cohort rules")),
      ...validateQualificationRules(policy.requiredQualifications),
    ];
    const eligible: Array<{
      row: QueryRow;
      provenance: QualificationProvenance[];
      paidEligibility: Awaited<ReturnType<typeof paidEligibility>> | null;
    }> = [];
    for (const value of reviewerResult.rows) {
      const reviewer = value as QueryRow;
      if (alreadyAssigned.has(rowString(reviewer, "reviewer_account_address"))) continue;
      const provenance = parseJson<QualificationProvenance[]>(
        reviewer.qualification_provenance_json,
        "qualification provenance",
      );
      if (!satisfiesQualifications(rules, provenance, now)) continue;
      let paidEligibilitySnapshot: Awaited<ReturnType<typeof paidEligibility>> | null = null;
      if (isPaid) {
        try {
          paidEligibilitySnapshot = await paidEligibility(
            client,
            rowString(reviewer, "reviewer_account_address")!,
            now,
          );
        } catch (error) {
          if (namedReviewer) throw error;
          continue;
        }
      }
      eligible.push({ row: reviewer, provenance, paidEligibility: paidEligibilitySnapshot });
    }
    if (!eligible.length) {
      throw new TokenlessServiceError(
        namedReviewer ? "Named reviewer is not eligible for this assignment." : "No qualified reviewer has capacity.",
        409,
        namedReviewer ? "reviewer_not_eligible" : "reviewer_capacity_unavailable",
      );
    }
    const chosen = eligible[selection === "randomized" ? randomInt(eligible.length) : 0]!;
    const reviewerAccountAddress = rowString(chosen.row, "reviewer_account_address")!;
    const assignmentId = `haas_${randomUUID().replaceAll("-", "")}`;
    const reservationExpiresAt = new Date(now.getTime() + ttl);
    const assuranceSnapshot = {
      schemaVersion: "rateloop.assignment-assurance-snapshot.v1",
      reviewerSource: source,
      assertions:
        chosen.paidEligibility?.assertions ??
        (source === "customer_invited"
          ? [
              {
                assertionId: `invite_${assignmentId}`,
                bindingId: `invite_${reviewerAccountAddress}`,
                providerId: "rateloop:invitation",
                providerNamespace: "rateloop:assignment:v1",
                subjectReferenceHash: `sha256:${hashToken(`${input.runId}:${reviewerAccountAddress}`)}`,
                capabilities: ["customer_invitation"],
                verifiedAt: now.toISOString(),
                expiresAt: reservationExpiresAt.toISOString(),
              },
            ]
          : []),
      qualifications: chosen.provenance,
      ...(rowString(subpanel, "private_group_id")
        ? {
            privateGroup: {
              groupId: rowString(subpanel, "private_group_id"),
              policyVersion: rowNumber(subpanel, "private_group_policy_version"),
              policyHash: rowString(subpanel, "private_group_policy_hash"),
              membershipJoinedAt: privateGroupCandidates?.get(reviewerAccountAddress)?.joinedAt.toISOString(),
            },
          }
        : {}),
      capturedAt: now.toISOString(),
    };
    const assuranceSnapshotJson = canonicalJson(assuranceSnapshot);
    const assuranceSnapshotHash = `sha256:${hashToken(assuranceSnapshotJson)}`;
    await client.query(
      `INSERT INTO tokenless_assurance_assignments
       (assignment_id, workspace_id, project_id, run_id, subpanel_id, cohort_id,
        reviewer_account_address, source, selection, status, confidentiality_terms_hash,
        qualification_provenance_json, assurance_snapshot_json, assurance_snapshot_hash,
        blinding_json, paid_assignment, private_group_id, private_group_policy_version,
        private_group_policy_hash, private_group_membership_joined_at,
        paid_eligibility_checked_at, voucher_marker, reservation_expires_at,
        lease_issuer_account_address, lease_state, recovery_count, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'reserved', $10, $11, $12, $13, $14,
               $15, $16, $17, $18, $19, $20, NULL, $21, $22, 'pending', 0, $23, $23)`,
      [
        assignmentId,
        input.workspaceId,
        input.projectId,
        input.runId,
        input.subpanelId,
        rowString(subpanel, "cohort_id"),
        reviewerAccountAddress,
        source,
        selection,
        input.confidentialityTermsHash,
        JSON.stringify(chosen.provenance),
        assuranceSnapshotJson,
        assuranceSnapshotHash,
        JSON.stringify({ swap: randomInt(2) === 1 }),
        isPaid,
        rowString(subpanel, "private_group_id"),
        rowString(subpanel, "private_group_id") ? rowNumber(subpanel, "private_group_policy_version") : null,
        rowString(subpanel, "private_group_policy_hash"),
        privateGroupCandidates?.get(reviewerAccountAddress)?.joinedAt ?? null,
        isPaid ? now : null,
        reservationExpiresAt,
        manager,
        now,
      ],
    );
    await client.query(
      "UPDATE tokenless_assurance_run_subpanels SET active_reservations = active_reservations + 1 WHERE subpanel_id = $1",
      [input.subpanelId],
    );
    await client.query(
      "UPDATE tokenless_assurance_cohorts SET active_reservations = active_reservations + 1 WHERE project_id = $1 AND cohort_id = $2",
      [input.projectId, rowString(subpanel, "cohort_id")],
    );
    await client.query(
      `UPDATE tokenless_assurance_cohort_reviewers SET active_reservations = active_reservations + 1
       WHERE project_id = $1 AND cohort_id = $2 AND reviewer_account_address = $3`,
      [input.projectId, rowString(subpanel, "cohort_id"), reviewerAccountAddress],
    );
    await client.query("COMMIT");
    return {
      assignmentId,
      ...(selection === "customer_named" ? { reviewerAccountAddress } : {}),
      source,
      paidAssignment: isPaid,
      reservationExpiresAt: reservationExpiresAt.toISOString(),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function recoverExpiredAudienceAssignment(input: {
  baseAccountAddress: string;
  assignmentId: string;
  confidentialityTermsHash?: string;
  reservationTtlMs?: number;
  now?: Date;
}) {
  const reviewer = normalizeAddress(input.baseAccountAddress, "baseAccountAddress");
  const now = input.now ?? new Date();
  await expireAudienceAssignments(now);
  const accepted = await dbClient.execute({
    sql: `SELECT assignment_id FROM tokenless_assurance_assignments
          WHERE assignment_id = ? AND reviewer_account_address = ? AND status = 'accepted' LIMIT 1`,
    args: [input.assignmentId, reviewer],
  });
  if (accepted.rowCount) {
    if (!input.confidentialityTermsHash || !HASH_PATTERN.test(input.confidentialityTermsHash)) {
      throw new TokenlessServiceError(
        "Confidentiality terms hash is required to renew artifact access.",
        400,
        "invalid_confidentiality_terms",
      );
    }
    return {
      assignmentId: input.assignmentId,
      accepted: true as const,
      leases: await issueAssignmentArtifactLeases(input.assignmentId, now, reviewer, input.confidentialityTermsHash),
    };
  }
  const ttl = integer(
    input.reservationTtlMs ?? DEFAULT_RESERVATION_TTL_MS,
    "reservationTtlMs",
    60_000,
    MAX_RESERVATION_TTL_MS,
  );
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT a.*, sp.target_count, sp.active_reservations AS subpanel_reservations,
              sp.run_manifest_hash, sp.policy_hash,
              sp.private_group_id AS subpanel_private_group_id,
              sp.private_group_policy_version AS subpanel_private_group_policy_version,
              sp.private_group_policy_hash AS subpanel_private_group_policy_hash,
              c.capacity, c.active_reservations AS cohort_reservations,
              cr.maximum_active_assignments, cr.active_reservations AS reviewer_reservations,
              r.status AS run_status, r.manifest_hash AS current_run_manifest_hash,
              r.policy_hash AS current_policy_hash, ap.policy_json
       FROM tokenless_assurance_assignments a
       JOIN tokenless_assurance_run_subpanels sp ON sp.subpanel_id = a.subpanel_id
       JOIN tokenless_assurance_cohorts c ON c.project_id = a.project_id AND c.cohort_id = a.cohort_id
       JOIN tokenless_assurance_cohort_reviewers cr
         ON cr.project_id = a.project_id AND cr.cohort_id = a.cohort_id
        AND cr.reviewer_account_address = a.reviewer_account_address
       JOIN tokenless_assurance_runs r ON r.run_id = a.run_id
       JOIN tokenless_assurance_audience_policies ap
         ON ap.policy_id = r.audience_policy_id AND ap.version = r.audience_policy_version
       WHERE a.assignment_id = $1 AND a.reviewer_account_address = $2 AND a.status = 'expired'
       LIMIT 1 FOR UPDATE`,
      [input.assignmentId, reviewer],
    );
    const row = result.rows[0] as QueryRow | undefined;
    if (
      !row ||
      (rowNumber(row, "recovery_count") ?? 20) >= 20 ||
      !["frozen", "recruiting"].includes(rowString(row, "run_status") ?? "") ||
      rowString(row, "run_manifest_hash") !== rowString(row, "current_run_manifest_hash") ||
      rowString(row, "policy_hash") !== rowString(row, "current_policy_hash")
    ) {
      throw new TokenlessServiceError("Assignment cannot be recovered.", 409, "assignment_recovery_unavailable");
    }
    assertAssuranceAssignmentSettlementAvailable({
      paidAssignment: row.paid_assignment === true,
      policy: parseJson<HumanAssuranceAudiencePolicy>(row.policy_json, "audience policy"),
      source: rowString(row, "source") as CohortSource,
    });
    assertMatchingPrivateGroupSnapshot(row);
    await requireCurrentPrivateGroupAssignmentMembership(client, row, reviewer, now);
    if (
      (rowNumber(row, "subpanel_reservations") ?? 0) >= (rowNumber(row, "target_count") ?? 0) ||
      (rowNumber(row, "cohort_reservations") ?? 0) >= (rowNumber(row, "capacity") ?? 0) ||
      (rowNumber(row, "reviewer_reservations") ?? 0) >= (rowNumber(row, "maximum_active_assignments") ?? 0)
    ) {
      throw new TokenlessServiceError(
        "Assignment capacity is no longer available.",
        409,
        "audience_capacity_exhausted",
      );
    }
    if (row.paid_assignment === true) await paidEligibility(client, reviewer, now);
    const reservationExpiresAt = new Date(now.getTime() + ttl);
    await client.query(
      `UPDATE tokenless_assurance_assignments
       SET status = 'reserved', reservation_expires_at = $1, lease_state = 'pending',
           recovery_count = recovery_count + 1, updated_at = $2
       WHERE assignment_id = $3 AND status = 'expired'`,
      [reservationExpiresAt, now, input.assignmentId],
    );
    await client.query(
      "UPDATE tokenless_assurance_run_subpanels SET active_reservations = active_reservations + 1 WHERE subpanel_id = $1",
      [rowString(row, "subpanel_id")],
    );
    await client.query(
      "UPDATE tokenless_assurance_cohorts SET active_reservations = active_reservations + 1 WHERE project_id = $1 AND cohort_id = $2",
      [rowString(row, "project_id"), rowString(row, "cohort_id")],
    );
    await client.query(
      `UPDATE tokenless_assurance_cohort_reviewers SET active_reservations = active_reservations + 1
       WHERE project_id = $1 AND cohort_id = $2 AND reviewer_account_address = $3`,
      [rowString(row, "project_id"), rowString(row, "cohort_id"), reviewer],
    );
    await client.query("COMMIT");
    return { assignmentId: input.assignmentId, reservationExpiresAt: reservationExpiresAt.toISOString() };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function assignmentArtifactIds(assignmentId: string) {
  const result = await dbClient.execute({
    sql: `SELECT c.baseline_artifact_id, c.candidate_artifact_id, c.context_artifact_ids_json
          FROM tokenless_assurance_assignments a
          JOIN tokenless_assurance_runs r ON r.run_id = a.run_id
          JOIN tokenless_assurance_cases c ON c.suite_id = r.suite_id AND c.suite_version = r.suite_version
          WHERE a.assignment_id = ? AND c.status = 'ready' ORDER BY c.position ASC`,
    args: [assignmentId],
  });
  const ids = new Set<string>();
  for (const value of result.rows) {
    const row = value as QueryRow;
    ids.add(rowString(row, "baseline_artifact_id")!);
    ids.add(rowString(row, "candidate_artifact_id")!);
    for (const id of parseJson<string[]>(row.context_artifact_ids_json, "context artifact ids")) ids.add(id);
  }
  if (!ids.size) throw new TokenlessServiceError("Assignment has no ready cases.", 409, "assignment_not_ready");
  return [...ids];
}

async function issueAssignmentArtifactLeases(
  assignmentId: string,
  now: Date,
  reviewerAccountAddress: string,
  confidentialityTermsHash: string,
) {
  const result = await dbClient.execute({
    sql: `SELECT a.workspace_id, a.project_id, a.reviewer_account_address,
                 a.lease_issuer_account_address, a.confidentiality_terms_hash,
                 a.confidentiality_accepted_at, a.assignment_expires_at,
                 a.source, a.paid_assignment,
                 a.private_group_id, a.private_group_policy_version, a.private_group_policy_hash,
                 r.status AS run_status, r.manifest_hash AS current_run_manifest_hash,
                 r.policy_hash AS current_policy_hash, sp.run_manifest_hash, sp.policy_hash,
                 sp.private_group_id AS subpanel_private_group_id,
                 sp.private_group_policy_version AS subpanel_private_group_policy_version,
                 sp.private_group_policy_hash AS subpanel_private_group_policy_hash,
                 ap.policy_json
          FROM tokenless_assurance_assignments a
          JOIN tokenless_assurance_runs r ON r.run_id = a.run_id AND r.project_id = a.project_id
          JOIN tokenless_assurance_run_subpanels sp ON sp.subpanel_id = a.subpanel_id
          JOIN tokenless_assurance_audience_policies ap
            ON ap.policy_id = r.audience_policy_id AND ap.version = r.audience_policy_version
          WHERE a.assignment_id = ? AND a.reviewer_account_address = ? AND a.status = 'accepted' LIMIT 1`,
    args: [assignmentId, reviewerAccountAddress],
  });
  const row = result.rows[0] as QueryRow | undefined;
  if (!row) throw new TokenlessServiceError("Assignment not found.", 404, "assignment_not_found");
  assertAssuranceAssignmentSettlementAvailable({
    paidAssignment: row.paid_assignment === true,
    policy: parseJson<HumanAssuranceAudiencePolicy>(row.policy_json, "audience policy"),
    source: rowString(row, "source") as CohortSource,
  });
  assertMatchingPrivateGroupSnapshot(row);
  if ((rowDate(row, "assignment_expires_at")?.getTime() ?? 0) <= now.getTime()) {
    throw new TokenlessServiceError("Assignment expired.", 410, "assignment_expired");
  }
  if (
    !rowDate(row, "confidentiality_accepted_at") ||
    rowString(row, "confidentiality_terms_hash") !== confidentialityTermsHash
  ) {
    throw new TokenlessServiceError("Confidentiality terms changed.", 409, "confidentiality_terms_mismatch");
  }
  if (
    !["frozen", "recruiting", "collecting"].includes(rowString(row, "run_status") ?? "") ||
    rowString(row, "run_manifest_hash") !== rowString(row, "current_run_manifest_hash") ||
    rowString(row, "policy_hash") !== rowString(row, "current_policy_hash")
  ) {
    throw new TokenlessServiceError("Assignment not found.", 404, "assignment_not_found");
  }
  const leases = [];
  try {
    const artifactIds = await assignmentArtifactIds(assignmentId);
    const active = await dbClient.execute({
      sql: `SELECT lease_id, artifact_id, expires_at FROM tokenless_assurance_artifact_leases
            WHERE assignment_id = ? AND account_address = ? AND revoked_at IS NULL AND expires_at > ?
            ORDER BY created_at DESC`,
      args: [assignmentId, reviewerAccountAddress, now],
    });
    const activeByArtifact = new Map<string, { leaseId: string; expiresAt: string }>();
    for (const value of active.rows) {
      const lease = value as QueryRow;
      const artifactId = rowString(lease, "artifact_id")!;
      if (!activeByArtifact.has(artifactId)) {
        activeByArtifact.set(artifactId, {
          leaseId: rowString(lease, "lease_id")!,
          expiresAt: rowDate(lease, "expires_at")!.toISOString(),
        });
      }
    }
    for (const artifactId of artifactIds) {
      const existing = activeByArtifact.get(artifactId);
      if (existing) {
        leases.push({ artifactId, ...existing });
        continue;
      }
      const lease = await issueArtifactLease({
        accountAddress: rowString(row, "lease_issuer_account_address")!,
        artifactId,
        assignmentId,
        expiresAt: new Date(now.getTime() + ARTIFACT_LEASE_TTL_MS),
        projectId: rowString(row, "project_id")!,
        purpose: "assigned_review",
        recipientAddress: rowString(row, "reviewer_account_address")!,
        workspaceId: rowString(row, "workspace_id")!,
        now,
      });
      leases.push({ artifactId, ...lease });
    }
    await dbClient.execute({
      sql: "UPDATE tokenless_assurance_assignments SET lease_state = 'issued', updated_at = ? WHERE assignment_id = ?",
      args: [now, assignmentId],
    });
    return leases;
  } catch (error) {
    await dbClient.execute({
      sql: "UPDATE tokenless_assurance_assignments SET lease_state = 'failed', updated_at = ? WHERE assignment_id = ?",
      args: [now, assignmentId],
    });
    throw error;
  }
}

export async function acceptAudienceAssignment(input: {
  baseAccountAddress: string;
  assignmentId: string;
  confidentialityTermsHash: string;
  now?: Date;
}) {
  const reviewer = normalizeAddress(input.baseAccountAddress, "baseAccountAddress");
  const now = input.now ?? new Date();
  if (!HASH_PATTERN.test(input.confidentialityTermsHash)) {
    throw new TokenlessServiceError("Confidentiality terms hash is invalid.", 400, "invalid_confidentiality_terms");
  }
  const client = await dbPool.connect();
  let replay = false;
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT a.*, r.status AS run_status, r.manifest_hash AS current_run_manifest_hash,
              r.policy_hash AS current_policy_hash, sp.run_manifest_hash, sp.policy_hash,
              sp.private_group_id AS subpanel_private_group_id,
              sp.private_group_policy_version AS subpanel_private_group_policy_version,
              sp.private_group_policy_hash AS subpanel_private_group_policy_hash,
              ap.policy_json
       FROM tokenless_assurance_assignments a
       JOIN tokenless_assurance_runs r ON r.run_id = a.run_id AND r.project_id = a.project_id
       JOIN tokenless_assurance_run_subpanels sp ON sp.subpanel_id = a.subpanel_id
       JOIN tokenless_assurance_audience_policies ap
         ON ap.policy_id = r.audience_policy_id AND ap.version = r.audience_policy_version
       WHERE a.assignment_id = $1 AND a.reviewer_account_address = $2 LIMIT 1 FOR UPDATE`,
      [input.assignmentId, reviewer],
    );
    const row = result.rows[0] as QueryRow | undefined;
    if (
      !row ||
      !["frozen", "recruiting", "collecting"].includes(rowString(row, "run_status") ?? "") ||
      rowString(row, "run_manifest_hash") !== rowString(row, "current_run_manifest_hash") ||
      rowString(row, "policy_hash") !== rowString(row, "current_policy_hash")
    ) {
      throw new TokenlessServiceError("Assignment not found.", 404, "assignment_not_found");
    }
    assertAssuranceAssignmentSettlementAvailable({
      paidAssignment: row.paid_assignment === true,
      policy: parseJson<HumanAssuranceAudiencePolicy>(row.policy_json, "audience policy"),
      source: rowString(row, "source") as CohortSource,
    });
    assertMatchingPrivateGroupSnapshot(row);
    await requireCurrentPrivateGroupAssignmentMembership(client, row, reviewer, now);
    if (rowString(row, "confidentiality_terms_hash") !== input.confidentialityTermsHash) {
      throw new TokenlessServiceError("Confidentiality terms changed.", 409, "confidentiality_terms_mismatch");
    }
    if (rowString(row, "status") === "accepted") {
      replay = true;
    } else {
      if (
        rowString(row, "status") !== "reserved" ||
        (rowDate(row, "reservation_expires_at")?.getTime() ?? 0) <= now.getTime()
      ) {
        throw new TokenlessServiceError("Assignment reservation expired.", 410, "assignment_expired");
      }
      let voucherMarker: string | null = null;
      if (row.paid_assignment === true) {
        const eligibility = await paidEligibility(client, reviewer, now);
        voucherMarker = `eligibility:${eligibility.raterId}:${createHash("sha256").update(`${input.assignmentId}:${reviewer}`).digest("hex")}`;
      }
      await client.query(
        `UPDATE tokenless_assurance_assignments
         SET status = 'accepted', confidentiality_accepted_at = $1, accepted_at = $1,
             assignment_expires_at = $2, voucher_marker = $3, lease_state = 'pending', updated_at = $1
         WHERE assignment_id = $4 AND status = 'reserved'`,
        [now, new Date(now.getTime() + ACCEPTED_ASSIGNMENT_TTL_MS), voucherMarker, input.assignmentId],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  const leases = await issueAssignmentArtifactLeases(input.assignmentId, now, reviewer, input.confidentialityTermsHash);
  return { assignmentId: input.assignmentId, accepted: true, replay, leases };
}

export async function getAssignmentOnlyTask(input: { baseAccountAddress: string; assignmentId: string; now?: Date }) {
  const reviewer = normalizeAddress(input.baseAccountAddress, "baseAccountAddress");
  const now = input.now ?? new Date();
  const assignmentResult = await dbClient.execute({
    sql: `SELECT a.*, r.suite_id, r.suite_version, r.manifest_hash AS current_run_manifest_hash,
                 r.policy_hash AS current_policy_hash, sp.run_manifest_hash, sp.policy_hash,
                 sp.private_group_id AS subpanel_private_group_id,
                 sp.private_group_policy_version AS subpanel_private_group_policy_version,
                 sp.private_group_policy_hash AS subpanel_private_group_policy_hash,
                 s.manifest_json AS suite_manifest_json, ap.policy_json
          FROM tokenless_assurance_assignments a
          JOIN tokenless_assurance_runs r ON r.run_id = a.run_id AND r.project_id = a.project_id
          JOIN tokenless_assurance_run_subpanels sp ON sp.subpanel_id = a.subpanel_id
          JOIN tokenless_assurance_suites s ON s.suite_id = r.suite_id AND s.version = r.suite_version
          JOIN tokenless_assurance_audience_policies ap
            ON ap.policy_id = r.audience_policy_id AND ap.version = r.audience_policy_version
          WHERE a.assignment_id = ? AND a.reviewer_account_address = ? AND a.status = 'accepted'
            AND a.confidentiality_accepted_at IS NOT NULL AND a.assignment_expires_at > ?
            AND a.lease_state = 'issued' LIMIT 1`,
    args: [input.assignmentId, reviewer, now],
  });
  const assignment = assignmentResult.rows[0] as QueryRow | undefined;
  if (
    !assignment ||
    rowString(assignment, "run_manifest_hash") !== rowString(assignment, "current_run_manifest_hash") ||
    rowString(assignment, "policy_hash") !== rowString(assignment, "current_policy_hash")
  ) {
    throw new TokenlessServiceError("Assignment not found.", 404, "assignment_not_found");
  }
  assertAssuranceAssignmentSettlementAvailable({
    paidAssignment: assignment.paid_assignment === true,
    policy: parseJson<HumanAssuranceAudiencePolicy>(assignment.policy_json, "audience policy"),
    source: rowString(assignment, "source") as CohortSource,
  });
  assertMatchingPrivateGroupSnapshot(assignment);
  const caseResult = await dbClient.execute({
    sql: `SELECT rc.case_id, rc.position, rc.variant_a_artifact_id, rc.variant_b_artifact_id,
                 c.title, c.instructions, c.context_artifact_ids_json, c.objective_reference
          FROM tokenless_assurance_run_cases rc
          JOIN tokenless_assurance_cases c ON c.case_id = rc.case_id AND c.status = 'ready'
          WHERE rc.run_id = ? ORDER BY rc.position ASC`,
    args: [rowString(assignment, "run_id")],
  });
  if (!caseResult.rows.length) {
    throw new TokenlessServiceError("Assignment has no frozen run cases.", 409, "assignment_not_ready");
  }
  const leaseResult = await dbClient.execute({
    sql: `SELECT lease_id, artifact_id, expires_at FROM tokenless_assurance_artifact_leases
          WHERE assignment_id = ? AND account_address = ? AND revoked_at IS NULL AND expires_at > ?
          ORDER BY created_at DESC`,
    args: [input.assignmentId, reviewer, now],
  });
  const leases = new Map<string, { leaseId: string; expiresAt: string }>();
  for (const value of leaseResult.rows) {
    const row = value as QueryRow;
    const artifactId = rowString(row, "artifact_id")!;
    if (!leases.has(artifactId)) {
      leases.set(artifactId, {
        leaseId: rowString(row, "lease_id")!,
        expiresAt: rowDate(row, "expires_at")!.toISOString(),
      });
    }
  }
  const suiteManifest = parseJson<{ rubric?: unknown }>(assignment.suite_manifest_json, "suite manifest");
  const rubric = parseHumanAssuranceRubric(suiteManifest.rubric);
  const artifact = (artifactId: string) => {
    const lease = leases.get(artifactId);
    if (!lease) throw new TokenlessServiceError("Artifact lease expired.", 410, "artifact_lease_expired");
    return { artifactId, ...lease };
  };
  return {
    assignmentId: input.assignmentId,
    runId: rowString(assignment, "run_id"),
    source: rowString(assignment, "source") as CohortSource,
    runManifestHash: rowString(assignment, "run_manifest_hash"),
    policyHash: rowString(assignment, "policy_hash"),
    privateGroup:
      rowString(assignment, "private_group_id") === null
        ? null
        : {
            groupId: rowString(assignment, "private_group_id"),
            policyVersion: rowNumber(assignment, "private_group_policy_version"),
            policyHash: rowString(assignment, "private_group_policy_hash"),
          },
    qualificationProvenance: parseJson<QualificationProvenance[]>(
      assignment.qualification_provenance_json,
      "qualification provenance",
    ),
    rubric: {
      prompt: rubric.prompt,
      failureTags: rubric.failureTags,
      rationale: rubric.rationale,
    },
    cases: caseResult.rows.map(value => {
      const row = value as QueryRow;
      const variantAId = rowString(row, "variant_a_artifact_id")!;
      const variantBId = rowString(row, "variant_b_artifact_id")!;
      return {
        caseId: rowString(row, "case_id"),
        position: rowNumber(row, "position"),
        title: rowString(row, "title"),
        instructions: rowString(row, "instructions"),
        options: [
          { key: "A", ...artifact(variantAId) },
          { key: "B", ...artifact(variantBId) },
        ],
        context: parseJson<string[]>(row.context_artifact_ids_json, "context artifact ids").map(artifact),
        objectiveReference: rowString(row, "objective_reference"),
      };
    }),
  };
}

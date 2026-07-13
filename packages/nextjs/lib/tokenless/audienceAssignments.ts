import { type HumanAssuranceAudiencePolicy, parseHumanAssuranceRubric } from "@rateloop/sdk";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { getAddress } from "viem";
import { dbClient, dbPool } from "~~/lib/db";
import { issueArtifactLease } from "~~/lib/tokenless/artifactPrivacy";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const AUDIENCE_SOURCES = ["customer_invited", "rateloop_network", "hybrid", "sandbox"] as const;
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

const COHORT_SOURCE_SET = new Set<CohortSource>(["customer_invited", "rateloop_network", "sandbox"]);
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
  const sandboxSimulation =
    input.policy.reviewerSource === "sandbox" &&
    input.policy.compensation === "unpaid" &&
    (!input.source || input.source === "sandbox") &&
    input.paidAssignment !== true;
  if (invitedUnpaid || sandboxSimulation) return;
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
    return getAddress(value).toLowerCase();
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
  const cohortId = `hacoh_${randomUUID().replaceAll("-", "")}`;
  const now = new Date();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_cohorts
          (cohort_id, project_id, name, source, selection, capacity, active_reservations,
           qualification_rules_json, status, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'active', ?, ?, ?)`,
    args: [
      cohortId,
      input.projectId,
      requiredText(input.name, "cohort name", 160),
      input.source,
      input.selection,
      integer(input.capacity, "capacity", 1, 10_000),
      JSON.stringify(validateQualificationRules(input.qualificationRules ?? [])),
      manager,
      now,
      now,
    ],
  });
  return { cohortId, projectId: input.projectId, source: input.source, selection: input.selection };
}

export async function listProjectCohorts(input: { accountAddress: string; workspaceId: string; projectId: string }) {
  await requireProjectManager(input);
  const result = await dbClient.execute({
    sql: `SELECT cohort_id, name, source, selection, capacity, active_reservations,
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
  await requireCohort({ ...input, source: "customer_invited" });
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
  if (policy.reviewerSource === "sandbox" && policy.compensation !== "unpaid") {
    throw new TokenlessServiceError(
      "Sandbox panels cannot create paid assignments.",
      409,
      "invalid_sandbox_compensation",
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
    assertAssuranceAssignmentSettlementAvailable({ policy });
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
      }));
    }
    const cohorts: QueryRow[] = [];
    for (const requested of policy.cohorts) {
      const cohortResult = await client.query(
        `SELECT * FROM tokenless_assurance_cohorts
         WHERE project_id = $1 AND cohort_id = $2 AND status = 'active' LIMIT 1 FOR UPDATE`,
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
      cohorts.push(cohort);
    }
    validatePolicySourceRules(policy, cohorts);
    const now = new Date();
    const subpanels = [];
    for (let index = 0; index < cohorts.length; index += 1) {
      const cohort = cohorts[index]!;
      const requested = policy.cohorts[index]!;
      const subpanelId = `hasp_${randomUUID().replaceAll("-", "")}`;
      await client.query(
        `INSERT INTO tokenless_assurance_run_subpanels
         (subpanel_id, workspace_id, project_id, run_id, cohort_id, source, selection,
          target_count, active_reservations, policy_id, policy_version, policy_hash,
          run_manifest_hash, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, $10, $11, $12, $13)`,
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
          now,
        ],
      );
      subpanels.push({
        subpanelId,
        cohortId: requested.cohortId,
        source: rowString(cohort, "source"),
        targetCount: requested.maximumReviewers,
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
  const result = await client.query(
    `SELECT p.rater_id, l.age_evidence_expires_at, l.minimum_age_verified, l.tax_profile_status,
            l.dac7_status, l.sanctions_status, l.sanctions_expires_at,
            pe.payout_account, pe.payout_ownership_method, pe.payout_expires_at,
            pe.eligibility_status AS payout_eligibility_status, l.eligibility_status
     FROM tokenless_rater_profiles p
     JOIN tokenless_legal_eligibility l ON l.rater_id = p.rater_id
     JOIN tokenless_payout_eligibility pe ON pe.rater_id = p.rater_id
     WHERE p.account_address = $1 LIMIT 1 FOR UPDATE`,
    [accountAddress],
  );
  const row = result.rows[0] as QueryRow | undefined;
  if (
    !row ||
    rowString(row, "eligibility_status") !== "eligible" ||
    (rowNumber(row, "minimum_age_verified") ?? 0) < 18 ||
    rowString(row, "tax_profile_status") !== "complete" ||
    !["complete", "not_required"].includes(rowString(row, "dac7_status") ?? "") ||
    rowString(row, "sanctions_status") !== "clear" ||
    (rowDate(row, "age_evidence_expires_at")?.getTime() ?? 0) <= now.getTime() ||
    (rowDate(row, "sanctions_expires_at")?.getTime() ?? 0) <= now.getTime() ||
    (rowDate(row, "payout_expires_at")?.getTime() ?? Number.POSITIVE_INFINITY) <= now.getTime() ||
    rowString(row, "payout_eligibility_status") !== "ready" ||
    normalizeAddress(rowString(row, "payout_account") ?? "", "payoutAccount") !== accountAddress ||
    rowString(row, "payout_ownership_method") !== "siwe_base_account_session"
  ) {
    throw new TokenlessServiceError(
      "Paid-task eligibility must be complete before assignment.",
      403,
      "paid_eligibility_required",
    );
  }
  const raterId = rowString(row, "rater_id")!;
  const assertions = await client.query(
    `SELECT a.assertion_id, a.binding_id, a.provider_id, a.provider_namespace,
            b.subject_reference_hash, a.capabilities_json, a.evidence_verified_at, a.evidence_expires_at
     FROM tokenless_assurance_assertions a
     JOIN tokenless_provider_subject_bindings b ON b.binding_id = a.binding_id
     WHERE a.rater_id = $1 AND a.status = 'active' AND b.status = 'active'
       AND a.evidence_expires_at > $2`,
    [raterId, now],
  );
  return {
    raterId,
    assertions: assertions.rows.map(value => {
      const assertion = value as QueryRow;
      return {
        assertionId: rowString(assertion, "assertion_id")!,
        bindingId: rowString(assertion, "binding_id")!,
        providerId: rowString(assertion, "provider_id")!,
        providerNamespace: rowString(assertion, "provider_namespace")!,
        subjectReferenceHash: rowString(assertion, "subject_reference_hash")!,
        capabilities: parseJson<string[]>(assertion.capabilities_json, "assurance capabilities").sort(),
        verifiedAt: rowDate(assertion, "evidence_verified_at")!.toISOString(),
        expiresAt: rowDate(assertion, "evidence_expires_at")!.toISOString(),
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
    const reviewerResult = await client.query(
      `SELECT cr.* FROM tokenless_assurance_cohort_reviewers cr
       WHERE cr.project_id = $1 AND cr.cohort_id = $2 AND cr.status = 'active'
         AND cr.active_reservations < cr.maximum_active_assignments
         AND (cr.qualification_expires_at IS NULL OR cr.qualification_expires_at > $3)
         ${namedReviewer ? "AND cr.reviewer_account_address = $4" : ""}
       FOR UPDATE`,
      namedReviewer
        ? [input.projectId, rowString(subpanel, "cohort_id"), now, namedReviewer]
        : [input.projectId, rowString(subpanel, "cohort_id"), now],
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
      capturedAt: now.toISOString(),
    };
    const assuranceSnapshotJson = canonicalJson(assuranceSnapshot);
    const assuranceSnapshotHash = `sha256:${hashToken(assuranceSnapshotJson)}`;
    await client.query(
      `INSERT INTO tokenless_assurance_assignments
       (assignment_id, workspace_id, project_id, run_id, subpanel_id, cohort_id,
        reviewer_account_address, source, selection, status, confidentiality_terms_hash,
        qualification_provenance_json, assurance_snapshot_json, assurance_snapshot_hash,
        blinding_json, paid_assignment,
        paid_eligibility_checked_at, voucher_marker, reservation_expires_at,
        lease_issuer_account_address, lease_state, recovery_count, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'reserved', $10, $11, $12, $13, $14,
               $15, $16, NULL, $17, $18, 'pending', 0, $19, $19)`,
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
      reviewerAccountAddress,
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
                 r.status AS run_status, r.manifest_hash AS current_run_manifest_hash,
                 r.policy_hash AS current_policy_hash, sp.run_manifest_hash, sp.policy_hash,
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

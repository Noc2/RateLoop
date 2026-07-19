import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { isRateLoopPrincipalId, normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbPool } from "~~/lib/db";
import {
  expertiseQualificationRules,
  qualificationProvenanceSatisfiesExpertise,
} from "~~/lib/tokenless/reviewerExpertise";
import {
  type PrivateReviewerExpertiseRequirement,
  exactReviewerExpertiseDefinitionKey,
} from "~~/lib/tokenless/reviewerExpertiseAssignments";
import {
  type ExpertiseCoverageCandidate,
  chooseExpertiseCoveredPanel,
} from "~~/lib/tokenless/reviewerExpertiseCoverage";
import { normalizeReviewerExpertiseRequirementsSelection } from "~~/lib/tokenless/reviewerExpertiseOptions";
import {
  type ReviewerExpertiseKey,
  normalizeReviewerExpertiseKeys,
} from "~~/lib/tokenless/reviewerExpertiseVocabulary";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;

export type WorkspacePrivateReviewRoutingReadinessReason =
  | "ready"
  | "reviewer_seats_insufficient"
  | "expertise_coverage_insufficient"
  | "cohort_capacity_insufficient"
  | "prior_managed_cohort_busy";

export type WorkspacePrivateReviewRoutingReadiness = {
  schemaVersion: "rateloop.workspace-private-review-routing-readiness.v1";
  ready: boolean;
  reason: WorkspacePrivateReviewRoutingReadinessReason;
  projectId: string;
  cohortId: string;
  privateGroupId: string;
  panelSize: number;
  syncedReviewerCount: number;
  eligibleReviewerCount: number;
  selectedReviewerCount: number;
  availableCapacity: number;
  responseDeadline: string;
};

type Member = {
  accountAddress: string;
  createdBy: string;
  joinedAt: Date;
  membershipExpiresAt: Date | null;
  provenance: Array<Record<string, unknown>>;
};

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const POSITIVE_ATOMIC_PATTERN = /^[1-9][0-9]*$/u;
const MANAGED_PROJECT_NAME = "Agent private reviews";
const MANAGED_PROJECT_DESCRIPTION = "RateLoop-managed private review routing foundation.";
const MANAGED_COHORT_NAME = "Invited reviewers";
const MANAGED_RETENTION_DAYS = 30;

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function integer(row: Row | undefined, key: string) {
  const value = Number(row?.[key]);
  if (!Number.isSafeInteger(value)) throw new Error(`Stored ${key} is invalid.`);
  return value;
}

function date(value: unknown, field: string) {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) throw new Error(`Stored ${field} is invalid.`);
  return parsed;
}

function optionalDate(value: unknown, field: string) {
  return value === null || value === undefined ? null : date(value, field);
}

function json<T>(value: unknown, field: string): T {
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    throw new Error(`Stored ${field} is invalid.`);
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Private review routing data is not JSON serializable.");
  return encoded;
}

function deterministicId(prefix: "hap_setup" | "hacoh_setup" | "paccess_setup", values: readonly unknown[]) {
  const suffix = createHash("sha256").update(stableJson(values)).digest("hex").slice(0, 40);
  return `${prefix}_${suffix}`;
}

function managedProjectId(input: {
  workspaceId: string;
  profileId: string;
  profileVersion: number;
  profileHash: string;
}) {
  return deterministicId("hap_setup", [
    "rateloop.workspace-private-review-project.v1",
    input.workspaceId,
    input.profileId,
    input.profileVersion,
    input.profileHash,
  ]);
}

function managedCohortId(input: { projectId: string; profileHash: string; privateGroupId: string }) {
  return deterministicId("hacoh_setup", [
    "rateloop.workspace-private-review-cohort.v1",
    input.projectId,
    input.profileHash,
    input.privateGroupId,
  ]);
}

function normalizeActor(value: string) {
  try {
    return normalizeAccountSubject(value);
  } catch {
    throw new TokenlessServiceError("A valid signed-in account is required.", 401, "invalid_account");
  }
}

function requiredProfileVersion(value: number) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TokenlessServiceError("Review profile version is invalid.", 400, "invalid_review_request_profile");
  }
  return value;
}

function requiredProfileHash(value: string) {
  if (!HASH_PATTERN.test(value)) {
    throw new TokenlessServiceError("Review profile hash is invalid.", 400, "invalid_review_request_profile");
  }
  return value;
}

async function loadProfile(
  client: PoolClient,
  input: {
    actor: string;
    workspaceId: string;
    profileId: string;
    profileVersion: number;
    profileHash: string;
  },
) {
  const result = await client.query(
    `SELECT r.*,g.current_policy_version,g.status AS group_status,
            gp.policy_json,gp.allowed_project_ids_json,gp.data_classifications_json,gp.policy_hash AS group_policy_hash
     FROM tokenless_agent_review_request_profiles r
     JOIN tokenless_workspaces w ON w.workspace_id=r.workspace_id AND w.status='active'
     JOIN tokenless_workspace_members wm
       ON wm.workspace_id=r.workspace_id AND wm.account_address=$1 AND wm.role IN ('owner','admin')
     JOIN tokenless_private_groups g
       ON g.workspace_id=r.workspace_id AND g.group_id=r.private_group_id
     JOIN tokenless_private_group_policy_versions gp
       ON gp.group_id=g.group_id AND gp.version=r.private_group_policy_version
      AND gp.policy_hash=r.private_group_policy_hash
     WHERE r.workspace_id=$2 AND r.profile_id=$3 AND r.version=$4 AND r.profile_hash=$5
       AND r.configuration_status='ready' AND r.approved_at IS NOT NULL AND r.superseded_at IS NULL
     LIMIT 1 FOR UPDATE`,
    [input.actor, input.workspaceId, input.profileId, input.profileVersion, input.profileHash],
  );
  const row = result.rows[0] as Row | undefined;
  if (!row) {
    throw new TokenlessServiceError(
      "The exact private review profile is unavailable.",
      404,
      "private_review_profile_unavailable",
    );
  }
  const compensationMode = text(row, "compensation_mode");
  const bountyPerSeatAtomic =
    row.bounty_per_seat_atomic === null || row.bounty_per_seat_atomic === undefined
      ? null
      : String(row.bounty_per_seat_atomic);
  if (
    text(row, "audience") !== "private_invited" ||
    text(row, "content_boundary") !== "private_workspace" ||
    !(
      (compensationMode === "unpaid" && bountyPerSeatAtomic === null) ||
      (compensationMode === "usdc" && bountyPerSeatAtomic !== null && POSITIVE_ATOMIC_PATTERN.test(bountyPerSeatAtomic))
    ) ||
    text(row, "group_status") !== "active" ||
    integer(row, "current_policy_version") !== integer(row, "private_group_policy_version") ||
    text(row, "group_policy_hash") !== text(row, "private_group_policy_hash")
  ) {
    throw new TokenlessServiceError(
      "The exact private review profile or reviewer-group policy is no longer active.",
      409,
      "private_review_profile_not_active",
    );
  }
  const sensitivity = text(row, "private_sensitivity");
  if (!sensitivity || !["internal", "confidential", "restricted", "regulated"].includes(sensitivity)) {
    throw new Error("Stored private review sensitivity is invalid.");
  }
  const panelSize = integer(row, "panel_size");
  const responseWindowSeconds = integer(row, "response_window_seconds");
  const requiredExpertiseKeys = normalizeReviewerExpertiseKeys(
    json(row.required_expertise_keys_json, "expertise keys"),
  );
  const expertiseRequirements = normalizeReviewerExpertiseRequirementsSelection(
    json(row.expertise_requirements_json, "expertise requirements"),
    panelSize,
  );
  if (expertiseRequirements.some(requirement => requirement.sourceScope !== "customer_invited")) {
    throw new Error("Stored private review expertise scope is invalid.");
  }
  const groupPolicy = json<{ worldIdRequired?: unknown }>(row.policy_json, "private-group policy");
  if (typeof groupPolicy.worldIdRequired !== "boolean") {
    throw new Error("Stored private-group human-verification policy is invalid.");
  }
  return {
    sensitivity,
    panelSize,
    responseWindowSeconds,
    requiredExpertiseKeys,
    expertiseRequirements: expertiseRequirements as PrivateReviewerExpertiseRequirement[],
    privateGroupId: text(row, "private_group_id")!,
    groupPolicy,
    groupAllowedProjectIds: json<string[]>(row.allowed_project_ids_json, "private-group project IDs"),
    groupDataClassifications: json<string[]>(row.data_classifications_json, "private-group classifications"),
  };
}

async function ensureManagedProject(
  client: PoolClient,
  input: {
    actor: string;
    workspaceId: string;
    profileId: string;
    profileVersion: number;
    profileHash: string;
    sensitivity: string;
    now: Date;
  },
) {
  const projectId = managedProjectId(input);
  await client.query(
    `INSERT INTO tokenless_assurance_projects
     (project_id,workspace_id,name,description,data_classification,visibility,material_kind,private_sensitivity,
      home_region,retention_policy_id,legal_hold_state,data_use_policy_version,status,retention_days,
      created_by,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,'private',NULL,$5,'eu','retention-default-v1','none','data-use-v1',
             'active',$6,$7,$8,$8)
     ON CONFLICT (project_id) DO NOTHING`,
    [
      projectId,
      input.workspaceId,
      MANAGED_PROJECT_NAME,
      MANAGED_PROJECT_DESCRIPTION,
      input.sensitivity,
      MANAGED_RETENTION_DAYS,
      input.actor,
      input.now,
    ],
  );
  const stored = await client.query(
    `SELECT workspace_id,name,description,data_classification,visibility,material_kind,private_sensitivity,
            retention_days,status
     FROM tokenless_assurance_projects WHERE project_id=$1 LIMIT 1 FOR UPDATE`,
    [projectId],
  );
  const row = stored.rows[0] as Row | undefined;
  if (
    !row ||
    text(row, "workspace_id") !== input.workspaceId ||
    text(row, "name") !== MANAGED_PROJECT_NAME ||
    text(row, "description") !== MANAGED_PROJECT_DESCRIPTION ||
    text(row, "data_classification") !== input.sensitivity ||
    text(row, "visibility") !== "private" ||
    row.material_kind !== null ||
    text(row, "private_sensitivity") !== input.sensitivity ||
    integer(row, "retention_days") !== MANAGED_RETENTION_DAYS ||
    text(row, "status") !== "active"
  ) {
    throw new TokenlessServiceError(
      "The managed private review project conflicts with another resource.",
      409,
      "private_review_project_conflict",
    );
  }
  const subjectKind = isRateLoopPrincipalId(input.actor) ? "principal" : "account";
  const assignmentId = deterministicId("paccess_setup", [projectId, subjectKind, input.actor]);
  await client.query(
    `INSERT INTO tokenless_project_access_assignments
     (assignment_id,workspace_id,project_id,subject_kind,subject_reference,role,status,
      expires_at,granted_by,reason,created_at)
     VALUES ($1,$2,$3,$4,$5,'admin','active',NULL,$6,'workspace_agent_setup',$7)
     ON CONFLICT DO NOTHING`,
    [assignmentId, input.workspaceId, projectId, subjectKind, input.actor, input.actor, input.now],
  );
  return projectId;
}

async function ensureManagedCohort(
  client: PoolClient,
  input: {
    actor: string;
    projectId: string;
    profileHash: string;
    privateGroupId: string;
    panelSize: number;
    qualificationRules: unknown[];
    now: Date;
  },
) {
  const cohortId = managedCohortId(input);
  const qualificationRulesJson = stableJson(input.qualificationRules);
  await client.query(
    `INSERT INTO tokenless_assurance_cohorts
     (cohort_id,project_id,name,source,selection,capacity,active_reservations,private_group_id,
      qualification_rules_json,status,created_by,created_at,updated_at)
     VALUES ($1,$2,$3,'customer_invited','customer_named',$4,0,$5,$6,'active',$7,$8,$8)
     ON CONFLICT (cohort_id) DO NOTHING`,
    [
      cohortId,
      input.projectId,
      MANAGED_COHORT_NAME,
      input.panelSize,
      input.privateGroupId,
      qualificationRulesJson,
      input.actor,
      input.now,
    ],
  );
  const stored = await client.query(
    `SELECT project_id,name,source,selection,capacity,active_reservations,private_group_id,
            qualification_rules_json,status
     FROM tokenless_assurance_cohorts WHERE cohort_id=$1 LIMIT 1 FOR UPDATE`,
    [cohortId],
  );
  const row = stored.rows[0] as Row | undefined;
  if (
    !row ||
    text(row, "project_id") !== input.projectId ||
    text(row, "name") !== MANAGED_COHORT_NAME ||
    text(row, "source") !== "customer_invited" ||
    text(row, "selection") !== "customer_named" ||
    integer(row, "capacity") !== input.panelSize ||
    text(row, "private_group_id") !== input.privateGroupId ||
    stableJson(json(row.qualification_rules_json, "cohort qualification rules")) !== qualificationRulesJson ||
    text(row, "status") !== "active"
  ) {
    throw new TokenlessServiceError(
      "The managed private reviewer cohort conflicts with another resource.",
      409,
      "private_review_cohort_conflict",
    );
  }
  return { cohortId, activeReservations: integer(row, "active_reservations") };
}

async function reconcilePriorManagedRouting(
  client: PoolClient,
  input: {
    workspaceId: string;
    privateGroupId: string;
    currentProjectId: string;
    currentCohortId: string;
    now: Date;
  },
) {
  const prior = await client.query(
    `SELECT p.project_id,c.cohort_id,c.active_reservations
     FROM tokenless_assurance_projects p
     JOIN tokenless_assurance_cohorts c ON c.project_id=p.project_id
     WHERE p.workspace_id=$1 AND c.private_group_id=$2
       AND NOT (p.project_id=$3 AND c.cohort_id=$4)
       AND p.project_id LIKE 'hap_setup_%' AND c.cohort_id LIKE 'hacoh_setup_%'
       AND p.name=$5 AND p.description=$6 AND c.name=$7
       AND c.source='customer_invited' AND c.selection='customer_named'
       AND p.status='active' AND c.status='active'
     ORDER BY p.project_id,c.cohort_id
     FOR UPDATE`,
    [
      input.workspaceId,
      input.privateGroupId,
      input.currentProjectId,
      input.currentCohortId,
      MANAGED_PROJECT_NAME,
      MANAGED_PROJECT_DESCRIPTION,
      MANAGED_COHORT_NAME,
    ],
  );
  const safe: Array<{ projectId: string; cohortId: string }> = [];
  for (const value of prior.rows as Row[]) {
    const projectId = text(value, "project_id");
    const cohortId = text(value, "cohort_id");
    if (!projectId || !cohortId) throw new Error("Stored managed private routing resource is invalid.");
    const reviewerReservations = await client.query(
      `SELECT COALESCE(SUM(active_reservations),0) AS reservations
       FROM tokenless_assurance_cohort_reviewers
       WHERE project_id=$1 AND cohort_id=$2`,
      [projectId, cohortId],
    );
    const liveAssignments = await client.query(
      `SELECT COUNT(*) AS assignments FROM tokenless_assurance_assignments
       WHERE project_id=$1 AND cohort_id=$2 AND status IN ('reserved','accepted')`,
      [projectId, cohortId],
    );
    if (
      integer(value, "active_reservations") > 0 ||
      integer(reviewerReservations.rows[0] as Row | undefined, "reservations") > 0 ||
      integer(liveAssignments.rows[0] as Row | undefined, "assignments") > 0
    ) {
      return { ready: false as const };
    }
    safe.push({ projectId, cohortId });
  }
  for (const resource of safe) {
    await client.query(
      `UPDATE tokenless_assurance_cohort_reviewers
       SET status='inactive',updated_at=$1
       WHERE project_id=$2 AND cohort_id=$3`,
      [input.now, resource.projectId, resource.cohortId],
    );
    await client.query(
      `UPDATE tokenless_assurance_cohorts
       SET status='archived',updated_at=$1
       WHERE project_id=$2 AND cohort_id=$3 AND status='active' AND active_reservations=0`,
      [input.now, resource.projectId, resource.cohortId],
    );
    await client.query(
      `UPDATE tokenless_assurance_projects
       SET status='archived',updated_at=$1
       WHERE project_id=$2 AND status='active'
         AND NOT EXISTS (
           SELECT 1 FROM tokenless_assurance_cohorts
           WHERE project_id=$2 AND status='active'
         )`,
      [input.now, resource.projectId],
    );
  }
  return { ready: true as const };
}

async function loadMembers(
  client: PoolClient,
  input: {
    workspaceId: string;
    privateGroupId: string;
    projectId: string;
    worldIdRequired: boolean;
    now: Date;
  },
) {
  const result = await client.query(
    `SELECT m.principal_address,m.allowed_project_ids_json,m.membership_expires_at,m.joined_at,
            m.created_by,m.source_invitation_id
     FROM tokenless_private_group_memberships m
     JOIN tokenless_private_group_invitations i
       ON i.invitation_id=m.source_invitation_id AND i.workspace_id=$1 AND i.group_id=m.group_id
     JOIN tokenless_private_group_invitation_redemptions r
       ON r.invitation_id=i.invitation_id AND r.group_id=m.group_id AND r.principal_address=m.principal_address
     WHERE m.group_id=$2 AND m.status='active' AND m.joined_at<=$3
       AND (m.membership_expires_at IS NULL OR m.membership_expires_at>$3)
     ORDER BY m.principal_address
     FOR SHARE`,
    [input.workspaceId, input.privateGroupId, input.now],
  );
  const members: Member[] = [];
  for (const value of result.rows as Row[]) {
    const accountAddress = text(value, "principal_address");
    const sourceInvitationId = text(value, "source_invitation_id");
    const createdBy = text(value, "created_by");
    if (!accountAddress || !sourceInvitationId || !createdBy)
      throw new Error("Stored private group membership is invalid.");
    const allowedProjectIds = json<string[]>(value.allowed_project_ids_json, "membership project IDs");
    if (allowedProjectIds.length > 0 && !allowedProjectIds.includes(input.projectId)) continue;
    if (input.worldIdRequired) {
      const worldId = await client.query(
        `SELECT a.assertion_id FROM tokenless_rater_profiles p
         JOIN tokenless_provider_subject_bindings b ON b.rater_id=p.rater_id
         JOIN tokenless_assurance_assertions a ON a.binding_id=b.binding_id
         WHERE p.account_address=$1 AND b.provider_id='world:poh' AND b.status='active'
           AND a.status='active' AND a.assurance_validity_model='durable_enrollment'
           AND a.capabilities_json LIKE '%"unique_human"%' LIMIT 1`,
        [accountAddress],
      );
      if (worldId.rowCount !== 1) continue;
    }
    const joinedAt = date(value.joined_at, "membership joined at");
    const membershipExpiresAt = optionalDate(value.membership_expires_at, "membership expiry");
    const provenance: Array<Record<string, unknown>> = [
      {
        key: "customer_invitation",
        value: true,
        source: "private_group_membership",
        assertedBy: createdBy,
        verifiedAt: joinedAt.toISOString(),
        ...(membershipExpiresAt ? { expiresAt: membershipExpiresAt.toISOString() } : {}),
      },
      {
        key: "private_group_membership",
        value: input.privateGroupId,
        source: "private_group_membership",
        assertedBy: createdBy,
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
         AND (expertise_record_schema_version<>2 OR source_invitation_id=$4)
       ORDER BY expertise_record_schema_version,expertise_definition_id`,
      [input.workspaceId, accountAddress, input.now, sourceInvitationId],
    );
    for (const qualification of qualifications.rows as Row[]) {
      const verifiedAt = date(qualification.verified_at, "expertise verification time");
      const expiresAt = date(qualification.expires_at, "expertise expiry");
      const schemaVersion = integer(qualification, "expertise_record_schema_version");
      let keys: string[];
      if (schemaVersion === 2) {
        const definitionId = text(qualification, "expertise_definition_id");
        const definitionVersion = integer(qualification, "expertise_definition_version");
        const definitionHash = text(qualification, "expertise_definition_hash");
        if (!definitionId || definitionVersion < 1 || !definitionHash || !HASH_PATTERN.test(definitionHash)) {
          throw new Error("Stored exact reviewer expertise qualification is invalid.");
        }
        keys = [
          exactReviewerExpertiseDefinitionKey({
            definitionId,
            definitionVersion,
            definitionHash: definitionHash as `sha256:${string}`,
          }),
        ];
      } else if (schemaVersion === 1) {
        keys = json<string[]>(qualification.qualification_keys_json, "expertise qualification keys");
      } else {
        throw new Error("Stored reviewer expertise qualification schema is invalid.");
      }
      for (const key of keys) {
        provenance.push({
          key,
          value: true,
          source: text(qualification, "evidence_kind") ?? "owner_attested",
          assertedBy: text(qualification, "asserted_by") ?? "workspace_owner",
          verifiedAt: verifiedAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
          evidenceReferenceHash: text(qualification, "evidence_reference_hash"),
        });
      }
    }
    provenance.sort((left, right) => String(left.key).localeCompare(String(right.key)));
    members.push({
      accountAddress,
      createdBy,
      joinedAt,
      membershipExpiresAt,
      provenance,
    });
  }
  return members;
}

async function syncMembers(
  client: PoolClient,
  input: {
    actor: string;
    projectId: string;
    cohortId: string;
    members: readonly Member[];
    now: Date;
  },
) {
  await client.query(
    `UPDATE tokenless_assurance_cohort_reviewers
     SET status='inactive',updated_at=$1
     WHERE project_id=$2 AND cohort_id=$3 AND active_reservations=0`,
    [input.now, input.projectId, input.cohortId],
  );
  for (const member of input.members) {
    await client.query(
      `INSERT INTO tokenless_assurance_cohort_reviewers
       (project_id,cohort_id,reviewer_account_address,qualification_provenance_json,
        qualification_expires_at,maximum_active_assignments,active_reservations,status,
        created_by,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,1,0,'inactive',$6,$7,$8)
       ON CONFLICT (project_id,cohort_id,reviewer_account_address) DO UPDATE SET
         qualification_provenance_json=EXCLUDED.qualification_provenance_json,
         qualification_expires_at=EXCLUDED.qualification_expires_at,
         status=CASE
           WHEN tokenless_assurance_cohort_reviewers.active_reservations>0
             THEN tokenless_assurance_cohort_reviewers.status
           ELSE 'inactive'
         END,
         updated_at=EXCLUDED.updated_at`,
      [
        input.projectId,
        input.cohortId,
        member.accountAddress,
        stableJson(member.provenance),
        member.membershipExpiresAt,
        member.createdBy || input.actor,
        member.joinedAt,
        input.now,
      ],
    );
  }
}

async function availableMemberAddresses(
  client: PoolClient,
  input: { projectId: string; cohortId: string; members: readonly Member[] },
) {
  if (input.members.length === 0) return new Set<string>();
  const result = await client.query(
    `SELECT reviewer_account_address FROM tokenless_assurance_cohort_reviewers
     WHERE project_id=$1 AND cohort_id=$2 AND active_reservations<maximum_active_assignments`,
    [input.projectId, input.cohortId],
  );
  return new Set((result.rows as Row[]).map(row => text(row, "reviewer_account_address")!).filter(Boolean));
}

function exactPanel(input: {
  members: readonly Member[];
  panelSize: number;
  requiredExpertiseKeys: readonly ReviewerExpertiseKey[];
  expertiseRequirements: readonly PrivateReviewerExpertiseRequirement[];
  responseDeadline: Date;
}) {
  const throughDeadline = input.members.filter(
    member => !member.membershipExpiresAt || member.membershipExpiresAt > input.responseDeadline,
  );
  if (throughDeadline.length < input.panelSize) {
    return {
      reason: "reviewer_seats_insufficient" as const,
      selected: [] as string[],
      eligible: throughDeadline.length,
    };
  }
  const legacyQualified = throughDeadline.filter(member =>
    qualificationProvenanceSatisfiesExpertise(
      stableJson(member.provenance),
      input.requiredExpertiseKeys,
      input.responseDeadline,
    ),
  );
  if (legacyQualified.length < input.panelSize) {
    return {
      reason: "expertise_coverage_insufficient" as const,
      selected: [] as string[],
      eligible: throughDeadline.length,
    };
  }
  let selected: string[] | null;
  if (input.expertiseRequirements.length > 0) {
    const candidates: ExpertiseCoverageCandidate[] = legacyQualified.map(member => ({
      id: member.accountAddress,
      expertiseKeys: member.provenance.flatMap(value => {
        const key = typeof value.key === "string" ? value.key : null;
        const expiresAt = value.expiresAt ? new Date(String(value.expiresAt)) : null;
        return key?.startsWith("expertise:") &&
          value.value === true &&
          expiresAt !== null &&
          Number.isFinite(expiresAt.getTime()) &&
          expiresAt >= input.responseDeadline
          ? [key]
          : [];
      }),
    }));
    selected = chooseExpertiseCoveredPanel(
      candidates,
      input.panelSize,
      input.expertiseRequirements.map(requirement => ({
        key: exactReviewerExpertiseDefinitionKey(requirement),
        minimumSeats: requirement.minimumSeats,
      })),
    );
  } else {
    selected = legacyQualified
      .map(member => member.accountAddress)
      .sort()
      .slice(0, input.panelSize);
  }
  return selected
    ? { reason: "ready" as const, selected, eligible: throughDeadline.length }
    : {
        reason: "expertise_coverage_insufficient" as const,
        selected: [] as string[],
        eligible: throughDeadline.length,
      };
}

export async function provisionWorkspacePrivateReviewRouting(input: {
  accountAddress: string;
  workspaceId: string;
  profileId: string;
  profileVersion: number;
  profileHash: string;
  now?: Date;
}): Promise<WorkspacePrivateReviewRoutingReadiness> {
  const actor = normalizeActor(input.accountAddress);
  const profileVersion = requiredProfileVersion(input.profileVersion);
  const profileHash = requiredProfileHash(input.profileHash);
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new TokenlessServiceError("Routing time is invalid.", 400, "invalid_review_request_profile");
  }
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const profile = await loadProfile(client, {
      actor,
      workspaceId: input.workspaceId,
      profileId: input.profileId,
      profileVersion,
      profileHash,
    });
    const currentProjectId = managedProjectId({
      workspaceId: input.workspaceId,
      profileId: input.profileId,
      profileVersion,
      profileHash,
    });
    const currentCohortId = managedCohortId({
      projectId: currentProjectId,
      profileHash,
      privateGroupId: profile.privateGroupId,
    });
    const responseDeadline = new Date(now.getTime() + profile.responseWindowSeconds * 1_000);
    const reconciled = await reconcilePriorManagedRouting(client, {
      workspaceId: input.workspaceId,
      privateGroupId: profile.privateGroupId,
      currentProjectId,
      currentCohortId,
      now,
    });
    if (!reconciled.ready) {
      await client.query("COMMIT");
      return {
        schemaVersion: "rateloop.workspace-private-review-routing-readiness.v1",
        ready: false,
        reason: "prior_managed_cohort_busy",
        projectId: currentProjectId,
        cohortId: currentCohortId,
        privateGroupId: profile.privateGroupId,
        panelSize: profile.panelSize,
        syncedReviewerCount: 0,
        eligibleReviewerCount: 0,
        selectedReviewerCount: 0,
        availableCapacity: 0,
        responseDeadline: responseDeadline.toISOString(),
      };
    }
    const projectId = await ensureManagedProject(client, {
      actor,
      workspaceId: input.workspaceId,
      profileId: input.profileId,
      profileVersion,
      profileHash,
      sensitivity: profile.sensitivity,
      now,
    });
    if (projectId !== currentProjectId) throw new Error("Managed private review project derivation changed.");
    if (
      !profile.groupDataClassifications.includes(profile.sensitivity) ||
      (profile.groupAllowedProjectIds.length > 0 && !profile.groupAllowedProjectIds.includes(projectId))
    ) {
      throw new TokenlessServiceError(
        "The frozen reviewer-group policy does not allow the managed private review project.",
        409,
        "private_review_project_not_allowed",
      );
    }
    const qualificationRules = expertiseQualificationRules(profile.requiredExpertiseKeys);
    const cohort = await ensureManagedCohort(client, {
      actor,
      projectId,
      profileHash,
      privateGroupId: profile.privateGroupId,
      panelSize: profile.panelSize,
      qualificationRules,
      now,
    });
    if (cohort.cohortId !== currentCohortId) throw new Error("Managed private reviewer cohort derivation changed.");
    const members = await loadMembers(client, {
      workspaceId: input.workspaceId,
      privateGroupId: profile.privateGroupId,
      projectId,
      worldIdRequired: profile.groupPolicy.worldIdRequired === true,
      now,
    });
    await syncMembers(client, { actor, projectId, cohortId: cohort.cohortId, members, now });
    const availableAddresses = await availableMemberAddresses(client, {
      projectId,
      cohortId: cohort.cohortId,
      members,
    });
    const availableMembers = members.filter(member => availableAddresses.has(member.accountAddress));
    const panel = exactPanel({
      members: availableMembers,
      panelSize: profile.panelSize,
      requiredExpertiseKeys: profile.requiredExpertiseKeys,
      expertiseRequirements: profile.expertiseRequirements,
      responseDeadline,
    });
    const availableCapacity = Math.max(0, profile.panelSize - cohort.activeReservations);
    const reason: WorkspacePrivateReviewRoutingReadinessReason =
      panel.reason !== "ready"
        ? panel.reason
        : availableCapacity < profile.panelSize
          ? "cohort_capacity_insufficient"
          : "ready";
    const selected = reason === "ready" ? panel.selected : [];
    if (selected.length > 0) {
      const activated = await client.query(
        `UPDATE tokenless_assurance_cohort_reviewers
         SET status='active',updated_at=$1
         WHERE project_id=$2 AND cohort_id=$3 AND reviewer_account_address=ANY($4::text[])
           AND active_reservations<maximum_active_assignments`,
        [now, projectId, cohort.cohortId, selected],
      );
      if (activated.rowCount !== selected.length) {
        throw new TokenlessServiceError(
          "The exact reviewer panel changed while routing was prepared.",
          409,
          "private_review_panel_conflict",
        );
      }
    }
    const active = await client.query(
      `SELECT reviewer_account_address FROM tokenless_assurance_cohort_reviewers
       WHERE project_id=$1 AND cohort_id=$2 AND status='active'
       ORDER BY reviewer_account_address`,
      [projectId, cohort.cohortId],
    );
    const activeAddresses = (active.rows as Row[]).map(row => text(row, "reviewer_account_address")!).filter(Boolean);
    const exactActivePanel =
      reason === "ready" &&
      activeAddresses.length === selected.length &&
      activeAddresses.every((value, index) => value === [...selected].sort()[index]);
    const resultReason = exactActivePanel ? "ready" : reason === "ready" ? "cohort_capacity_insufficient" : reason;
    await client.query("COMMIT");
    return {
      schemaVersion: "rateloop.workspace-private-review-routing-readiness.v1",
      ready: resultReason === "ready",
      reason: resultReason,
      projectId,
      cohortId: cohort.cohortId,
      privateGroupId: profile.privateGroupId,
      panelSize: profile.panelSize,
      syncedReviewerCount: members.length,
      eligibleReviewerCount: panel.eligible,
      selectedReviewerCount: resultReason === "ready" ? selected.length : 0,
      availableCapacity,
      responseDeadline: responseDeadline.toISOString(),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

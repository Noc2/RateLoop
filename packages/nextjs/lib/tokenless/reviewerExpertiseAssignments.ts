import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbPool } from "~~/lib/db";
import {
  type ReviewerExpertiseRequirement,
  normalizeReviewerExpertiseRequirementsSelection,
} from "~~/lib/tokenless/reviewerExpertiseOptions";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;

export type ExactReviewerExpertiseDefinition = {
  definitionId: string;
  definitionVersion: number;
  definitionHash: `sha256:${string}`;
};

export type PrivateReviewerExpertiseRequirement = ExactReviewerExpertiseDefinition & {
  minimumSeats: number;
  sourceScope: "customer_invited";
};

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const DEFINITION_ID_PATTERN = /^expd_[a-z0-9_]{3,120}$/u;
const MAXIMUM_DEFINITIONS = 8;

function maximumExpertiseExpiry(now: Date) {
  const targetYear = now.getUTCFullYear() + 2;
  const targetMonth = now.getUTCMonth();
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      Math.min(now.getUTCDate(), lastDay),
      now.getUTCHours(),
      now.getUTCMinutes(),
      now.getUTCSeconds(),
      now.getUTCMilliseconds(),
    ),
  );
}

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function integer(row: Row | undefined, key: string) {
  const value = Number(row?.[key]);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Stored ${key} is invalid.`);
  return value;
}

function date(value: unknown, field: string) {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) throw new Error(`Stored ${field} is invalid.`);
  return parsed;
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
  if (encoded === undefined) throw new Error("Expertise assignment is not JSON serializable.");
  return encoded;
}

function sha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function account(value: string, field: string) {
  try {
    return normalizeAccountSubject(value);
  } catch {
    throw new TokenlessServiceError(`${field} is invalid.`, 400, "invalid_account");
  }
}

function parseFutureDate(value: unknown, field: string, now: Date) {
  const parsed = value instanceof Date ? value : typeof value === "string" ? new Date(value) : new Date(Number.NaN);
  if (!Number.isFinite(parsed.getTime()) || parsed <= now) {
    throw new TokenlessServiceError(`${field} must be in the future.`, 400, "invalid_reviewer_expertise");
  }
  return parsed;
}

function normalizeDefinitionReferences(value: unknown): ExactReviewerExpertiseDefinition[] {
  if (!Array.isArray(value) || value.length > MAXIMUM_DEFINITIONS) {
    throw new TokenlessServiceError(
      `Choose at most ${MAXIMUM_DEFINITIONS} specialist areas.`,
      400,
      "invalid_reviewer_expertise",
    );
  }
  const definitions = value.map(entry => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new TokenlessServiceError("Specialist area is invalid.", 400, "invalid_reviewer_expertise");
    }
    const candidate = entry as Record<string, unknown>;
    if (
      typeof candidate.definitionId !== "string" ||
      !DEFINITION_ID_PATTERN.test(candidate.definitionId) ||
      !Number.isSafeInteger(candidate.definitionVersion) ||
      Number(candidate.definitionVersion) < 1 ||
      Number(candidate.definitionVersion) > 2_147_483_647 ||
      typeof candidate.definitionHash !== "string" ||
      !HASH_PATTERN.test(candidate.definitionHash)
    ) {
      throw new TokenlessServiceError("Specialist area is invalid.", 400, "invalid_reviewer_expertise");
    }
    return {
      definitionId: candidate.definitionId,
      definitionVersion: Number(candidate.definitionVersion),
      definitionHash: candidate.definitionHash as `sha256:${string}`,
    };
  });
  definitions.sort((left, right) => {
    const id = left.definitionId.localeCompare(right.definitionId);
    return (
      id || left.definitionVersion - right.definitionVersion || left.definitionHash.localeCompare(right.definitionHash)
    );
  });
  if (
    definitions.some(
      (definition, index) => index > 0 && definitions[index - 1]!.definitionId === definition.definitionId,
    )
  ) {
    throw new TokenlessServiceError(
      "Each specialist area can be assigned only once.",
      400,
      "invalid_reviewer_expertise",
    );
  }
  return definitions;
}

function normalizeRequirements(value: unknown): PrivateReviewerExpertiseRequirement[] {
  const definitions = normalizeDefinitionReferences(value);
  return definitions.map((definition, index) => {
    const candidate = (value as Array<Record<string, unknown>>).find(
      entry => entry.definitionId === definition.definitionId,
    )!;
    if (
      !Number.isSafeInteger(candidate.minimumSeats) ||
      Number(candidate.minimumSeats) < 1 ||
      Number(candidate.minimumSeats) > 100 ||
      candidate.sourceScope !== "customer_invited"
    ) {
      throw new TokenlessServiceError(
        `Specialist requirement ${index + 1} is invalid for invited reviewers.`,
        400,
        "invalid_reviewer_expertise",
      );
    }
    return {
      ...definition,
      minimumSeats: Number(candidate.minimumSeats),
      sourceScope: "customer_invited" as const,
    };
  });
}

export function exactReviewerExpertiseDefinitionKey(definition: ExactReviewerExpertiseDefinition) {
  return `expertise:${definition.definitionId}:v${definition.definitionVersion}:${definition.definitionHash}`;
}

async function requireManager(client: PoolClient, actor: string, workspaceId: string, groupId: string) {
  const result = await client.query(
    `SELECT g.group_id
     FROM tokenless_private_groups g
     JOIN tokenless_workspaces w ON w.workspace_id=g.workspace_id AND w.status='active'
     JOIN tokenless_workspace_members m ON m.workspace_id=g.workspace_id
     WHERE g.workspace_id=$1 AND g.group_id=$2 AND g.status='active'
       AND m.account_address=$3 AND m.role IN ('owner','admin')
     LIMIT 1 FOR SHARE`,
    [workspaceId, groupId, actor],
  );
  if (result.rowCount !== 1)
    throw new TokenlessServiceError("Reviewer group not found.", 404, "private_group_not_found");
}

async function loadVisibleDefinitionVersions(
  client: PoolClient,
  workspaceId: string,
  definitions: readonly ExactReviewerExpertiseDefinition[],
  lifecycle: "current" | "historical",
) {
  const rows = new Map<
    string,
    ExactReviewerExpertiseDefinition & { label: string; description: string; scope: "global" | "workspace" }
  >();
  for (const definition of definitions) {
    const result = await client.query(
      `SELECT definition_id,version,definition_hash,label,description,scope
       FROM tokenless_reviewer_expertise_definitions
       WHERE definition_id=$1 AND version=$2 AND definition_hash=$3
         ${lifecycle === "current" ? "AND status='active' AND superseded_at IS NULL" : ""}
         AND (scope='global' OR (scope='workspace' AND workspace_id=$4))
       LIMIT 1${lifecycle === "current" ? " FOR SHARE" : ""}`,
      [definition.definitionId, definition.definitionVersion, definition.definitionHash, workspaceId],
    );
    const row = result.rows[0] as Row | undefined;
    const scope = text(row, "scope");
    if (!row || (scope !== "global" && scope !== "workspace")) {
      throw new TokenlessServiceError(
        "A selected specialist area is unavailable in this workspace.",
        409,
        "reviewer_expertise_definition_unavailable",
      );
    }
    rows.set(definition.definitionId, {
      ...definition,
      label: text(row, "label")!,
      description: text(row, "description")!,
      scope,
    });
  }
  return rows;
}

function currentVisibleDefinitions(
  client: PoolClient,
  workspaceId: string,
  definitions: readonly ExactReviewerExpertiseDefinition[],
) {
  return loadVisibleDefinitionVersions(client, workspaceId, definitions, "current");
}

function resolveVisibleDefinitionVersions(
  client: PoolClient,
  workspaceId: string,
  definitions: readonly ExactReviewerExpertiseDefinition[],
) {
  return loadVisibleDefinitionVersions(client, workspaceId, definitions, "historical");
}

export async function replacePrivateGroupMemberExpertise(input: {
  accountAddress: string;
  workspaceId: string;
  groupId: string;
  reviewerAccountAddress: string;
  definitions: unknown;
  expiresAt: unknown;
  now?: Date;
}) {
  const actor = account(input.accountAddress, "Account address");
  const reviewer = account(input.reviewerAccountAddress, "Reviewer account");
  const definitions = normalizeDefinitionReferences(input.definitions);
  const now = input.now ?? new Date();
  const expiresAt = parseFutureDate(input.expiresAt, "Expertise expiry", now);
  if (expiresAt > maximumExpertiseExpiry(now)) {
    throw new TokenlessServiceError("Expertise expiry must be within two years.", 400, "invalid_reviewer_expertise");
  }

  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await requireManager(client, actor, input.workspaceId, input.groupId);
    const membershipResult = await client.query(
      `SELECT m.membership_expires_at,m.source_invitation_id
       FROM tokenless_private_group_memberships m
       JOIN tokenless_private_group_invitations i
         ON i.invitation_id=m.source_invitation_id AND i.workspace_id=$1 AND i.group_id=m.group_id
       JOIN tokenless_private_group_invitation_redemptions r
         ON r.invitation_id=i.invitation_id AND r.group_id=m.group_id AND r.principal_address=m.principal_address
       WHERE m.group_id=$2 AND m.principal_address=$3 AND m.status='active' AND m.joined_at<=$4
         AND (m.membership_expires_at IS NULL OR m.membership_expires_at>$4)
       LIMIT 1 FOR UPDATE`,
      [input.workspaceId, input.groupId, reviewer, now],
    );
    const membership = membershipResult.rows[0] as Row | undefined;
    const sourceInvitationId = text(membership, "source_invitation_id");
    if (!membership || !sourceInvitationId) {
      throw new TokenlessServiceError("Active invited reviewer not found.", 404, "private_group_member_not_found");
    }
    const membershipExpiresAt = membership.membership_expires_at
      ? date(membership.membership_expires_at, "membership expiry")
      : null;
    if (membershipExpiresAt && expiresAt > membershipExpiresAt) {
      throw new TokenlessServiceError(
        "Expertise expiry cannot outlive the reviewer membership.",
        400,
        "invalid_reviewer_expertise",
      );
    }
    const definitionRows = await currentVisibleDefinitions(client, input.workspaceId, definitions);

    await client.query(
      `SELECT qualification_id FROM tokenless_reviewer_qualifications
       WHERE workspace_id=$1 AND reviewer_account_address=$2
         AND reviewer_source='customer_invited' AND qualification_kind='expertise'
         AND expertise_record_schema_version=2 AND status='active'
       FOR UPDATE`,
      [input.workspaceId, reviewer],
    );
    await client.query(
      `UPDATE tokenless_reviewer_qualifications
       SET status='revoked',revoked_at=$1,revoked_by=$2,updated_at=$1
       WHERE workspace_id=$3 AND reviewer_account_address=$4
         AND reviewer_source='customer_invited' AND qualification_kind='expertise'
         AND expertise_record_schema_version=2 AND status='active'`,
      [now, actor, input.workspaceId, reviewer],
    );

    const grants = [];
    for (const definition of definitions) {
      const stored = definitionRows.get(definition.definitionId)!;
      const qualificationId = `qual_exp_${randomUUID().replaceAll("-", "")}`;
      const evidenceReferenceHash = sha256({
        schemaVersion: "rateloop.workspace-reviewer-expertise-attestation.v1",
        workspaceId: input.workspaceId,
        groupId: input.groupId,
        sourceInvitationId,
        reviewer,
        definition,
        assertedBy: actor,
        assertedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
      });
      await client.query(
        `INSERT INTO tokenless_reviewer_qualifications
         (qualification_id,rater_id,reviewer_account_address,reviewer_source,qualification_kind,
          cohort_ids_json,qualification_keys_json,evidence_kind,workspace_id,evidence_reference_hash,
          qualification_value_json,verified_at,expires_at,status,created_at,updated_at,revoked_at,
          expertise_record_schema_version,expertise_definition_id,expertise_definition_version,
          expertise_definition_hash,source_invitation_id,asserted_by,revoked_by)
         VALUES ($1,NULL,$2,'customer_invited','expertise','[]',$3,'owner_attested',$4,$5,$6,
                 $7,$8,'active',$7,$7,NULL,2,$9,$10,$11,$12,$13,NULL)`,
        [
          qualificationId,
          reviewer,
          stableJson([]),
          input.workspaceId,
          evidenceReferenceHash,
          stableJson({
            schemaVersion: "rateloop.exact-reviewer-expertise-grant.v1",
            definition,
            label: stored.label,
            groupId: input.groupId,
            sourceInvitationId,
          }),
          now,
          expiresAt,
          definition.definitionId,
          definition.definitionVersion,
          definition.definitionHash,
          sourceInvitationId,
          actor,
        ],
      );
      await client.query(
        `UPDATE tokenless_private_group_invitation_expertise_attestations
         SET status='materialized',materialized_qualification_id=$1,materialized_at=$2
         WHERE invitation_id=$3 AND expertise_definition_id=$4 AND expertise_definition_version=$5
           AND expertise_definition_hash=$6 AND status='pending' AND expires_at>=$7`,
        [
          qualificationId,
          now,
          sourceInvitationId,
          definition.definitionId,
          definition.definitionVersion,
          definition.definitionHash,
          expiresAt,
        ],
      );
      grants.push({
        qualificationId,
        definition,
        label: stored.label,
        evidenceReferenceHash,
        expiresAt: expiresAt.toISOString(),
      });
    }
    await client.query(
      `UPDATE tokenless_private_group_invitation_expertise_attestations
       SET status='revoked',revoked_at=$1,revoked_by=$2
       WHERE invitation_id=$3 AND status='pending'`,
      [now, actor, sourceInvitationId],
    );
    await client.query("COMMIT");
    return {
      reviewerAccountAddress: reviewer,
      workspaceId: input.workspaceId,
      groupId: input.groupId,
      sourceInvitationId,
      grants,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function exactKeysWithClient(
  client: PoolClient,
  input: {
    workspaceId: string;
    groupId: string;
    reviewerAccountAddress: string;
    responseDeadline: Date;
  },
) {
  const result = await client.query(
    `SELECT q.expertise_definition_id,q.expertise_definition_version,q.expertise_definition_hash
     FROM tokenless_private_group_memberships m
     JOIN tokenless_private_groups g ON g.group_id=m.group_id AND g.workspace_id=$1 AND g.status='active'
     JOIN tokenless_reviewer_qualifications q
       ON q.workspace_id=$1 AND q.reviewer_account_address=m.principal_address
      AND q.reviewer_source='customer_invited' AND q.qualification_kind='expertise'
      AND q.expertise_record_schema_version=2 AND q.status='active'
      AND q.expires_at>=$4
     WHERE m.group_id=$2 AND m.principal_address=$3 AND m.status='active'
       AND m.joined_at<=$4
       AND (m.membership_expires_at IS NULL OR m.membership_expires_at>=$4)
     ORDER BY q.expertise_definition_id,q.expertise_definition_version`,
    [input.workspaceId, input.groupId, input.reviewerAccountAddress, input.responseDeadline],
  );
  return (result.rows as Row[]).map(row =>
    exactReviewerExpertiseDefinitionKey({
      definitionId: text(row, "expertise_definition_id")!,
      definitionVersion: integer(row, "expertise_definition_version"),
      definitionHash: text(row, "expertise_definition_hash")! as `sha256:${string}`,
    }),
  );
}

export async function activeExactReviewerExpertiseKeysThroughDeadline(input: {
  workspaceId: string;
  groupId: string;
  reviewerAccountAddress: string;
  responseDeadline: unknown;
  now?: Date;
}) {
  const reviewer = account(input.reviewerAccountAddress, "Reviewer account");
  const now = input.now ?? new Date();
  const responseDeadline = parseFutureDate(input.responseDeadline, "Response deadline", now);
  const client = await dbPool.connect();
  try {
    return await exactKeysWithClient(client, {
      workspaceId: input.workspaceId,
      groupId: input.groupId,
      reviewerAccountAddress: reviewer,
      responseDeadline,
    });
  } finally {
    client.release();
  }
}

export async function countEligibleNetworkExactExpertisePool(input: {
  requirements: unknown;
  panelSize: number;
  responseDeadline: unknown;
  now?: Date;
}) {
  let requirements: ReviewerExpertiseRequirement[];
  try {
    requirements = normalizeReviewerExpertiseRequirementsSelection(input.requirements, input.panelSize);
  } catch {
    throw new TokenlessServiceError("Network specialist requirements are invalid.", 400, "invalid_reviewer_expertise");
  }
  if (
    requirements.some(
      requirement => requirement.sourceScope !== "rateloop_network" || requirement.minimumSeats !== input.panelSize,
    )
  ) {
    throw new TokenlessServiceError(
      "Network specialist requirements must cover every reviewer seat.",
      400,
      "invalid_reviewer_expertise",
    );
  }
  const now = input.now ?? new Date();
  const responseDeadline = parseFutureDate(input.responseDeadline, "Response deadline", now);
  const result = await dbPool.query(
    `SELECT rater_id,expertise_definition_id,expertise_definition_version,expertise_definition_hash
     FROM tokenless_reviewer_qualifications
     WHERE reviewer_source='rateloop_network' AND qualification_kind='expertise'
       AND expertise_record_schema_version=2 AND evidence_kind='platform_verified_credential'
       AND workspace_id IS NULL AND status='active' AND expires_at>=$1
     ORDER BY rater_id,expertise_definition_id,expertise_definition_version`,
    [responseDeadline],
  );
  const keysByRater = new Map<string, Set<string>>();
  for (const row of result.rows as Row[]) {
    const raterId = text(row, "rater_id");
    const definitionId = text(row, "expertise_definition_id");
    const definitionVersion = integer(row, "expertise_definition_version");
    const definitionHash = text(row, "expertise_definition_hash");
    if (!raterId || !definitionId || !definitionHash || !HASH_PATTERN.test(definitionHash)) continue;
    const keys = keysByRater.get(raterId) ?? new Set<string>();
    keys.add(
      exactReviewerExpertiseDefinitionKey({
        definitionId,
        definitionVersion,
        definitionHash: definitionHash as `sha256:${string}`,
      }),
    );
    keysByRater.set(raterId, keys);
  }
  const requiredKeys = requirements.map(exactReviewerExpertiseDefinitionKey);
  return {
    requirements,
    eligible: [...keysByRater.values()].filter(keys => requiredKeys.every(key => keys.has(key))).length,
    ready: true,
    responseDeadline: responseDeadline.toISOString(),
  };
}

export async function listPrivateGroupExpertiseCoverage(input: {
  accountAddress: string;
  workspaceId: string;
  groupId: string;
  requirements: unknown;
  responseDeadline: unknown;
  now?: Date;
}) {
  const actor = account(input.accountAddress, "Account address");
  const requirements = normalizeRequirements(input.requirements);
  const now = input.now ?? new Date();
  const responseDeadline = parseFutureDate(input.responseDeadline, "Response deadline", now);
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await requireManager(client, actor, input.workspaceId, input.groupId);
    const definitions = await resolveVisibleDefinitionVersions(client, input.workspaceId, requirements);
    const membersResult = await client.query(
      `SELECT principal_address
       FROM tokenless_private_group_memberships
       WHERE group_id=$1 AND status='active' AND joined_at<=$2
         AND (membership_expires_at IS NULL OR membership_expires_at>=$2)
       ORDER BY principal_address
       FOR SHARE`,
      [input.groupId, responseDeadline],
    );
    const members = (membersResult.rows as Row[]).map(row => text(row, "principal_address")!).filter(Boolean);
    const keysByMember = new Map<string, Set<string>>();
    for (const reviewer of members) {
      keysByMember.set(
        reviewer,
        new Set(
          await exactKeysWithClient(client, {
            workspaceId: input.workspaceId,
            groupId: input.groupId,
            reviewerAccountAddress: reviewer,
            responseDeadline,
          }),
        ),
      );
    }
    const pendingResult = await client.query(
      `SELECT a.invitation_id,a.expertise_definition_id,a.expertise_definition_version,
              a.expertise_definition_hash
       FROM tokenless_private_group_invitation_expertise_attestations a
       JOIN tokenless_private_group_invitations i ON i.invitation_id=a.invitation_id
       WHERE i.workspace_id=$1 AND i.group_id=$2 AND i.revoked_at IS NULL
         AND i.expires_at>$3 AND i.redemption_count<i.maximum_redemptions
         AND i.maximum_redemptions=1
         AND (i.intended_account_address IS NOT NULL OR i.intended_email_hash IS NOT NULL)
         AND (i.membership_expires_at IS NULL OR i.membership_expires_at>=$4)
         AND a.status='pending' AND a.expires_at>=$4
       ORDER BY a.invitation_id,a.expertise_definition_id`,
      [input.workspaceId, input.groupId, now, responseDeadline],
    );
    const pendingByDefinition = new Map<string, Set<string>>();
    const pendingInvitations = new Set<string>();
    for (const row of pendingResult.rows as Row[]) {
      const invitationId = text(row, "invitation_id")!;
      const definitionKey = exactReviewerExpertiseDefinitionKey({
        definitionId: text(row, "expertise_definition_id")!,
        definitionVersion: integer(row, "expertise_definition_version"),
        definitionHash: text(row, "expertise_definition_hash")! as `sha256:${string}`,
      });
      const invitations = pendingByDefinition.get(definitionKey) ?? new Set<string>();
      invitations.add(invitationId);
      pendingByDefinition.set(definitionKey, invitations);
      pendingInvitations.add(invitationId);
    }
    const coverage = requirements.map(requirement => {
      const definition = definitions.get(requirement.definitionId)!;
      const key = exactReviewerExpertiseDefinitionKey(requirement);
      const confirmedSeats = [...keysByMember.values()].filter(keys => keys.has(key)).length;
      const pendingInvitationSeats = pendingByDefinition.get(key)?.size ?? 0;
      const missingSeats = Math.max(0, requirement.minimumSeats - confirmedSeats);
      const status =
        missingSeats === 0
          ? ("ready" as const)
          : confirmedSeats + pendingInvitationSeats >= requirement.minimumSeats
            ? ("pending_confirmation" as const)
            : ("missing" as const);
      return {
        ...requirement,
        label: definition.label,
        description: definition.description,
        confirmedSeats,
        pendingInvitationSeats,
        missingSeats,
        status,
      };
    });
    await client.query("COMMIT");
    const ready = coverage.every(requirement => requirement.status === "ready");
    return {
      workspaceId: input.workspaceId,
      groupId: input.groupId,
      responseDeadline: responseDeadline.toISOString(),
      confirmedMemberCount: members.length,
      pendingInvitationCount: pendingInvitations.size,
      ready,
      status: ready ? ("ready" as const) : ("action_required" as const),
      requirements: coverage,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export const __reviewerExpertiseAssignmentsTestUtils = {
  maximumExpertiseExpiry,
  normalizeDefinitionReferences,
  normalizeRequirements,
  sha256,
  stableJson,
};

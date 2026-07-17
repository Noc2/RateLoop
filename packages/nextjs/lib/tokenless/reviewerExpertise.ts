import { createHash } from "node:crypto";
import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbClient } from "~~/lib/db";
import {
  REVIEWER_EXPERTISE,
  REVIEWER_EXPERTISE_KEYS,
  type ReviewerExpertiseKey,
  expertiseQualificationKey,
  expertiseQualificationRules,
  normalizeReviewerExpertiseKeys,
} from "~~/lib/tokenless/reviewerExpertiseVocabulary";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import { isWorldIdAssuranceEnabled } from "~~/lib/tokenless/worldIdAssurance";

type Row = Record<string, unknown>;

const MAXIMUM_EXPERTISE_EXPIRY_MS = 2 * 365 * 86_400_000;

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
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
  if (encoded === undefined) throw new Error("Expertise value is not JSON serializable.");
  return encoded;
}

function digest(value: unknown) {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

export {
  REVIEWER_EXPERTISE,
  REVIEWER_EXPERTISE_KEYS,
  type ReviewerExpertiseKey,
  expertiseQualificationKey,
  expertiseQualificationRules,
  normalizeReviewerExpertiseKeys,
};

async function requireProjectManager(accountAddress: string, workspaceId: string, projectId: string) {
  let actor: string;
  try {
    actor = normalizeAccountSubject(accountAddress);
  } catch {
    throw new TokenlessServiceError("Account address is invalid.", 400, "invalid_account");
  }
  const access = await dbClient.execute({
    sql: `SELECT 1 FROM tokenless_assurance_projects p
          JOIN tokenless_workspace_members m ON m.workspace_id=p.workspace_id
          WHERE p.workspace_id=? AND p.project_id=? AND p.status='active'
            AND m.account_address=? AND m.role IN ('owner','admin') LIMIT 1`,
    args: [workspaceId, projectId, actor],
  });
  if (!access.rowCount) throw new TokenlessServiceError("Project not found.", 404, "project_not_found");
  return actor;
}

export async function attestInvitedReviewerExpertise(input: {
  accountAddress: string;
  workspaceId: string;
  projectId: string;
  cohortId: string;
  reviewerAccountAddress: string;
  expertiseKeys: unknown;
  expiresAt?: string | null;
  now?: Date;
}) {
  const actor = await requireProjectManager(input.accountAddress, input.workspaceId, input.projectId);
  let reviewer: string;
  try {
    reviewer = normalizeAccountSubject(input.reviewerAccountAddress);
  } catch {
    throw new TokenlessServiceError("Reviewer account is invalid.", 400, "invalid_account");
  }
  const keys = normalizeReviewerExpertiseKeys(input.expertiseKeys);
  const now = input.now ?? new Date();
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : new Date(now.getTime() + 365 * 86_400_000);
  if (
    !Number.isFinite(expiresAt.getTime()) ||
    expiresAt <= now ||
    expiresAt.getTime() - now.getTime() > MAXIMUM_EXPERTISE_EXPIRY_MS
  ) {
    throw new TokenlessServiceError(
      "Expertise attestation expiry must be within two years.",
      400,
      "invalid_reviewer_expertise",
    );
  }
  const result = await dbClient.execute({
    sql: `SELECT cr.qualification_provenance_json
          FROM tokenless_assurance_cohort_reviewers cr
          JOIN tokenless_assurance_cohorts c
            ON c.project_id=cr.project_id AND c.cohort_id=cr.cohort_id
          JOIN tokenless_assurance_projects p ON p.project_id=cr.project_id
          WHERE cr.project_id=? AND cr.cohort_id=? AND cr.reviewer_account_address=?
            AND cr.status='active' AND c.status='active' AND c.source='customer_invited'
            AND p.workspace_id=? LIMIT 1`,
    args: [input.projectId, input.cohortId, reviewer, input.workspaceId],
  });
  const row = result.rows[0] as Row | undefined;
  if (!row) throw new TokenlessServiceError("Invited reviewer not found.", 404, "invited_reviewer_not_found");
  let current: Array<Record<string, unknown>>;
  try {
    current = JSON.parse(text(row, "qualification_provenance_json") ?? "[]") as Array<Record<string, unknown>>;
    if (!Array.isArray(current)) throw new Error();
  } catch {
    throw new Error("Stored reviewer qualification provenance is invalid.");
  }
  const retained = current.filter(value => typeof value.key !== "string" || !value.key.startsWith("expertise:"));
  const evidenceReferenceHash = digest({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    cohortId: input.cohortId,
    reviewer,
    keys,
    assertedBy: actor,
    verifiedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });
  const provenance = [
    ...retained,
    ...keys.map(key => ({
      key: expertiseQualificationKey(key),
      value: true,
      source: "owner_attested",
      assertedBy: actor,
      verifiedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      evidenceReferenceHash,
    })),
  ].sort((left, right) => String(left.key).localeCompare(String(right.key)));
  await dbClient.execute({
    sql: `UPDATE tokenless_assurance_cohort_reviewers
          SET qualification_provenance_json=?,
              qualification_expires_at=CASE
                WHEN qualification_expires_at IS NULL THEN ?
                WHEN qualification_expires_at <= ? THEN qualification_expires_at
                ELSE ?
              END,
              updated_at=?
          WHERE project_id=? AND cohort_id=? AND reviewer_account_address=? AND status='active'`,
    args: [stableJson(provenance), expiresAt, expiresAt, expiresAt, now, input.projectId, input.cohortId, reviewer],
  });
  const qualificationId = `qual_exp_${createHash("sha256")
    .update(`${input.workspaceId}\0${input.projectId}\0${input.cohortId}\0${reviewer}`)
    .digest("hex")
    .slice(0, 32)}`;
  if (keys.length === 0) {
    await dbClient.execute({
      sql: `UPDATE tokenless_reviewer_qualifications
            SET status='revoked',revoked_at=?,updated_at=?
            WHERE qualification_id=? AND workspace_id=? AND reviewer_account_address=? AND status='active'`,
      args: [now, now, qualificationId, input.workspaceId, reviewer],
    });
  } else {
    await dbClient.execute({
      sql: `INSERT INTO tokenless_reviewer_qualifications
            (qualification_id,rater_id,reviewer_account_address,reviewer_source,qualification_kind,
             cohort_ids_json,qualification_keys_json,evidence_kind,workspace_id,evidence_reference_hash,
             qualification_value_json,verified_at,expires_at,status,created_at,updated_at,
             expertise_record_schema_version)
            VALUES (?,NULL,?,'customer_invited','expertise',?,?,'owner_attested',?,?,?, ?,?,'active',?,?,1)
            ON CONFLICT (qualification_id) DO UPDATE SET
              cohort_ids_json=EXCLUDED.cohort_ids_json,
              qualification_keys_json=EXCLUDED.qualification_keys_json,
              evidence_reference_hash=EXCLUDED.evidence_reference_hash,
              qualification_value_json=EXCLUDED.qualification_value_json,
              verified_at=EXCLUDED.verified_at,
              expires_at=CASE
                WHEN tokenless_reviewer_qualifications.expires_at <= EXCLUDED.expires_at
                  THEN tokenless_reviewer_qualifications.expires_at
                ELSE EXCLUDED.expires_at
              END,
              status='active',revoked_at=NULL,updated_at=EXCLUDED.updated_at`,
      args: [
        qualificationId,
        reviewer,
        stableJson([input.cohortId]),
        stableJson(keys.map(expertiseQualificationKey)),
        input.workspaceId,
        evidenceReferenceHash,
        stableJson({ expertiseKeys: keys, projectId: input.projectId, cohortId: input.cohortId }),
        now,
        expiresAt,
        now,
        now,
      ],
    });
  }
  return {
    reviewerAccountAddress: reviewer,
    expertiseKeys: keys,
    evidenceReferenceHash,
    expiresAt: expiresAt.toISOString(),
  };
}

function provenanceSatisfies(value: unknown, required: readonly ReviewerExpertiseKey[], now: Date) {
  if (required.length === 0) return true;
  let parsed: Array<{ key?: unknown; value?: unknown; expiresAt?: unknown }>;
  try {
    parsed = JSON.parse(String(value)) as typeof parsed;
    if (!Array.isArray(parsed)) return false;
  } catch {
    return false;
  }
  const active = new Set(
    parsed
      .filter(
        item =>
          item.value === true &&
          typeof item.key === "string" &&
          (!item.expiresAt || new Date(String(item.expiresAt)) > now),
      )
      .map(item => item.key as string),
  );
  return required.every(key => active.has(expertiseQualificationKey(key)));
}

export function qualificationProvenanceSatisfiesExpertise(
  value: unknown,
  required: readonly ReviewerExpertiseKey[],
  now: Date,
) {
  return provenanceSatisfies(value, required, now);
}

function activeExpertiseKeysFromProvenance(value: unknown, now: Date) {
  let parsed: Array<{ key?: unknown; value?: unknown; expiresAt?: unknown }>;
  try {
    parsed = JSON.parse(String(value)) as typeof parsed;
    if (!Array.isArray(parsed)) return [];
  } catch {
    return [];
  }
  return parsed.flatMap(item =>
    item.value === true &&
    typeof item.key === "string" &&
    item.key.startsWith("expertise:") &&
    (!item.expiresAt || new Date(String(item.expiresAt)).getTime() > now.getTime())
      ? [item.key]
      : [],
  );
}

export async function countEligibleReviewerExpertisePool(input: {
  accountAddress: string;
  workspaceId: string;
  audience: "private_invited" | "public_network" | "hybrid";
  privateGroupId?: string | null;
  expertiseKeys: unknown;
  now?: Date;
}) {
  let actor: string;
  try {
    actor = normalizeAccountSubject(input.accountAddress);
  } catch {
    throw new TokenlessServiceError("Account address is invalid.", 400, "invalid_account");
  }
  const access = await dbClient.execute({
    sql: `SELECT 1 FROM tokenless_workspace_members m JOIN tokenless_workspaces w ON w.workspace_id=m.workspace_id
          WHERE m.workspace_id=? AND m.account_address=? AND m.role IN ('owner','admin') AND w.status='active' LIMIT 1`,
    args: [input.workspaceId, actor],
  });
  if (!access.rowCount) throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  const required = normalizeReviewerExpertiseKeys(input.expertiseKeys);
  const now = input.now ?? new Date();
  let invitedEligible = 0;
  let invitedTotal = 0;
  if (input.audience !== "public_network" && input.privateGroupId) {
    const invited = await dbClient.execute({
      sql: `SELECT DISTINCT cr.reviewer_account_address,cr.qualification_provenance_json
            FROM tokenless_assurance_cohort_reviewers cr
            JOIN tokenless_assurance_cohorts c
              ON c.project_id=cr.project_id AND c.cohort_id=cr.cohort_id
            JOIN tokenless_assurance_projects p ON p.project_id=cr.project_id
            WHERE p.workspace_id=? AND c.private_group_id=? AND c.source='customer_invited'
              AND c.status='active' AND cr.status='active'
              AND (cr.qualification_expires_at IS NULL OR cr.qualification_expires_at>?)`,
      args: [input.workspaceId, input.privateGroupId, now],
    });
    const expertiseByReviewer = new Map<string, Set<string>>();
    for (const value of invited.rows as Row[]) {
      const reviewer = text(value, "reviewer_account_address");
      if (!reviewer) continue;
      const keys = expertiseByReviewer.get(reviewer) ?? new Set<string>();
      for (const key of activeExpertiseKeysFromProvenance(value.qualification_provenance_json, now)) keys.add(key);
      expertiseByReviewer.set(reviewer, keys);
    }
    invitedTotal = expertiseByReviewer.size;
    invitedEligible = [...expertiseByReviewer.values()].filter(keys =>
      required.every(key => keys.has(expertiseQualificationKey(key))),
    ).length;
  }
  let networkEligible = 0;
  let networkTotal = 0;
  const networkReady = input.audience === "private_invited" ? false : isWorldIdAssuranceEnabled();
  if (input.audience !== "private_invited" && networkReady) {
    const network = await dbClient.execute({
      sql: `SELECT rater_id,qualification_keys_json FROM tokenless_reviewer_qualifications
            WHERE reviewer_source='rateloop_network' AND qualification_kind='expertise'
              AND evidence_kind='platform_verified_credential' AND status='active'
              AND workspace_id IS NULL AND (expires_at IS NULL OR expires_at>?)`,
      args: [now],
    });
    const expertiseByRater = new Map<string, Set<string>>();
    for (const value of network.rows as Row[]) {
      const rater = text(value, "rater_id");
      if (!rater) continue;
      try {
        const keys = JSON.parse(String((value as Row).qualification_keys_json)) as unknown;
        if (!Array.isArray(keys)) continue;
        const aggregate = expertiseByRater.get(rater) ?? new Set<string>();
        for (const key of keys) if (typeof key === "string") aggregate.add(key);
        expertiseByRater.set(rater, aggregate);
      } catch {
        continue;
      }
    }
    networkTotal = expertiseByRater.size;
    networkEligible = [...expertiseByRater.values()].filter(keys =>
      required.every(key => keys.has(expertiseQualificationKey(key))),
    ).length;
  }
  return {
    expertiseKeys: required,
    invited: { eligible: invitedEligible, total: invitedTotal },
    network: { eligible: networkEligible, total: networkTotal, ready: networkReady },
    eligible: invitedEligible + networkEligible,
    feasible: invitedEligible + networkEligible > 0 || required.length === 0,
  };
}

export async function countEligibleNetworkExpertisePool(input: { expertiseKeys: unknown; now?: Date }) {
  const required = normalizeReviewerExpertiseKeys(input.expertiseKeys);
  if (!isWorldIdAssuranceEnabled()) {
    return { expertiseKeys: required, eligible: 0, ready: false };
  }
  const now = input.now ?? new Date();
  const result = await dbClient.execute({
    sql: `SELECT rater_id,qualification_keys_json FROM tokenless_reviewer_qualifications
          WHERE reviewer_source='rateloop_network' AND qualification_kind='expertise'
            AND evidence_kind='platform_verified_credential' AND status='active'
            AND workspace_id IS NULL AND (expires_at IS NULL OR expires_at>?)`,
    args: [now],
  });
  const expertiseByRater = new Map<string, Set<string>>();
  for (const value of result.rows as Row[]) {
    const rater = text(value, "rater_id");
    if (!rater) continue;
    try {
      const keys = JSON.parse(String(value.qualification_keys_json)) as unknown;
      if (!Array.isArray(keys)) continue;
      const aggregate = expertiseByRater.get(rater) ?? new Set<string>();
      for (const key of keys) if (typeof key === "string") aggregate.add(key);
      expertiseByRater.set(rater, aggregate);
    } catch {
      continue;
    }
  }
  return {
    expertiseKeys: required,
    eligible: [...expertiseByRater.values()].filter(keys =>
      required.every(key => keys.has(expertiseQualificationKey(key))),
    ).length,
    ready: true,
  };
}

export const __reviewerExpertiseTestUtils = {
  activeExpertiseKeysFromProvenance,
  digest,
  provenanceSatisfies,
  stableJson,
};

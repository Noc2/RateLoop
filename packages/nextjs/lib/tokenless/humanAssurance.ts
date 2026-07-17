import {
  HUMAN_ASSURANCE_SCHEMA_VERSION,
  type HumanAssuranceAudiencePolicy,
  type HumanAssuranceDataClassification,
  type HumanAssuranceRubric,
  parseHumanAssuranceAudiencePolicy,
  parseHumanAssuranceRubric,
} from "@rateloop/sdk";
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { isRateLoopPrincipalId } from "~~/lib/auth/accountSubject";
import { consumeWorkspaceUsageAllocations, releaseWorkspaceUsageAllocations } from "~~/lib/billing/entitlements";
import { dbClient, dbPool } from "~~/lib/db";
import type { TokenlessWorkspaceRole } from "~~/lib/db/productSchema";
import { assertCredentialDataPolicy, assertDataIngressPolicy } from "~~/lib/privacy/dataPolicy";
import { promoteCompletedRunGoldQualifications } from "~~/lib/tokenless/goldQuality";
import { recordAssuranceMechanismHealth } from "~~/lib/tokenless/mechanismHealth";
import type { ProductPrincipal } from "~~/lib/tokenless/productCore";
import {
  type ProjectAccessSubjectKind,
  authorizeProjectSubject,
  createInitialProjectAssignment,
} from "~~/lib/tokenless/projectAccess";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type QueryRow = Record<string, unknown>;
type RubricDefinition = Pick<HumanAssuranceRubric, "failureTags" | "passRule" | "prompt" | "rationale">;
type AudiencePolicyDefinition = Omit<HumanAssuranceAudiencePolicy, "policyId" | "schemaVersion" | "version">;

const WRITE_ROLES = new Set<TokenlessWorkspaceRole>(["owner", "admin", "member"]);
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const ONCHAIN_TERMINAL_CASE_STATUSES = new Set(["finalized", "terminal", "failed"]);
const RUN_TRANSITIONS = new Map<string, ReadonlySet<string>>([
  ["draft", new Set(["frozen", "cancelled"])],
  ["frozen", new Set(["recruiting", "cancelled"])],
  ["recruiting", new Set(["collecting", "cancelled"])],
  ["collecting", new Set(["aggregating"])],
  ["aggregating", new Set(["completed"])],
]);

export type AssurancePrincipal =
  | ProductPrincipal
  | {
      kind: "workspace_session";
      accountAddress: string;
      workspaceId: string;
      role: TokenlessWorkspaceRole;
    };

function rowString(row: QueryRow | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function rowNumber(row: QueryRow | undefined, key: string) {
  const value = row?.[key];
  const number = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function requiredText(value: string, name: string, maximum: number) {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new TokenlessServiceError(
      `${name} must contain between 1 and ${maximum} characters.`,
      400,
      "invalid_human_assurance_input",
    );
  }
  return normalized;
}

export function canonicalizeHumanAssuranceDocument(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeHumanAssuranceDocument).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalizeHumanAssuranceDocument(entry)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    throw new TokenlessServiceError(
      "Human-assurance documents must be JSON serializable.",
      400,
      "invalid_human_assurance_input",
    );
  }
  return encoded;
}

export function hashHumanAssuranceDocument(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalizeHumanAssuranceDocument(value)).digest("hex")}`;
}

function principalLabel(principal: AssurancePrincipal) {
  return principal.kind === "api_key"
    ? `api_key:${principal.apiKeyId}`
    : `account:${principal.accountAddress.toLowerCase()}`;
}

function projectAccessSubject(principal: AssurancePrincipal): {
  subjectKind: ProjectAccessSubjectKind;
  subjectReference: string;
} {
  if (principal.kind === "api_key") return { subjectKind: "api_key", subjectReference: principal.apiKeyId };
  return isRateLoopPrincipalId(principal.accountAddress)
    ? { subjectKind: "principal", subjectReference: principal.accountAddress }
    : { subjectKind: "account", subjectReference: principal.accountAddress.toLowerCase() };
}

function assertWriteRole(role: TokenlessWorkspaceRole) {
  if (!WRITE_ROLES.has(role)) {
    throw new TokenlessServiceError("This workspace role cannot change assurance projects.", 403, "insufficient_role");
  }
}

export async function scopeAssuranceSessionToWorkspace(input: {
  accountAddress: string;
  workspaceId: string;
}): Promise<AssurancePrincipal> {
  const result = await dbClient.execute({
    sql: `SELECT m.role FROM tokenless_workspace_members m
          JOIN tokenless_workspaces w ON w.workspace_id = m.workspace_id
          WHERE m.workspace_id = ? AND m.account_address = ? AND w.status = 'active' LIMIT 1`,
    args: [input.workspaceId, input.accountAddress.toLowerCase()],
  });
  const role = rowString(result.rows[0] as QueryRow | undefined, "role") as TokenlessWorkspaceRole | null;
  if (!role || !WRITE_ROLES.has(role)) {
    throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  }
  return { kind: "workspace_session", accountAddress: input.accountAddress, workspaceId: input.workspaceId, role };
}

async function resolveOnlyWritableWorkspace(principal: AssurancePrincipal) {
  if (principal.kind === "workspace_session") {
    assertWriteRole(principal.role);
    return principal.workspaceId;
  }
  if (principal.kind === "api_key") {
    assertWriteRole(principal.role);
    const result = await dbClient.execute({
      sql: `SELECT workspace_id FROM tokenless_workspaces
            WHERE workspace_id = ? AND status = 'active' LIMIT 1`,
      args: [principal.workspaceId],
    });
    if (!rowString(result.rows[0] as QueryRow | undefined, "workspace_id")) {
      throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
    }
    return principal.workspaceId;
  }

  const result = await dbClient.execute({
    sql: `SELECT m.workspace_id, m.role
          FROM tokenless_workspace_members m
          JOIN tokenless_workspaces w ON w.workspace_id = m.workspace_id
          WHERE m.account_address = ? AND w.status = 'active'
          AND m.role IN ('owner', 'admin', 'member')
          ORDER BY m.created_at ASC`,
    args: [principal.accountAddress.toLowerCase()],
  });
  if (result.rows.length !== 1) {
    throw new TokenlessServiceError(
      result.rows.length === 0
        ? "No writable workspace is available."
        : "Select a workspace-scoped API key before creating a project.",
      result.rows.length === 0 ? 403 : 409,
      result.rows.length === 0 ? "workspace_forbidden" : "workspace_scope_required",
    );
  }
  const row = result.rows[0] as QueryRow;
  assertWriteRole(rowString(row, "role") as TokenlessWorkspaceRole);
  return rowString(row, "workspace_id")!;
}

async function requireProjectAccess(
  principal: AssurancePrincipal,
  projectId: string,
  options: { active?: boolean } = {},
) {
  const result = await dbClient.execute({
    sql: `SELECT p.project_id, p.workspace_id, p.status
          FROM tokenless_assurance_projects p
          JOIN tokenless_workspaces w ON w.workspace_id = p.workspace_id
          WHERE p.project_id = ? AND w.status = 'active' LIMIT 1`,
    args: [projectId],
  });
  const row = result.rows[0] as QueryRow | undefined;
  const workspaceId = rowString(row, "workspace_id");
  if (!workspaceId) {
    throw new TokenlessServiceError("Assurance project not found.", 404, "assurance_project_not_found");
  }

  if (
    (principal.kind === "api_key" || principal.kind === "workspace_session") &&
    principal.workspaceId !== workspaceId
  ) {
    throw new TokenlessServiceError("Assurance project not found.", 404, "assurance_project_not_found");
  }
  const subject = projectAccessSubject(principal);
  try {
    await authorizeProjectSubject({
      action: "write",
      projectId,
      workspaceId,
      ...subject,
    });
  } catch (error) {
    if (error instanceof TokenlessServiceError && error.code.startsWith("project_")) {
      throw new TokenlessServiceError("Assurance project not found.", 404, "assurance_project_not_found");
    }
    throw error;
  }

  if (options.active && rowString(row, "status") !== "active") {
    throw new TokenlessServiceError("The assurance project is archived.", 409, "assurance_project_archived");
  }
  return { projectId, workspaceId, status: rowString(row, "status")! };
}

export async function createAssuranceProject(input: {
  principal: AssurancePrincipal;
  name: string;
  description?: string;
  dataClassification: HumanAssuranceDataClassification;
  retentionDays: number;
}) {
  const workspaceId = await resolveOnlyWritableWorkspace(input.principal);
  const name = requiredText(input.name, "Project name", 160);
  const description = input.description?.trim() || null;
  if (description && description.length > 2_000) {
    throw new TokenlessServiceError(
      "Project description must not exceed 2000 characters.",
      400,
      "invalid_human_assurance_input",
    );
  }
  if (
    !["public", "internal", "confidential", "restricted", "regulated"].includes(input.dataClassification) ||
    !Number.isSafeInteger(input.retentionDays) ||
    input.retentionDays < 1 ||
    input.retentionDays > 3650
  ) {
    throw new TokenlessServiceError(
      "Invalid data classification or retention period.",
      400,
      "invalid_human_assurance_input",
    );
  }
  if (input.principal.kind === "api_key") {
    assertCredentialDataPolicy({
      classification: input.dataClassification,
      credentialHomeRegion: input.principal.credentialHomeRegion ?? "eu",
      homeRegion: input.principal.workspaceHomeRegion ?? "eu",
      maxClassification: input.principal.maxDataClassification ?? "confidential",
      permittedDataUses: input.principal.permittedDataUses ?? ["service_delivery"],
    });
  }
  assertDataIngressPolicy({
    classification: input.dataClassification,
    visibility: "private",
    regulatedModeEnabled: input.principal.kind === "api_key" && input.principal.maxDataClassification === "regulated",
  });
  const projectId = `hap_${randomUUID().replaceAll("-", "")}`;
  const now = new Date();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_projects
          (project_id, workspace_id, name, description, data_classification, home_region,
           retention_policy_id, legal_hold_state, data_use_policy_version,
           status, retention_days, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'eu', 'retention-default-v1', 'none', 'data-use-v1', 'active', ?, ?, ?, ?)`,
    args: [
      projectId,
      workspaceId,
      name,
      description,
      input.dataClassification,
      input.retentionDays,
      principalLabel(input.principal),
      now,
      now,
    ],
  });
  await createInitialProjectAssignment({
    projectId,
    workspaceId,
    ...projectAccessSubject(input.principal),
    now,
  });
  return { projectId, workspaceId };
}

export async function listAssuranceProjects(principal: AssurancePrincipal) {
  const workspaceId = await resolveOnlyWritableWorkspace(principal);
  const subject = projectAccessSubject(principal);
  const result = await dbClient.execute({
    sql: `SELECT p.project_id, p.name, p.description, p.data_classification, p.status,
                 p.retention_days, p.created_at, p.updated_at,
                 COUNT(DISTINCT s.suite_id) AS suite_count,
                 COUNT(DISTINCT r.run_id) AS run_count
          FROM tokenless_assurance_projects p
          JOIN tokenless_project_access_assignments pa ON pa.project_id = p.project_id AND pa.workspace_id = p.workspace_id
          LEFT JOIN tokenless_assurance_suites s ON s.project_id = p.project_id
          LEFT JOIN tokenless_assurance_runs r ON r.project_id = p.project_id
          WHERE p.workspace_id = ? AND p.status <> 'deleted'
            AND pa.subject_kind = ? AND pa.subject_reference = ? AND pa.status = 'active'
            AND (pa.expires_at IS NULL OR pa.expires_at > ?)
          GROUP BY p.project_id, p.name, p.description, p.data_classification, p.status,
                   p.retention_days, p.created_at, p.updated_at
          ORDER BY p.updated_at DESC`,
    args: [workspaceId, subject.subjectKind, subject.subjectReference, new Date()],
  });
  return result.rows.map(value => {
    const row = value as QueryRow;
    return {
      projectId: rowString(row, "project_id")!,
      name: rowString(row, "name")!,
      description: rowString(row, "description"),
      dataClassification: rowString(row, "data_classification")!,
      status: rowString(row, "status")!,
      retentionDays: rowNumber(row, "retention_days")!,
      suiteCount: rowNumber(row, "suite_count") ?? 0,
      runCount: rowNumber(row, "run_count") ?? 0,
      createdAt: new Date(String(row.created_at)).toISOString(),
      updatedAt: new Date(String(row.updated_at)).toISOString(),
    };
  });
}

export async function getAssuranceProjectResources(input: { principal: AssurancePrincipal; projectId: string }) {
  await requireProjectAccess(input.principal, input.projectId);
  const [suites, policies, runs] = await Promise.all([
    dbClient.execute({
      sql: `SELECT s.suite_id, s.name, s.version, s.status, s.manifest_hash, s.frozen_at,
                   COUNT(c.case_id) AS case_count
            FROM tokenless_assurance_suites s
            LEFT JOIN tokenless_assurance_cases c ON c.suite_id = s.suite_id AND c.suite_version = s.version
            WHERE s.project_id = ?
            GROUP BY s.suite_id, s.name, s.version, s.status, s.manifest_hash, s.frozen_at, s.updated_at
            ORDER BY s.updated_at DESC`,
      args: [input.projectId],
    }),
    dbClient.execute({
      sql: `SELECT policy_id, version, reviewer_source, compensation, selection, policy_hash, created_at
            FROM tokenless_assurance_audience_policies WHERE project_id = ? ORDER BY created_at DESC`,
      args: [input.projectId],
    }),
    dbClient.execute({
      sql: `SELECT run_id, suite_id, suite_version, audience_policy_id, audience_policy_version, status,
                   manifest_hash, previous_run_id, created_at, updated_at, completed_at
            FROM tokenless_assurance_runs WHERE project_id = ? ORDER BY created_at DESC`,
      args: [input.projectId],
    }),
  ]);
  return {
    suites: suites.rows.map(value => {
      const row = value as QueryRow;
      return {
        suiteId: rowString(row, "suite_id")!,
        name: rowString(row, "name")!,
        version: rowNumber(row, "version")!,
        status: rowString(row, "status")!,
        manifestHash: rowString(row, "manifest_hash"),
        caseCount: rowNumber(row, "case_count") ?? 0,
        frozenAt: row.frozen_at ? new Date(String(row.frozen_at)).toISOString() : null,
      };
    }),
    policies: policies.rows.map(value => {
      const row = value as QueryRow;
      return {
        policyId: rowString(row, "policy_id")!,
        version: rowNumber(row, "version")!,
        reviewerSource: rowString(row, "reviewer_source")!,
        compensation: rowString(row, "compensation")!,
        selection: rowString(row, "selection")!,
        policyHash: rowString(row, "policy_hash")!,
      };
    }),
    runs: runs.rows.map(value => {
      const row = value as QueryRow;
      return {
        runId: rowString(row, "run_id")!,
        suiteId: rowString(row, "suite_id")!,
        suiteVersion: rowNumber(row, "suite_version")!,
        audiencePolicyId: rowString(row, "audience_policy_id")!,
        audiencePolicyVersion: rowNumber(row, "audience_policy_version")!,
        status: rowString(row, "status")!,
        manifestHash: rowString(row, "manifest_hash"),
        previousRunId: rowString(row, "previous_run_id"),
        createdAt: new Date(String(row.created_at)).toISOString(),
        updatedAt: new Date(String(row.updated_at)).toISOString(),
        completedAt: row.completed_at ? new Date(String(row.completed_at)).toISOString() : null,
      };
    }),
  };
}

export async function createAssuranceSuite(input: {
  principal: AssurancePrincipal;
  projectId: string;
  name: string;
  rubric: RubricDefinition;
}) {
  await requireProjectAccess(input.principal, input.projectId, { active: true });
  const suiteId = `has_${randomUUID().replaceAll("-", "")}`;
  const rubricId = `har_${randomUUID().replaceAll("-", "")}`;
  const version = 1;
  const rubric = parseHumanAssuranceRubric({
    schemaVersion: HUMAN_ASSURANCE_SCHEMA_VERSION,
    rubricId,
    projectId: input.projectId,
    version,
    prompt: input.rubric.prompt,
    choices: ["baseline", "candidate", "tie"],
    failureTags: input.rubric.failureTags,
    rationale: input.rubric.rationale,
    passRule: input.rubric.passRule,
  });
  const rubricJson = canonicalizeHumanAssuranceDocument(rubric);
  const name = requiredText(input.name, "Suite name", 160);
  const now = new Date();
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO tokenless_assurance_rubrics
       (rubric_id, project_id, version, prompt, failure_tags_json,
        rationale_json, pass_rule_json, rubric_json, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        rubricId,
        input.projectId,
        version,
        rubric.prompt,
        JSON.stringify(rubric.failureTags),
        JSON.stringify(rubric.rationale),
        JSON.stringify(rubric.passRule),
        rubricJson,
        now,
      ],
    );
    await client.query(
      `INSERT INTO tokenless_assurance_suites
       (suite_id, project_id, name, version, status, rubric_id,
        rubric_version, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'draft', $5, $4, $6, $6)`,
      [suiteId, input.projectId, name, version, rubricId, now],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return { rubricId, suiteId, version };
}

async function loadSuiteForWrite(principal: AssurancePrincipal, suiteId: string, suiteVersion: number) {
  const result = await dbClient.execute({
    sql: `SELECT suite_id, version, project_id, status, rubric_id,
                 rubric_version, manifest_hash, manifest_json
          FROM tokenless_assurance_suites
          WHERE suite_id = ? AND version = ? LIMIT 1`,
    args: [suiteId, suiteVersion],
  });
  const row = result.rows[0] as QueryRow | undefined;
  const projectId = rowString(row, "project_id");
  if (!projectId) {
    throw new TokenlessServiceError("Assurance suite not found.", 404, "assurance_suite_not_found");
  }
  await requireProjectAccess(principal, projectId, { active: true });
  return row!;
}

async function requireArtifact(
  projectId: string,
  artifactId: string,
  expectedRole?: "baseline" | "candidate" | "context",
) {
  const result = await dbClient.execute({
    sql: `SELECT artifact_id, project_id, role, digest, content_type,
                 redaction_status, renderer_policy
          FROM tokenless_assurance_artifacts
          WHERE artifact_id = ? AND project_id = ? LIMIT 1`,
    args: [artifactId, projectId],
  });
  const row = result.rows[0] as QueryRow | undefined;
  if (!row || (expectedRole && rowString(row, "role") !== expectedRole)) {
    throw new TokenlessServiceError(
      "Artifact not found in this project or has the wrong role.",
      400,
      "invalid_assurance_artifact",
    );
  }
  return row;
}

export async function addAssuranceCase(input: {
  principal: AssurancePrincipal;
  suiteId: string;
  suiteVersion: number;
  title: string;
  instructions: string;
  baselineArtifactId: string;
  candidateArtifactId: string;
  contextArtifactIds?: string[];
  objectiveReference?: string;
}) {
  const suite = await loadSuiteForWrite(input.principal, input.suiteId, input.suiteVersion);
  if (rowString(suite, "status") !== "draft") {
    throw new TokenlessServiceError("Frozen suites cannot be changed.", 409, "assurance_suite_immutable");
  }
  const projectId = rowString(suite, "project_id")!;
  const contextIds = [...new Set(input.contextArtifactIds ?? [])];
  await Promise.all([
    requireArtifact(projectId, input.baselineArtifactId, "baseline"),
    requireArtifact(projectId, input.candidateArtifactId, "candidate"),
    ...contextIds.map(id => requireArtifact(projectId, id, "context")),
  ]);
  const positions = await dbClient.execute({
    sql: `SELECT COALESCE(MAX(position), -1) AS position
          FROM tokenless_assurance_cases
          WHERE suite_id = ? AND suite_version = ?`,
    args: [input.suiteId, input.suiteVersion],
  });
  const position = (rowNumber(positions.rows[0] as QueryRow, "position") ?? -1) + 1;
  const caseId = `hac_${randomUUID().replaceAll("-", "")}`;
  const now = new Date();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_cases
          (case_id, project_id, suite_id, suite_version, position, title,
           instructions, baseline_artifact_id, candidate_artifact_id,
           context_artifact_ids_json, objective_reference, status, created_at,
           updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
    args: [
      caseId,
      projectId,
      input.suiteId,
      input.suiteVersion,
      position,
      requiredText(input.title, "Case title", 200),
      requiredText(input.instructions, "Case instructions", 10_000),
      input.baselineArtifactId,
      input.candidateArtifactId,
      JSON.stringify(contextIds),
      input.objectiveReference?.trim() || null,
      now,
      now,
    ],
  });
  return { caseId, position, projectId };
}

export async function markAssuranceCaseReady(input: { principal: AssurancePrincipal; caseId: string }) {
  const result = await dbClient.execute({
    sql: `SELECT c.*, s.status AS suite_status
          FROM tokenless_assurance_cases c
          JOIN tokenless_assurance_suites s
            ON s.suite_id = c.suite_id AND s.version = c.suite_version
          WHERE c.case_id = ? LIMIT 1`,
    args: [input.caseId],
  });
  const row = result.rows[0] as QueryRow | undefined;
  const projectId = rowString(row, "project_id");
  if (!projectId) {
    throw new TokenlessServiceError("Assurance case not found.", 404, "assurance_case_not_found");
  }
  await requireProjectAccess(input.principal, projectId, { active: true });
  if (rowString(row, "suite_status") !== "draft") {
    throw new TokenlessServiceError("Frozen suites cannot be changed.", 409, "assurance_suite_immutable");
  }
  const artifactIds = [
    rowString(row, "baseline_artifact_id")!,
    rowString(row, "candidate_artifact_id")!,
    ...(JSON.parse(rowString(row, "context_artifact_ids_json")!) as string[]),
  ];
  const artifacts = await Promise.all(artifactIds.map(id => requireArtifact(projectId, id)));
  if (artifacts.some(artifact => !["approved", "not_required"].includes(rowString(artifact, "redaction_status")!))) {
    throw new TokenlessServiceError(
      "Every case artifact must pass redaction review before it is ready.",
      409,
      "assurance_case_redaction_pending",
    );
  }
  await dbClient.execute({
    sql: `UPDATE tokenless_assurance_cases
          SET status = 'ready', updated_at = ?
          WHERE case_id = ? AND status = 'draft'`,
    args: [new Date(), input.caseId],
  });
  return { caseId: input.caseId, status: "ready" as const };
}

export async function freezeAssuranceSuite(input: {
  principal: AssurancePrincipal;
  suiteId: string;
  suiteVersion: number;
}) {
  const suite = await loadSuiteForWrite(input.principal, input.suiteId, input.suiteVersion);
  const existingHash = rowString(suite, "manifest_hash");
  if (rowString(suite, "status") === "frozen" && existingHash) {
    return { manifestHash: existingHash as `sha256:${string}`, status: "frozen" as const };
  }
  if (rowString(suite, "status") !== "draft") {
    throw new TokenlessServiceError("This suite cannot be frozen.", 409, "invalid_assurance_suite_transition");
  }
  const cases = await dbClient.execute({
    sql: `SELECT * FROM tokenless_assurance_cases
          WHERE suite_id = ? AND suite_version = ? ORDER BY position ASC`,
    args: [input.suiteId, input.suiteVersion],
  });
  if (cases.rows.length === 0 || cases.rows.some(row => rowString(row as QueryRow, "status") !== "ready")) {
    throw new TokenlessServiceError(
      "A suite needs at least one ready case before it can be frozen.",
      409,
      "assurance_suite_not_ready",
    );
  }
  const rubricResult = await dbClient.execute({
    sql: `SELECT rubric_json FROM tokenless_assurance_rubrics
          WHERE rubric_id = ? AND version = ? LIMIT 1`,
    args: [rowString(suite, "rubric_id"), rowNumber(suite, "rubric_version")],
  });
  const rubricJson = rowString(rubricResult.rows[0] as QueryRow, "rubric_json");
  if (!rubricJson) throw new Error("Suite rubric is missing.");
  const frozenCases = [];
  for (const rawCase of cases.rows) {
    const assuranceCase = rawCase as QueryRow;
    const artifactIds = [
      rowString(assuranceCase, "baseline_artifact_id")!,
      rowString(assuranceCase, "candidate_artifact_id")!,
      ...(JSON.parse(rowString(assuranceCase, "context_artifact_ids_json")!) as string[]),
    ];
    const artifacts = await Promise.all(artifactIds.map(id => requireArtifact(rowString(suite, "project_id")!, id)));
    frozenCases.push({
      caseId: rowString(assuranceCase, "case_id"),
      position: rowNumber(assuranceCase, "position"),
      title: rowString(assuranceCase, "title"),
      instructions: rowString(assuranceCase, "instructions"),
      objectiveReference: rowString(assuranceCase, "objective_reference"),
      artifacts: artifacts.map(artifact => ({
        artifactId: rowString(artifact, "artifact_id"),
        role: rowString(artifact, "role"),
        digest: rowString(artifact, "digest"),
        contentType: rowString(artifact, "content_type"),
        rendererPolicy: rowString(artifact, "renderer_policy"),
      })),
    });
  }
  const manifest = {
    schemaVersion: HUMAN_ASSURANCE_SCHEMA_VERSION,
    kind: "suite_manifest",
    suiteId: input.suiteId,
    version: input.suiteVersion,
    projectId: rowString(suite, "project_id"),
    rubric: JSON.parse(rubricJson),
    cases: frozenCases,
  };
  const manifestJson = canonicalizeHumanAssuranceDocument(manifest);
  const manifestHash = hashHumanAssuranceDocument(manifest);
  const result = await dbClient.execute({
    sql: `UPDATE tokenless_assurance_suites
          SET status = 'frozen', manifest_hash = ?, manifest_json = ?,
              frozen_at = ?, updated_at = ?
          WHERE suite_id = ? AND version = ? AND status = 'draft'`,
    args: [manifestHash, manifestJson, new Date(), new Date(), input.suiteId, input.suiteVersion],
  });
  if (result.rowCount !== 1) {
    throw new TokenlessServiceError("The suite changed while it was being frozen.", 409, "assurance_suite_conflict");
  }
  return { manifestHash, status: "frozen" as const };
}

export async function createAssuranceAudiencePolicy(input: {
  principal: AssurancePrincipal;
  projectId: string;
  policy: AudiencePolicyDefinition;
}) {
  await requireProjectAccess(input.principal, input.projectId, { active: true });
  const policyId = `haa_${randomUUID().replaceAll("-", "")}`;
  const version = 1;
  const policy = parseHumanAssuranceAudiencePolicy({
    ...input.policy,
    schemaVersion: HUMAN_ASSURANCE_SCHEMA_VERSION,
    policyId,
    version,
  });
  const policyJson = canonicalizeHumanAssuranceDocument(policy);
  const policyHash = hashHumanAssuranceDocument(policy);
  const now = new Date();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_audience_policies
          (policy_id, project_id, version, reviewer_source, compensation,
           cohorts_json, selection, fallbacks_json,
           required_qualifications_json, assurance_json, buyer_privacy_json,
           legal_eligibility_required, policy_hash, policy_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      policyId,
      input.projectId,
      version,
      policy.reviewerSource,
      policy.compensation,
      JSON.stringify(policy.cohorts),
      policy.selection,
      JSON.stringify(policy.fallbacks),
      JSON.stringify(policy.requiredQualifications),
      JSON.stringify(policy.assurance),
      JSON.stringify(policy.buyerPrivacy),
      policy.legalEligibilityRequired,
      policyHash,
      policyJson,
      now,
    ],
  });
  return { policy, policyHash };
}

export async function createAssuranceRun(input: {
  principal: AssurancePrincipal;
  suiteId: string;
  suiteVersion: number;
  audiencePolicyId: string;
  audiencePolicyVersion: number;
  previousRunId?: string;
}) {
  const suite = await loadSuiteForWrite(input.principal, input.suiteId, input.suiteVersion);
  if (rowString(suite, "status") !== "frozen" || !rowString(suite, "manifest_hash")) {
    throw new TokenlessServiceError("Runs require a frozen suite.", 409, "assurance_suite_not_frozen");
  }
  const projectId = rowString(suite, "project_id")!;
  const policyResult = await dbClient.execute({
    sql: `SELECT project_id, policy_hash FROM tokenless_assurance_audience_policies
          WHERE policy_id = ? AND version = ? LIMIT 1`,
    args: [input.audiencePolicyId, input.audiencePolicyVersion],
  });
  const policy = policyResult.rows[0] as QueryRow | undefined;
  if (!policy || rowString(policy, "project_id") !== projectId) {
    throw new TokenlessServiceError(
      "Audience policy not found in this project.",
      400,
      "invalid_assurance_audience_policy",
    );
  }
  if (input.previousRunId) {
    const previous = await dbClient.execute({
      sql: `SELECT project_id, status FROM tokenless_assurance_runs
            WHERE run_id = ? LIMIT 1`,
      args: [input.previousRunId],
    });
    const previousRow = previous.rows[0] as QueryRow | undefined;
    if (rowString(previousRow, "project_id") !== projectId || rowString(previousRow, "status") !== "completed") {
      throw new TokenlessServiceError(
        "The previous run must be completed in the same project.",
        400,
        "invalid_previous_assurance_run",
      );
    }
  }
  const runId = `hau_${randomUUID().replaceAll("-", "")}`;
  const now = new Date();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_runs
          (run_id, project_id, suite_id, suite_version, audience_policy_id,
           audience_policy_version, status, policy_hash, previous_run_id,
           created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`,
    args: [
      runId,
      projectId,
      input.suiteId,
      input.suiteVersion,
      input.audiencePolicyId,
      input.audiencePolicyVersion,
      rowString(policy, "policy_hash"),
      input.previousRunId ?? null,
      principalLabel(input.principal),
      now,
      now,
    ],
  });
  return { projectId, runId, status: "draft" as const };
}

async function loadRunForWrite(principal: AssurancePrincipal, runId: string) {
  const result = await dbClient.execute({
    sql: `SELECT * FROM tokenless_assurance_runs WHERE run_id = ? LIMIT 1`,
    args: [runId],
  });
  const row = result.rows[0] as QueryRow | undefined;
  const projectId = rowString(row, "project_id");
  if (!projectId) {
    throw new TokenlessServiceError("Assurance run not found.", 404, "assurance_run_not_found");
  }
  await requireProjectAccess(principal, projectId, { active: true });
  return row!;
}

type AssuranceCompletionSource = {
  assigned: number;
  completedAssignments: number;
  paidAssignments: number;
  responses: number;
  settledResponses: number;
  targetReviewers: number;
  validResponses: number;
};

type AssuranceCompletionState = {
  cases: QueryRow[];
  policyCompensation: string;
  policyReviewerSource: string;
  terminalSettlementCaseIds: Set<string>;
  sources: Map<string, AssuranceCompletionSource>;
};

function completionError(message: string, code: string): never {
  throw new TokenlessServiceError(message, 409, code);
}

function completionSource(map: Map<string, AssuranceCompletionSource>, source: string) {
  const existing = map.get(source);
  if (existing) return existing;
  const created: AssuranceCompletionSource = {
    assigned: 0,
    completedAssignments: 0,
    paidAssignments: 0,
    responses: 0,
    settledResponses: 0,
    targetReviewers: 0,
    validResponses: 0,
  };
  map.set(source, created);
  return created;
}

async function loadAssuranceCompletionState(client: PoolClient, runId: string): Promise<AssuranceCompletionState> {
  const runResult = await client.query(
    `SELECT r.status, r.policy_hash, p.policy_hash AS current_policy_hash,
            p.compensation, p.reviewer_source
     FROM tokenless_assurance_runs r
     JOIN tokenless_assurance_audience_policies p
       ON p.policy_id = r.audience_policy_id AND p.version = r.audience_policy_version
     WHERE r.run_id = $1 LIMIT 1 FOR UPDATE`,
    [runId],
  );
  const run = runResult.rows[0] as QueryRow | undefined;
  if (
    !run ||
    rowString(run, "status") !== "aggregating" ||
    rowString(run, "policy_hash") !== rowString(run, "current_policy_hash")
  ) {
    completionError("Only an aggregating run with its exact frozen policy can complete.", "assurance_run_not_terminal");
  }
  const [caseResult, subpanelResult, assignmentResult, responseResult, terminalSettlementResult] = await Promise.all([
    client.query(
      `SELECT case_id, round_id, round_status, deterministic_checks_status
       FROM tokenless_assurance_run_cases WHERE run_id = $1 ORDER BY position ASC FOR UPDATE`,
      [runId],
    ),
    client.query(
      `SELECT source, SUM(target_count) AS target_reviewers
       FROM tokenless_assurance_run_subpanels WHERE run_id = $1 GROUP BY source`,
      [runId],
    ),
    client.query(
      `SELECT source, paid_assignment, status, COUNT(*) AS count
       FROM tokenless_assurance_assignments WHERE run_id = $1
       GROUP BY source, paid_assignment, status`,
      [runId],
    ),
    client.query(
      `SELECT reviewer_source, validity, settlement_reference
       FROM tokenless_assurance_responses WHERE run_id = $1`,
      [runId],
    ),
    client.query(
      `SELECT rc.case_id, rc.round_id AS case_round_id,
              ce.round_id AS execution_round_id, ce.state AS execution_state,
              te.round_id AS event_round_id, te.event_type
       FROM tokenless_assurance_run_cases rc
       LEFT JOIN tokenless_chain_executions ce ON ce.content_id = rc.content_id
       LEFT JOIN tokenless_transparency_events te ON te.operation_key = ce.operation_key
       WHERE rc.run_id = $1`,
      [runId],
    ),
  ]);
  if (caseResult.rows.length === 0 || subpanelResult.rows.length === 0) {
    completionError("A run needs frozen cases and source subpanels before completion.", "assurance_run_not_terminal");
  }
  const sources = new Map<string, AssuranceCompletionSource>();
  for (const raw of subpanelResult.rows) {
    const row = raw as QueryRow;
    const source = rowString(row, "source")!;
    completionSource(sources, source).targetReviewers = rowNumber(row, "target_reviewers") ?? -1;
  }
  for (const raw of assignmentResult.rows) {
    const row = raw as QueryRow;
    const source = rowString(row, "source")!;
    const state = sources.get(source);
    if (!state) completionError("An assignment is outside the frozen source panels.", "assurance_responses_incomplete");
    const count = rowNumber(row, "count") ?? -1;
    state.assigned += count;
    if (rowString(row, "status") === "completed") state.completedAssignments += count;
    if (row.paid_assignment === true) state.paidAssignments += count;
  }
  for (const raw of responseResult.rows) {
    const row = raw as QueryRow;
    const source = rowString(row, "reviewer_source")!;
    const state = sources.get(source);
    if (!state) completionError("A response is outside the frozen source panels.", "assurance_responses_incomplete");
    state.responses += 1;
    if (rowString(row, "validity") === "valid") state.validResponses += 1;
    if (rowString(row, "settlement_reference")?.trim()) state.settledResponses += 1;
  }
  const terminalSettlementCaseIds = new Set<string>();
  for (const raw of terminalSettlementResult.rows) {
    const row = raw as QueryRow;
    const caseRoundId = rowString(row, "case_round_id");
    if (
      caseRoundId &&
      caseRoundId === rowString(row, "execution_round_id") &&
      caseRoundId === rowString(row, "event_round_id") &&
      rowString(row, "execution_state") === "confirmed" &&
      ["RoundTerminal", "round.terminal", "round.finalized"].includes(rowString(row, "event_type") ?? "")
    ) {
      terminalSettlementCaseIds.add(rowString(row, "case_id")!);
    }
  }
  return {
    cases: caseResult.rows as QueryRow[],
    policyCompensation: rowString(run, "compensation")!,
    policyReviewerSource: rowString(run, "reviewer_source")!,
    terminalSettlementCaseIds,
    sources,
  };
}

function assertResponseCompletion(state: AssuranceCompletionState) {
  const caseCount = state.cases.length;
  let paidSourceCount = 0;
  for (const [source, counts] of state.sources) {
    if (!Number.isSafeInteger(counts.targetReviewers) || counts.targetReviewers < 1) {
      completionError("Every frozen source must target at least one reviewer.", "assurance_responses_incomplete");
    }
    if (
      counts.assigned !== counts.targetReviewers ||
      counts.completedAssignments !== counts.targetReviewers ||
      counts.responses !== counts.targetReviewers * caseCount ||
      counts.validResponses !== counts.responses
    ) {
      completionError(
        `Every expected ${source} reviewer-case judgment must be valid before completion.`,
        "assurance_responses_incomplete",
      );
    }
    if (counts.paidAssignments !== 0 && counts.paidAssignments !== counts.assigned) {
      completionError(
        "A frozen source cannot mix paid and unpaid assignments.",
        "assurance_paid_settlement_incomplete",
      );
    }
    if (counts.paidAssignments > 0) {
      paidSourceCount += 1;
      if (counts.settledResponses !== counts.responses) {
        completionError(
          "Every paid reviewer-case judgment needs a terminal settlement receipt before completion.",
          "assurance_paid_settlement_incomplete",
        );
      }
    } else if (counts.settledResponses !== 0) {
      completionError(
        "Unpaid reviewer-case judgments must not claim settlement receipts.",
        "assurance_settlement_mismatch",
      );
    }
  }
  if (
    (state.policyCompensation === "unpaid" && paidSourceCount !== 0) ||
    (state.policyCompensation === "paid" && paidSourceCount !== state.sources.size) ||
    (state.policyCompensation === "mixed" && (paidSourceCount === 0 || paidSourceCount === state.sources.size))
  ) {
    completionError("Assignment compensation does not match the frozen policy.", "assurance_settlement_mismatch");
  }
  return paidSourceCount > 0;
}

function assertRunCasesTerminal(state: AssuranceCompletionState, hasPaidSources: boolean) {
  for (const row of state.cases) {
    if (rowString(row, "deterministic_checks_status") === "pending") {
      completionError("Deterministic checks must finish before completion.", "assurance_run_not_terminal");
    }
    const status = rowString(row, "round_status");
    const roundId = rowString(row, "round_id");
    if (hasPaidSources) {
      if (!roundId || !ONCHAIN_TERMINAL_CASE_STATUSES.has(status ?? "")) {
        completionError("Every paid case needs a terminal bound round.", "assurance_run_not_terminal");
      }
      if (!state.terminalSettlementCaseIds.has(rowString(row, "case_id")!)) {
        completionError(
          "Every paid case needs a stored terminal settlement receipt.",
          "assurance_paid_settlement_incomplete",
        );
      }
    } else if (status !== "offchain_complete" || roundId) {
      completionError("Unpaid invited cases must end explicitly off-chain.", "assurance_run_not_terminal");
    }
  }
}

export async function completeUnpaidInvitedAssuranceCases(input: { principal: AssurancePrincipal; runId: string }) {
  await loadRunForWrite(input.principal, input.runId);
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const state = await loadAssuranceCompletionState(client, input.runId);
    if (
      state.policyCompensation !== "unpaid" ||
      state.policyReviewerSource !== "customer_invited" ||
      [...state.sources.keys()].some(source => source !== "customer_invited") ||
      [...state.sources.values()].some(source => source.paidAssignments !== 0)
    ) {
      completionError(
        "Only a strictly unpaid customer-invited run can complete without chain settlement.",
        "assurance_offchain_completion_forbidden",
      );
    }
    assertResponseCompletion(state);
    if (
      state.cases.some(
        row =>
          !["planned", "offchain_complete"].includes(rowString(row, "round_status") ?? "") ||
          Boolean(rowString(row, "round_id")),
      )
    ) {
      completionError(
        "An on-chain case cannot be converted to off-chain completion.",
        "assurance_offchain_completion_forbidden",
      );
    }
    const now = new Date();
    await client.query(
      `UPDATE tokenless_assurance_run_cases
       SET round_status = 'offchain_complete', updated_at = $1
       WHERE run_id = $2 AND round_status = 'planned' AND round_id IS NULL`,
      [now, input.runId],
    );
    await client.query("COMMIT");
    return { runId: input.runId, caseCount: state.cases.length, status: "offchain_complete" as const };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function completeAssuranceRun(principal: AssurancePrincipal, runId: string) {
  await loadRunForWrite(principal, runId);
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const state = await loadAssuranceCompletionState(client, runId);
    const hasPaidSources = assertResponseCompletion(state);
    assertRunCasesTerminal(state, hasPaidSources);
    const now = new Date();
    const result = await client.query(
      `UPDATE tokenless_assurance_runs SET status = 'completed', updated_at = $1, completed_at = $1
       WHERE run_id = $2 AND status = 'aggregating'`,
      [now, runId],
    );
    if (result.rowCount !== 1) {
      completionError("The run changed while it was being completed.", "assurance_run_conflict");
    }
    await promoteCompletedRunGoldQualifications(client, runId, now);
    await recordAssuranceMechanismHealth(client, runId, now);
    await consumeWorkspaceUsageAllocations(client, runId, now);
    await client.query("COMMIT");
    return { runId, status: "completed" as const };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function freezeAssuranceRun(input: { principal: AssurancePrincipal; runId: string }) {
  const run = await loadRunForWrite(input.principal, input.runId);
  const existingHash = rowString(run, "manifest_hash");
  if (rowString(run, "status") === "frozen" && existingHash) {
    return { manifestHash: existingHash as `sha256:${string}`, status: "frozen" as const };
  }
  if (rowString(run, "status") !== "draft") {
    throw new TokenlessServiceError("This run cannot be frozen.", 409, "invalid_assurance_run_transition");
  }
  const [suiteResult, policyResult] = await Promise.all([
    dbClient.execute({
      sql: `SELECT manifest_hash FROM tokenless_assurance_suites
            WHERE suite_id = ? AND version = ? AND status = 'frozen' LIMIT 1`,
      args: [rowString(run, "suite_id"), rowNumber(run, "suite_version")],
    }),
    dbClient.execute({
      sql: `SELECT policy_hash FROM tokenless_assurance_audience_policies
            WHERE policy_id = ? AND version = ? LIMIT 1`,
      args: [rowString(run, "audience_policy_id"), rowNumber(run, "audience_policy_version")],
    }),
  ]);
  const suiteHash = rowString(suiteResult.rows[0] as QueryRow, "manifest_hash");
  const policyHash = rowString(policyResult.rows[0] as QueryRow, "policy_hash");
  if (!suiteHash || !policyHash || !HASH_PATTERN.test(suiteHash) || !HASH_PATTERN.test(policyHash)) {
    throw new Error("Run dependencies are not frozen correctly.");
  }
  const manifest = {
    schemaVersion: HUMAN_ASSURANCE_SCHEMA_VERSION,
    kind: "run_manifest",
    runId: input.runId,
    projectId: rowString(run, "project_id"),
    suite: {
      suiteId: rowString(run, "suite_id"),
      version: rowNumber(run, "suite_version"),
      manifestHash: suiteHash,
    },
    audiencePolicy: {
      policyId: rowString(run, "audience_policy_id"),
      version: rowNumber(run, "audience_policy_version"),
      policyHash,
    },
    previousRunId: rowString(run, "previous_run_id"),
  };
  const manifestJson = canonicalizeHumanAssuranceDocument(manifest);
  const manifestHash = hashHumanAssuranceDocument(manifest);
  const now = new Date();
  const updated = await dbClient.execute({
    sql: `UPDATE tokenless_assurance_runs
          SET status = 'frozen', manifest_hash = ?, manifest_json = ?,
              frozen_at = ?, updated_at = ?
          WHERE run_id = ? AND status = 'draft'`,
    args: [manifestHash, manifestJson, now, now, input.runId],
  });
  if (updated.rowCount !== 1) {
    throw new TokenlessServiceError("The run changed while it was being frozen.", 409, "assurance_run_conflict");
  }
  return { manifestHash, status: "frozen" as const };
}

export async function transitionAssuranceRun(input: {
  principal: AssurancePrincipal;
  runId: string;
  status: "recruiting" | "collecting" | "aggregating" | "completed" | "cancelled";
}) {
  if (input.status === "completed") return completeAssuranceRun(input.principal, input.runId);
  const run = await loadRunForWrite(input.principal, input.runId);
  const current = rowString(run, "status")!;
  if (!RUN_TRANSITIONS.get(current)?.has(input.status)) {
    throw new TokenlessServiceError(
      `Cannot move an assurance run from ${current} to ${input.status}.`,
      409,
      "invalid_assurance_run_transition",
    );
  }
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const now = new Date();
    if (input.status === "cancelled") {
      const protectedWork = await client.query(
        `SELECT
           (SELECT COUNT(*) FROM tokenless_assurance_assignments
            WHERE run_id = $1 AND status IN ('reserved', 'accepted', 'completed')) AS assignment_count,
           (SELECT COUNT(*) FROM tokenless_assurance_responses WHERE run_id = $1) AS response_count,
           (SELECT COUNT(*) FROM tokenless_assurance_run_cases
            WHERE run_id = $1 AND (round_id IS NOT NULL OR round_status <> 'planned')) AS started_case_count`,
        [input.runId],
      );
      const state = protectedWork.rows[0] as QueryRow | undefined;
      if (
        (rowNumber(state, "assignment_count") ?? 0) > 0 ||
        (rowNumber(state, "response_count") ?? 0) > 0 ||
        (rowNumber(state, "started_case_count") ?? 0) > 0
      ) {
        throw new TokenlessServiceError(
          "A run with reserved or accepted human work must continue to an authorized terminal path.",
          409,
          "assurance_run_cancellation_blocked",
        );
      }
    }
    const result = await client.query(
      `UPDATE tokenless_assurance_runs
       SET status = $1, updated_at = $2
       WHERE run_id = $3 AND status = $4`,
      [input.status, now, input.runId, current],
    );
    if (result.rowCount !== 1) {
      throw new TokenlessServiceError("The run changed while it was being advanced.", 409, "assurance_run_conflict");
    }
    if (input.status === "cancelled") {
      await releaseWorkspaceUsageAllocations(client, input.runId, now);
    }
    await client.query("COMMIT");
    return { runId: input.runId, status: input.status };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function archiveAssuranceProject(input: { principal: AssurancePrincipal; projectId: string }) {
  await requireProjectAccess(input.principal, input.projectId);
  const running = await dbClient.execute({
    sql: `SELECT run_id FROM tokenless_assurance_runs
          WHERE project_id = ? AND status NOT IN ('completed', 'cancelled') LIMIT 1`,
    args: [input.projectId],
  });
  if (running.rows.length > 0) {
    throw new TokenlessServiceError(
      "Complete or cancel draft runs before archiving the project.",
      409,
      "assurance_project_has_active_runs",
    );
  }
  await dbClient.execute({
    sql: `UPDATE tokenless_assurance_projects
          SET status = 'archived', updated_at = ?
          WHERE project_id = ? AND status = 'active'`,
    args: [new Date(), input.projectId],
  });
  return { projectId: input.projectId, status: "archived" as const };
}

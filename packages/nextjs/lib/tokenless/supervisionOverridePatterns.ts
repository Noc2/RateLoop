import type { PoolClient } from "pg";
import "server-only";
import { dbPool } from "~~/lib/db";
import {
  type WorkspaceEmploymentDataGovernance,
  getWorkspaceEmploymentDataGovernance,
} from "~~/lib/tokenless/employmentDataGovernance";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const SUPERVISION_PATTERN_DEFAULT_MINIMUM_DENOMINATOR = 15;
export const SUPERVISION_PATTERN_MINIMUM_DENOMINATOR = 2;
export const SUPERVISION_PATTERN_MAXIMUM_DENOMINATOR = 10_000;

const OVERRIDE_OUTCOMES = ["accepted", "disregarded", "overridden", "reversed"] as const;
type OverrideOutcome = (typeof OVERRIDE_OUTCOMES)[number];
const OVERRIDE_OUTCOME_SET = new Set<string>(OVERRIDE_OUTCOMES);

type Row = Record<string, unknown>;

export type ScopeSupervisionPatternSource = {
  workspaceId: string;
  scopeId: string;
  agentId: string;
  workflowKey: string;
  riskTier: string;
};

export type OverrideDecisionPatternSource = {
  workspaceId: string;
  scopeId: string;
  runId: string;
  recordId: string;
  supersedesRecordId: string | null;
  outcome: OverrideOutcome;
};

export type ReviewerDisagreementPatternSource = {
  workspaceId: string;
  scopeId: string;
  comparable: boolean;
  agreement: "agree" | "disagree" | "abstain" | "inconclusive";
};

export type ReviewerAssignmentPatternSource = {
  workspaceId: string;
  scopeId: string;
  runId: string;
  assignmentId: string;
  reviewerReference: string;
};

export type SupervisionRateSignal =
  | {
      status: "sufficient_support";
      numerator: number;
      denominator: number;
      minimumDenominator: number;
      rateBps: number;
    }
  | {
      status: "insufficient_support";
      numerator: number;
      denominator: number;
      minimumDenominator: number;
      rateBps: null;
    };

export type ScopeSupervisionPattern = ScopeSupervisionPatternSource & {
  currentDecisionCounts: Record<OverrideOutcome, number>;
  decisionOwnerOverride: SupervisionRateSignal;
  operationalReversal: SupervisionRateSignal;
  reviewerDisagreement: SupervisionRateSignal;
  supersessionCount: number;
};

export type ReviewerSupervisionPattern = {
  reviewerReference: string;
  scopeId: string;
  completedAssignmentCount: number;
  decisionOwnerOverrideAssociation: SupervisionRateSignal;
  operationalReversalAssociation: SupervisionRateSignal;
};

export type SupervisionPatternSources = {
  scopes: ScopeSupervisionPatternSource[];
  overrideDecisions: OverrideDecisionPatternSource[];
  reviewerDisagreements: ReviewerDisagreementPatternSource[];
  reviewerAssignments?: ReviewerAssignmentPatternSource[];
};

export type ScopeSupervisionPatternReport = {
  schemaVersion: "rateloop.scope-supervision-patterns.v1";
  workspaceId: string;
  projection: "scope";
  employmentGovernanceVersion: number;
  minimumDenominator: number;
  scopes: ScopeSupervisionPattern[];
};

export type ReviewerSupervisionPatternReport = {
  schemaVersion: "rateloop.reviewer-supervision-patterns.v1";
  workspaceId: string;
  projection: "reviewer";
  employmentGovernanceVersion: number;
  minimumDenominator: number;
  scopes: ScopeSupervisionPattern[];
  reviewers: ReviewerSupervisionPattern[];
};

function text(row: Row | undefined, field: string) {
  const value = row?.[field];
  return value === null || value === undefined ? null : String(value);
}

function requiredText(row: Row | undefined, field: string) {
  const value = text(row, field);
  if (!value) {
    throw new TokenlessServiceError(
      "Stored supervision-pattern evidence is invalid.",
      500,
      "stored_supervision_pattern_invalid",
    );
  }
  return value;
}

function minimumDenominator(value: number | undefined) {
  const normalized = value ?? SUPERVISION_PATTERN_DEFAULT_MINIMUM_DENOMINATOR;
  if (
    !Number.isSafeInteger(normalized) ||
    normalized < SUPERVISION_PATTERN_MINIMUM_DENOMINATOR ||
    normalized > SUPERVISION_PATTERN_MAXIMUM_DENOMINATOR
  ) {
    throw new TokenlessServiceError(
      `minimumDenominator must be an integer from ${SUPERVISION_PATTERN_MINIMUM_DENOMINATOR} to ${SUPERVISION_PATTERN_MAXIMUM_DENOMINATOR}.`,
      400,
      "invalid_supervision_pattern_denominator",
      false,
      "minimumDenominator",
    );
  }
  return normalized;
}

function rateSignal(numerator: number, denominator: number, minimum: number): SupervisionRateSignal {
  if (denominator < minimum) {
    return {
      status: "insufficient_support",
      numerator,
      denominator,
      minimumDenominator: minimum,
      rateBps: null,
    };
  }
  return {
    status: "sufficient_support",
    numerator,
    denominator,
    minimumDenominator: minimum,
    rateBps: Math.floor((numerator * 10_000) / denominator),
  };
}

function emptyOutcomeCounts(): Record<OverrideOutcome, number> {
  return { accepted: 0, disregarded: 0, overridden: 0, reversed: 0 };
}

function currentDecisions(rows: OverrideDecisionPatternSource[]) {
  const superseded = new Set(
    rows.map(row => row.supersedesRecordId).filter((recordId): recordId is string => recordId !== null),
  );
  return rows.filter(row => !superseded.has(row.recordId));
}

function scopeKey(workspaceId: string, scopeId: string) {
  return `${workspaceId}\u0000${scopeId}`;
}

function runKey(workspaceId: string, scopeId: string, runId: string) {
  return `${scopeKey(workspaceId, scopeId)}\u0000${runId}`;
}

/**
 * Produces privacy-safe scope patterns from append-only source events. A
 * decision-owner override means the current outcome is `disregarded` or
 * `overridden`; a later operational `reversed` outcome remains a separate
 * signal. Historical supersession events never enter either rate numerator.
 */
export function detectScopeSupervisionPatterns(input: {
  workspaceId: string;
  minimumDenominator?: number;
  sources: SupervisionPatternSources;
}): ScopeSupervisionPattern[] {
  const minimum = minimumDenominator(input.minimumDenominator);
  const scopes = input.sources.scopes.filter(scope => scope.workspaceId === input.workspaceId);
  const knownScopes = new Set(scopes.map(scope => scopeKey(scope.workspaceId, scope.scopeId)));
  const overrides = input.sources.overrideDecisions.filter(
    row => row.workspaceId === input.workspaceId && knownScopes.has(scopeKey(row.workspaceId, row.scopeId)),
  );
  const disagreements = input.sources.reviewerDisagreements.filter(
    row => row.workspaceId === input.workspaceId && knownScopes.has(scopeKey(row.workspaceId, row.scopeId)),
  );

  return scopes
    .map(scope => {
      const scopeOverrides = overrides.filter(row => row.scopeId === scope.scopeId);
      const heads = currentDecisions(scopeOverrides);
      const counts = emptyOutcomeCounts();
      for (const decision of heads) counts[decision.outcome] += 1;
      const decisionDenominator = heads.length;
      const comparableDisagreements = disagreements.filter(
        row =>
          row.scopeId === scope.scopeId &&
          row.comparable &&
          (row.agreement === "agree" || row.agreement === "disagree"),
      );
      return {
        ...scope,
        currentDecisionCounts: counts,
        decisionOwnerOverride: rateSignal(counts.disregarded + counts.overridden, decisionDenominator, minimum),
        operationalReversal: rateSignal(counts.reversed, decisionDenominator, minimum),
        reviewerDisagreement: rateSignal(
          comparableDisagreements.filter(row => row.agreement === "disagree").length,
          comparableDisagreements.length,
          minimum,
        ),
        supersessionCount: scopeOverrides.filter(row => row.supersedesRecordId !== null).length,
      } satisfies ScopeSupervisionPattern;
    })
    .sort((left, right) => left.scopeId.localeCompare(right.scopeId));
}

function detectReviewerSupervisionPatterns(input: {
  workspaceId: string;
  minimumDenominator: number;
  assignments: ReviewerAssignmentPatternSource[];
  overrideDecisions: OverrideDecisionPatternSource[];
}) {
  const assignments = input.assignments.filter(row => row.workspaceId === input.workspaceId);
  const knownRunKeys = new Set(assignments.map(row => runKey(row.workspaceId, row.scopeId, row.runId)));
  const currentByRun = new Map(
    currentDecisions(
      input.overrideDecisions.filter(
        row =>
          row.workspaceId === input.workspaceId && knownRunKeys.has(runKey(row.workspaceId, row.scopeId, row.runId)),
      ),
    ).map(row => [runKey(row.workspaceId, row.scopeId, row.runId), row] as const),
  );
  const byReviewerScope = new Map<string, ReviewerAssignmentPatternSource[]>();
  for (const assignment of assignments) {
    const key = `${assignment.reviewerReference}\u0000${assignment.scopeId}`;
    const rows = byReviewerScope.get(key) ?? [];
    rows.push(assignment);
    byReviewerScope.set(key, rows);
  }
  return [...byReviewerScope.entries()]
    .map(([key, rows]) => {
      const delimiter = key.indexOf("\u0000");
      const reviewerReference = key.slice(0, delimiter);
      const scopeId = key.slice(delimiter + 1);
      const associations = rows
        .map(row => currentByRun.get(runKey(row.workspaceId, row.scopeId, row.runId)))
        .filter((row): row is OverrideDecisionPatternSource => row !== undefined);
      return {
        reviewerReference,
        scopeId,
        completedAssignmentCount: rows.length,
        decisionOwnerOverrideAssociation: rateSignal(
          associations.filter(row => row.outcome === "disregarded" || row.outcome === "overridden").length,
          associations.length,
          input.minimumDenominator,
        ),
        operationalReversalAssociation: rateSignal(
          associations.filter(row => row.outcome === "reversed").length,
          associations.length,
          input.minimumDenominator,
        ),
      } satisfies ReviewerSupervisionPattern;
    })
    .sort(
      (left, right) =>
        left.scopeId.localeCompare(right.scopeId) || left.reviewerReference.localeCompare(right.reviewerReference),
    );
}

function scopeFromRow(row: Row): ScopeSupervisionPatternSource {
  return {
    workspaceId: requiredText(row, "workspace_id"),
    scopeId: requiredText(row, "scope_id"),
    agentId: requiredText(row, "agent_id"),
    workflowKey: requiredText(row, "workflow_key"),
    riskTier: requiredText(row, "risk_tier"),
  };
}

function overrideFromRow(row: Row): OverrideDecisionPatternSource {
  const outcome = requiredText(row, "outcome");
  if (!OVERRIDE_OUTCOME_SET.has(outcome)) {
    throw new TokenlessServiceError(
      "Stored supervision-pattern evidence is invalid.",
      500,
      "stored_supervision_pattern_invalid",
    );
  }
  return {
    workspaceId: requiredText(row, "workspace_id"),
    scopeId: requiredText(row, "scope_id"),
    runId: requiredText(row, "run_id"),
    recordId: requiredText(row, "record_id"),
    supersedesRecordId: text(row, "supersedes_record_id"),
    outcome: outcome as OverrideOutcome,
  };
}

function disagreementFromRow(row: Row): ReviewerDisagreementPatternSource {
  const agreement = requiredText(row, "agreement");
  if (!["agree", "disagree", "abstain", "inconclusive"].includes(agreement)) {
    throw new TokenlessServiceError(
      "Stored supervision-pattern evidence is invalid.",
      500,
      "stored_supervision_pattern_invalid",
    );
  }
  return {
    workspaceId: requiredText(row, "workspace_id"),
    scopeId: requiredText(row, "scope_id"),
    comparable: row.comparable === true,
    agreement: agreement as ReviewerDisagreementPatternSource["agreement"],
  };
}

function assignmentFromRow(row: Row): ReviewerAssignmentPatternSource {
  return {
    workspaceId: requiredText(row, "workspace_id"),
    scopeId: requiredText(row, "scope_id"),
    runId: requiredText(row, "run_id"),
    assignmentId: requiredText(row, "assignment_id"),
    reviewerReference: requiredText(row, "reviewer_account_address"),
  };
}

async function loadScopeSources(client: PoolClient, workspaceId: string): Promise<SupervisionPatternSources> {
  const [scopeResult, overrideResult, disagreementResult] = await Promise.all([
    client.query(
      `SELECT workspace_id,scope_id,agent_id,workflow_key,risk_tier
       FROM tokenless_agent_evaluation_scopes WHERE workspace_id=$1`,
      [workspaceId],
    ),
    client.query(
      `SELECT opportunity.workspace_id,opportunity.scope_id,opportunity.run_id,
              decision.record_id,decision.supersedes_record_id,decision.outcome
       FROM tokenless_agent_review_opportunities opportunity
       JOIN tokenless_assurance_override_decisions decision
         ON decision.workspace_id=opportunity.workspace_id AND decision.run_id=opportunity.run_id
       WHERE opportunity.workspace_id=$1 AND opportunity.run_id IS NOT NULL`,
      [workspaceId],
    ),
    client.query(
      `SELECT workspace_id,scope_id,comparable,agreement
       FROM tokenless_agent_evaluation_observations WHERE workspace_id=$1`,
      [workspaceId],
    ),
  ]);
  return {
    scopes: scopeResult.rows.map(row => scopeFromRow(row as Row)),
    overrideDecisions: overrideResult.rows.map(row => overrideFromRow(row as Row)),
    reviewerDisagreements: disagreementResult.rows.map(row => disagreementFromRow(row as Row)),
  };
}

async function loadReviewerAssignments(client: PoolClient, workspaceId: string) {
  const result = await client.query(
    `SELECT opportunity.workspace_id,opportunity.scope_id,opportunity.run_id,
            assignment.assignment_id,assignment.reviewer_account_address
     FROM tokenless_agent_review_opportunities opportunity
     JOIN tokenless_assurance_assignments assignment
       ON assignment.workspace_id=opportunity.workspace_id AND assignment.run_id=opportunity.run_id
     WHERE opportunity.workspace_id=$1 AND opportunity.run_id IS NOT NULL
       AND assignment.status='completed'`,
    [workspaceId],
  );
  return result.rows.map(row => assignmentFromRow(row as Row));
}

function reviewerAnalyticsIsActive(governance: WorkspaceEmploymentDataGovernance) {
  return (
    governance.processingMode === "reviewer_analytics" &&
    governance.reviewerAnalyticsActivationGaps.length === 0 &&
    governance.reviewerAnalyticsActivatedAt !== null &&
    governance.reviewerAnalyticsActivatedBy !== null &&
    (governance.worksCouncilStatus === "agreement_recorded" || governance.worksCouncilStatus === "not_applicable")
  );
}

async function assertCurrentReviewerAnalyticsGovernance(
  client: PoolClient,
  workspaceId: string,
  expected: WorkspaceEmploymentDataGovernance,
) {
  const result = await client.query(
    `SELECT version,processing_mode,works_council_status,
            reviewer_analytics_activated_at,reviewer_analytics_activated_by
     FROM tokenless_workspace_employment_data_governance_versions
     WHERE workspace_id=$1 ORDER BY version DESC LIMIT 1`,
    [workspaceId],
  );
  const row = result.rows[0] as Row | undefined;
  if (
    Number(row?.version) !== expected.version ||
    text(row, "processing_mode") !== "reviewer_analytics" ||
    !["agreement_recorded", "not_applicable"].includes(text(row, "works_council_status") ?? "") ||
    !row?.reviewer_analytics_activated_at ||
    !text(row, "reviewer_analytics_activated_by")
  ) {
    throw new TokenlessServiceError(
      "Reviewer analytics are disabled until employment-data governance is complete.",
      409,
      "reviewer_analytics_disabled",
    );
  }
}

export async function getWorkspaceSupervisionPatterns(input: {
  accountAddress: string;
  workspaceId: string;
  projection?: "scope";
  minimumDenominator?: number;
}): Promise<ScopeSupervisionPatternReport>;
export async function getWorkspaceSupervisionPatterns(input: {
  accountAddress: string;
  workspaceId: string;
  projection: "reviewer";
  minimumDenominator?: number;
}): Promise<ReviewerSupervisionPatternReport>;
export async function getWorkspaceSupervisionPatterns(input: {
  accountAddress: string;
  workspaceId: string;
  projection?: "scope" | "reviewer";
  minimumDenominator?: number;
}): Promise<ScopeSupervisionPatternReport | ReviewerSupervisionPatternReport> {
  const minimum = minimumDenominator(input.minimumDenominator);
  const governance = await getWorkspaceEmploymentDataGovernance({
    accountAddress: input.accountAddress,
    workspaceId: input.workspaceId,
  });
  if (input.projection === "reviewer" && !reviewerAnalyticsIsActive(governance)) {
    // This check deliberately happens before the assignment query. Aggregate-only
    // mode neither computes nor returns any reviewer-level association.
    throw new TokenlessServiceError(
      "Reviewer analytics are disabled until employment-data governance is complete.",
      409,
      "reviewer_analytics_disabled",
    );
  }

  const client = await dbPool.connect();
  try {
    if (input.projection === "reviewer") {
      // Pin the governance version and source evidence to one read snapshot so
      // a concurrent aggregate-only update cannot race an identity projection.
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      // Governance updates serialize on this workspace row in 0166. Holding a
      // share lock keeps an analytics authorization from being switched off
      // between the final gate check and the identity-bearing projection.
      const lockedWorkspace = await client.query(
        "SELECT workspace_id FROM tokenless_workspaces WHERE workspace_id=$1 AND status='active' FOR SHARE",
        [input.workspaceId],
      );
      if (lockedWorkspace.rowCount !== 1) {
        throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
      }
      await assertCurrentReviewerAnalyticsGovernance(client, input.workspaceId, governance);
    }
    const sources = await loadScopeSources(client, input.workspaceId);
    const scopes = detectScopeSupervisionPatterns({
      workspaceId: input.workspaceId,
      minimumDenominator: minimum,
      sources,
    });
    if (input.projection !== "reviewer") {
      return {
        schemaVersion: "rateloop.scope-supervision-patterns.v1",
        workspaceId: input.workspaceId,
        projection: "scope",
        employmentGovernanceVersion: governance.version,
        minimumDenominator: minimum,
        scopes,
      };
    }
    const assignments = await loadReviewerAssignments(client, input.workspaceId);
    const report: ReviewerSupervisionPatternReport = {
      schemaVersion: "rateloop.reviewer-supervision-patterns.v1",
      workspaceId: input.workspaceId,
      projection: "reviewer",
      employmentGovernanceVersion: governance.version,
      minimumDenominator: minimum,
      scopes,
      reviewers: detectReviewerSupervisionPatterns({
        workspaceId: input.workspaceId,
        minimumDenominator: minimum,
        assignments,
        overrideDecisions: sources.overrideDecisions,
      }),
    };
    await client.query("COMMIT");
    return report;
  } catch (error) {
    if (input.projection === "reviewer") await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export const __supervisionOverridePatternTestUtils = {
  detectReviewerSupervisionPatterns,
  minimumDenominator,
};

import { createHash } from "node:crypto";
import "server-only";
import { isRateLoopPrincipalId, normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbPool } from "~~/lib/db";
import { appendAuditEvent } from "~~/lib/privacy/audit";
import { enqueueAssuranceAttestation } from "~~/lib/tokenless/assuranceAttestationPipeline";
import { summarizeOversightDesignationsForExport } from "~~/lib/tokenless/oversightAttestations";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import { TRAINING_RECORDS_SCHEMA_VERSION, buildTrainingRecordsPayload } from "~~/lib/tokenless/trainingRecordsExport";

type Row = Record<string, unknown>;

const EXPORT_SCHEMA_VERSION = "rateloop.assurance-coverage-export.v1" as const;
const DEFAULT_WINDOW_MS = 30 * 86_400_000;
const MAX_WINDOW_MS = 366 * 86_400_000;
const MAX_SCOPES = 500;
const MAX_SERIES_ROWS = 5_000;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Coverage evidence must be JSON serializable.");
  return encoded;
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}` as const;
}

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function requiredText(row: Row | undefined, key: string) {
  const value = text(row, key);
  if (!value) throw new Error(`Stored ${key} is invalid.`);
  return value;
}

function integer(row: Row | undefined, key: string) {
  const value = Number(row?.[key]);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Stored ${key} is invalid.`);
  return value;
}

function optionalInteger(row: Row | undefined, key: string) {
  return row?.[key] === null || row?.[key] === undefined ? null : integer(row, key);
}

function bool(row: Row | undefined, key: string) {
  if (row?.[key] === true || row?.[key] === "t" || row?.[key] === 1) return true;
  if (row?.[key] === false || row?.[key] === "f" || row?.[key] === 0) return false;
  throw new Error(`Stored ${key} is invalid.`);
}

function iso(row: Row | undefined, key: string) {
  const value = row?.[key];
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) throw new Error(`Stored ${key} is invalid.`);
  return parsed.toISOString();
}

function jsonObject(row: Row | undefined, key: string) {
  try {
    const parsed = JSON.parse(String(row?.[key])) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`Stored ${key} is invalid.`);
  }
}

function stringArray(row: Row | undefined, key: string) {
  try {
    const parsed = JSON.parse(String(row?.[key])) as unknown;
    if (!Array.isArray(parsed) || parsed.some(entry => typeof entry !== "string")) throw new Error();
    return parsed as string[];
  } catch {
    throw new Error(`Stored ${key} is invalid.`);
  }
}

function strictHash(row: Row | undefined, key: string) {
  const value = text(row, key);
  if (!value || !HASH_PATTERN.test(value)) throw new Error(`Stored ${key} is invalid.`);
  return value;
}

function normalizeBoundary(value: Date | undefined, fallback: Date, field: string) {
  const result = value ?? fallback;
  if (!Number.isFinite(result.getTime())) {
    throw new TokenlessServiceError(`${field} must be a valid timestamp.`, 400, "invalid_coverage_export_window");
  }
  return new Date(result.getTime());
}

function exportWindow(input: { from?: Date; to?: Date; now?: Date }) {
  const snapshotAt = normalizeBoundary(input.now, new Date(), "now");
  const end = normalizeBoundary(input.to, snapshotAt, "to");
  const start = normalizeBoundary(input.from, new Date(end.getTime() - DEFAULT_WINDOW_MS), "from");
  const duration = end.getTime() - start.getTime();
  if (end > snapshotAt || duration <= 0 || duration > MAX_WINDOW_MS) {
    throw new TokenlessServiceError(
      "Coverage exports require a positive window of at most 366 days ending no later than the snapshot time.",
      400,
      "invalid_coverage_export_window",
    );
  }
  return { snapshotAt, start, end };
}

function assertBounded(rows: Row[], name: string, maximum: number) {
  if (rows.length > maximum) {
    throw new TokenlessServiceError(
      `The coverage export contains too many ${name}; request a narrower time window.`,
      413,
      "coverage_export_too_large",
    );
  }
}

function groupByScope(rows: Row[]) {
  const grouped = new Map<string, Row[]>();
  for (const row of rows) {
    const scopeId = text(row, "scope_id");
    if (!scopeId) throw new Error("Stored scope_id is invalid.");
    grouped.set(scopeId, [...(grouped.get(scopeId) ?? []), row]);
  }
  return grouped;
}

function forcedReviewRules(row: Row, rules: Record<string, unknown>) {
  const mode = requiredText(row, "mode");
  const riskTiers = (field: string) => {
    const value = rules[field] ?? [];
    if (!Array.isArray(value) || value.some(entry => typeof entry !== "string")) {
      throw new Error("Stored review rules are invalid.");
    }
    return value as string[];
  };
  const storedMinimumConfidenceBps = rules.minimumConfidenceBps;
  if (
    storedMinimumConfidenceBps !== null &&
    storedMinimumConfidenceBps !== undefined &&
    (typeof storedMinimumConfidenceBps !== "number" ||
      !Number.isSafeInteger(storedMinimumConfidenceBps) ||
      storedMinimumConfidenceBps < 0 ||
      storedMinimumConfidenceBps > 10_000)
  ) {
    throw new Error("Stored review rules are invalid.");
  }
  const minimumConfidenceBps = storedMinimumConfidenceBps ?? null;
  return {
    everyEligibleOutput: mode === "always",
    manualOwnerHandoff: mode === "manual",
    criticalRisk: ["rules", "adaptive", "fixed"].includes(mode),
    criticalRiskTiers: riskTiers("criticalRiskTiers"),
    incompleteMetadata: ["rules", "adaptive", "fixed"].includes(mode),
    requiredRiskTiers: mode === "rules" ? riskTiers("requiredRiskTiers") : [],
    minimumConfidenceBps: ["rules", "adaptive", "fixed"].includes(mode) ? minimumConfidenceBps : null,
    maximumUnreviewedGap: ["adaptive", "fixed"].includes(mode) ? integer(row, "maximum_unreviewed_gap") : null,
    calibrationStage: mode === "adaptive",
  };
}

function decision(row: Row) {
  return {
    opportunityId: requiredText(row, "opportunity_id"),
    executionId: text(row, "execution_id"),
    decision: requiredText(row, "decision"),
    reviewRateBps: integer(row, "review_rate_bps"),
    selectionProbabilityBps: integer(row, "selection_probability_bps"),
    sampleBucket: integer(row, "sample_bucket"),
    samplerKeyVersion: requiredText(row, "sampler_key_version"),
    samplerCommitment: strictHash(row, "sampler_commitment"),
    reasonCodes: stringArray(row, "reason_codes_json"),
    status: requiredText(row, "status"),
    metadataComplete: bool(row, "metadata_complete"),
    criticalRisk: bool(row, "critical_risk"),
    declaredConfidenceBps: optionalInteger(row, "declared_confidence_bps"),
    sourceEvidenceReference: requiredText(row, "source_evidence_reference"),
    sourceEvidenceHash: strictHash(row, "source_evidence_hash"),
    suggestionCommitment: strictHash(row, "suggestion_commitment"),
    createdAt: iso(row, "created_at"),
    updatedAt: iso(row, "updated_at"),
  };
}

function observation(row: Row) {
  return {
    observationId: requiredText(row, "observation_id"),
    opportunityId: requiredText(row, "opportunity_id"),
    executionId: text(row, "execution_id"),
    operationKey: text(row, "operation_key"),
    runId: text(row, "run_id"),
    evidenceReference: requiredText(row, "evidence_reference"),
    sourcePayloadHash: strictHash(row, "source_payload_hash"),
    agentOutcomeCommitment: strictHash(row, "agent_outcome_commitment"),
    humanOutcomeCommitment: strictHash(row, "human_outcome_commitment"),
    agreement: requiredText(row, "agreement"),
    comparable: bool(row, "comparable"),
    respondingHumanCount: integer(row, "responding_human_count"),
    humanHumanAgreementBps: optionalInteger(row, "human_human_agreement_bps"),
    latencyMs: optionalInteger(row, "latency_ms"),
    costAtomic: text(row, "cost_atomic"),
    finalizedAt: iso(row, "finalized_at"),
  };
}

function rollup(row: Row) {
  return {
    rollupId: requiredText(row, "rollup_id"),
    windowStart: iso(row, "window_start"),
    windowEnd: iso(row, "window_end"),
    opportunityCount: integer(row, "opportunity_count"),
    reviewedCount: integer(row, "reviewed_count"),
    comparableCount: integer(row, "comparable_count"),
    agreementCount: integer(row, "agreement_count"),
    agreementBps: optionalInteger(row, "agreement_bps"),
    agreementLower95Bps: optionalInteger(row, "agreement_lower_95_bps"),
    metrics: jsonObject(row, "metrics_json"),
    sourceCommitment: strictHash(row, "source_commitment"),
    rebuiltAt: iso(row, "rebuilt_at"),
  };
}

/**
 * Privacy-safe override-decision aggregation: current (non-superseded) record
 * counts by outcome plus the derived override rate. Reasons text and deciding
 * accounts never enter the export.
 */
function overrideDecisionSummary(rows: Row[], window: { start: Date; end: Date }) {
  const supersededIds = new Set(
    rows.map(row => text(row, "supersedes_record_id")).filter((value): value is string => value !== null),
  );
  const byOutcome = { accepted: 0, disregarded: 0, overridden: 0, reversed: 0 };
  for (const row of rows) {
    if (supersededIds.has(text(row, "record_id")!)) continue;
    const decidedAt = new Date(iso(row, "decided_at"));
    if (decidedAt < window.start || decidedAt >= window.end) continue;
    const outcome = text(row, "outcome");
    if (outcome && outcome in byOutcome) byOutcome[outcome as keyof typeof byOutcome] += 1;
  }
  const decided = Object.values(byOutcome).reduce((sum, value) => sum + value, 0);
  return {
    decided,
    byOutcome,
    overrideRateBps: decided > 0 ? Math.floor(((byOutcome.overridden + byOutcome.reversed) * 10_000) / decided) : null,
  };
}

/**
 * Per-agent capability card for the export: owner-stated purpose and limits
 * plus declared metadata (host/owner-reported, not independently verified) and
 * the observed evaluation scopes. Deciding accounts never enter the export.
 */
function capabilityStatements(agentRows: Row[], versionRows: Row[], scopeRows: Row[]) {
  const latestVersionByAgent = new Map<string, Row>();
  for (const row of versionRows) {
    const agentId = text(row, "agent_id");
    if (agentId && !latestVersionByAgent.has(agentId)) latestVersionByAgent.set(agentId, row);
  }
  const scopesByAgent = new Map<string, Row[]>();
  for (const row of scopeRows) {
    const agentId = text(row, "agent_id");
    if (!agentId) continue;
    scopesByAgent.set(agentId, [...(scopesByAgent.get(agentId) ?? []), row]);
  }
  return agentRows.map(row => {
    const agentId = requiredText(row, "agent_id");
    const version = latestVersionByAgent.get(agentId);
    return {
      agentId,
      externalId: requiredText(row, "external_id"),
      status: requiredText(row, "status"),
      ownerStatement: {
        intendedPurpose: text(row, "intended_purpose"),
        knownLimitations: text(row, "known_limitations"),
        doNotUseConditions: text(row, "do_not_use_conditions"),
        updatedAt: row.capability_statement_updated_at ? iso(row, "capability_statement_updated_at") : null,
      },
      declared: {
        displayName: text(version, "display_name"),
        provider: text(version, "declared_provider"),
        model: text(version, "declared_model"),
        modelVersion: text(version, "declared_model_version"),
        deploymentName: text(version, "declared_deployment_name"),
        environment: text(version, "environment"),
        verification: "host_reported_not_independently_verified" as const,
      },
      observedScopes: (scopesByAgent.get(agentId) ?? []).map(scope => ({
        scopeId: requiredText(scope, "scope_id"),
        workflowKey: requiredText(scope, "workflow_key"),
        riskTier: requiredText(scope, "risk_tier"),
        stage: requiredText(scope, "stage"),
      })),
    };
  });
}

function stageTransition(row: Row) {
  return {
    eventId: requiredText(row, "event_id"),
    eventType: requiredText(row, "event_type"),
    fromStage: text(row, "from_stage"),
    toStage: text(row, "to_stage"),
    reasonCodes: stringArray(row, "reason_codes_json"),
    actorType: requiredText(row, "actor_type"),
    actorReference: requiredText(row, "actor_reference"),
    eventCommitment: strictHash(row, "event_commitment"),
    createdAt: iso(row, "created_at"),
  };
}

export async function exportAdaptiveCoverage(input: {
  accountAddress: string;
  workspaceId: string;
  from?: Date;
  to?: Date;
  now?: Date;
}) {
  let accountReference: string;
  try {
    accountReference = normalizeAccountSubject(input.accountAddress);
  } catch {
    throw new TokenlessServiceError("A valid signed-in account is required.", 401, "invalid_account");
  }
  const window = exportWindow(input);
  const client = await dbPool.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    const access = await client.query(
      `SELECT m.role FROM tokenless_workspace_members m
       JOIN tokenless_workspaces w ON w.workspace_id=m.workspace_id
       WHERE m.workspace_id=$1 AND m.account_address=$2 AND m.role IN ('owner','admin')
         AND w.status='active' LIMIT 1`,
      [input.workspaceId, accountReference],
    );
    if (!access.rows[0]) throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");

    const retentionResult = await client.query(
      `SELECT version,evidence_retention_months,audit_retention_months,basis_json,effective_at
       FROM tokenless_workspace_evidence_retention_policies
       WHERE workspace_id=$1 AND superseded_at IS NULL LIMIT 1`,
      [input.workspaceId],
    );
    const retentionRow = retentionResult.rows[0] as Row | undefined;
    if (!retentionRow) {
      throw new TokenlessServiceError("The workspace retention policy is unavailable.", 500, "retention_unavailable");
    }
    const retentionBasis = jsonObject(retentionRow, "basis_json");

    const scopesResult = await client.query(
      `SELECT s.*,p.mode,p.agreement_threshold_bps,p.production_floor_bps,p.fixed_rate_bps,
              p.maximum_unreviewed_gap,p.rules_json,p.audience_policy_json,p.publishing_policy_id
       FROM tokenless_agent_evaluation_scopes s
       JOIN tokenless_agent_review_policies p
         ON p.workspace_id=s.workspace_id AND p.policy_id=s.policy_id AND p.version=s.policy_version
       WHERE s.workspace_id=$1 ORDER BY s.scope_id ASC LIMIT ${MAX_SCOPES + 1}`,
      [input.workspaceId],
    );
    const decisionsResult = await client.query(
      `SELECT opportunity_id,scope_id,execution_id,decision,review_rate_bps,selection_probability_bps,
              sample_bucket,sampler_key_version,sampler_commitment,reason_codes_json,status,
              metadata_complete,critical_risk,declared_confidence_bps,source_evidence_reference,
              source_evidence_hash,suggestion_commitment,created_at,updated_at
       FROM tokenless_agent_review_opportunities
       WHERE workspace_id=$1 AND created_at >= $2 AND created_at < $3
       ORDER BY created_at ASC,opportunity_id ASC LIMIT ${MAX_SERIES_ROWS + 1}`,
      [input.workspaceId, window.start, window.end],
    );
    const observationsResult = await client.query(
      `SELECT observation_id,scope_id,opportunity_id,execution_id,operation_key,run_id,evidence_reference,
              source_payload_hash,agent_outcome_commitment,human_outcome_commitment,agreement,comparable,
              responding_human_count,human_human_agreement_bps,latency_ms,cost_atomic,finalized_at
       FROM tokenless_agent_evaluation_observations
       WHERE workspace_id=$1 AND finalized_at >= $2 AND finalized_at < $3
       ORDER BY finalized_at ASC,observation_id ASC LIMIT ${MAX_SERIES_ROWS + 1}`,
      [input.workspaceId, window.start, window.end],
    );
    const rollupsResult = await client.query(
      `SELECT rollup_id,scope_id,window_start,window_end,opportunity_count,reviewed_count,
              comparable_count,agreement_count,agreement_bps,agreement_lower_95_bps,metrics_json,
              source_commitment,rebuilt_at
       FROM tokenless_agent_evaluation_rollups
       WHERE workspace_id=$1 AND window_end >= $2 AND window_end < $3
       ORDER BY window_end ASC,rollup_id ASC LIMIT ${MAX_SERIES_ROWS + 1}`,
      [input.workspaceId, window.start, window.end],
    );
    const eventsResult = await client.query(
      `SELECT event_id,scope_id,event_type,from_stage,to_stage,reason_codes_json,actor_type,
              actor_reference,event_commitment,created_at
       FROM tokenless_agent_review_policy_events
       WHERE workspace_id=$1 AND event_type='stage_changed' AND created_at >= $2 AND created_at < $3
       ORDER BY created_at ASC,event_id ASC LIMIT ${MAX_SERIES_ROWS + 1}`,
      [input.workspaceId, window.start, window.end],
    );
    const oversightResult = await client.query(
      `SELECT account_address,authority_scope,status,attested_at,expires_at,training_records_json
       FROM tokenless_oversight_attestations
       WHERE workspace_id=$1
       ORDER BY account_address ASC`,
      [input.workspaceId],
    );
    const qualificationResult = await client.query(
      `SELECT qualification_id,rater_id,reviewer_account_address,reviewer_source,qualification_kind,
              qualification_keys_json,evidence_kind,verified_at,expires_at,status
       FROM tokenless_reviewer_qualifications WHERE workspace_id=$1
       ORDER BY qualification_id ASC LIMIT ${MAX_SERIES_ROWS + 1}`,
      [input.workspaceId],
    );
    const overridesResult = await client.query(
      `SELECT record_id,supersedes_record_id,outcome,decided_at
       FROM tokenless_assurance_override_decisions
       WHERE workspace_id=$1
       ORDER BY decided_at ASC,record_id ASC LIMIT ${MAX_SERIES_ROWS + 1}`,
      [input.workspaceId],
    );
    const agentsResult = await client.query(
      `SELECT agent_id,external_id,status,intended_purpose,known_limitations,do_not_use_conditions,
              capability_statement_updated_at
       FROM tokenless_agents WHERE workspace_id=$1 ORDER BY agent_id ASC`,
      [input.workspaceId],
    );
    const agentVersionsResult = await client.query(
      `SELECT agent_id,version_number,display_name,declared_provider,declared_model,
              declared_model_version,declared_deployment_name,environment
       FROM tokenless_agent_versions WHERE workspace_id=$1
       ORDER BY agent_id ASC,version_number DESC`,
      [input.workspaceId],
    );
    assertBounded(scopesResult.rows, "scopes", MAX_SCOPES);
    assertBounded(decisionsResult.rows, "decisions", MAX_SERIES_ROWS);
    assertBounded(observationsResult.rows, "observations", MAX_SERIES_ROWS);
    assertBounded(rollupsResult.rows, "rollups", MAX_SERIES_ROWS);
    assertBounded(eventsResult.rows, "stage transitions", MAX_SERIES_ROWS);
    assertBounded(overridesResult.rows, "override decisions", MAX_SERIES_ROWS);
    assertBounded(qualificationResult.rows, "reviewer qualifications", MAX_SERIES_ROWS);

    const decisionsByScope = groupByScope(decisionsResult.rows as Row[]);
    const observationsByScope = groupByScope(observationsResult.rows as Row[]);
    const rollupsByScope = groupByScope(rollupsResult.rows as Row[]);
    const eventsByScope = groupByScope(eventsResult.rows as Row[]);
    const scopes = (scopesResult.rows as Row[]).map(row => {
      const scopeId = requiredText(row, "scope_id");
      const rules = jsonObject(row, "rules_json");
      const policySnapshot = {
        policyId: requiredText(row, "policy_id"),
        policyVersion: integer(row, "policy_version"),
        mode: requiredText(row, "mode"),
        agreementThresholdBps: integer(row, "agreement_threshold_bps"),
        productionFloorBps: integer(row, "production_floor_bps"),
        fixedRateBps: optionalInteger(row, "fixed_rate_bps"),
        maximumUnreviewedGap: integer(row, "maximum_unreviewed_gap"),
        rules,
        audiencePolicy: jsonObject(row, "audience_policy_json"),
        publishingPolicyId: text(row, "publishing_policy_id"),
      };
      return {
        scopeId,
        agentId: requiredText(row, "agent_id"),
        agentVersionId: requiredText(row, "agent_version_id"),
        workflowKey: requiredText(row, "workflow_key"),
        riskTier: requiredText(row, "risk_tier"),
        audiencePolicyHash: strictHash(row, "audience_policy_hash"),
        partitionCommitment: strictHash(row, "partition_commitment"),
        executionProfileHash: strictHash(row, "execution_profile_hash"),
        humanReviewBinding: {
          id: requiredText(row, "human_review_binding_id"),
          version: integer(row, "human_review_binding_version"),
        },
        requestProfile: {
          id: requiredText(row, "request_profile_id"),
          version: integer(row, "request_profile_version"),
          hash: strictHash(row, "request_profile_hash"),
        },
        currentState: {
          stage: requiredText(row, "stage"),
          completedComparableCases: integer(row, "completed_comparable_cases"),
          stableCasesSinceStage: integer(row, "stable_cases_since_stage"),
          unreviewedSinceLastSample: integer(row, "unreviewed_since_last_sample"),
          stageEnteredAt: iso(row, "stage_entered_at"),
          observedAt: window.snapshotAt.toISOString(),
        },
        policySnapshot: { ...policySnapshot, hash: sha256(policySnapshot) },
        forcedReviewRules: forcedReviewRules(row, rules),
        decisions: (decisionsByScope.get(scopeId) ?? []).map(decision),
        observations: (observationsByScope.get(scopeId) ?? []).map(observation),
        rollups: (rollupsByScope.get(scopeId) ?? []).map(rollup),
        stageTransitions: (eventsByScope.get(scopeId) ?? []).map(stageTransition),
      };
    });
    const payload = {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      workspaceId: input.workspaceId,
      exportedAt: window.snapshotAt.toISOString(),
      boundaries: {
        startInclusive: window.start.toISOString(),
        endExclusive: window.end.toISOString(),
        snapshotAt: window.snapshotAt.toISOString(),
      },
      retention: {
        schemaVersion: "rateloop.workspace-evidence-retention.v1" as const,
        policyVersion: integer(retentionRow, "version"),
        evidenceRetentionMonths: integer(retentionRow, "evidence_retention_months"),
        auditRetentionMonths: integer(retentionRow, "audit_retention_months"),
        minimumRetentionMonths: 6 as const,
        basis: retentionBasis,
        effectiveAt: iso(retentionRow, "effective_at"),
      },
      limits: { maximumWindowDays: 366, maximumScopes: MAX_SCOPES, maximumRowsPerSeries: MAX_SERIES_ROWS },
      counts: {
        scopes: scopes.length,
        decisions: decisionsResult.rows.length,
        observations: observationsResult.rows.length,
        rollups: rollupsResult.rows.length,
        stageTransitions: eventsResult.rows.length,
      },
      oversightDesignations: summarizeOversightDesignationsForExport(oversightResult.rows as Row[], window.snapshotAt),
      overrideDecisions: overrideDecisionSummary(overridesResult.rows as Row[], window),
      trainingRecords: {
        schemaVersion: TRAINING_RECORDS_SCHEMA_VERSION,
        ...buildTrainingRecordsPayload({
          workspaceId: input.workspaceId,
          oversightRows: oversightResult.rows as Row[],
          qualificationRows: qualificationResult.rows as Row[],
          now: window.snapshotAt,
        }),
      },
      capabilityStatements: capabilityStatements(
        agentsResult.rows as Row[],
        agentVersionsResult.rows as Row[],
        scopesResult.rows as Row[],
      ),
      scopes,
    };
    const exported = { ...payload, exportDigest: sha256(payload) };
    await client.query("COMMIT");
    transactionOpen = false;
    await appendAuditEvent({
      workspaceId: input.workspaceId,
      actorKind: isRateLoopPrincipalId(accountReference) ? "principal" : "account",
      actorReference: accountReference,
      assuranceMethod: "rateloop_session",
      action: "assurance.coverage_export",
      targetKind: "assurance_coverage",
      targetId: input.workspaceId,
      purpose: "workspace_assurance_export",
      reason: "authorized_administrator_export",
      result: "success",
      metadata: {
        exportDigest: exported.exportDigest,
        startInclusive: exported.boundaries.startInclusive,
        endExclusive: exported.boundaries.endExclusive,
        scopeCount: exported.counts.scopes,
        decisionCount: exported.counts.decisions,
        observationCount: exported.counts.observations,
      },
      occurredAt: window.snapshotAt,
    });
    await enqueueAssuranceAttestation({
      workspaceId: input.workspaceId,
      kind: "coverage_export_head",
      artifactDigest: exported.exportDigest,
      artifactSchemaVersion: EXPORT_SCHEMA_VERSION,
      boundaryAt: window.snapshotAt,
      now: window.snapshotAt,
    });
    return exported;
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export const __adaptiveCoverageExportTestUtils = { canonicalJson, exportWindow, sha256 };

import { canonicalizeRfc8785, sha256Rfc8785 } from "@rateloop/node-utils/jcs";
import { createHash, createHmac, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbPool } from "~~/lib/db";
import { readEncryptedArtifact } from "~~/lib/tokenless/artifactPrivacy";
import {
  assuranceReviewerKey,
  getAssuranceResponseKeyrings,
  submitAssuranceResponses,
} from "~~/lib/tokenless/assuranceResponses";
import { issueDsaNamedPanelArtifactLease } from "~~/lib/tokenless/audienceAssignments";
import {
  type DsaBlindedCaseMapping,
  type DsaBlindedCasePayload,
  type DsaWithheldCaseValues,
  freezeDsaBlindedCaseMapping,
} from "~~/lib/tokenless/dsaBlindedCaseProjection";
import { assertDsaNamedPanelPrincipalEligible } from "~~/lib/tokenless/dsaNamedPanelEligibility";
import {
  DSA_NAMED_PANEL_MATERIALIZATION_COOLDOWN_MS,
  type DsaNamedPanelMaterializationStoredState,
  dsaNamedPanelMaterializationFailureState,
} from "~~/lib/tokenless/dsaNamedPanelMaterializationRetry";
import { dsaNamedPanelResponseEvidenceRoot } from "~~/lib/tokenless/dsaNamedPanelResponseRoot.mjs";
import {
  referenceOutcomeForNamedPanelPolicyChoice,
  referenceOutcomeForStoredAssuranceChoice,
  storedAssuranceChoiceForReferenceOutcome,
} from "~~/lib/tokenless/dsaReferenceOutcomes";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;
type CefrLevel = "B2" | "C1" | "C2";
type ReferenceLabel = "pass" | "fail" | "uncertain";

const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/u;
const EPOCH_ID = /^rse_[0-9a-f]{40}$/u;
const UNIT_ID = /^rsu_[A-Za-z0-9_-]{22}$/u;
const HASH = /^sha256:[0-9a-f]{64}$/u;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,159}$/u;
const CEFR_ORDER: readonly CefrLevel[] = ["B2", "C1", "C2"];
const ADJUDICATION_ARTIFACT_LEASE_TTL_MS = 10 * 60_000;
const DSA_NAMED_PANEL_RESPONSE_WINDOW_MS = 72 * 60 * 60_000;

function fail(message: string, code = "dsa_named_panel_invalid", status = 400): never {
  throw new TokenlessServiceError(message, status, code);
}

function notFound(): never {
  fail("DSA reference-panel assignment not found.", "dsa_named_panel_assignment_not_found", 404);
}

function actor(value: string) {
  try {
    return normalizeAccountSubject(value);
  } catch {
    fail("A valid signed-in account is required.", "invalid_account", 401);
  }
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

function instant(row: Row | undefined, key: string) {
  const value = row?.[key] instanceof Date ? (row[key] as Date) : new Date(String(row?.[key]));
  if (!Number.isFinite(value.getTime())) throw new Error(`Stored ${key} is invalid.`);
  return value;
}

function parseJson<T>(value: unknown, field: string) {
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    throw new Error(`Stored ${field} is invalid.`);
  }
}

function canonical(value: unknown) {
  try {
    return canonicalizeRfc8785(value);
  } catch {
    fail("DSA named-panel evidence is not canonicalizable.");
  }
}

function exactId(value: string, field: string, pattern = ID) {
  if (!pattern.test(value)) fail(`${field} is invalid.`);
  return value;
}

function adjudicatorLabelBinding(input: {
  workspaceId: string;
  epochId: string;
  unitId: string;
  adjudicationId: string;
  principalId: string;
}) {
  const encoded = process.env.TOKENLESS_EVIDENCE_TENANT_COMMITMENT_KEY?.trim() ?? "";
  const key = /^[A-Za-z0-9_-]{43}$/u.test(encoded) ? Buffer.from(encoded, "base64url") : Buffer.alloc(0);
  if (key.byteLength !== 32 || key.toString("base64url") !== encoded) {
    throw new TokenlessServiceError(
      "Evidence tenant commitments are unavailable.",
      503,
      "assurance_evidence_signing_unavailable",
      true,
    );
  }
  const domain = canonicalizeRfc8785({
    schemaVersion: "rateloop.dsa-adjudicator-label-binding.v1",
    workspaceId: input.workspaceId,
    epochId: input.epochId,
    unitId: input.unitId,
    adjudicationId: input.adjudicationId,
    principalId: input.principalId,
  });
  return `hmac-sha256:v1:${createHmac("sha256", key).update(domain, "utf8").digest("hex")}`;
}

async function transaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query(
      `SELECT set_config('lock_timeout','2s',true),set_config('statement_timeout','30s',true),
              set_config('idle_in_transaction_session_timeout','30s',true)`,
    );
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function databaseNow(client: PoolClient) {
  const result = await client.query("SELECT transaction_timestamp() AS now");
  return instant(result.rows[0] as Row | undefined, "now");
}

async function requireManager(client: PoolClient, principal: string, workspaceId: string, projectId: string) {
  const result = await client.query(
    `SELECT 1 FROM tokenless_workspace_members m
     JOIN tokenless_assurance_projects p ON p.workspace_id=m.workspace_id AND p.project_id=$3 AND p.status='active'
     WHERE m.workspace_id=$1 AND m.account_address=$2 AND m.role IN ('owner','admin') LIMIT 1`,
    [workspaceId, principal, projectId],
  );
  if (result.rowCount !== 1) notFound();
}

export async function registerDsaNamedPanelReferenceDefinition(input: {
  accountAddress: string;
  workspaceId: string;
  projectId: string;
  epochId: string;
  version: number;
  question: string;
  standardId: string;
  standardVersion: string;
  standardHash: string;
}) {
  const principal = actor(input.accountAddress);
  exactId(input.workspaceId, "workspaceId");
  exactId(input.projectId, "projectId");
  exactId(input.epochId, "epochId", EPOCH_ID);
  const question = typeof input.question === "string" ? input.question.trim() : "";
  const standardId = typeof input.standardId === "string" ? input.standardId.trim() : "";
  const standardVersion = typeof input.standardVersion === "string" ? input.standardVersion.trim() : "";
  if (!Number.isSafeInteger(input.version) || input.version <= 0 || input.version > 1_000_000) {
    fail("The reference-definition version is invalid.");
  }
  if (!question || question.length > 2_000) fail("The reference-policy question is invalid.");
  if (!ID.test(standardId) || !standardVersion || standardVersion.length > 160 || !HASH.test(input.standardHash)) {
    fail("The reference standard binding is invalid.");
  }
  return transaction(async client => {
    const createdAt = await databaseNow(client);
    const authority = await client.query(
      `SELECT access.assignment_id
       FROM tokenless_dsa_reference_sampling_epochs epoch
       JOIN tokenless_project_access_assignments access
         ON access.workspace_id=epoch.workspace_id AND access.project_id=epoch.project_id
        AND access.subject_kind='principal' AND access.subject_reference=$4
        AND access.role='auditor' AND access.status='active'
        AND (access.expires_at IS NULL OR access.expires_at>$5)
       LEFT JOIN tokenless_workspace_members member
         ON member.workspace_id=epoch.workspace_id AND member.account_address=$4
       WHERE epoch.workspace_id=$1 AND epoch.project_id=$2 AND epoch.epoch_id=$3
         AND member.account_address IS NULL
       LIMIT 1 FOR SHARE OF epoch,access`,
      [input.workspaceId, input.projectId, input.epochId, principal, createdAt],
    );
    const auditorAccessAssignmentId = text(authority.rows[0] as Row | undefined, "assignment_id");
    if (!auditorAccessAssignmentId) {
      fail(
        "An active project auditor without workspace membership must freeze the reference definition.",
        "dsa_named_panel_reference_definition_authority_required",
        403,
      );
    }
    const definition = {
      schemaVersion: "rateloop.dsa-named-panel-reference-definition.v1",
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      epochId: input.epochId,
      version: input.version,
      question,
      standardId,
      standardVersion,
      standardHash: input.standardHash,
      responsePolarity: {
        policyMatches: "fail",
        policyDoesNotMatch: "pass",
      },
      uncertaintyRule: "reviewers_binary_adjudicator_may_choose_uncertain",
      adjudicationRule: "qualified_non_panel_principal_required_on_disagreement",
      authorityKind: "project_auditor_without_workspace_membership",
      auditorAccessAssignmentId,
      createdBy: principal,
    } as const;
    const definitionJson = canonical(definition);
    const definitionHash = sha256Rfc8785(definition);
    await client.query(
      `INSERT INTO tokenless_dsa_named_panel_reference_definitions
       (workspace_id,project_id,epoch_id,version,question,authority_kind,auditor_access_assignment_id,
        standard_id,standard_version,standard_hash,definition_json,definition_hash,created_by,created_at)
       VALUES ($1,$2,$3,$4,$5,'project_auditor_without_workspace_membership',$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (workspace_id,epoch_id) DO NOTHING`,
      [
        input.workspaceId,
        input.projectId,
        input.epochId,
        input.version,
        question,
        auditorAccessAssignmentId,
        standardId,
        standardVersion,
        input.standardHash,
        definitionJson,
        definitionHash,
        principal,
        createdAt,
      ],
    );
    const stored = await client.query(
      `SELECT definition_hash FROM tokenless_dsa_named_panel_reference_definitions
       WHERE workspace_id=$1 AND epoch_id=$2`,
      [input.workspaceId, input.epochId],
    );
    if (text(stored.rows[0] as Row | undefined, "definition_hash") !== definitionHash) {
      fail(
        "This epoch already has a different immutable reference definition.",
        "dsa_named_panel_reference_definition_conflict",
        409,
      );
    }
    return {
      epochId: input.epochId,
      version: input.version,
      definitionHash,
      authorityKind: definition.authorityKind,
    };
  });
}

type ProvenanceEntry = {
  key?: unknown;
  value?: unknown;
  source?: unknown;
  assertedBy?: unknown;
  verifiedAt?: unknown;
  expiresAt?: unknown;
  evidenceReferenceHash?: unknown;
  evidenceVersion?: unknown;
};

function qualificationEntry(input: {
  provenance: unknown;
  key: string;
  predicate: (value: unknown) => boolean;
  verifiedAtThrough: Date;
  expiresThrough: Date;
}) {
  if (!Array.isArray(input.provenance))
    fail("The frozen reviewer qualification snapshot is invalid.", "dsa_named_panel_qualification_missing", 409);
  const entries = (input.provenance as ProvenanceEntry[]).filter(entry => {
    if (!entry || typeof entry !== "object" || entry.key !== input.key || !input.predicate(entry.value)) return false;
    const verifiedAt = new Date(String(entry.verifiedAt));
    const expiresAt = new Date(String(entry.expiresAt));
    return (
      typeof entry.source === "string" &&
      entry.source.length > 0 &&
      typeof entry.assertedBy === "string" &&
      entry.assertedBy.length > 0 &&
      typeof entry.evidenceVersion === "string" &&
      entry.evidenceVersion.length > 0 &&
      entry.evidenceVersion.length <= 80 &&
      Number.isFinite(verifiedAt.getTime()) &&
      verifiedAt <= input.verifiedAtThrough &&
      Number.isFinite(expiresAt.getTime()) &&
      expiresAt >= input.expiresThrough &&
      typeof entry.evidenceReferenceHash === "string" &&
      HASH.test(entry.evidenceReferenceHash)
    );
  });
  if (entries.length !== 1)
    fail("Exact, current reviewer qualification evidence is required.", "dsa_named_panel_qualification_missing", 409);
  const entry = entries[0]!;
  return {
    key: input.key,
    value: entry.value,
    source: String(entry.source),
    assertedBy: String(entry.assertedBy),
    verifiedAt: new Date(String(entry.verifiedAt)).toISOString(),
    expiresAt: new Date(String(entry.expiresAt)).toISOString(),
    evidenceReferenceHash: String(entry.evidenceReferenceHash),
    evidenceVersion: String(entry.evidenceVersion),
  };
}

export const __dsaNamedPanelQualificationTestUtils = { qualificationEntry };

function cefrSatisfies(value: unknown, required: CefrLevel) {
  return typeof value === "string" && CEFR_ORDER.indexOf(value as CefrLevel) >= CEFR_ORDER.indexOf(required);
}

async function loadQualifiedAdjudicatorEvidence(
  client: PoolClient,
  unit: Row,
  principal: string,
  verifiedAtThrough: Date,
  expiresThrough: Date = verifiedAtThrough,
) {
  const access = await client.query(
    `SELECT cr.qualification_provenance_json FROM tokenless_workspace_reviewers wr
     JOIN tokenless_principals p ON p.principal_id=wr.principal_address AND p.status='active'
     JOIN tokenless_assurance_cohort_reviewers cr
       ON cr.project_id=$3 AND cr.reviewer_account_address=wr.principal_address AND cr.status='active'
     WHERE wr.workspace_id=$1 AND wr.principal_address=$2 AND wr.status='active'`,
    [text(unit, "workspace_id"), principal, text(unit, "project_id")],
  );
  for (const value of access.rows) {
    try {
      const provenance = parseJson<unknown>((value as Row).qualification_provenance_json, "adjudicator qualification");
      return {
        language: qualificationEntry({
          provenance,
          key: `language:${text(unit, "language_tag")!.toLowerCase()}:reading:cefr`,
          predicate: value => cefrSatisfies(value, text(unit, "required_cefr_level") as CefrLevel),
          verifiedAtThrough,
          expiresThrough,
        }),
        competence: qualificationEntry({
          provenance,
          key: `dsa-policy-category:${text(unit, "policy_category_code")}`,
          predicate: value => value === true,
          verifiedAtThrough,
          expiresThrough,
        }),
      };
    } catch {
      // Try another active invited-reviewer qualification snapshot.
    }
  }
  fail(
    "An active, qualified project reviewer without workspace membership is required.",
    "dsa_named_panel_adjudicator_unqualified",
    403,
  );
}

async function hasPendingNamedPanelRegistration(client: PoolClient, assignmentId: string, principal: string) {
  const result = await client.query(
    `SELECT 1 FROM tokenless_assurance_assignments assignment
     JOIN tokenless_dsa_named_panel_units unit
       ON unit.workspace_id=assignment.workspace_id AND unit.project_id=assignment.project_id
      AND unit.run_id=assignment.run_id
     WHERE assignment.assignment_id=$1 AND assignment.reviewer_account_address=$2 LIMIT 1`,
    [assignmentId, principal],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function registerDsaNamedPanelUnit(input: {
  accountAddress: string;
  workspaceId: string;
  projectId: string;
  epochId: string;
  unitId: string;
  runId: string;
  caseId: string;
  requiredCefrLevel: CefrLevel;
  requiredReviewerCount: number;
}) {
  const principal = actor(input.accountAddress);
  exactId(input.workspaceId, "workspaceId");
  exactId(input.projectId, "projectId");
  exactId(input.epochId, "epochId", EPOCH_ID);
  exactId(input.unitId, "unitId", UNIT_ID);
  exactId(input.runId, "runId");
  exactId(input.caseId, "caseId");
  if (
    !CEFR_ORDER.includes(input.requiredCefrLevel) ||
    !Number.isSafeInteger(input.requiredReviewerCount) ||
    input.requiredReviewerCount < 2 ||
    input.requiredReviewerCount > 20
  ) {
    fail("Named-panel qualification or size is invalid.");
  }
  return transaction(async client => {
    await requireManager(client, principal, input.workspaceId, input.projectId);
    const source = await client.query(
      `SELECT m.*,e.evaluation_id,e.provider_decision_id,e.decision_version,e.system_id,e.system_version,
              e.evaluation_hash,e.projection_hash AS evaluation_projection_hash,
              decision.source_system,decision.source_decision_json,decision.source_decision_hash,
              engagement.engagement_id AS source_engagement_id,
              engagement.engagement_version AS source_engagement_version,
              engagement_source.engagement_json,engagement_source.engagement_hash,
              payload.payload_version,payload.puid,payload.payload_json,payload.payload_hash,
              receipt.receipt_version,receipt.attempt_id,receipt.commission_uuid,receipt.commission_id,
              receipt.receipt_json,receipt.receipt_hash,
              definition.version AS reference_definition_version,definition.question AS reference_definition_question,
              definition.definition_json AS reference_definition_json,definition.definition_hash AS reference_definition_hash,
              definition.standard_id AS reference_standard_id,
              definition.standard_version AS reference_standard_version,
              definition.standard_hash AS reference_standard_hash,
              epoch.population_id AS epoch_population_id,epoch.population_version AS epoch_population_version,
              epoch.frame_id AS epoch_frame_id,
              c.baseline_artifact_id,c.candidate_artifact_id,
              rc.variant_a_artifact_id,rc.variant_b_artifact_id,rc.blinding_commitment,
              a.digest AS content_artifact_digest,a.content_type,
              run.status AS named_run_status,run.manifest_hash AS named_run_manifest_hash,
              run.policy_hash AS named_run_policy_hash,
              (SELECT count(*) FROM tokenless_assurance_run_cases counted WHERE counted.run_id=$5) AS run_case_count,
              (SELECT count(*) FROM tokenless_assurance_run_subpanels subpanel
                WHERE subpanel.run_id=$5) AS audience_subpanel_count,
              (SELECT count(*) FROM tokenless_assurance_run_subpanels subpanel
                WHERE subpanel.run_id=$5 AND subpanel.workspace_id=$1 AND subpanel.project_id=$4
                  AND subpanel.source='customer_invited' AND subpanel.selection='customer_named'
                  AND subpanel.run_manifest_hash=run.manifest_hash
                  AND subpanel.policy_hash=run.policy_hash) AS matching_audience_subpanel_count,
              (SELECT COALESCE(sum(subpanel.target_count),0) FROM tokenless_assurance_run_subpanels subpanel
                WHERE subpanel.run_id=$5) AS audience_reviewer_target_count,
              (SELECT count(*) FROM tokenless_assurance_assignments existing WHERE existing.run_id=$5) AS existing_assignment_count,
              (SELECT count(*) FROM tokenless_assurance_responses existing WHERE existing.run_id=$5) AS existing_response_count
       FROM tokenless_dsa_reference_sample_manifest m
       JOIN tokenless_dsa_reference_sampling_epochs epoch
         ON epoch.workspace_id=m.workspace_id AND epoch.epoch_id=m.epoch_id AND epoch.project_id=$4
       JOIN tokenless_dsa_reference_evaluation_projections e
         ON e.workspace_id=m.workspace_id AND e.epoch_id=m.epoch_id AND e.unit_id=m.unit_id
        AND e.source_decision_binding=m.source_decision_binding
        AND e.source_evaluation_binding=m.source_evaluation_binding
        AND e.source_evaluation_hash=m.source_evaluation_hash
        AND e.system_identity=m.system_identity AND e.automated_outcome=m.automated_outcome
       JOIN tokenless_dsa_reference_decision_projections projection
         ON projection.workspace_id=m.workspace_id AND projection.epoch_id=m.epoch_id
        AND projection.provider_decision_id=e.provider_decision_id AND projection.decision_version=e.decision_version
       JOIN tokenless_dsa_engagement_versions engagement
         ON engagement.workspace_id=projection.workspace_id AND engagement.population_id=projection.population_id
        AND engagement.population_version=projection.population_version
        AND engagement.engagement_id=projection.engagement_id AND engagement.engagement_version=projection.engagement_version
        AND engagement.provider_decision_id=projection.provider_decision_id
        AND engagement.decision_version=projection.decision_version
       JOIN tokenless_dsa_source_engagement_versions engagement_source
         ON engagement_source.workspace_id=engagement.workspace_id
        AND engagement_source.engagement_id=engagement.engagement_id
        AND engagement_source.engagement_version=engagement.engagement_version
        AND engagement_source.engagement_hash=projection.engagement_hash
       JOIN tokenless_dsa_source_decision_versions decision
         ON decision.workspace_id=projection.workspace_id
        AND decision.provider_decision_id=projection.provider_decision_id
        AND decision.decision_version=projection.decision_version
        AND decision.source_decision_hash=projection.source_decision_hash
       LEFT JOIN tokenless_dsa_transparency_payload_versions payload
         ON payload.workspace_id=engagement.workspace_id
        AND payload.provider_decision_id=engagement.provider_decision_id
        AND payload.decision_version=engagement.decision_version
        AND payload.payload_version=engagement.transparency_payload_version
       LEFT JOIN tokenless_dsa_transparency_receipt_versions receipt
         ON receipt.workspace_id=payload.workspace_id AND receipt.provider_decision_id=payload.provider_decision_id
        AND receipt.decision_version=payload.decision_version AND receipt.payload_version=payload.payload_version
       JOIN tokenless_dsa_named_panel_reference_definitions definition
         ON definition.workspace_id=m.workspace_id AND definition.epoch_id=m.epoch_id
        AND definition.project_id=$4
       JOIN tokenless_assurance_cases c ON c.project_id=$4 AND c.case_id=$6
       JOIN tokenless_assurance_run_cases rc ON rc.run_id=$5 AND rc.case_id=c.case_id
       JOIN tokenless_assurance_runs run ON run.run_id=rc.run_id AND run.project_id=$4
       JOIN tokenless_assurance_artifacts a ON a.project_id=c.project_id AND a.artifact_id=c.candidate_artifact_id
       WHERE m.workspace_id=$1 AND m.epoch_id=$2 AND m.unit_id=$3 AND m.selected=true
         AND e.disposition='eligible_draw' AND e.reference_label_state='unlabeled'
       FOR SHARE OF m,epoch,e,projection,engagement,engagement_source,decision,definition,c,rc,run,a`,
      [input.workspaceId, input.epochId, input.unitId, input.projectId, input.runId, input.caseId],
    );
    const row = source.rows[0] as Row | undefined;
    if (!row) notFound();
    const engagement = parseJson<Record<string, unknown>>(row.engagement_json, "source engagement");
    const decision = parseJson<Record<string, unknown>>(row.source_decision_json, "source decision");
    if (
      canonical(engagement) !== String(row.engagement_json) ||
      sha256Rfc8785(engagement) !== text(row, "engagement_hash") ||
      canonical(decision) !== String(row.source_decision_json) ||
      sha256Rfc8785(decision) !== text(row, "source_decision_hash")
    ) {
      fail("The selected DSA source evidence is invalid.", "dsa_named_panel_source_invalid", 409);
    }
    if (row.payload_json !== null && row.payload_json !== undefined) {
      const transparencyPayload = parseJson<Record<string, unknown>>(row.payload_json, "transparency payload");
      if (
        canonical(transparencyPayload) !== String(row.payload_json) ||
        sha256Rfc8785(transparencyPayload) !== text(row, "payload_hash")
      )
        fail("The selected transparency payload is invalid.", "dsa_named_panel_source_invalid", 409);
    }
    if (row.receipt_json !== null && row.receipt_json !== undefined) {
      const receipt = parseJson<Record<string, unknown>>(row.receipt_json, "transparency receipt");
      if (canonical(receipt) !== String(row.receipt_json) || sha256Rfc8785(receipt) !== text(row, "receipt_hash"))
        fail("The selected transparency receipt is invalid.", "dsa_named_panel_source_invalid", 409);
    }
    if (typeof decision.policyVersion !== "string" || !decision.policyVersion.trim()) {
      fail(
        "The selected source policy version cannot be used by the reference panel.",
        "dsa_named_panel_source_invalid",
        409,
      );
    }
    const policyDefinition = parseJson<Record<string, unknown>>(
      row.reference_definition_json,
      "reference policy definition",
    );
    if (
      canonical(policyDefinition) !== String(row.reference_definition_json) ||
      sha256Rfc8785(policyDefinition) !== text(row, "reference_definition_hash") ||
      policyDefinition.schemaVersion !== "rateloop.dsa-named-panel-reference-definition.v1" ||
      policyDefinition.workspaceId !== input.workspaceId ||
      policyDefinition.projectId !== input.projectId ||
      policyDefinition.epochId !== input.epochId ||
      policyDefinition.version !== integer(row, "reference_definition_version") ||
      policyDefinition.question !== text(row, "reference_definition_question") ||
      policyDefinition.standardId !== text(row, "reference_standard_id") ||
      policyDefinition.standardVersion !== text(row, "reference_standard_version") ||
      policyDefinition.standardHash !== text(row, "reference_standard_hash") ||
      canonical(policyDefinition.responsePolarity) !==
        canonical({ policyMatches: "fail", policyDoesNotMatch: "pass" }) ||
      policyDefinition.uncertaintyRule !== "reviewers_binary_adjudicator_may_choose_uncertain" ||
      policyDefinition.adjudicationRule !== "qualified_non_panel_principal_required_on_disagreement" ||
      policyDefinition.authorityKind !== "project_auditor_without_workspace_membership"
    ) {
      fail(
        "The auditor-frozen reference policy definition is invalid.",
        "dsa_named_panel_reference_definition_invalid",
        409,
      );
    }
    const withheld: DsaWithheldCaseValues = {
      providerIdentity: { service: engagement.service },
      automatedOutcome: text(row, "automated_outcome"),
      internalSourceDecisionId: {
        providerDecisionId: text(row, "provider_decision_id"),
        decisionVersion: integer(row, "decision_version"),
        sourceSystem: text(row, "source_system"),
        sourcePolicyVersion: decision.policyVersion,
        originalAutomatedLabel: decision.originalAutomatedLabel,
        originalRestriction: decision.originalRestriction,
      },
      receiptIdentifiers: {
        puid: text(row, "puid"),
        attemptId: text(row, "attempt_id"),
        commissionUuid: text(row, "commission_uuid"),
        commissionId: text(row, "commission_id"),
        contentLocator: engagement.contentLocator,
      },
    };
    const payload: DsaBlindedCasePayload = {
      schemaVersion: "rateloop.dsa-blinded-case.v1",
      blindedCaseId: `dsa_case_${sha256Rfc8785({ workspaceId: input.workspaceId, epochId: input.epochId, unitId: input.unitId }).slice(7, 47)}`,
      content: {
        artifactId: text(row, "candidate_artifact_id")!,
        artifactVersion: 1,
        contentHash: String(engagement.contentHash) as `sha256:${string}`,
        contentType: String(engagement.contentFormat),
        language: String(engagement.language),
      },
      policy: {
        categoryCode: String(engagement.harmonisedCategory ?? ""),
        policyHash: text(row, "reference_definition_hash") as `sha256:${string}`,
        policyVersion: integer(row, "reference_definition_version"),
        question: text(row, "reference_definition_question")!,
      },
      reference: {
        populationId: text(row, "epoch_population_id")!,
        populationVersion: integer(row, "epoch_population_version"),
        frameId: text(row, "epoch_frame_id")!,
        frameVersion: 1,
        sampleId: input.epochId,
        sampleVersion: 1,
        position: integer(row, "selection_rank"),
      },
    };
    const mapping = freezeDsaBlindedCaseMapping({ payload, withheld });
    const payloadJson = canonical(payload);
    if (
      mapping.content.artifactId !== text(row, "candidate_artifact_id") ||
      mapping.content.contentHash !== text(row, "content_artifact_digest") ||
      mapping.content.contentHash !== engagement.contentHash ||
      mapping.content.contentType !== text(row, "content_type") ||
      mapping.content.contentType !== engagement.contentFormat ||
      mapping.content.language !== engagement.language ||
      mapping.policy.categoryCode !== engagement.harmonisedCategory ||
      mapping.reference.populationId !== text(row, "epoch_population_id") ||
      mapping.reference.populationVersion !== integer(row, "epoch_population_version") ||
      mapping.reference.frameId !== text(row, "epoch_frame_id") ||
      mapping.reference.sampleId !== input.epochId ||
      mapping.reference.sampleVersion !== 1 ||
      mapping.reference.position !== integer(row, "selection_rank")
    ) {
      fail("The blinded payload is not the exact frozen candidate artifact.", "dsa_named_panel_mapping_conflict", 409);
    }
    if (integer(row, "run_case_count") !== 1)
      fail("A DSA named-panel run must contain exactly one case.", "dsa_named_panel_run_shape_invalid", 409);
    if (
      text(row, "named_run_status") !== "frozen" ||
      integer(row, "audience_subpanel_count") === 0 ||
      integer(row, "matching_audience_subpanel_count") !== integer(row, "audience_subpanel_count") ||
      integer(row, "audience_reviewer_target_count") !== input.requiredReviewerCount
    ) {
      fail(
        "A DSA named-panel run requires one exact frozen customer-named audience with the requested reviewer count.",
        "dsa_named_panel_audience_mismatch",
        409,
      );
    }
    const runRegistration = await client.query(
      `SELECT epoch_id,unit_id FROM tokenless_dsa_named_panel_units
       WHERE workspace_id=$1 AND project_id=$2 AND run_id=$3 FOR SHARE`,
      [input.workspaceId, input.projectId, input.runId],
    );
    const registeredRun = runRegistration.rows[0] as Row | undefined;
    if (
      runRegistration.rowCount !== 0 &&
      (runRegistration.rowCount !== 1 ||
        text(registeredRun, "epoch_id") !== input.epochId ||
        text(registeredRun, "unit_id") !== input.unitId)
    ) {
      fail("This review run is already bound to another DSA unit.", "dsa_named_panel_run_conflict", 409);
    }
    const buildUnitPayload = (createdBy: string, createdAt: string) => ({
      schemaVersion: "rateloop.dsa-named-panel-unit.v1",
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      epochId: input.epochId,
      unitId: input.unitId,
      evaluationId: text(row, "evaluation_id"),
      runId: input.runId,
      caseId: input.caseId,
      mappingCommitment: mapping.mappingCommitment,
      withheldSnapshotDigest: sha256Rfc8785(withheld),
      sourceEvidence: {
        providerDecisionId: text(row, "provider_decision_id"),
        decisionVersion: integer(row, "decision_version"),
        sourceDecisionHash: text(row, "source_decision_hash"),
        engagementId: text(row, "source_engagement_id"),
        engagementVersion: integer(row, "source_engagement_version"),
        engagementHash: text(row, "engagement_hash"),
        transparencyPayloadVersion:
          row.payload_version === null || row.payload_version === undefined ? null : integer(row, "payload_version"),
        transparencyPuid: text(row, "puid"),
        transparencyPayloadHash: text(row, "payload_hash"),
        transparencyReceiptVersion:
          row.receipt_version === null || row.receipt_version === undefined ? null : integer(row, "receipt_version"),
        transparencyAttemptId: text(row, "attempt_id"),
        transparencyReceiptHash: text(row, "receipt_hash"),
      },
      referenceDefinitionVersion: String(mapping.policy.policyVersion),
      referenceDefinitionHash: mapping.policy.policyHash,
      requiredCefrLevel: input.requiredCefrLevel,
      requiredReviewerCount: input.requiredReviewerCount,
      responseWindowMs: DSA_NAMED_PANEL_RESPONSE_WINDOW_MS,
      createdBy,
      createdAt,
    });
    const existing = await client.query(
      `SELECT unit_hash,mapping_commitment,created_by,created_at
       FROM tokenless_dsa_named_panel_units WHERE workspace_id=$1 AND epoch_id=$2 AND unit_id=$3 FOR SHARE`,
      [input.workspaceId, input.epochId, input.unitId],
    );
    const existingRow = existing.rows[0] as Row | undefined;
    if (existingRow) {
      const replayPayload = buildUnitPayload(
        text(existingRow, "created_by")!,
        instant(existingRow, "created_at").toISOString(),
      );
      if (
        text(existingRow, "created_by") !== principal ||
        text(existingRow, "mapping_commitment") !== mapping.mappingCommitment ||
        text(existingRow, "unit_hash") !== sha256Rfc8785(replayPayload)
      )
        fail("This selected unit already has different named-panel evidence.", "dsa_named_panel_unit_conflict", 409);
      return {
        unitId: input.unitId,
        mappingCommitment: mapping.mappingCommitment,
        unitHash: sha256Rfc8785(replayPayload),
        referenceDefinitionVersion: String(mapping.policy.policyVersion),
        referenceDefinitionHash: mapping.policy.policyHash,
        idempotent: true,
      };
    }
    if (integer(row, "existing_assignment_count") !== 0 || integer(row, "existing_response_count") !== 0)
      fail(
        "Register the DSA named-panel unit before any reviewer assignment or response exists.",
        "dsa_named_panel_registration_too_late",
        409,
      );
    const now = await databaseNow(client);
    const unitPayload = buildUnitPayload(principal, now.toISOString());
    const unitJson = canonical(unitPayload);
    await client.query(
      `INSERT INTO tokenless_dsa_named_panel_units
       (workspace_id,project_id,epoch_id,unit_id,evaluation_id,provider_decision_id,decision_version,
        manifest_selected,source_decision_binding,source_evaluation_binding,source_evaluation_hash,system_identity,
        system_id,system_version,automated_outcome,evaluation_hash,evaluation_projection_hash,manifest_row_hash,
        run_id,case_id,baseline_artifact_id,candidate_artifact_id,variant_a_artifact_id,variant_b_artifact_id,
        blinding_commitment,blinded_case_id,blinded_payload_json,blinded_payload_hash,mapping_commitment,
        withheld_snapshot_digest,content_artifact_id,content_artifact_digest,content_type,
        language_tag,policy_category_code,required_cefr_level,required_reviewer_count,unit_json,unit_hash,created_by,created_at,
        population_id,population_version,frame_id,selection_rank,
        source_engagement_id,source_engagement_version,source_engagement_hash,source_decision_hash,
        transparency_payload_version,transparency_puid,transparency_payload_hash,
        transparency_receipt_version,transparency_attempt_id,transparency_receipt_hash,
        reference_definition_version,reference_definition_hash,reference_definition_question,response_window_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,
               $25,$26,$27,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,
               $44,$45,$46,$47,$48,$49,$50,$51,$52,$53,$54,$55,$56,$57)
       ON CONFLICT (workspace_id,epoch_id,unit_id) DO NOTHING`,
      [
        input.workspaceId,
        input.projectId,
        input.epochId,
        input.unitId,
        text(row, "evaluation_id"),
        text(row, "provider_decision_id"),
        integer(row, "decision_version"),
        text(row, "source_decision_binding"),
        text(row, "source_evaluation_binding"),
        text(row, "source_evaluation_hash"),
        text(row, "system_identity"),
        text(row, "system_id"),
        text(row, "system_version"),
        text(row, "automated_outcome"),
        text(row, "evaluation_hash"),
        text(row, "evaluation_projection_hash"),
        text(row, "manifest_row_hash"),
        input.runId,
        input.caseId,
        text(row, "baseline_artifact_id"),
        text(row, "candidate_artifact_id"),
        text(row, "variant_a_artifact_id"),
        text(row, "variant_b_artifact_id"),
        text(row, "blinding_commitment"),
        mapping.blindedCaseId,
        payloadJson,
        mapping.mappingCommitment,
        sha256Rfc8785(withheld),
        mapping.content.artifactId,
        mapping.content.contentHash,
        mapping.content.contentType,
        mapping.content.language,
        mapping.policy.categoryCode,
        input.requiredCefrLevel,
        input.requiredReviewerCount,
        unitJson,
        sha256Rfc8785(unitPayload),
        principal,
        now,
        text(row, "epoch_population_id"),
        integer(row, "epoch_population_version"),
        text(row, "epoch_frame_id"),
        integer(row, "selection_rank"),
        text(row, "source_engagement_id"),
        integer(row, "source_engagement_version"),
        text(row, "engagement_hash"),
        text(row, "source_decision_hash"),
        row.payload_version === null || row.payload_version === undefined ? null : integer(row, "payload_version"),
        text(row, "puid"),
        text(row, "payload_hash"),
        row.receipt_version === null || row.receipt_version === undefined ? null : integer(row, "receipt_version"),
        text(row, "attempt_id"),
        text(row, "receipt_hash"),
        integer(row, "reference_definition_version"),
        text(row, "reference_definition_hash"),
        text(row, "reference_definition_question"),
        DSA_NAMED_PANEL_RESPONSE_WINDOW_MS,
      ],
    );
    const stored = await client.query(
      `SELECT unit_hash,mapping_commitment FROM tokenless_dsa_named_panel_units
       WHERE workspace_id=$1 AND epoch_id=$2 AND unit_id=$3`,
      [input.workspaceId, input.epochId, input.unitId],
    );
    if (
      text(stored.rows[0] as Row | undefined, "unit_hash") !== sha256Rfc8785(unitPayload) ||
      text(stored.rows[0] as Row | undefined, "mapping_commitment") !== mapping.mappingCommitment
    ) {
      fail("This selected unit already has different named-panel evidence.", "dsa_named_panel_unit_conflict", 409);
    }
    return {
      unitId: input.unitId,
      mappingCommitment: mapping.mappingCommitment,
      unitHash: sha256Rfc8785(unitPayload),
      referenceDefinitionVersion: String(mapping.policy.policyVersion),
      referenceDefinitionHash: mapping.policy.policyHash,
      idempotent: false,
    };
  });
}

export async function acceptDsaNamedPanelAssignment(input: {
  accountAddress: string;
  assignmentId: string;
  conflictDeclaration: { hasConflict: boolean; relationships: readonly string[] };
}) {
  const principal = actor(input.accountAddress);
  exactId(input.assignmentId, "assignmentId");
  if (
    typeof input.conflictDeclaration?.hasConflict !== "boolean" ||
    !Array.isArray(input.conflictDeclaration?.relationships) ||
    input.conflictDeclaration.relationships.some(value => typeof value !== "string" || value.length > 200) ||
    input.conflictDeclaration.relationships.length > 20
  )
    fail("Conflict declaration is invalid.");
  if (input.conflictDeclaration.hasConflict)
    fail("A conflicted reviewer cannot join this reference panel.", "dsa_named_panel_conflict", 409);
  const acceptance = await transaction(async client => {
    const now = await databaseNow(client);
    const location = await client.query(
      `SELECT workspace_id,project_id,epoch_id,unit_id
       FROM tokenless_dsa_named_panel_selections
       WHERE assignment_id=$1 AND reviewer_principal_id=$2`,
      [input.assignmentId, principal],
    );
    if (location.rowCount !== 1) notFound();
    const exactLocation = location.rows[0] as Row;
    const lockedUnit = await client.query(
      `SELECT 1 FROM tokenless_dsa_named_panel_units
       WHERE workspace_id=$1 AND project_id=$2 AND epoch_id=$3 AND unit_id=$4 FOR UPDATE`,
      [
        text(exactLocation, "workspace_id"),
        text(exactLocation, "project_id"),
        text(exactLocation, "epoch_id"),
        text(exactLocation, "unit_id"),
      ],
    );
    if (lockedUnit.rowCount !== 1) notFound();
    const result = await client.query(
      `SELECT u.*,a.status AS assignment_status,a.source AS reviewer_source,a.reviewer_account_address,
              a.qualification_provenance_json,a.accepted_at,a.assignment_expires_at,a.lease_state,
              panel.assignment_snapshot_hash AS existing_assignment_snapshot_hash,
              panel.conflict_declaration_json AS existing_conflict_declaration_json,
              panel.conflict_status AS existing_conflict_status,
              panel.qualification_expires_at AS existing_qualification_expires_at,
              (SELECT count(*) FROM tokenless_assurance_run_cases counted WHERE counted.run_id=u.run_id) AS run_case_count
       FROM tokenless_dsa_named_panel_units u
       JOIN tokenless_assurance_assignments a
         ON a.workspace_id=u.workspace_id AND a.project_id=u.project_id AND a.run_id=u.run_id AND a.assignment_id=$1
       LEFT JOIN tokenless_dsa_named_panel_assignments panel
         ON panel.workspace_id=u.workspace_id AND panel.epoch_id=u.epoch_id AND panel.unit_id=u.unit_id
        AND panel.assignment_id=a.assignment_id AND panel.reviewer_principal_id=a.reviewer_account_address
       WHERE a.reviewer_account_address=$2 FOR SHARE OF a`,
      [input.assignmentId, principal],
    );
    const row = result.rows[0] as Row | undefined;
    if (
      !row ||
      text(row, "assignment_status") !== "accepted" ||
      !["pending", "issued", "failed"].includes(text(row, "lease_state") ?? "") ||
      text(row, "reviewer_source") !== "customer_invited" ||
      integer(row, "run_case_count") !== 1
    )
      notFound();
    if (result.rowCount !== 1) notFound();
    const workspaceId = text(row, "workspace_id")!;
    const epochId = text(row, "epoch_id")!;
    const unitId = text(row, "unit_id")!;
    await assertDsaNamedPanelPrincipalEligible(client, {
      workspaceId,
      projectId: text(row, "project_id")!,
      epochId,
      principalId: principal,
      now,
    });
    const deadline = instant(row, "assignment_expires_at");
    if (deadline <= now) notFound();
    const requestedRelationships = [...input.conflictDeclaration.relationships].sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    const existingSnapshotHash = text(row, "existing_assignment_snapshot_hash");
    if (existingSnapshotHash) {
      const existingDeclaration = parseJson<{ hasConflict?: unknown; relationships?: unknown }>(
        row.existing_conflict_declaration_json,
        "existing conflict declaration",
      );
      if (
        text(row, "existing_conflict_status") !== "cleared" ||
        instant(row, "existing_qualification_expires_at") < deadline ||
        existingDeclaration.hasConflict !== false ||
        !Array.isArray(existingDeclaration.relationships) ||
        canonical(existingDeclaration.relationships) !== canonical(requestedRelationships)
      ) {
        fail(
          "This assignment already has different frozen DSA acceptance evidence.",
          "dsa_named_panel_assignment_conflict",
          409,
        );
      }
      return {
        result: {
          assignmentId: input.assignmentId,
          unitId,
          assignmentSnapshotHash: existingSnapshotHash,
          idempotent: true,
        },
        leaseNow: now,
      };
    }
    const provenance = parseJson<unknown>(row.qualification_provenance_json, "qualification provenance");
    const languageKey = `language:${text(row, "language_tag")!.toLowerCase()}:reading:cefr`;
    const language = qualificationEntry({
      provenance,
      key: languageKey,
      predicate: value => cefrSatisfies(value, text(row, "required_cefr_level") as CefrLevel),
      verifiedAtThrough: now,
      expiresThrough: deadline,
    });
    const competence = qualificationEntry({
      provenance,
      key: `dsa-policy-category:${text(row, "policy_category_code")}`,
      predicate: value => value === true,
      verifiedAtThrough: now,
      expiresThrough: deadline,
    });
    const languageEvidenceJson = canonical(language);
    const competenceEvidenceJson = canonical(competence);
    const declaration = {
      schemaVersion: "rateloop.dsa-named-panel-conflict.v1",
      workspaceId,
      epochId,
      unitId,
      assignmentId: input.assignmentId,
      reviewerPrincipalId: principal,
      hasConflict: false,
      relationships: requestedRelationships,
      declaredAt: now.toISOString(),
    };
    const snapshot = {
      schemaVersion: "rateloop.dsa-named-panel-assignment.v1",
      workspaceId,
      epochId,
      unitId,
      assignmentId: input.assignmentId,
      reviewerPrincipalId: principal,
      runId: text(row, "run_id"),
      caseId: text(row, "case_id"),
      mappingCommitment: text(row, "mapping_commitment"),
      acceptedAt: instant(row, "accepted_at").toISOString(),
      expiresAt: deadline.toISOString(),
      frozenAt: now.toISOString(),
    };
    const qualificationExpiresAt = [new Date(String(language.expiresAt)), new Date(String(competence.expiresAt))].sort(
      (left, right) => left.getTime() - right.getTime(),
    )[0]!;
    const declarationJson = canonical(declaration),
      snapshotJson = canonical(snapshot);
    await client.query(
      `INSERT INTO tokenless_dsa_named_panel_assignments
       (workspace_id,project_id,epoch_id,unit_id,run_id,case_id,mapping_commitment,assignment_id,reviewer_principal_id,
        reviewer_source,language_tag,required_language_activity,required_cefr_level,
        language_evidence_kind,language_evidence_version,language_evidence_json,language_evidence_hash,
        policy_category_code,category_evidence_kind,category_evidence_version,
        category_competence_evidence_json,category_competence_evidence_hash,
        conflict_declaration_json,conflict_declaration_hash,conflict_status,qualification_expires_at,
        assignment_snapshot_json,assignment_snapshot_hash,accepted_at,assignment_expires_at,frozen_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'customer_invited',$10,'reading',$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,'cleared',$23,$24,$25,$26,$27,$28)
       ON CONFLICT (workspace_id,epoch_id,unit_id,assignment_id) DO NOTHING`,
      [
        workspaceId,
        text(row, "project_id"),
        epochId,
        unitId,
        text(row, "run_id"),
        text(row, "case_id"),
        text(row, "mapping_commitment"),
        input.assignmentId,
        principal,
        text(row, "language_tag"),
        text(row, "required_cefr_level"),
        String(language.source),
        String(language.evidenceVersion),
        languageEvidenceJson,
        sha256Rfc8785(language),
        text(row, "policy_category_code"),
        String(competence.source),
        String(competence.evidenceVersion),
        competenceEvidenceJson,
        sha256Rfc8785(competence),
        declarationJson,
        sha256Rfc8785(declaration),
        qualificationExpiresAt,
        snapshotJson,
        sha256Rfc8785(snapshot),
        instant(row, "accepted_at"),
        deadline,
        now,
      ],
    );
    const stored = await client.query(
      `SELECT assignment_snapshot_hash,language_evidence_hash,category_competence_evidence_hash,
              conflict_declaration_hash
       FROM tokenless_dsa_named_panel_assignments
       WHERE workspace_id=$1 AND epoch_id=$2 AND unit_id=$3 AND assignment_id=$4`,
      [workspaceId, epochId, unitId, input.assignmentId],
    );
    const storedAssignment = stored.rows[0] as Row | undefined;
    if (
      stored.rowCount !== 1 ||
      text(storedAssignment, "assignment_snapshot_hash") !== sha256Rfc8785(snapshot) ||
      text(storedAssignment, "language_evidence_hash") !== sha256Rfc8785(language) ||
      text(storedAssignment, "category_competence_evidence_hash") !== sha256Rfc8785(competence) ||
      text(storedAssignment, "conflict_declaration_hash") !== sha256Rfc8785(declaration)
    )
      fail("This assignment already has different frozen DSA evidence.", "dsa_named_panel_assignment_conflict", 409);
    return {
      result: {
        assignmentId: input.assignmentId,
        unitId,
        assignmentSnapshotHash: sha256Rfc8785(snapshot),
        idempotent: false,
      },
      leaseNow: now,
    };
  });
  const lease = await issueDsaNamedPanelArtifactLease({
    assignmentId: input.assignmentId,
    reviewerAccountAddress: principal,
    now: acceptance.leaseNow,
  });
  return { ...acceptance.result, leaseExpiresAt: lease.expiresAt };
}

function storedMapping(row: Row): DsaBlindedCaseMapping {
  const payload = parseJson<DsaBlindedCasePayload>(row.blinded_payload_json, "blinded DSA payload");
  const payloadHash = sha256Rfc8785(payload);
  if (payloadHash !== text(row, "mapping_commitment") || payloadHash !== text(row, "blinded_payload_hash"))
    throw new Error("Stored blinded DSA mapping is invalid.");
  return Object.freeze({ ...payload, mappingCommitment: payloadHash });
}

export async function getDsaNamedPanelTaskIfExists(input: { accountAddress: string; assignmentId: string }) {
  const principal = actor(input.accountAddress);
  return transaction(async client => {
    const clock = await databaseNow(client);
    const result = await client.query(
      `SELECT u.*,pa.assignment_id,pa.reviewer_principal_id,pa.qualification_expires_at,pa.conflict_status,
              pa.assignment_expires_at,a.status AS assignment_status,a.lease_state,
              l.lease_id,l.expires_at AS lease_expires_at,l.revoked_at AS lease_revoked_at
       FROM tokenless_dsa_named_panel_assignments pa
       JOIN tokenless_dsa_named_panel_units u ON u.workspace_id=pa.workspace_id AND u.epoch_id=pa.epoch_id AND u.unit_id=pa.unit_id
       JOIN tokenless_assurance_assignments a
         ON a.workspace_id=pa.workspace_id AND a.project_id=u.project_id AND a.run_id=u.run_id
        AND a.assignment_id=pa.assignment_id AND a.reviewer_account_address=pa.reviewer_principal_id
       JOIN tokenless_assurance_artifact_leases l
         ON l.workspace_id=pa.workspace_id AND l.project_id=u.project_id
        AND l.assignment_id=pa.assignment_id AND l.account_address=pa.reviewer_principal_id
        AND l.artifact_id=u.content_artifact_id
       WHERE pa.assignment_id=$1 AND pa.reviewer_principal_id=$2
       ORDER BY l.created_at DESC LIMIT 1 FOR SHARE`,
      [input.assignmentId, principal],
    );
    const row = result.rows[0] as Row | undefined;
    if (!row) {
      if (await hasPendingNamedPanelRegistration(client, input.assignmentId, principal))
        fail(
          "Accept the exact DSA reference-panel terms before opening this assignment.",
          "dsa_named_panel_acceptance_required",
          409,
        );
      return null;
    }
    if (
      text(row, "assignment_status") !== "accepted" ||
      text(row, "lease_state") !== "issued" ||
      text(row, "conflict_status") !== "cleared" ||
      instant(row, "assignment_expires_at") <= clock ||
      instant(row, "qualification_expires_at") < instant(row, "assignment_expires_at") ||
      row.lease_revoked_at !== null ||
      instant(row, "lease_expires_at") <= clock
    )
      notFound();
    await assertDsaNamedPanelPrincipalEligible(client, {
      workspaceId: text(row, "workspace_id")!,
      projectId: text(row, "project_id")!,
      epochId: text(row, "epoch_id")!,
      principalId: principal,
      now: clock,
    });
    const mapping = storedMapping(row);
    return {
      assignmentId: input.assignmentId,
      case: mapping,
      responseContract: {
        schemaVersion: "rateloop.dsa-named-panel-response.v1",
        caseId: text(row, "case_id"),
        choices: ["policy_matches", "policy_does_not_match"] as const,
        rationale: { required: true, maximumLength: 2_000 },
      },
    };
  });
}

export async function readDsaNamedPanelArtifactIfExists(input: {
  accountAddress: string;
  assignmentId: string;
  artifactId: string;
  requestReference?: string;
}) {
  const principal = actor(input.accountAddress);
  const authorization = await transaction(async client => {
    const clock = await databaseNow(client);
    const result = await client.query(
      `SELECT u.workspace_id,u.project_id,u.epoch_id,u.unit_id,u.mapping_commitment,
              u.content_artifact_id,u.content_artifact_digest,
              pa.reviewer_principal_id,pa.qualification_expires_at,pa.conflict_status,pa.assignment_expires_at,
              a.status AS assignment_status,a.lease_state,l.lease_id,l.expires_at AS lease_expires_at,l.revoked_at
       FROM tokenless_assurance_assignments a
       JOIN tokenless_dsa_named_panel_units u
         ON u.workspace_id=a.workspace_id AND u.project_id=a.project_id AND u.run_id=a.run_id
       LEFT JOIN tokenless_dsa_named_panel_assignments pa
         ON pa.workspace_id=u.workspace_id AND pa.epoch_id=u.epoch_id AND pa.unit_id=u.unit_id
        AND pa.assignment_id=a.assignment_id AND pa.reviewer_principal_id=a.reviewer_account_address
       LEFT JOIN tokenless_assurance_artifact_leases l
         ON l.workspace_id=u.workspace_id AND l.project_id=u.project_id AND l.assignment_id=a.assignment_id
        AND l.account_address=a.reviewer_account_address AND l.artifact_id=u.content_artifact_id
       WHERE a.assignment_id=$1 AND a.reviewer_account_address=$2
       ORDER BY l.created_at DESC NULLS LAST LIMIT 1 FOR SHARE OF a,u`,
      [input.assignmentId, principal],
    );
    const row = result.rows[0] as Row | undefined;
    if (!row) return null;
    if (text(row, "content_artifact_id") !== input.artifactId) notFound();
    if (
      !text(row, "reviewer_principal_id") ||
      text(row, "assignment_status") !== "accepted" ||
      text(row, "lease_state") !== "issued" ||
      text(row, "conflict_status") !== "cleared" ||
      instant(row, "assignment_expires_at") <= clock ||
      instant(row, "qualification_expires_at") < instant(row, "assignment_expires_at") ||
      row.revoked_at !== null ||
      instant(row, "lease_expires_at") <= clock
    )
      notFound();
    await assertDsaNamedPanelPrincipalEligible(client, {
      workspaceId: text(row, "workspace_id")!,
      projectId: text(row, "project_id")!,
      epochId: text(row, "epoch_id")!,
      principalId: principal,
      now: clock,
    });
    return {
      workspaceId: text(row, "workspace_id")!,
      projectId: text(row, "project_id")!,
      epochId: text(row, "epoch_id")!,
      unitId: text(row, "unit_id")!,
      mappingCommitment: text(row, "mapping_commitment")!,
      artifactDigest: text(row, "content_artifact_digest")!,
      leaseId: text(row, "lease_id")!,
    };
  });
  if (!authorization) return null;
  const artifact = await readEncryptedArtifact({
    accountAddress: principal,
    artifactId: input.artifactId,
    dsaNamedPanelAssignmentId: input.assignmentId,
    leaseId: authorization.leaseId,
    projectId: authorization.projectId,
    purpose: "preview",
    requestReference: input.requestReference,
    workspaceId: authorization.workspaceId,
  });
  await transaction(async client => {
    const accessedAt = await databaseNow(client);
    const lockedUnit = await client.query(
      `SELECT 1 FROM tokenless_dsa_named_panel_units
       WHERE workspace_id=$1 AND project_id=$2 AND epoch_id=$3 AND unit_id=$4 FOR SHARE`,
      [authorization.workspaceId, authorization.projectId, authorization.epochId, authorization.unitId],
    );
    if (lockedUnit.rowCount !== 1) notFound();
    const current = await client.query(
      `SELECT lease.expires_at,lease.revoked_at,assignment.status AS assignment_status,
              assignment.lease_state,panel.assignment_expires_at,panel.qualification_expires_at,panel.conflict_status
       FROM tokenless_dsa_named_panel_assignments panel
       JOIN tokenless_assurance_assignments assignment
         ON assignment.assignment_id=panel.assignment_id
        AND assignment.reviewer_account_address=panel.reviewer_principal_id
       JOIN tokenless_assurance_artifact_leases lease
         ON lease.lease_id=$1 AND lease.assignment_id=panel.assignment_id
        AND lease.account_address=panel.reviewer_principal_id AND lease.artifact_id=$2
       WHERE panel.workspace_id=$3 AND panel.epoch_id=$4 AND panel.unit_id=$5
         AND panel.assignment_id=$6 AND panel.reviewer_principal_id=$7 FOR SHARE`,
      [
        authorization.leaseId,
        input.artifactId,
        authorization.workspaceId,
        authorization.epochId,
        authorization.unitId,
        input.assignmentId,
        principal,
      ],
    );
    const currentRow = current.rows[0] as Row | undefined;
    if (
      current.rowCount !== 1 ||
      text(currentRow, "assignment_status") !== "accepted" ||
      text(currentRow, "lease_state") !== "issued" ||
      text(currentRow, "conflict_status") !== "cleared" ||
      currentRow?.revoked_at !== null ||
      instant(currentRow, "expires_at") <= accessedAt ||
      instant(currentRow, "assignment_expires_at") <= accessedAt ||
      instant(currentRow, "qualification_expires_at") < instant(currentRow, "assignment_expires_at")
    )
      notFound();
    await assertDsaNamedPanelPrincipalEligible(client, {
      workspaceId: authorization.workspaceId,
      projectId: authorization.projectId,
      epochId: authorization.epochId,
      principalId: principal,
      now: accessedAt,
    });
    const accessId = `dsapa_${sha256Rfc8785({ assignmentId: input.assignmentId, mappingCommitment: authorization.mappingCommitment }).slice(7, 47)}`;
    const accessPayload = {
      schemaVersion: "rateloop.dsa-named-panel-access.v1",
      workspaceId: authorization.workspaceId,
      projectId: authorization.projectId,
      epochId: authorization.epochId,
      unitId: authorization.unitId,
      assignmentId: input.assignmentId,
      reviewerPrincipalId: principal,
      artifactId: input.artifactId,
      artifactDigest: authorization.artifactDigest,
      leaseId: authorization.leaseId,
      accessedAt: accessedAt.toISOString(),
    };
    const accessJson = canonical(accessPayload);
    await client.query(
      `INSERT INTO tokenless_dsa_named_panel_artifact_accesses
       (access_id,workspace_id,project_id,epoch_id,unit_id,assignment_id,reviewer_principal_id,artifact_id,artifact_digest,
        lease_id,lease_expires_at,lease_revoked_at,access_json,access_hash,accessed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL,$12,$13,$14)
       ON CONFLICT (access_id) DO NOTHING`,
      [
        accessId,
        authorization.workspaceId,
        authorization.projectId,
        authorization.epochId,
        authorization.unitId,
        input.assignmentId,
        principal,
        input.artifactId,
        authorization.artifactDigest,
        authorization.leaseId,
        instant(currentRow, "expires_at"),
        accessJson,
        sha256Rfc8785(accessPayload),
        accessedAt,
      ],
    );
  });
  return artifact;
}

export async function submitDsaNamedPanelResponseIfExists(input: {
  accountAddress: string;
  assignmentId: string;
  idempotencyKey: string;
  response: { choice: "policy_matches" | "policy_does_not_match"; rationale: string } | undefined;
}) {
  const principal = actor(input.accountAddress);
  if (!IDEMPOTENCY_KEY.test(input.idempotencyKey))
    fail("idempotencyKey is invalid.", "invalid_dsa_named_panel_response");
  const lookup = await transaction(async client => {
    const result = await client.query(
      `SELECT u.workspace_id,u.project_id,u.epoch_id,u.unit_id,u.case_id,u.baseline_artifact_id,u.candidate_artifact_id,
              u.variant_a_artifact_id,u.variant_b_artifact_id,
              EXISTS (SELECT 1 FROM tokenless_dsa_named_panel_artifact_accesses access
                       WHERE access.workspace_id=pa.workspace_id AND access.epoch_id=pa.epoch_id
                         AND access.unit_id=pa.unit_id AND access.assignment_id=pa.assignment_id
                         AND access.reviewer_principal_id=pa.reviewer_principal_id) AS has_exact_access
       FROM tokenless_dsa_named_panel_assignments pa
       JOIN tokenless_dsa_named_panel_units u
         ON u.workspace_id=pa.workspace_id AND u.epoch_id=pa.epoch_id AND u.unit_id=pa.unit_id
       JOIN tokenless_assurance_assignments a
         ON a.workspace_id=pa.workspace_id AND a.project_id=u.project_id AND a.run_id=u.run_id
        AND a.assignment_id=pa.assignment_id AND a.reviewer_account_address=pa.reviewer_principal_id
       WHERE pa.assignment_id=$1 AND pa.reviewer_principal_id=$2
         AND a.status='accepted' AND a.lease_state='issued' FOR SHARE`,
      [input.assignmentId, principal],
    );
    const row = result.rows[0] as Row | undefined;
    if (!row && (await hasPendingNamedPanelRegistration(client, input.assignmentId, principal)))
      fail(
        "Accept the exact DSA reference-panel terms before submitting this assignment.",
        "dsa_named_panel_acceptance_required",
        409,
      );
    if (row) {
      await assertDsaNamedPanelPrincipalEligible(client, {
        workspaceId: text(row, "workspace_id")!,
        projectId: text(row, "project_id")!,
        epochId: text(row, "epoch_id")!,
        principalId: principal,
        now: await databaseNow(client),
      });
    }
    return row;
  });
  if (!lookup) return null;
  if (lookup.has_exact_access !== true)
    fail("Open the exact blinded DSA case before submitting a response.", "dsa_named_panel_access_required", 409);
  if (
    !input.response ||
    !["policy_matches", "policy_does_not_match"].includes(input.response.choice) ||
    typeof input.response.rationale !== "string" ||
    input.response.rationale.trim().length === 0 ||
    input.response.rationale.length > 2_000
  ) {
    fail("A valid DSA reference-panel response is required.", "invalid_dsa_named_panel_response");
  }
  const referenceOutcome = referenceOutcomeForNamedPanelPolicyChoice(input.response.choice);
  const storedChoice = storedAssuranceChoiceForReferenceOutcome(referenceOutcome);
  const selectedArtifactId =
    storedChoice === "candidate" ? text(lookup, "candidate_artifact_id")! : text(lookup, "baseline_artifact_id")!;
  const displayedOption =
    selectedArtifactId === text(lookup, "variant_a_artifact_id") ? ("A" as const) : ("B" as const);
  const submission = await submitAssuranceResponses({
    assignmentId: input.assignmentId,
    baseAccountAddress: principal,
    idempotencyKey: input.idempotencyKey,
    responses: [
      {
        caseId: text(lookup, "case_id")!,
        displayedOption,
        selectedArtifactId,
        failureTagKeys: [],
        rationale: input.response.rationale,
      },
    ],
  });
  await transaction(async client => {
    await client.query(
      `SELECT 1 FROM tokenless_dsa_named_panel_units
       WHERE workspace_id=$1 AND epoch_id=$2 AND unit_id=$3 FOR UPDATE`,
      [text(lookup, "workspace_id"), text(lookup, "epoch_id"), text(lookup, "unit_id")],
    );
    await materializeResponses(
      client,
      {
        workspaceId: text(lookup, "workspace_id")!,
        epochId: text(lookup, "epoch_id")!,
        unitId: text(lookup, "unit_id")!,
      },
      { allowIncomplete: true },
    );
  });
  return submission;
}

async function materializeResponses(
  client: PoolClient,
  input: { workspaceId: string; epochId: string; unitId: string },
  options: { allowIncomplete?: boolean } = {},
) {
  const assignments = await client.query(
    `SELECT selection.*,panel.assignment_snapshot_hash,
            assignment.rater_id,unit.baseline_artifact_id,unit.candidate_artifact_id,unit.required_reviewer_count
     FROM tokenless_dsa_named_panel_selections selection
     JOIN tokenless_assurance_assignments assignment
       ON assignment.workspace_id=selection.workspace_id AND assignment.project_id=selection.project_id
      AND assignment.run_id=selection.run_id AND assignment.assignment_id=selection.assignment_id
      AND assignment.reviewer_account_address=selection.reviewer_principal_id
     JOIN tokenless_dsa_named_panel_units unit
       ON unit.workspace_id=selection.workspace_id AND unit.epoch_id=selection.epoch_id AND unit.unit_id=selection.unit_id
     LEFT JOIN tokenless_dsa_named_panel_assignments panel
       ON panel.workspace_id=selection.workspace_id AND panel.epoch_id=selection.epoch_id
      AND panel.unit_id=selection.unit_id AND panel.assignment_id=selection.assignment_id
      AND panel.reviewer_principal_id=selection.reviewer_principal_id
     WHERE selection.workspace_id=$1 AND selection.epoch_id=$2 AND selection.unit_id=$3
     ORDER BY encode(convert_to(selection.assignment_id,'UTF8'),'hex') FOR SHARE OF selection,assignment,unit`,
    [input.workspaceId, input.epochId, input.unitId],
  );
  if (assignments.rowCount === 0) notFound();
  const expected = integer(assignments.rows[0] as Row, "required_reviewer_count");
  if (assignments.rowCount !== expected)
    fail("The named panel is not fully assigned.", "dsa_named_panel_incomplete", 409);
  let legacyKeyrings: ReturnType<typeof getAssuranceResponseKeyrings> | null = null;
  let materializedCount = 0;
  for (const raw of assignments.rows) {
    const row = raw as Row;
    if (!text(row, "assignment_snapshot_hash")) {
      if (options.allowIncomplete) continue;
      fail(
        "Each selected reviewer must accept the exact named-panel terms.",
        "dsa_named_panel_response_incomplete",
        409,
      );
    }
    let response = await client.query(
      `SELECT binding.response_id,binding.reviewer_key,binding.reviewer_source,
              binding.response_digest,binding.response_validity AS validity,
              binding.response_choice AS choice,binding.response_submitted_at AS submitted_at
       FROM tokenless_dsa_named_panel_assignment_response_bindings binding
       WHERE binding.workspace_id=$1 AND binding.epoch_id=$2 AND binding.unit_id=$3
         AND binding.assignment_id=$4 AND binding.reviewer_principal_id=$5
         AND binding.run_id=$6 AND binding.case_id=$7 AND binding.response_validity='valid'`,
      [
        input.workspaceId,
        input.epochId,
        input.unitId,
        text(row, "assignment_id"),
        text(row, "reviewer_principal_id"),
        text(row, "run_id"),
        text(row, "case_id"),
      ],
    );
    if (response.rowCount === 0 && row.response_binding_required !== true) {
      legacyKeyrings ??= getAssuranceResponseKeyrings();
      const identity = text(row, "rater_id") ?? text(row, "reviewer_principal_id")!;
      const reviewerKeys = [...legacyKeyrings.reviewerMapping.keys.keys()].map(version =>
        assuranceReviewerKey(
          { accountAddress: identity, runId: text(row, "run_id")! },
          legacyKeyrings!.reviewerMapping,
          version,
        ),
      );
      response = await client.query(
        `SELECT response_id,reviewer_key,reviewer_source,response_digest,validity,choice,submitted_at
         FROM tokenless_assurance_responses
         WHERE run_id=$1 AND case_id=$2 AND reviewer_key=ANY($3::text[]) AND validity='valid'`,
        [text(row, "run_id"), text(row, "case_id"), reviewerKeys],
      );
    }
    if (options.allowIncomplete && response.rowCount === 0) continue;
    if (response.rowCount !== 1)
      fail("Each named reviewer must have one exact valid response.", "dsa_named_panel_response_incomplete", 409);
    const access = await client.query(
      `SELECT access_id,accessed_at FROM tokenless_dsa_named_panel_artifact_accesses
       WHERE workspace_id=$1 AND epoch_id=$2 AND unit_id=$3 AND assignment_id=$4 AND reviewer_principal_id=$5
       ORDER BY accessed_at,access_id LIMIT 1`,
      [input.workspaceId, input.epochId, input.unitId, text(row, "assignment_id"), text(row, "reviewer_principal_id")],
    );
    if (access.rowCount !== 1)
      fail("Every named reviewer must open the exact blinded artifact.", "dsa_named_panel_access_incomplete", 409);
    const rr = response.rows[0] as Row;
    const accessedAt = instant(access.rows[0] as Row, "accessed_at");
    const submittedAt = instant(rr, "submitted_at");
    if (accessedAt > submittedAt || submittedAt > instant(row, "panel_deadline"))
      fail(
        "The blinded artifact must be opened before response submission.",
        "dsa_named_panel_access_order_invalid",
        409,
      );
    const choice = text(rr, "choice");
    const derivedLabel = referenceOutcomeForStoredAssuranceChoice(choice ?? "");
    if (!derivedLabel)
      fail("A named-panel response has an unsupported choice.", "dsa_named_panel_response_invalid", 409);
    const evidence = {
      schemaVersion: "rateloop.dsa-named-panel-response-evidence.v1",
      workspaceId: input.workspaceId,
      epochId: input.epochId,
      unitId: input.unitId,
      assignmentId: text(row, "assignment_id"),
      reviewerPrincipalId: text(row, "reviewer_principal_id"),
      responseId: text(rr, "response_id"),
      responseDigest: text(rr, "response_digest"),
      responseChoice: choice,
      derivedLabel,
      accessId: text(access.rows[0] as Row, "access_id"),
      accessedAt: accessedAt.toISOString(),
      responseSubmittedAt: submittedAt.toISOString(),
    };
    const evidenceJson = canonical(evidence);
    const inserted = await client.query(
      `INSERT INTO tokenless_dsa_named_panel_response_evidence
      (workspace_id,project_id,epoch_id,unit_id,assignment_id,reviewer_principal_id,run_id,case_id,response_id,reviewer_key,
       reviewer_source,response_digest,response_validity,response_choice,derived_label,access_id,accessed_at,response_submitted_at,
       evidence_json,evidence_hash)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
      ON CONFLICT (workspace_id,epoch_id,unit_id,assignment_id) DO NOTHING`,
      [
        input.workspaceId,
        text(row, "project_id"),
        input.epochId,
        input.unitId,
        text(row, "assignment_id"),
        text(row, "reviewer_principal_id"),
        text(row, "run_id"),
        text(row, "case_id"),
        text(rr, "response_id"),
        text(rr, "reviewer_key"),
        text(rr, "reviewer_source"),
        text(rr, "response_digest"),
        text(rr, "validity"),
        choice,
        derivedLabel,
        text(access.rows[0] as Row, "access_id"),
        accessedAt,
        submittedAt,
        evidenceJson,
        sha256Rfc8785(evidence),
      ],
    );
    const storedEvidence = await client.query(
      `SELECT evidence_hash FROM tokenless_dsa_named_panel_response_evidence
       WHERE workspace_id=$1 AND epoch_id=$2 AND unit_id=$3 AND assignment_id=$4`,
      [input.workspaceId, input.epochId, input.unitId, text(row, "assignment_id")],
    );
    if (
      storedEvidence.rowCount !== 1 ||
      text(storedEvidence.rows[0] as Row | undefined, "evidence_hash") !== sha256Rfc8785(evidence)
    )
      fail(
        "Stored named-panel response evidence conflicts with its exact response binding.",
        "dsa_named_panel_response_conflict",
        409,
      );
    if (inserted.rowCount === 1) materializedCount += 1;
  }
  return materializedCount;
}

export { materializeResponses as materializeDsaNamedPanelResponses };

export async function reconcileDsaNamedPanelResponseEvidenceForPrincipal(input: { accountAddress: string }) {
  const principal = actor(input.accountAddress);
  const authorized = await transaction(async client =>
    client.query(
      `SELECT 1 FROM tokenless_dsa_named_panel_units unit
       WHERE EXISTS (SELECT 1 FROM tokenless_workspace_members member
                     WHERE member.workspace_id=unit.workspace_id AND member.account_address=$1
                       AND member.role IN ('owner','admin'))
          OR EXISTS (SELECT 1 FROM tokenless_project_access_assignments access
                     WHERE access.workspace_id=unit.workspace_id AND access.project_id=unit.project_id
                       AND access.subject_kind='principal' AND access.subject_reference=$1
                       AND access.role='auditor' AND access.status='active'
                       AND (access.expires_at IS NULL OR access.expires_at>transaction_timestamp())
                       AND NOT EXISTS (SELECT 1 FROM tokenless_workspace_members member
                                       WHERE member.workspace_id=unit.workspace_id AND member.account_address=$1))
       LIMIT 1`,
      [principal],
    ),
  );
  if (authorized.rowCount !== 1) notFound();
  type Candidate = { workspaceId: string; epochId: string; unitId: string; key: string };
  const recordFailure = async (candidate: Candidate): Promise<DsaNamedPanelMaterializationStoredState | null> =>
    transaction(async client => {
      const current = await client.query(
        `SELECT unit.required_reviewer_count,retry.attempt_count,retry.failure_count,
                (SELECT count(*) FROM tokenless_dsa_named_panel_response_evidence evidence
                 WHERE evidence.workspace_id=unit.workspace_id AND evidence.epoch_id=unit.epoch_id
                   AND evidence.unit_id=unit.unit_id)::integer AS evidence_count
         FROM tokenless_dsa_named_panel_units unit
         LEFT JOIN tokenless_dsa_named_panel_materialization_retries retry
           ON retry.workspace_id=unit.workspace_id AND retry.epoch_id=unit.epoch_id AND retry.unit_id=unit.unit_id
         WHERE unit.workspace_id=$1 AND unit.epoch_id=$2 AND unit.unit_id=$3
           AND NOT EXISTS (
                 SELECT 1 FROM tokenless_dsa_named_panel_unit_outcomes outcome
                 WHERE outcome.workspace_id=unit.workspace_id AND outcome.epoch_id=unit.epoch_id
                   AND outcome.unit_id=unit.unit_id)
           AND (
             EXISTS (SELECT 1 FROM tokenless_workspace_members member
                     WHERE member.workspace_id=unit.workspace_id AND member.account_address=$4
                       AND member.role IN ('owner','admin'))
             OR EXISTS (SELECT 1 FROM tokenless_project_access_assignments access
                        WHERE access.workspace_id=unit.workspace_id AND access.project_id=unit.project_id
                          AND access.subject_kind='principal' AND access.subject_reference=$4
                          AND access.role='auditor' AND access.status='active'
                          AND (access.expires_at IS NULL OR access.expires_at>transaction_timestamp())
                          AND NOT EXISTS (SELECT 1 FROM tokenless_workspace_members member
                                          WHERE member.workspace_id=unit.workspace_id AND member.account_address=$4))
           )
         FOR UPDATE OF unit`,
        [candidate.workspaceId, candidate.epochId, candidate.unitId, principal],
      );
      const row = current.rows[0] as Row | undefined;
      if (!row || integer(row, "evidence_count") >= integer(row, "required_reviewer_count")) return null;
      const previousFailureCount = row.failure_count === null ? 0 : integer(row, "failure_count");
      const nextFailureCount = previousFailureCount + 1;
      const state = dsaNamedPanelMaterializationFailureState(nextFailureCount);
      const recorded = await client.query(
        `INSERT INTO tokenless_dsa_named_panel_materialization_retries
         (workspace_id,epoch_id,unit_id,state,attempt_count,failure_count,failure_code,next_retry_at,
          last_attempt_at,resolved_at,updated_at)
         VALUES ($1,$2,$3,$4,1,1,'response_evidence_materialization_failed',
                 CASE WHEN $4='cooldown'
                      THEN transaction_timestamp()+($5::integer*interval '1 millisecond')
                      ELSE transaction_timestamp() END,
                 transaction_timestamp(),NULL,transaction_timestamp())
         ON CONFLICT (workspace_id,epoch_id,unit_id) DO UPDATE
         SET state=EXCLUDED.state,
             attempt_count=tokenless_dsa_named_panel_materialization_retries.attempt_count+1,
             failure_count=tokenless_dsa_named_panel_materialization_retries.failure_count+1,
             failure_code=EXCLUDED.failure_code,next_retry_at=EXCLUDED.next_retry_at,
             last_attempt_at=EXCLUDED.last_attempt_at,resolved_at=NULL,updated_at=EXCLUDED.updated_at
         WHERE tokenless_dsa_named_panel_materialization_retries.failure_count=$6
         RETURNING state`,
        [
          candidate.workspaceId,
          candidate.epochId,
          candidate.unitId,
          state,
          DSA_NAMED_PANEL_MATERIALIZATION_COOLDOWN_MS,
          previousFailureCount,
        ],
      );
      if (recorded.rowCount !== 1) {
        throw new Error("DSA named-panel materialization retry state changed outside the unit lock.");
      }
      return text(recorded.rows[0] as Row | undefined, "state") as DsaNamedPanelMaterializationStoredState;
    });
  const excluded: string[] = [];
  let attemptedUnitCount = 0;
  let failedUnitCount = 0;
  let completedUnitCount = 0;
  let materializedResponseCount = 0;
  let retryingUnitCount = 0;
  let cooldownUnitCount = 0;
  for (let attempt = 0; attempt < 128; attempt += 1) {
    const candidateRef: { current: Candidate | null } = { current: null };
    let result: { materialized: number; completed: boolean } | null = null;
    try {
      result = await transaction(async client => {
        const candidates = await client.query(
          `SELECT unit.*,
             EXISTS (SELECT 1 FROM tokenless_workspace_members member
                     WHERE member.workspace_id=unit.workspace_id AND member.account_address=$1
                       AND member.role IN ('owner','admin')) AS authorized_manager,
             EXISTS (SELECT 1 FROM tokenless_project_access_assignments access
                     WHERE access.workspace_id=unit.workspace_id AND access.project_id=unit.project_id
                       AND access.subject_kind='principal' AND access.subject_reference=$1
                       AND access.role='auditor' AND access.status='active'
                       AND (access.expires_at IS NULL OR access.expires_at>transaction_timestamp())
                       AND NOT EXISTS (SELECT 1 FROM tokenless_workspace_members member
                                       WHERE member.workspace_id=unit.workspace_id AND member.account_address=$1))
               AS authorized_auditor
       FROM tokenless_dsa_named_panel_units unit
       LEFT JOIN tokenless_dsa_named_panel_materialization_retries retry
         ON retry.workspace_id=unit.workspace_id AND retry.epoch_id=unit.epoch_id AND retry.unit_id=unit.unit_id
       WHERE (unit.workspace_id||'|'||unit.epoch_id||'|'||unit.unit_id)<>ALL($2::text[])
         AND (retry.unit_id IS NULL OR retry.state='resolved'
              OR retry.next_retry_at<=transaction_timestamp())
         AND NOT EXISTS (
               SELECT 1 FROM tokenless_dsa_named_panel_unit_outcomes outcome
               WHERE outcome.workspace_id=unit.workspace_id AND outcome.epoch_id=unit.epoch_id
                 AND outcome.unit_id=unit.unit_id)
         AND NOT EXISTS (
               SELECT 1 FROM tokenless_dsa_named_panel_selections selection
               WHERE selection.workspace_id=unit.workspace_id AND selection.epoch_id=unit.epoch_id
                 AND selection.unit_id=unit.unit_id AND selection.response_binding_required=true
                 AND NOT EXISTS (
                   SELECT 1 FROM tokenless_dsa_named_panel_assignment_response_bindings binding
                   WHERE binding.workspace_id=selection.workspace_id AND binding.epoch_id=selection.epoch_id
                     AND binding.unit_id=selection.unit_id AND binding.assignment_id=selection.assignment_id
                     AND binding.reviewer_principal_id=selection.reviewer_principal_id
                     AND binding.response_validity='valid'))
         AND (SELECT count(*) FROM tokenless_assurance_responses response
              WHERE response.run_id=unit.run_id AND response.case_id=unit.case_id
                AND response.validity='valid'
                AND NOT EXISTS (
                  SELECT 1 FROM tokenless_dsa_named_panel_assignment_response_bindings binding
                  WHERE binding.response_id=response.response_id)) >=
             (SELECT count(*) FROM tokenless_dsa_named_panel_selections selection
              WHERE selection.workspace_id=unit.workspace_id AND selection.epoch_id=unit.epoch_id
                AND selection.unit_id=unit.unit_id AND selection.response_binding_required=false
                AND NOT EXISTS (
                  SELECT 1 FROM tokenless_dsa_named_panel_assignment_response_bindings binding
                  WHERE binding.workspace_id=selection.workspace_id AND binding.epoch_id=selection.epoch_id
                    AND binding.unit_id=selection.unit_id AND binding.assignment_id=selection.assignment_id)
                AND NOT EXISTS (
                  SELECT 1 FROM tokenless_dsa_named_panel_response_evidence evidence
                  WHERE evidence.workspace_id=selection.workspace_id AND evidence.epoch_id=selection.epoch_id
                    AND evidence.unit_id=selection.unit_id AND evidence.assignment_id=selection.assignment_id))
         AND (SELECT count(*) FROM tokenless_dsa_named_panel_response_evidence evidence
              WHERE evidence.workspace_id=unit.workspace_id AND evidence.epoch_id=unit.epoch_id
                AND evidence.unit_id=unit.unit_id)<unit.required_reviewer_count
         AND (
           EXISTS (SELECT 1 FROM tokenless_workspace_members member
                   WHERE member.workspace_id=unit.workspace_id AND member.account_address=$1
                     AND member.role IN ('owner','admin'))
           OR EXISTS (SELECT 1 FROM tokenless_project_access_assignments access
                      WHERE access.workspace_id=unit.workspace_id AND access.project_id=unit.project_id
                        AND access.subject_kind='principal' AND access.subject_reference=$1
                        AND access.role='auditor' AND access.status='active'
                        AND (access.expires_at IS NULL OR access.expires_at>transaction_timestamp())
                        AND NOT EXISTS (SELECT 1 FROM tokenless_workspace_members member
                                        WHERE member.workspace_id=unit.workspace_id AND member.account_address=$1))
         )
       ORDER BY COALESCE(retry.failure_count,0),
                COALESCE(retry.last_attempt_at,'-infinity'::timestamptz),
                encode(convert_to(unit.epoch_id,'UTF8'),'hex'),encode(convert_to(unit.unit_id,'UTF8'),'hex')
       LIMIT 1 FOR UPDATE OF unit SKIP LOCKED`,
          [principal, excluded],
        );
        const candidateRow = candidates.rows[0] as Row | undefined;
        if (!candidateRow) return null;
        const selectedCandidate: Candidate = {
          workspaceId: text(candidateRow, "workspace_id")!,
          epochId: text(candidateRow, "epoch_id")!,
          unitId: text(candidateRow, "unit_id")!,
          key: `${text(candidateRow, "workspace_id")}|${text(candidateRow, "epoch_id")}|${text(candidateRow, "unit_id")}`,
        };
        candidateRef.current = selectedCandidate;
        const materialized = await materializeResponses(
          client,
          {
            workspaceId: selectedCandidate.workspaceId,
            epochId: selectedCandidate.epochId,
            unitId: selectedCandidate.unitId,
          },
          { allowIncomplete: true },
        );
        const coverage = await client.query(
          `SELECT unit.required_reviewer_count,count(evidence.assignment_id)::integer AS evidence_count
           FROM tokenless_dsa_named_panel_units unit
           LEFT JOIN tokenless_dsa_named_panel_response_evidence evidence
             ON evidence.workspace_id=unit.workspace_id AND evidence.epoch_id=unit.epoch_id
            AND evidence.unit_id=unit.unit_id
           WHERE unit.workspace_id=$1 AND unit.epoch_id=$2 AND unit.unit_id=$3
           GROUP BY unit.required_reviewer_count`,
          [selectedCandidate.workspaceId, selectedCandidate.epochId, selectedCandidate.unitId],
        );
        const coverageRow = coverage.rows[0] as Row | undefined;
        const completed = integer(coverageRow, "evidence_count") === integer(coverageRow, "required_reviewer_count");
        if (completed) {
          await client.query(
            `INSERT INTO tokenless_dsa_named_panel_materialization_retries
             (workspace_id,epoch_id,unit_id,state,attempt_count,failure_count,failure_code,next_retry_at,
              last_attempt_at,resolved_at,updated_at)
             VALUES ($1,$2,$3,'resolved',1,0,NULL,NULL,transaction_timestamp(),transaction_timestamp(),
                     transaction_timestamp())
             ON CONFLICT (workspace_id,epoch_id,unit_id) DO UPDATE
             SET state='resolved',attempt_count=tokenless_dsa_named_panel_materialization_retries.attempt_count+1,
                 failure_code=NULL,next_retry_at=NULL,last_attempt_at=EXCLUDED.last_attempt_at,
                 resolved_at=EXCLUDED.resolved_at,updated_at=EXCLUDED.updated_at`,
            [selectedCandidate.workspaceId, selectedCandidate.epochId, selectedCandidate.unitId],
          );
        }
        return {
          materialized,
          completed,
        };
      });
    } catch (error) {
      if (!candidateRef.current) throw error;
    }
    const candidate = candidateRef.current;
    if (!candidate) break;
    attemptedUnitCount += 1;
    if (result) materializedResponseCount += result.materialized;
    if (result?.completed) {
      completedUnitCount += 1;
    } else {
      failedUnitCount += 1;
      const state = await recordFailure(candidate);
      if (state === "retrying") retryingUnitCount += 1;
      if (state === "cooldown") cooldownUnitCount += 1;
    }
    excluded.push(candidate.key);
  }
  return {
    attemptedUnitCount,
    failedUnitCount,
    completedUnitCount,
    materializedResponseCount,
    retryingUnitCount,
    cooldownUnitCount,
  };
}

async function requireAssignedDsaNamedPanelAdjudicator(
  client: PoolClient,
  input: { workspaceId: string; epochId: string; unitId: string; principalId: string; now: Date },
) {
  const result = await client.query(
    `SELECT * FROM tokenless_dsa_named_panel_adjudicator_assignments
     WHERE workspace_id=$1 AND epoch_id=$2 AND unit_id=$3 AND adjudicator_principal_id=$4
       AND adjudication_deadline>$5
     FOR SHARE`,
    [input.workspaceId, input.epochId, input.unitId, input.principalId, input.now],
  );
  const assignment = result.rows[0] as Row | undefined;
  if (!assignment)
    fail(
      "This adjudication is not assigned to the current principal or its frozen deadline has elapsed.",
      "dsa_named_panel_adjudicator_assignment_required",
      403,
    );
  return assignment;
}

async function requireAssignedDsaNamedPanelAdjudicatorStillEligible(
  client: PoolClient,
  input: { workspaceId: string; projectId: string; epochId: string; unitId: string; principalId: string; now: Date },
) {
  await assertDsaNamedPanelPrincipalEligible(client, input);
  const currentStatus = await client.query(
    `SELECT 1
     FROM tokenless_principals principal
     JOIN tokenless_workspace_reviewers reviewer
       ON reviewer.workspace_id=$1 AND reviewer.principal_address=principal.principal_id
      AND reviewer.status='active'
     JOIN tokenless_assurance_cohort_reviewers cohort
       ON cohort.project_id=$2 AND cohort.reviewer_account_address=principal.principal_id
      AND cohort.status='active'
     WHERE principal.principal_id=$5 AND principal.status='active'
       AND NOT EXISTS (
         SELECT 1 FROM tokenless_dsa_named_panel_selections panel
         WHERE panel.workspace_id=$1 AND panel.epoch_id=$3 AND panel.unit_id=$4
           AND panel.reviewer_principal_id=$5)
     LIMIT 1 FOR SHARE OF principal,reviewer,cohort`,
    [input.workspaceId, input.projectId, input.epochId, input.unitId, input.principalId],
  );
  if (currentStatus.rowCount !== 1)
    fail(
      "The assigned adjudicator is no longer active or role-separated; the auditor may close the unit after its deadline.",
      "dsa_named_panel_adjudicator_ineligible",
      403,
    );
}

export async function assignDsaNamedPanelAdjudicator(input: {
  accountAddress: string;
  workspaceId: string;
  epochId: string;
  unitId: string;
  adjudicatorPrincipalId: string;
}) {
  const auditor = actor(input.accountAddress);
  const adjudicator = actor(input.adjudicatorPrincipalId);
  exactId(input.workspaceId, "workspaceId");
  exactId(input.epochId, "epochId", EPOCH_ID);
  exactId(input.unitId, "unitId", UNIT_ID);
  return transaction(async client => {
    const unitResult = await client.query(
      `SELECT unit.*,definition.auditor_access_assignment_id,definition.created_by AS definition_created_by
       FROM tokenless_dsa_named_panel_units unit
       JOIN tokenless_dsa_named_panel_reference_definitions definition
         ON definition.workspace_id=unit.workspace_id AND definition.project_id=unit.project_id
        AND definition.epoch_id=unit.epoch_id
       WHERE unit.workspace_id=$1 AND unit.epoch_id=$2 AND unit.unit_id=$3
       FOR UPDATE OF unit FOR SHARE OF definition`,
      [input.workspaceId, input.epochId, input.unitId],
    );
    const unit = unitResult.rows[0] as Row | undefined;
    if (!unit) notFound();
    const assignedAt = await databaseNow(client);
    const authority = await client.query(
      `SELECT access.assignment_id
       FROM tokenless_project_access_assignments access
       LEFT JOIN tokenless_workspace_members member
         ON member.workspace_id=access.workspace_id AND member.account_address=access.subject_reference
       WHERE access.assignment_id=$1 AND access.workspace_id=$2 AND access.project_id=$3
         AND access.subject_kind='principal' AND access.subject_reference=$4
         AND access.role='auditor' AND access.status='active'
         AND (access.expires_at IS NULL OR access.expires_at>$5)
         AND member.account_address IS NULL AND $4=$6
       FOR SHARE OF access`,
      [
        text(unit, "auditor_access_assignment_id"),
        input.workspaceId,
        text(unit, "project_id"),
        auditor,
        assignedAt,
        text(unit, "definition_created_by"),
      ],
    );
    const auditorAccessAssignmentId = text(authority.rows[0] as Row | undefined, "assignment_id");
    if (!auditorAccessAssignmentId)
      fail(
        "Only the epoch's exact separated project auditor may assign its adjudicator.",
        "dsa_named_panel_adjudicator_assignment_authority_required",
        403,
      );
    const existing = await client.query(
      `SELECT adjudicator_principal_id,assignment_hash,adjudication_deadline
       FROM tokenless_dsa_named_panel_adjudicator_assignments
       WHERE workspace_id=$1 AND epoch_id=$2 AND unit_id=$3 FOR SHARE`,
      [input.workspaceId, input.epochId, input.unitId],
    );
    if (existing.rowCount) {
      const row = existing.rows[0] as Row;
      if (text(row, "adjudicator_principal_id") !== adjudicator)
        fail(
          "This unit already has a different immutable adjudicator assignment.",
          "dsa_named_panel_adjudicator_assignment_conflict",
          409,
        );
      return {
        unitId: input.unitId,
        adjudicatorPrincipalId: adjudicator,
        adjudicationDeadline: instant(row, "adjudication_deadline").toISOString(),
        assignmentHash: text(row, "assignment_hash")!,
        idempotent: true,
      };
    }
    const adjudicationDeadline = new Date(assignedAt.getTime() + integer(unit, "response_window_ms"));
    await assertDsaNamedPanelPrincipalEligible(client, {
      workspaceId: input.workspaceId,
      projectId: text(unit, "project_id")!,
      epochId: input.epochId,
      principalId: adjudicator,
      now: assignedAt,
    });
    const panel = await client.query(
      `SELECT 1 FROM tokenless_dsa_named_panel_selections
       WHERE workspace_id=$1 AND epoch_id=$2 AND unit_id=$3 AND reviewer_principal_id=$4 LIMIT 1`,
      [input.workspaceId, input.epochId, input.unitId, adjudicator],
    );
    if (panel.rowCount)
      fail(
        "A panel reviewer cannot be assigned to adjudicate their own disagreement.",
        "dsa_named_panel_adjudicator_conflict",
        403,
      );
    const evidence = await loadQualifiedAdjudicatorEvidence(
      client,
      unit,
      adjudicator,
      assignedAt,
      adjudicationDeadline,
    );
    await materializeResponses(client, input);
    const responses = await client.query(
      `SELECT count(*)::integer AS response_count,count(DISTINCT derived_label)::integer AS label_count
       FROM tokenless_dsa_named_panel_response_evidence
       WHERE workspace_id=$1 AND epoch_id=$2 AND unit_id=$3`,
      [input.workspaceId, input.epochId, input.unitId],
    );
    const responseRow = responses.rows[0] as Row | undefined;
    if (
      integer(responseRow, "response_count") !== integer(unit, "required_reviewer_count") ||
      integer(responseRow, "label_count") < 2
    )
      fail(
        "An adjudicator can be assigned only after one exact full-panel disagreement.",
        "dsa_named_panel_no_disagreement",
        409,
      );
    const languageEvidenceJson = canonical(evidence.language);
    const competenceEvidenceJson = canonical(evidence.competence);
    const qualificationExpiresAt = [
      new Date(String(evidence.language.expiresAt)),
      new Date(String(evidence.competence.expiresAt)),
    ].sort((left, right) => left.getTime() - right.getTime())[0]!;
    const assignment = {
      schemaVersion: "rateloop.dsa-named-panel-adjudicator-assignment.v1",
      workspaceId: input.workspaceId,
      projectId: text(unit, "project_id"),
      epochId: input.epochId,
      unitId: input.unitId,
      adjudicatorPrincipalId: adjudicator,
      auditorAccessAssignmentId,
      languageEvidenceHash: sha256Rfc8785(evidence.language),
      categoryCompetenceEvidenceHash: sha256Rfc8785(evidence.competence),
      qualificationExpiresAt: qualificationExpiresAt.toISOString(),
      adjudicationDeadline: adjudicationDeadline.toISOString(),
      assignmentReason: "separated_project_auditor_named_after_disagreement",
      assignedBy: auditor,
      assignedAt: assignedAt.toISOString(),
    } as const;
    const assignmentJson = canonical(assignment);
    const assignmentHash = sha256Rfc8785(assignment);
    await client.query(
      `INSERT INTO tokenless_dsa_named_panel_adjudicator_assignments
       (workspace_id,project_id,epoch_id,unit_id,adjudicator_principal_id,auditor_access_assignment_id,
        language_evidence_kind,language_evidence_version,language_evidence_json,language_evidence_hash,
        category_evidence_kind,category_evidence_version,category_competence_evidence_json,
        category_competence_evidence_hash,qualification_expires_at,adjudication_deadline,assignment_reason,
        assignment_json,assignment_hash,assigned_by,assigned_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
               'separated_project_auditor_named_after_disagreement',$17,$18,$19,$20)
       ON CONFLICT (workspace_id,epoch_id,unit_id) DO NOTHING`,
      [
        input.workspaceId,
        text(unit, "project_id"),
        input.epochId,
        input.unitId,
        adjudicator,
        auditorAccessAssignmentId,
        String(evidence.language.source),
        String(evidence.language.evidenceVersion),
        languageEvidenceJson,
        sha256Rfc8785(evidence.language),
        String(evidence.competence.source),
        String(evidence.competence.evidenceVersion),
        competenceEvidenceJson,
        sha256Rfc8785(evidence.competence),
        qualificationExpiresAt,
        adjudicationDeadline,
        assignmentJson,
        assignmentHash,
        auditor,
        assignedAt,
      ],
    );
    const stored = await client.query(
      `SELECT adjudicator_principal_id,assignment_hash,adjudication_deadline
       FROM tokenless_dsa_named_panel_adjudicator_assignments
       WHERE workspace_id=$1 AND epoch_id=$2 AND unit_id=$3`,
      [input.workspaceId, input.epochId, input.unitId],
    );
    const storedRow = stored.rows[0] as Row | undefined;
    if (
      stored.rowCount !== 1 ||
      text(storedRow, "adjudicator_principal_id") !== adjudicator ||
      text(storedRow, "assignment_hash") !== assignmentHash ||
      instant(storedRow, "adjudication_deadline").getTime() !== adjudicationDeadline.getTime()
    )
      fail(
        "Stored adjudicator assignment conflicts with its exact separated-auditor evidence.",
        "dsa_named_panel_adjudicator_assignment_conflict",
        409,
      );
    return {
      unitId: input.unitId,
      adjudicatorPrincipalId: adjudicator,
      adjudicationDeadline: adjudicationDeadline.toISOString(),
      assignmentHash,
      idempotent: false,
    };
  });
}

export async function issueDsaNamedPanelAdjudicationArtifactLease(input: {
  accountAddress: string;
  workspaceId: string;
  epochId: string;
  unitId: string;
}) {
  const principal = actor(input.accountAddress);
  exactId(input.workspaceId, "workspaceId");
  exactId(input.epochId, "epochId", EPOCH_ID);
  exactId(input.unitId, "unitId", UNIT_ID);
  return transaction(async client => {
    const unitResult = await client.query(
      `SELECT * FROM tokenless_dsa_named_panel_units
       WHERE workspace_id=$1 AND epoch_id=$2 AND unit_id=$3 FOR UPDATE`,
      [input.workspaceId, input.epochId, input.unitId],
    );
    const unit = unitResult.rows[0] as Row | undefined;
    if (!unit) notFound();
    const now = await databaseNow(client);
    const terminal = await client.query(
      `SELECT
         EXISTS (SELECT 1 FROM tokenless_dsa_named_panel_adjudications adjudication
                 WHERE adjudication.workspace_id=$1 AND adjudication.epoch_id=$2 AND adjudication.unit_id=$3)
           AS has_adjudication,
         EXISTS (SELECT 1 FROM tokenless_dsa_named_panel_unit_outcomes outcome
                 WHERE outcome.workspace_id=$1 AND outcome.epoch_id=$2 AND outcome.unit_id=$3)
           AS has_outcome`,
      [input.workspaceId, input.epochId, input.unitId],
    );
    const terminalRow = terminal.rows[0] as Row | undefined;
    if (terminalRow?.has_adjudication === true || terminalRow?.has_outcome === true)
      fail(
        "Adjudication artifact access is closed after adjudication or a terminal outcome.",
        "dsa_named_panel_adjudication_lease_closed",
        409,
      );
    const exactAssignment = await requireAssignedDsaNamedPanelAdjudicator(client, {
      workspaceId: input.workspaceId,
      epochId: input.epochId,
      unitId: input.unitId,
      principalId: principal,
      now,
    });
    await requireAssignedDsaNamedPanelAdjudicatorStillEligible(client, {
      workspaceId: input.workspaceId,
      projectId: text(unit, "project_id")!,
      epochId: input.epochId,
      unitId: input.unitId,
      principalId: principal,
      now,
    });
    await materializeResponses(client, input);
    const responses = await client.query(
      `SELECT DISTINCT derived_label FROM tokenless_dsa_named_panel_response_evidence
       WHERE workspace_id=$1 AND epoch_id=$2 AND unit_id=$3`,
      [input.workspaceId, input.epochId, input.unitId],
    );
    if ((responses.rowCount ?? 0) < 2)
      fail("Adjudication is allowed only for an actual disagreement.", "dsa_named_panel_no_disagreement", 409);
    const qualificationExpiresAt = instant(exactAssignment, "qualification_expires_at");
    const existing = await client.query(
      `SELECT marker.lease_id,marker.artifact_id,lease.expires_at
       FROM tokenless_dsa_named_panel_adjudication_artifact_leases marker
       JOIN tokenless_assurance_artifact_leases lease ON lease.lease_id=marker.lease_id
       WHERE marker.workspace_id=$1 AND marker.epoch_id=$2 AND marker.unit_id=$3
         AND marker.adjudicator_principal_id=$4 AND marker.qualification_expires_at>$5
         AND lease.revoked_at IS NULL AND lease.expires_at>$5
       ORDER BY marker.issued_at DESC LIMIT 1 FOR SHARE OF marker,lease`,
      [input.workspaceId, input.epochId, input.unitId, principal, now],
    );
    if (existing.rowCount === 1) {
      return {
        artifactId: text(existing.rows[0] as Row, "artifact_id")!,
        leaseId: text(existing.rows[0] as Row, "lease_id")!,
        expiresAt: instant(existing.rows[0] as Row, "expires_at").toISOString(),
      };
    }
    const expiresAt = new Date(
      Math.min(
        now.getTime() + ADJUDICATION_ARTIFACT_LEASE_TTL_MS,
        qualificationExpiresAt.getTime(),
        instant(exactAssignment, "adjudication_deadline").getTime(),
      ),
    );
    if (expiresAt <= now)
      fail("Current adjudicator qualification evidence is required.", "dsa_named_panel_adjudicator_unqualified", 403);
    const leaseId = `lease_${randomUUID().replaceAll("-", "")}`;
    await client.query(
      `INSERT INTO tokenless_assurance_artifact_leases
       (lease_id,artifact_id,workspace_id,project_id,account_address,assignment_id,purpose,expires_at,created_by,created_at)
       VALUES ($1,$2,$3,$4,$5,NULL,'dsa_named_panel_adjudication',$6,$5,$7)`,
      [
        leaseId,
        text(unit, "content_artifact_id"),
        input.workspaceId,
        text(unit, "project_id"),
        principal,
        expiresAt,
        now,
      ],
    );
    await client.query(
      `INSERT INTO tokenless_dsa_named_panel_adjudication_artifact_leases
       (workspace_id,project_id,epoch_id,unit_id,adjudicator_principal_id,artifact_id,artifact_digest,
        lease_id,qualification_expires_at,issued_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        input.workspaceId,
        text(unit, "project_id"),
        input.epochId,
        input.unitId,
        principal,
        text(unit, "content_artifact_id"),
        text(unit, "content_artifact_digest"),
        leaseId,
        qualificationExpiresAt,
        now,
      ],
    );
    return { artifactId: text(unit, "content_artifact_id")!, leaseId, expiresAt: expiresAt.toISOString() };
  });
}

export async function adjudicateDsaNamedPanelDisagreement(input: {
  accountAddress: string;
  workspaceId: string;
  epochId: string;
  unitId: string;
  referenceLabel: ReferenceLabel;
  rationale: string;
  conflictDeclaration: { hasConflict: boolean; relationships: readonly string[] };
}) {
  const principal = actor(input.accountAddress);
  if (
    !["pass", "fail", "uncertain"].includes(input.referenceLabel) ||
    typeof input.rationale !== "string" ||
    input.rationale.trim().length < 20 ||
    input.rationale.length > 4000
  )
    fail("Adjudication is invalid.");
  if (
    input.conflictDeclaration?.hasConflict !== false ||
    !Array.isArray(input.conflictDeclaration.relationships) ||
    input.conflictDeclaration.relationships.length > 20 ||
    input.conflictDeclaration.relationships.some(value => typeof value !== "string" || value.length > 200)
  )
    fail("A cleared adjudicator conflict declaration is required.", "dsa_named_panel_adjudicator_conflict", 403);
  return transaction(async client => {
    const unitResult = await client.query(
      `SELECT * FROM tokenless_dsa_named_panel_units WHERE workspace_id=$1 AND epoch_id=$2 AND unit_id=$3 FOR UPDATE`,
      [input.workspaceId, input.epochId, input.unitId],
    );
    const unit = unitResult.rows[0] as Row | undefined;
    if (!unit) notFound();
    const now = await databaseNow(client);
    const exactAssignment = await requireAssignedDsaNamedPanelAdjudicator(client, {
      workspaceId: input.workspaceId,
      epochId: input.epochId,
      unitId: input.unitId,
      principalId: principal,
      now,
    });
    await requireAssignedDsaNamedPanelAdjudicatorStillEligible(client, {
      workspaceId: input.workspaceId,
      projectId: text(unit, "project_id")!,
      epochId: input.epochId,
      unitId: input.unitId,
      principalId: principal,
      now,
    });
    await materializeResponses(client, input);
    const responses = await client.query(
      `SELECT DISTINCT derived_label FROM tokenless_dsa_named_panel_response_evidence WHERE workspace_id=$1 AND epoch_id=$2 AND unit_id=$3`,
      [input.workspaceId, input.epochId, input.unitId],
    );
    if ((responses.rowCount ?? 0) < 2)
      fail("Adjudication is allowed only for an actual disagreement.", "dsa_named_panel_no_disagreement", 409);
    const artifactAccess = await client.query(
      `SELECT marker.lease_id,log.log_id,log.occurred_at
       FROM tokenless_dsa_named_panel_adjudication_artifact_leases marker
       JOIN tokenless_assurance_artifact_leases lease
         ON lease.lease_id=marker.lease_id AND lease.artifact_id=marker.artifact_id
        AND lease.workspace_id=marker.workspace_id AND lease.project_id=marker.project_id
        AND lease.account_address=marker.adjudicator_principal_id
        AND lease.purpose='dsa_named_panel_adjudication'
        AND lease.revoked_at IS NULL AND lease.expires_at>$5
       JOIN tokenless_assurance_access_logs log
         ON log.lease_id=marker.lease_id AND log.workspace_id=marker.workspace_id
        AND log.project_id=marker.project_id AND log.artifact_id=marker.artifact_id
        AND log.action='read' AND log.purpose='dsa_named_panel_adjudication'
        AND log.occurred_at>=marker.issued_at AND log.occurred_at>=lease.created_at
        AND log.occurred_at<lease.expires_at
        AND (lease.revoked_at IS NULL OR log.occurred_at<lease.revoked_at)
        AND log.occurred_at<=$5
       WHERE marker.workspace_id=$1 AND marker.epoch_id=$2 AND marker.unit_id=$3
         AND marker.adjudicator_principal_id=$4 AND marker.artifact_id=$6
         AND marker.qualification_expires_at>=$5
       ORDER BY log.occurred_at DESC,log.log_id DESC LIMIT 1 FOR SHARE OF marker,lease,log`,
      [input.workspaceId, input.epochId, input.unitId, principal, now, text(unit, "content_artifact_id")],
    );
    if (artifactAccess.rowCount !== 1)
      fail(
        "Open the exact blinded artifact before recording an adjudication.",
        "dsa_named_panel_adjudicator_artifact_access_required",
        409,
      );
    const rationaleDigest = sha256Rfc8785({ rationale: input.rationale.trim() });
    const createdAt = await databaseNow(client);
    const conflict = {
      schemaVersion: "rateloop.dsa-named-panel-adjudicator-conflict.v1",
      workspaceId: input.workspaceId,
      epochId: input.epochId,
      unitId: input.unitId,
      adjudicatorPrincipalId: principal,
      hasConflict: false,
      relationships: [...input.conflictDeclaration.relationships].sort((left, right) =>
        left < right ? -1 : left > right ? 1 : 0,
      ),
      declaredAt: createdAt.toISOString(),
    };
    const languageEvidenceJson = text(exactAssignment, "language_evidence_json")!;
    const competenceEvidenceJson = text(exactAssignment, "category_competence_evidence_json")!;
    const conflictJson = canonical(conflict);
    const qualificationExpiresAt = instant(exactAssignment, "qualification_expires_at");
    const evidence = {
      schemaVersion: "rateloop.dsa-named-panel-adjudication.v1",
      workspaceId: input.workspaceId,
      epochId: input.epochId,
      unitId: input.unitId,
      adjudicatorPrincipalId: principal,
      artifactId: text(unit, "content_artifact_id"),
      artifactLeaseId: text(artifactAccess.rows[0] as Row, "lease_id"),
      artifactAccessLogId: text(artifactAccess.rows[0] as Row, "log_id"),
      artifactAccessedAt: instant(artifactAccess.rows[0] as Row, "occurred_at").toISOString(),
      referenceLabel: input.referenceLabel,
      rationaleDigest,
      createdAt: createdAt.toISOString(),
    };
    const adjudicationId = `dsapa_adj_${sha256Rfc8785(evidence).slice(7, 47)}`,
      evidenceJson = canonical(evidence),
      adjudicatorBinding = adjudicatorLabelBinding({
        workspaceId: input.workspaceId,
        epochId: input.epochId,
        unitId: input.unitId,
        adjudicationId,
        principalId: principal,
      });
    await client.query(
      `INSERT INTO tokenless_dsa_named_panel_adjudications
      (workspace_id,project_id,epoch_id,unit_id,run_id,case_id,mapping_commitment,adjudication_id,adjudicator_principal_id,
       artifact_id,artifact_lease_id,artifact_access_log_id,artifact_accessed_at,
       reference_label,language_evidence_json,language_evidence_hash,category_competence_evidence_json,
       category_competence_evidence_hash,conflict_declaration_json,conflict_declaration_hash,qualification_expires_at,
       rationale_digest,adjudication_json,adjudication_hash,created_at,adjudicator_label_binding)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
      [
        input.workspaceId,
        text(unit, "project_id"),
        input.epochId,
        input.unitId,
        text(unit, "run_id"),
        text(unit, "case_id"),
        text(unit, "mapping_commitment"),
        adjudicationId,
        principal,
        text(unit, "content_artifact_id"),
        text(artifactAccess.rows[0] as Row, "lease_id"),
        text(artifactAccess.rows[0] as Row, "log_id"),
        instant(artifactAccess.rows[0] as Row, "occurred_at"),
        input.referenceLabel,
        languageEvidenceJson,
        text(exactAssignment, "language_evidence_hash"),
        competenceEvidenceJson,
        text(exactAssignment, "category_competence_evidence_hash"),
        conflictJson,
        sha256Rfc8785(conflict),
        qualificationExpiresAt,
        rationaleDigest,
        evidenceJson,
        sha256Rfc8785(evidence),
        createdAt,
        adjudicatorBinding,
      ],
    );
    const revokedLease = await client.query(
      `UPDATE tokenless_assurance_artifact_leases
       SET revoked_at=$2
       WHERE lease_id=$1 AND account_address=$3 AND purpose='dsa_named_panel_adjudication'
         AND revoked_at IS NULL AND expires_at>$2`,
      [text(artifactAccess.rows[0] as Row, "lease_id"), createdAt, principal],
    );
    if (revokedLease.rowCount !== 1)
      fail(
        "The adjudication artifact lease is no longer active.",
        "dsa_named_panel_adjudicator_artifact_access_required",
        409,
      );
    return { adjudicationId, referenceLabel: input.referenceLabel, adjudicationHash: sha256Rfc8785(evidence) };
  });
}

function namedPanelResponseEvidenceRoot(rows: readonly Row[]) {
  return dsaNamedPanelResponseEvidenceRoot(
    rows.map(value => [
      text(value, "assignment_id")!,
      text(value, "reviewer_principal_id")!,
      text(value, "response_id")!,
      text(value, "response_digest")!,
      text(value, "derived_label")!,
      text(value, "evidence_hash")!,
    ]),
  );
}

export async function declareDsaNamedPanelUnitGap(input: {
  accountAddress: string;
  workspaceId: string;
  epochId: string;
  unitId: string;
  reason: "reviewer_nonresponse" | "adjudicator_nonresponse";
}) {
  const principal = actor(input.accountAddress);
  exactId(input.workspaceId, "workspaceId");
  exactId(input.epochId, "epochId", EPOCH_ID);
  exactId(input.unitId, "unitId", UNIT_ID);
  if (input.reason !== "reviewer_nonresponse" && input.reason !== "adjudicator_nonresponse")
    fail("The sampled-unit gap reason is unsupported.");
  return transaction(async client => {
    const unitResult = await client.query(
      `SELECT unit.*,definition.version AS reference_definition_version,
              definition.definition_hash AS reference_definition_hash,
              definition.question AS reference_definition_question,
              definition.auditor_access_assignment_id,
              definition.created_by AS definition_created_by
       FROM tokenless_dsa_named_panel_units unit
       JOIN tokenless_dsa_named_panel_reference_definitions definition
         ON definition.workspace_id=unit.workspace_id AND definition.epoch_id=unit.epoch_id
       WHERE unit.workspace_id=$1 AND unit.epoch_id=$2 AND unit.unit_id=$3
       FOR UPDATE OF unit`,
      [input.workspaceId, input.epochId, input.unitId],
    );
    const unit = unitResult.rows[0] as Row | undefined;
    if (!unit) notFound();
    const declaredAt = await databaseNow(client);
    const authority = await client.query(
      `SELECT access.assignment_id
       FROM tokenless_project_access_assignments access
       LEFT JOIN tokenless_workspace_members member
         ON member.workspace_id=access.workspace_id AND member.account_address=$4
       WHERE access.assignment_id=$1 AND access.workspace_id=$2 AND access.project_id=$3
        AND access.subject_kind='principal' AND access.subject_reference=$4
        AND access.role='auditor' AND access.status='active'
        AND (access.expires_at IS NULL OR access.expires_at>$5)
         AND member.account_address IS NULL AND $4=$6
       FOR SHARE OF access`,
      [
        text(unit, "auditor_access_assignment_id"),
        input.workspaceId,
        text(unit, "project_id"),
        principal,
        declaredAt,
        text(unit, "definition_created_by"),
      ],
    );
    const auditorAccessAssignmentId = text(authority.rows[0] as Row | undefined, "assignment_id");
    if (!auditorAccessAssignmentId)
      fail(
        "An active project auditor without workspace membership must declare a sampled-unit gap.",
        "dsa_named_panel_gap_authority_required",
        403,
      );
    const existing = await client.query(
      `SELECT outcome.outcome_hash,gap.gap_evidence_id,gap.gap_hash,gap.gap_reason
       FROM tokenless_dsa_named_panel_unit_outcomes outcome
       LEFT JOIN tokenless_dsa_named_panel_unit_gaps gap
         ON gap.workspace_id=outcome.workspace_id AND gap.epoch_id=outcome.epoch_id AND gap.unit_id=outcome.unit_id
       WHERE outcome.workspace_id=$1 AND outcome.epoch_id=$2 AND outcome.unit_id=$3 FOR SHARE OF outcome`,
      [input.workspaceId, input.epochId, input.unitId],
    );
    if (existing.rowCount) {
      const row = existing.rows[0] as Row;
      if (!text(row, "gap_evidence_id"))
        fail("This sampled unit already has a non-gap terminal outcome.", "dsa_named_panel_outcome_conflict", 409);
      if (text(row, "gap_reason") !== input.reason)
        fail("This sampled unit already has a different terminal gap.", "dsa_named_panel_outcome_conflict", 409);
      return {
        unitId: input.unitId,
        reason: input.reason,
        gapEvidenceId: text(row, "gap_evidence_id")!,
        gapHash: text(row, "gap_hash")!,
        outcomeHash: text(row, "outcome_hash")!,
        idempotent: true,
      };
    }
    await materializeResponses(client, input, { allowIncomplete: true });
    const coverage = await client.query(
      `SELECT count(*) AS assignment_count,count(DISTINCT selection.reviewer_principal_id) AS reviewer_count,
              max(selection.panel_deadline) AS assignment_deadline,
              (SELECT count(*) FROM tokenless_dsa_named_panel_assignments accepted
                WHERE accepted.workspace_id=$1 AND accepted.epoch_id=$2 AND accepted.unit_id=$3)
                AS accepted_assignment_count,
              (SELECT count(*) FROM tokenless_dsa_named_panel_response_evidence response
                WHERE response.workspace_id=$1 AND response.epoch_id=$2 AND response.unit_id=$3) AS response_count,
              (SELECT count(DISTINCT response.derived_label) FROM tokenless_dsa_named_panel_response_evidence response
                WHERE response.workspace_id=$1 AND response.epoch_id=$2 AND response.unit_id=$3) AS response_choice_count,
              (SELECT count(DISTINCT access.assignment_id) FROM tokenless_dsa_named_panel_artifact_accesses access
                WHERE access.workspace_id=$1 AND access.epoch_id=$2 AND access.unit_id=$3) AS access_count,
              (SELECT count(*) FROM tokenless_dsa_named_panel_content_self_identification_reports report
                WHERE report.workspace_id=$1 AND report.epoch_id=$2 AND report.unit_id=$3)
                AS content_self_identification_report_count
       FROM tokenless_dsa_named_panel_selections selection
       WHERE selection.workspace_id=$1 AND selection.epoch_id=$2 AND selection.unit_id=$3`,
      [input.workspaceId, input.epochId, input.unitId],
    );
    const coverageRow = coverage.rows[0] as Row;
    const requiredReviewerCount = integer(unit, "required_reviewer_count");
    const assignmentCount = integer(coverageRow, "assignment_count");
    const reviewerCount = integer(coverageRow, "reviewer_count");
    const acceptedAssignmentCount = integer(coverageRow, "accepted_assignment_count");
    const responseCount = integer(coverageRow, "response_count");
    const responseChoiceCount = integer(coverageRow, "response_choice_count");
    const accessCount = integer(coverageRow, "access_count");
    const contentSelfIdentificationReportCount = integer(coverageRow, "content_self_identification_report_count");
    if (assignmentCount !== requiredReviewerCount || reviewerCount !== requiredReviewerCount)
      fail("The exact frozen reviewer panel is required before declaring a gap.", "dsa_named_panel_incomplete", 409);
    let assignmentDeadline = instant(coverageRow, "assignment_deadline");
    let adjudicatorPrincipalId: string | null = null;
    let adjudicatorAssignmentHash: string | null = null;
    if (input.reason === "reviewer_nonresponse") {
      if (contentSelfIdentificationReportCount !== 0)
        fail(
          "A reviewer self-identification report must be closed through its typed gap path.",
          "dsa_named_panel_gap_conflict",
          409,
        );
      if (assignmentDeadline >= declaredAt)
        fail("The frozen reviewer deadline has not elapsed.", "dsa_named_panel_gap_deadline_pending", 409);
      if (responseCount === requiredReviewerCount)
        fail(
          "Complete reviewer response coverage cannot be declared as reviewer nonresponse.",
          "dsa_named_panel_gap_not_present",
          409,
        );
    } else {
      if (responseCount !== requiredReviewerCount || responseChoiceCount < 2)
        fail(
          "Adjudicator nonresponse requires one exact full-panel disagreement.",
          "dsa_named_panel_gap_not_present",
          409,
        );
      if (contentSelfIdentificationReportCount !== 0)
        fail(
          "Adjudicator nonresponse cannot replace a reviewer self-identification gap.",
          "dsa_named_panel_gap_conflict",
          409,
        );
      const assignmentResult = await client.query(
        `SELECT adjudicator_principal_id,assignment_hash,adjudication_deadline
         FROM tokenless_dsa_named_panel_adjudicator_assignments
         WHERE workspace_id=$1 AND project_id=$2 AND epoch_id=$3 AND unit_id=$4
           AND assigned_by=$5 AND auditor_access_assignment_id=$6
         FOR SHARE`,
        [
          input.workspaceId,
          text(unit, "project_id"),
          input.epochId,
          input.unitId,
          principal,
          auditorAccessAssignmentId,
        ],
      );
      const adjudicatorAssignment = assignmentResult.rows[0] as Row | undefined;
      if (assignmentResult.rowCount !== 1)
        fail(
          "The exact separated-auditor adjudicator assignment is required.",
          "dsa_named_panel_adjudicator_assignment_required",
          409,
        );
      assignmentDeadline = instant(adjudicatorAssignment, "adjudication_deadline");
      adjudicatorPrincipalId = text(adjudicatorAssignment, "adjudicator_principal_id");
      adjudicatorAssignmentHash = text(adjudicatorAssignment, "assignment_hash");
      if (assignmentDeadline >= declaredAt)
        fail("The frozen adjudication deadline has not elapsed.", "dsa_named_panel_gap_deadline_pending", 409);
    }
    const responseResult = await client.query(
      `SELECT assignment_id,reviewer_principal_id,response_id,response_digest,derived_label,evidence_hash
       FROM tokenless_dsa_named_panel_response_evidence
       WHERE workspace_id=$1 AND epoch_id=$2 AND unit_id=$3
       ORDER BY encode(convert_to(assignment_id,'UTF8'),'hex') FOR SHARE`,
      [input.workspaceId, input.epochId, input.unitId],
    );
    const partialResponseRoot = namedPanelResponseEvidenceRoot(responseResult.rows as Row[]);
    const gapEvidenceId = `dsapa_gap_${sha256Rfc8785({
      workspaceId: input.workspaceId,
      epochId: input.epochId,
      unitId: input.unitId,
      reason: input.reason,
      assignmentDeadline: assignmentDeadline.toISOString(),
    }).slice(7, 47)}`;
    const commonGap = {
      workspaceId: input.workspaceId,
      projectId: text(unit, "project_id"),
      epochId: input.epochId,
      unitId: input.unitId,
      gapEvidenceId,
      reason: input.reason,
      referenceDefinitionVersion: integer(unit, "reference_definition_version"),
      referenceDefinitionHash: text(unit, "reference_definition_hash"),
      referenceDefinitionQuestion: text(unit, "reference_definition_question"),
      requiredReviewerCount,
      assignmentCount,
      acceptedAssignmentCount,
      responseCount,
      accessCount,
      assignmentDeadline: assignmentDeadline.toISOString(),
      partialResponseRoot,
    } as const;
    const gap =
      input.reason === "reviewer_nonresponse"
        ? {
            schemaVersion: "rateloop.dsa-named-panel-unit-gap.v1",
            ...commonGap,
            authorityKind: "project_auditor_without_workspace_membership",
            auditorAccessAssignmentId,
            declaredBy: principal,
            declaredAt: declaredAt.toISOString(),
          }
        : {
            schemaVersion: "rateloop.dsa-named-panel-unit-gap.v3",
            ...commonGap,
            contentSelfIdentificationReportCount,
            contentSelfIdentificationReportRoot: null,
            adjudicatorPrincipalId,
            adjudicatorAssignmentHash,
            reportingMode: "separated_project_auditor_assignment_nonresponse",
            authorityKind: "project_auditor_without_workspace_membership",
            auditorAccessAssignmentId,
            declaredBy: principal,
            declaredAt: declaredAt.toISOString(),
          };
    const gapJson = canonical(gap);
    const gapHash = sha256Rfc8785(gap);
    await client.query(
      `INSERT INTO tokenless_dsa_named_panel_unit_gaps
       (workspace_id,project_id,epoch_id,unit_id,run_id,case_id,mapping_commitment,gap_evidence_id,gap_reason,
        reference_definition_version,reference_definition_hash,reference_definition_question,
        required_reviewer_count,assignment_count,accepted_assignment_count,response_count,access_count,assignment_deadline,
        partial_response_root,content_self_identification_report_count,content_self_identification_report_root,
        adjudicator_principal_id,adjudicator_assignment_hash,
        authority_kind,auditor_access_assignment_id,gap_json,gap_hash,declared_by,declared_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,NULL,$21,$22,
               'project_auditor_without_workspace_membership',$23,$24,$25,$26,$27)`,
      [
        input.workspaceId,
        text(unit, "project_id"),
        input.epochId,
        input.unitId,
        text(unit, "run_id"),
        text(unit, "case_id"),
        text(unit, "mapping_commitment"),
        gapEvidenceId,
        input.reason,
        integer(unit, "reference_definition_version"),
        text(unit, "reference_definition_hash"),
        text(unit, "reference_definition_question"),
        requiredReviewerCount,
        assignmentCount,
        acceptedAssignmentCount,
        responseCount,
        accessCount,
        assignmentDeadline,
        partialResponseRoot,
        contentSelfIdentificationReportCount,
        adjudicatorPrincipalId,
        adjudicatorAssignmentHash,
        auditorAccessAssignmentId,
        gapJson,
        gapHash,
        principal,
        declaredAt,
      ],
    );
    if (input.reason === "adjudicator_nonresponse") {
      await client.query(
        `UPDATE tokenless_assurance_artifact_leases lease
         SET revoked_at=$1
         FROM tokenless_dsa_named_panel_adjudication_artifact_leases marker
         WHERE marker.workspace_id=$2 AND marker.project_id=$3 AND marker.epoch_id=$4 AND marker.unit_id=$5
           AND marker.adjudicator_principal_id=$6
           AND lease.lease_id=marker.lease_id AND lease.workspace_id=marker.workspace_id
           AND lease.project_id=marker.project_id AND lease.artifact_id=marker.artifact_id
           AND lease.account_address=marker.adjudicator_principal_id
           AND lease.purpose='dsa_named_panel_adjudication'
           AND lease.revoked_at IS NULL AND lease.expires_at>$1`,
        [declaredAt, input.workspaceId, text(unit, "project_id"), input.epochId, input.unitId, adjudicatorPrincipalId],
      );
    } else {
      const openAssignments = await client.query(
        `SELECT assignment.assignment_id,assignment.status,assignment.subpanel_id,assignment.cohort_id,
                assignment.reviewer_account_address,assignment.paid_assignment
         FROM tokenless_dsa_named_panel_selections selection
         JOIN tokenless_assurance_assignments assignment
           ON assignment.workspace_id=selection.workspace_id AND assignment.project_id=selection.project_id
          AND assignment.run_id=selection.run_id AND assignment.assignment_id=selection.assignment_id
          AND assignment.reviewer_account_address=selection.reviewer_principal_id
         WHERE selection.workspace_id=$1 AND selection.epoch_id=$2 AND selection.unit_id=$3
           AND assignment.status IN ('reserved','accepted')
         ORDER BY encode(convert_to(assignment.assignment_id,'UTF8'),'hex') FOR UPDATE OF assignment`,
        [input.workspaceId, input.epochId, input.unitId],
      );
      for (const value of openAssignments.rows) {
        const assignment = value as Row;
        if (assignment.paid_assignment !== false)
          fail(
            "A DSA named-panel gap cannot release a paid assignment.",
            "dsa_named_panel_paid_assignment_forbidden",
            409,
          );
        const assignmentId = text(assignment, "assignment_id")!;
        const assignmentStatus = text(assignment, "status")!;
        const reviewerPrincipalId = text(assignment, "reviewer_account_address")!;
        await client.query(
          `INSERT INTO tokenless_dsa_named_panel_capacity_releases
           (workspace_id,project_id,epoch_id,unit_id,assignment_id,subpanel_id,cohort_id,reviewer_principal_id,
            prior_status,released_status,release_reason,terminal_evidence_id,released_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'released','reviewer_nonresponse_gap',$10,$11)`,
          [
            input.workspaceId,
            text(unit, "project_id"),
            input.epochId,
            input.unitId,
            assignmentId,
            text(assignment, "subpanel_id"),
            text(assignment, "cohort_id"),
            reviewerPrincipalId,
            assignmentStatus,
            gapEvidenceId,
            declaredAt,
          ],
        );
        const released = await client.query(
          `UPDATE tokenless_assurance_assignments
           SET status='released',lease_state='expired',updated_at=$1
           WHERE assignment_id=$2 AND reviewer_account_address=$3 AND status=$4`,
          [declaredAt, assignmentId, reviewerPrincipalId, assignmentStatus],
        );
        const subpanelReleased = await client.query(
          `UPDATE tokenless_assurance_run_subpanels SET active_reservations=active_reservations-1
           WHERE subpanel_id=$1 AND active_reservations>0`,
          [text(assignment, "subpanel_id")],
        );
        const cohortReleased = await client.query(
          `UPDATE tokenless_assurance_cohorts SET active_reservations=active_reservations-1
           WHERE project_id=$1 AND cohort_id=$2 AND active_reservations>0`,
          [text(unit, "project_id"), text(assignment, "cohort_id")],
        );
        const reviewerReleased = await client.query(
          `UPDATE tokenless_assurance_cohort_reviewers SET active_reservations=active_reservations-1
           WHERE project_id=$1 AND cohort_id=$2 AND reviewer_account_address=$3 AND active_reservations>0`,
          [text(unit, "project_id"), text(assignment, "cohort_id"), reviewerPrincipalId],
        );
        if (
          released.rowCount !== 1 ||
          subpanelReleased.rowCount !== 1 ||
          cohortReleased.rowCount !== 1 ||
          reviewerReleased.rowCount !== 1
        )
          fail(
            "The terminal gap could not release every exact open assignment.",
            "dsa_named_panel_gap_capacity_conflict",
            409,
          );
        await client.query(
          `UPDATE tokenless_assurance_artifact_leases SET revoked_at=$1
           WHERE assignment_id=$2 AND account_address=$3 AND revoked_at IS NULL AND expires_at>$1`,
          [declaredAt, assignmentId, reviewerPrincipalId],
        );
      }
    }
    const outcome = {
      schemaVersion: "rateloop.dsa-named-panel-outcome.v1",
      workspaceId: input.workspaceId,
      epochId: input.epochId,
      unitId: input.unitId,
      requiredReviewerCount,
      responseCount,
      referenceLabel: "uncertain",
      agreementState: "gap",
      adjudicationId: null,
      gapEvidenceId,
      responseEvidenceRoot: partialResponseRoot,
      adjudicationEvidenceDigest: gapHash,
      frozenBy: principal,
      frozenAt: declaredAt.toISOString(),
    } as const;
    const outcomeJson = canonical(outcome);
    await client.query(
      `INSERT INTO tokenless_dsa_named_panel_unit_outcomes
       (workspace_id,project_id,epoch_id,unit_id,run_id,case_id,mapping_commitment,required_reviewer_count,
        response_count,reference_label,agreement_state,adjudication_id,gap_evidence_id,response_evidence_root,
        adjudication_evidence_digest,outcome_json,outcome_hash,frozen_by,frozen_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'uncertain','gap',NULL,$10,$11,$12,$13,$14,$15,$16)`,
      [
        input.workspaceId,
        text(unit, "project_id"),
        input.epochId,
        input.unitId,
        text(unit, "run_id"),
        text(unit, "case_id"),
        text(unit, "mapping_commitment"),
        requiredReviewerCount,
        responseCount,
        gapEvidenceId,
        partialResponseRoot,
        gapHash,
        outcomeJson,
        sha256Rfc8785(outcome),
        principal,
        declaredAt,
      ],
    );
    return {
      unitId: input.unitId,
      reason: input.reason,
      gapEvidenceId,
      gapHash,
      outcomeHash: sha256Rfc8785(outcome),
      idempotent: false,
    };
  });
}

export async function freezeDsaNamedPanelOutcome(input: {
  accountAddress: string;
  workspaceId: string;
  epochId: string;
  unitId: string;
}) {
  const principal = actor(input.accountAddress);
  return transaction(async client => {
    const unitResult = await client.query(
      `SELECT * FROM tokenless_dsa_named_panel_units WHERE workspace_id=$1 AND epoch_id=$2 AND unit_id=$3 FOR UPDATE`,
      [input.workspaceId, input.epochId, input.unitId],
    );
    const unit = unitResult.rows[0] as Row | undefined;
    if (!unit) notFound();
    await requireManager(client, principal, input.workspaceId, text(unit, "project_id")!);
    await materializeResponses(client, input);
    const responseResult = await client.query(
      `SELECT assignment_id,reviewer_principal_id,response_id,response_digest,derived_label,evidence_hash
      FROM tokenless_dsa_named_panel_response_evidence WHERE workspace_id=$1 AND epoch_id=$2 AND unit_id=$3 ORDER BY encode(convert_to(assignment_id,'UTF8'),'hex')`,
      [input.workspaceId, input.epochId, input.unitId],
    );
    const labels = new Set(responseResult.rows.map(value => text(value as Row, "derived_label")!));
    let referenceLabel: ReferenceLabel,
      agreementState: "agreed" | "adjudicated",
      adjudicationId: string | null = null,
      adjudicationHash: string | null = null;
    if (labels.size === 1) {
      referenceLabel = [...labels][0] as ReferenceLabel;
      agreementState = "agreed";
    } else {
      const adj = await client.query(
        `SELECT adjudication_id,reference_label,adjudication_hash FROM tokenless_dsa_named_panel_adjudications WHERE workspace_id=$1 AND epoch_id=$2 AND unit_id=$3`,
        [input.workspaceId, input.epochId, input.unitId],
      );
      const row = adj.rows[0] as Row | undefined;
      if (!row)
        fail(
          "A role-separated adjudication is required for reviewer disagreement.",
          "dsa_named_panel_adjudication_required",
          409,
        );
      referenceLabel = text(row, "reference_label") as ReferenceLabel;
      adjudicationId = text(row, "adjudication_id");
      adjudicationHash = text(row, "adjudication_hash");
      agreementState = "adjudicated";
    }
    const responses = responseResult.rows as Row[];
    const responseEvidenceRoot = namedPanelResponseEvidenceRoot(responses);
    const adjudicationEvidenceDigest = sha256Rfc8785({
      schemaVersion: "rateloop.dsa-named-panel-outcome-evidence.v1",
      workspaceId: input.workspaceId,
      epochId: input.epochId,
      unitId: input.unitId,
      responseEvidenceRoot,
      referenceLabel,
      agreementState,
      adjudicationId,
      gapEvidenceId: null,
      adjudicationHash,
    });
    const frozenAt = await databaseNow(client);
    const outcome = {
      schemaVersion: "rateloop.dsa-named-panel-outcome.v1",
      workspaceId: input.workspaceId,
      epochId: input.epochId,
      unitId: input.unitId,
      requiredReviewerCount: integer(unit, "required_reviewer_count"),
      responseCount: responses.length,
      referenceLabel,
      agreementState,
      adjudicationId,
      gapEvidenceId: null,
      responseEvidenceRoot,
      adjudicationEvidenceDigest,
      frozenBy: principal,
      frozenAt: frozenAt.toISOString(),
    };
    const outcomeJson = canonical(outcome);
    await client.query(
      `INSERT INTO tokenless_dsa_named_panel_unit_outcomes
      (workspace_id,project_id,epoch_id,unit_id,run_id,case_id,mapping_commitment,required_reviewer_count,response_count,
       reference_label,agreement_state,adjudication_id,gap_evidence_id,response_evidence_root,adjudication_evidence_digest,
       outcome_json,outcome_hash,frozen_by,frozen_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NULL,$13,$14,$15,$16,$17,$18)`,
      [
        input.workspaceId,
        text(unit, "project_id"),
        input.epochId,
        input.unitId,
        text(unit, "run_id"),
        text(unit, "case_id"),
        text(unit, "mapping_commitment"),
        integer(unit, "required_reviewer_count"),
        responses.length,
        referenceLabel,
        agreementState,
        adjudicationId,
        responseEvidenceRoot,
        adjudicationEvidenceDigest,
        outcomeJson,
        sha256Rfc8785(outcome),
        principal,
        frozenAt,
      ],
    );
    return {
      unitId: input.unitId,
      referenceLabel,
      agreementState,
      adjudicationEvidenceDigest,
      outcomeHash: sha256Rfc8785(outcome),
    };
  });
}

export async function loadDsaNamedPanelLabelInputs(client: PoolClient, workspaceId: string, epochId: string) {
  const units = await client.query(
    `SELECT count(*) AS unit_count FROM tokenless_dsa_named_panel_units WHERE workspace_id=$1 AND epoch_id=$2`,
    [workspaceId, epochId],
  );
  if (integer(units.rows[0] as Row, "unit_count") === 0) return null;
  const outcomes = await client.query(
    `SELECT outcome.unit_id,outcome.reference_label,outcome.agreement_state,outcome.adjudication_evidence_digest,
            outcome.adjudication_id,gap.gap_reason,adjudication.adjudicator_label_binding
     FROM tokenless_dsa_named_panel_unit_outcomes outcome
     LEFT JOIN tokenless_dsa_named_panel_unit_gaps gap
       ON gap.workspace_id=outcome.workspace_id AND gap.epoch_id=outcome.epoch_id AND gap.unit_id=outcome.unit_id
      AND gap.gap_evidence_id=outcome.gap_evidence_id
     LEFT JOIN tokenless_dsa_named_panel_adjudications adjudication
       ON adjudication.workspace_id=outcome.workspace_id AND adjudication.epoch_id=outcome.epoch_id
      AND adjudication.unit_id=outcome.unit_id AND adjudication.adjudication_id=outcome.adjudication_id
     WHERE outcome.workspace_id=$1 AND outcome.epoch_id=$2
     ORDER BY encode(convert_to(outcome.unit_id,'UTF8'),'hex') FOR SHARE OF outcome`,
    [workspaceId, epochId],
  );
  if (outcomes.rowCount !== integer(units.rows[0] as Row, "unit_count"))
    fail("Named-panel outcomes do not exactly cover the selected units.", "dsa_named_panel_outcomes_incomplete", 409);
  return outcomes.rows.map(value => {
    const row = value as Row;
    const agreementState = text(row, "agreement_state") as "agreed" | "adjudicated" | "gap";
    const adjudicatedBy = text(row, "adjudicator_label_binding");
    if (agreementState === "adjudicated" && !/^hmac-sha256:v1:[0-9a-f]{64}$/u.test(adjudicatedBy ?? ""))
      fail("Role-separated adjudication evidence is incomplete.", "dsa_named_panel_adjudication_incomplete", 409);
    return {
      unitId: text(row, "unit_id")!,
      referenceLabel: text(row, "reference_label") as ReferenceLabel,
      agreementState,
      adjudicationEvidenceDigest: text(row, "adjudication_evidence_digest") as `sha256:${string}`,
      ...(agreementState === "gap"
        ? {
            gapReason: text(row, "gap_reason") as
              | "reviewer_nonresponse"
              | "content_self_identification"
              | "adjudicator_nonresponse",
          }
        : {}),
      adjudicatedBy: agreementState === "adjudicated" ? adjudicatedBy : null,
    };
  });
}

export async function requireDsaNamedPanelReferenceDefinition(
  client: PoolClient,
  input: { workspaceId: string; epochId: string },
) {
  const definition = await client.query(
    `SELECT version,definition_hash FROM tokenless_dsa_named_panel_reference_definitions
     WHERE workspace_id=$1 AND epoch_id=$2 FOR SHARE`,
    [input.workspaceId, input.epochId],
  );
  const referenceDefinitionVersion = text(definition.rows[0] as Row | undefined, "version");
  const referenceDefinitionHash = text(definition.rows[0] as Row | undefined, "definition_hash");
  if (definition.rowCount !== 1 || !referenceDefinitionVersion || !referenceDefinitionHash) {
    fail("An auditor-frozen reference definition is required.", "dsa_named_panel_reference_definition_required", 409);
  }
  const result = await client.query(
    `SELECT blinded_payload_json FROM tokenless_dsa_named_panel_units
     WHERE workspace_id=$1 AND epoch_id=$2 ORDER BY encode(convert_to(unit_id,'UTF8'),'hex') FOR SHARE`,
    [input.workspaceId, input.epochId],
  );
  if (result.rowCount === 0) {
    fail(
      "Role-separated reference labels require registered named-panel units.",
      "dsa_named_panel_units_required",
      409,
    );
  }
  for (const value of result.rows) {
    const payload = parseJson<DsaBlindedCasePayload>((value as Row).blinded_payload_json, "blinded DSA payload");
    if (
      String(payload.policy.policyVersion) !== referenceDefinitionVersion ||
      payload.policy.policyHash !== referenceDefinitionHash
    ) {
      fail(
        "The reference definition must exactly match every named-panel unit.",
        "dsa_named_panel_reference_definition_conflict",
        409,
      );
    }
  }
  return {
    referenceDefinitionVersion,
    referenceDefinitionHash: referenceDefinitionHash as `sha256:${string}`,
  };
}

export async function persistDsaNamedPanelLabelSetBridge(
  client: PoolClient,
  input: {
    workspaceId: string;
    labelSetId: string;
    epochId: string;
    labelRoot: `sha256:${string}`;
    labelSetHash: `sha256:${string}`;
  },
) {
  const result = await client.query(
    `SELECT unit_id,outcome_hash,response_evidence_root,adjudication_evidence_digest
     FROM tokenless_dsa_named_panel_unit_outcomes
     WHERE workspace_id=$1 AND epoch_id=$2
     ORDER BY encode(convert_to(unit_id,'UTF8'),'hex') FOR SHARE`,
    [input.workspaceId, input.epochId],
  );
  if (result.rowCount === 0) return null;
  const rows = result.rows.map(value => ({
    unitId: text(value as Row, "unit_id"),
    outcomeHash: text(value as Row, "outcome_hash"),
    responseEvidenceRoot: text(value as Row, "response_evidence_root"),
    adjudicationEvidenceDigest: text(value as Row, "adjudication_evidence_digest"),
  }));
  const rootInput = `rateloop.dsa-named-panel-unit-outcome-root.v1\0${rows
    .map(row => [row.unitId, row.outcomeHash, row.responseEvidenceRoot, row.adjudicationEvidenceDigest].join("|"))
    .join("\n")}\n`;
  const unitOutcomeRoot = `sha256:${createHash("sha256").update(rootInput, "utf8").digest("hex")}` as const;
  const payload = {
    schemaVersion: "rateloop.dsa-named-panel-label-set-bridge.v1",
    ...input,
    unitOutcomeCount: rows.length,
    unitOutcomeRoot,
    reportingMode: "independent_reference_panel_research_only",
    populationClaim: false,
    operationalRollupEligible: false,
    adaptiveReuseAllowed: false,
  } as const;
  const bridgeJson = canonical(payload);
  const bridgeHash = sha256Rfc8785(payload);
  await client.query(
    `INSERT INTO tokenless_dsa_named_panel_label_set_bridges
     (workspace_id,label_set_id,epoch_id,label_root,label_set_hash,unit_outcome_count,unit_outcome_root,
      reporting_mode,population_claim,operational_rollup_eligible,adaptive_reuse_allowed,bridge_json,bridge_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'independent_reference_panel_research_only',false,false,false,$8,$9)`,
    [
      input.workspaceId,
      input.labelSetId,
      input.epochId,
      input.labelRoot,
      input.labelSetHash,
      rows.length,
      unitOutcomeRoot,
      bridgeJson,
      bridgeHash,
    ],
  );
  return { unitOutcomeCount: rows.length, unitOutcomeRoot, bridgeHash };
}

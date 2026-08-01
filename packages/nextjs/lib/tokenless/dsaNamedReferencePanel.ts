import { canonicalizeRfc8785, sha256Rfc8785 } from "@rateloop/node-utils/jcs";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbPool } from "~~/lib/db";
import {
  assuranceReviewerKey,
  getAssuranceResponseKeyrings,
  submitAssuranceResponses,
} from "~~/lib/tokenless/assuranceResponses";
import {
  type DsaBlindedCaseMapping,
  type DsaBlindedCasePayload,
  type DsaWithheldCaseValues,
  freezeDsaBlindedCaseMapping,
} from "~~/lib/tokenless/dsaBlindedCaseProjection";
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
  deadline: Date;
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
      verifiedAt <= input.deadline &&
      Number.isFinite(expiresAt.getTime()) &&
      expiresAt >= input.deadline &&
      typeof entry.evidenceReferenceHash === "string" &&
      HASH.test(entry.evidenceReferenceHash)
    );
  });
  if (entries.length !== 1)
    fail("Exact, current reviewer qualification evidence is required.", "dsa_named_panel_qualification_missing", 409);
  return entries[0]!;
}

function cefrSatisfies(value: unknown, required: CefrLevel) {
  return typeof value === "string" && CEFR_ORDER.indexOf(value as CefrLevel) >= CEFR_ORDER.indexOf(required);
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
  payload: DsaBlindedCasePayload;
  withheld: DsaWithheldCaseValues;
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
  const mapping = freezeDsaBlindedCaseMapping({ payload: input.payload, withheld: input.withheld });
  const payloadJson = canonical(input.payload);
  return transaction(async client => {
    await requireManager(client, principal, input.workspaceId, input.projectId);
    const source = await client.query(
      `SELECT m.*,e.evaluation_id,e.provider_decision_id,e.decision_version,e.system_id,e.system_version,
              e.evaluation_hash,e.projection_hash AS evaluation_projection_hash,
              epoch.population_id AS epoch_population_id,epoch.population_version AS epoch_population_version,
              epoch.frame_id AS epoch_frame_id,
              c.baseline_artifact_id,c.candidate_artifact_id,
              rc.variant_a_artifact_id,rc.variant_b_artifact_id,rc.blinding_commitment,
              a.digest AS content_artifact_digest,a.content_type,
              (SELECT count(*) FROM tokenless_assurance_run_cases counted WHERE counted.run_id=$5) AS run_case_count,
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
       JOIN tokenless_assurance_cases c ON c.project_id=$4 AND c.case_id=$6
       JOIN tokenless_assurance_run_cases rc ON rc.run_id=$5 AND rc.case_id=c.case_id
       JOIN tokenless_assurance_artifacts a ON a.project_id=c.project_id AND a.artifact_id=c.candidate_artifact_id
       WHERE m.workspace_id=$1 AND m.epoch_id=$2 AND m.unit_id=$3 AND m.selected=true
         AND e.disposition='eligible_draw' AND e.reference_label_state='unlabeled' FOR SHARE`,
      [input.workspaceId, input.epochId, input.unitId, input.projectId, input.runId, input.caseId],
    );
    const row = source.rows[0] as Row | undefined;
    if (!row) notFound();
    if (
      mapping.content.artifactId !== text(row, "candidate_artifact_id") ||
      mapping.content.contentHash !== text(row, "content_artifact_digest") ||
      mapping.content.contentType !== text(row, "content_type") ||
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
      withheldSnapshotDigest: sha256Rfc8785(input.withheld),
      requiredCefrLevel: input.requiredCefrLevel,
      requiredReviewerCount: input.requiredReviewerCount,
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
        population_id,population_version,frame_id,selection_rank)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,
               $25,$26,$27,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43)
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
        sha256Rfc8785(input.withheld),
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
      idempotent: false,
    };
  });
}

export async function acceptDsaNamedPanelAssignment(input: {
  accountAddress: string;
  workspaceId: string;
  epochId: string;
  unitId: string;
  assignmentId: string;
  conflictDeclaration: { hasConflict: boolean; relationships: readonly string[] };
}) {
  const principal = actor(input.accountAddress);
  exactId(input.epochId, "epochId", EPOCH_ID);
  exactId(input.unitId, "unitId", UNIT_ID);
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
  return transaction(async client => {
    const now = await databaseNow(client);
    const result = await client.query(
      `SELECT u.*,a.status AS assignment_status,a.source AS reviewer_source,a.reviewer_account_address,
              a.qualification_provenance_json,a.accepted_at,a.assignment_expires_at,a.lease_state,
              (SELECT count(*) FROM tokenless_assurance_run_cases counted WHERE counted.run_id=u.run_id) AS run_case_count
       FROM tokenless_dsa_named_panel_units u
       JOIN tokenless_assurance_assignments a
         ON a.workspace_id=u.workspace_id AND a.project_id=u.project_id AND a.run_id=u.run_id AND a.assignment_id=$4
       WHERE u.workspace_id=$1 AND u.epoch_id=$2 AND u.unit_id=$3
         AND a.reviewer_account_address=$5 FOR SHARE`,
      [input.workspaceId, input.epochId, input.unitId, input.assignmentId, principal],
    );
    const row = result.rows[0] as Row | undefined;
    if (
      !row ||
      text(row, "assignment_status") !== "accepted" ||
      text(row, "lease_state") !== "issued" ||
      text(row, "reviewer_source") !== "customer_invited" ||
      integer(row, "run_case_count") !== 1
    )
      notFound();
    const deadline = instant(row, "assignment_expires_at");
    if (deadline <= now) notFound();
    const provenance = parseJson<unknown>(row.qualification_provenance_json, "qualification provenance");
    const languageKey = `language:${text(row, "language_tag")!.toLowerCase()}:reading:cefr`;
    const language = qualificationEntry({
      provenance,
      key: languageKey,
      predicate: value => cefrSatisfies(value, text(row, "required_cefr_level") as CefrLevel),
      deadline,
    });
    const competence = qualificationEntry({
      provenance,
      key: `dsa-policy-category:${text(row, "policy_category_code")}`,
      predicate: value => value === true,
      deadline,
    });
    const languageEvidenceJson = canonical(language);
    const competenceEvidenceJson = canonical(competence);
    const declaration = {
      schemaVersion: "rateloop.dsa-named-panel-conflict.v1",
      workspaceId: input.workspaceId,
      epochId: input.epochId,
      unitId: input.unitId,
      assignmentId: input.assignmentId,
      reviewerPrincipalId: principal,
      hasConflict: false,
      relationships: [...input.conflictDeclaration.relationships].sort((left, right) =>
        left < right ? -1 : left > right ? 1 : 0,
      ),
      declaredAt: now.toISOString(),
    };
    const snapshot = {
      schemaVersion: "rateloop.dsa-named-panel-assignment.v1",
      workspaceId: input.workspaceId,
      epochId: input.epochId,
      unitId: input.unitId,
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
        input.workspaceId,
        text(row, "project_id"),
        input.epochId,
        input.unitId,
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
      `SELECT assignment_snapshot_hash FROM tokenless_dsa_named_panel_assignments WHERE workspace_id=$1 AND epoch_id=$2 AND unit_id=$3 AND assignment_id=$4`,
      [input.workspaceId, input.epochId, input.unitId, input.assignmentId],
    );
    if (text(stored.rows[0] as Row | undefined, "assignment_snapshot_hash") !== sha256Rfc8785(snapshot))
      fail("This assignment already has different frozen DSA evidence.", "dsa_named_panel_assignment_conflict", 409);
    return { assignmentId: input.assignmentId, unitId: input.unitId, assignmentSnapshotHash: sha256Rfc8785(snapshot) };
  });
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
      instant(row, "lease_expires_at") < instant(row, "assignment_expires_at")
    )
      notFound();
    const mapping = storedMapping(row);
    const accessPayload = {
      schemaVersion: "rateloop.dsa-named-panel-access.v1",
      workspaceId: text(row, "workspace_id"),
      projectId: text(row, "project_id"),
      epochId: text(row, "epoch_id"),
      unitId: text(row, "unit_id"),
      assignmentId: input.assignmentId,
      reviewerPrincipalId: principal,
      artifactId: mapping.content.artifactId,
      artifactDigest: mapping.content.contentHash,
      leaseId: text(row, "lease_id"),
      accessedAt: clock.toISOString(),
    };
    const accessId = `dsapa_${sha256Rfc8785({ assignmentId: input.assignmentId, mappingCommitment: mapping.mappingCommitment }).slice(7, 47)}`;
    const existing = await client.query(
      `SELECT access_id FROM tokenless_dsa_named_panel_artifact_accesses WHERE access_id=$1`,
      [accessId],
    );
    if (existing.rowCount === 0) {
      const accessJson = canonical(accessPayload);
      await client.query(
        `INSERT INTO tokenless_dsa_named_panel_artifact_accesses
        (access_id,workspace_id,project_id,epoch_id,unit_id,assignment_id,reviewer_principal_id,artifact_id,artifact_digest,
         lease_id,lease_expires_at,lease_revoked_at,access_json,access_hash,accessed_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL,$12,$13,$14)`,
        [
          accessId,
          text(row, "workspace_id"),
          text(row, "project_id"),
          text(row, "epoch_id"),
          text(row, "unit_id"),
          input.assignmentId,
          principal,
          mapping.content.artifactId,
          mapping.content.contentHash,
          text(row, "lease_id"),
          instant(row, "lease_expires_at"),
          accessJson,
          sha256Rfc8785(accessPayload),
          clock,
        ],
      );
    }
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
      `SELECT u.case_id,u.baseline_artifact_id,u.candidate_artifact_id,u.variant_a_artifact_id,u.variant_b_artifact_id,
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
  const selectedArtifactId =
    input.response.choice === "policy_matches"
      ? text(lookup, "candidate_artifact_id")!
      : text(lookup, "baseline_artifact_id")!;
  const displayedOption =
    selectedArtifactId === text(lookup, "variant_a_artifact_id") ? ("A" as const) : ("B" as const);
  return submitAssuranceResponses({
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
}

async function materializeResponses(
  client: PoolClient,
  input: { workspaceId: string; epochId: string; unitId: string },
) {
  const assignments = await client.query(
    `SELECT pa.*,a.rater_id,u.baseline_artifact_id,u.candidate_artifact_id,u.required_reviewer_count
    FROM tokenless_dsa_named_panel_assignments pa JOIN tokenless_assurance_assignments a
      ON a.workspace_id=pa.workspace_id AND a.project_id=pa.project_id AND a.run_id=pa.run_id
     AND a.assignment_id=pa.assignment_id AND a.reviewer_account_address=pa.reviewer_principal_id
    JOIN tokenless_dsa_named_panel_units u ON u.workspace_id=pa.workspace_id AND u.epoch_id=pa.epoch_id AND u.unit_id=pa.unit_id
    WHERE pa.workspace_id=$1 AND pa.epoch_id=$2 AND pa.unit_id=$3 ORDER BY encode(convert_to(pa.assignment_id,'UTF8'),'hex') FOR SHARE`,
    [input.workspaceId, input.epochId, input.unitId],
  );
  if (assignments.rowCount === 0) notFound();
  const expected = integer(assignments.rows[0] as Row, "required_reviewer_count");
  if (assignments.rowCount !== expected)
    fail("The named panel is not fully assigned.", "dsa_named_panel_incomplete", 409);
  const keyrings = getAssuranceResponseKeyrings();
  for (const raw of assignments.rows) {
    const row = raw as Row;
    const identity = text(row, "rater_id") ?? text(row, "reviewer_principal_id")!;
    const reviewerKeys = [...keyrings.reviewerMapping.keys.keys()].map(version =>
      assuranceReviewerKey(
        { accountAddress: identity, runId: text(row, "run_id")! },
        keyrings.reviewerMapping,
        version,
      ),
    );
    const response = await client.query(
      `SELECT response_id,reviewer_key,reviewer_source,response_digest,validity,choice,submitted_at
      FROM tokenless_assurance_responses WHERE run_id=$1 AND case_id=$2 AND reviewer_key=ANY($3::text[]) AND validity='valid'`,
      [text(row, "run_id"), text(row, "case_id"), reviewerKeys],
    );
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
    if (accessedAt > submittedAt)
      fail(
        "The blinded artifact must be opened before response submission.",
        "dsa_named_panel_access_order_invalid",
        409,
      );
    const choice = text(rr, "choice");
    const derivedLabel = choice === "candidate" ? "pass" : choice === "baseline" ? "fail" : null;
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
    await client.query(
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
  }
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
      `SELECT * FROM tokenless_dsa_named_panel_units WHERE workspace_id=$1 AND epoch_id=$2 AND unit_id=$3 FOR SHARE`,
      [input.workspaceId, input.epochId, input.unitId],
    );
    const unit = unitResult.rows[0] as Row | undefined;
    if (!unit) notFound();
    await materializeResponses(client, input);
    const panel = await client.query(
      `SELECT reviewer_principal_id FROM tokenless_dsa_named_panel_assignments WHERE workspace_id=$1 AND epoch_id=$2 AND unit_id=$3`,
      [input.workspaceId, input.epochId, input.unitId],
    );
    if (panel.rows.some(value => text(value as Row, "reviewer_principal_id") === principal))
      fail("A panel reviewer cannot adjudicate their own disagreement.", "dsa_named_panel_adjudicator_conflict", 403);
    const access = await client.query(
      `SELECT cr.qualification_provenance_json FROM tokenless_workspace_reviewers wr
      JOIN tokenless_principals p ON p.principal_id=wr.principal_address AND p.status='active'
      JOIN tokenless_assurance_cohort_reviewers cr ON cr.project_id=$3 AND cr.reviewer_account_address=wr.principal_address AND cr.status='active'
      WHERE wr.workspace_id=$1 AND wr.principal_address=$2 AND wr.status='active'`,
      [input.workspaceId, principal, text(unit, "project_id")],
    );
    const now = await databaseNow(client);
    let adjudicatorEvidence: { language: ProvenanceEntry; competence: ProvenanceEntry } | null = null;
    for (const value of access.rows) {
      try {
        const provenance = parseJson<unknown>(
          (value as Row).qualification_provenance_json,
          "adjudicator qualification",
        );
        const language = qualificationEntry({
          provenance,
          key: `language:${text(unit, "language_tag")!.toLowerCase()}:reading:cefr`,
          predicate: v => cefrSatisfies(v, text(unit, "required_cefr_level") as CefrLevel),
          deadline: now,
        });
        const competence = qualificationEntry({
          provenance,
          key: `dsa-policy-category:${text(unit, "policy_category_code")}`,
          predicate: v => v === true,
          deadline: now,
        });
        adjudicatorEvidence = { language, competence };
        break;
      } catch {
        // Try another active invited-reviewer qualification snapshot.
      }
    }
    if (!adjudicatorEvidence)
      fail("An independent, qualified adjudicator is required.", "dsa_named_panel_adjudicator_unqualified", 403);
    const responses = await client.query(
      `SELECT DISTINCT derived_label FROM tokenless_dsa_named_panel_response_evidence WHERE workspace_id=$1 AND epoch_id=$2 AND unit_id=$3`,
      [input.workspaceId, input.epochId, input.unitId],
    );
    if ((responses.rowCount ?? 0) < 2)
      fail("Adjudication is allowed only for an actual disagreement.", "dsa_named_panel_no_disagreement", 409);
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
    const languageEvidenceJson = canonical(adjudicatorEvidence.language);
    const competenceEvidenceJson = canonical(adjudicatorEvidence.competence);
    const conflictJson = canonical(conflict);
    const qualificationExpiresAt = [
      new Date(String(adjudicatorEvidence.language.expiresAt)),
      new Date(String(adjudicatorEvidence.competence.expiresAt)),
    ].sort((left, right) => left.getTime() - right.getTime())[0]!;
    const evidence = {
      schemaVersion: "rateloop.dsa-named-panel-adjudication.v1",
      workspaceId: input.workspaceId,
      epochId: input.epochId,
      unitId: input.unitId,
      adjudicatorPrincipalId: principal,
      referenceLabel: input.referenceLabel,
      rationaleDigest,
      createdAt: createdAt.toISOString(),
    };
    const adjudicationId = `dsapa_adj_${sha256Rfc8785(evidence).slice(7, 47)}`,
      evidenceJson = canonical(evidence);
    await client.query(
      `INSERT INTO tokenless_dsa_named_panel_adjudications
      (workspace_id,project_id,epoch_id,unit_id,run_id,case_id,mapping_commitment,adjudication_id,adjudicator_principal_id,
       reference_label,language_evidence_json,language_evidence_hash,category_competence_evidence_json,
       category_competence_evidence_hash,conflict_declaration_json,conflict_declaration_hash,qualification_expires_at,
       rationale_digest,adjudication_json,adjudication_hash,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
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
        input.referenceLabel,
        languageEvidenceJson,
        sha256Rfc8785(adjudicatorEvidence.language),
        competenceEvidenceJson,
        sha256Rfc8785(adjudicatorEvidence.competence),
        conflictJson,
        sha256Rfc8785(conflict),
        qualificationExpiresAt,
        rationaleDigest,
        evidenceJson,
        sha256Rfc8785(evidence),
        createdAt,
      ],
    );
    return { adjudicationId, referenceLabel: input.referenceLabel, adjudicationHash: sha256Rfc8785(evidence) };
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
      `SELECT * FROM tokenless_dsa_named_panel_units WHERE workspace_id=$1 AND epoch_id=$2 AND unit_id=$3 FOR SHARE`,
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
          "An independent adjudication is required for reviewer disagreement.",
          "dsa_named_panel_adjudication_required",
          409,
        );
      referenceLabel = text(row, "reference_label") as ReferenceLabel;
      adjudicationId = text(row, "adjudication_id");
      adjudicationHash = text(row, "adjudication_hash");
      agreementState = "adjudicated";
    }
    const responses = responseResult.rows.map(value => ({
      assignmentId: text(value as Row, "assignment_id"),
      reviewerPrincipalId: text(value as Row, "reviewer_principal_id"),
      responseId: text(value as Row, "response_id"),
      responseDigest: text(value as Row, "response_digest"),
      derivedLabel: text(value as Row, "derived_label"),
      evidenceHash: text(value as Row, "evidence_hash"),
    }));
    const responseRootInput = `rateloop.dsa-named-panel-response-root.v1\0${responses
      .map(response =>
        [
          response.assignmentId,
          response.reviewerPrincipalId,
          response.responseId,
          response.responseDigest,
          response.derivedLabel,
          response.evidenceHash,
        ].join("|"),
      )
      .join("\n")}\n`;
    const responseEvidenceRoot =
      `sha256:${createHash("sha256").update(responseRootInput, "utf8").digest("hex")}` as const;
    const adjudicationEvidenceDigest = sha256Rfc8785({
      schemaVersion: "rateloop.dsa-named-panel-outcome-evidence.v1",
      workspaceId: input.workspaceId,
      epochId: input.epochId,
      unitId: input.unitId,
      responseEvidenceRoot,
      referenceLabel,
      agreementState,
      adjudicationId,
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
      responseEvidenceRoot,
      adjudicationEvidenceDigest,
      frozenBy: principal,
      frozenAt: frozenAt.toISOString(),
    };
    const outcomeJson = canonical(outcome);
    await client.query(
      `INSERT INTO tokenless_dsa_named_panel_unit_outcomes
      (workspace_id,project_id,epoch_id,unit_id,run_id,case_id,mapping_commitment,required_reviewer_count,response_count,
       reference_label,agreement_state,adjudication_id,response_evidence_root,adjudication_evidence_digest,outcome_json,outcome_hash,frozen_by,frozen_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
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
    `SELECT unit_id,reference_label,agreement_state,adjudication_evidence_digest FROM tokenless_dsa_named_panel_unit_outcomes WHERE workspace_id=$1 AND epoch_id=$2 ORDER BY encode(convert_to(unit_id,'UTF8'),'hex') FOR SHARE`,
    [workspaceId, epochId],
  );
  if (outcomes.rowCount !== integer(units.rows[0] as Row, "unit_count"))
    fail("Named-panel outcomes do not exactly cover the selected units.", "dsa_named_panel_outcomes_incomplete", 409);
  return outcomes.rows.map(value => ({
    unitId: text(value as Row, "unit_id")!,
    referenceLabel: text(value as Row, "reference_label") as ReferenceLabel,
    agreementState: text(value as Row, "agreement_state") as "agreed" | "adjudicated",
    adjudicationEvidenceDigest: text(value as Row, "adjudication_evidence_digest") as `sha256:${string}`,
    adjudicatedBy:
      text(value as Row, "agreement_state") === "adjudicated" ? "independent_named_panel_adjudicator" : null,
  }));
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

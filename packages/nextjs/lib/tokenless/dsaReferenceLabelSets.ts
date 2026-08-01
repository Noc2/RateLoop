import { canonicalizeRfc8785, sha256Rfc8785 } from "@rateloop/node-utils/jcs";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbPool } from "~~/lib/db";
import { dsaEvidenceCommitTimestamp, dsaEvidenceTransactionTimestamp } from "~~/lib/tokenless/dsaEvidenceClock";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const DSA_REFERENCE_LABEL_SET_SCHEMA_VERSION = "rateloop.dsa-reference-label-set.v1" as const;

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/u;
const SIMPLE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/u;
const EPOCH_ID = /^rse_[0-9a-f]{40}$/u;
const UNIT_ID = /^rsu_[A-Za-z0-9_-]{22}$/u;
const EVALUATION_ID = /^evaluation_[A-Za-z0-9][A-Za-z0-9_.:-]{7,159}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const MAX_LABELS = 50_000;
const FREEZE_KEYS = [
  "accountAddress",
  "epochId",
  "labels",
  "referenceDefinitionHash",
  "referenceDefinitionVersion",
  "workspaceId",
] as const;
const LOAD_KEYS = ["accountAddress", "epochId", "workspaceId"] as const;
const BUILD_KEYS = [
  "commitmentDigest",
  "createdBy",
  "epochId",
  "frozenAt",
  "labels",
  "manifestRoot",
  "referenceDefinitionHash",
  "referenceDefinitionVersion",
  "sampleDigest",
  "selectedUnits",
  "sourceFrozenAt",
  "workspaceId",
] as const;
const SELECTED_UNIT_KEYS = [
  "automatedOutcome",
  "decisionVersion",
  "evaluationHash",
  "evaluationId",
  "evaluationProjectionHash",
  "manifestRowHash",
  "providerDecisionId",
  "sourceDecisionBinding",
  "sourceEvaluationBinding",
  "sourceEvaluationHash",
  "systemId",
  "systemIdentity",
  "systemVersion",
  "unitId",
] as const;
const LABEL_INPUT_KEYS = ["adjudicationEvidenceDigest", "agreementState", "referenceLabel", "unitId"] as const;

type Row = Record<string, unknown>;
export type DsaReferenceLabel = "pass" | "fail" | "uncertain";
export type DsaReferenceLabelAgreement = "agreed" | "adjudicated";

export type DsaSelectedEvaluationUnit = Readonly<{
  unitId: string;
  evaluationId: string;
  providerDecisionId: string;
  decisionVersion: number;
  sourceDecisionBinding: `sha256:${string}`;
  sourceEvaluationBinding: `sha256:${string}`;
  sourceEvaluationHash: `sha256:${string}`;
  systemIdentity: `sha256:${string}`;
  systemId: string;
  systemVersion: string;
  automatedOutcome: "pass" | "fail";
  evaluationHash: `sha256:${string}`;
  evaluationProjectionHash: `sha256:${string}`;
  manifestRowHash: `sha256:${string}`;
}>;

export type DsaReferenceLabelInput = Readonly<{
  unitId: string;
  referenceLabel: DsaReferenceLabel;
  agreementState: DsaReferenceLabelAgreement;
  adjudicationEvidenceDigest: `sha256:${string}`;
}>;

export type ImmutableDsaReferenceLabel = Readonly<
  DsaSelectedEvaluationUnit & {
    schemaVersion: typeof DSA_REFERENCE_LABEL_SET_SCHEMA_VERSION;
    labelSetId: string;
    workspaceId: string;
    epochId: string;
    manifestSelected: true;
    referenceLabel: DsaReferenceLabel;
    agreementState: DsaReferenceLabelAgreement;
    adjudicationEvidenceDigest: `sha256:${string}`;
    adjudicatedBy: string | null;
    createdAt: string;
    labelJson: string;
    labelHash: `sha256:${string}`;
  }
>;

export type DsaReferenceLabelSet = Readonly<{
  workspaceId: string;
  labelSetId: string;
  epochId: string;
  schemaVersion: typeof DSA_REFERENCE_LABEL_SET_SCHEMA_VERSION;
  commitmentDigest: `sha256:${string}`;
  sampleDigest: `sha256:${string}`;
  manifestRoot: `sha256:${string}`;
  referenceDefinitionVersion: string;
  referenceDefinitionHash: `sha256:${string}`;
  expectedSelectedCount: number;
  selectedManifestRoot: `sha256:${string}`;
  labelRoot: `sha256:${string}`;
  adjudicationEvidenceRoot: `sha256:${string}`;
  passLabelCount: number;
  failLabelCount: number;
  uncertainLabelCount: number;
  coverageGap: "uncertain_reference_labels" | null;
  sourceFrozenAt: string;
  frozenAt: string;
  createdBy: string;
  setJson: string;
  setHash: `sha256:${string}`;
}>;

export type DsaReferenceLabelSetEvidence = Readonly<{
  set: DsaReferenceLabelSet;
  labels: readonly ImmutableDsaReferenceLabel[];
}>;

type BuildInput = Readonly<{
  workspaceId: string;
  epochId: string;
  commitmentDigest: `sha256:${string}`;
  sampleDigest: `sha256:${string}`;
  manifestRoot: `sha256:${string}`;
  referenceDefinitionVersion: string;
  referenceDefinitionHash: `sha256:${string}`;
  selectedUnits: readonly DsaSelectedEvaluationUnit[];
  labels: readonly DsaReferenceLabelInput[];
  sourceFrozenAt: string;
  frozenAt: string;
  createdBy: string;
}>;

function invalid(message: string, field?: string): never {
  throw new TokenlessServiceError(message, 400, "invalid_dsa_reference_label_set", false, field);
}

function storedInvalid(): never {
  throw new TokenlessServiceError(
    "Stored DSA reference-label evidence is invalid.",
    500,
    "stored_dsa_reference_label_set_invalid",
  );
}

function portableCompare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactKeys(value: unknown, expected: readonly string[], field: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${field} must be a typed object.`, field);
  const actual = Object.keys(value as Record<string, unknown>).sort(portableCompare);
  const required = [...expected].sort(portableCompare);
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    invalid(`${field} contains missing or unsupported fields.`, field);
  }
}

function canonicalTimestamp(value: string, field: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    invalid(`${field} must be a canonical UTC timestamp.`, field);
  }
  return value;
}

function digestRecords(domain: string, header: unknown, rows: readonly unknown[]) {
  const hash = createHash("sha256");
  hash.update(`${domain}\0${canonicalizeRfc8785(header)}\n`, "utf8");
  rows.forEach(row => hash.update(`${canonicalizeRfc8785(row)}\n`, "utf8"));
  return `sha256:${hash.digest("hex")}` as const;
}

function deterministicLabelSetId(input: {
  workspaceId: string;
  epochId: string;
  sampleDigest: string;
  referenceDefinitionVersion: string;
  referenceDefinitionHash: string;
}) {
  return `rsls_${sha256Rfc8785(input).slice("sha256:".length, "sha256:".length + 40)}`;
}

function normalizeSelectedUnits(input: readonly DsaSelectedEvaluationUnit[]) {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_LABELS) {
    invalid(`selectedUnits must contain between 1 and ${MAX_LABELS} units.`, "selectedUnits");
  }
  const units = input.map(unit => {
    exactKeys(unit, SELECTED_UNIT_KEYS, "selectedUnits");
    if (
      !UNIT_ID.test(unit.unitId) ||
      !EVALUATION_ID.test(unit.evaluationId) ||
      !IDENTIFIER.test(unit.providerDecisionId) ||
      !Number.isSafeInteger(unit.decisionVersion) ||
      unit.decisionVersion <= 0 ||
      !SHA256.test(unit.sourceDecisionBinding) ||
      !SHA256.test(unit.sourceEvaluationBinding) ||
      !SHA256.test(unit.sourceEvaluationHash) ||
      !SHA256.test(unit.systemIdentity) ||
      !IDENTIFIER.test(unit.systemId) ||
      !IDENTIFIER.test(unit.systemVersion) ||
      (unit.automatedOutcome !== "pass" && unit.automatedOutcome !== "fail") ||
      unit.evaluationHash !== unit.sourceEvaluationHash ||
      !SHA256.test(unit.evaluationProjectionHash) ||
      !SHA256.test(unit.manifestRowHash) ||
      unit.systemIdentity !== sha256Rfc8785({ systemId: unit.systemId, systemVersion: unit.systemVersion })
    ) {
      invalid("Every selected unit must be an exact evaluation and manifest binding.", "selectedUnits");
    }
    return { ...unit };
  });
  units.sort((left, right) => portableCompare(left.unitId, right.unitId));
  for (const key of ["unitId", "evaluationId", "sourceEvaluationBinding"] as const) {
    if (new Set(units.map(unit => unit[key])).size !== units.length) {
      invalid(`selectedUnits contains a duplicate ${key}.`, "selectedUnits");
    }
  }
  return units;
}

function normalizeLabels(input: readonly DsaReferenceLabelInput[], units: readonly DsaSelectedEvaluationUnit[]) {
  if (!Array.isArray(input) || input.length !== units.length) {
    invalid("labels must exactly cover the selected evaluation units.", "labels");
  }
  const unitIds = new Set(units.map(unit => unit.unitId));
  const labels = input.map(label => {
    exactKeys(label, LABEL_INPUT_KEYS, "labels");
    if (
      !UNIT_ID.test(label.unitId) ||
      !unitIds.has(label.unitId) ||
      (label.referenceLabel !== "pass" && label.referenceLabel !== "fail" && label.referenceLabel !== "uncertain") ||
      (label.agreementState !== "agreed" && label.agreementState !== "adjudicated") ||
      !SHA256.test(label.adjudicationEvidenceDigest) ||
      (label.referenceLabel === "uncertain" && label.agreementState !== "adjudicated")
    ) {
      invalid("Each label must bind one selected unit and valid adjudication evidence.", "labels");
    }
    return { ...label };
  });
  labels.sort((left, right) => portableCompare(left.unitId, right.unitId));
  if (new Set(labels.map(label => label.unitId)).size !== labels.length) {
    invalid("A selected unit may be labeled only once.", "labels");
  }
  if (labels.some((label, index) => label.unitId !== units[index]?.unitId)) {
    invalid("labels must contain every selected unit with no substitutions.", "labels");
  }
  return labels;
}

export function buildDsaReferenceLabelSetEvidence(input: BuildInput): DsaReferenceLabelSetEvidence {
  exactKeys(input, BUILD_KEYS, "reference-label evidence");
  if (
    !SIMPLE_IDENTIFIER.test(input.workspaceId) ||
    !EPOCH_ID.test(input.epochId) ||
    !SHA256.test(input.commitmentDigest) ||
    !SHA256.test(input.sampleDigest) ||
    !SHA256.test(input.manifestRoot) ||
    !IDENTIFIER.test(input.referenceDefinitionVersion) ||
    !SHA256.test(input.referenceDefinitionHash) ||
    typeof input.createdBy !== "string" ||
    input.createdBy.length === 0 ||
    input.createdBy.length > 200
  ) {
    invalid("Reference-label set context is invalid.");
  }
  const sourceFrozenAt = canonicalTimestamp(input.sourceFrozenAt, "sourceFrozenAt");
  const frozenAt = canonicalTimestamp(input.frozenAt, "frozenAt");
  if (sourceFrozenAt > frozenAt) invalid("frozenAt must not precede sourceFrozenAt.", "frozenAt");

  const selectedUnits = normalizeSelectedUnits(input.selectedUnits);
  const normalizedLabels = normalizeLabels(input.labels, selectedUnits);
  const labelSetId = deterministicLabelSetId(input);
  const selectedManifestRoot = digestRecords(
    "rateloop.dsa-reference-label-selected-manifest.v1",
    {
      workspaceId: input.workspaceId,
      epochId: input.epochId,
      commitmentDigest: input.commitmentDigest,
      sampleDigest: input.sampleDigest,
      manifestRoot: input.manifestRoot,
    },
    selectedUnits,
  );
  const labelByUnit = new Map(normalizedLabels.map(label => [label.unitId, label]));
  const labels = selectedUnits.map(unit => {
    const label = labelByUnit.get(unit.unitId)!;
    const payload = {
      schemaVersion: DSA_REFERENCE_LABEL_SET_SCHEMA_VERSION,
      workspaceId: input.workspaceId,
      labelSetId,
      epochId: input.epochId,
      manifestSelected: true as const,
      ...unit,
      referenceLabel: label.referenceLabel,
      agreementState: label.agreementState,
      adjudicationEvidenceDigest: label.adjudicationEvidenceDigest,
      adjudicatedBy: label.agreementState === "adjudicated" ? input.createdBy : null,
      createdAt: frozenAt,
    };
    return {
      ...payload,
      labelJson: canonicalizeRfc8785(payload),
      labelHash: sha256Rfc8785(payload),
    };
  });
  const labelRoot = digestRecords(
    "rateloop.dsa-reference-labels.v1",
    { workspaceId: input.workspaceId, labelSetId, epochId: input.epochId, selectedManifestRoot },
    labels.map(label => {
      const payload: Record<string, unknown> = { ...label };
      delete payload.labelJson;
      delete payload.labelHash;
      return payload;
    }),
  );
  const adjudicationEvidenceRoot = digestRecords(
    "rateloop.dsa-reference-label-adjudication-evidence.v1",
    { workspaceId: input.workspaceId, labelSetId, epochId: input.epochId },
    labels.map(label => ({
      unitId: label.unitId,
      evaluationId: label.evaluationId,
      sourceEvaluationBinding: label.sourceEvaluationBinding,
      systemIdentity: label.systemIdentity,
      referenceLabel: label.referenceLabel,
      agreementState: label.agreementState,
      adjudicationEvidenceDigest: label.adjudicationEvidenceDigest,
    })),
  );
  const passLabelCount = labels.filter(label => label.referenceLabel === "pass").length;
  const failLabelCount = labels.filter(label => label.referenceLabel === "fail").length;
  const uncertainLabelCount = labels.filter(label => label.referenceLabel === "uncertain").length;
  const setPayload = {
    workspaceId: input.workspaceId,
    labelSetId,
    epochId: input.epochId,
    schemaVersion: DSA_REFERENCE_LABEL_SET_SCHEMA_VERSION,
    commitmentDigest: input.commitmentDigest,
    sampleDigest: input.sampleDigest,
    manifestRoot: input.manifestRoot,
    referenceDefinitionVersion: input.referenceDefinitionVersion,
    referenceDefinitionHash: input.referenceDefinitionHash,
    expectedSelectedCount: selectedUnits.length,
    selectedManifestRoot,
    labelRoot,
    adjudicationEvidenceRoot,
    passLabelCount,
    failLabelCount,
    uncertainLabelCount,
    coverageGap: uncertainLabelCount > 0 ? ("uncertain_reference_labels" as const) : null,
    sourceFrozenAt,
    frozenAt,
    createdBy: input.createdBy,
  };
  return {
    set: {
      ...setPayload,
      setJson: canonicalizeRfc8785(setPayload),
      setHash: sha256Rfc8785(setPayload),
    },
    labels,
  };
}

export function verifyDsaReferenceLabelSetEvidence(input: {
  set: DsaReferenceLabelSet;
  labels: readonly ImmutableDsaReferenceLabel[];
  selectedUnits: readonly DsaSelectedEvaluationUnit[];
}) {
  try {
    const recomputed = buildDsaReferenceLabelSetEvidence({
      workspaceId: input.set.workspaceId,
      epochId: input.set.epochId,
      commitmentDigest: input.set.commitmentDigest,
      sampleDigest: input.set.sampleDigest,
      manifestRoot: input.set.manifestRoot,
      referenceDefinitionVersion: input.set.referenceDefinitionVersion,
      referenceDefinitionHash: input.set.referenceDefinitionHash,
      selectedUnits: input.selectedUnits,
      labels: input.labels.map(label => ({
        unitId: label.unitId,
        referenceLabel: label.referenceLabel,
        agreementState: label.agreementState,
        adjudicationEvidenceDigest: label.adjudicationEvidenceDigest,
      })),
      sourceFrozenAt: input.set.sourceFrozenAt,
      frozenAt: input.set.frozenAt,
      createdBy: input.set.createdBy,
    });
    if (
      canonicalizeRfc8785(recomputed.set) !== canonicalizeRfc8785(input.set) ||
      recomputed.set.setJson !== input.set.setJson ||
      recomputed.set.setHash !== input.set.setHash ||
      canonicalizeRfc8785(recomputed.labels) !== canonicalizeRfc8785(input.labels)
    ) {
      storedInvalid();
    }
    return recomputed;
  } catch (error) {
    if (error instanceof TokenlessServiceError && error.code === "stored_dsa_reference_label_set_invalid") {
      throw error;
    }
    storedInvalid();
  }
}

function normalizedActor(value: string) {
  try {
    return normalizeAccountSubject(value);
  } catch {
    throw new TokenlessServiceError("A valid signed-in account is required.", 401, "invalid_account");
  }
}

async function requireManagerAndEpoch(
  client: PoolClient,
  accountAddress: string,
  workspaceId: string,
  epochId: string,
) {
  const actor = normalizedActor(accountAddress);
  const result = await client.query(
    `SELECT e.project_id
     FROM tokenless_workspace_members m
     JOIN tokenless_workspaces w ON w.workspace_id=m.workspace_id AND w.status='active'
     JOIN tokenless_dsa_reference_sampling_epochs e ON e.workspace_id=m.workspace_id AND e.epoch_id=$3
     JOIN tokenless_assurance_projects p
       ON p.workspace_id=e.workspace_id AND p.project_id=e.project_id AND p.status='active'
     WHERE m.workspace_id=$1 AND m.account_address=$2 AND m.role IN ('owner','admin')
     LIMIT 1`,
    [workspaceId, actor, epochId],
  );
  if (result.rowCount !== 1) {
    throw new TokenlessServiceError(
      "Reference-sampling epoch not found.",
      404,
      "dsa_reference_sampling_epoch_not_found",
    );
  }
  return actor;
}

async function inTransaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query(
      `SELECT set_config('lock_timeout','2s',true),
              set_config('statement_timeout','30s',true),
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

function text(row: Row, field: string) {
  const value = row[field];
  return value === null || value === undefined ? null : String(value);
}

function timestamp(row: Row, field: string) {
  const value = row[field];
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) storedInvalid();
  return parsed.toISOString();
}

function count(row: Row, field: string) {
  const value = Number(row[field]);
  if (!Number.isSafeInteger(value) || value < 0) storedInvalid();
  return value;
}

function selectedUnitFromRow(row: Row): DsaSelectedEvaluationUnit {
  return {
    unitId: text(row, "unit_id")!,
    evaluationId: text(row, "evaluation_id")!,
    providerDecisionId: text(row, "provider_decision_id")!,
    decisionVersion: count(row, "decision_version"),
    sourceDecisionBinding: text(row, "source_decision_binding") as `sha256:${string}`,
    sourceEvaluationBinding: text(row, "source_evaluation_binding") as `sha256:${string}`,
    sourceEvaluationHash: text(row, "source_evaluation_hash") as `sha256:${string}`,
    systemIdentity: text(row, "system_identity") as `sha256:${string}`,
    systemId: text(row, "system_id")!,
    systemVersion: text(row, "system_version")!,
    automatedOutcome: text(row, "automated_outcome") as "pass" | "fail",
    evaluationHash: text(row, "evaluation_hash") as `sha256:${string}`,
    evaluationProjectionHash: text(row, "evaluation_projection_hash") as `sha256:${string}`,
    manifestRowHash: text(row, "manifest_row_hash") as `sha256:${string}`,
  };
}

async function loadSelectedUnits(client: PoolClient, workspaceId: string, epochId: string) {
  const result = await client.query(
    `SELECT m.unit_id,p.evaluation_id,p.provider_decision_id,p.decision_version,
            m.source_decision_binding,m.source_evaluation_binding,m.source_evaluation_hash,
            m.system_identity,p.system_id,p.system_version,m.automated_outcome,
            p.evaluation_hash,p.projection_hash AS evaluation_projection_hash,m.manifest_row_hash
     FROM tokenless_dsa_reference_sample_manifest m
     JOIN tokenless_dsa_reference_evaluation_projections p
       ON p.workspace_id=m.workspace_id AND p.epoch_id=m.epoch_id AND p.unit_id=m.unit_id
      AND p.source_decision_binding=m.source_decision_binding
      AND p.source_evaluation_binding=m.source_evaluation_binding
      AND p.source_evaluation_hash=m.source_evaluation_hash
      AND p.system_identity=m.system_identity AND p.automated_outcome=m.automated_outcome
      AND p.disposition='eligible_draw' AND p.reference_label_state='unlabeled'
     WHERE m.workspace_id=$1 AND m.epoch_id=$2 AND m.selected=true
     ORDER BY encode(convert_to(m.unit_id,'UTF8'),'hex')`,
    [workspaceId, epochId],
  );
  return (result.rows as Row[]).map(selectedUnitFromRow);
}

function setFromRow(row: Row): DsaReferenceLabelSet {
  return {
    workspaceId: text(row, "workspace_id")!,
    labelSetId: text(row, "label_set_id")!,
    epochId: text(row, "epoch_id")!,
    schemaVersion: text(row, "schema_version") as typeof DSA_REFERENCE_LABEL_SET_SCHEMA_VERSION,
    commitmentDigest: text(row, "commitment_digest") as `sha256:${string}`,
    sampleDigest: text(row, "sample_digest") as `sha256:${string}`,
    manifestRoot: text(row, "manifest_root") as `sha256:${string}`,
    referenceDefinitionVersion: text(row, "reference_definition_version")!,
    referenceDefinitionHash: text(row, "reference_definition_hash") as `sha256:${string}`,
    expectedSelectedCount: count(row, "expected_selected_count"),
    selectedManifestRoot: text(row, "selected_manifest_root") as `sha256:${string}`,
    labelRoot: text(row, "label_root") as `sha256:${string}`,
    adjudicationEvidenceRoot: text(row, "adjudication_evidence_root") as `sha256:${string}`,
    passLabelCount: count(row, "pass_label_count"),
    failLabelCount: count(row, "fail_label_count"),
    uncertainLabelCount: count(row, "uncertain_label_count"),
    coverageGap: text(row, "coverage_gap") as "uncertain_reference_labels" | null,
    sourceFrozenAt: timestamp(row, "source_frozen_at"),
    frozenAt: timestamp(row, "frozen_at"),
    createdBy: text(row, "created_by")!,
    setJson: text(row, "set_json")!,
    setHash: text(row, "set_hash") as `sha256:${string}`,
  };
}

function labelFromRow(row: Row): ImmutableDsaReferenceLabel {
  if (row.manifest_selected !== true) storedInvalid();
  return {
    ...selectedUnitFromRow(row),
    schemaVersion: DSA_REFERENCE_LABEL_SET_SCHEMA_VERSION,
    labelSetId: text(row, "label_set_id")!,
    workspaceId: text(row, "workspace_id")!,
    epochId: text(row, "epoch_id")!,
    manifestSelected: true,
    referenceLabel: text(row, "reference_label") as DsaReferenceLabel,
    agreementState: text(row, "agreement_state") as DsaReferenceLabelAgreement,
    adjudicationEvidenceDigest: text(row, "adjudication_evidence_digest") as `sha256:${string}`,
    adjudicatedBy: text(row, "adjudicated_by"),
    createdAt: timestamp(row, "created_at"),
    labelJson: text(row, "label_json")!,
    labelHash: text(row, "label_hash") as `sha256:${string}`,
  };
}

async function loadStoredLabels(client: PoolClient, workspaceId: string, labelSetId: string) {
  const result = await client.query(
    `SELECT workspace_id,label_set_id,epoch_id,unit_id,evaluation_id,provider_decision_id,decision_version,
            source_decision_binding,source_evaluation_binding,source_evaluation_hash,system_identity,system_id,
            system_version,automated_outcome,evaluation_hash,
            evaluation_projection_hash,manifest_row_hash,manifest_selected,reference_label,agreement_state,
            adjudication_evidence_digest,adjudicated_by,created_at,label_json,label_hash
     FROM tokenless_dsa_reference_labels
     WHERE workspace_id=$1 AND label_set_id=$2
     ORDER BY encode(convert_to(unit_id,'UTF8'),'hex')`,
    [workspaceId, labelSetId],
  );
  return (result.rows as Row[]).map(labelFromRow);
}

async function insertLabels(client: PoolClient, labels: readonly ImmutableDsaReferenceLabel[]) {
  for (let start = 0; start < labels.length; start += 200) {
    const batch = labels.slice(start, start + 200);
    const values: unknown[] = [];
    const tuples = batch.map((label, index) => {
      const offset = index * 25;
      values.push(
        label.workspaceId,
        label.labelSetId,
        label.epochId,
        label.unitId,
        label.evaluationId,
        label.providerDecisionId,
        label.decisionVersion,
        label.manifestSelected,
        label.sourceDecisionBinding,
        label.sourceEvaluationBinding,
        label.sourceEvaluationHash,
        label.systemIdentity,
        label.systemId,
        label.systemVersion,
        label.automatedOutcome,
        label.evaluationHash,
        label.evaluationProjectionHash,
        label.manifestRowHash,
        label.referenceLabel,
        label.agreementState,
        label.adjudicationEvidenceDigest,
        label.labelJson,
        label.labelHash,
        label.adjudicatedBy,
        label.createdAt,
      );
      return `(${Array.from({ length: 25 }, (_, column) => `$${offset + column + 1}`).join(",")})`;
    });
    await client.query(
      `INSERT INTO tokenless_dsa_reference_labels
       (workspace_id,label_set_id,epoch_id,unit_id,evaluation_id,provider_decision_id,decision_version,
        manifest_selected,source_decision_binding,source_evaluation_binding,source_evaluation_hash,system_identity,
        system_id,system_version,automated_outcome,evaluation_hash,evaluation_projection_hash,manifest_row_hash,
        reference_label,agreement_state,adjudication_evidence_digest,label_json,label_hash,adjudicated_by,created_at)
       VALUES ${tuples.join(",")}`,
      values,
    );
  }
}

export async function freezeDsaReferenceLabelSet(input: {
  accountAddress: string;
  workspaceId: string;
  epochId: string;
  referenceDefinitionVersion: string;
  referenceDefinitionHash: `sha256:${string}`;
  labels: readonly DsaReferenceLabelInput[];
}) {
  exactKeys(input, FREEZE_KEYS, "reference-label freeze");
  if (!SIMPLE_IDENTIFIER.test(input.workspaceId) || !EPOCH_ID.test(input.epochId)) {
    invalid("Reference-label set identity is invalid.");
  }
  return inTransaction(async client => {
    const sourceFrozenAt = await dsaEvidenceTransactionTimestamp(client);
    const actor = await requireManagerAndEpoch(client, input.accountAddress, input.workspaceId, input.epochId);
    const sampleResult = await client.query(
      `SELECT commitment_digest,sample_digest,manifest_root
       FROM tokenless_dsa_reference_samples
       WHERE workspace_id=$1 AND epoch_id=$2 FOR SHARE`,
      [input.workspaceId, input.epochId],
    );
    const sample = sampleResult.rows[0] as Row | undefined;
    if (!sample) {
      throw new TokenlessServiceError("Reference sample not found.", 404, "dsa_reference_sample_not_found");
    }
    const selectedUnits = await loadSelectedUnits(client, input.workspaceId, input.epochId);
    const existingResult = await client.query(
      `SELECT * FROM tokenless_dsa_reference_label_sets
       WHERE workspace_id=$1 AND epoch_id=$2 FOR UPDATE`,
      [input.workspaceId, input.epochId],
    );
    const existingRow = existingResult.rows[0] as Row | undefined;
    if (existingRow) {
      const set = setFromRow(existingRow);
      const labels = await loadStoredLabels(client, input.workspaceId, set.labelSetId);
      const verified = verifyDsaReferenceLabelSetEvidence({ set, labels, selectedUnits });
      let replay: DsaReferenceLabelSetEvidence;
      try {
        replay = buildDsaReferenceLabelSetEvidence({
          workspaceId: input.workspaceId,
          epochId: input.epochId,
          commitmentDigest: set.commitmentDigest,
          sampleDigest: set.sampleDigest,
          manifestRoot: set.manifestRoot,
          referenceDefinitionVersion: input.referenceDefinitionVersion,
          referenceDefinitionHash: input.referenceDefinitionHash,
          selectedUnits,
          labels: input.labels,
          sourceFrozenAt: set.sourceFrozenAt,
          frozenAt: set.frozenAt,
          createdBy: set.createdBy,
        });
      } catch {
        throw new TokenlessServiceError(
          "This epoch already has a different immutable reference-label set.",
          409,
          "dsa_reference_label_set_conflict",
        );
      }
      if (replay.set.setHash !== set.setHash) {
        throw new TokenlessServiceError(
          "This epoch already has a different immutable reference-label set.",
          409,
          "dsa_reference_label_set_conflict",
        );
      }
      return { ...verified, idempotent: true };
    }
    const frozenAt = await dsaEvidenceCommitTimestamp(client);
    const evidence = buildDsaReferenceLabelSetEvidence({
      workspaceId: input.workspaceId,
      epochId: input.epochId,
      commitmentDigest: text(sample, "commitment_digest") as `sha256:${string}`,
      sampleDigest: text(sample, "sample_digest") as `sha256:${string}`,
      manifestRoot: text(sample, "manifest_root") as `sha256:${string}`,
      referenceDefinitionVersion: input.referenceDefinitionVersion,
      referenceDefinitionHash: input.referenceDefinitionHash,
      selectedUnits,
      labels: input.labels,
      sourceFrozenAt: sourceFrozenAt.toISOString(),
      frozenAt: frozenAt.toISOString(),
      createdBy: actor,
    });
    const set = evidence.set;
    await client.query(
      `INSERT INTO tokenless_dsa_reference_label_sets
       (workspace_id,label_set_id,epoch_id,schema_version,commitment_digest,sample_digest,manifest_root,
        reference_definition_version,reference_definition_hash,expected_selected_count,selected_manifest_root,
        label_root,adjudication_evidence_root,pass_label_count,fail_label_count,uncertain_label_count,coverage_gap,
        set_json,set_hash,source_frozen_at,frozen_at,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
      [
        set.workspaceId,
        set.labelSetId,
        set.epochId,
        set.schemaVersion,
        set.commitmentDigest,
        set.sampleDigest,
        set.manifestRoot,
        set.referenceDefinitionVersion,
        set.referenceDefinitionHash,
        set.expectedSelectedCount,
        set.selectedManifestRoot,
        set.labelRoot,
        set.adjudicationEvidenceRoot,
        set.passLabelCount,
        set.failLabelCount,
        set.uncertainLabelCount,
        set.coverageGap,
        set.setJson,
        set.setHash,
        set.sourceFrozenAt,
        set.frozenAt,
        set.createdBy,
      ],
    );
    await insertLabels(client, evidence.labels);
    return { ...evidence, idempotent: false };
  });
}

export async function loadDsaReferenceLabelSet(input: {
  accountAddress: string;
  workspaceId: string;
  epochId: string;
}) {
  exactKeys(input, LOAD_KEYS, "reference-label load");
  if (!SIMPLE_IDENTIFIER.test(input.workspaceId) || !EPOCH_ID.test(input.epochId)) {
    invalid("Reference-label set identity is invalid.");
  }
  return inTransaction(async client => {
    await requireManagerAndEpoch(client, input.accountAddress, input.workspaceId, input.epochId);
    const result = await client.query(
      `SELECT * FROM tokenless_dsa_reference_label_sets
       WHERE workspace_id=$1 AND epoch_id=$2 FOR SHARE`,
      [input.workspaceId, input.epochId],
    );
    const row = result.rows[0] as Row | undefined;
    if (!row) {
      throw new TokenlessServiceError("Reference-label set not found.", 404, "dsa_reference_label_set_not_found");
    }
    const set = setFromRow(row);
    const [labels, selectedUnits] = await Promise.all([
      loadStoredLabels(client, input.workspaceId, set.labelSetId),
      loadSelectedUnits(client, input.workspaceId, input.epochId),
    ]);
    return verifyDsaReferenceLabelSetEvidence({ set, labels, selectedUnits });
  });
}

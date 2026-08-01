import { canonicalizeRfc8785, sha256Rfc8785 } from "@rateloop/node-utils/jcs";
import { createHash, randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbPool } from "~~/lib/db";
import { deriveCapabilityIssuanceIdempotency } from "~~/lib/tokenless/capabilityIssuanceIdempotency";
import { verifyEvidenceExport } from "~~/lib/tokenless/evidencePackets";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const PROJECT_WINDOW_COMPLIANCE_SHARE_SCHEMA_VERSION = "rateloop.project-window-compliance-share.v1" as const;

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/u;
const SIMPLE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/u;
const SHARE_ID = /^pwcs_[A-Za-z0-9_-]{22}$/u;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,159}$/u;
const MAX_SHARE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_ARTIFACTS = 5_000;
const ISSUE_KEYS = [
  "accountAddress",
  "evidencePacketIds",
  "evidenceWindowEnd",
  "evidenceWindowStart",
  "expiresAt",
  "idempotencyKey",
  "projectId",
  "reportVersions",
  "workspaceId",
] as const;
const REVOKE_KEYS = ["accountAddress", "projectId", "reason", "shareId", "workspaceId"] as const;
const ACCESS_KEYS = ["artifact", "bearerSecret", "idempotencyKey", "shareId"] as const;
const PACKET_REQUEST_KEYS = ["artifactKind", "packetId"] as const;
const REPORT_REQUEST_KEYS = ["artifactKind", "reportId", "reportVersion"] as const;
const PACKET_KEYS = ["artifactKind", "generatedAt", "packetDigest", "packetId", "runId"] as const;
const REPORT_KEYS = [
  "artifactKind",
  "reportDigest",
  "reportId",
  "reportVersion",
  "reportingPeriodEnd",
  "reportingPeriodStart",
] as const;

type Row = Record<string, unknown>;
type PoolLike = Pick<Pool, "connect">;

export type ProjectWindowPacketArtifact = Readonly<{
  artifactKind: "evidence_packet";
  packetId: string;
  runId: string;
  packetDigest: `sha256:${string}`;
  generatedAt: string;
}>;

export type ProjectWindowReportArtifact = Readonly<{
  artifactKind: "part8_report_version";
  reportId: string;
  reportVersion: number;
  reportDigest: `sha256:${string}`;
  reportingPeriodStart: string;
  reportingPeriodEnd: string;
}>;

export type ProjectWindowComplianceArtifact = ProjectWindowPacketArtifact | ProjectWindowReportArtifact;

export type ProjectWindowComplianceManifestEntry = Readonly<{
  manifestPosition: number;
  artifactKind: ProjectWindowComplianceArtifact["artifactKind"];
  artifactKey: string;
  artifactId: string;
  artifactVersion: number;
  artifactDigest: `sha256:${string}`;
  artifactWindowStart: string;
  artifactWindowEnd: string;
  bindingJson: string;
  bindingHash: `sha256:${string}`;
  source: ProjectWindowComplianceArtifact;
}>;

export type ProjectWindowComplianceManifest = Readonly<{
  entries: readonly ProjectWindowComplianceManifestEntry[];
  manifestJson: string;
  manifestRoot: `sha256:${string}`;
  packetCount: number;
  reportCount: number;
}>;

type ArtifactRequest =
  | Readonly<{ artifactKind: "evidence_packet"; packetId: string }>
  | Readonly<{ artifactKind: "part8_report_version"; reportId: string; reportVersion: number }>;

export type ProjectWindowComplianceAccessDenialReason =
  | "expired"
  | "revoked"
  | "tenant_mismatch"
  | "window_mismatch"
  | "unbound_artifact"
  | "artifact_invalid";

const SAFE_LIMITATION_CODES = new Set([
  "small_source_cells_suppressed",
  "incomplete_or_invalid_work",
  "no_onchain_settlement",
  "chain_evidence_incomplete",
]);

function invalid(message: string, field?: string): never {
  throw new TokenlessServiceError(message, 400, "invalid_project_window_compliance_share", false, field);
}

function publicNotFound(): never {
  throw new TokenlessServiceError(
    "Project-window compliance share not found.",
    404,
    "project_window_compliance_share_not_found",
  );
}

function exactKeys(value: unknown, expected: readonly string[], field: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${field} must be a typed object.`, field);
  const actual = Object.keys(value as Record<string, unknown>).sort();
  const required = [...expected].sort();
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

function databaseTimestamp(row: Row, field: string) {
  const value = row[field];
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) storedInvalid();
  return parsed.toISOString();
}

function stringValue(row: Row, field: string) {
  const value = row[field];
  return value === null || value === undefined ? null : String(value);
}

function integerValue(row: Row, field: string) {
  const value = Number(row[field]);
  if (!Number.isSafeInteger(value) || value < 0) storedInvalid();
  return value;
}

function storedInvalid(): never {
  throw new TokenlessServiceError(
    "Stored project-window compliance-share evidence is invalid.",
    500,
    "stored_project_window_compliance_share_invalid",
  );
}

function projectionRecord(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) storedInvalid();
  return value as Row;
}

function projectionString(record: Row, field: string) {
  const value = record[field];
  if (typeof value !== "string" || value.length === 0) storedInvalid();
  return value;
}

function projectionInteger(record: Row, field: string) {
  const value = record[field];
  if (!Number.isSafeInteger(value) || Number(value) < 0) storedInvalid();
  return Number(value);
}

function projectionBoolean(record: Row, field: string) {
  const value = record[field];
  if (typeof value !== "boolean") storedInvalid();
  return value;
}

function projectionTimestamp(record: Row, field: string) {
  const value = projectionString(record, field);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) storedInvalid();
  return value;
}

/**
 * Audited derivation of a verified private source packet. This is deliberately not described as a
 * signed packet: the source signature covers the undisclosed source, while the access snapshot and
 * response hash bind these allowlisted bytes.
 */
export function projectProjectWindowEvidencePacket(value: unknown) {
  const packet = projectionRecord(value);
  const payload = projectionRecord(packet.payload);
  const signing = projectionRecord(packet.signing);
  const privacy = projectionRecord(payload.privacy);
  const aggregation = projectionRecord(payload.aggregation);
  const reviewerCoverage = projectionRecord(aggregation.reviewerCoverage);
  const judgmentCoverage = projectionRecord(aggregation.judgmentCoverage);
  const suite = projectionRecord(aggregation.suite);
  const reviewContext = projectionRecord(payload.reviewContext);
  const period = projectionRecord(reviewContext.period);
  const minimumAggregationSize = projectionInteger(privacy, "minimumAggregationSize");
  if (minimumAggregationSize < 1) storedInvalid();
  const reviewerIdentitiesIncluded = projectionBoolean(privacy, "reviewerIdentitiesIncluded");
  const rawRationaleIncluded = projectionBoolean(privacy, "rawRationaleIncluded");
  const calibrationItemsIncludedInVerdict = projectionBoolean(privacy, "calibrationItemsIncludedInVerdict");
  if (reviewerIdentitiesIncluded || rawRationaleIncluded || calibrationItemsIncludedInVerdict) storedInvalid();
  const respondingReviewerCount = projectionInteger(reviewerCoverage, "respondingReviewerCount");
  const validJudgmentCount = projectionInteger(judgmentCoverage, "validJudgmentCount");
  const cases = aggregation.cases;
  if (!Array.isArray(cases)) storedInvalid();
  const thresholdMet =
    cases.length > 0 &&
    respondingReviewerCount >= minimumAggregationSize &&
    validJudgmentCount >= minimumAggregationSize &&
    cases.every(entry => projectionRecord(entry).suppressed === false);
  const periodCoverage = projectionRecord(period.coverage);
  const limitations = Array.isArray(payload.limitations)
    ? payload.limitations
        .map(entry => projectionRecord(entry))
        .map(entry => entry.code)
        .filter((code): code is string => typeof code === "string" && SAFE_LIMITATION_CODES.has(code))
        .filter((code, index, all) => all.indexOf(code) === index)
        .sort()
    : [];
  const packetDigest = projectionString(packet, "packetDigest");
  if (!SHA256.test(packetDigest)) storedInvalid();
  return {
    schemaVersion: "rateloop.public-compliance-evidence-projection.v1" as const,
    source: {
      schemaVersion: projectionString(payload, "schemaVersion"),
      packetId: projectionString(payload, "packetId"),
      generatedAt: projectionTimestamp(payload, "generatedAt"),
      provenancePacketDigest: packetDigest,
    },
    sourceVerification: {
      status: "verified_before_projection" as const,
      signingAlgorithm: projectionString(signing, "algorithm"),
      signingKeyId: projectionString(signing, "keyId"),
      signatureSemantics: "signature_over_undisclosed_source_packet" as const,
    },
    privacy: {
      minimumAggregationSize,
      reviewerIdentitiesIncluded,
      rawRationaleIncluded,
      calibrationItemsIncludedInVerdict,
    },
    period: {
      startInclusive: projectionTimestamp(period, "startInclusive"),
      endInclusive: projectionTimestamp(period, "endInclusive"),
      durationMs: projectionInteger(period, "durationMs"),
      ...(thresholdMet
        ? {
            coverage: {
              caseCount: projectionInteger(periodCoverage, "caseCount"),
              targetExpectedJudgmentCount: projectionInteger(periodCoverage, "targetExpectedJudgmentCount"),
              submittedJudgmentCount: projectionInteger(periodCoverage, "submittedJudgmentCount"),
              respondingReviewerCount: projectionInteger(periodCoverage, "respondingReviewerCount"),
              targetReviewerCount: projectionInteger(periodCoverage, "targetReviewerCount"),
            },
          }
        : {}),
    },
    result: thresholdMet
      ? {
          suppressed: false as const,
          aggregationVersion: projectionString(aggregation, "aggregationVersion"),
          method: projectionString(aggregation, "method"),
          reviewerCoverage: {
            targetReviewerCount: projectionInteger(reviewerCoverage, "targetReviewerCount"),
            assignedReviewerCount: projectionInteger(reviewerCoverage, "assignedReviewerCount"),
            respondingReviewerCount,
            completeJudgmentSetReviewerCount: projectionInteger(reviewerCoverage, "completeJudgmentSetReviewerCount"),
          },
          judgmentCoverage: {
            caseCount: projectionInteger(judgmentCoverage, "caseCount"),
            targetExpectedJudgmentCount: projectionInteger(judgmentCoverage, "targetExpectedJudgmentCount"),
            assignedExpectedJudgmentCount: projectionInteger(judgmentCoverage, "assignedExpectedJudgmentCount"),
            submittedJudgmentCount: projectionInteger(judgmentCoverage, "submittedJudgmentCount"),
            validJudgmentCount,
            invalidJudgmentCount: projectionInteger(judgmentCoverage, "invalidJudgmentCount"),
            pendingJudgmentCount: projectionInteger(judgmentCoverage, "pendingJudgmentCount"),
            missingTargetJudgmentCount: projectionInteger(judgmentCoverage, "missingTargetJudgmentCount"),
            missingAssignedJudgmentCount: projectionInteger(judgmentCoverage, "missingAssignedJudgmentCount"),
          },
          suite: {
            method: projectionString(suite, "method"),
            evaluatedCaseCount: projectionInteger(suite, "evaluatedCaseCount"),
            passCaseCount: projectionInteger(suite, "passCaseCount"),
            failCaseCount: projectionInteger(suite, "failCaseCount"),
            insufficientCaseCount: projectionInteger(suite, "insufficientCaseCount"),
            outcome: projectionString(suite, "outcome"),
          },
        }
      : { suppressed: true as const, minimumAggregationSize },
    limitations,
    derivation: {
      kind: "audited_allowlisted_projection" as const,
      authentication: "access_snapshot_response_hash_not_source_signature" as const,
    },
  };
}

function verifyStoredShareGrant(row: Row) {
  const grantJson = stringValue(row, "grant_json");
  const grantHash = stringValue(row, "grant_hash");
  try {
    if (!grantJson || !grantHash) storedInvalid();
    const parsed = JSON.parse(grantJson) as Row;
    const window = parsed.evidenceWindow as Row | undefined;
    if (
      canonicalizeRfc8785(parsed) !== grantJson ||
      sha256Rfc8785(parsed) !== grantHash ||
      parsed.schemaVersion !== PROJECT_WINDOW_COMPLIANCE_SHARE_SCHEMA_VERSION ||
      parsed.workspaceId !== stringValue(row, "workspace_id") ||
      parsed.projectId !== stringValue(row, "project_id") ||
      parsed.shareId !== stringValue(row, "share_id") ||
      window?.startInclusive !== databaseTimestamp(row, "evidence_window_start") ||
      window.endExclusive !== databaseTimestamp(row, "evidence_window_end") ||
      parsed.artifactManifestRoot !== stringValue(row, "artifact_manifest_root") ||
      parsed.expectedArtifactCount !== integerValue(row, "expected_artifact_count") ||
      parsed.expectedPacketCount !== integerValue(row, "expected_packet_count") ||
      parsed.expectedReportCount !== integerValue(row, "expected_report_count") ||
      parsed.accessBasis !== "bounded_project_window_compliance_evidence" ||
      parsed.statutoryAccessStatus !== "not_benchmark_research_or_article_40_access" ||
      parsed.issuedBy !== stringValue(row, "issued_by") ||
      parsed.issuedAt !== databaseTimestamp(row, "issued_at") ||
      parsed.expiresAt !== databaseTimestamp(row, "expires_at")
    ) {
      storedInvalid();
    }
    return parsed;
  } catch (error) {
    if (error instanceof TokenlessServiceError) throw error;
    storedInvalid();
  }
}

function verifyStoredShareManifest(row: Row): ProjectWindowComplianceManifest {
  const manifestJson = stringValue(row, "artifact_manifest_json");
  try {
    if (!manifestJson) storedInvalid();
    const parsed = JSON.parse(manifestJson) as Row;
    if (canonicalizeRfc8785(parsed) !== manifestJson || !Array.isArray(parsed.entries)) storedInvalid();
    const manifest = buildProjectWindowComplianceManifest({
      workspaceId: stringValue(row, "workspace_id")!,
      projectId: stringValue(row, "project_id")!,
      evidenceWindowStart: databaseTimestamp(row, "evidence_window_start"),
      evidenceWindowEnd: databaseTimestamp(row, "evidence_window_end"),
      artifacts: (parsed.entries as Row[]).map(entry => entry.source as ProjectWindowComplianceArtifact),
    });
    if (
      manifest.manifestJson !== manifestJson ||
      manifest.manifestRoot !== stringValue(row, "artifact_manifest_root") ||
      manifest.entries.length !== integerValue(row, "expected_artifact_count") ||
      manifest.packetCount !== integerValue(row, "expected_packet_count") ||
      manifest.reportCount !== integerValue(row, "expected_report_count")
    ) {
      storedInvalid();
    }
    return manifest;
  } catch (error) {
    if (error instanceof TokenlessServiceError && error.status >= 500) throw error;
    storedInvalid();
  }
}

function digestRecords(domain: string, header: unknown, rows: readonly unknown[]) {
  const hash = createHash("sha256");
  hash.update(`${domain}\0${canonicalizeRfc8785(header)}\n`, "utf8");
  rows.forEach(row => hash.update(`${canonicalizeRfc8785(row)}\n`, "utf8"));
  return `sha256:${hash.digest("hex")}` as const;
}

function tokenHash(secret: string) {
  return `sha256:${createHash("sha256").update(secret).digest("hex")}` as const;
}

function randomId(prefix: string) {
  return `${prefix}_${randomBytes(16).toString("base64url")}`;
}

function normalizeActor(value: string) {
  try {
    return normalizeAccountSubject(value);
  } catch {
    throw new TokenlessServiceError("A valid signed-in account is required.", 401, "invalid_account");
  }
}

function normalizeArtifact(source: ProjectWindowComplianceArtifact) {
  if (source.artifactKind === "evidence_packet") {
    exactKeys(source, PACKET_KEYS, "artifacts");
    if (!IDENTIFIER.test(source.packetId) || !IDENTIFIER.test(source.runId) || !SHA256.test(source.packetDigest)) {
      invalid("Evidence-packet binding is invalid.", "artifacts");
    }
    const generatedAt = canonicalTimestamp(source.generatedAt, "artifacts.generatedAt");
    return {
      artifactKind: source.artifactKind,
      artifactKey: `packet:${source.packetId}`,
      artifactId: source.packetId,
      artifactVersion: 0,
      artifactDigest: source.packetDigest,
      artifactWindowStart: generatedAt,
      artifactWindowEnd: generatedAt,
      source: { ...source, generatedAt },
    } as const;
  }
  exactKeys(source, REPORT_KEYS, "artifacts");
  if (
    !IDENTIFIER.test(source.reportId) ||
    !Number.isSafeInteger(source.reportVersion) ||
    source.reportVersion <= 0 ||
    !SHA256.test(source.reportDigest)
  ) {
    invalid("Part 8 report-version binding is invalid.", "artifacts");
  }
  const reportingPeriodStart = canonicalTimestamp(source.reportingPeriodStart, "artifacts.reportingPeriodStart");
  const reportingPeriodEnd = canonicalTimestamp(source.reportingPeriodEnd, "artifacts.reportingPeriodEnd");
  if (reportingPeriodEnd <= reportingPeriodStart) invalid("Part 8 report window is invalid.", "artifacts");
  return {
    artifactKind: source.artifactKind,
    artifactKey: `report:${source.reportId}:${source.reportVersion}`,
    artifactId: source.reportId,
    artifactVersion: source.reportVersion,
    artifactDigest: source.reportDigest,
    artifactWindowStart: reportingPeriodStart,
    artifactWindowEnd: reportingPeriodEnd,
    source: { ...source, reportingPeriodStart, reportingPeriodEnd },
  } as const;
}

export function buildProjectWindowComplianceManifest(input: {
  workspaceId: string;
  projectId: string;
  evidenceWindowStart: string;
  evidenceWindowEnd: string;
  artifacts: readonly ProjectWindowComplianceArtifact[];
}): ProjectWindowComplianceManifest {
  if (!SIMPLE_IDENTIFIER.test(input.workspaceId) || !IDENTIFIER.test(input.projectId)) {
    invalid("Project-window share scope is invalid.");
  }
  const evidenceWindowStart = canonicalTimestamp(input.evidenceWindowStart, "evidenceWindowStart");
  const evidenceWindowEnd = canonicalTimestamp(input.evidenceWindowEnd, "evidenceWindowEnd");
  if (evidenceWindowEnd <= evidenceWindowStart) invalid("Evidence window must be non-empty.", "evidenceWindowEnd");
  if (!Array.isArray(input.artifacts) || input.artifacts.length === 0 || input.artifacts.length > MAX_ARTIFACTS) {
    invalid(`A compliance share must bind between 1 and ${MAX_ARTIFACTS} artifacts.`, "artifacts");
  }
  const normalized = input.artifacts
    .map(normalizeArtifact)
    .sort((left, right) => (left.artifactKey < right.artifactKey ? -1 : left.artifactKey > right.artifactKey ? 1 : 0));
  if (new Set(normalized.map(artifact => artifact.artifactKey)).size !== normalized.length) {
    invalid("A compliance-share artifact may be bound only once.", "artifacts");
  }
  normalized.forEach(artifact => {
    const inWindow =
      artifact.artifactKind === "evidence_packet"
        ? artifact.artifactWindowStart >= evidenceWindowStart && artifact.artifactWindowStart < evidenceWindowEnd
        : artifact.artifactWindowStart >= evidenceWindowStart && artifact.artifactWindowEnd <= evidenceWindowEnd;
    if (!inWindow) invalid("Every artifact must be wholly bound by the evidence window.", "artifacts");
  });
  const entries = normalized.map((artifact, index) => {
    const manifestPosition = index + 1;
    const payload = {
      schemaVersion: PROJECT_WINDOW_COMPLIANCE_SHARE_SCHEMA_VERSION,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      manifestPosition,
      artifactKind: artifact.artifactKind,
      artifactKey: artifact.artifactKey,
      artifactId: artifact.artifactId,
      artifactVersion: artifact.artifactVersion,
      artifactDigest: artifact.artifactDigest,
      artifactWindowStart: artifact.artifactWindowStart,
      artifactWindowEnd: artifact.artifactWindowEnd,
      source: artifact.source,
    };
    return {
      manifestPosition,
      artifactKind: artifact.artifactKind,
      artifactKey: artifact.artifactKey,
      artifactId: artifact.artifactId,
      artifactVersion: artifact.artifactVersion,
      artifactDigest: artifact.artifactDigest,
      artifactWindowStart: artifact.artifactWindowStart,
      artifactWindowEnd: artifact.artifactWindowEnd,
      bindingJson: canonicalizeRfc8785(payload),
      bindingHash: sha256Rfc8785(payload),
      source: artifact.source,
    };
  });
  const manifestPayload = {
    schemaVersion: PROJECT_WINDOW_COMPLIANCE_SHARE_SCHEMA_VERSION,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    evidenceWindowStart,
    evidenceWindowEnd,
    entries,
  };
  return {
    entries,
    manifestJson: canonicalizeRfc8785(manifestPayload),
    manifestRoot: digestRecords(
      "rateloop.project-window-compliance-share-manifest.v1",
      { workspaceId: input.workspaceId, projectId: input.projectId, evidenceWindowStart, evidenceWindowEnd },
      entries,
    ),
    packetCount: entries.filter(entry => entry.artifactKind === "evidence_packet").length,
    reportCount: entries.filter(entry => entry.artifactKind === "part8_report_version").length,
  };
}

function normalizeArtifactRequest(value: ArtifactRequest) {
  if (value?.artifactKind === "evidence_packet") {
    exactKeys(value, PACKET_REQUEST_KEYS, "artifact");
    if (!IDENTIFIER.test(value.packetId)) invalid("Requested evidence packet is invalid.", "artifact");
    return { artifactKind: value.artifactKind, artifactKey: `packet:${value.packetId}` } as const;
  }
  if (value?.artifactKind === "part8_report_version") {
    exactKeys(value, REPORT_REQUEST_KEYS, "artifact");
    if (!IDENTIFIER.test(value.reportId) || !Number.isSafeInteger(value.reportVersion) || value.reportVersion <= 0) {
      invalid("Requested report version is invalid.", "artifact");
    }
    return {
      artifactKind: value.artifactKind,
      artifactKey: `report:${value.reportId}:${value.reportVersion}`,
    } as const;
  }
  invalid("Requested compliance artifact kind is invalid.", "artifact");
}

export async function verifyBoundProjectWindowEvidencePacket(input: {
  packetJson: string;
  packetId: string;
  runId: string;
  packetDigest: string;
  signingAlgorithm: string;
  signingKeyId: string;
  signingPublicKey: string;
}) {
  let packet: unknown;
  try {
    packet = JSON.parse(input.packetJson) as unknown;
  } catch {
    storedInvalid();
  }
  const record = packet && typeof packet === "object" && !Array.isArray(packet) ? (packet as Row) : null;
  const payload =
    record?.payload && typeof record.payload === "object" && !Array.isArray(record.payload)
      ? (record.payload as Row)
      : null;
  const signing =
    record?.signing && typeof record.signing === "object" && !Array.isArray(record.signing)
      ? (record.signing as Row)
      : null;
  const verification = await verifyEvidenceExport(packet, {
    expectedPublicKey: input.signingPublicKey,
    expectedKeyId: input.signingKeyId,
  });
  if (
    !record ||
    !payload ||
    !signing ||
    !verification.valid ||
    record.packetDigest !== input.packetDigest ||
    payload.packetId !== input.packetId ||
    payload.runId !== input.runId ||
    signing.algorithm !== input.signingAlgorithm ||
    signing.keyId !== input.signingKeyId ||
    signing.publicKey !== input.signingPublicKey ||
    JSON.stringify(packet) !== input.packetJson
  ) {
    storedInvalid();
  }
  return packet;
}

export function evaluateProjectWindowComplianceAccessPolicy(input: {
  now: string;
  expiresAt: string;
  revoked: boolean;
  tenantBound: boolean;
  manifestVerified: boolean;
  evidenceWindowStart: string;
  evidenceWindowEnd: string;
  entries: readonly ProjectWindowComplianceManifestEntry[];
  requestedArtifactKey: string;
  requestedArtifactKind: ProjectWindowComplianceArtifact["artifactKind"];
}):
  | Readonly<{ allowed: true; artifact: ProjectWindowComplianceManifestEntry }>
  | Readonly<{ allowed: false; reason: ProjectWindowComplianceAccessDenialReason }> {
  const now = canonicalTimestamp(input.now, "access.now");
  const expiresAt = canonicalTimestamp(input.expiresAt, "access.expiresAt");
  const evidenceWindowStart = canonicalTimestamp(input.evidenceWindowStart, "access.evidenceWindowStart");
  const evidenceWindowEnd = canonicalTimestamp(input.evidenceWindowEnd, "access.evidenceWindowEnd");
  if (!input.tenantBound) return { allowed: false, reason: "tenant_mismatch" };
  if (input.revoked) return { allowed: false, reason: "revoked" };
  if (expiresAt <= now) return { allowed: false, reason: "expired" };
  if (!input.manifestVerified) return { allowed: false, reason: "artifact_invalid" };
  const artifact = input.entries.find(entry => entry.artifactKey === input.requestedArtifactKey);
  if (!artifact || artifact.artifactKind !== input.requestedArtifactKind) {
    return { allowed: false, reason: "unbound_artifact" };
  }
  const inWindow =
    artifact.artifactKind === "evidence_packet"
      ? artifact.artifactWindowStart >= evidenceWindowStart && artifact.artifactWindowStart < evidenceWindowEnd
      : artifact.artifactWindowStart >= evidenceWindowStart && artifact.artifactWindowEnd <= evidenceWindowEnd;
  return inWindow ? { allowed: true, artifact } : { allowed: false, reason: "window_mismatch" };
}

async function withSerializable<T>(work: (client: PoolClient) => Promise<T>, pool: PoolLike = dbPool) {
  const client = await pool.connect();
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

async function transactionTime(client: PoolClient) {
  const result = await client.query("SELECT transaction_timestamp() AS now");
  const value = result.rows[0] as Row | undefined;
  return new Date(databaseTimestamp(value ?? {}, "now"));
}

async function requireManagerProject(
  client: PoolClient,
  input: { accountAddress: string; workspaceId: string; projectId: string },
) {
  const actor = normalizeActor(input.accountAddress);
  const result = await client.query(
    `SELECT 1
     FROM tokenless_workspace_members m
     JOIN tokenless_workspaces w ON w.workspace_id=m.workspace_id AND w.status='active'
     JOIN tokenless_assurance_projects p
       ON p.workspace_id=m.workspace_id AND p.project_id=$3 AND p.status='active'
     WHERE m.workspace_id=$1 AND m.account_address=$2 AND m.role IN ('owner','admin')
     LIMIT 1`,
    [input.workspaceId, actor, input.projectId],
  );
  if (result.rowCount !== 1) {
    throw new TokenlessServiceError("Assurance project not found.", 404, "assurance_project_not_found");
  }
  return actor;
}

async function insertManifest(
  client: PoolClient,
  share: {
    workspaceId: string;
    projectId: string;
    shareId: string;
    evidenceWindowStart: string;
    evidenceWindowEnd: string;
    artifactManifestRoot: string;
    grantHash: string;
  },
  manifest: ProjectWindowComplianceManifest,
) {
  for (const entry of manifest.entries) {
    await client.query(
      `INSERT INTO tokenless_project_window_compliance_share_artifacts
       (workspace_id,project_id,share_id,evidence_window_start,evidence_window_end,expected_artifact_count,
        artifact_manifest_root,grant_hash,manifest_position,artifact_kind,artifact_key,artifact_id,artifact_version,
        artifact_digest,artifact_window_start,artifact_window_end,binding_json,binding_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        share.workspaceId,
        share.projectId,
        share.shareId,
        share.evidenceWindowStart,
        share.evidenceWindowEnd,
        manifest.entries.length,
        share.artifactManifestRoot,
        share.grantHash,
        entry.manifestPosition,
        entry.artifactKind,
        entry.artifactKey,
        entry.artifactId,
        entry.artifactVersion,
        entry.artifactDigest,
        entry.artifactWindowStart,
        entry.artifactWindowEnd,
        entry.bindingJson,
        entry.bindingHash,
      ],
    );
    const common = [
      share.workspaceId,
      share.projectId,
      share.shareId,
      entry.manifestPosition,
      entry.artifactKind,
      entry.artifactId,
      entry.artifactVersion,
      entry.artifactDigest,
      entry.artifactWindowStart,
      entry.artifactWindowEnd,
      entry.bindingHash,
    ];
    if (entry.source.artifactKind === "evidence_packet") {
      await client.query(
        `INSERT INTO tokenless_project_window_share_evidence_packets
         (workspace_id,project_id,share_id,manifest_position,artifact_kind,artifact_id,artifact_version,
          artifact_digest,artifact_window_start,artifact_window_end,binding_hash,run_id,packet_id,packet_digest,generated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [...common, entry.source.runId, entry.source.packetId, entry.source.packetDigest, entry.source.generatedAt],
      );
    } else {
      await client.query(
        `INSERT INTO tokenless_project_window_share_report_versions
         (workspace_id,project_id,share_id,manifest_position,artifact_kind,artifact_id,artifact_version,
          artifact_digest,artifact_window_start,artifact_window_end,binding_hash,report_id,report_version,
          report_digest,reporting_period_start,reporting_period_end)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          ...common,
          entry.source.reportId,
          entry.source.reportVersion,
          entry.source.reportDigest,
          entry.source.reportingPeriodStart,
          entry.source.reportingPeriodEnd,
        ],
      );
    }
  }
}

export async function issueProjectWindowComplianceShare(
  input: {
    accountAddress: string;
    workspaceId: string;
    projectId: string;
    evidenceWindowStart: Date;
    evidenceWindowEnd: Date;
    evidencePacketIds: readonly string[];
    reportVersions: readonly Readonly<{ reportId: string; reportVersion: number }>[];
    expiresAt: Date;
    idempotencyKey: string;
  },
  resources: { pool?: PoolLike } = {},
) {
  exactKeys(input, ISSUE_KEYS, "project-window share issue");
  if (!SIMPLE_IDENTIFIER.test(input.workspaceId) || !IDENTIFIER.test(input.projectId)) {
    invalid("Project-window share scope is invalid.");
  }
  if (
    !(input.evidenceWindowStart instanceof Date) ||
    !(input.evidenceWindowEnd instanceof Date) ||
    !(input.expiresAt instanceof Date) ||
    !Number.isFinite(input.evidenceWindowStart.getTime()) ||
    !Number.isFinite(input.evidenceWindowEnd.getTime()) ||
    input.evidenceWindowEnd <= input.evidenceWindowStart ||
    !Number.isFinite(input.expiresAt.getTime())
  ) {
    invalid("Project-window share timestamps are invalid.");
  }
  if (
    !Array.isArray(input.evidencePacketIds) ||
    !Array.isArray(input.reportVersions) ||
    input.evidencePacketIds.length + input.reportVersions.length < 1 ||
    input.evidencePacketIds.length + input.reportVersions.length > MAX_ARTIFACTS ||
    input.evidencePacketIds.some(id => !IDENTIFIER.test(id)) ||
    new Set(input.evidencePacketIds).size !== input.evidencePacketIds.length
  ) {
    invalid("Requested compliance artifacts are invalid.", "evidencePacketIds");
  }
  input.reportVersions.forEach(report => {
    exactKeys(report, ["reportId", "reportVersion"], "reportVersions");
    if (!IDENTIFIER.test(report.reportId) || !Number.isSafeInteger(report.reportVersion) || report.reportVersion <= 0) {
      invalid("Requested report versions are invalid.", "reportVersions");
    }
  });
  if (
    new Set(input.reportVersions.map(report => `${report.reportId}\0${report.reportVersion}`)).size !==
    input.reportVersions.length
  ) {
    invalid("A report version may be requested only once.", "reportVersions");
  }
  return withSerializable(async client => {
    const actor = await requireManagerProject(client, input);
    const issuance = deriveCapabilityIssuanceIdempotency({
      capabilityKind: "project_window_compliance_share",
      actorPrincipalId: actor,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      idempotencyKey: input.idempotencyKey,
      request: {
        evidenceWindowStart: input.evidenceWindowStart.toISOString(),
        evidenceWindowEnd: input.evidenceWindowEnd.toISOString(),
        evidencePacketIds: [...input.evidencePacketIds].sort(),
        reportVersions: [...input.reportVersions].sort((left, right) =>
          left.reportId === right.reportId
            ? left.reportVersion - right.reportVersion
            : left.reportId < right.reportId
              ? -1
              : 1,
        ),
        expiresAt: input.expiresAt.toISOString(),
      },
    });
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [issuance.idempotencyKeyDigest]);
    const existingResult = await client.query(
      `SELECT i.request_binding_hash,s.*
         FROM tokenless_project_window_compliance_share_issuances i
         JOIN tokenless_project_window_compliance_shares s
           ON s.workspace_id=i.workspace_id AND s.project_id=i.project_id AND s.share_id=i.share_id
          AND s.grant_hash=i.grant_hash AND s.issued_by=i.issued_by AND s.issued_at=i.issued_at
        WHERE i.workspace_id=$1 AND i.project_id=$2 AND i.issued_by=$3 AND i.idempotency_key_digest=$4
        FOR UPDATE OF i,s`,
      [input.workspaceId, input.projectId, actor, issuance.idempotencyKeyDigest],
    );
    const existing = existingResult.rows[0] as Row | undefined;
    if (existing) {
      if (stringValue(existing, "request_binding_hash") !== issuance.requestBindingHash) {
        throw new TokenlessServiceError(
          "This issuance idempotency key is already bound to a different request.",
          409,
          "project_window_compliance_share_issuance_conflict",
        );
      }
      const grant = verifyStoredShareGrant(existing);
      const manifest = verifyStoredShareManifest(existing);
      return {
        grant,
        grantHash: stringValue(existing, "grant_hash") as `sha256:${string}`,
        manifest,
        bearerSecret: null,
        idempotent: true,
        recoveryRequired: true,
      } as const;
    }
    const now = await transactionTime(client);
    if (input.expiresAt <= now || input.expiresAt.getTime() - now.getTime() > MAX_SHARE_LIFETIME_MS) {
      throw new TokenlessServiceError(
        "Compliance share expiry must be in the future and within 30 days.",
        400,
        "invalid_project_window_compliance_share_expiry",
        false,
        "expiresAt",
      );
    }
    const packetResult = await client.query(
      `SELECT ep.packet_id,ep.run_id,ep.packet_digest,ep.generated_at
       FROM tokenless_assurance_evidence_packets ep
       JOIN tokenless_assurance_runs r ON r.run_id=ep.run_id AND r.project_id=$1
       WHERE ep.packet_id=ANY($2::text[]) AND ep.generated_at >= $3 AND ep.generated_at < $4
       ORDER BY encode(convert_to(ep.packet_id,'UTF8'),'hex')`,
      [input.projectId, input.evidencePacketIds, input.evidenceWindowStart, input.evidenceWindowEnd],
    );
    const requestedReportsJson = JSON.stringify(input.reportVersions);
    const reportResult = await client.query(
      `WITH requested AS (
         SELECT * FROM jsonb_to_recordset($4::jsonb) AS x("reportId" text,"reportVersion" integer)
       )
       SELECT r.report_id,r.report_version,r.report_digest,r.reporting_period_start,r.reporting_period_end
       FROM requested q
       JOIN tokenless_dsa_part8_report_versions r
         ON r.workspace_id=$1 AND r.report_id=q."reportId" AND r.report_version=q."reportVersion"
       WHERE r.reporting_period_start >= $2 AND r.reporting_period_end <= $3
       ORDER BY encode(convert_to(r.report_id,'UTF8'),'hex'),r.report_version`,
      [input.workspaceId, input.evidenceWindowStart, input.evidenceWindowEnd, requestedReportsJson],
    );
    if (
      packetResult.rowCount !== input.evidencePacketIds.length ||
      reportResult.rowCount !== input.reportVersions.length
    ) {
      throw new TokenlessServiceError(
        "One or more requested compliance artifacts are outside this project and evidence window.",
        404,
        "project_window_compliance_artifact_not_found",
      );
    }
    const artifacts: ProjectWindowComplianceArtifact[] = [
      ...(packetResult.rows as Row[]).map(row => ({
        artifactKind: "evidence_packet" as const,
        packetId: stringValue(row, "packet_id")!,
        runId: stringValue(row, "run_id")!,
        packetDigest: stringValue(row, "packet_digest") as `sha256:${string}`,
        generatedAt: databaseTimestamp(row, "generated_at"),
      })),
      ...(reportResult.rows as Row[]).map(row => ({
        artifactKind: "part8_report_version" as const,
        reportId: stringValue(row, "report_id")!,
        reportVersion: integerValue(row, "report_version"),
        reportDigest: stringValue(row, "report_digest") as `sha256:${string}`,
        reportingPeriodStart: databaseTimestamp(row, "reporting_period_start"),
        reportingPeriodEnd: databaseTimestamp(row, "reporting_period_end"),
      })),
    ];
    const manifest = buildProjectWindowComplianceManifest({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      evidenceWindowStart: input.evidenceWindowStart.toISOString(),
      evidenceWindowEnd: input.evidenceWindowEnd.toISOString(),
      artifacts,
    });
    const shareId = randomId("pwcs");
    const bearerSecret = randomBytes(32).toString("base64url");
    const grantPayload = {
      schemaVersion: PROJECT_WINDOW_COMPLIANCE_SHARE_SCHEMA_VERSION,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      shareId,
      evidenceWindow: {
        startInclusive: input.evidenceWindowStart.toISOString(),
        endExclusive: input.evidenceWindowEnd.toISOString(),
      },
      artifactManifestRoot: manifest.manifestRoot,
      expectedArtifactCount: manifest.entries.length,
      expectedPacketCount: manifest.packetCount,
      expectedReportCount: manifest.reportCount,
      accessBasis: "bounded_project_window_compliance_evidence" as const,
      statutoryAccessStatus: "not_benchmark_research_or_article_40_access" as const,
      issuedBy: actor,
      issuedAt: now.toISOString(),
      expiresAt: input.expiresAt.toISOString(),
    };
    const grantHash = sha256Rfc8785(grantPayload);
    await client.query(
      `INSERT INTO tokenless_project_window_compliance_shares
       (workspace_id,project_id,share_id,schema_version,token_hash,evidence_window_start,evidence_window_end,
        expected_artifact_count,expected_packet_count,expected_report_count,artifact_manifest_json,
        artifact_manifest_root,access_basis,statutory_access_status,grant_json,grant_hash,issued_by,issued_at,expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [
        input.workspaceId,
        input.projectId,
        shareId,
        PROJECT_WINDOW_COMPLIANCE_SHARE_SCHEMA_VERSION,
        tokenHash(bearerSecret),
        input.evidenceWindowStart,
        input.evidenceWindowEnd,
        manifest.entries.length,
        manifest.packetCount,
        manifest.reportCount,
        manifest.manifestJson,
        manifest.manifestRoot,
        grantPayload.accessBasis,
        grantPayload.statutoryAccessStatus,
        canonicalizeRfc8785(grantPayload),
        grantHash,
        actor,
        now,
        input.expiresAt,
      ],
    );
    await insertManifest(
      client,
      {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        shareId,
        evidenceWindowStart: input.evidenceWindowStart.toISOString(),
        evidenceWindowEnd: input.evidenceWindowEnd.toISOString(),
        artifactManifestRoot: manifest.manifestRoot,
        grantHash,
      },
      manifest,
    );
    await client.query(
      `INSERT INTO tokenless_project_window_compliance_share_issuances
       (workspace_id,project_id,issued_by,idempotency_key_digest,request_binding_hash,share_id,grant_hash,issued_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        input.workspaceId,
        input.projectId,
        actor,
        issuance.idempotencyKeyDigest,
        issuance.requestBindingHash,
        shareId,
        grantHash,
        now,
      ],
    );
    return {
      grant: grantPayload,
      grantHash,
      manifest,
      bearerSecret,
      idempotent: false,
      recoveryRequired: false,
    } as const;
  }, resources.pool);
}

export async function revokeProjectWindowComplianceShare(input: {
  accountAddress: string;
  workspaceId: string;
  projectId: string;
  shareId: string;
  reason: "manager_request" | "security_response" | "share_replaced" | "issuance_error";
}) {
  exactKeys(input, REVOKE_KEYS, "project-window share revocation");
  if (
    !SIMPLE_IDENTIFIER.test(input.workspaceId) ||
    !IDENTIFIER.test(input.projectId) ||
    !SHARE_ID.test(input.shareId)
  ) {
    invalid("Project-window share revocation scope is invalid.");
  }
  if (!(["manager_request", "security_response", "share_replaced", "issuance_error"] as const).includes(input.reason)) {
    invalid("Project-window share revocation reason is invalid.", "reason");
  }
  return withSerializable(async client => {
    const now = await transactionTime(client);
    const actor = await requireManagerProject(client, input);
    const result = await client.query(
      `SELECT s.*,r.revocation_json,r.revocation_hash
       FROM tokenless_project_window_compliance_shares s
       LEFT JOIN tokenless_project_window_compliance_share_revocations r
         ON r.workspace_id=s.workspace_id AND r.share_id=s.share_id
       WHERE s.workspace_id=$1 AND s.project_id=$2 AND s.share_id=$3 FOR UPDATE OF s`,
      [input.workspaceId, input.projectId, input.shareId],
    );
    const row = result.rows[0] as Row | undefined;
    if (!row) publicNotFound();
    verifyStoredShareGrant(row);
    if (stringValue(row, "revocation_json")) {
      let parsed: Row;
      try {
        parsed = JSON.parse(stringValue(row, "revocation_json")!) as Row;
      } catch {
        storedInvalid();
      }
      if (
        canonicalizeRfc8785(parsed) !== stringValue(row, "revocation_json") ||
        sha256Rfc8785(parsed) !== stringValue(row, "revocation_hash") ||
        parsed.schemaVersion !== PROJECT_WINDOW_COMPLIANCE_SHARE_SCHEMA_VERSION ||
        parsed.eventType !== "revoked" ||
        parsed.workspaceId !== input.workspaceId ||
        parsed.projectId !== input.projectId ||
        parsed.shareId !== input.shareId ||
        parsed.grantHash !== stringValue(row, "grant_hash")
      ) {
        storedInvalid();
      }
      if (parsed.reason !== input.reason) {
        throw new TokenlessServiceError(
          "This compliance share is already revoked for a different immutable reason.",
          409,
          "project_window_compliance_share_revocation_conflict",
        );
      }
      return { revocation: parsed, idempotent: true };
    }
    const payload = {
      schemaVersion: PROJECT_WINDOW_COMPLIANCE_SHARE_SCHEMA_VERSION,
      eventType: "revoked" as const,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      shareId: input.shareId,
      grantHash: stringValue(row, "grant_hash"),
      reason: input.reason,
      revokedBy: actor,
      revokedAt: now.toISOString(),
    };
    const revocationHash = sha256Rfc8785(payload);
    await client.query(
      `INSERT INTO tokenless_project_window_compliance_share_revocations
       (workspace_id,project_id,share_id,revocation_id,reason,issued_at,grant_hash,revoked_by,revoked_at,
        revocation_json,revocation_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        input.workspaceId,
        input.projectId,
        input.shareId,
        randomId("pwrv"),
        input.reason,
        new Date(databaseTimestamp(row, "issued_at")),
        stringValue(row, "grant_hash"),
        actor,
        now,
        canonicalizeRfc8785(payload),
        revocationHash,
      ],
    );
    return { revocation: payload, revocationHash, idempotent: false };
  });
}

export async function listProjectWindowComplianceShares(input: {
  accountAddress: string;
  workspaceId: string;
  projectId: string;
}) {
  if (!SIMPLE_IDENTIFIER.test(input.workspaceId) || !IDENTIFIER.test(input.projectId)) {
    throw new TokenlessServiceError("Project not found.", 404, "project_not_found");
  }
  return withSerializable(async client => {
    await requireManagerProject(client, input);
    const result = await client.query(
      `SELECT s.*,r.reason AS revocation_reason,r.revoked_at
       FROM tokenless_project_window_compliance_shares s
       LEFT JOIN tokenless_project_window_compliance_share_revocations r
         ON r.workspace_id=s.workspace_id AND r.share_id=s.share_id
       WHERE s.workspace_id=$1 AND s.project_id=$2
       ORDER BY s.issued_at DESC,s.share_id DESC`,
      [input.workspaceId, input.projectId],
    );
    return (result.rows as Row[]).map(row => {
      const grant = verifyStoredShareGrant(row);
      return {
        grant,
        grantHash: stringValue(row, "grant_hash"),
        revoked: stringValue(row, "revocation_reason") !== null,
        revocationReason: stringValue(row, "revocation_reason"),
        revokedAt:
          row.revoked_at === null || row.revoked_at === undefined ? null : databaseTimestamp(row, "revoked_at"),
      };
    });
  });
}

function accessIdentity(input: { shareId: string; bearerSecret: string; idempotencyKey: string }) {
  const hashedToken = tokenHash(input.bearerSecret);
  const shareLookupHash = sha256Rfc8785({ domain: "rateloop.project-window-share-lookup.v1", shareId: input.shareId });
  const tokenLookupHash = sha256Rfc8785({ domain: "rateloop.project-window-token-lookup.v1", tokenHash: hashedToken });
  const digest = sha256Rfc8785({ shareLookupHash, tokenLookupHash, idempotencyKey: input.idempotencyKey });
  return {
    accessId: `pwca_${digest.slice("sha256:".length, "sha256:".length + 22)}`,
    hashedToken,
    shareLookupHash,
    tokenLookupHash,
  } as const;
}

function verifyStoredAccessSnapshot(row: Row) {
  const eventJson = stringValue(row, "event_json");
  const eventHash = stringValue(row, "audit_event_hash");
  let event: Row;
  try {
    if (!eventJson || !eventHash) storedInvalid();
    event = JSON.parse(eventJson) as Row;
  } catch {
    storedInvalid();
  }
  if (
    canonicalizeRfc8785(event) !== eventJson ||
    sha256Rfc8785(event) !== eventHash ||
    event.accessId !== stringValue(row, "access_id") ||
    event.idempotencyKey !== stringValue(row, "idempotency_key") ||
    event.requestBindingHash !== stringValue(row, "request_binding_hash") ||
    event.shareLookupHash !== stringValue(row, "share_lookup_hash") ||
    event.tokenLookupHash !== stringValue(row, "token_lookup_hash") ||
    event.result !== stringValue(row, "result") ||
    event.denialReason !== stringValue(row, "denial_reason") ||
    event.responseHash !== stringValue(row, "response_hash") ||
    event.occurredAt !== databaseTimestamp(row, "occurred_at") ||
    stringValue(row, "audit_access_id") !== stringValue(row, "access_id") ||
    stringValue(row, "audit_idempotency_key") !== stringValue(row, "idempotency_key") ||
    stringValue(row, "audit_request_binding_hash") !== stringValue(row, "request_binding_hash") ||
    stringValue(row, "audit_share_lookup_hash") !== stringValue(row, "share_lookup_hash") ||
    stringValue(row, "audit_token_lookup_hash") !== stringValue(row, "token_lookup_hash") ||
    stringValue(row, "audit_denial_reason") !== stringValue(row, "denial_reason") ||
    databaseTimestamp(row, "audit_occurred_at") !== databaseTimestamp(row, "occurred_at")
  ) {
    storedInvalid();
  }
  const responseJson = stringValue(row, "response_json");
  if (stringValue(row, "result") === "success") {
    try {
      if (!responseJson) storedInvalid();
      const response = JSON.parse(responseJson) as unknown;
      if (
        canonicalizeRfc8785(response) !== responseJson ||
        sha256Rfc8785(response) !== stringValue(row, "response_hash")
      ) {
        storedInvalid();
      }
    } catch (error) {
      if (error instanceof TokenlessServiceError) throw error;
      storedInvalid();
    }
  } else if (responseJson !== null || stringValue(row, "response_hash") !== null) {
    storedInvalid();
  }
}

async function appendAccessTerminal(
  client: PoolClient,
  input: {
    accessId: string;
    idempotencyKey: string;
    requestBindingHash: `sha256:${string}`;
    shareLookupHash: `sha256:${string}`;
    tokenLookupHash: `sha256:${string}`;
    result: "success" | "denied";
    denialReason: string | null;
    occurredAt: string;
    responseJson: string | null;
    responseHash: `sha256:${string}` | null;
    artifact?: ProjectWindowComplianceManifestEntry & { workspaceId: string; projectId: string; shareId: string };
  },
) {
  const eventPayload = {
    schemaVersion: "rateloop.project-window-compliance-share-access-event.v1" as const,
    accessId: input.accessId,
    idempotencyKey: input.idempotencyKey,
    requestBindingHash: input.requestBindingHash,
    shareLookupHash: input.shareLookupHash,
    tokenLookupHash: input.tokenLookupHash,
    result: input.result,
    denialReason: input.denialReason,
    responseHash: input.responseHash,
    occurredAt: input.occurredAt,
  };
  const eventId = randomId("pwae");
  const eventHash = sha256Rfc8785(eventPayload);
  await client.query(
    `INSERT INTO tokenless_project_window_compliance_share_access_events
     (event_id,access_id,idempotency_key,request_binding_hash,share_lookup_hash,token_lookup_hash,result,
      denial_reason,occurred_at,event_json,event_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      eventId,
      input.accessId,
      input.idempotencyKey,
      input.requestBindingHash,
      input.shareLookupHash,
      input.tokenLookupHash,
      input.result,
      input.denialReason,
      input.occurredAt,
      canonicalizeRfc8785(eventPayload),
      eventHash,
    ],
  );
  await client.query(
    `INSERT INTO tokenless_project_window_compliance_share_access_snapshots
     (access_id,idempotency_key,share_lookup_hash,token_lookup_hash,request_binding_hash,event_id,event_hash,result,
      denial_reason,response_json,response_hash,occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      input.accessId,
      input.idempotencyKey,
      input.shareLookupHash,
      input.tokenLookupHash,
      input.requestBindingHash,
      eventId,
      eventHash,
      input.result,
      input.denialReason,
      input.responseJson,
      input.responseHash,
      input.occurredAt,
    ],
  );
  if (input.result === "success" && input.artifact) {
    const table =
      input.artifact.artifactKind === "evidence_packet"
        ? "tokenless_project_window_share_packet_accesses"
        : "tokenless_project_window_share_report_accesses";
    await client.query(
      `INSERT INTO ${table}
       (event_id,event_hash,result,workspace_id,project_id,share_id,manifest_position,artifact_kind,artifact_id,
        artifact_version,artifact_digest,artifact_window_start,artifact_window_end,binding_hash)
       VALUES ($1,$2,'success',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        eventId,
        eventHash,
        input.artifact.workspaceId,
        input.artifact.projectId,
        input.artifact.shareId,
        input.artifact.manifestPosition,
        input.artifact.artifactKind,
        input.artifact.artifactId,
        input.artifact.artifactVersion,
        input.artifact.artifactDigest,
        input.artifact.artifactWindowStart,
        input.artifact.artifactWindowEnd,
        input.artifact.bindingHash,
      ],
    );
  }
  return { eventId, eventHash };
}

function manifestEntryFromRow(row: Row): ProjectWindowComplianceManifestEntry {
  const artifactKind = stringValue(row, "artifact_kind");
  const source: ProjectWindowComplianceArtifact =
    artifactKind === "evidence_packet"
      ? {
          artifactKind,
          packetId: stringValue(row, "packet_id")!,
          runId: stringValue(row, "run_id")!,
          packetDigest: stringValue(row, "packet_digest") as `sha256:${string}`,
          generatedAt: databaseTimestamp(row, "generated_at"),
        }
      : {
          artifactKind: "part8_report_version",
          reportId: stringValue(row, "report_id")!,
          reportVersion: integerValue(row, "report_version"),
          reportDigest: stringValue(row, "report_digest") as `sha256:${string}`,
          reportingPeriodStart: databaseTimestamp(row, "reporting_period_start"),
          reportingPeriodEnd: databaseTimestamp(row, "reporting_period_end"),
        };
  return {
    manifestPosition: integerValue(row, "manifest_position"),
    artifactKind: artifactKind as ProjectWindowComplianceArtifact["artifactKind"],
    artifactKey: stringValue(row, "artifact_key")!,
    artifactId: stringValue(row, "artifact_id")!,
    artifactVersion: integerValue(row, "artifact_version"),
    artifactDigest: stringValue(row, "artifact_digest") as `sha256:${string}`,
    artifactWindowStart: databaseTimestamp(row, "artifact_window_start"),
    artifactWindowEnd: databaseTimestamp(row, "artifact_window_end"),
    bindingJson: stringValue(row, "binding_json")!,
    bindingHash: stringValue(row, "binding_hash") as `sha256:${string}`,
    source,
  };
}

export async function accessProjectWindowComplianceShare(input: {
  shareId: string;
  bearerSecret: string;
  idempotencyKey: string;
  artifact: ArtifactRequest;
}) {
  exactKeys(input, ACCESS_KEYS, "project-window share access");
  if (typeof input.idempotencyKey !== "string" || !IDEMPOTENCY_KEY.test(input.idempotencyKey)) {
    invalid("A valid idempotency key is required.", "idempotencyKey");
  }
  const presentedShareId = typeof input.shareId === "string" ? input.shareId : "";
  const presentedSecret = typeof input.bearerSecret === "string" ? input.bearerSecret : "";
  const requestArtifact = normalizeArtifactRequest(input.artifact);
  const identity = accessIdentity({
    shareId: presentedShareId,
    bearerSecret: presentedSecret,
    idempotencyKey: input.idempotencyKey,
  });
  const requestBinding = {
    schemaVersion: "rateloop.project-window-compliance-share-access-request.v1" as const,
    accessId: identity.accessId,
    idempotencyKey: input.idempotencyKey,
    shareLookupHash: identity.shareLookupHash,
    tokenLookupHash: identity.tokenLookupHash,
    artifactKind: requestArtifact.artifactKind,
    artifactKey: requestArtifact.artifactKey,
  };
  const requestBindingHash = sha256Rfc8785(requestBinding);
  const outcome = await withSerializable(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [identity.accessId]);
    const replayResult = await client.query(
      `SELECT s.*,e.event_json,e.event_hash AS audit_event_hash,e.access_id AS audit_access_id,
              e.idempotency_key AS audit_idempotency_key,e.request_binding_hash AS audit_request_binding_hash,
              e.share_lookup_hash AS audit_share_lookup_hash,e.token_lookup_hash AS audit_token_lookup_hash,
              e.denial_reason AS audit_denial_reason,e.occurred_at AS audit_occurred_at
       FROM tokenless_project_window_compliance_share_access_snapshots s
       JOIN tokenless_project_window_compliance_share_access_events e
         ON e.event_id=s.event_id AND e.event_hash=s.event_hash AND e.result=s.result
       WHERE s.access_id=$1 FOR SHARE OF s`,
      [identity.accessId],
    );
    const replay = replayResult.rows[0] as Row | undefined;
    if (replay) {
      verifyStoredAccessSnapshot(replay);
      if (
        stringValue(replay, "idempotency_key") !== input.idempotencyKey ||
        stringValue(replay, "share_lookup_hash") !== identity.shareLookupHash ||
        stringValue(replay, "token_lookup_hash") !== identity.tokenLookupHash ||
        stringValue(replay, "request_binding_hash") !== requestBindingHash
      ) {
        return { kind: "conflict" as const };
      }
      if (stringValue(replay, "result") === "denied") return { kind: "denied" as const, replayed: true };
      const responseJson = stringValue(replay, "response_json");
      const responseHash = stringValue(replay, "response_hash");
      if (!responseJson || !responseHash) storedInvalid();
      return { kind: "success" as const, replayed: true, responseJson, responseHash };
    }
    const now = await transactionTime(client);
    const deny = async (reason: string) => {
      await appendAccessTerminal(client, {
        accessId: identity.accessId,
        idempotencyKey: input.idempotencyKey,
        requestBindingHash,
        shareLookupHash: identity.shareLookupHash,
        tokenLookupHash: identity.tokenLookupHash,
        result: "denied",
        denialReason: reason,
        occurredAt: now.toISOString(),
        responseJson: null,
        responseHash: null,
      });
      return { kind: "denied" as const, replayed: false };
    };
    if (!SHARE_ID.test(presentedShareId) || !/^[A-Za-z0-9_-]{43}$/u.test(presentedSecret)) {
      return deny("not_found");
    }
    const shareResult = await client.query(
      `SELECT s.*,r.revocation_id,w.status AS workspace_status,p.status AS project_status,
              p.workspace_id AS project_workspace_id
       FROM tokenless_project_window_compliance_shares s
       JOIN tokenless_workspaces w ON w.workspace_id=s.workspace_id
       JOIN tokenless_assurance_projects p
         ON p.workspace_id=s.workspace_id AND p.project_id=s.project_id
       LEFT JOIN tokenless_project_window_compliance_share_revocations r
         ON r.workspace_id=s.workspace_id AND r.share_id=s.share_id
       WHERE s.share_id=$1 AND s.token_hash=$2 FOR UPDATE OF s`,
      [presentedShareId, identity.hashedToken],
    );
    const share = shareResult.rows[0] as Row | undefined;
    if (!share) return deny("not_found");
    try {
      verifyStoredShareGrant(share);
    } catch {
      return deny("artifact_invalid");
    }
    const workspaceId = stringValue(share, "workspace_id")!;
    const projectId = stringValue(share, "project_id")!;
    const artifactResult = await client.query(
      `SELECT a.*,
              p.run_id,p.packet_id,p.packet_digest,p.generated_at,
              r.report_id,r.report_version,r.report_digest,r.reporting_period_start,r.reporting_period_end
       FROM tokenless_project_window_compliance_share_artifacts a
       LEFT JOIN tokenless_project_window_share_evidence_packets p
         ON p.workspace_id=a.workspace_id AND p.share_id=a.share_id AND p.manifest_position=a.manifest_position
       LEFT JOIN tokenless_project_window_share_report_versions r
         ON r.workspace_id=a.workspace_id AND r.share_id=a.share_id AND r.manifest_position=a.manifest_position
       WHERE a.workspace_id=$1 AND a.project_id=$2 AND a.share_id=$3
       ORDER BY a.manifest_position`,
      [workspaceId, projectId, presentedShareId],
    );
    let manifest: ProjectWindowComplianceManifest | null = null;
    const entries = (artifactResult.rows as Row[]).map(manifestEntryFromRow);
    try {
      manifest = buildProjectWindowComplianceManifest({
        workspaceId,
        projectId,
        evidenceWindowStart: databaseTimestamp(share, "evidence_window_start"),
        evidenceWindowEnd: databaseTimestamp(share, "evidence_window_end"),
        artifacts: entries.map(entry => entry.source),
      });
    } catch {}
    const manifestVerified =
      manifest !== null &&
      manifest.entries.length === integerValue(share, "expected_artifact_count") &&
      manifest.packetCount === integerValue(share, "expected_packet_count") &&
      manifest.reportCount === integerValue(share, "expected_report_count") &&
      manifest.manifestJson === stringValue(share, "artifact_manifest_json") &&
      manifest.manifestRoot === stringValue(share, "artifact_manifest_root") &&
      canonicalizeRfc8785(manifest.entries) === canonicalizeRfc8785(entries);
    const policy = evaluateProjectWindowComplianceAccessPolicy({
      now: now.toISOString(),
      expiresAt: databaseTimestamp(share, "expires_at"),
      revoked: Boolean(stringValue(share, "revocation_id")),
      tenantBound:
        stringValue(share, "workspace_status") === "active" &&
        stringValue(share, "project_status") === "active" &&
        stringValue(share, "project_workspace_id") === workspaceId,
      manifestVerified,
      evidenceWindowStart: databaseTimestamp(share, "evidence_window_start"),
      evidenceWindowEnd: databaseTimestamp(share, "evidence_window_end"),
      entries,
      requestedArtifactKey: requestArtifact.artifactKey,
      requestedArtifactKind: requestArtifact.artifactKind,
    });
    if (!policy.allowed) return deny(policy.reason);
    const artifact = policy.artifact;
    let sourceResult;
    if (artifact.artifactKind === "evidence_packet") {
      sourceResult = await client.query(
        `SELECT ep.packet_json,ep.signature_algorithm,ep.signing_key_id,ep.signing_public_key,
                ep.packet_id,ep.run_id,ep.packet_digest
         FROM tokenless_project_window_share_evidence_packets b
         JOIN tokenless_assurance_evidence_packets ep
           ON ep.run_id=b.run_id AND ep.packet_id=b.packet_id AND ep.packet_digest=b.packet_digest
          AND ep.generated_at=b.generated_at
         WHERE b.workspace_id=$1 AND b.project_id=$2 AND b.share_id=$3 AND b.manifest_position=$4`,
        [workspaceId, projectId, presentedShareId, artifact.manifestPosition],
      );
    } else {
      sourceResult = await client.query(
        `SELECT r.report_json
         FROM tokenless_project_window_share_report_versions b
         JOIN tokenless_dsa_part8_report_versions r
           ON r.workspace_id=b.workspace_id AND r.report_id=b.report_id AND r.report_version=b.report_version
          AND r.report_digest=b.report_digest
         WHERE b.workspace_id=$1 AND b.project_id=$2 AND b.share_id=$3 AND b.manifest_position=$4`,
        [workspaceId, projectId, presentedShareId, artifact.manifestPosition],
      );
    }
    const sourceJson = stringValue(
      (sourceResult.rows[0] as Row | undefined) ?? {},
      artifact.artifactKind === "evidence_packet" ? "packet_json" : "report_json",
    );
    if (!sourceJson) return deny("artifact_invalid");
    let source: unknown;
    try {
      source = JSON.parse(sourceJson) as unknown;
    } catch {
      return deny("artifact_invalid");
    }
    const sourceRecord = source && typeof source === "object" && !Array.isArray(source) ? (source as Row) : null;
    if (!sourceRecord) return deny("artifact_invalid");
    if (artifact.artifactKind === "evidence_packet") {
      try {
        const verified = await verifyBoundProjectWindowEvidencePacket({
          packetJson: sourceJson,
          packetId: stringValue((sourceResult.rows[0] as Row | undefined) ?? {}, "packet_id")!,
          runId: stringValue((sourceResult.rows[0] as Row | undefined) ?? {}, "run_id")!,
          packetDigest: artifact.artifactDigest,
          signingAlgorithm: stringValue((sourceResult.rows[0] as Row | undefined) ?? {}, "signature_algorithm")!,
          signingKeyId: stringValue((sourceResult.rows[0] as Row | undefined) ?? {}, "signing_key_id")!,
          signingPublicKey: stringValue((sourceResult.rows[0] as Row | undefined) ?? {}, "signing_public_key")!,
        });
        source = projectProjectWindowEvidencePacket(verified);
      } catch {
        return deny("artifact_invalid");
      }
    } else if (
      canonicalizeRfc8785(source) !== sourceJson ||
      sha256Rfc8785(source) !== artifact.artifactDigest ||
      "reportDigest" in sourceRecord ||
      "reportJson" in sourceRecord ||
      sourceRecord.reportingPeriodStart !== artifact.artifactWindowStart ||
      sourceRecord.reportingPeriodEnd !== artifact.artifactWindowEnd
    ) {
      return deny("artifact_invalid");
    }
    const view = {
      schemaVersion: "rateloop.project-window-compliance-share-view.v1" as const,
      shareId: presentedShareId,
      evidenceWindow: {
        startInclusive: databaseTimestamp(share, "evidence_window_start"),
        endExclusive: databaseTimestamp(share, "evidence_window_end"),
      },
      artifactManifestRoot: manifest!.manifestRoot,
      artifact: {
        kind: artifact.artifactKind,
        key: artifact.artifactKey,
        digest: artifact.artifactDigest,
        source,
      },
      accessedAt: now.toISOString(),
    };
    const responseJson = canonicalizeRfc8785(view);
    const responseHash = sha256Rfc8785(view);
    await appendAccessTerminal(client, {
      accessId: identity.accessId,
      idempotencyKey: input.idempotencyKey,
      requestBindingHash,
      shareLookupHash: identity.shareLookupHash,
      tokenLookupHash: identity.tokenLookupHash,
      result: "success",
      denialReason: null,
      occurredAt: now.toISOString(),
      responseJson,
      responseHash,
      artifact: { ...artifact, workspaceId, projectId, shareId: presentedShareId },
    });
    return { kind: "success" as const, replayed: false, responseJson, responseHash };
  });
  if (outcome.kind === "conflict") {
    throw new TokenlessServiceError(
      "Compliance-share idempotency key conflicts with an earlier artifact request.",
      409,
      "project_window_compliance_share_idempotency_conflict",
    );
  }
  if (outcome.kind === "denied") publicNotFound();
  return {
    accessId: identity.accessId,
    replayed: outcome.replayed,
    responseHash: outcome.responseHash as `sha256:${string}`,
    contentType: "application/json; charset=utf-8" as const,
    bytes: new TextEncoder().encode(outcome.responseJson),
  };
}

export const __projectWindowComplianceSharesTestUtils = {
  accessIdentity,
  deriveCapabilityIssuanceIdempotency,
  maxArtifacts: MAX_ARTIFACTS,
  maxShareLifetimeMs: MAX_SHARE_LIFETIME_MS,
};

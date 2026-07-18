import { createHash, randomUUID } from "node:crypto";
import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbPool } from "~~/lib/db";
import { appendAuditEvent } from "~~/lib/privacy/audit";
import {
  DEFAULT_GRC_PROVIDER_ADAPTERS,
  type DrataProviderConfig,
  type GrcControlMapping,
  type GrcCoverageTestRecord,
  type GrcEvidenceBundle,
  type GrcPacketDocumentEvidence,
  type GrcProvider,
  type GrcProviderAdapter,
  type VantaProviderConfig,
  canonicalGrcJson,
  grcSha256,
  parseGrcControlMappings,
  parseGrcProviderConfig,
} from "~~/lib/tokenless/assuranceGrcProviders";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;
type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rowCount?: number; rows: Row[] }> };

const CREDENTIAL_REFERENCE = /^(?:vault|kms|secret):\/\/rateloop\/grc\/[A-Za-z0-9._~:/-]{3,300}$/u;
const HASH = /^sha256:[0-9a-f]{64}$/u;
const MAX_CONNECTORS_PER_WORKSPACE = 20;
const MAX_COVERAGE_SCOPES_PER_RECONCILIATION = 1_000;
const MAX_PACKET_REFERENCES_PER_RECONCILIATION = 400;
const MAX_EVIDENCE_BUNDLE_BYTES = 10 * 1024 * 1024;
const MAX_RECONCILIATION_ATTEMPTS = 8;
const RECONCILIATION_LEASE_MS = 15 * 60_000;
const DAY_MS = 86_400_000;

export type WorkspaceGrcConnector = {
  schemaVersion: "rateloop.workspace-grc-connector.v1";
  connectorId: string;
  workspaceId: string;
  version: number;
  provider: GrcProvider;
  displayName: string;
  credentialConfigured: true;
  credentialReferenceDigest: string;
  providerConfig: DrataProviderConfig | VantaProviderConfig;
  controlMappings: GrcControlMapping[];
  status: "enabled" | "paused";
  nextReconcileAt: string;
  lastReconciledAt: string | null;
  lastDeliveryStatus: "succeeded" | "retry" | "failed" | null;
  lastErrorCode: string | null;
  lastReceipt: {
    requestDigest: string;
    externalReference: string;
    recordCount: number;
    deliveredAt: string;
  } | null;
};

export type GrcEvidenceSourceData = {
  coverage: Array<{ scopeId: string; opportunityCount: number; reviewedCount: number }>;
  packets: Array<{
    packetId: string;
    scopeId: string | null;
    packetDigest: string;
    signatureAlgorithm: string;
    signingKeyId: string;
    generatedAt: Date;
    signedPacket: Record<string, unknown>;
  }>;
};

export type GrcEvidenceSource = (input: {
  workspaceId: string;
  windowStart: Date;
  windowEnd: Date;
}) => Promise<GrcEvidenceSourceData>;

export type GrcCredentialResolver = (input: {
  workspaceId: string;
  connectorId: string;
  provider: GrcProvider;
  credentialReference: string;
  credentialReferenceDigest: string;
}) => Promise<string>;

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function requiredText(row: Row | undefined, key: string) {
  const value = text(row, key);
  if (!value) throw new Error(`Stored ${key} is invalid.`);
  return value;
}

function iso(row: Row | undefined, key: string) {
  const value = row?.[key];
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) throw new Error(`Stored ${key} is invalid.`);
  return parsed.toISOString();
}

function optionalIso(row: Row | undefined, key: string) {
  return row?.[key] === null || row?.[key] === undefined ? null : iso(row, key);
}

function integer(row: Row | undefined, key: string) {
  const value = Number(row?.[key]);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Stored ${key} is invalid.`);
  return value;
}

function parseJson(row: Row | undefined, key: string) {
  try {
    return JSON.parse(requiredText(row, key)) as unknown;
  } catch {
    throw new Error(`Stored ${key} is invalid.`);
  }
}

function exactObject(value: unknown, allowed: readonly string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TokenlessServiceError("Connector settings must be a JSON object.", 400, "invalid_grc_connector");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !allowed.includes(key))) {
    throw new TokenlessServiceError("Connector settings contain unsupported fields.", 400, "invalid_grc_connector");
  }
  return record;
}

function provider(value: unknown): GrcProvider {
  if (value !== "drata" && value !== "vanta") {
    throw new TokenlessServiceError("Connector provider must be Drata or Vanta.", 400, "invalid_grc_connector");
  }
  return value;
}

function displayName(value: unknown) {
  if (typeof value !== "string" || value.trim().length < 1 || value.trim().length > 100) {
    throw new TokenlessServiceError("Connector name must contain one to 100 characters.", 400, "invalid_grc_connector");
  }
  return value.trim();
}

function connectorStatus(value: unknown): "enabled" | "paused" {
  if (value !== "enabled" && value !== "paused") {
    throw new TokenlessServiceError("Connector status must be enabled or paused.", 400, "invalid_grc_connector");
  }
  return value;
}

function credentialReference(value: unknown) {
  if (typeof value !== "string" || !CREDENTIAL_REFERENCE.test(value)) {
    throw new TokenlessServiceError(
      "Credential reference must be an opaque RateLoop GRC vault, KMS, or secret reference.",
      400,
      "invalid_grc_connector",
    );
  }
  return value;
}

function parseSettings(value: unknown, options: { credentialRequired: boolean }) {
  const body = exactObject(value, [
    "provider",
    "displayName",
    "credentialReference",
    "providerConfig",
    "controlMappings",
    "status",
  ]);
  const parsedProvider = provider(body.provider);
  return {
    provider: parsedProvider,
    displayName: displayName(body.displayName),
    credentialReference:
      body.credentialReference === undefined && !options.credentialRequired
        ? null
        : credentialReference(body.credentialReference),
    providerConfig: parseGrcProviderConfig(parsedProvider, body.providerConfig),
    controlMappings: parseGrcControlMappings(body.controlMappings),
    status: connectorStatus(body.status ?? "enabled"),
  };
}

async function requireWorkspaceManager(client: Queryable, accountAddress: string, workspaceId: string) {
  let actor: string;
  try {
    actor = normalizeAccountSubject(accountAddress);
  } catch {
    throw new TokenlessServiceError("A valid signed-in account is required.", 401, "invalid_account");
  }
  const result = await client.query(
    `SELECT m.role FROM tokenless_workspace_members m
     JOIN tokenless_workspaces w ON w.workspace_id = m.workspace_id AND w.status = 'active'
     WHERE m.workspace_id = $1 AND m.account_address = $2 AND m.role IN ('owner', 'admin') LIMIT 1`,
    [workspaceId, actor],
  );
  if (!result.rows[0]) throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  return actor;
}

function nextUtcDay(value: Date) {
  const next = new Date(value.getTime());
  next.setUTCHours(24, 0, 0, 0);
  return next;
}

function parseConnector(row: Row, lastReceipt: WorkspaceGrcConnector["lastReceipt"]): WorkspaceGrcConnector {
  const parsedProvider = provider(row.provider);
  const digest = requiredText(row, "credential_reference_digest");
  if (!HASH.test(digest)) throw new Error("Stored credential reference digest is invalid.");
  const deliveryStatus = text(row, "last_delivery_status");
  if (deliveryStatus !== null && !["succeeded", "retry", "failed"].includes(deliveryStatus)) {
    throw new Error("Stored connector delivery status is invalid.");
  }
  return {
    schemaVersion: "rateloop.workspace-grc-connector.v1",
    connectorId: requiredText(row, "connector_id"),
    workspaceId: requiredText(row, "workspace_id"),
    version: integer(row, "version"),
    provider: parsedProvider,
    displayName: requiredText(row, "display_name"),
    credentialConfigured: true,
    credentialReferenceDigest: digest,
    providerConfig: parseGrcProviderConfig(parsedProvider, parseJson(row, "provider_config_json")),
    controlMappings: parseGrcControlMappings(parseJson(row, "control_mappings_json")),
    status: connectorStatus(row.status),
    nextReconcileAt: iso(row, "next_reconcile_at"),
    lastReconciledAt: optionalIso(row, "last_reconciled_at"),
    lastDeliveryStatus: deliveryStatus as WorkspaceGrcConnector["lastDeliveryStatus"],
    lastErrorCode: text(row, "last_error_code"),
    lastReceipt,
  };
}

async function connectorRows(client: Queryable, workspaceId: string) {
  return client.query(
    `SELECT connector_id, workspace_id, version, provider, display_name, credential_reference_digest,
            provider_config_json, control_mappings_json, status, next_reconcile_at,
            last_reconciled_at, last_delivery_status, last_error_code
     FROM tokenless_assurance_grc_connectors
     WHERE workspace_id = $1 ORDER BY created_at ASC, connector_id ASC`,
    [workspaceId],
  );
}

async function receiptMap(client: Queryable, workspaceId: string, connectorIds: string[]) {
  const values = new Map<string, WorkspaceGrcConnector["lastReceipt"]>();
  for (const connectorId of connectorIds) {
    const result = await client.query(
      `SELECT request_digest, external_reference, record_count, delivered_at
       FROM tokenless_assurance_grc_delivery_receipts
       WHERE workspace_id = $1 AND connector_id = $2 AND state = 'delivered'
       ORDER BY delivered_at DESC, receipt_id DESC LIMIT 1`,
      [workspaceId, connectorId],
    );
    const row = result.rows[0];
    if (row) {
      values.set(connectorId, {
        requestDigest: requiredText(row, "request_digest"),
        externalReference: requiredText(row, "external_reference"),
        recordCount: integer(row, "record_count"),
        deliveredAt: iso(row, "delivered_at"),
      });
    }
  }
  return values;
}

export async function listWorkspaceGrcConnectors(input: { accountAddress: string; workspaceId: string }) {
  const client = await dbPool.connect();
  try {
    await requireWorkspaceManager(client, input.accountAddress, input.workspaceId);
    const connectors = await connectorRows(client, input.workspaceId);
    const connectorIds = connectors.rows.map(row => requiredText(row, "connector_id"));
    const receipts = await receiptMap(client, input.workspaceId, connectorIds);
    return connectors.rows.map(row => parseConnector(row, receipts.get(requiredText(row, "connector_id")) ?? null));
  } finally {
    client.release();
  }
}

export async function createWorkspaceGrcConnector(input: {
  accountAddress: string;
  workspaceId: string;
  body: unknown;
  now?: Date;
}) {
  const settings = parseSettings(input.body, { credentialRequired: true });
  const now = input.now ?? new Date();
  const connectorId = `grcc_${randomUUID().replaceAll("-", "")}`;
  const reference = settings.credentialReference!;
  const referenceDigest = grcSha256(reference);
  const client = await dbPool.connect();
  let actor = "";
  try {
    await client.query("BEGIN");
    actor = await requireWorkspaceManager(client, input.accountAddress, input.workspaceId);
    const count = await client.query(
      "SELECT COUNT(*) AS connector_count FROM tokenless_assurance_grc_connectors WHERE workspace_id = $1",
      [input.workspaceId],
    );
    if (Number(count.rows[0]?.connector_count) >= MAX_CONNECTORS_PER_WORKSPACE) {
      throw new TokenlessServiceError(
        "This workspace has reached its GRC connector limit.",
        409,
        "grc_connector_limit",
      );
    }
    await client.query(
      `INSERT INTO tokenless_assurance_grc_connectors
       (connector_id, workspace_id, version, provider, display_name, credential_reference,
        credential_reference_digest, provider_config_json, control_mappings_json, status,
        next_reconcile_at, created_by, created_at, updated_at)
       VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)`,
      [
        connectorId,
        input.workspaceId,
        settings.provider,
        settings.displayName,
        reference,
        referenceDigest,
        canonicalGrcJson(settings.providerConfig),
        canonicalGrcJson(settings.controlMappings),
        settings.status,
        nextUtcDay(now),
        actor,
        now,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await appendAuditEvent({
    workspaceId: input.workspaceId,
    actorKind: "principal",
    actorReference: actor,
    assuranceMethod: "rateloop_session",
    action: "assurance.grc_connector.created",
    targetKind: "assurance_grc_connector",
    targetId: connectorId,
    purpose: "compliance_evidence_delivery",
    reason: "authorized_workspace_connector_configuration",
    result: "success",
    metadata: { provider: settings.provider, credentialReferenceDigest: referenceDigest },
  });
  return (await listWorkspaceGrcConnectors(input)).find(value => value.connectorId === connectorId)!;
}

export async function updateWorkspaceGrcConnector(input: {
  accountAddress: string;
  workspaceId: string;
  connectorId: string;
  body: unknown;
  now?: Date;
}) {
  const settings = parseSettings(input.body, { credentialRequired: false });
  const now = input.now ?? new Date();
  const client = await dbPool.connect();
  let actor = "";
  let referenceDigest = "";
  try {
    await client.query("BEGIN");
    actor = await requireWorkspaceManager(client, input.accountAddress, input.workspaceId);
    const current = await client.query(
      `SELECT version, provider, credential_reference FROM tokenless_assurance_grc_connectors
       WHERE workspace_id = $1 AND connector_id = $2 FOR UPDATE`,
      [input.workspaceId, input.connectorId],
    );
    if (!current.rows[0]) {
      throw new TokenlessServiceError("GRC connector not found.", 404, "grc_connector_not_found");
    }
    if (settings.provider !== requiredText(current.rows[0], "provider") && settings.credentialReference === null) {
      throw new TokenlessServiceError(
        "Changing the GRC provider requires a new opaque credential reference.",
        400,
        "invalid_grc_connector",
      );
    }
    const reference = settings.credentialReference ?? requiredText(current.rows[0], "credential_reference");
    referenceDigest = grcSha256(reference);
    const version = integer(current.rows[0], "version") + 1;
    const updated = await client.query(
      `UPDATE tokenless_assurance_grc_connectors
       SET version = $1, provider = $2, display_name = $3, credential_reference = $4,
           credential_reference_digest = $5, provider_config_json = $6, control_mappings_json = $7,
           status = $8, next_reconcile_at = $9, last_delivery_status = NULL,
           last_error_code = NULL, updated_at = $10
       WHERE workspace_id = $11 AND connector_id = $12`,
      [
        version,
        settings.provider,
        settings.displayName,
        reference,
        referenceDigest,
        canonicalGrcJson(settings.providerConfig),
        canonicalGrcJson(settings.controlMappings),
        settings.status,
        nextUtcDay(now),
        now,
        input.workspaceId,
        input.connectorId,
      ],
    );
    if (updated.rowCount !== 1) {
      throw new TokenlessServiceError("GRC connector not found.", 404, "grc_connector_not_found");
    }
    await client.query(
      `UPDATE tokenless_assurance_grc_reconciliation_jobs
       SET state = 'superseded', lease_expires_at = NULL, completed_at = $1, updated_at = $1
       WHERE workspace_id = $2 AND connector_id = $3 AND connector_version < $4
         AND state IN ('pending', 'processing', 'retry')`,
      [now, input.workspaceId, input.connectorId, version],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await appendAuditEvent({
    workspaceId: input.workspaceId,
    actorKind: "principal",
    actorReference: actor,
    assuranceMethod: "rateloop_session",
    action: "assurance.grc_connector.updated",
    targetKind: "assurance_grc_connector",
    targetId: input.connectorId,
    purpose: "compliance_evidence_delivery",
    reason: "authorized_workspace_connector_configuration",
    result: "success",
    metadata: { provider: settings.provider, status: settings.status, credentialReferenceDigest: referenceDigest },
  });
  return (await listWorkspaceGrcConnectors(input)).find(value => value.connectorId === input.connectorId)!;
}

export async function pauseWorkspaceGrcConnector(input: {
  accountAddress: string;
  workspaceId: string;
  connectorId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const client = await dbPool.connect();
  let actor = "";
  try {
    await client.query("BEGIN");
    actor = await requireWorkspaceManager(client, input.accountAddress, input.workspaceId);
    const updated = await client.query(
      `UPDATE tokenless_assurance_grc_connectors
       SET status = 'paused', version = version + 1, last_delivery_status = NULL,
           last_error_code = NULL, updated_at = $1
       WHERE workspace_id = $2 AND connector_id = $3 RETURNING connector_id, version`,
      [now, input.workspaceId, input.connectorId],
    );
    if (updated.rows.length !== 1) {
      throw new TokenlessServiceError("GRC connector not found.", 404, "grc_connector_not_found");
    }
    await client.query(
      `UPDATE tokenless_assurance_grc_reconciliation_jobs
       SET state = 'superseded', lease_expires_at = NULL, completed_at = $1, updated_at = $1
       WHERE workspace_id = $2 AND connector_id = $3 AND connector_version < $4
         AND state IN ('pending', 'processing', 'retry')`,
      [now, input.workspaceId, input.connectorId, integer(updated.rows[0], "version")],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await appendAuditEvent({
    workspaceId: input.workspaceId,
    actorKind: "principal",
    actorReference: actor,
    assuranceMethod: "rateloop_session",
    action: "assurance.grc_connector.paused",
    targetKind: "assurance_grc_connector",
    targetId: input.connectorId,
    purpose: "compliance_evidence_delivery",
    reason: "authorized_workspace_connector_configuration",
    result: "success",
  });
}

function deterministicId(prefix: "grcj" | "grcr", value: string) {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 40)}`;
}

function scopeReference(scopeId: string | null) {
  return scopeId === null ? null : grcSha256(`scope:${scopeId}`);
}

export function buildGrcEvidenceBundle(input: {
  workspaceId: string;
  windowStart: Date;
  windowEnd: Date;
  generatedAt: Date;
  mappings: GrcControlMapping[];
  source: GrcEvidenceSourceData;
}): GrcEvidenceBundle {
  if (
    !input.workspaceId.trim() ||
    !Number.isFinite(input.windowStart.getTime()) ||
    !Number.isFinite(input.windowEnd.getTime()) ||
    !Number.isFinite(input.generatedAt.getTime()) ||
    input.windowEnd <= input.windowStart
  ) {
    throw new TokenlessServiceError("GRC evidence boundaries are invalid.", 400, "invalid_grc_evidence");
  }
  for (const row of input.source.coverage) {
    if (
      !row.scopeId.trim() ||
      !Number.isSafeInteger(row.opportunityCount) ||
      row.opportunityCount < 0 ||
      !Number.isSafeInteger(row.reviewedCount) ||
      row.reviewedCount < 0 ||
      row.reviewedCount > row.opportunityCount
    ) {
      throw new TokenlessServiceError("GRC coverage source data is invalid.", 400, "invalid_grc_evidence");
    }
  }
  for (const packet of input.source.packets) {
    if (
      !packet.packetId.trim() ||
      !HASH.test(packet.packetDigest) ||
      !packet.signatureAlgorithm.trim() ||
      !packet.signingKeyId.trim() ||
      !Number.isFinite(packet.generatedAt.getTime())
    ) {
      throw new TokenlessServiceError("GRC packet evidence is invalid.", 400, "invalid_grc_evidence");
    }
  }
  const workspaceReference = grcSha256(`workspace:${input.workspaceId}`);
  const period = { start: input.windowStart.toISOString(), end: input.windowEnd.toISOString() };
  const coverageByScope = new Map<string, { opportunityCount: number; reviewedCount: number }>();
  for (const row of input.source.coverage) {
    const current = coverageByScope.get(row.scopeId) ?? { opportunityCount: 0, reviewedCount: 0 };
    coverageByScope.set(row.scopeId, {
      opportunityCount: current.opportunityCount + row.opportunityCount,
      reviewedCount: current.reviewedCount + row.reviewedCount,
    });
  }
  const coverageTests: GrcCoverageTestRecord[] = input.mappings.map(mapping => {
    const rows = mapping.scopeId === null ? [...coverageByScope.values()] : [coverageByScope.get(mapping.scopeId)];
    const opportunityCount = rows.reduce((sum, value) => sum + (value?.opportunityCount ?? 0), 0);
    const reviewedCount = rows.reduce((sum, value) => sum + (value?.reviewedCount ?? 0), 0);
    const packets = input.source.packets.filter(
      packet => mapping.scopeId === null || packet.scopeId === mapping.scopeId,
    );
    const coverageBps = opportunityCount === 0 ? null : Math.floor((reviewedCount * 10_000) / opportunityCount);
    const coveragePass = coverageBps !== null && coverageBps >= mapping.minimumCoverageBps;
    const packetPass = !mapping.requireSignedPacket || packets.length > 0;
    const status = opportunityCount === 0 ? "insufficient_data" : coveragePass && packetPass ? "passing" : "failing";
    const sourceCommitment = grcSha256({
      mapping,
      opportunityCount,
      reviewedCount,
      packetDigests: packets.map(packet => packet.packetDigest).sort(),
      period,
    });
    return {
      schemaVersion: "rateloop.grc-coverage-test.v1",
      recordId: deterministicId("grcr", canonicalGrcJson({ mappingId: mapping.mappingId, period, workspaceReference })),
      workspaceReference,
      mappingId: mapping.mappingId,
      controlId: mapping.controlId,
      scopeReference: scopeReference(mapping.scopeId),
      period,
      status,
      opportunityCount,
      reviewedCount,
      coverageBps,
      requiredCoverageBps: mapping.minimumCoverageBps,
      signedPacketCount: packets.length,
      signedPacketRequired: mapping.requireSignedPacket,
      sourceCommitment,
    };
  });
  const documentEvidence: GrcPacketDocumentEvidence[] = [];
  for (const packet of input.source.packets) {
    const controlIds = input.mappings
      .filter(mapping => mapping.scopeId === null || mapping.scopeId === packet.scopeId)
      .map(mapping => mapping.controlId)
      .filter((value, index, values) => values.indexOf(value) === index)
      .sort();
    if (controlIds.length === 0) continue;
    documentEvidence.push({
      schemaVersion: "rateloop.grc-packet-document-evidence.v1",
      recordId: deterministicId("grcr", `${workspaceReference}:${packet.packetDigest}`),
      workspaceReference,
      controlIds,
      packetDigest: packet.packetDigest,
      documentReference: `rateloop:evidence-packet:${encodeURIComponent(packet.packetId)}`,
      mediaType: "application/vnd.rateloop.assurance-evidence+json",
      signatureAlgorithm: packet.signatureAlgorithm,
      signingKeyId: packet.signingKeyId,
      generatedAt: packet.generatedAt.toISOString(),
      signedPacket: packet.signedPacket,
    });
  }
  documentEvidence.sort((left, right) => left.packetDigest.localeCompare(right.packetDigest));
  const bundleId = deterministicId(
    "grcr",
    canonicalGrcJson({ workspaceReference, period, coverageTests, documentEvidence }),
  );
  const body = {
    schemaVersion: "rateloop.grc-evidence-bundle.v1" as const,
    bundleId,
    generatedAt: input.generatedAt.toISOString(),
    workspaceReference,
    period,
    coverageTests,
    documentEvidence,
    limitations: [
      "coverage_is_derived_from_rateloop_observations",
      "host_reported_provenance_is_not_independently_verified",
      "control_mapping_is_customer_configured",
    ] as GrcEvidenceBundle["limitations"],
  };
  if (Buffer.byteLength(canonicalGrcJson(body)) > MAX_EVIDENCE_BUNDLE_BYTES) {
    throw new TokenlessServiceError("The nightly GRC evidence bundle exceeds 10 MiB.", 413, "grc_evidence_too_large");
  }
  return { ...body, bundleDigest: grcSha256(body) };
}

export const loadWorkspaceGrcEvidence: GrcEvidenceSource = async input => {
  const client = await dbPool.connect();
  try {
    const [coverage, packets] = await Promise.all([
      client.query(
        `SELECT o.scope_id, COUNT(*) AS opportunity_count,
                SUM(CASE WHEN obs.observation_id IS NULL THEN 0 ELSE 1 END) AS reviewed_count
         FROM tokenless_agent_review_opportunities o
         LEFT JOIN tokenless_agent_evaluation_observations obs
           ON obs.workspace_id = o.workspace_id AND obs.opportunity_id = o.opportunity_id
          AND obs.finalized_at < $3
         WHERE o.workspace_id = $1 AND o.created_at >= $2 AND o.created_at < $3
         GROUP BY o.scope_id ORDER BY o.scope_id ASC LIMIT $4`,
        [input.workspaceId, input.windowStart, input.windowEnd, MAX_COVERAGE_SCOPES_PER_RECONCILIATION + 1],
      ),
      client.query(
        `SELECT p.packet_id, o.scope_id, p.packet_digest, p.packet_json, p.signature_algorithm,
                p.signing_key_id, p.generated_at
         FROM tokenless_assurance_evidence_packets p
         JOIN tokenless_assurance_runs r ON r.run_id = p.run_id
         JOIN tokenless_assurance_projects project ON project.project_id = r.project_id
         LEFT JOIN tokenless_agent_review_opportunities o
           ON o.workspace_id = project.workspace_id AND o.run_id = r.run_id
         WHERE project.workspace_id = $1 AND p.generated_at >= $2 AND p.generated_at < $3
           AND p.packet_digest IS NOT NULL AND p.signature_algorithm IS NOT NULL
           AND p.signing_key_id IS NOT NULL AND p.signature <> ''
         ORDER BY p.generated_at ASC, p.packet_id ASC LIMIT $4`,
        [input.workspaceId, input.windowStart, input.windowEnd, MAX_PACKET_REFERENCES_PER_RECONCILIATION + 1],
      ),
    ]);
    if (
      coverage.rows.length > MAX_COVERAGE_SCOPES_PER_RECONCILIATION ||
      packets.rows.length > MAX_PACKET_REFERENCES_PER_RECONCILIATION
    ) {
      throw new TokenlessServiceError(
        "The nightly GRC evidence set exceeds the bounded reconciliation limit.",
        413,
        "grc_evidence_too_large",
      );
    }
    return {
      coverage: coverage.rows.map(row => ({
        scopeId: requiredText(row, "scope_id"),
        opportunityCount: integer(row, "opportunity_count"),
        reviewedCount: integer(row, "reviewed_count"),
      })),
      packets: packets.rows.map(row => {
        const digest = requiredText(row, "packet_digest");
        if (!HASH.test(digest)) throw new Error("Stored packet digest is invalid.");
        const signedPacket = parseJson(row, "packet_json");
        if (!signedPacket || typeof signedPacket !== "object" || Array.isArray(signedPacket)) {
          throw new Error("Stored signed packet is invalid.");
        }
        const packetRecord = signedPacket as Record<string, unknown>;
        if (
          packetRecord.packetDigest !== digest ||
          !packetRecord.signing ||
          typeof packetRecord.signing !== "object" ||
          Array.isArray(packetRecord.signing) ||
          (packetRecord.signing as Record<string, unknown>).keyId !== requiredText(row, "signing_key_id")
        ) {
          throw new Error("Stored signed packet binding is invalid.");
        }
        return {
          packetId: requiredText(row, "packet_id"),
          scopeId: text(row, "scope_id"),
          packetDigest: digest,
          signatureAlgorithm: requiredText(row, "signature_algorithm"),
          signingKeyId: requiredText(row, "signing_key_id"),
          generatedAt: new Date(iso(row, "generated_at")),
          signedPacket: packetRecord,
        };
      }),
    };
  } finally {
    client.release();
  }
};

export const resolveGrcCredentialReference: GrcCredentialResolver = async input => {
  const raw = process.env.TOKENLESS_GRC_CREDENTIALS_JSON?.trim();
  let credentials: Record<string, unknown>;
  try {
    credentials = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    throw new TokenlessServiceError("The GRC credential map is invalid.", 500, "invalid_grc_credential_map");
  }
  if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) {
    throw new TokenlessServiceError("The GRC credential map is invalid.", 500, "invalid_grc_credential_map");
  }
  const candidate = credentials[input.credentialReference];
  const value = typeof candidate === "string" ? candidate.trim() : "";
  if (!value) {
    throw new TokenlessServiceError(
      "The configured GRC credential reference is unavailable from the server secret store.",
      503,
      "grc_credential_unavailable",
      true,
    );
  }
  return value;
};

async function enqueueDueReconciliations(now: Date, limit: number) {
  const client = await dbPool.connect();
  let enqueued = 0;
  try {
    const due = await client.query(
      `SELECT connector_id, workspace_id, version, provider, credential_reference,
              credential_reference_digest, provider_config_json, control_mappings_json, next_reconcile_at
       FROM tokenless_assurance_grc_connectors
       WHERE status = 'enabled' AND next_reconcile_at <= $1
       ORDER BY next_reconcile_at ASC, connector_id ASC LIMIT $2`,
      [now, limit],
    );
    await client.query("BEGIN");
    for (const row of due.rows) {
      const windowEnd = new Date(iso(row, "next_reconcile_at"));
      const windowStart = new Date(windowEnd.getTime() - DAY_MS);
      const connectorId = requiredText(row, "connector_id");
      const workspaceId = requiredText(row, "workspace_id");
      const version = integer(row, "version");
      const current = await client.query(
        `SELECT provider, credential_reference, credential_reference_digest,
                provider_config_json, control_mappings_json
         FROM tokenless_assurance_grc_connectors
         WHERE workspace_id = $1 AND connector_id = $2 AND version = $3
           AND status = 'enabled' AND next_reconcile_at = $4
         FOR UPDATE`,
        [workspaceId, connectorId, version, windowEnd],
      );
      if (!current.rows[0]) continue;
      const idempotencyKey = `grc-nightly:${connectorId}:v${version}:${windowStart.toISOString()}:${windowEnd.toISOString()}`;
      const jobId = deterministicId("grcj", idempotencyKey);
      const result = await client.query(
        `INSERT INTO tokenless_assurance_grc_reconciliation_jobs
         (job_id, workspace_id, connector_id, connector_version, provider, credential_reference,
          credential_reference_digest, provider_config_json, control_mappings_json, window_start,
          window_end, idempotency_key, state, attempt_count, next_attempt_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending', 0, $13, $13, $13)
         ON CONFLICT (workspace_id, connector_id, idempotency_key) DO NOTHING
         RETURNING job_id`,
        [
          jobId,
          workspaceId,
          connectorId,
          version,
          requiredText(current.rows[0], "provider"),
          requiredText(current.rows[0], "credential_reference"),
          requiredText(current.rows[0], "credential_reference_digest"),
          requiredText(current.rows[0], "provider_config_json"),
          requiredText(current.rows[0], "control_mappings_json"),
          windowStart,
          windowEnd,
          idempotencyKey,
          now,
        ],
      );
      enqueued += result.rows.length;
      const advanced = await client.query(
        `UPDATE tokenless_assurance_grc_connectors
         SET next_reconcile_at = $1, updated_at = $2
         WHERE workspace_id = $3 AND connector_id = $4 AND next_reconcile_at = $5
           AND version = $6 AND status = 'enabled'
         RETURNING connector_id`,
        [new Date(windowEnd.getTime() + DAY_MS), now, workspaceId, connectorId, windowEnd, version],
      );
      if (advanced.rows.length !== 1) throw new GrcReconciliationFenceLostError();
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return enqueued;
}

async function claimReconciliations(now: Date, limit: number) {
  const client = await dbPool.connect();
  try {
    await client.query(
      `UPDATE tokenless_assurance_grc_reconciliation_jobs
       SET state = 'retry', lease_expires_at = NULL, next_attempt_at = $1,
           last_error_code = 'stale_grc_job_recovered', updated_at = $1
       WHERE state = 'processing' AND lease_expires_at <= $1`,
      [now],
    );
    const due = await client.query(
      `SELECT jobs.* FROM tokenless_assurance_grc_reconciliation_jobs AS jobs
       JOIN tokenless_assurance_grc_connectors AS connectors
         ON connectors.workspace_id = jobs.workspace_id AND connectors.connector_id = jobs.connector_id
       WHERE jobs.state IN ('pending', 'retry') AND jobs.next_attempt_at <= $1
         AND jobs.lease_generation < 2147483647
         AND connectors.status = 'enabled' AND connectors.version = jobs.connector_version
       ORDER BY jobs.next_attempt_at ASC, jobs.created_at ASC LIMIT $2`,
      [now, limit],
    );
    const claimed: Row[] = [];
    for (const row of due.rows) {
      const result = await client.query(
        `UPDATE tokenless_assurance_grc_reconciliation_jobs
         SET state = 'processing', attempt_count = attempt_count + 1,
             lease_expires_at = $1, lease_generation = lease_generation + 1, updated_at = $2
         WHERE job_id = $3 AND workspace_id = $4 AND state IN ('pending', 'retry')
           AND connector_id = $5 AND connector_version = $6
           AND next_attempt_at <= $2 AND lease_generation < 2147483647
         RETURNING *`,
        [
          new Date(now.getTime() + RECONCILIATION_LEASE_MS),
          now,
          requiredText(row, "job_id"),
          requiredText(row, "workspace_id"),
          requiredText(row, "connector_id"),
          integer(row, "connector_version"),
        ],
      );
      if (result.rows[0]) claimed.push(result.rows[0]);
    }
    return claimed;
  } finally {
    client.release();
  }
}

function retryAt(now: Date, attempt: number) {
  const delay = Math.min(60_000 * 2 ** Math.max(attempt - 1, 0), 6 * 60 * 60_000);
  return new Date(now.getTime() + delay);
}

class GrcReconciliationFenceLostError extends Error {
  constructor() {
    super("The GRC reconciliation claim is no longer active.");
    this.name = "GrcReconciliationFenceLostError";
  }
}

async function lockActiveJobFence(client: Queryable, row: Row) {
  const workspaceId = requiredText(row, "workspace_id");
  const connectorId = requiredText(row, "connector_id");
  const connectorVersion = integer(row, "connector_version");
  const connector = await client.query(
    `SELECT connector_id FROM tokenless_assurance_grc_connectors
     WHERE workspace_id = $1 AND connector_id = $2 AND version = $3 AND status = 'enabled'
     FOR UPDATE`,
    [workspaceId, connectorId, connectorVersion],
  );
  if (connector.rows.length !== 1) throw new GrcReconciliationFenceLostError();
  const job = await client.query(
    `SELECT job_id FROM tokenless_assurance_grc_reconciliation_jobs
     WHERE workspace_id = $1 AND connector_id = $2 AND job_id = $3
       AND connector_version = $4 AND state = 'processing' AND lease_generation = $5
     FOR UPDATE`,
    [workspaceId, connectorId, requiredText(row, "job_id"), connectorVersion, integer(row, "lease_generation")],
  );
  if (job.rows.length !== 1) throw new GrcReconciliationFenceLostError();
}

async function prepareJobReceipt(row: Row, bundleDigest: string, now: Date) {
  const jobId = requiredText(row, "job_id");
  const workspaceId = requiredText(row, "workspace_id");
  const connectorId = requiredText(row, "connector_id");
  const receiptId = deterministicId("grcr", `${jobId}:assurance_evidence_bundle`);
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await lockActiveJobFence(client, row);
    const result = await client.query(
      `INSERT INTO tokenless_assurance_grc_delivery_receipts
       (receipt_id, workspace_id, connector_id, job_id, artifact_kind, artifact_key,
        request_digest, idempotency_key, state, record_count, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'assurance_evidence_bundle', $4, $5, $6, 'preparing', 0, $7, $7)
       ON CONFLICT (job_id, artifact_kind, artifact_key) DO UPDATE
       SET updated_at = EXCLUDED.updated_at
       WHERE tokenless_assurance_grc_delivery_receipts.request_digest = EXCLUDED.request_digest
       RETURNING request_digest`,
      [receiptId, workspaceId, connectorId, jobId, bundleDigest, requiredText(row, "idempotency_key"), now],
    );
    if (result.rows.length !== 1 || requiredText(result.rows[0], "request_digest") !== bundleDigest) {
      throw new TokenlessServiceError("Stored GRC receipt digest does not match the job.", 500, "grc_receipt_mismatch");
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function persistJobSuccess(
  client: Queryable,
  input: {
    row: Row;
    now: Date;
    bundleDigest: string;
    externalReference: string;
    recordCount: number;
  },
) {
  const jobId = requiredText(input.row, "job_id");
  const workspaceId = requiredText(input.row, "workspace_id");
  const connectorId = requiredText(input.row, "connector_id");
  const connectorVersion = integer(input.row, "connector_version");
  const leaseGeneration = integer(input.row, "lease_generation");
  const idempotencyKey = requiredText(input.row, "idempotency_key");
  const receiptId = deterministicId("grcr", `${jobId}:assurance_evidence_bundle`);
  const receipt = await client.query(
    `INSERT INTO tokenless_assurance_grc_delivery_receipts
     (receipt_id, workspace_id, connector_id, job_id, artifact_kind, artifact_key,
      request_digest, idempotency_key, state, external_reference, record_count,
      created_at, updated_at, delivered_at)
     VALUES ($1, $2, $3, $4, 'assurance_evidence_bundle', $4, $5, $6, 'delivered', $7, $8, $9, $9, $9)
     ON CONFLICT (job_id, artifact_kind, artifact_key) DO UPDATE
     SET state = 'delivered', external_reference = EXCLUDED.external_reference,
         record_count = EXCLUDED.record_count, delivered_at = EXCLUDED.delivered_at,
         updated_at = EXCLUDED.updated_at
     WHERE tokenless_assurance_grc_delivery_receipts.request_digest = EXCLUDED.request_digest
     RETURNING request_digest`,
    [
      receiptId,
      workspaceId,
      connectorId,
      jobId,
      input.bundleDigest,
      idempotencyKey,
      input.externalReference.slice(0, 500),
      input.recordCount,
      input.now,
    ],
  );
  if (receipt.rows.length !== 1 || requiredText(receipt.rows[0], "request_digest") !== input.bundleDigest) {
    throw new TokenlessServiceError("Stored GRC receipt digest does not match the job.", 500, "grc_receipt_mismatch");
  }
  const job = await client.query(
    `UPDATE tokenless_assurance_grc_reconciliation_jobs
     SET state = 'succeeded', lease_expires_at = NULL, bundle_digest = $1,
         last_error_code = NULL, completed_at = $2, updated_at = $2
     WHERE job_id = $3 AND workspace_id = $4 AND connector_id = $5
       AND connector_version = $6 AND state = 'processing' AND lease_generation = $7
     RETURNING job_id`,
    [input.bundleDigest, input.now, jobId, workspaceId, connectorId, connectorVersion, leaseGeneration],
  );
  if (job.rows.length !== 1) throw new GrcReconciliationFenceLostError();
  const connector = await client.query(
    `UPDATE tokenless_assurance_grc_connectors
     SET last_reconciled_at = $1, last_delivery_status = 'succeeded',
         last_error_code = NULL, updated_at = $1
     WHERE workspace_id = $2 AND connector_id = $3 AND version = $4 AND status = 'enabled'
     RETURNING connector_id`,
    [input.now, workspaceId, connectorId, connectorVersion],
  );
  if (connector.rows.length !== 1) throw new GrcReconciliationFenceLostError();
}

async function markJobSucceeded(input: {
  row: Row;
  now: Date;
  bundleDigest: string;
  externalReference: string;
  recordCount: number;
}) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await lockActiveJobFence(client, input.row);
    await persistJobSuccess(client, input);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function deliverAndMarkJobSucceeded(input: {
  row: Row;
  now: Date;
  bundle: GrcEvidenceBundle;
  provider: GrcProvider;
  credentialReference: string;
  credentialReferenceDigest: string;
  credentialResolver: GrcCredentialResolver;
  providerConfig: DrataProviderConfig | VantaProviderConfig;
  adapter: GrcProviderAdapter;
}) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    // Keep both fences locked through secret resolution and provider I/O. A
    // pause or rotation can therefore return only before this claim starts the
    // delivery or after its idempotent success has been recorded.
    await lockActiveJobFence(client, input.row);
    const credential = await input.credentialResolver({
      workspaceId: requiredText(input.row, "workspace_id"),
      connectorId: requiredText(input.row, "connector_id"),
      provider: input.provider,
      credentialReference: input.credentialReference,
      credentialReferenceDigest: input.credentialReferenceDigest,
    });
    if (!credential.trim()) {
      throw new TokenlessServiceError(
        "The GRC credential resolver returned no credential.",
        503,
        "grc_credential_unavailable",
        true,
      );
    }
    const delivery = await input.adapter.deliver({
      bundle: input.bundle,
      credential,
      idempotencyKey: requiredText(input.row, "idempotency_key"),
      providerConfig: input.providerConfig,
    });
    const expectedRecordCount = input.bundle.coverageTests.length + input.bundle.documentEvidence.length;
    if (
      typeof delivery.externalReference !== "string" ||
      delivery.externalReference.trim().length < 1 ||
      delivery.externalReference.length > 500 ||
      delivery.recordCount !== expectedRecordCount
    ) {
      throw new TokenlessServiceError("The GRC provider returned an invalid receipt.", 502, "grc_receipt_invalid");
    }
    await persistJobSuccess(client, {
      row: input.row,
      now: input.now,
      bundleDigest: input.bundle.bundleDigest,
      externalReference: delivery.externalReference,
      recordCount: delivery.recordCount,
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function markJobFailed(row: Row, error: unknown, now: Date): Promise<"retry" | "failed" | null> {
  const serviceError = error instanceof TokenlessServiceError ? error : null;
  const attempt = integer(row, "attempt_count");
  const retry = Boolean(serviceError?.retryable) && attempt < MAX_RECONCILIATION_ATTEMPTS;
  const code = (serviceError?.code ?? "grc_delivery_failed").slice(0, 120);
  const state = retry ? "retry" : "failed";
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const workspaceId = requiredText(row, "workspace_id");
    const connectorId = requiredText(row, "connector_id");
    const connectorVersion = integer(row, "connector_version");
    const leaseGeneration = integer(row, "lease_generation");
    const connectorFence = await client.query(
      `SELECT connector_id FROM tokenless_assurance_grc_connectors
       WHERE workspace_id = $1 AND connector_id = $2 AND version = $3 AND status = 'enabled'
       FOR UPDATE`,
      [workspaceId, connectorId, connectorVersion],
    );
    if (connectorFence.rows.length !== 1) {
      await client.query("COMMIT");
      return null;
    }
    const job = await client.query(
      `UPDATE tokenless_assurance_grc_reconciliation_jobs
       SET state = $1, lease_expires_at = NULL, next_attempt_at = $2,
           last_error_code = $3, completed_at = $4, updated_at = $5
       WHERE job_id = $6 AND workspace_id = $7 AND connector_id = $8
         AND connector_version = $9 AND state = 'processing' AND lease_generation = $10
       RETURNING job_id`,
      [
        state,
        retry ? retryAt(now, attempt) : now,
        code,
        retry ? null : now,
        now,
        requiredText(row, "job_id"),
        workspaceId,
        connectorId,
        connectorVersion,
        leaseGeneration,
      ],
    );
    if (job.rows.length !== 1) {
      await client.query("COMMIT");
      return null;
    }
    const connector = await client.query(
      `UPDATE tokenless_assurance_grc_connectors
       SET last_delivery_status = $1, last_error_code = $2, updated_at = $3
       WHERE workspace_id = $4 AND connector_id = $5 AND version = $6 AND status = 'enabled'
       RETURNING connector_id`,
      [retry ? "retry" : "failed", code, now, workspaceId, connectorId, connectorVersion],
    );
    if (connector.rows.length !== 1) throw new GrcReconciliationFenceLostError();
    await client.query("COMMIT");
  } catch (updateError) {
    await client.query("ROLLBACK");
    throw updateError;
  } finally {
    client.release();
  }
  return state;
}

export async function processDueGrcReconciliations(input: {
  now?: Date;
  limit?: number;
  source?: GrcEvidenceSource;
  credentialResolver?: GrcCredentialResolver;
  adapters?: Partial<Record<GrcProvider, GrcProviderAdapter>>;
}) {
  const now = input.now ?? new Date();
  const limit = input.limit ?? 10;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 || !Number.isFinite(now.getTime())) {
    throw new Error("GRC reconciliation worker settings are invalid.");
  }
  const enqueued = await enqueueDueReconciliations(now, limit);
  const claimed = await claimReconciliations(now, limit);
  const summary = { enqueued, claimed: claimed.length, succeeded: 0, retry: 0, failed: 0 };
  const source = input.source ?? loadWorkspaceGrcEvidence;
  const credentialResolver = input.credentialResolver ?? resolveGrcCredentialReference;
  const adapters = { ...DEFAULT_GRC_PROVIDER_ADAPTERS, ...input.adapters };
  for (const row of claimed) {
    try {
      const workspaceId = requiredText(row, "workspace_id");
      const connectorId = requiredText(row, "connector_id");
      const parsedProvider = provider(row.provider);
      const reference = requiredText(row, "credential_reference");
      const referenceDigest = requiredText(row, "credential_reference_digest");
      if (!CREDENTIAL_REFERENCE.test(reference) || referenceDigest !== grcSha256(reference)) {
        throw new TokenlessServiceError(
          "Stored GRC credential reference is invalid.",
          500,
          "stored_grc_connector_invalid",
        );
      }
      const mappings = parseGrcControlMappings(parseJson(row, "control_mappings_json"));
      const providerConfig = parseGrcProviderConfig(parsedProvider, parseJson(row, "provider_config_json"));
      const windowStart = new Date(iso(row, "window_start"));
      const windowEnd = new Date(iso(row, "window_end"));
      const generatedAt = new Date(iso(row, "created_at"));
      const sourceData = await source({ workspaceId, windowStart, windowEnd });
      const bundle = buildGrcEvidenceBundle({
        workspaceId,
        windowStart,
        windowEnd,
        generatedAt,
        mappings,
        source: sourceData,
      });
      const receipt = await dbPool.query(
        `SELECT request_digest, external_reference, record_count
         FROM tokenless_assurance_grc_delivery_receipts
         WHERE workspace_id = $1 AND connector_id = $2 AND job_id = $3
           AND artifact_kind = 'assurance_evidence_bundle' AND artifact_key = $3 AND state = 'delivered'
         LIMIT 1`,
        [workspaceId, connectorId, requiredText(row, "job_id")],
      );
      if (receipt.rows[0]) {
        if (requiredText(receipt.rows[0], "request_digest") !== bundle.bundleDigest) {
          throw new TokenlessServiceError(
            "Stored GRC receipt digest does not match the job.",
            500,
            "grc_receipt_mismatch",
          );
        }
        await markJobSucceeded({
          row,
          now,
          bundleDigest: bundle.bundleDigest,
          externalReference: requiredText(receipt.rows[0], "external_reference"),
          recordCount: integer(receipt.rows[0], "record_count"),
        });
        summary.succeeded += 1;
        continue;
      }
      await prepareJobReceipt(row, bundle.bundleDigest, now);
      const adapter = adapters[parsedProvider];
      if (!adapter || adapter.provider !== parsedProvider) {
        throw new TokenlessServiceError(
          "The GRC provider adapter is unavailable.",
          503,
          "grc_adapter_unavailable",
          true,
        );
      }
      await deliverAndMarkJobSucceeded({
        row,
        now,
        bundle,
        provider: parsedProvider,
        credentialReference: reference,
        credentialReferenceDigest: referenceDigest,
        credentialResolver,
        providerConfig,
        adapter,
      });
      summary.succeeded += 1;
    } catch (error) {
      const state = await markJobFailed(row, error, now);
      if (state !== null) summary[state] += 1;
    }
  }
  return summary;
}

export const __assuranceGrcConnectorTestUtils = {
  nextUtcDay,
  retryAt,
  deterministicId,
};

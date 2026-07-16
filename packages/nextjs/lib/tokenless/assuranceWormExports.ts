import { createHash, randomUUID } from "node:crypto";
import "server-only";
import { isRateLoopPrincipalId, normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbPool } from "~~/lib/db";
import { appendAuditEvent } from "~~/lib/privacy/audit";
import { type S3CompatibleCredential, createS3CompatibleWormRuntime } from "~~/lib/tokenless/assuranceWormS3";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import { verifyAuditExport } from "~~/scripts/audit-export-core.mjs";

type Row = Record<string, unknown>;
type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rowCount?: number | null; rows: Row[] }> };

const HASH = /^sha256:[0-9a-f]{64}$/;
const CREDENTIAL_REFERENCE = /^sec_[0-9a-f]{48}$/;
const DESTINATION_ID = /^awd_[0-9a-f]{40}$/;
const MAX_EXPORT_BYTES = 5 * 1024 * 1024;
const MAX_ATTEMPTS = 8;
const LEASE_MS = 60_000;
const MIN_RETENTION_DAYS = 183;
const MAX_RETENTION_DAYS = 3650;

export const WORM_ARTIFACT_TYPES = ["audit_export", "coverage_export", "supervision_report"] as const;
export type WormArtifactType = (typeof WORM_ARTIFACT_TYPES)[number];

export type WormDestinationSpec = {
  label: string;
  endpointOrigin: string;
  bucketName: string;
  keyPrefix: string;
  region: string;
  credentialReference: string;
  retentionDays: number;
};

export type WormDestinationPreflight = {
  schemaVersion: "rateloop.assurance-worm-preflight.v1";
  checkedAt: string;
  versioning: "Enabled";
  objectLockEnabled: true;
  defaultRetention: { mode: "COMPLIANCE"; days: number };
  providerEvidenceDigest: string;
};

export type WormPutReceipt = {
  objectVersionId: string;
  etag: string;
  checksumSha256: string;
  objectLockMode: "COMPLIANCE";
  retentionUntil: string;
};

export type VerifiedSettlementReceipt = {
  workspaceId: string;
  reference: string;
  hash: string;
};

export type AssuranceWormRuntime = {
  inspectDestination(spec: WormDestinationSpec): Promise<WormDestinationPreflight>;
  putLockedObject(input: {
    spec: WormDestinationSpec;
    objectKey: string;
    body: Uint8Array;
    checksumSha256: string;
    checksumSha256Base64: string;
    retentionUntil: string;
    idempotencyKey: string;
  }): Promise<WormPutReceipt>;
  verifySettlementReceipt?(input: {
    workspaceId: string;
    reference: string;
    hash: string;
  }): Promise<VerifiedSettlementReceipt | null>;
};

let runtimeOverride: AssuranceWormRuntime | null = null;
let managedRuntime: AssuranceWormRuntime | null = null;
let auditAppenderOverride: typeof appendAuditEvent | null = null;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined)
    throw new TokenlessServiceError("Export contains an unsupported value.", 400, "invalid_worm_export");
  return encoded;
}

function sha256(value: string | Uint8Array) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function deterministicId(prefix: "awd" | "awj" | "awr", value: string) {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 40)}`;
}

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function iso(value: unknown) {
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) throw new Error("Database returned an invalid timestamp.");
  return parsed.toISOString();
}

function integer(row: Row | undefined, key: string) {
  const value = Number(row?.[key]);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Database returned invalid ${key}.`);
  return value;
}

function requiredString(value: unknown, field: string, max: number) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new TokenlessServiceError(`${field} is invalid.`, 400, "invalid_worm_destination");
  }
  return value.trim();
}

function normalizeEndpoint(value: unknown) {
  const raw = requiredString(value, "Endpoint origin", 512);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new TokenlessServiceError("Endpoint origin is invalid.", 400, "invalid_worm_destination");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    Boolean(url.port)
  ) {
    throw new TokenlessServiceError(
      "Endpoint origin must be a standard-port HTTPS origin without credentials, path, query, or fragment.",
      400,
      "invalid_worm_destination",
    );
  }
  const configuredSuffixes = (process.env.TOKENLESS_WORM_S3_ALLOWED_ENDPOINT_SUFFIXES ?? "")
    .split(",")
    .map(suffix => suffix.trim().toLowerCase().replace(/^\./, ""))
    .filter(Boolean);
  if (configuredSuffixes.some(suffix => !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(suffix))) {
    throw new TokenlessServiceError("S3 endpoint allowlist is invalid.", 500, "invalid_worm_endpoint_allowlist");
  }
  const hostname = url.hostname.toLowerCase();
  const allowedSuffixes = ["amazonaws.com", ...configuredSuffixes];
  if (!allowedSuffixes.some(suffix => hostname === suffix || hostname.endsWith(`.${suffix}`))) {
    throw new TokenlessServiceError(
      "Endpoint origin is not in the server-managed S3 endpoint allowlist.",
      400,
      "invalid_worm_destination",
    );
  }
  return url.origin;
}

function normalizeDestination(value: unknown): WormDestinationSpec {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TokenlessServiceError("Destination settings are invalid.", 400, "invalid_worm_destination");
  }
  const body = value as Record<string, unknown>;
  const allowed = new Set([
    "label",
    "endpointOrigin",
    "bucketName",
    "keyPrefix",
    "region",
    "credentialReference",
    "retentionDays",
  ]);
  if (Object.keys(body).some(key => !allowed.has(key))) {
    throw new TokenlessServiceError(
      "Destination settings contain unsupported or plaintext credential fields.",
      400,
      "invalid_worm_destination",
    );
  }
  const bucketName = requiredString(body.bucketName, "Bucket name", 63).toLowerCase();
  if (
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucketName) ||
    bucketName.includes("..") ||
    /^(?:\d{1,3}\.){3}\d{1,3}$/.test(bucketName)
  ) {
    throw new TokenlessServiceError("Bucket name is invalid.", 400, "invalid_worm_destination");
  }
  const keyPrefix = requiredString(body.keyPrefix, "Object key prefix", 240).replace(/^\/+|\/+$/g, "");
  if (!keyPrefix || keyPrefix.split("/").some(part => !part || part === "." || part === "..")) {
    throw new TokenlessServiceError("Object key prefix is invalid.", 400, "invalid_worm_destination");
  }
  const region = requiredString(body.region, "Region", 63).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(region)) {
    throw new TokenlessServiceError("Region is invalid.", 400, "invalid_worm_destination");
  }
  const credentialReference = requiredString(body.credentialReference, "Credential reference", 52);
  if (!CREDENTIAL_REFERENCE.test(credentialReference)) {
    throw new TokenlessServiceError(
      "Credential reference must be an opaque server-side secret reference.",
      400,
      "invalid_worm_destination",
    );
  }
  if (
    !Number.isSafeInteger(body.retentionDays) ||
    Number(body.retentionDays) < MIN_RETENTION_DAYS ||
    Number(body.retentionDays) > MAX_RETENTION_DAYS
  ) {
    throw new TokenlessServiceError(
      `Retention must be between ${MIN_RETENTION_DAYS} and ${MAX_RETENTION_DAYS} days.`,
      400,
      "invalid_worm_destination",
    );
  }
  return {
    label: requiredString(body.label, "Label", 120),
    endpointOrigin: normalizeEndpoint(body.endpointOrigin),
    bucketName,
    keyPrefix,
    region,
    credentialReference,
    retentionDays: Number(body.retentionDays),
  };
}

function getRuntime() {
  if (runtimeOverride) return runtimeOverride;
  if (managedRuntime) return managedRuntime;
  if (process.env.NEXT_PUBLIC_TOKENLESS_WORM_S3_CREDENTIALS_JSON) {
    throw new TokenlessServiceError(
      "WORM credentials must never use a NEXT_PUBLIC_ environment variable.",
      500,
      "public_worm_credentials_forbidden",
    );
  }
  const raw = process.env.TOKENLESS_WORM_S3_CREDENTIALS_JSON?.trim();
  if (!raw) {
    throw new TokenlessServiceError(
      "The S3 Object Lock delivery adapter is unavailable.",
      503,
      "worm_adapter_unavailable",
      true,
    );
  }
  let credentials: Record<string, S3CompatibleCredential>;
  try {
    credentials = JSON.parse(raw) as Record<string, S3CompatibleCredential>;
  } catch {
    throw new TokenlessServiceError("WORM credential map is invalid.", 500, "invalid_worm_credential_map");
  }
  managedRuntime = createS3CompatibleWormRuntime({
    async resolveCredential(reference) {
      const value = credentials[reference];
      if (!value) {
        throw new TokenlessServiceError(
          "S3 credential reference could not be resolved.",
          503,
          "worm_credential_unavailable",
        );
      }
      return value;
    },
  });
  return managedRuntime;
}

function appendWormAuditEvent(input: Parameters<typeof appendAuditEvent>[0]) {
  return (auditAppenderOverride ?? appendAuditEvent)(input);
}

async function requireManager(client: Queryable, accountAddress: string, workspaceId: string) {
  let actor: string;
  try {
    actor = normalizeAccountSubject(accountAddress);
  } catch {
    throw new TokenlessServiceError("A valid signed-in account is required.", 401, "invalid_account");
  }
  const access = await client.query(
    `SELECT m.role FROM tokenless_workspace_members m
     JOIN tokenless_workspaces w ON w.workspace_id=m.workspace_id AND w.status='active'
     WHERE m.workspace_id=$1 AND m.account_address=$2 AND m.role IN ('owner','admin') LIMIT 1`,
    [workspaceId, actor],
  );
  if (!access.rows[0]) throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  return actor;
}

async function authorizeManager(accountAddress: string, workspaceId: string) {
  const client = await dbPool.connect();
  try {
    return await requireManager(client, accountAddress, workspaceId);
  } finally {
    client.release();
  }
}

function assertPreflight(value: WormDestinationPreflight, spec: WormDestinationSpec) {
  if (
    value?.schemaVersion !== "rateloop.assurance-worm-preflight.v1" ||
    value.versioning !== "Enabled" ||
    value.objectLockEnabled !== true ||
    value.defaultRetention?.mode !== "COMPLIANCE" ||
    !Number.isSafeInteger(value.defaultRetention.days) ||
    value.defaultRetention.days < spec.retentionDays ||
    !HASH.test(value.providerEvidenceDigest) ||
    !Number.isFinite(new Date(value.checkedAt).getTime())
  ) {
    throw new TokenlessServiceError(
      "Destination preflight requires enabled versioning and Object Lock COMPLIANCE retention covering the configured period.",
      422,
      "worm_object_lock_preflight_failed",
    );
  }
  return {
    schemaVersion: value.schemaVersion,
    checkedAt: new Date(value.checkedAt).toISOString(),
    versioning: value.versioning,
    objectLockEnabled: value.objectLockEnabled,
    defaultRetention: value.defaultRetention,
    providerEvidenceDigest: value.providerEvidenceDigest,
  } satisfies WormDestinationPreflight;
}

function destinationFromRow(row: Row) {
  return {
    destinationId: text(row, "destination_id")!,
    workspaceId: text(row, "workspace_id")!,
    version: integer(row, "version"),
    label: text(row, "label")!,
    endpointOrigin: text(row, "endpoint_origin")!,
    bucketName: text(row, "bucket_name")!,
    keyPrefix: text(row, "key_prefix")!,
    region: text(row, "region")!,
    credentialReference: text(row, "credential_reference")!,
    retentionDays: integer(row, "retention_days"),
    preflight: JSON.parse(text(row, "preflight_json") ?? "null") as WormDestinationPreflight,
    preflightHash: text(row, "preflight_hash")!,
    verifiedAt: iso(row.verified_at)!,
    status: text(row, "status") as "verified" | "superseded" | "disabled",
    createdAt: iso(row.created_at)!,
    supersededAt: iso(row.superseded_at),
    disabledAt: iso(row.disabled_at),
  };
}

function destinationSpec(row: Row): WormDestinationSpec {
  return {
    label: text(row, "label")!,
    endpointOrigin: text(row, "endpoint_origin")!,
    bucketName: text(row, "bucket_name")!,
    keyPrefix: text(row, "key_prefix")!,
    region: text(row, "region")!,
    credentialReference: text(row, "credential_reference")!,
    retentionDays: integer(row, "retention_days"),
  };
}

export async function configureAssuranceWormDestination(input: {
  accountAddress: string;
  workspaceId: string;
  body: unknown;
  now?: Date;
}) {
  await authorizeManager(input.accountAddress, input.workspaceId);
  const spec = normalizeDestination(input.body);
  const runtime = getRuntime();
  const preflight = assertPreflight(await runtime.inspectDestination(spec), spec);
  const preflightJson = canonicalJson(preflight);
  const now = input.now ?? new Date();
  const client = await dbPool.connect();
  let actor = "";
  let destination: ReturnType<typeof destinationFromRow>;
  try {
    await client.query("BEGIN");
    actor = await requireManager(client, input.accountAddress, input.workspaceId);
    const current = await client.query(
      `SELECT * FROM tokenless_assurance_worm_destinations
       WHERE workspace_id=$1 AND status='verified' FOR UPDATE`,
      [input.workspaceId],
    );
    const currentRow = current.rows[0] as Row | undefined;
    const destinationId = currentRow
      ? text(currentRow, "destination_id")!
      : deterministicId("awd", `${input.workspaceId}:${randomUUID()}`);
    const version = currentRow ? integer(currentRow, "version") + 1 : 1;
    if (currentRow) {
      await client.query(
        `UPDATE tokenless_assurance_worm_destinations SET status='superseded',superseded_at=$1
         WHERE workspace_id=$2 AND destination_id=$3 AND version=$4 AND status='verified'`,
        [now, input.workspaceId, destinationId, version - 1],
      );
    }
    const inserted = await client.query(
      `INSERT INTO tokenless_assurance_worm_destinations
       (destination_id,workspace_id,version,label,endpoint_origin,bucket_name,key_prefix,region,
        credential_reference,retention_days,preflight_json,preflight_hash,verified_at,status,created_by,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'verified',$14,$15) RETURNING *`,
      [
        destinationId,
        input.workspaceId,
        version,
        spec.label,
        spec.endpointOrigin,
        spec.bucketName,
        spec.keyPrefix,
        spec.region,
        spec.credentialReference,
        spec.retentionDays,
        preflightJson,
        sha256(preflightJson),
        new Date(preflight.checkedAt),
        actor,
        now,
      ],
    );
    destination = destinationFromRow(inserted.rows[0]!);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await appendAuditEvent({
    workspaceId: input.workspaceId,
    actorKind: isRateLoopPrincipalId(actor) ? "principal" : "account",
    actorReference: actor,
    assuranceMethod: "rateloop_session",
    action: "assurance.worm_destination.verified",
    targetKind: "assurance_worm_destination",
    targetId: `${destination.destinationId}:${destination.version}`,
    purpose: "assurance_export_delivery",
    reason: "authorized_object_lock_configuration",
    result: "success",
    metadata: {
      retentionDays: destination.retentionDays,
      preflightHash: destination.preflightHash,
      credentialReference: destination.credentialReference,
    },
    occurredAt: now,
  });
  return destination;
}

export async function getAssuranceWormDestination(input: { accountAddress: string; workspaceId: string }) {
  const client = await dbPool.connect();
  try {
    await requireManager(client, input.accountAddress, input.workspaceId);
    const result = await client.query(
      `SELECT * FROM tokenless_assurance_worm_destinations
       WHERE workspace_id=$1 ORDER BY version DESC,destination_id DESC`,
      [input.workspaceId],
    );
    const active = result.rows.find(row => text(row, "status") === "verified");
    return {
      active: active ? destinationFromRow(active) : null,
      history: result.rows.map(destinationFromRow),
    };
  } finally {
    client.release();
  }
}

export async function disableAssuranceWormDestination(input: {
  accountAddress: string;
  workspaceId: string;
  destinationId: string;
  now?: Date;
}) {
  if (!DESTINATION_ID.test(input.destinationId)) {
    throw new TokenlessServiceError("WORM destination not found.", 404, "worm_destination_not_found");
  }
  const now = input.now ?? new Date();
  const client = await dbPool.connect();
  let actor = "";
  try {
    await client.query("BEGIN");
    actor = await requireManager(client, input.accountAddress, input.workspaceId);
    const updated = await client.query(
      `UPDATE tokenless_assurance_worm_destinations SET status='disabled',disabled_at=$1
       WHERE workspace_id=$2 AND destination_id=$3 AND status='verified' RETURNING *`,
      [now, input.workspaceId, input.destinationId],
    );
    if (!updated.rows[0]) {
      throw new TokenlessServiceError("WORM destination not found.", 404, "worm_destination_not_found");
    }
    await client.query("COMMIT");
    await appendAuditEvent({
      workspaceId: input.workspaceId,
      actorKind: isRateLoopPrincipalId(actor) ? "principal" : "account",
      actorReference: actor,
      assuranceMethod: "rateloop_session",
      action: "assurance.worm_destination.disabled",
      targetKind: "assurance_worm_destination",
      targetId: input.destinationId,
      purpose: "assurance_export_delivery",
      reason: "authorized_destination_disable",
      result: "success",
      occurredAt: now,
    });
    return destinationFromRow(updated.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function reportWindow(input: { from?: Date; to?: Date; now?: Date }) {
  const now = input.now ?? new Date();
  const to = input.to ?? now;
  const from = input.from ?? new Date(to.getTime() - 30 * 24 * 60 * 60_000);
  if (
    !Number.isFinite(from.getTime()) ||
    !Number.isFinite(to.getTime()) ||
    from >= to ||
    to > now ||
    to.getTime() - from.getTime() > 366 * 24 * 60 * 60_000
  ) {
    throw new TokenlessServiceError("Supervision report period is invalid.", 400, "invalid_supervision_period");
  }
  return { from, to, generatedAt: now };
}

export async function buildAssuranceSupervisionReport(input: {
  accountAddress: string;
  workspaceId: string;
  from?: Date;
  to?: Date;
  now?: Date;
}) {
  const window = reportWindow(input);
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await requireManager(client, input.accountAddress, input.workspaceId);
    const [opportunities, requests, states] = await Promise.all([
      client.query(
        `SELECT COUNT(*)::integer AS eligible,
                COUNT(*) FILTER (WHERE decision='required')::integer AS selected,
                SUM(CASE WHEN critical_risk = true THEN 1 ELSE 0 END)::integer AS critical_escalations
         FROM tokenless_agent_review_opportunities
         WHERE workspace_id=$1 AND created_at >= $2 AND created_at < $3`,
        [input.workspaceId, window.from, window.to],
      ),
      client.query(
        `SELECT COUNT(DISTINCT e.opportunity_id)::integer AS requested
         FROM tokenless_agent_review_opportunity_transition_events e
         JOIN tokenless_agent_review_opportunities o
           ON o.workspace_id=e.workspace_id AND o.opportunity_id=e.opportunity_id
         WHERE e.workspace_id=$1 AND e.to_state='pending' AND e.occurred_at < $3
           AND o.created_at >= $2 AND o.created_at < $3`,
        [input.workspaceId, window.from, window.to],
      ),
      client.query(
        `WITH eligible AS (
           SELECT opportunity_id FROM tokenless_agent_review_opportunities
           WHERE workspace_id=$1 AND created_at >= $2 AND created_at < $3
         ), latest AS (
           SELECT e.opportunity_id,MAX(e.to_revision)::integer AS revision
           FROM tokenless_agent_review_opportunity_transition_events e
           JOIN eligible i ON i.opportunity_id=e.opportunity_id
           WHERE e.workspace_id=$1 AND e.occurred_at < $3 GROUP BY e.opportunity_id
         )
         SELECT e.to_state AS state,COUNT(*)::integer AS count
         FROM tokenless_agent_review_opportunity_transition_events e
         JOIN latest l ON l.opportunity_id=e.opportunity_id AND l.revision=e.to_revision
         WHERE e.workspace_id=$1 GROUP BY e.to_state ORDER BY e.to_state ASC`,
        [input.workspaceId, window.from, window.to],
      ),
    ]);
    const opportunityRow = opportunities.rows[0] as Row | undefined;
    const byState = Object.fromEntries(states.rows.map(row => [text(row, "state")!, integer(row, "count")])) as Record<
      string,
      number
    >;
    const eligible = integer(opportunityRow, "eligible");
    const completed = byState.completed ?? 0;
    const payload = {
      schemaVersion: "rateloop.assurance-supervision-report.v1" as const,
      workspaceId: input.workspaceId,
      generatedAt: window.generatedAt.toISOString(),
      period: { startInclusive: window.from.toISOString(), endExclusive: window.to.toISOString() },
      oversightCoverage: {
        eligibleOutputs: eligible,
        selectedForReview: integer(opportunityRow, "selected"),
        reviewRequestsSent: integer(requests.rows[0] as Row | undefined, "requested"),
        reviewsCompleted: completed,
        completionCoverageBps: eligible === 0 ? null : Math.floor((completed * 10_000) / eligible),
      },
      exceptions: {
        approvalRequired: byState.approval_required ?? 0,
        blocked: byState.blocked ?? 0,
        inconclusive: byState.inconclusive ?? 0,
        failedTerminal: byState.failed_terminal ?? 0,
        cancelledBeforeCommit: byState.cancelled_before_commit ?? 0,
      },
      escalations: { criticalRisk: integer(opportunityRow, "critical_escalations") },
      financialClaims: {
        state: "not_included" as const,
        reason: "Settlement and payment claims require separately verified terminal receipts.",
      },
      limitations: [
        "This report is evidence that RateLoop review policy operated; it is not the deployer's human oversight itself.",
        "Execution provenance is host-reported unless a separate attestation says otherwise.",
      ],
    };
    const report = { ...payload, reportDigest: sha256(canonicalJson(payload)) };
    await client.query("COMMIT");
    return report;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function artifactSchema(type: WormArtifactType, artifact: Record<string, unknown>) {
  if (type === "audit_export" && artifact.format === "rateloop-audit-v1") {
    if (verifyAuditExport(artifact).valid !== true) {
      throw new TokenlessServiceError("Audit export chain is invalid.", 409, "invalid_worm_export");
    }
    return "rateloop-audit-v1";
  }
  if (type === "coverage_export" && artifact.schemaVersion === "rateloop.assurance-coverage-export.v1") {
    const { exportDigest, ...payload } = artifact;
    if (
      typeof exportDigest !== "string" ||
      !HASH.test(exportDigest) ||
      sha256(canonicalJson(payload)) !== exportDigest
    ) {
      throw new TokenlessServiceError("Coverage export digest is invalid.", 409, "invalid_worm_export");
    }
    return "rateloop.assurance-coverage-export.v1";
  }
  if (type === "supervision_report" && artifact.schemaVersion === "rateloop.assurance-supervision-report.v1") {
    const { reportDigest, ...payload } = artifact;
    if (
      typeof reportDigest !== "string" ||
      !HASH.test(reportDigest) ||
      sha256(canonicalJson(payload)) !== reportDigest
    ) {
      throw new TokenlessServiceError("Supervision report digest is invalid.", 409, "invalid_worm_export");
    }
    return "rateloop.assurance-supervision-report.v1";
  }
  throw new TokenlessServiceError("Artifact type and schema do not match.", 400, "invalid_worm_export");
}

const MONEY_CLAIM_KEYS = new Set([
  "paidamount",
  "paidatomic",
  "payoutamount",
  "payoutatomic",
  "paymentreceipt",
  "paymenttransaction",
  "settlementreceipt",
  "settlementstatus",
  "settlementtransaction",
]);

function containsMoneyClaim(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsMoneyClaim);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(
    ([key, entry]) => MONEY_CLAIM_KEYS.has(key.replace(/[_-]/g, "").toLowerCase()) || containsMoneyClaim(entry),
  );
}

function safeSourceId(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,239}$/.test(value)) {
    throw new TokenlessServiceError("Export source ID is invalid.", 400, "invalid_worm_export");
  }
  return value;
}

function jobFromRow(row: Row) {
  const receiptId = text(row, "receipt_id");
  return {
    jobId: text(row, "job_id")!,
    workspaceId: text(row, "workspace_id")!,
    destinationId: text(row, "destination_id")!,
    destinationVersion: integer(row, "destination_version"),
    artifactType: text(row, "artifact_type") as WormArtifactType,
    sourceId: text(row, "source_id")!,
    artifactSchema: text(row, "artifact_schema")!,
    payloadHash: text(row, "payload_hash")!,
    objectKey: text(row, "object_key")!,
    idempotencyKey: text(row, "idempotency_key")!,
    retentionUntil: iso(row.retention_until)!,
    claimsMoneyOrSettlement: Boolean(row.claims_money_or_settlement),
    settlementReceiptReference: text(row, "settlement_receipt_reference"),
    settlementReceiptHash: text(row, "settlement_receipt_hash"),
    state: text(row, "state") as "pending" | "delivering" | "retry" | "delivered" | "dead",
    attemptCount: integer(row, "attempt_count"),
    nextAttemptAt: iso(row.next_attempt_at)!,
    lastErrorCode: text(row, "last_error_code"),
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
    deliveredAt: iso(row.delivered_at),
    receipt: receiptId
      ? {
          receiptId,
          objectVersionId: text(row, "object_version_id")!,
          etag: text(row, "etag")!,
          checksumSha256: text(row, "checksum_sha256")!,
          objectLockMode: "COMPLIANCE" as const,
          retentionUntil: iso(row.receipt_retention_until)!,
          providerReceiptHash: text(row, "provider_receipt_hash")!,
          deliveredAt: iso(row.receipt_delivered_at)!,
        }
      : null,
  };
}

const JOB_SELECT = `SELECT j.*,r.receipt_id,r.object_version_id,r.etag,r.checksum_sha256,r.object_lock_mode,
                            r.retention_until AS receipt_retention_until,r.provider_receipt_hash,
                            r.delivered_at AS receipt_delivered_at
                     FROM tokenless_assurance_worm_export_jobs j
                     LEFT JOIN tokenless_assurance_worm_export_receipts r ON r.job_id=j.job_id`;

const WORM_RECEIPT_SELECT = `SELECT receipt_id,object_version_id,etag,checksum_sha256,object_lock_mode,
                                   retention_until AS receipt_retention_until,provider_receipt_hash,
                                   delivered_at AS receipt_delivered_at
                            FROM tokenless_assurance_worm_export_receipts WHERE job_id=$1`;

async function requireCurrentWormLease(
  client: Queryable,
  jobId: string,
  leaseGeneration: number,
  lockForReceiptPersistence = false,
) {
  const current = await client.query(
    `SELECT job_id FROM tokenless_assurance_worm_export_jobs
     WHERE job_id=$1 AND state='delivering' AND lease_generation=$2${lockForReceiptPersistence ? " FOR UPDATE" : ""}`,
    [jobId, leaseGeneration],
  );
  if (current.rows.length !== 1) {
    throw new TokenlessServiceError("WORM export delivery lease was lost.", 409, "worm_export_lease_lost", true);
  }
}

async function persistVerifiedWormReceipt(input: {
  jobId: string;
  leaseGeneration: number;
  receiptId: string;
  workspaceId: string;
  objectVersionId: string;
  etag: string;
  checksumSha256: string;
  retentionUntil: Date;
  providerReceiptJson: string;
  providerReceiptHash: string;
  deliveredAt: Date;
}) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await requireCurrentWormLease(client, input.jobId, input.leaseGeneration, true);
    await client.query(
      `INSERT INTO tokenless_assurance_worm_export_receipts
       (receipt_id,job_id,workspace_id,object_version_id,etag,checksum_sha256,object_lock_mode,
        retention_until,provider_receipt_json,provider_receipt_hash,delivered_at)
       VALUES ($1,$2,$3,$4,$5,$6,'COMPLIANCE',$7,$8,$9,$10)
       ON CONFLICT (job_id) DO NOTHING`,
      [
        input.receiptId,
        input.jobId,
        input.workspaceId,
        input.objectVersionId,
        input.etag,
        input.checksumSha256,
        input.retentionUntil,
        input.providerReceiptJson,
        input.providerReceiptHash,
        input.deliveredAt,
      ],
    );
    const persisted = await client.query(WORM_RECEIPT_SELECT, [input.jobId]);
    if (persisted.rows.length !== 1) throw new Error("worm_provider_receipt_not_persisted");
    await client.query("COMMIT");
    return persisted.rows[0] as Row;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function enqueueAssuranceWormExport(input: {
  accountAddress: string;
  workspaceId: string;
  artifactType: WormArtifactType;
  sourceId: string;
  artifact: unknown;
  claimsMoneyOrSettlement?: boolean;
  settlementReceipt?: { reference: string; hash: string } | null;
  now?: Date;
}) {
  await authorizeManager(input.accountAddress, input.workspaceId);
  if (!WORM_ARTIFACT_TYPES.includes(input.artifactType)) {
    throw new TokenlessServiceError("Artifact type is invalid.", 400, "invalid_worm_export");
  }
  if (!input.artifact || typeof input.artifact !== "object" || Array.isArray(input.artifact)) {
    throw new TokenlessServiceError("Export artifact is invalid.", 400, "invalid_worm_export");
  }
  const artifact = input.artifact as Record<string, unknown>;
  if (artifact.workspaceId !== input.workspaceId) {
    throw new TokenlessServiceError("Export artifact belongs to another workspace.", 400, "invalid_worm_export");
  }
  const sourceId = safeSourceId(input.sourceId);
  const schema = artifactSchema(input.artifactType, artifact);
  const payloadJson = canonicalJson(artifact);
  if (Buffer.byteLength(payloadJson) > MAX_EXPORT_BYTES) {
    throw new TokenlessServiceError("Export artifact exceeds 5 MiB.", 413, "worm_export_too_large");
  }
  const claimsMoney = input.claimsMoneyOrSettlement === true || containsMoneyClaim(artifact);
  let settlementReceipt: VerifiedSettlementReceipt | null = null;
  if (claimsMoney) {
    if (
      !input.settlementReceipt ||
      !HASH.test(input.settlementReceipt.hash) ||
      !input.settlementReceipt.reference.trim()
    ) {
      throw new TokenlessServiceError(
        "Money or settlement claims require a verified terminal settlement receipt.",
        409,
        "paid_assignment_settlement_unverified",
      );
    }
    const runtime = getRuntime();
    settlementReceipt =
      (await runtime.verifySettlementReceipt?.({
        workspaceId: input.workspaceId,
        reference: input.settlementReceipt.reference,
        hash: input.settlementReceipt.hash,
      })) ?? null;
    if (
      !settlementReceipt ||
      settlementReceipt.workspaceId !== input.workspaceId ||
      settlementReceipt.reference !== input.settlementReceipt.reference ||
      settlementReceipt.hash !== input.settlementReceipt.hash
    ) {
      throw new TokenlessServiceError(
        "Money or settlement claims require a verified terminal settlement receipt.",
        409,
        "paid_assignment_settlement_unverified",
      );
    }
  }
  const now = input.now ?? new Date();
  const payloadHash = sha256(payloadJson);
  const client = await dbPool.connect();
  let actor = "";
  let job: ReturnType<typeof jobFromRow>;
  try {
    await client.query("BEGIN");
    actor = await requireManager(client, input.accountAddress, input.workspaceId);
    const destination = await client.query(
      `SELECT * FROM tokenless_assurance_worm_destinations
       WHERE workspace_id=$1 AND status='verified' FOR UPDATE`,
      [input.workspaceId],
    );
    const destinationRow = destination.rows[0] as Row | undefined;
    if (!destinationRow) {
      throw new TokenlessServiceError("A verified WORM destination is required.", 409, "worm_destination_required");
    }
    const destinationId = text(destinationRow, "destination_id")!;
    const destinationVersion = integer(destinationRow, "version");
    const idempotencyKey = `worm:${createHash("sha256")
      .update(
        canonicalJson({
          workspaceId: input.workspaceId,
          destinationId,
          destinationVersion,
          artifactType: input.artifactType,
          sourceId,
          payloadHash,
        }),
      )
      .digest("hex")}`;
    const existing = await client.query(`${JOB_SELECT} WHERE j.workspace_id=$1 AND j.idempotency_key=$2 LIMIT 1`, [
      input.workspaceId,
      idempotencyKey,
    ]);
    if (existing.rows[0]) {
      await client.query("COMMIT");
      return jobFromRow(existing.rows[0]);
    }
    const retentionUntil = new Date(now.getTime() + integer(destinationRow, "retention_days") * 24 * 60 * 60_000);
    const jobId = deterministicId("awj", idempotencyKey);
    const date = now.toISOString().slice(0, 10);
    const sourceFragment = createHash("sha256").update(sourceId).digest("hex").slice(0, 16);
    const objectKey = `${text(destinationRow, "key_prefix")}/${input.workspaceId}/${input.artifactType}/${date}/${sourceFragment}-${payloadHash.slice(-16)}.json`;
    await client.query(
      `INSERT INTO tokenless_assurance_worm_export_jobs
       (job_id,workspace_id,destination_id,destination_version,artifact_type,source_id,artifact_schema,
        payload_json,payload_hash,object_key,idempotency_key,retention_until,claims_money_or_settlement,
        settlement_receipt_reference,settlement_receipt_hash,state,attempt_count,next_attempt_at,created_by,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'pending',0,$16,$17,$16,$16)`,
      [
        jobId,
        input.workspaceId,
        destinationId,
        destinationVersion,
        input.artifactType,
        sourceId,
        schema,
        payloadJson,
        payloadHash,
        objectKey,
        idempotencyKey,
        retentionUntil,
        claimsMoney,
        settlementReceipt?.reference ?? null,
        settlementReceipt?.hash ?? null,
        now,
        actor,
      ],
    );
    const inserted = await client.query(`${JOB_SELECT} WHERE j.workspace_id=$1 AND j.job_id=$2`, [
      input.workspaceId,
      jobId,
    ]);
    job = jobFromRow(inserted.rows[0]!);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  await appendAuditEvent({
    workspaceId: input.workspaceId,
    actorKind: isRateLoopPrincipalId(actor) ? "principal" : "account",
    actorReference: actor,
    assuranceMethod: "rateloop_session",
    action: "assurance.worm_export.queued",
    targetKind: "assurance_worm_export_job",
    targetId: job.jobId,
    purpose: "assurance_export_delivery",
    reason: "authorized_worm_export",
    result: "success",
    metadata: { artifactType: input.artifactType, payloadHash, claimsMoneyOrSettlement: claimsMoney },
    occurredAt: now,
  });
  return job;
}

function retryDelay(attempt: number) {
  return Math.min(60 * 60_000, 5_000 * 2 ** Math.max(0, attempt - 1));
}

export async function processAssuranceWormExportJob(input: { jobId: string; now?: Date }) {
  const now = input.now ?? new Date();
  const client = await dbPool.connect();
  let leased: Row;
  try {
    await client.query("BEGIN");
    const selected = await client.query(
      `SELECT j.*,d.label,d.endpoint_origin,d.bucket_name,d.key_prefix,d.region,d.credential_reference,d.retention_days
       FROM tokenless_assurance_worm_export_jobs j
       JOIN tokenless_assurance_worm_destinations d
         ON d.workspace_id=j.workspace_id AND d.destination_id=j.destination_id AND d.version=j.destination_version
       WHERE j.job_id=$1 FOR UPDATE`,
      [input.jobId],
    );
    leased = selected.rows[0] as Row;
    if (!leased) throw new TokenlessServiceError("WORM export job not found.", 404, "worm_export_not_found");
    const receipt = await client.query(WORM_RECEIPT_SELECT, [input.jobId]);
    Object.assign(leased, receipt.rows[0] ?? {});
    const state = text(leased, "state");
    if (state === "delivered" || state === "dead") {
      await client.query("COMMIT");
      return (await listAssuranceWormExports({ workspaceId: text(leased, "workspace_id")!, internal: true })).jobs.find(
        job => job.jobId === input.jobId,
      )!;
    }
    const leaseExpires = iso(leased.lease_expires_at);
    const nextAttempt = new Date(String(leased.next_attempt_at));
    if ((state === "delivering" && leaseExpires && new Date(leaseExpires) > now) || nextAttempt > now) {
      throw new TokenlessServiceError("WORM export job is not due.", 409, "worm_export_not_due", true);
    }
    const previousLeaseGeneration = integer(leased, "lease_generation");
    if (previousLeaseGeneration >= 2_147_483_647) {
      throw new TokenlessServiceError("WORM export lease generation is exhausted.", 409, "worm_export_lease_exhausted");
    }
    const leaseGeneration = previousLeaseGeneration + 1;
    const attempt = integer(leased, "attempt_count") + (text(leased, "receipt_id") ? 0 : 1);
    const claimed = await client.query(
      `UPDATE tokenless_assurance_worm_export_jobs
       SET state='delivering',attempt_count=$2,lease_expires_at=$3,updated_at=$4,last_error_code=NULL,
           lease_generation=$5
       WHERE job_id=$1 AND lease_generation=$6`,
      [input.jobId, attempt, new Date(now.getTime() + LEASE_MS), now, leaseGeneration, previousLeaseGeneration],
    );
    if (claimed.rowCount !== 1) {
      throw new TokenlessServiceError("WORM export delivery lease was lost.", 409, "worm_export_lease_lost", true);
    }
    leased.attempt_count = attempt;
    leased.lease_generation = leaseGeneration;
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  let auditStage = false;
  let providerAccepted = false;
  try {
    const expectedHash = text(leased, "payload_hash")!;
    const leaseGeneration = integer(leased, "lease_generation");
    if (!text(leased, "receipt_id")) {
      const runtime = getRuntime();
      const payload = Buffer.from(text(leased, "payload_json")!, "utf8");
      if (sha256(payload) !== expectedHash) throw new Error("stored_payload_digest_mismatch");
      const spec = destinationSpec(leased);
      const receipt = await runtime.putLockedObject({
        spec,
        objectKey: text(leased, "object_key")!,
        body: payload,
        checksumSha256: expectedHash,
        checksumSha256Base64: createHash("sha256").update(payload).digest("base64"),
        retentionUntil: new Date(String(leased.retention_until)).toISOString(),
        idempotencyKey: text(leased, "idempotency_key")!,
      });
      const receiptRetention = new Date(receipt.retentionUntil);
      if (
        !receipt.objectVersionId?.trim() ||
        !receipt.etag?.trim() ||
        receipt.checksumSha256 !== expectedHash ||
        receipt.objectLockMode !== "COMPLIANCE" ||
        !Number.isFinite(receiptRetention.getTime()) ||
        receiptRetention < new Date(String(leased.retention_until))
      ) {
        throw new Error("provider_receipt_mismatch");
      }
      providerAccepted = true;
      const deliveredAt = input.now ?? new Date();
      const providerReceipt = {
        schemaVersion: "rateloop.assurance-worm-provider-receipt.v1" as const,
        workspaceId: text(leased, "workspace_id")!,
        destinationId: text(leased, "destination_id")!,
        destinationVersion: integer(leased, "destination_version"),
        jobId: input.jobId,
        bucketName: text(leased, "bucket_name")!,
        objectKey: text(leased, "object_key")!,
        objectVersionId: receipt.objectVersionId,
        etag: receipt.etag,
        checksumSha256: receipt.checksumSha256,
        objectLockMode: receipt.objectLockMode,
        retentionUntil: receiptRetention.toISOString(),
        deliveredAt: deliveredAt.toISOString(),
      };
      const receiptJson = canonicalJson(providerReceipt);
      const proposedReceiptHash = sha256(receiptJson);
      const proposedReceiptId = deterministicId("awr", `${input.jobId}:${proposedReceiptHash}`);
      const persisted = await persistVerifiedWormReceipt({
        jobId: input.jobId,
        leaseGeneration,
        receiptId: proposedReceiptId,
        workspaceId: text(leased, "workspace_id")!,
        objectVersionId: receipt.objectVersionId,
        etag: receipt.etag,
        checksumSha256: expectedHash,
        retentionUntil: receiptRetention,
        providerReceiptJson: receiptJson,
        providerReceiptHash: proposedReceiptHash,
        deliveredAt,
      });
      Object.assign(leased, persisted);
    }
    const receiptId = text(leased, "receipt_id");
    const receiptHash = text(leased, "provider_receipt_hash");
    const deliveredAt = leased.receipt_delivered_at ? new Date(String(leased.receipt_delivered_at)) : null;
    const receiptRetention = leased.receipt_retention_until ? new Date(String(leased.receipt_retention_until)) : null;
    if (
      !receiptId ||
      !receiptHash ||
      !HASH.test(receiptHash) ||
      !text(leased, "object_version_id") ||
      !text(leased, "etag") ||
      text(leased, "checksum_sha256") !== expectedHash ||
      text(leased, "object_lock_mode") !== "COMPLIANCE" ||
      !deliveredAt ||
      !Number.isFinite(deliveredAt.getTime()) ||
      !receiptRetention ||
      !Number.isFinite(receiptRetention.getTime()) ||
      receiptRetention < new Date(String(leased.retention_until))
    ) {
      throw new Error("stored_provider_receipt_invalid");
    }
    auditStage = true;
    await requireCurrentWormLease(dbPool, input.jobId, leaseGeneration);
    await appendWormAuditEvent({
      workspaceId: text(leased, "workspace_id")!,
      actorKind: "system",
      actorReference: "service:assurance-worm-exporter",
      assuranceMethod: "object_lock_provider_receipt",
      action: "assurance.worm_export.delivered",
      targetKind: "assurance_worm_export_job",
      targetId: input.jobId,
      purpose: "assurance_export_delivery",
      reason: "verified_object_lock_receipt",
      result: "success",
      metadata: { receiptId, providerReceiptHash: receiptHash, payloadHash: expectedHash },
      occurredAt: deliveredAt,
      idempotencyKey: `worm-delivered:${input.jobId}:${receiptHash}`,
    });
    const finalized = await dbPool.query(
      `UPDATE tokenless_assurance_worm_export_jobs
       SET state='delivered',lease_expires_at=NULL,delivered_at=$2,updated_at=$3,last_error_code=NULL
       WHERE job_id=$1 AND state='delivering' AND lease_generation=$4`,
      [input.jobId, deliveredAt, now, leaseGeneration],
    );
    if (finalized.rowCount !== 1) throw new Error("worm_delivery_finalize_conflict");
  } catch (error) {
    const attempt = integer(leased, "attempt_count");
    const durableReceipt = await dbPool.query(
      "SELECT receipt_id FROM tokenless_assurance_worm_export_receipts WHERE job_id=$1",
      [input.jobId],
    );
    const receiptCommitted = durableReceipt.rows.length === 1;
    const receiptPersistencePending = providerAccepted && !receiptCommitted;
    const dead = !receiptCommitted && !providerAccepted && attempt >= MAX_ATTEMPTS;
    const retryAttempt = receiptPersistencePending ? Math.max(0, attempt - 1) : attempt;
    const code =
      error instanceof TokenlessServiceError
        ? error.code
        : auditStage
          ? "worm_delivery_audit_failed"
          : receiptCommitted
            ? "worm_delivery_audit_pending"
            : receiptPersistencePending
              ? "worm_provider_receipt_persistence_failed"
              : "worm_provider_delivery_failed";
    await dbPool.query(
      `UPDATE tokenless_assurance_worm_export_jobs
       SET state=$2,lease_expires_at=NULL,next_attempt_at=$3,last_error_code=$4,updated_at=$5,attempt_count=$6
       WHERE job_id=$1 AND state='delivering' AND lease_generation=$7`,
      [
        input.jobId,
        dead ? "dead" : "retry",
        new Date(now.getTime() + retryDelay(attempt)),
        code,
        now,
        retryAttempt,
        integer(leased, "lease_generation"),
      ],
    );
  }
  const listed = await listAssuranceWormExports({ workspaceId: text(leased, "workspace_id")!, internal: true });
  return listed.jobs.find(job => job.jobId === input.jobId)!;
}

export async function listAssuranceWormExports(
  input: { accountAddress: string; workspaceId: string; internal?: false } | { workspaceId: string; internal: true },
) {
  const client = await dbPool.connect();
  try {
    if (!input.internal) await requireManager(client, input.accountAddress, input.workspaceId);
    const result = await client.query(
      `${JOB_SELECT} WHERE j.workspace_id=$1 ORDER BY j.created_at DESC,j.job_id DESC LIMIT 200`,
      [input.workspaceId],
    );
    return { jobs: result.rows.map(jobFromRow) };
  } finally {
    client.release();
  }
}

export async function processDueAssuranceWormExports(input: { now?: Date; limit?: number } = {}) {
  const now = input.now ?? new Date();
  const limit = input.limit ?? 20;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("WORM export processor limit must be between one and 100.");
  }
  const due = await dbPool.query(
    `SELECT job_id FROM tokenless_assurance_worm_export_jobs
     WHERE (state IN ('pending','retry') AND next_attempt_at <= $1)
        OR (state='delivering' AND lease_expires_at <= $1)
     ORDER BY next_attempt_at ASC,created_at ASC,job_id ASC LIMIT $2`,
    [now, limit],
  );
  const summary = { due: due.rows.length, delivered: 0, retry: 0, dead: 0, skipped: 0 };
  for (const row of due.rows as Row[]) {
    try {
      const job = await processAssuranceWormExportJob({ jobId: text(row, "job_id")!, now });
      if (job.state === "delivered") summary.delivered += 1;
      else if (job.state === "dead") summary.dead += 1;
      else if (job.state === "retry") summary.retry += 1;
      else summary.skipped += 1;
    } catch (error) {
      if (error instanceof TokenlessServiceError && error.code === "worm_export_not_due") {
        summary.skipped += 1;
      } else {
        summary.retry += 1;
      }
    }
  }
  return summary;
}

export function __setAssuranceWormRuntimeForTests(value: AssuranceWormRuntime | null) {
  runtimeOverride = value;
  managedRuntime = null;
}

export function __setAssuranceWormAuditAppenderForTests(value: typeof appendAuditEvent | null) {
  auditAppenderOverride = value;
}

export const __assuranceWormTestUtils = { canonicalJson, containsMoneyClaim, normalizeDestination, sha256 };

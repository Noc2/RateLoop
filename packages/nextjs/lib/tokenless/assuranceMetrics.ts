import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbClient, dbPool } from "~~/lib/db";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;

const TOKEN_PATTERN = /^rlm_([0-9a-f]{32})_([A-Za-z0-9_-]{43})$/;
const CREDENTIAL_PATTERN = /^amc_[0-9a-f]{32}$/;
const WINDOW_MS = 30 * 24 * 60 * 60_000;
export const MAX_ASSURANCE_METRIC_SCOPES = 100;

export type AssuranceMetricScope = {
  scope: string;
  stage: "calibrating" | "high_coverage" | "medium_coverage" | "monitoring";
  eligible: number;
  requested: number;
  completed: number;
  blocked: number;
  approvalRequired: number;
  comparable: number;
  disagreements: number;
  latencyCount: number;
  latencyMilliseconds: number;
};

export type AssuranceMetricsSnapshot = {
  windowSeconds: number;
  reviewsRequested: number;
  reviewsCompleted: number;
  blocked: number;
  approvalRequired: number;
  scopesTruncated: boolean;
  scopes: AssuranceMetricScope[];
  /**
   * Current (non-superseded) per-output override records in the window.
   * overrideRateBps = (overridden + reversed) / decided; null without data.
   */
  overrideDecisions: {
    decided: number;
    overridden: number;
    reversed: number;
    overrideRateBps: number | null;
  };
  evidenceAnchor:
    | { state: "absent"; lagSeconds: null }
    | { state: "pending" | "completed" | "failed"; lagSeconds: number };
};

function text(row: Row, key: string) {
  const value = row[key];
  return value === null || value === undefined ? null : String(value);
}

function nonnegative(row: Row, key: string) {
  const value = Number(row[key] ?? 0);
  if (!Number.isFinite(value) || value < 0) throw new Error(`Database returned invalid ${key}.`);
  return value;
}

function iso(value: unknown) {
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) throw new Error("Database returned an invalid timestamp.");
  return parsed.toISOString();
}

function hashToken(token: string) {
  return `sha256:${createHash("sha256").update(token).digest("hex")}`;
}

function safeHashEquals(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function validateLabel(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 120) {
    throw new TokenlessServiceError("Credential label is invalid.", 400, "invalid_metrics_credential");
  }
  return value.trim();
}

function validateCredentialId(value: string) {
  if (!CREDENTIAL_PATTERN.test(value)) {
    throw new TokenlessServiceError("Metrics credential not found.", 404, "metrics_credential_not_found");
  }
  return value;
}

function createCredentialToken() {
  const suffix = randomBytes(16).toString("hex");
  const token = `rlm_${suffix}_${randomBytes(32).toString("base64url")}`;
  return { credentialId: `amc_${suffix}`, token, tokenHash: hashToken(token) };
}

export async function requireAssuranceMetricsManagement(accountAddress: string, workspaceId: string) {
  let actor: string;
  try {
    actor = normalizeAccountSubject(accountAddress);
  } catch {
    throw new TokenlessServiceError("Account address is invalid.", 400, "invalid_account");
  }
  const result = await dbClient.execute({
    sql: `SELECT m.role
          FROM tokenless_workspace_members m
          JOIN tokenless_workspaces w ON w.workspace_id = m.workspace_id
          WHERE m.workspace_id = ? AND m.account_address = ?
            AND m.role IN ('owner','admin') AND w.status = 'active'
          LIMIT 1`,
    args: [workspaceId, actor],
  });
  if (!result.rowCount) throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  return actor;
}

function credentialFromRow(row: Row) {
  return {
    credentialId: text(row, "credential_id")!,
    workspaceId: text(row, "workspace_id")!,
    label: text(row, "label")!,
    status: text(row, "status") as "active" | "rotated" | "revoked",
    issuedBy: text(row, "issued_by")!,
    issuedAt: iso(row.issued_at)!,
    lastUsedAt: iso(row.last_used_at),
    rotatedFromCredentialId: text(row, "rotated_from_credential_id"),
    rotatedAt: iso(row.rotated_at),
    revokedAt: iso(row.revoked_at),
  };
}

export async function issueAssuranceMetricsCredential(input: {
  accountAddress: string;
  workspaceId: string;
  label: unknown;
  now?: Date;
}) {
  const actor = await requireAssuranceMetricsManagement(input.accountAddress, input.workspaceId);
  const label = validateLabel(input.label);
  const issuedAt = input.now ?? new Date();
  const created = createCredentialToken();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_metrics_credentials
          (credential_id,workspace_id,label,token_hash,status,issued_by,issued_at)
          VALUES (?,?,?,?,'active',?,?)`,
    args: [created.credentialId, input.workspaceId, label, created.tokenHash, actor, issuedAt],
  });
  return {
    credential: credentialFromRow({
      credential_id: created.credentialId,
      workspace_id: input.workspaceId,
      label,
      status: "active",
      issued_by: actor,
      issued_at: issuedAt,
    }),
    token: created.token,
  };
}

export async function listAssuranceMetricsCredentials(input: { accountAddress: string; workspaceId: string }) {
  await requireAssuranceMetricsManagement(input.accountAddress, input.workspaceId);
  const result = await dbClient.execute({
    sql: `SELECT credential_id,workspace_id,label,status,issued_by,issued_at,last_used_at,
                 rotated_from_credential_id,rotated_at,revoked_at
          FROM tokenless_assurance_metrics_credentials
          WHERE workspace_id = ? ORDER BY issued_at DESC, credential_id DESC`,
    args: [input.workspaceId],
  });
  return result.rows.map(row => credentialFromRow(row as Row));
}

export async function rotateAssuranceMetricsCredential(input: {
  accountAddress: string;
  workspaceId: string;
  credentialId: string;
  now?: Date;
}) {
  const actor = await requireAssuranceMetricsManagement(input.accountAddress, input.workspaceId);
  const credentialId = validateCredentialId(input.credentialId);
  const now = input.now ?? new Date();
  const created = createCredentialToken();
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT label FROM tokenless_assurance_metrics_credentials
       WHERE workspace_id = $1 AND credential_id = $2 AND status = 'active' FOR UPDATE`,
      [input.workspaceId, credentialId],
    );
    if (!current.rowCount) {
      throw new TokenlessServiceError("Metrics credential not found.", 404, "metrics_credential_not_found");
    }
    const label = String(current.rows[0].label);
    await client.query(
      `UPDATE tokenless_assurance_metrics_credentials
       SET status = 'rotated', rotated_at = $3
       WHERE workspace_id = $1 AND credential_id = $2`,
      [input.workspaceId, credentialId, now],
    );
    await client.query(
      `INSERT INTO tokenless_assurance_metrics_credentials
       (credential_id,workspace_id,label,token_hash,status,issued_by,issued_at,rotated_from_credential_id)
       VALUES ($1,$2,$3,$4,'active',$5,$6,$7)`,
      [created.credentialId, input.workspaceId, label, created.tokenHash, actor, now, credentialId],
    );
    await client.query("COMMIT");
    return {
      credential: credentialFromRow({
        credential_id: created.credentialId,
        workspace_id: input.workspaceId,
        label,
        status: "active",
        issued_by: actor,
        issued_at: now,
        rotated_from_credential_id: credentialId,
      }),
      token: created.token,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function revokeAssuranceMetricsCredential(input: {
  accountAddress: string;
  workspaceId: string;
  credentialId: string;
  now?: Date;
}) {
  await requireAssuranceMetricsManagement(input.accountAddress, input.workspaceId);
  const result = await dbClient.execute({
    sql: `UPDATE tokenless_assurance_metrics_credentials
          SET status = 'revoked', revoked_at = ?
          WHERE workspace_id = ? AND credential_id = ? AND status = 'active'
          RETURNING credential_id,workspace_id,label,status,issued_by,issued_at,last_used_at,
                    rotated_from_credential_id,rotated_at,revoked_at`,
    args: [input.now ?? new Date(), input.workspaceId, validateCredentialId(input.credentialId)],
  });
  if (!result.rowCount) {
    throw new TokenlessServiceError("Metrics credential not found.", 404, "metrics_credential_not_found");
  }
  return credentialFromRow(result.rows[0] as Row);
}

export async function authenticateAssuranceMetricsCredential(authorization: string | null, now = new Date()) {
  const match = authorization?.match(/^Bearer ([^\s]+)$/);
  const tokenMatch = match?.[1]?.match(TOKEN_PATTERN);
  if (!tokenMatch) throw new TokenlessServiceError("Metrics authentication failed.", 401, "metrics_auth_failed");
  const credentialId = `amc_${tokenMatch[1]}`;
  const result = await dbClient.execute({
    sql: `SELECT credential_id,workspace_id,token_hash,status
          FROM tokenless_assurance_metrics_credentials WHERE credential_id = ? LIMIT 1`,
    args: [credentialId],
  });
  const row = result.rows[0] as Row | undefined;
  const actual = row ? text(row, "token_hash")! : "sha256:" + "0".repeat(64);
  const expected = hashToken(match![1]);
  if (!row || text(row, "status") !== "active" || !safeHashEquals(actual, expected)) {
    throw new TokenlessServiceError("Metrics authentication failed.", 401, "metrics_auth_failed");
  }
  const touched = await dbClient.execute({
    sql: `UPDATE tokenless_assurance_metrics_credentials SET last_used_at = ?
          WHERE credential_id = ? AND status = 'active'`,
    args: [now, credentialId],
  });
  if (!touched.rowCount) {
    throw new TokenlessServiceError("Metrics authentication failed.", 401, "metrics_auth_failed");
  }
  return { credentialId, workspaceId: text(row, "workspace_id")! };
}

export async function collectWorkspaceAssuranceMetrics(input: { workspaceId: string; now?: Date }) {
  const now = input.now ?? new Date();
  const windowStart = new Date(now.getTime() - WINDOW_MS);
  const [totals, scopeResult, anchorResult, overrideResult] = await Promise.all([
    dbClient.execute({
      sql: `SELECT
              (SELECT COUNT(*) FROM tokenless_agent_review_opportunity_transition_events
               WHERE workspace_id = ? AND to_state = 'pending' AND occurred_at >= ?) AS requested,
              (SELECT COUNT(*) FROM tokenless_agent_review_opportunity_transition_events
               WHERE workspace_id = ? AND to_state = 'completed' AND occurred_at >= ?) AS completed,
              (SELECT COUNT(*) FROM tokenless_agent_review_opportunity_lifecycles
               WHERE workspace_id = ? AND state = 'blocked') AS blocked,
              (SELECT COUNT(*) FROM tokenless_agent_review_opportunity_lifecycles
               WHERE workspace_id = ? AND state = 'approval_required') AS approval_required`,
      args: [input.workspaceId, windowStart, input.workspaceId, windowStart, input.workspaceId, input.workspaceId],
    }),
    dbClient.execute({
      sql: `WITH opportunity_counts AS (
              SELECT scope_id, COUNT(*) AS eligible
              FROM tokenless_agent_review_opportunities
              WHERE workspace_id = ? AND created_at >= ? GROUP BY scope_id
            ), transition_counts AS (
              SELECT o.scope_id,
                     SUM(CASE WHEN e.to_state = 'pending' THEN 1 ELSE 0 END) AS requested,
                     SUM(CASE WHEN e.to_state = 'completed' THEN 1 ELSE 0 END) AS completed
              FROM tokenless_agent_review_opportunity_transition_events e
              JOIN tokenless_agent_review_opportunities o
                ON o.workspace_id = e.workspace_id AND o.opportunity_id = e.opportunity_id
              WHERE e.workspace_id = ? AND e.occurred_at >= ? AND o.created_at >= ? GROUP BY o.scope_id
            ), observation_counts AS (
              SELECT scope_id,
                     SUM(CASE WHEN comparable AND agreement IN ('agree','disagree') THEN 1 ELSE 0 END) AS comparable,
                     SUM(CASE WHEN comparable AND agreement = 'disagree' THEN 1 ELSE 0 END) AS disagreements,
                     SUM(CASE WHEN latency_ms IS NOT NULL THEN latency_ms ELSE 0 END) AS latency_milliseconds,
                     SUM(CASE WHEN latency_ms IS NOT NULL THEN 1 ELSE 0 END) AS latency_count
              FROM tokenless_agent_evaluation_observations
              WHERE workspace_id = ? AND finalized_at >= ? GROUP BY scope_id
            ), lifecycle_counts AS (
              SELECT o.scope_id,
                     SUM(CASE WHEN l.state = 'blocked' THEN 1 ELSE 0 END) AS blocked,
                     SUM(CASE WHEN l.state = 'approval_required' THEN 1 ELSE 0 END) AS approval_required
              FROM tokenless_agent_review_opportunity_lifecycles l
              JOIN tokenless_agent_review_opportunities o
                ON o.workspace_id = l.workspace_id AND o.opportunity_id = l.opportunity_id
              WHERE l.workspace_id = ? GROUP BY o.scope_id
            )
            SELECT s.scope_id,s.stage,
                   COALESCE(oc.eligible,0) AS eligible,
                   COALESCE(tc.requested,0) AS requested,
                   COALESCE(tc.completed,0) AS completed,
                   COALESCE(lc.blocked,0) AS blocked,
                   COALESCE(lc.approval_required,0) AS approval_required,
                   COALESCE(ob.comparable,0) AS comparable,
                   COALESCE(ob.disagreements,0) AS disagreements,
                   COALESCE(ob.latency_milliseconds,0) AS latency_milliseconds,
                   COALESCE(ob.latency_count,0) AS latency_count
            FROM tokenless_agent_evaluation_scopes s
            LEFT JOIN opportunity_counts oc ON oc.scope_id = s.scope_id
            LEFT JOIN transition_counts tc ON tc.scope_id = s.scope_id
            LEFT JOIN observation_counts ob ON ob.scope_id = s.scope_id
            LEFT JOIN lifecycle_counts lc ON lc.scope_id = s.scope_id
            WHERE s.workspace_id = ?
              AND (COALESCE(oc.eligible,0) > 0 OR COALESCE(tc.requested,0) > 0 OR COALESCE(tc.completed,0) > 0
                   OR COALESCE(ob.comparable,0) > 0 OR COALESCE(lc.blocked,0) > 0 OR COALESCE(lc.approval_required,0) > 0)
            ORDER BY s.updated_at DESC, s.scope_id
            LIMIT ?`,
      args: [
        input.workspaceId,
        windowStart,
        input.workspaceId,
        windowStart,
        windowStart,
        input.workspaceId,
        windowStart,
        input.workspaceId,
        input.workspaceId,
        MAX_ASSURANCE_METRIC_SCOPES + 1,
      ],
    }),
    dbClient.execute({
      sql: `SELECT state,boundary_at,created_at,completed_at
            FROM tokenless_assurance_attestation_jobs
            WHERE workspace_id=?
            ORDER BY created_at DESC,job_id DESC LIMIT 1`,
      args: [input.workspaceId],
    }),
    dbClient.execute({
      sql: `SELECT record_id, supersedes_record_id, outcome, decided_at
            FROM tokenless_assurance_override_decisions WHERE workspace_id = ?`,
      args: [input.workspaceId],
    }),
  ]);
  const total = totals.rows[0] as Row;
  const rows = scopeResult.rows.slice(0, MAX_ASSURANCE_METRIC_SCOPES) as Row[];
  const scopes = rows.map(row => ({
    scope: text(row, "scope_id")!,
    stage: text(row, "stage") as AssuranceMetricScope["stage"],
    eligible: nonnegative(row, "eligible"),
    requested: nonnegative(row, "requested"),
    completed: nonnegative(row, "completed"),
    blocked: nonnegative(row, "blocked"),
    approvalRequired: nonnegative(row, "approval_required"),
    comparable: nonnegative(row, "comparable"),
    disagreements: nonnegative(row, "disagreements"),
    latencyMilliseconds: nonnegative(row, "latency_milliseconds"),
    latencyCount: nonnegative(row, "latency_count"),
  }));
  const anchor = anchorResult.rows[0] as Row | undefined;
  const anchorState = anchor ? text(anchor, "state") : null;
  const anchorTimestamp =
    anchorState === "completed" ? anchor?.completed_at : (anchor?.boundary_at ?? anchor?.created_at);
  const anchorDate = anchorTimestamp ? new Date(String(anchorTimestamp)) : null;
  if (anchorState !== null && anchorDate === null) {
    throw new Error("Database returned incomplete evidence-anchor timing.");
  }
  if (anchorDate && !Number.isFinite(anchorDate.getTime())) {
    throw new Error("Database returned an invalid evidence-anchor timestamp.");
  }
  const evidenceAnchor: AssuranceMetricsSnapshot["evidenceAnchor"] =
    anchorState === null
      ? { state: "absent", lagSeconds: null }
      : {
          state: anchorState === "completed" ? "completed" : anchorState === "dead" ? "failed" : "pending",
          lagSeconds: Math.max(0, Math.floor((now.getTime() - anchorDate!.getTime()) / 1_000)),
        };
  // Only current (non-superseded) override records inside the window count.
  const overrideRows = overrideResult.rows as Row[];
  const supersededOverrideIds = new Set(
    overrideRows.map(row => text(row, "supersedes_record_id")).filter((value): value is string => value !== null),
  );
  const currentOverrides = overrideRows.filter(row => {
    if (supersededOverrideIds.has(text(row, "record_id")!)) return false;
    const decidedAt = row.decided_at instanceof Date ? row.decided_at : new Date(String(row.decided_at));
    if (!Number.isFinite(decidedAt.getTime())) throw new Error("Database returned an invalid override timestamp.");
    return decidedAt >= windowStart;
  });
  const overridesDecided = currentOverrides.length;
  const overridden = currentOverrides.filter(row => text(row, "outcome") === "overridden").length;
  const reversed = currentOverrides.filter(row => text(row, "outcome") === "reversed").length;
  return {
    windowSeconds: WINDOW_MS / 1_000,
    reviewsRequested: nonnegative(total, "requested"),
    reviewsCompleted: nonnegative(total, "completed"),
    blocked: nonnegative(total, "blocked"),
    approvalRequired: nonnegative(total, "approval_required"),
    scopesTruncated: scopeResult.rows.length > MAX_ASSURANCE_METRIC_SCOPES,
    scopes,
    overrideDecisions: {
      decided: overridesDecided,
      overridden,
      reversed,
      overrideRateBps: overridesDecided > 0 ? Math.floor(((overridden + reversed) * 10_000) / overridesDecided) : null,
    },
    evidenceAnchor,
  } satisfies AssuranceMetricsSnapshot;
}

function label(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll('"', '\\"');
}

function sample(lines: string[], name: string, value: number, labels?: Record<string, string>) {
  const suffix = labels
    ? `{${Object.entries(labels)
        .map(([key, entry]) => `${key}="${label(entry)}"`)
        .join(",")}}`
    : "";
  lines.push(`${name}${suffix} ${value}`);
}

function metric(lines: string[], name: string, help: string, value: number, labels?: Record<string, string>) {
  lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`);
  sample(lines, name, value, labels);
}

export function renderAssuranceOpenMetrics(snapshot: AssuranceMetricsSnapshot) {
  const lines: string[] = [];
  metric(
    lines,
    "rateloop_assurance_metrics_window_seconds",
    "Lookback window represented by assurance metrics.",
    snapshot.windowSeconds,
  );
  metric(
    lines,
    "rateloop_assurance_reviews_requested",
    "Human reviews requested during the metrics window.",
    snapshot.reviewsRequested,
  );
  metric(
    lines,
    "rateloop_assurance_reviews_completed",
    "Human reviews completed during the metrics window.",
    snapshot.reviewsCompleted,
  );
  metric(lines, "rateloop_assurance_blocked", "Review opportunities currently blocked.", snapshot.blocked);
  metric(
    lines,
    "rateloop_assurance_approval_required",
    "Review opportunities currently awaiting owner approval.",
    snapshot.approvalRequired,
  );
  metric(
    lines,
    "rateloop_assurance_scope_series_truncated",
    "Whether scope series exceeded the fixed cardinality limit.",
    snapshot.scopesTruncated ? 1 : 0,
  );
  lines.push(
    "# HELP rateloop_assurance_sampling_rate_ratio Requested reviews divided by eligible outputs in the metrics window.",
    "# TYPE rateloop_assurance_sampling_rate_ratio gauge",
    "# HELP rateloop_assurance_verdict_latency_seconds Mean observed human-verdict latency in seconds.",
    "# TYPE rateloop_assurance_verdict_latency_seconds gauge",
    "# HELP rateloop_assurance_disagreement_ratio Human-agent disagreements divided by comparable observations.",
    "# TYPE rateloop_assurance_disagreement_ratio gauge",
  );
  for (const scope of snapshot.scopes) {
    const labels = { scope: scope.scope, stage: scope.stage };
    if (scope.eligible > 0) {
      sample(lines, "rateloop_assurance_sampling_rate_ratio", scope.requested / scope.eligible, labels);
    }
    if (scope.latencyCount > 0) {
      sample(
        lines,
        "rateloop_assurance_verdict_latency_seconds",
        scope.latencyMilliseconds / scope.latencyCount / 1_000,
        labels,
      );
    }
    if (scope.comparable > 0) {
      sample(lines, "rateloop_assurance_disagreement_ratio", scope.disagreements / scope.comparable, labels);
    }
  }
  lines.push(
    "# HELP rateloop_assurance_evidence_anchor_lag_seconds Age of the latest assurance evidence anchor; absent when no anchor exists.",
    "# TYPE rateloop_assurance_evidence_anchor_lag_seconds gauge",
  );
  sample(lines, "rateloop_assurance_evidence_anchor_lag_seconds", snapshot.evidenceAnchor.lagSeconds ?? Number.NaN, {
    state: snapshot.evidenceAnchor.state,
  });
  lines.push("# EOF");
  return `${lines.join("\n")}\n`;
}

export async function getAuthenticatedAssuranceOpenMetrics(input: { authorization: string | null; now?: Date }) {
  const principal = await authenticateAssuranceMetricsCredential(input.authorization, input.now);
  return renderAssuranceOpenMetrics(
    await collectWorkspaceAssuranceMetrics({ workspaceId: principal.workspaceId, now: input.now }),
  );
}

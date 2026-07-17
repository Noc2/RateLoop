import { createHash } from "node:crypto";
import "server-only";
import { isRateLoopPrincipalId, normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbClient } from "~~/lib/db";
import { appendAuditEvent } from "~~/lib/privacy/audit";
import { DEFAULT_WORKSPACE_ALERT_PREFERENCES } from "~~/lib/tokenless/oversightAlerts";
import { summarizeOversightDesignationsForExport } from "~~/lib/tokenless/oversightAttestations";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;

export const INCIDENT_REPORT_SCHEMA_VERSION = "rateloop.incident-report-draft.v1" as const;
export const OVERSIGHT_CONFIGURATION_SCHEMA_VERSION = "rateloop.oversight-configuration.v1" as const;

/**
 * Both exports carry this label verbatim. The incident export follows the
 * Commission's DRAFT serious-incident reporting template and must be verified
 * against the final template before any regulatory use; neither export claims
 * that a deployment complies with any law.
 */
export const INCIDENT_TEMPLATE_ALIGNMENT_LABEL =
  "Aligned to the Commission's DRAFT serious-incident reporting template (2025 consultation); verify against the " +
  "final template before regulatory use.";

export const RESPONSIBILITY_LINE =
  "Whether a specific deployment meets a legal requirement depends on your system, context, and organization — " +
  "you configure and operate RateLoop for your purpose; RateLoop provides the capabilities and the evidence.";

const MAX_WINDOW_MS = 366 * 86_400_000;
const MAX_ROWS = 2_000;
const INCIDENT_EVENT_TYPES = ["ai.rateloop.gate.blocked", "ai.rateloop.review.failed", "ai.rateloop.review.expired"];

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
  if (encoded === undefined) throw new Error("Incident exports must be JSON serializable.");
  return encoded;
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function iso(value: unknown) {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) throw new Error("Stored incident-export timestamp is invalid.");
  return parsed.toISOString();
}

async function requireWorkspaceManagement(accountAddress: string, workspaceId: string) {
  let actor: string;
  try {
    actor = normalizeAccountSubject(accountAddress);
  } catch {
    throw new TokenlessServiceError("Account address is invalid.", 400, "invalid_account");
  }
  const result = await dbClient.execute({
    sql: `SELECT m.role FROM tokenless_workspace_members m
          JOIN tokenless_workspaces w ON w.workspace_id = m.workspace_id
          WHERE m.workspace_id = ? AND m.account_address = ?
            AND m.role IN ('owner','admin') AND w.status = 'active' LIMIT 1`,
    args: [workspaceId, actor],
  });
  if (!result.rowCount) throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  return actor;
}

function normalizeDescription(value: unknown) {
  if (typeof value !== "string") {
    throw new TokenlessServiceError(
      "An incident description of 1-10000 characters is required.",
      400,
      "invalid_incident_report",
    );
  }
  const description = value.trim();
  if (!description || description.length > 10_000) {
    throw new TokenlessServiceError(
      "An incident description of 1-10000 characters is required.",
      400,
      "invalid_incident_report",
    );
  }
  return description;
}

function normalizeWindow(input: { from?: Date; to?: Date; now: Date }) {
  const end = input.to ?? input.now;
  const start = input.from ?? new Date(end.getTime() - 30 * 86_400_000);
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    end.getTime() <= start.getTime() ||
    end.getTime() - start.getTime() > MAX_WINDOW_MS
  ) {
    throw new TokenlessServiceError(
      "Incident reports require a positive window of at most 366 days.",
      400,
      "invalid_incident_report",
    );
  }
  return { start, end };
}

async function auditExport(input: {
  workspaceId: string;
  actor: string;
  action: string;
  targetKind: string;
  exportDigest: string;
  now: Date;
}) {
  await appendAuditEvent({
    workspaceId: input.workspaceId,
    actorKind: isRateLoopPrincipalId(input.actor) ? "principal" : "account",
    actorReference: input.actor,
    assuranceMethod: "rateloop_session",
    action: input.action,
    targetKind: input.targetKind,
    targetId: input.workspaceId,
    purpose: "workspace_assurance_export",
    reason: "authorized_administrator_export",
    result: "success",
    metadata: { exportDigest: input.exportDigest },
    occurredAt: input.now,
  });
}

/**
 * Draft-template-aligned serious-incident export for a workspace and time
 * window. The owner supplies the incident narrative; RateLoop assembles the
 * factual record around it: the gate/review failure timeline, per-output
 * override decisions (digests and outcomes only — reasons and deciders stay
 * in the workspace), workspace-stop actions, decision-packet references, and
 * retention/WORM evidence references.
 */
export async function buildIncidentReportExport(input: {
  accountAddress: string;
  workspaceId: string;
  description: unknown;
  from?: Date;
  to?: Date;
  now?: Date;
}) {
  const actor = await requireWorkspaceManagement(input.accountAddress, input.workspaceId);
  const description = normalizeDescription(input.description);
  const now = input.now ?? new Date();
  const window = normalizeWindow({ from: input.from, to: input.to, now });
  const [events, overrides, stopState, stopActions, packets, retention, wormReceipts] = await Promise.all([
    dbClient.execute({
      sql: `SELECT event_id, event_type, subject, evidence_reference_kind, evidence_reference_digest, occurred_at
            FROM tokenless_assurance_event_outbox
            WHERE workspace_id = ? AND occurred_at >= ? AND occurred_at < ?
              AND event_type IN (${INCIDENT_EVENT_TYPES.map(() => "?").join(",")})
            ORDER BY occurred_at ASC, event_id ASC LIMIT ${MAX_ROWS}`,
      args: [input.workspaceId, window.start, window.end, ...INCIDENT_EVENT_TYPES],
    }),
    dbClient.execute({
      sql: `SELECT record_id, run_id, supersedes_record_id, outcome, decided_at, record_digest
            FROM tokenless_assurance_override_decisions
            WHERE workspace_id = ? AND decided_at >= ? AND decided_at < ?
            ORDER BY decided_at ASC, record_id ASC LIMIT ${MAX_ROWS}`,
      args: [input.workspaceId, window.start, window.end],
    }),
    dbClient.execute({
      sql: "SELECT status, engaged_at, released_at FROM tokenless_workspace_stop_states WHERE workspace_id = ? LIMIT 1",
      args: [input.workspaceId],
    }),
    dbClient.execute({
      sql: `SELECT action, occurred_at, event_digest FROM tokenless_audit_events
            WHERE workspace_id = ? AND action IN ('workspace.stop_engaged','workspace.stop_released')
              AND occurred_at >= ? AND occurred_at < ?
            ORDER BY sequence ASC LIMIT ${MAX_ROWS}`,
      args: [input.workspaceId, window.start, window.end],
    }),
    dbClient.execute({
      sql: `SELECT p.packet_id, p.run_id, p.packet_digest, p.generated_at
            FROM tokenless_assurance_evidence_packets p
            JOIN tokenless_assurance_runs r ON r.run_id = p.run_id
            JOIN tokenless_assurance_projects pr ON pr.project_id = r.project_id
            WHERE pr.workspace_id = ? AND p.generated_at >= ? AND p.generated_at < ?
            ORDER BY p.generated_at ASC LIMIT ${MAX_ROWS}`,
      args: [input.workspaceId, window.start, window.end],
    }),
    dbClient.execute({
      sql: `SELECT version, evidence_retention_months, audit_retention_months, basis_json, effective_at
            FROM tokenless_workspace_evidence_retention_policies
            WHERE workspace_id = ? AND superseded_at IS NULL LIMIT 1`,
      args: [input.workspaceId],
    }),
    dbClient.execute({
      sql: `SELECT receipt_id, object_version_id, checksum_sha256, object_lock_mode, retention_until, delivered_at
            FROM tokenless_assurance_worm_export_receipts
            WHERE workspace_id = ? ORDER BY delivered_at DESC LIMIT 50`,
      args: [input.workspaceId],
    }),
  ]);
  const retentionRow = retention.rows[0] as Row | undefined;
  const stopRow = stopState.rows[0] as Row | undefined;
  const payload = {
    schemaVersion: INCIDENT_REPORT_SCHEMA_VERSION,
    templateAlignment: {
      label: INCIDENT_TEMPLATE_ALIGNMENT_LABEL,
      basis: "eu_ai_act_article_73_draft_template_2025_consultation",
    },
    responsibility: RESPONSIBILITY_LINE,
    workspaceId: input.workspaceId,
    preparedAt: now.toISOString(),
    window: { startInclusive: window.start.toISOString(), endExclusive: window.end.toISOString() },
    incident: {
      // Section: description of the serious incident (owner-supplied).
      narrative: description,
    },
    eventTimeline: (events.rows as Row[]).map(row => ({
      eventId: text(row, "event_id")!,
      eventType: text(row, "event_type")!,
      subject: text(row, "subject")!,
      evidenceReferenceKind: text(row, "evidence_reference_kind")!,
      evidenceReferenceDigest: text(row, "evidence_reference_digest")!,
      occurredAt: iso(row.occurred_at),
    })),
    // Section: measures taken — recorded human decisions about outputs.
    overrideDecisions: (overrides.rows as Row[]).map(row => ({
      recordId: text(row, "record_id")!,
      runId: text(row, "run_id")!,
      outcome: text(row, "outcome")!,
      supersedesRecordId: text(row, "supersedes_record_id"),
      decidedAt: iso(row.decided_at),
      recordDigest: text(row, "record_digest")!,
    })),
    workspaceStop: {
      currentStatus: stopRow ? text(stopRow, "status") : null,
      engagedAt: stopRow?.engaged_at ? iso(stopRow.engaged_at) : null,
      releasedAt: stopRow?.released_at ? iso(stopRow.released_at) : null,
      actions: (stopActions.rows as Row[]).map(row => ({
        action: text(row, "action")!,
        occurredAt: iso(row.occurred_at),
        auditEventDigest: text(row, "event_digest")!,
      })),
    },
    decisionPacketReferences: (packets.rows as Row[]).map(row => ({
      packetId: text(row, "packet_id")!,
      runId: text(row, "run_id")!,
      packetDigest: text(row, "packet_digest"),
      generatedAt: iso(row.generated_at),
    })),
    retention: retentionRow
      ? {
          policyVersion: Number(retentionRow.version),
          evidenceRetentionMonths: Number(retentionRow.evidence_retention_months),
          auditRetentionMonths: Number(retentionRow.audit_retention_months),
          effectiveAt: iso(retentionRow.effective_at),
        }
      : null,
    wormReferences: (wormReceipts.rows as Row[]).map(row => ({
      receiptId: text(row, "receipt_id")!,
      objectVersionId: text(row, "object_version_id")!,
      checksumSha256: text(row, "checksum_sha256")!,
      objectLockMode: text(row, "object_lock_mode")!,
      retentionUntil: iso(row.retention_until),
      deliveredAt: iso(row.delivered_at),
    })),
    counts: {
      timelineEvents: events.rows.length,
      overrideDecisions: overrides.rows.length,
      stopActions: stopActions.rows.length,
      decisionPackets: packets.rows.length,
      wormReferences: wormReceipts.rows.length,
    },
  };
  const exported = { ...payload, exportDigest: sha256(payload) };
  await auditExport({
    workspaceId: input.workspaceId,
    actor,
    action: "oversight.incident_report_export",
    targetKind: "incident_report",
    exportDigest: exported.exportDigest,
    now,
  });
  return exported;
}

/**
 * FRIA hook: the workspace's oversight configuration as a factual "description
 * of the implementation of human oversight measures" input for an Article 27
 * fundamental-rights impact assessment. It describes what is configured — it
 * does not assert that any legal requirement is met.
 */
export async function exportOversightConfiguration(input: { accountAddress: string; workspaceId: string; now?: Date }) {
  const actor = await requireWorkspaceManagement(input.accountAddress, input.workspaceId);
  const now = input.now ?? new Date();
  const [policies, designations, stopState, alertPreferences, publishingPolicies] = await Promise.all([
    dbClient.execute({
      sql: `SELECT policy_id, version, mode, enabled, agreement_threshold_bps, production_floor_bps,
                   fixed_rate_bps, maximum_unreviewed_gap
            FROM tokenless_agent_review_policies WHERE workspace_id = ?
            ORDER BY policy_id ASC, version DESC LIMIT ${MAX_ROWS}`,
      args: [input.workspaceId],
    }),
    dbClient.execute({
      sql: `SELECT account_address, authority_scope, status, attested_at, expires_at, training_records_json
            FROM tokenless_oversight_attestations WHERE workspace_id = ? ORDER BY account_address ASC`,
      args: [input.workspaceId],
    }),
    dbClient.execute({
      sql: "SELECT status, reason, engaged_at, released_at FROM tokenless_workspace_stop_states WHERE workspace_id = ? LIMIT 1",
      args: [input.workspaceId],
    }),
    dbClient.execute({
      sql: "SELECT * FROM tokenless_workspace_alert_preferences WHERE workspace_id = ? LIMIT 1",
      args: [input.workspaceId],
    }),
    dbClient.execute({
      sql: `SELECT COUNT(*) AS total,
                   SUM(CASE WHEN enabled AND revoked_at IS NULL THEN 1 ELSE 0 END) AS active
            FROM tokenless_agent_publishing_policies WHERE workspace_id = ?`,
      args: [input.workspaceId],
    }),
  ]);
  const stopRow = stopState.rows[0] as Row | undefined;
  const alertRow = alertPreferences.rows[0] as Row | undefined;
  const publishingRow = publishingPolicies.rows[0] as Row | undefined;
  const payload = {
    schemaVersion: OVERSIGHT_CONFIGURATION_SCHEMA_VERSION,
    purpose:
      "Description of the configured human-oversight measures in this workspace, usable as an input to a " +
      "fundamental-rights impact assessment. It records configuration, not legal conclusions.",
    responsibility: RESPONSIBILITY_LINE,
    workspaceId: input.workspaceId,
    exportedAt: now.toISOString(),
    outputGate: {
      safeState:
        "Eligible agent outputs are held undelivered by default; a host-enforced integration may release an " +
        "output only after signed gate evidence shows a releasable lifecycle state.",
      workspaceStop:
        "One audited owner/admin action revokes every automatic publishing grant and active review continuation " +
        "and blocks new evaluations and releases; releasing the stop restores no authority automatically.",
    },
    reviewPolicies: (policies.rows as Row[]).map(row => ({
      policyId: text(row, "policy_id")!,
      version: Number(row.version),
      mode: text(row, "mode")!,
      enabled: row.enabled === true || row.enabled === "t",
      agreementThresholdBps: Number(row.agreement_threshold_bps ?? 0),
      productionFloorBps: Number(row.production_floor_bps ?? 0),
      fixedRateBps: row.fixed_rate_bps === null || row.fixed_rate_bps === undefined ? null : Number(row.fixed_rate_bps),
      maximumUnreviewedGap: Number(row.maximum_unreviewed_gap ?? 0),
    })),
    oversightDesignations: summarizeOversightDesignationsForExport(designations.rows as Row[], now),
    stopControl: {
      status: stopRow ? text(stopRow, "status") : "never_engaged",
      engagedAt: stopRow?.engaged_at ? iso(stopRow.engaged_at) : null,
      releasedAt: stopRow?.released_at ? iso(stopRow.released_at) : null,
    },
    alertPreferences: {
      gateBlocked: alertRow ? alertRow.gate_blocked === true : DEFAULT_WORKSPACE_ALERT_PREFERENCES.gateBlocked,
      reviewFailed: alertRow ? alertRow.review_failed === true : DEFAULT_WORKSPACE_ALERT_PREFERENCES.reviewFailed,
      workspaceStop: alertRow ? alertRow.workspace_stop === true : DEFAULT_WORKSPACE_ALERT_PREFERENCES.workspaceStop,
      coverageFloorHit: alertRow
        ? alertRow.coverage_floor_hit === true
        : DEFAULT_WORKSPACE_ALERT_PREFERENCES.coverageFloorHit,
      disagreementSpikeBps: alertRow
        ? alertRow.disagreement_spike_bps === null || alertRow.disagreement_spike_bps === undefined
          ? null
          : Number(alertRow.disagreement_spike_bps)
        : DEFAULT_WORKSPACE_ALERT_PREFERENCES.disagreementSpikeBps,
      browserEnabled: alertRow ? alertRow.browser_enabled === true : DEFAULT_WORKSPACE_ALERT_PREFERENCES.browserEnabled,
    },
    decisionControls: {
      clientDecision: "go_revise_stop_behind_decision_gate",
      overrideRecording: "append_only_per_output_records_with_mandatory_reasons",
      explanationSampling: "deterministic_low_rate_sample_requires_reasons_even_for_go",
    },
    publishingPolicies: {
      total: Number(publishingRow?.total ?? 0),
      active: Number(publishingRow?.active ?? 0),
    },
  };
  const exported = { ...payload, exportDigest: sha256(payload) };
  await auditExport({
    workspaceId: input.workspaceId,
    actor,
    action: "oversight.configuration_export",
    targetKind: "oversight_configuration",
    exportDigest: exported.exportDigest,
    now,
  });
  return exported;
}

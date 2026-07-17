import { createHash, createHmac } from "node:crypto";
import "server-only";
import { dbClient, dbPool } from "~~/lib/db";
import { appendAuditEvent } from "~~/lib/privacy/audit";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import {
  type ResolveHostname,
  type WebhookFetch,
  assertPublicWebhookDestination,
  createWorkspaceWebhook,
  deactivateWorkspaceWebhook,
  decryptWebhookSigningSecret,
  deliverOverPinnedAddress,
  listWorkspaceWebhooks,
  stableTransparencyJson,
} from "~~/lib/tokenless/transparency";

const HASH = /^sha256:[0-9a-f]{64}$/;
const TRANSACTION_HASH = /^0x[0-9a-f]{64}$/;
const SOURCE_EVENT_ID = /^[A-Za-z0-9._:/-]{1,200}$/;
const MAX_DELIVERY_ATTEMPTS = 8;
const DELIVERY_LEASE_MS = 60_000;
const OCSF_VERSION = "1.8.0";
const EVENT_PROJECTION_AUDIT_ACTION = "assurance.siem_event.projected";
const EVENT_PROJECTION_AUDIT_TARGET = "assurance_lifecycle_source";

export const ASSURANCE_EVENT_TYPES = [
  "ai.rateloop.review.completed",
  "ai.rateloop.review.failed",
  "ai.rateloop.review.expired",
  "ai.rateloop.packet.anchored",
  "ai.rateloop.gate.blocked",
] as const;

/** Terminal-failure reason codes that mark an opportunity as expired rather than failed. */
export const REVIEW_EXPIRY_REASON_CODES = ["response_deadline_elapsed", "all_assignments_expired"] as const;

export type AssuranceEventType = (typeof ASSURANCE_EVENT_TYPES)[number];

export type AssuranceEvidenceChainReference = {
  schemaVersion: "rateloop.audit-chain-reference.v1";
  eventHash: string;
  previousHash: string | null;
  sequence: number;
  externalAnchor?: {
    chainId: number;
    transactionHash: string;
    blockNumber: string;
  };
};

type Row = Record<string, unknown>;

export type AssuranceEvidenceReference =
  | {
      schemaVersion: "rateloop.assurance-event-reference.v1";
      kind: "decision_packet";
      digest: string;
    }
  | {
      schemaVersion: "rateloop.assurance-event-reference.v1";
      kind: "gate_transition";
      digest: string;
    };

type AssuranceLifecycleEventSource = {
  workspaceId: string;
  sourceEventId: string;
  eventType: AssuranceEventType;
  subject: string;
  evidenceReference: AssuranceEvidenceReference;
  occurredAt: Date;
};

type CloudEvent = {
  specversion: "1.0";
  id: string;
  source: string;
  type: AssuranceEventType;
  subject: string;
  time: string;
  datacontenttype: "application/json";
  dataschema: "urn:rateloop:schema:assurance-event:v2";
  rateloopevidencekind: AssuranceEvidenceReference["kind"];
  rateloopevidencedigest: string;
  ratelooppackethash?: string;
  rateloopchainhash: string;
  data: {
    schemaVersion: "rateloop.assurance-event.v2";
    evidenceReference: AssuranceEvidenceReference;
    packetHash?: string;
    evidenceChain: AssuranceEvidenceChainReference;
    ocsf: OcsfComplianceFinding;
  };
};

type OcsfComplianceFinding = {
  activity_id: 1 | 2 | 3;
  activity_name: "Create" | "Update" | "Close";
  category_name: "Findings";
  category_uid: 2;
  class_name: "Compliance Finding";
  class_uid: 2003;
  finding_info: {
    created_time: number;
    title: string;
    types: [AssuranceEventType];
    uid: string;
  };
  metadata: {
    product: { name: "RateLoop Human Assurance"; uid: "rateloop-human-assurance"; vendor_name: "RateLoop" };
    uid: string;
    version: typeof OCSF_VERSION;
  };
  severity: "Informational" | "High";
  severity_id: 1 | 4;
  status: "New" | "Resolved";
  status_id: 1 | 4;
  time: number;
  type_uid: 200301 | 200302 | 200303;
  unmapped: {
    rateloop_evidence_chain: AssuranceEvidenceChainReference;
    rateloop_evidence_reference: AssuranceEvidenceReference;
    rateloop_packet_hash?: string;
  };
};

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function deterministicId(prefix: "aev" | "aed", value: string) {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 40)}`;
}

function eventType(value: unknown): AssuranceEventType {
  if (!ASSURANCE_EVENT_TYPES.includes(value as AssuranceEventType)) {
    throw new TokenlessServiceError("Assurance event type is invalid.", 400, "invalid_assurance_event");
  }
  return value as AssuranceEventType;
}

function packetHash(value: unknown) {
  if (typeof value !== "string" || !HASH.test(value)) {
    throw new TokenlessServiceError("A canonical packet hash is required.", 400, "invalid_assurance_event");
  }
  return value;
}

function assuranceEvidenceReference(value: AssuranceEvidenceReference): AssuranceEvidenceReference {
  if (
    !value ||
    value.schemaVersion !== "rateloop.assurance-event-reference.v1" ||
    !["decision_packet", "gate_transition"].includes(value.kind) ||
    typeof value.digest !== "string" ||
    !HASH.test(value.digest)
  ) {
    throw new TokenlessServiceError("Assurance evidence reference is invalid.", 400, "invalid_assurance_event");
  }
  return value;
}

function evidenceChain(value: AssuranceEvidenceChainReference): AssuranceEvidenceChainReference {
  if (
    !value ||
    value.schemaVersion !== "rateloop.audit-chain-reference.v1" ||
    !HASH.test(value.eventHash) ||
    (value.previousHash !== null && !HASH.test(value.previousHash)) ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 0
  ) {
    throw new TokenlessServiceError("Evidence chain reference is invalid.", 400, "invalid_assurance_event");
  }
  if (
    value.externalAnchor &&
    (!Number.isSafeInteger(value.externalAnchor.chainId) ||
      value.externalAnchor.chainId < 1 ||
      !TRANSACTION_HASH.test(value.externalAnchor.transactionHash) ||
      !/^(?:0|[1-9][0-9]*)$/.test(value.externalAnchor.blockNumber))
  ) {
    throw new TokenlessServiceError("External chain reference is invalid.", 400, "invalid_assurance_event");
  }
  return value;
}

function sourceEventId(value: unknown) {
  if (typeof value !== "string" || !SOURCE_EVENT_ID.test(value)) {
    throw new TokenlessServiceError("Event reference is invalid.", 400, "invalid_assurance_event");
  }
  return value;
}

function validDate(value: unknown, field: string) {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) throw new Error(`Stored ${field} is invalid.`);
  return parsed;
}

function nonNegativeInteger(value: unknown, field: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Stored ${field} is invalid.`);
  return parsed;
}

function lifecycleSourceFromRow(row: Row): AssuranceLifecycleEventSource {
  return {
    workspaceId: text(row, "workspace_id")!,
    sourceEventId: sourceEventId(text(row, "source_event_id")),
    eventType: eventType(text(row, "event_type")),
    subject: sourceEventId(text(row, "subject")),
    evidenceReference: assuranceEvidenceReference({
      schemaVersion: "rateloop.assurance-event-reference.v1",
      kind: text(row, "evidence_reference_kind") as AssuranceEvidenceReference["kind"],
      digest: text(row, "evidence_reference_digest")!,
    }),
    occurredAt: validDate(row.occurred_at, "assurance event time"),
  };
}

/**
 * A terminal failure whose recorded reasons include an expiry signal projects
 * as `review.expired`; every other terminal failure projects as `review.failed`.
 */
export function terminalFailureEventType(reasonCodesJson: unknown): AssuranceEventType {
  let reasons: unknown;
  try {
    reasons = JSON.parse(String(reasonCodesJson ?? "[]"));
  } catch {
    reasons = [];
  }
  const expired =
    Array.isArray(reasons) &&
    reasons.some(reason => (REVIEW_EXPIRY_REASON_CODES as readonly string[]).includes(String(reason)));
  return expired ? "ai.rateloop.review.expired" : "ai.rateloop.review.failed";
}

function evidenceChainFromAuditRow(row: Row): AssuranceEvidenceChainReference {
  return evidenceChain({
    schemaVersion: "rateloop.audit-chain-reference.v1",
    eventHash: text(row, "event_digest")!,
    previousHash: text(row, "previous_digest"),
    sequence: nonNegativeInteger(row.sequence, "audit sequence"),
  });
}

/** Event types whose evidence is a gate transition rather than a decision packet. */
const GATE_TRANSITION_EVENT_TYPES = new Set<AssuranceEventType>([
  "ai.rateloop.gate.blocked",
  "ai.rateloop.review.failed",
  "ai.rateloop.review.expired",
]);

function eventDefinition(type: AssuranceEventType) {
  switch (type) {
    case "ai.rateloop.review.failed":
      return {
        activityId: 3 as const,
        activityName: "Close" as const,
        severity: "High" as const,
        severityId: 4 as const,
        status: "Resolved" as const,
        statusId: 4 as const,
        title: "Human assurance review reached terminal failure",
        typeUid: 200303 as const,
      };
    case "ai.rateloop.review.expired":
      return {
        activityId: 3 as const,
        activityName: "Close" as const,
        severity: "High" as const,
        severityId: 4 as const,
        status: "Resolved" as const,
        statusId: 4 as const,
        title: "Human assurance review expired before completion",
        typeUid: 200303 as const,
      };
    case "ai.rateloop.gate.blocked":
      return {
        activityId: 1 as const,
        activityName: "Create" as const,
        severity: "High" as const,
        severityId: 4 as const,
        status: "New" as const,
        statusId: 1 as const,
        title: "Human assurance gate blocked an output",
        typeUid: 200301 as const,
      };
    case "ai.rateloop.packet.anchored":
      return {
        activityId: 2 as const,
        activityName: "Update" as const,
        severity: "Informational" as const,
        severityId: 1 as const,
        status: "Resolved" as const,
        statusId: 4 as const,
        title: "Human assurance packet received an external anchor",
        typeUid: 200302 as const,
      };
    case "ai.rateloop.review.completed":
      return {
        activityId: 3 as const,
        activityName: "Close" as const,
        severity: "Informational" as const,
        severityId: 1 as const,
        status: "Resolved" as const,
        statusId: 4 as const,
        title: "Human assurance review completed",
        typeUid: 200303 as const,
      };
  }
}

export function buildAssuranceCloudEvent(input: {
  workspaceId: string;
  sourceEventId: string;
  eventType: AssuranceEventType;
  subject?: string;
  evidenceReference: AssuranceEvidenceReference;
  evidenceChain: AssuranceEvidenceChainReference;
  occurredAt: Date;
}) {
  const type = eventType(input.eventType);
  const sourceId = sourceEventId(input.sourceEventId);
  const reference = assuranceEvidenceReference(input.evidenceReference);
  if (!GATE_TRANSITION_EVENT_TYPES.has(type) && reference.kind !== "decision_packet") {
    throw new TokenlessServiceError(
      "Completed and anchored events require a decision-packet reference.",
      400,
      "invalid_assurance_event",
    );
  }
  if (GATE_TRANSITION_EVENT_TYPES.has(type) && reference.kind !== "gate_transition") {
    throw new TokenlessServiceError(
      "Blocked, failed, and expired events require a gate-transition reference.",
      400,
      "invalid_assurance_event",
    );
  }
  const packet = reference.kind === "decision_packet" ? packetHash(reference.digest) : undefined;
  const chain = evidenceChain(input.evidenceChain);
  if (!input.workspaceId.trim()) {
    throw new TokenlessServiceError("Workspace is required.", 400, "invalid_assurance_event");
  }
  if (!Number.isFinite(input.occurredAt.getTime())) {
    throw new TokenlessServiceError("Event time is invalid.", 400, "invalid_assurance_event");
  }
  const subject = sourceEventId(input.subject ?? sourceId);
  const id = deterministicId("aev", stableTransparencyJson({ sourceId, type, workspaceId: input.workspaceId }));
  const definition = eventDefinition(type);
  const time = input.occurredAt.getTime();
  const ocsf: OcsfComplianceFinding = {
    activity_id: definition.activityId,
    activity_name: definition.activityName,
    category_name: "Findings",
    category_uid: 2,
    class_name: "Compliance Finding",
    class_uid: 2003,
    finding_info: {
      created_time: time,
      title: definition.title,
      types: [type],
      uid: id,
    },
    metadata: {
      product: { name: "RateLoop Human Assurance", uid: "rateloop-human-assurance", vendor_name: "RateLoop" },
      uid: id,
      version: OCSF_VERSION,
    },
    severity: definition.severity,
    severity_id: definition.severityId,
    status: definition.status,
    status_id: definition.statusId,
    time,
    type_uid: definition.typeUid,
    unmapped: {
      rateloop_evidence_chain: chain,
      rateloop_evidence_reference: reference,
      ...(packet ? { rateloop_packet_hash: packet } : {}),
    },
  };
  const event: CloudEvent = {
    specversion: "1.0",
    id,
    source: `urn:rateloop:assurance:workspace:${encodeURIComponent(input.workspaceId)}`,
    type,
    subject,
    time: input.occurredAt.toISOString(),
    datacontenttype: "application/json",
    dataschema: "urn:rateloop:schema:assurance-event:v2",
    rateloopevidencekind: reference.kind,
    rateloopevidencedigest: reference.digest,
    ...(packet ? { ratelooppackethash: packet } : {}),
    rateloopchainhash: chain.eventHash,
    data: {
      schemaVersion: "rateloop.assurance-event.v2",
      evidenceReference: reference,
      ...(packet ? { packetHash: packet } : {}),
      evidenceChain: chain,
      ocsf,
    },
  };
  return { event, ocsf };
}

export async function createAssuranceEventStream(input: {
  accountAddress: string;
  workspaceId: string;
  url: string;
  eventTypes: AssuranceEventType[];
  encryptionKey?: string;
  resolveHostname?: ResolveHostname;
}) {
  if (
    !Array.isArray(input.eventTypes) ||
    input.eventTypes.length === 0 ||
    input.eventTypes.some(type => !ASSURANCE_EVENT_TYPES.includes(type))
  ) {
    throw new TokenlessServiceError("Assurance event types are invalid.", 400, "invalid_assurance_event_stream");
  }
  return createWorkspaceWebhook(input);
}

export async function listAssuranceEventStreams(input: { accountAddress: string; workspaceId: string }) {
  const endpoints = await listWorkspaceWebhooks(input);
  return endpoints.filter(endpoint =>
    endpoint.eventTypes.some((type: string) => ASSURANCE_EVENT_TYPES.includes(type as AssuranceEventType)),
  );
}

export async function deactivateAssuranceEventStream(input: {
  accountAddress: string;
  workspaceId: string;
  endpointId: string;
}) {
  const streams = await listAssuranceEventStreams({
    accountAddress: input.accountAddress,
    workspaceId: input.workspaceId,
  });
  if (!streams.some(stream => stream.endpointId === input.endpointId && stream.active)) {
    throw new TokenlessServiceError("Event stream not found.", 404, "assurance_event_stream_not_found");
  }
  await deactivateWorkspaceWebhook(input);
}

export async function enqueueAssuranceEvent(input: {
  workspaceId: string;
  sourceEventId: string;
  eventType: AssuranceEventType;
  subject?: string;
  evidenceReference: AssuranceEvidenceReference;
  evidenceChain: AssuranceEvidenceChainReference;
  occurredAt: Date;
  now?: Date;
}) {
  const { event, ocsf } = buildAssuranceCloudEvent(input);
  const cloudEventJson = stableTransparencyJson(event);
  const ocsfJson = stableTransparencyJson(ocsf);
  const chainJson = stableTransparencyJson(event.data.evidenceChain);
  const payloadHash = sha256(cloudEventJson);
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new TokenlessServiceError("Queue time is invalid.", 400, "invalid_assurance_event");
  }
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const workspace = await client.query(
      "SELECT workspace_id FROM tokenless_workspaces WHERE workspace_id = $1 AND status = 'active' LIMIT 1",
      [input.workspaceId],
    );
    if (!workspace.rowCount) {
      throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
    }
    const replayCandidate = await client.query(
      `SELECT event_id,payload_hash FROM tokenless_assurance_event_outbox
       WHERE workspace_id=$1 AND event_type=$2 AND source_event_id=$3 LIMIT 1 FOR UPDATE`,
      [input.workspaceId, event.type, input.sourceEventId],
    );
    if (replayCandidate.rowCount) {
      if (text(replayCandidate.rows[0] as Row, "payload_hash") !== payloadHash) {
        throw new TokenlessServiceError(
          "The source event ID is already bound to different evidence.",
          409,
          "assurance_event_conflict",
        );
      }
      await client.query("COMMIT");
      return { eventId: text(replayCandidate.rows[0] as Row, "event_id")!, deliveryCount: 0, replay: true };
    }
    const inserted = await client.query(
      `INSERT INTO tokenless_assurance_event_outbox
       (event_id,workspace_id,source_event_id,event_type,subject,packet_hash,evidence_reference_kind,
       evidence_reference_digest,evidence_chain_json,cloud_event_json,ocsf_event_json,payload_hash,occurred_at,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (workspace_id,event_type,source_event_id) DO NOTHING
       RETURNING event_id`,
      [
        event.id,
        input.workspaceId,
        input.sourceEventId,
        event.type,
        event.subject,
        event.data.packetHash ?? null,
        event.data.evidenceReference.kind,
        event.data.evidenceReference.digest,
        chainJson,
        cloudEventJson,
        ocsfJson,
        payloadHash,
        input.occurredAt,
        now,
      ],
    );
    if (inserted.rows.length === 0) {
      const existing = await client.query(
        `SELECT event_id,payload_hash FROM tokenless_assurance_event_outbox
         WHERE workspace_id=$1 AND event_type=$2 AND source_event_id=$3 LIMIT 1`,
        [input.workspaceId, event.type, input.sourceEventId],
      );
      if (text(existing.rows[0] as Row | undefined, "payload_hash") !== payloadHash) {
        throw new TokenlessServiceError(
          "The source event ID is already bound to different evidence.",
          409,
          "assurance_event_conflict",
        );
      }
      await client.query("COMMIT");
      return { eventId: text(existing.rows[0] as Row, "event_id")!, deliveryCount: 0, replay: true };
    }

    const endpoints = await client.query(
      `SELECT endpoint_id,event_types_json FROM tokenless_webhook_endpoints
       WHERE workspace_id=$1 AND active=true ORDER BY endpoint_id ASC`,
      [input.workspaceId],
    );
    let deliveryCount = 0;
    for (const row of endpoints.rows as Row[]) {
      const configured = JSON.parse(text(row, "event_types_json") ?? "[]") as unknown;
      if (!Array.isArray(configured) || !configured.includes(event.type)) continue;
      const endpointId = text(row, "endpoint_id")!;
      const deliveryId = deterministicId("aed", `${event.id}:${endpointId}`);
      const delivery = await client.query(
        `INSERT INTO tokenless_assurance_event_deliveries
         (delivery_id,event_id,endpoint_id,idempotency_key,attempt_count,state,next_attempt_at,
          created_at,updated_at)
         VALUES ($1,$2,$3,$1,0,'pending',$4,$4,$4)
         ON CONFLICT (event_id,endpoint_id) DO NOTHING
         RETURNING delivery_id`,
        [deliveryId, event.id, endpointId, now],
      );
      deliveryCount += delivery.rows.length;
    }
    await client.query("COMMIT");
    return { eventId: event.id, deliveryCount, replay: false };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function findProjectionAuditChain(source: AssuranceLifecycleEventSource) {
  const result = await dbClient.execute({
    sql: `SELECT event_digest,previous_digest,sequence
          FROM tokenless_audit_events
          WHERE workspace_id=? AND action=? AND target_kind=? AND target_id=?
          ORDER BY sequence ASC LIMIT 1`,
    args: [source.workspaceId, EVENT_PROJECTION_AUDIT_ACTION, EVENT_PROJECTION_AUDIT_TARGET, source.sourceEventId],
  });
  return result.rows[0] ? evidenceChainFromAuditRow(result.rows[0] as Row) : null;
}

async function projectAssuranceLifecycleEvent(source: AssuranceLifecycleEventSource, now: Date) {
  const lockKey = ["rateloop", "assurance-event", source.workspaceId, source.eventType, source.sourceEventId].join(":");
  const lockClient = await dbPool.connect();
  let locked = false;
  try {
    await lockClient.query("SELECT pg_advisory_lock(hashtext($1))", [lockKey]);
    locked = true;
    const existing = await dbClient.execute({
      sql: `SELECT event_id FROM tokenless_assurance_event_outbox
            WHERE workspace_id=? AND event_type=? AND source_event_id=? LIMIT 1`,
      args: [source.workspaceId, source.eventType, source.sourceEventId],
    });
    if (existing.rows[0]) {
      return { eventId: text(existing.rows[0] as Row, "event_id")!, state: "replayed" as const };
    }

    let chain = await findProjectionAuditChain(source);
    if (!chain) {
      const appended = await appendAuditEvent({
        workspaceId: source.workspaceId,
        actorKind: "system",
        actorReference: "rateloop:assurance-event-projector",
        assuranceMethod: "scheduled_lifecycle_projection",
        action: EVENT_PROJECTION_AUDIT_ACTION,
        targetKind: EVENT_PROJECTION_AUDIT_TARGET,
        targetId: source.sourceEventId,
        purpose: "compliance_evidence_delivery",
        reason: "projected_assurance_lifecycle_event",
        requestCorrelation: source.sourceEventId,
        result: "success",
        metadata: {
          eventType: source.eventType,
          evidenceReferenceDigest: source.evidenceReference.digest,
          evidenceReferenceKind: source.evidenceReference.kind,
          sourceOccurredAt: source.occurredAt.toISOString(),
          subject: source.subject,
        },
        occurredAt: now,
      });
      chain = evidenceChain({
        schemaVersion: "rateloop.audit-chain-reference.v1",
        eventHash: appended.eventDigest,
        previousHash: appended.previousDigest,
        sequence: appended.sequence,
      });
    }
    const queued = await enqueueAssuranceEvent({
      ...source,
      evidenceChain: chain,
      now,
    });
    return { eventId: queued.eventId, state: queued.replay ? ("replayed" as const) : ("projected" as const) };
  } finally {
    if (locked) {
      try {
        await lockClient.query("SELECT pg_advisory_unlock(hashtext($1))", [lockKey]);
      } catch (error) {
        lockClient.release(error as Error);
        throw error;
      }
    }
    lockClient.release();
  }
}

export async function projectAssuranceLifecycleEvents(
  input: { now?: Date; limit?: number; workspaceId?: string } = {},
) {
  const now = validDate(input.now ?? new Date(), "projection time");
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const workspaceFilter = input.workspaceId ? "AND t.workspace_id=?" : "";
  const anchorWorkspaceFilter = input.workspaceId ? "AND j.workspace_id=?" : "";
  const [completedTransitions, blockedTransitions, failedTransitions, anchors, deferred] = await Promise.all([
    dbClient.execute({
      sql: `SELECT t.event_id AS source_event_id,t.workspace_id,t.opportunity_id AS subject,
                   'decision_packet' AS evidence_reference_kind,
                   p.packet_digest AS evidence_reference_digest,t.occurred_at,
                   'ai.rateloop.review.completed' AS event_type
            FROM tokenless_agent_review_opportunity_transition_events t
            JOIN tokenless_agent_review_opportunities o
              ON o.workspace_id=t.workspace_id AND o.opportunity_id=t.opportunity_id
            JOIN tokenless_assurance_runs r ON r.run_id=o.run_id
            JOIN tokenless_assurance_projects pr
              ON pr.project_id=r.project_id AND pr.workspace_id=t.workspace_id
            JOIN tokenless_assurance_evidence_packets p
              ON p.run_id=r.run_id AND p.packet_digest IS NOT NULL
            LEFT JOIN tokenless_assurance_event_outbox e
              ON e.workspace_id=t.workspace_id AND e.source_event_id=t.event_id
             AND e.event_type='ai.rateloop.review.completed'
            WHERE t.to_state='completed' AND e.event_id IS NULL ${workspaceFilter}
            ORDER BY t.occurred_at ASC,t.event_id ASC LIMIT ?`,
      args: [...(input.workspaceId ? [input.workspaceId] : []), limit],
    }),
    dbClient.execute({
      sql: `SELECT t.event_id AS source_event_id,t.workspace_id,t.opportunity_id AS subject,
                   'gate_transition' AS evidence_reference_kind,
                   t.transition_commitment AS evidence_reference_digest,t.occurred_at,
                   'ai.rateloop.gate.blocked' AS event_type
            FROM tokenless_agent_review_opportunity_transition_events t
            JOIN tokenless_agent_review_opportunities o
              ON o.workspace_id=t.workspace_id AND o.opportunity_id=t.opportunity_id
            LEFT JOIN tokenless_assurance_event_outbox e
              ON e.workspace_id=t.workspace_id AND e.source_event_id=t.event_id
             AND e.event_type='ai.rateloop.gate.blocked'
            WHERE t.to_state='blocked' AND e.event_id IS NULL ${workspaceFilter}
            ORDER BY t.occurred_at ASC,t.event_id ASC LIMIT ?`,
      args: [...(input.workspaceId ? [input.workspaceId] : []), limit],
    }),
    dbClient.execute({
      sql: `SELECT t.event_id AS source_event_id,t.workspace_id,t.opportunity_id AS subject,
                   'gate_transition' AS evidence_reference_kind,
                   t.transition_commitment AS evidence_reference_digest,t.occurred_at,
                   t.reason_codes_json
            FROM tokenless_agent_review_opportunity_transition_events t
            JOIN tokenless_agent_review_opportunities o
              ON o.workspace_id=t.workspace_id AND o.opportunity_id=t.opportunity_id
            LEFT JOIN tokenless_assurance_event_outbox e
              ON e.workspace_id=t.workspace_id AND e.source_event_id=t.event_id
             AND e.event_type IN ('ai.rateloop.review.failed','ai.rateloop.review.expired')
            WHERE t.to_state='failed_terminal' AND e.event_id IS NULL ${workspaceFilter}
            ORDER BY t.occurred_at ASC,t.event_id ASC LIMIT ?`,
      args: [...(input.workspaceId ? [input.workspaceId] : []), limit],
    }),
    dbClient.execute({
      sql: `SELECT j.job_id AS source_event_id,j.workspace_id,p.packet_id AS subject,
                   'decision_packet' AS evidence_reference_kind,
                   j.artifact_digest AS evidence_reference_digest,j.completed_at AS occurred_at,
                   'ai.rateloop.packet.anchored' AS event_type
            FROM tokenless_assurance_attestation_jobs j
            JOIN tokenless_assurance_evidence_packets p ON p.packet_digest=j.artifact_digest
            JOIN tokenless_assurance_runs r ON r.run_id=p.run_id
            JOIN tokenless_assurance_projects pr
              ON pr.project_id=r.project_id AND pr.workspace_id=j.workspace_id
            LEFT JOIN tokenless_assurance_event_outbox e
              ON e.workspace_id=j.workspace_id AND e.source_event_id=j.job_id
             AND e.event_type='ai.rateloop.packet.anchored'
            WHERE j.artifact_kind='decision_packet' AND j.state='completed'
              AND j.completed_at IS NOT NULL AND e.event_id IS NULL ${anchorWorkspaceFilter}
            ORDER BY j.completed_at ASC,j.job_id ASC LIMIT ?`,
      args: [...(input.workspaceId ? [input.workspaceId] : []), limit],
    }),
    dbClient.execute({
      sql: `SELECT t.to_state,COUNT(*) AS count
            FROM tokenless_agent_review_opportunity_transition_events t
            JOIN tokenless_agent_review_opportunities o
              ON o.workspace_id=t.workspace_id AND o.opportunity_id=t.opportunity_id
            LEFT JOIN tokenless_assurance_runs r ON r.run_id=o.run_id
            LEFT JOIN tokenless_assurance_projects pr
              ON pr.project_id=r.project_id AND pr.workspace_id=t.workspace_id
            LEFT JOIN tokenless_assurance_evidence_packets p
              ON p.run_id=r.run_id AND pr.project_id IS NOT NULL
            LEFT JOIN tokenless_assurance_event_outbox e
              ON e.workspace_id=t.workspace_id AND e.source_event_id=t.event_id
             AND e.event_type=CASE WHEN t.to_state='completed' THEN 'ai.rateloop.review.completed'
                                   ELSE 'ai.rateloop.gate.blocked' END
            WHERE t.to_state='completed' AND p.packet_digest IS NULL
              AND e.event_id IS NULL ${workspaceFilter}
            GROUP BY t.to_state`,
      args: input.workspaceId ? [input.workspaceId] : [],
    }),
  ]);
  const failedSources = (failedTransitions.rows as Row[]).map(row => ({
    ...row,
    event_type: terminalFailureEventType(row.reason_codes_json),
  }));
  const sources = [...completedTransitions.rows, ...blockedTransitions.rows, ...failedSources, ...anchors.rows]
    .map(value => lifecycleSourceFromRow(value as Row))
    .sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime())
    .slice(0, limit);
  const summary = {
    scanned: sources.length,
    projected: 0,
    replayed: 0,
    retry: 0,
    deferredWithoutPacket: { gateBlocked: 0, reviewCompleted: 0 },
    retrySources: [] as string[],
  };
  for (const value of deferred.rows) {
    const row = value as Row;
    const count = nonNegativeInteger(row.count, "deferred event count");
    if (text(row, "to_state") === "completed") summary.deferredWithoutPacket.reviewCompleted = count;
  }
  for (const source of sources) {
    try {
      const outcome = await projectAssuranceLifecycleEvent(source, now);
      summary[outcome.state] += 1;
    } catch {
      summary.retry += 1;
      summary.retrySources.push(source.sourceEventId);
    }
  }
  return summary;
}

export async function listAssuranceEvents(input: { accountAddress: string; workspaceId: string; limit?: number }) {
  await listWorkspaceWebhooks({ accountAddress: input.accountAddress, workspaceId: input.workspaceId });
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const result = await dbClient.execute({
    sql: `SELECT event_id,event_type,subject,packet_hash,evidence_reference_kind,evidence_reference_digest,
                 evidence_chain_json,payload_hash,occurred_at,created_at
          FROM tokenless_assurance_event_outbox WHERE workspace_id=?
          ORDER BY occurred_at DESC,event_id DESC LIMIT ?`,
    args: [input.workspaceId, limit],
  });
  return result.rows.map(value => {
    const row = value as Row;
    return {
      eventId: text(row, "event_id")!,
      eventType: text(row, "event_type") as AssuranceEventType,
      subject: text(row, "subject")!,
      evidenceReference: assuranceEvidenceReference({
        schemaVersion: "rateloop.assurance-event-reference.v1",
        kind: text(row, "evidence_reference_kind") as AssuranceEvidenceReference["kind"],
        digest: text(row, "evidence_reference_digest")!,
      }),
      packetHash: text(row, "packet_hash"),
      evidenceChain: JSON.parse(text(row, "evidence_chain_json")!),
      payloadHash: text(row, "payload_hash")!,
      occurredAt: new Date(String(row.occurred_at)).toISOString(),
      createdAt: new Date(String(row.created_at)).toISOString(),
    };
  });
}

export async function deliverPendingAssuranceEvents(
  input: {
    fetchImpl?: WebhookFetch;
    now?: Date;
    limit?: number;
    encryptionKey?: string;
    resolveHostname?: ResolveHostname;
    workspaceId?: string;
  } = {},
) {
  const fetchImpl = input.fetchImpl ?? deliverOverPinnedAddress;
  const now = input.now ?? new Date();
  const workspaceFilter = input.workspaceId ? "AND o.workspace_id = ?" : "";
  const due = await dbClient.execute({
    sql: `SELECT d.delivery_id,d.idempotency_key,d.attempt_count,e.url,e.secret_ciphertext,
                 o.event_id,o.cloud_event_json
          FROM tokenless_assurance_event_deliveries d
          JOIN tokenless_assurance_event_outbox o ON o.event_id=d.event_id
          JOIN tokenless_webhook_endpoints e ON e.endpoint_id=d.endpoint_id
          WHERE e.active=true AND (
            (d.state IN ('pending','retry') AND d.next_attempt_at <= ?)
            OR (d.state='delivering' AND d.lease_expires_at <= ?)
          ) ${workspaceFilter}
          ORDER BY d.next_attempt_at ASC,d.delivery_id ASC LIMIT ?`,
    args: [now, now, ...(input.workspaceId ? [input.workspaceId] : []), Math.min(Math.max(input.limit ?? 25, 1), 100)],
  });
  const outcomes: Array<{ deliveryId: string; state: "delivered" | "retry" | "dead" }> = [];
  for (const value of due.rows) {
    const row = value as Row;
    const deliveryId = text(row, "delivery_id")!;
    const leaseExpiresAt = new Date(now.getTime() + DELIVERY_LEASE_MS);
    const claimed = await dbClient.execute({
      sql: `UPDATE tokenless_assurance_event_deliveries
            SET state='delivering',lease_expires_at=?,updated_at=?
            WHERE delivery_id=? AND (
              state IN ('pending','retry') OR (state='delivering' AND lease_expires_at <= ?)
            )`,
      args: [leaseExpiresAt, now, deliveryId, now],
    });
    if (claimed.rowCount !== 1) continue;
    const payload = text(row, "cloud_event_json")!;
    const timestamp = String(Math.floor(now.getTime() / 1_000));
    const attempt = Number(row.attempt_count) + 1;
    try {
      const signature = `v1=${createHmac(
        "sha256",
        decryptWebhookSigningSecret(text(row, "secret_ciphertext")!, input.encryptionKey),
      )
        .update(`${timestamp}.${payload}`)
        .digest("hex")}`;
      const url = text(row, "url")!;
      const pinnedAddress = await assertPublicWebhookDestination(url, input.resolveHostname);
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/cloudevents+json",
          "rateloop-delivery-id": text(row, "idempotency_key")!,
          "rateloop-event-id": text(row, "event_id")!,
          "rateloop-signature": signature,
          "rateloop-timestamp": timestamp,
        },
        body: payload,
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        pinnedAddress,
      });
      if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { responseStatus: response.status });
      await dbClient.execute({
        sql: `UPDATE tokenless_assurance_event_deliveries
              SET state='delivered',attempt_count=?,response_status=?,last_error=NULL,
                  delivered_at=?,lease_expires_at=NULL,updated_at=?
              WHERE delivery_id=? AND state='delivering'`,
        args: [attempt, response.status, now, now, deliveryId],
      });
      outcomes.push({ deliveryId, state: "delivered" });
    } catch (error) {
      const dead = attempt >= MAX_DELIVERY_ATTEMPTS;
      const delayMs = Math.min(30_000 * 2 ** (attempt - 1), 3_600_000);
      await dbClient.execute({
        sql: `UPDATE tokenless_assurance_event_deliveries
              SET state=?,attempt_count=?,response_status=?,last_error=?,next_attempt_at=?,
                  lease_expires_at=NULL,updated_at=?
              WHERE delivery_id=? AND state='delivering'`,
        args: [
          dead ? "dead" : "retry",
          attempt,
          (error as { responseStatus?: number }).responseStatus ?? null,
          error instanceof Error ? error.message.slice(0, 500) : "Delivery failed",
          new Date(now.getTime() + delayMs),
          now,
          deliveryId,
        ],
      });
      outcomes.push({ deliveryId, state: dead ? "dead" : "retry" });
    }
  }
  return outcomes;
}

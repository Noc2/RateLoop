import { createHash, createHmac } from "node:crypto";
import "server-only";
import { dbClient, dbPool } from "~~/lib/db";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import {
  type ResolveHostname,
  assertPublicWebhookDestination,
  createWorkspaceWebhook,
  deactivateWorkspaceWebhook,
  decryptWebhookSigningSecret,
  listWorkspaceWebhooks,
  stableTransparencyJson,
} from "~~/lib/tokenless/transparency";

const HASH = /^sha256:[0-9a-f]{64}$/;
const TRANSACTION_HASH = /^0x[0-9a-f]{64}$/;
const SOURCE_EVENT_ID = /^[A-Za-z0-9._:/-]{1,200}$/;
const MAX_DELIVERY_ATTEMPTS = 8;
const DELIVERY_LEASE_MS = 60_000;
const OCSF_VERSION = "1.8.0";

export const ASSURANCE_EVENT_TYPES = [
  "ai.rateloop.review.completed",
  "ai.rateloop.packet.anchored",
  "ai.rateloop.gate.blocked",
] as const;

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

type CloudEvent = {
  specversion: "1.0";
  id: string;
  source: string;
  type: AssuranceEventType;
  subject: string;
  time: string;
  datacontenttype: "application/json";
  dataschema: "urn:rateloop:schema:assurance-event:v1";
  ratelooppackethash: string;
  rateloopchainhash: string;
  data: {
    schemaVersion: "rateloop.assurance-event.v1";
    packetHash: string;
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
    rateloop_packet_hash: string;
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

function eventDefinition(type: AssuranceEventType) {
  switch (type) {
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
  packetHash: string;
  evidenceChain: AssuranceEvidenceChainReference;
  occurredAt: Date;
}) {
  const type = eventType(input.eventType);
  const sourceId = sourceEventId(input.sourceEventId);
  const packet = packetHash(input.packetHash);
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
      rateloop_packet_hash: packet,
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
    dataschema: "urn:rateloop:schema:assurance-event:v1",
    ratelooppackethash: packet,
    rateloopchainhash: chain.eventHash,
    data: {
      schemaVersion: "rateloop.assurance-event.v1",
      packetHash: packet,
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
  packetHash: string;
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
       (event_id,workspace_id,source_event_id,event_type,subject,packet_hash,evidence_chain_json,
       cloud_event_json,ocsf_event_json,payload_hash,occurred_at,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (workspace_id,event_type,source_event_id) DO NOTHING
       RETURNING event_id`,
      [
        event.id,
        input.workspaceId,
        input.sourceEventId,
        event.type,
        event.subject,
        event.data.packetHash,
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

export async function listAssuranceEvents(input: { accountAddress: string; workspaceId: string; limit?: number }) {
  await listWorkspaceWebhooks({ accountAddress: input.accountAddress, workspaceId: input.workspaceId });
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const result = await dbClient.execute({
    sql: `SELECT event_id,event_type,subject,packet_hash,evidence_chain_json,payload_hash,occurred_at,created_at
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
      packetHash: text(row, "packet_hash")!,
      evidenceChain: JSON.parse(text(row, "evidence_chain_json")!),
      payloadHash: text(row, "payload_hash")!,
      occurredAt: new Date(String(row.occurred_at)).toISOString(),
      createdAt: new Date(String(row.created_at)).toISOString(),
    };
  });
}

export async function deliverPendingAssuranceEvents(
  input: {
    fetchImpl?: typeof fetch;
    now?: Date;
    limit?: number;
    encryptionKey?: string;
    resolveHostname?: ResolveHostname;
    workspaceId?: string;
  } = {},
) {
  const fetchImpl = input.fetchImpl ?? fetch;
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
      await assertPublicWebhookDestination(url, input.resolveHostname);
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

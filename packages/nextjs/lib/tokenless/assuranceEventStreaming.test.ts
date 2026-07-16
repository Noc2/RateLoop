import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  buildAssuranceCloudEvent,
  createAssuranceEventStream,
  deliverPendingAssuranceEvents,
  enqueueAssuranceEvent,
  listAssuranceEventStreams,
  listAssuranceEvents,
} from "~~/lib/tokenless/assuranceEventStreaming";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const OWNER = "0x1111111111111111111111111111111111111111";
const OUTSIDER = "0x2222222222222222222222222222222222222222";
const NOW = new Date("2026-07-16T12:00:00.000Z");
const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64url");
const PACKET_HASH = `sha256:${"11".repeat(32)}`;
const CHAIN_HASH = `sha256:${"22".repeat(32)}`;
const PREVIOUS_HASH = `sha256:${"33".repeat(32)}`;
const CHAIN_REFERENCE = {
  schemaVersion: "rateloop.audit-chain-reference.v1" as const,
  eventHash: CHAIN_HASH,
  previousHash: PREVIOUS_HASH,
  sequence: 42,
  externalAnchor: {
    chainId: 84532,
    transactionHash: `0x${"44".repeat(32)}`,
    blockNumber: "123456",
  },
};
const resolvePublic = async () => ["203.0.113.10"];

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

test("CloudEvents 1.0 wraps an OCSF 1.8 Compliance Finding and cross-verifiable evidence references", () => {
  const built = buildAssuranceCloudEvent({
    workspaceId: "ws_test",
    sourceEventId: "review:completed:run_123",
    eventType: "ai.rateloop.review.completed",
    packetHash: PACKET_HASH,
    evidenceChain: CHAIN_REFERENCE,
    occurredAt: NOW,
  });
  assert.equal(built.event.specversion, "1.0");
  assert.equal(built.event.ratelooppackethash, PACKET_HASH);
  assert.equal(built.event.rateloopchainhash, CHAIN_HASH);
  assert.deepEqual(built.event.data.evidenceChain, CHAIN_REFERENCE);
  assert.equal(built.event.data.ocsf.class_uid, 2003);
  assert.equal(built.event.data.ocsf.category_uid, 2);
  assert.equal(built.event.data.ocsf.metadata.version, "1.8.0");
  assert.equal(built.event.data.ocsf.finding_info.uid, built.event.id);
  assert.equal(built.event.data.ocsf.unmapped.rateloop_packet_hash, PACKET_HASH);
  assert.equal(JSON.stringify(built).includes("workspace name"), false);
  assert.throws(
    () =>
      buildAssuranceCloudEvent({
        workspaceId: "ws_test",
        sourceEventId: "review:completed:run_123",
        eventType: "ai.rateloop.review.completed",
        subject: "raw review content must not enter a SIEM event",
        packetHash: PACKET_HASH,
        evidenceChain: CHAIN_REFERENCE,
        occurredAt: NOW,
      }),
    /Event reference is invalid/u,
  );
});

test("workspace administrators configure streams and event enqueue is atomic, scoped, and idempotent", async () => {
  const { workspaceId } = await createWorkspace({ name: "Event stream", ownerAddress: OWNER });
  const primary = await createAssuranceEventStream({
    accountAddress: OWNER,
    workspaceId,
    url: "https://siem.example.test/rateloop",
    eventTypes: ["ai.rateloop.review.completed"],
    encryptionKey: ENCRYPTION_KEY,
    resolveHostname: resolvePublic,
  });
  await createAssuranceEventStream({
    accountAddress: OWNER,
    workspaceId,
    url: "https://gates.example.test/rateloop",
    eventTypes: ["ai.rateloop.gate.blocked"],
    encryptionKey: ENCRYPTION_KEY,
    resolveHostname: resolvePublic,
  });
  assert.match(primary.signingSecret, /^rlwhsec_/u);
  assert.equal((await listAssuranceEventStreams({ accountAddress: OWNER, workspaceId })).length, 2);
  await assert.rejects(
    () => listAssuranceEventStreams({ accountAddress: OUTSIDER, workspaceId }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "workspace_not_found",
  );

  const first = await enqueueAssuranceEvent({
    workspaceId,
    sourceEventId: "review:completed:run_123",
    eventType: "ai.rateloop.review.completed",
    packetHash: PACKET_HASH,
    evidenceChain: CHAIN_REFERENCE,
    occurredAt: NOW,
    now: NOW,
  });
  assert.equal(first.replay, false);
  assert.equal(first.deliveryCount, 1);
  const replay = await enqueueAssuranceEvent({
    workspaceId,
    sourceEventId: "review:completed:run_123",
    eventType: "ai.rateloop.review.completed",
    packetHash: PACKET_HASH,
    evidenceChain: CHAIN_REFERENCE,
    occurredAt: NOW,
    now: new Date(NOW.getTime() + 1_000),
  });
  assert.deepEqual(replay, { eventId: first.eventId, deliveryCount: 0, replay: true });

  const stored = await dbClient.execute({
    sql: `SELECT o.cloud_event_json,o.payload_hash,COUNT(d.delivery_id) AS deliveries
          FROM tokenless_assurance_event_outbox o
          LEFT JOIN tokenless_assurance_event_deliveries d ON d.event_id=o.event_id
          WHERE o.event_id=? GROUP BY o.cloud_event_json,o.payload_hash`,
    args: [first.eventId],
  });
  const envelope = JSON.parse(String(stored.rows[0].cloud_event_json));
  assert.equal(envelope.id, first.eventId);
  assert.equal(envelope.data.packetHash, PACKET_HASH);
  assert.match(String(stored.rows[0].payload_hash), /^sha256:[0-9a-f]{64}$/u);
  assert.equal(Number(stored.rows[0].deliveries), 1);
  assert.equal((await listAssuranceEvents({ accountAddress: OWNER, workspaceId }))[0]?.eventId, first.eventId);

  await assert.rejects(
    () =>
      enqueueAssuranceEvent({
        workspaceId,
        sourceEventId: "review:completed:run_123",
        eventType: "ai.rateloop.review.completed",
        packetHash: `sha256:${"99".repeat(32)}`,
        evidenceChain: CHAIN_REFERENCE,
        occurredAt: NOW,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "assurance_event_conflict",
  );
});

test("deliveries retry with a stable payload and signature, recover expired leases, and re-check SSRF on every attempt", async () => {
  const { workspaceId } = await createWorkspace({ name: "Reliable stream", ownerAddress: OWNER });
  const stream = await createAssuranceEventStream({
    accountAddress: OWNER,
    workspaceId,
    url: "https://siem.example.test/events",
    eventTypes: ["ai.rateloop.review.completed", "ai.rateloop.packet.anchored"],
    encryptionKey: ENCRYPTION_KEY,
    resolveHostname: resolvePublic,
  });
  const enqueued = await enqueueAssuranceEvent({
    workspaceId,
    sourceEventId: "review:completed:run_retry",
    eventType: "ai.rateloop.review.completed",
    packetHash: PACKET_HASH,
    evidenceChain: CHAIN_REFERENCE,
    occurredAt: NOW,
    now: NOW,
  });
  const attempts: Array<{ body: string; headers: Headers }> = [];
  const failed = await deliverPendingAssuranceEvents({
    now: NOW,
    encryptionKey: ENCRYPTION_KEY,
    resolveHostname: resolvePublic,
    fetchImpl: async (_url, init) => {
      attempts.push({ body: String(init?.body), headers: new Headers(init?.headers) });
      return new Response(null, { status: 503 });
    },
  });
  assert.equal(failed[0]?.state, "retry");
  const retryAt = new Date(NOW.getTime() + 31_000);
  const delivered = await deliverPendingAssuranceEvents({
    now: retryAt,
    encryptionKey: ENCRYPTION_KEY,
    resolveHostname: resolvePublic,
    fetchImpl: async (_url, init) => {
      attempts.push({ body: String(init?.body), headers: new Headers(init?.headers) });
      return new Response(null, { status: 202 });
    },
  });
  assert.equal(delivered[0]?.state, "delivered");
  assert.equal(attempts[0]?.body, attempts[1]?.body);
  assert.equal(attempts[1]?.headers.get("content-type"), "application/cloudevents+json");
  assert.equal(attempts[1]?.headers.get("rateloop-event-id"), enqueued.eventId);
  const timestamp = attempts[1]?.headers.get("rateloop-timestamp");
  assert.ok(timestamp);
  const expectedSignature = `v1=${createHmac("sha256", stream.signingSecret)
    .update(`${timestamp}.${attempts[1]?.body}`)
    .digest("hex")}`;
  assert.equal(attempts[1]?.headers.get("rateloop-signature"), expectedSignature);

  const leased = await enqueueAssuranceEvent({
    workspaceId,
    sourceEventId: "packet:anchored:run_lease",
    eventType: "ai.rateloop.packet.anchored",
    packetHash: PACKET_HASH,
    evidenceChain: CHAIN_REFERENCE,
    occurredAt: retryAt,
    now: retryAt,
  });
  await dbClient.execute({
    sql: `UPDATE tokenless_assurance_event_deliveries
          SET state='delivering',lease_expires_at=?,updated_at=? WHERE event_id=?`,
    args: [new Date(retryAt.getTime() - 1), retryAt, leased.eventId],
  });
  const recovered = await deliverPendingAssuranceEvents({
    now: retryAt,
    encryptionKey: ENCRYPTION_KEY,
    resolveHostname: resolvePublic,
    fetchImpl: async () => new Response(null, { status: 204 }),
  });
  assert.equal(recovered[0]?.state, "delivered");

  const blockedByDns = await enqueueAssuranceEvent({
    workspaceId,
    sourceEventId: "packet:anchored:run_ssrf",
    eventType: "ai.rateloop.packet.anchored",
    packetHash: PACKET_HASH,
    evidenceChain: CHAIN_REFERENCE,
    occurredAt: new Date(retryAt.getTime() + 1_000),
    now: new Date(retryAt.getTime() + 1_000),
  });
  let fetched = false;
  const blocked = await deliverPendingAssuranceEvents({
    now: new Date(retryAt.getTime() + 1_000),
    encryptionKey: ENCRYPTION_KEY,
    resolveHostname: async () => ["127.0.0.1"],
    fetchImpl: async () => {
      fetched = true;
      return new Response(null, { status: 200 });
    },
  });
  assert.equal(blocked[0]?.deliveryId.startsWith("aed_"), true);
  assert.equal(blocked[0]?.state, "retry");
  assert.equal(fetched, false);
  const ssrfState = await dbClient.execute({
    sql: "SELECT state,last_error FROM tokenless_assurance_event_deliveries WHERE event_id=?",
    args: [blockedByDns.eventId],
  });
  assert.equal(ssrfState.rows[0].state, "retry");
  assert.match(String(ssrfState.rows[0].last_error), /private or local/u);
});

import { appendAuditEvent, exportWorkspaceAudit, verifyWorkspaceAuditChain } from "./audit";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const OWNER = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

test("canonical audit events form a verifiable tenant chain and export only to administrators", async () => {
  const { workspaceId } = await createWorkspace({ name: "Audit", ownerAddress: OWNER });
  const first = await appendAuditEvent({
    action: "auth.login",
    actorKind: "principal",
    actorReference: "rlp_user_123",
    assuranceMethod: "better_auth_passkey",
    occurredAt: new Date("2026-07-15T08:00:00.000Z"),
    purpose: "account_access",
    reason: "user_login",
    result: "success",
    targetId: "rlp_user_123",
    targetKind: "principal",
    workspaceId,
  });
  const second = await appendAuditEvent({
    action: "artifact.read",
    actorKind: "principal",
    actorReference: "rlp_user_123",
    assuranceMethod: "better_auth_session",
    metadata: { classification: "confidential" },
    occurredAt: new Date("2026-07-15T08:01:00.000Z"),
    purpose: "assigned_review",
    reason: "active_assignment",
    requestCorrelation: "request_123",
    result: "success",
    targetId: "artifact_123",
    targetKind: "artifact",
    workspaceId,
  });
  assert.equal(first.sequence, 1);
  assert.equal(second.sequence, 2);
  assert.equal(second.previousDigest, first.eventDigest);
  assert.deepEqual(await verifyWorkspaceAuditChain(workspaceId), {
    eventCount: 2,
    headDigest: second.eventDigest,
    valid: true,
  });
  const exported = await exportWorkspaceAudit({ accountAddress: OWNER, workspaceId });
  assert.equal(exported.events.length, 2);
  assert.equal(exported.integrity.valid, true);
  await assert.rejects(
    () => exportWorkspaceAudit({ accountAddress: OTHER, workspaceId }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "workspace_not_found",
  );

  await dbClient.execute({
    sql: "UPDATE tokenless_audit_events SET reason = 'tampered' WHERE event_id = ?",
    args: [first.eventId],
  });
  assert.deepEqual(await verifyWorkspaceAuditChain(workspaceId), { eventCount: 0, valid: false });
});

import {
  appendAuditEvent,
  appendSecurityAuditEvent,
  exportWorkspaceAudit,
  verifySecurityAuditChain,
  verifyWorkspaceAuditChain,
} from "./audit";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const OWNER = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const OPAQUE_OWNER = "rlp_audit_workspace_owner_0001";

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
  const exportEvent = await dbClient.execute({
    sql: "SELECT action, actor_reference, metadata_json FROM tokenless_audit_events WHERE workspace_id = ? AND action = 'audit.export'",
    args: [workspaceId],
  });
  assert.equal(exportEvent.rowCount, 1);
  assert.equal(exportEvent.rows[0]?.actor_reference, OWNER);
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

test("audit exports authorize a Better Auth principal without requiring a wallet", async () => {
  const { workspaceId } = await createWorkspace({ name: "Principal audit", ownerAddress: OPAQUE_OWNER });
  await appendAuditEvent({
    action: "workspace.created",
    actorKind: "principal",
    actorReference: OPAQUE_OWNER,
    assuranceMethod: "better_auth_session",
    occurredAt: new Date("2026-07-15T09:00:00.000Z"),
    purpose: "workspace_administration",
    reason: "workspace_owner_request",
    result: "success",
    targetId: workspaceId,
    targetKind: "workspace",
    workspaceId,
  });

  const exported = await exportWorkspaceAudit({ accountAddress: OPAQUE_OWNER, workspaceId });
  assert.equal(exported.events.length, 1);
  assert.equal(exported.integrity.valid, true);
});

test("workspace verification detects deleted tail events and a fully deleted chain", async () => {
  const { workspaceId } = await createWorkspace({ name: "Tail deletion", ownerAddress: OWNER });
  const first = await appendAuditEvent({
    action: "project.created",
    actorKind: "account",
    actorReference: OWNER,
    assuranceMethod: "rateloop_session",
    occurredAt: new Date("2026-07-15T09:10:00.000Z"),
    purpose: "project_administration",
    reason: "owner_request",
    result: "success",
    targetId: "project_tail_test",
    targetKind: "project",
    workspaceId,
  });
  const second = await appendAuditEvent({
    action: "project.access_granted",
    actorKind: "account",
    actorReference: OWNER,
    assuranceMethod: "rateloop_session",
    occurredAt: new Date("2026-07-15T09:11:00.000Z"),
    purpose: "project_administration",
    reason: "owner_request",
    result: "success",
    targetId: "assignment_tail_test",
    targetKind: "project_access",
    workspaceId,
  });

  await dbClient.execute({ sql: "DELETE FROM tokenless_audit_events WHERE event_id = ?", args: [second.eventId] });
  assert.deepEqual(await verifyWorkspaceAuditChain(workspaceId), { eventCount: 1, valid: false });

  await dbClient.execute({ sql: "DELETE FROM tokenless_audit_events WHERE event_id = ?", args: [first.eventId] });
  assert.deepEqual(await verifyWorkspaceAuditChain(workspaceId), { eventCount: 0, valid: false });
});

test("pre-workspace security events have an isolated integrity chain that detects deletion", async () => {
  const first = await appendSecurityAuditEvent({
    action: "auth.login_failed",
    actorKind: "system",
    actorReference: "anonymous",
    assuranceMethod: "better_auth_email_otp",
    occurredAt: new Date("2026-07-15T10:00:00.000Z"),
    purpose: "account_access",
    reason: "invalid_credential",
    requestCorrelation: "request_auth_failure_1",
    result: "failure",
    scopeId: "authentication",
    scopeKind: "system",
    targetId: "anonymous_attempt",
    targetKind: "authentication",
  });
  const second = await appendSecurityAuditEvent({
    action: "auth.configuration_failed",
    actorKind: "system",
    actorReference: "system:better_auth",
    assuranceMethod: "service_configuration",
    occurredAt: new Date("2026-07-15T10:01:00.000Z"),
    purpose: "account_access",
    reason: "provider_unavailable",
    requestCorrelation: "request_auth_failure_2",
    result: "failure",
    scopeId: "authentication",
    scopeKind: "system",
    targetId: "better_auth",
    targetKind: "identity_provider",
  });

  assert.equal(first.sequence, 1);
  assert.equal(second.sequence, 2);
  assert.deepEqual(await verifySecurityAuditChain({ scopeId: "authentication", scopeKind: "system" }), {
    eventCount: 2,
    headDigest: second.eventDigest,
    valid: true,
  });
  const workspaceHeads = await dbClient.execute("SELECT workspace_id FROM tokenless_audit_heads");
  assert.equal(workspaceHeads.rowCount, 0);

  await dbClient.execute({
    sql: "DELETE FROM tokenless_security_audit_events WHERE event_id = ?",
    args: [second.eventId],
  });
  assert.deepEqual(await verifySecurityAuditChain({ scopeId: "authentication", scopeKind: "system" }), {
    eventCount: 1,
    valid: false,
  });
  await dbClient.execute({
    sql: "DELETE FROM tokenless_security_audit_events WHERE event_id = ?",
    args: [first.eventId],
  });
  assert.deepEqual(await verifySecurityAuditChain({ scopeId: "authentication", scopeKind: "system" }), {
    eventCount: 0,
    valid: false,
  });
});

test("audit metadata rejects secrets and oversized payloads before persistence", async () => {
  const { workspaceId } = await createWorkspace({ name: "Safe audit metadata", ownerAddress: OWNER });
  const base = {
    action: "security.test",
    actorKind: "account" as const,
    actorReference: OWNER,
    assuranceMethod: "rateloop_session",
    purpose: "security_test",
    reason: "metadata_validation",
    result: "success" as const,
    targetId: workspaceId,
    targetKind: "workspace",
    workspaceId,
  };
  await assert.rejects(
    () => appendAuditEvent({ ...base, metadata: { authorization: "Bearer should-never-be-stored" } }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_audit_event",
  );
  await assert.rejects(
    () => appendAuditEvent({ ...base, metadata: { detail: "x".repeat(17 * 1_024) } }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_audit_event",
  );
  assert.equal((await dbClient.execute("SELECT event_id FROM tokenless_audit_events")).rowCount, 0);
});

test("untrusted request correlation values are omitted instead of blocking the audited action", async () => {
  const result = await appendSecurityAuditEvent({
    action: "auth.provider_request_denied",
    actorKind: "system",
    actorReference: "anonymous",
    assuranceMethod: "better_auth",
    purpose: "account_access",
    reason: "provider_request_rejected",
    requestCorrelation: "invalid correlation containing spaces and a bearer-shaped value",
    result: "denied",
    scopeId: "authentication",
    scopeKind: "system",
    targetId: "better_auth",
    targetKind: "identity_provider",
  });
  assert.equal(result.sequence, 1);
  const stored = await dbClient.execute({
    sql: "SELECT request_correlation FROM tokenless_security_audit_events WHERE event_id = ?",
    args: [result.eventId],
  });
  assert.equal(stored.rows[0]?.request_correlation, null);
});

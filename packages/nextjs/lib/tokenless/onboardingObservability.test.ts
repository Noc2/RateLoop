import {
  categorizeConnectionFailure,
  loadWorkspaceOnboardingFunnel,
  parseConnectionMessageCopiedPayload,
  recordConnectionMessageCopied,
} from "./onboardingObservability";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { createAgentConnectionIntent } from "~~/lib/tokenless/agentConnectionIntents";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const OWNER = "rlp_onboarding_owner_0001";

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

test("the client event parser accepts only the content-free copied signal", () => {
  assert.deepEqual(parseConnectionMessageCopiedPayload({ event: "connection_message_copied" }), {
    event: "connection_message_copied",
  });
  for (const sensitiveField of ["messageUrl", "token", "prompt", "workspaceName", "agentContent"]) {
    assert.throws(
      () =>
        parseConnectionMessageCopiedPayload({
          event: "connection_message_copied",
          [sensitiveField]: "must-never-be-recorded",
        }),
      (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_onboarding_event",
    );
  }
  assert.throws(
    () => parseConnectionMessageCopiedPayload({ event: "connected" }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_onboarding_event",
  );
});

test("failure diagnostics collapse to an allowlisted category", () => {
  assert.equal(categorizeConnectionFailure("connection_intent_expired", "expired"), "expired");
  assert.equal(categorizeConnectionFailure("connection_owner_mismatch", "action_required"), "conflict");
  assert.equal(categorizeConnectionFailure("insufficient_scope", "action_required"), "authorization");
  assert.equal(categorizeConnectionFailure("connection_test_failed", "action_required"), "connection_test");
  assert.equal(categorizeConnectionFailure("private_internal_detail", "action_required"), "unknown");
});

test("the funnel derives lifecycle timing without returning workspace or agent content", async () => {
  const workspace = await createWorkspace({ name: "Secret Workspace Name", ownerAddress: OWNER });
  const issued = await createAgentConnectionIntent({
    accountAddress: OWNER,
    origin: "https://rateloop-tokenless.vercel.app",
    workspaceId: workspace.workspaceId,
  });
  const startedAt = new Date(issued.intent.createdAt);
  await recordConnectionMessageCopied({
    accountAddress: OWNER,
    occurredAt: new Date(startedAt.getTime() + 1_000),
    workspaceId: workspace.workspaceId,
  });
  await dbClient.execute({
    sql: `UPDATE tokenless_agent_connection_intents
          SET status = 'connected', claimed_at = ?, connected_at = ?, last_transition_at = ?
          WHERE intent_id = ?`,
    args: [
      new Date(startedAt.getTime() + 2_000),
      new Date(startedAt.getTime() + 4_000),
      new Date(startedAt.getTime() + 4_000),
      issued.intent.intentId,
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_connection_intent_events
          (event_id,intent_id,workspace_id,from_status,to_status,actor_type,actor_reference,reason,details_json,created_at)
          VALUES (?, ?, ?, 'authorizing', 'approval_required', 'service', 'rateloop', 'owner_approval', '{}', ?)`,
    args: [
      "acie_onboarding_approval_0001",
      issued.intent.intentId,
      workspace.workspaceId,
      new Date(startedAt.getTime() + 3_000),
    ],
  });

  const funnel = await loadWorkspaceOnboardingFunnel(workspace.workspaceId);
  assert.deepEqual(
    funnel.events.map(event => [event.event, event.attempt, event.elapsedMs]),
    [
      ["workspace_created", null, 0],
      ["connection_message_copied", 1, 1_000],
      ["connection_claimed", 1, 2_000],
      ["approval_required", 1, 3_000],
      ["connected", 1, 4_000],
    ],
  );
  const serialized = JSON.stringify(funnel);
  assert.doesNotMatch(serialized, /Secret Workspace Name|claim=|must-never-be-recorded/u);

  const copiedAudit = await dbClient.execute({
    sql: `SELECT action,actor_kind,actor_reference,target_kind,target_id,metadata_json FROM tokenless_audit_events
          WHERE workspace_id = ? AND action = 'onboarding.connection_message_copied'`,
    args: [workspace.workspaceId],
  });
  assert.deepEqual(copiedAudit.rows, [
    {
      action: "onboarding.connection_message_copied",
      actor_kind: "system",
      actor_reference: "onboarding_observability",
      metadata_json: "{}",
      target_id: workspace.workspaceId,
      target_kind: "workspace_onboarding",
    },
  ]);
});

test("failed attempts expose only category and elapsed time", async () => {
  const workspace = await createWorkspace({ name: "Failure", ownerAddress: OWNER });
  const issued = await createAgentConnectionIntent({
    accountAddress: OWNER,
    origin: "https://rateloop-tokenless.vercel.app",
    workspaceId: workspace.workspaceId,
  });
  const startedAt = new Date(issued.intent.createdAt);
  await dbClient.execute({
    sql: `UPDATE tokenless_agent_connection_intents
          SET status = 'action_required', last_diagnostic_code = 'connection_test_failed:private-host-detail',
              last_diagnostic_at = ?, last_transition_at = ? WHERE intent_id = ?`,
    args: [new Date(startedAt.getTime() + 7_500), new Date(startedAt.getTime() + 7_500), issued.intent.intentId],
  });
  const funnel = await loadWorkspaceOnboardingFunnel(workspace.workspaceId);
  const failure = funnel.events.find(event => event.event === "connection_failed");
  assert.deepEqual(failure, {
    attempt: 1,
    elapsedMs: 7_500,
    event: "connection_failed",
    failureCategory: "connection_test",
    occurredAt: new Date(startedAt.getTime() + 7_500).toISOString(),
  });
  assert.doesNotMatch(JSON.stringify(funnel), /private-host-detail/u);
});

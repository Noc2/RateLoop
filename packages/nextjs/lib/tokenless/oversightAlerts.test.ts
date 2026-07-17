import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  GET as getAlertPreferences,
  PUT as putAlertPreferences,
} from "~~/app/api/account/workspaces/[workspaceId]/oversight/alert-preferences/route";
import { GET as getInbox, POST as postInbox } from "~~/app/api/notifications/inbox/route";
import { resolveBetterAuthPrincipal } from "~~/lib/auth/principal";
import { AUTH_SESSION_COOKIE, createAuthSession } from "~~/lib/auth/session";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  deliverPendingTokenlessNotificationEmails,
  enqueueTokenlessNotificationEmails,
} from "~~/lib/notifications/delivery";
import { createWorkspaceAgent } from "~~/lib/tokenless/agentRegistry";
import { enqueueAssuranceEvent } from "~~/lib/tokenless/assuranceEventStreaming";
import {
  DEFAULT_WORKSPACE_ALERT_PREFERENCES,
  getWorkspaceAlertPreferences,
  listNotificationInbox,
  markNotificationInboxRead,
  materializeOversightAlertNotifications,
  updateWorkspaceAlertPreferences,
} from "~~/lib/tokenless/oversightAlerts";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import { seedReadyHumanReviewBinding } from "~~/lib/tokenless/testing/humanReviewBindingFixture";
import { engageWorkspaceStop } from "~~/lib/tokenless/workspaceStopControl";

const APP_ORIGIN = "https://tokenless.example.test";
const NOW = new Date("2026-07-17T12:00:00.000Z");
const HASH = (character: string) => `sha256:${character.repeat(64)}`;
const CHAIN = {
  schemaVersion: "rateloop.audit-chain-reference.v1" as const,
  eventHash: HASH("2"),
  previousHash: null,
  sequence: 0,
};
const GATE_REFERENCE = {
  schemaVersion: "rateloop.assurance-event-reference.v1" as const,
  kind: "gate_transition" as const,
  digest: HASH("3"),
};

const originalAppUrl = process.env.APP_URL;

beforeEach(() => {
  process.env.APP_URL = APP_ORIGIN;
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});
afterEach(() => {
  __setDatabaseResourcesForTests(null);
  if (originalAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = originalAppUrl;
});

async function fixture(label: string) {
  const owner = await resolveBetterAuthPrincipal({
    betterAuthUserId: `better_oversight_alerts_${label}_owner`,
    method: "passkey",
  });
  const member = await resolveBetterAuthPrincipal({
    betterAuthUserId: `better_oversight_alerts_${label}_member`,
    method: "passkey",
  });
  const session = await createAuthSession(owner);
  const { workspaceId } = await createWorkspace({ name: `Alerts ${label}`, ownerAddress: owner.principalId });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_members (workspace_id, account_address, role, created_at)
          VALUES (?, ?, 'member', ?)`,
    args: [workspaceId, member.principalId, NOW],
  });
  return { owner, member, session, workspaceId };
}

async function seedAdaptiveScope(input: { workspaceId: string; owner: string; label: string; stage: string }) {
  const agent = await createWorkspaceAgent({
    accountAddress: input.owner,
    workspaceId: input.workspaceId,
    externalId: `alerts-agent-${input.label}`,
    version: {
      displayName: "Alerts agent",
      provider: "OpenAI",
      model: "gpt-test",
      modelVersion: "2026-07-14",
      environment: "production",
    },
  });
  const policyId = `arp_alerts_${input.label}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_review_policies
          (policy_id, version, workspace_id, agent_id, agent_version_id, mode, enabled,
           agreement_threshold_bps, production_floor_bps, maximum_unreviewed_gap, rules_json,
           audience_policy_json, created_by, approved_by, created_at)
          VALUES (?, 1, ?, ?, ?, 'adaptive', true, 7000, 1000, 20, '{}', ?, ?, ?, ?)`,
    args: [
      policyId,
      input.workspaceId,
      agent.agentId,
      agent.currentVersion.versionId,
      JSON.stringify({ reviewerSource: "public_network" }),
      input.owner,
      input.owner,
      NOW,
    ],
  });
  const binding = await seedReadyHumanReviewBinding({
    workspaceId: input.workspaceId,
    agentId: agent.agentId,
    agentVersionId: agent.currentVersion.versionId,
    policyId,
    actor: input.owner,
  });
  const scopeId = `aesc_alerts_${input.label}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_evaluation_scopes
          (scope_id, workspace_id, agent_id, agent_version_id, policy_id, policy_version,
           workflow_key, risk_tier, audience_policy_hash, partition_commitment,
           execution_profile_hash, execution_profile_json, human_review_binding_id, human_review_binding_version,
           request_profile_id, request_profile_version, request_profile_hash, stage, completed_comparable_cases,
           stable_cases_since_stage, unreviewed_since_last_sample, stage_entered_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 1, 'support-reply', 'low', ?, ?, ?, '{}', ?, 1, ?, 1, ?, ?, 0, 0, 0, ?, ?)`,
    args: [
      scopeId,
      input.workspaceId,
      agent.agentId,
      agent.currentVersion.versionId,
      policyId,
      HASH("a"),
      HASH("b"),
      HASH("c"),
      binding.bindingId,
      binding.profileId,
      binding.profileHash,
      input.stage,
      NOW,
      NOW,
    ],
  });
  return { agent, policyId, binding, scopeId };
}

async function seedObservations(input: {
  workspaceId: string;
  scope: Awaited<ReturnType<typeof seedAdaptiveScope>>;
  disagreements: number;
  total: number;
}) {
  for (let index = 0; index < input.total; index += 1) {
    const opportunityId = `aop_alerts_${index}`;
    await dbClient.execute({
      sql: `INSERT INTO tokenless_agent_review_opportunities
            (opportunity_id, workspace_id, agent_id, agent_version_id, scope_id, policy_id, policy_version,
             external_opportunity_id, suggestion_commitment, declared_confidence_bps, metadata_commitment,
             metadata_complete, critical_risk, decision, review_rate_bps, selection_probability_bps, sample_bucket,
             sampler_key_version, sampler_commitment, reason_codes_json, status, run_id, source_evidence_reference,
             source_evidence_hash, human_review_binding_id, human_review_binding_version, request_profile_id,
             request_profile_version, request_profile_hash, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, 9000, ?, true, false, 'required', 10000, 10000, 1, 'sampler-v1',
                    ?, '[]', 'completed', NULL, 'evidence/alerts', ?, ?, 1, ?, 1, ?, ?, ?)`,
      args: [
        opportunityId,
        input.workspaceId,
        input.scope.agent.agentId,
        input.scope.agent.currentVersion.versionId,
        input.scope.scopeId,
        input.scope.policyId,
        `external-alerts-${index}`,
        HASH("d"),
        HASH("e"),
        HASH("f"),
        HASH("9"),
        input.scope.binding.bindingId,
        input.scope.binding.profileId,
        input.scope.binding.profileHash,
        NOW,
        NOW,
      ],
    });
    await dbClient.execute({
      sql: `INSERT INTO tokenless_agent_evaluation_observations
            (observation_id, workspace_id, scope_id, opportunity_id, evidence_reference, source_payload_hash,
             agent_outcome_commitment, human_outcome_commitment, agreement, comparable, responding_human_count,
             finalized_at, created_at)
            VALUES (?, ?, ?, ?, 'evidence/alerts', ?, ?, ?, ?, true, 3, ?, ?)`,
      args: [
        `aeo_alerts_${index}`,
        input.workspaceId,
        input.scope.scopeId,
        opportunityId,
        HASH("1"),
        HASH("4"),
        HASH("5"),
        index < input.disagreements ? "disagree" : "agree",
        NOW,
        NOW,
      ],
    });
  }
}

async function notificationsFor(principal: string) {
  const result = await dbClient.execute({
    sql: `SELECT source_type, source_key, title, preference_key FROM tokenless_notifications
          WHERE principal_address = ? ORDER BY source_type ASC, source_key ASC`,
    args: [principal],
  });
  return result.rows as Array<Record<string, unknown>>;
}

test("gate and review-failure events alert owners and admins in-app, once, respecting preferences", async () => {
  const setup = await fixture("events");
  await enqueueAssuranceEvent({
    workspaceId: setup.workspaceId,
    sourceEventId: "gate:blocked:1",
    eventType: "ai.rateloop.gate.blocked",
    evidenceReference: GATE_REFERENCE,
    evidenceChain: CHAIN,
    occurredAt: NOW,
    now: NOW,
  });
  await enqueueAssuranceEvent({
    workspaceId: setup.workspaceId,
    sourceEventId: "review:failed:1",
    eventType: "ai.rateloop.review.failed",
    evidenceReference: GATE_REFERENCE,
    evidenceChain: CHAIN,
    occurredAt: NOW,
    now: NOW,
  });
  await enqueueAssuranceEvent({
    workspaceId: setup.workspaceId,
    sourceEventId: "review:expired:1",
    eventType: "ai.rateloop.review.expired",
    evidenceReference: GATE_REFERENCE,
    evidenceChain: CHAIN,
    occurredAt: NOW,
    now: NOW,
  });

  const first = await materializeOversightAlertNotifications({ now: NOW });
  assert.equal(first.inserted, 3);
  const ownerAlerts = await notificationsFor(setup.owner.principalId);
  assert.deepEqual(
    ownerAlerts.map(row => row.source_type),
    ["oversight.gate_blocked", "oversight.review_expired", "oversight.review_failed"],
  );
  assert.ok(ownerAlerts.every(row => row.preference_key === "oversightAlerts"));
  // Plain members never receive oversight alerts.
  assert.equal((await notificationsFor(setup.member.principalId)).length, 0);
  // Idempotent: a second cycle inserts nothing new.
  const replay = await materializeOversightAlertNotifications({ now: new Date(NOW.getTime() + 1_000) });
  assert.equal(replay.inserted, 0);

  // Disable gate alerts: further gate events stay out of the inbox while
  // review failures continue to alert.
  await updateWorkspaceAlertPreferences({
    accountAddress: setup.owner.principalId,
    workspaceId: setup.workspaceId,
    preferences: { ...DEFAULT_WORKSPACE_ALERT_PREFERENCES, gateBlocked: false },
  });
  await enqueueAssuranceEvent({
    workspaceId: setup.workspaceId,
    sourceEventId: "gate:blocked:2",
    eventType: "ai.rateloop.gate.blocked",
    evidenceReference: GATE_REFERENCE,
    evidenceChain: CHAIN,
    occurredAt: NOW,
    now: NOW,
  });
  await enqueueAssuranceEvent({
    workspaceId: setup.workspaceId,
    sourceEventId: "review:failed:2",
    eventType: "ai.rateloop.review.failed",
    evidenceReference: GATE_REFERENCE,
    evidenceChain: CHAIN,
    occurredAt: NOW,
    now: NOW,
  });
  await materializeOversightAlertNotifications({ now: new Date(NOW.getTime() + 2_000) });
  const filtered = await notificationsFor(setup.owner.principalId);
  assert.equal(filtered.filter(row => row.source_type === "oversight.gate_blocked").length, 1);
  assert.equal(filtered.filter(row => row.source_type === "oversight.review_failed").length, 2);
});

test("workspace stop, disagreement spikes, and coverage floors alert with thresholds applied", async () => {
  const setup = await fixture("thresholds");
  const scope = await seedAdaptiveScope({
    workspaceId: setup.workspaceId,
    owner: setup.owner.principalId,
    label: "thresholds",
    stage: "monitoring",
  });
  // 5 of 12 comparable observations disagree → 41.7%, above the 25% default.
  await seedObservations({ workspaceId: setup.workspaceId, scope, disagreements: 5, total: 12 });
  await engageWorkspaceStop({
    accountAddress: setup.owner.principalId,
    workspaceId: setup.workspaceId,
    reason: "Investigating disagreement spike.",
    now: NOW,
  });

  await materializeOversightAlertNotifications({ now: NOW, limit: 50 });
  const alerts = await notificationsFor(setup.owner.principalId);
  const types = alerts.map(row => row.source_type);
  assert.ok(types.includes("oversight.workspace_stopped"));
  assert.ok(types.includes("oversight.disagreement_spike"));
  // Stage rate (monitoring, 10%) is at the configured production floor (10%).
  assert.ok(types.includes("oversight.coverage_floor_hit"));

  // Threshold alerts fire at most once per UTC day.
  const sameDay = await materializeOversightAlertNotifications({ now: new Date(NOW.getTime() + 3_600_000), limit: 50 });
  assert.equal(sameDay.inserted, 0);

  // Raising the threshold above the observed rate and disabling floor alerts
  // silences both on the next day.
  await updateWorkspaceAlertPreferences({
    accountAddress: setup.owner.principalId,
    workspaceId: setup.workspaceId,
    preferences: { ...DEFAULT_WORKSPACE_ALERT_PREFERENCES, disagreementSpikeBps: 9_000, coverageFloorHit: false },
  });
  const nextDay = new Date("2026-07-18T12:00:00.000Z");
  await materializeOversightAlertNotifications({ now: nextDay, limit: 50 });
  const nextDayAlerts = await notificationsFor(setup.owner.principalId);
  assert.equal(nextDayAlerts.filter(row => String(row.source_key).includes("2026-07-18")).length, 0);

  // Lowering the threshold re-arms the spike alert.
  await updateWorkspaceAlertPreferences({
    accountAddress: setup.owner.principalId,
    workspaceId: setup.workspaceId,
    preferences: { ...DEFAULT_WORKSPACE_ALERT_PREFERENCES, disagreementSpikeBps: 4_000, coverageFloorHit: false },
  });
  await materializeOversightAlertNotifications({ now: nextDay, limit: 50 });
  const rearmed = await notificationsFor(setup.owner.principalId);
  assert.equal(
    rearmed.filter(
      row => row.source_type === "oversight.disagreement_spike" && String(row.source_key).includes("2026-07-18"),
    ).length,
    1,
  );
});

test("alert preferences are owner/admin-gated and validated", async () => {
  const setup = await fixture("prefs");
  const defaults = await getWorkspaceAlertPreferences({
    accountAddress: setup.owner.principalId,
    workspaceId: setup.workspaceId,
  });
  assert.deepEqual(defaults, { workspaceId: setup.workspaceId, ...DEFAULT_WORKSPACE_ALERT_PREFERENCES });
  await assert.rejects(
    getWorkspaceAlertPreferences({ accountAddress: setup.member.principalId, workspaceId: setup.workspaceId }),
    (error: TokenlessServiceError) => error.code === "workspace_not_found",
  );
  await assert.rejects(
    updateWorkspaceAlertPreferences({
      accountAddress: setup.owner.principalId,
      workspaceId: setup.workspaceId,
      preferences: { ...DEFAULT_WORKSPACE_ALERT_PREFERENCES, disagreementSpikeBps: 20_000 },
    }),
    (error: TokenlessServiceError) => error.code === "invalid_alert_preferences",
  );
  await assert.rejects(
    updateWorkspaceAlertPreferences({
      accountAddress: setup.owner.principalId,
      workspaceId: setup.workspaceId,
      preferences: { ...DEFAULT_WORKSPACE_ALERT_PREFERENCES, unexpected: true },
    }),
    (error: TokenlessServiceError) => error.code === "invalid_alert_preferences",
  );
});

test("oversight alerts flow through the existing verified-email machinery as an opt-in kind", async () => {
  const setup = await fixture("email");
  await engageWorkspaceStop({
    accountAddress: setup.owner.principalId,
    workspaceId: setup.workspaceId,
    reason: "Email pipeline test.",
    now: NOW,
  });
  await materializeOversightAlertNotifications({ now: NOW });

  // No subscription yet: nothing enqueues, nothing is ever sent unverified.
  const withoutSubscription = await enqueueTokenlessNotificationEmails({ now: NOW });
  assert.equal(withoutSubscription.inserted, 0);

  // A verified subscription that opted in receives exactly one email.
  await dbClient.execute({
    sql: `INSERT INTO tokenless_notification_email_subscriptions
          (principal_address, email, verified_at, unsubscribe_token_hash,
           assignment_available, assignment_completed, payment_updates, ask_results, account_security,
           oversight_alerts, created_at, updated_at)
          VALUES (?, 'owner@example.test', ?, ?, true, true, true, true, true, true, ?, ?)`,
    args: [setup.owner.principalId, new Date(NOW.getTime() - 60_000), "ab".repeat(32), NOW, NOW],
  });
  const enqueued = await enqueueTokenlessNotificationEmails({ now: NOW });
  assert.equal(enqueued.inserted, 1);
  const sent: Array<{ email: string; title: string }> = [];
  const outcomes = await deliverPendingTokenlessNotificationEmails({
    appOrigin: APP_ORIGIN,
    now: NOW,
    unsubscribeSecret: "oversight-alert-email-test-secret-0001",
    send: async input => {
      sent.push({ email: input.email, title: input.title });
      return { id: "resend-test-1" };
    },
  });
  assert.deepEqual(
    outcomes.map(outcome => outcome.state),
    ["delivered"],
  );
  assert.deepEqual(sent, [{ email: "owner@example.test", title: "Workspace stop engaged" }]);

  // Opting back out suppresses future deliveries of the kind.
  await dbClient.execute({
    sql: "UPDATE tokenless_notification_email_subscriptions SET oversight_alerts = false WHERE principal_address = ?",
    args: [setup.owner.principalId],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_notifications
          (notification_id, principal_address, kind, title, body, href, preference_key, source_type, source_key, created_at)
          VALUES ('tn_suppressed_alert', ?, 'oversightAlerts', 'Review failed', 'Body', '/agents', 'oversightAlerts',
                  'oversight.review_failed', 'suppress-1', ?)`,
    args: [setup.owner.principalId, NOW],
  });
  await enqueueTokenlessNotificationEmails({ now: NOW });
  const suppressed = await deliverPendingTokenlessNotificationEmails({
    appOrigin: APP_ORIGIN,
    now: NOW,
    unsubscribeSecret: "oversight-alert-email-test-secret-0001",
    send: async () => {
      throw new Error("suppressed notifications must not send email");
    },
  });
  assert.deepEqual(
    suppressed.map(outcome => outcome.state),
    ["suppressed"],
  );
});

test("the inbox lists notifications with an unread count and marks them read", async () => {
  const setup = await fixture("inbox");
  await engageWorkspaceStop({
    accountAddress: setup.owner.principalId,
    workspaceId: setup.workspaceId,
    reason: "Inbox test.",
    now: NOW,
  });
  await materializeOversightAlertNotifications({ now: NOW });

  const inbox = await listNotificationInbox({ accountAddress: setup.owner.principalId });
  assert.equal(inbox.unreadCount, 1);
  assert.equal(inbox.notifications[0]?.title, "Workspace stop engaged");
  assert.equal(inbox.notifications[0]?.readAt, null);

  const marked = await markNotificationInboxRead({ accountAddress: setup.owner.principalId, now: NOW });
  assert.equal(marked.marked, 1);
  const after = await listNotificationInbox({ accountAddress: setup.owner.principalId });
  assert.equal(after.unreadCount, 0);
  assert.notEqual(after.notifications[0]?.readAt, null);
  await assert.rejects(
    markNotificationInboxRead({ accountAddress: setup.owner.principalId, notificationIds: [] }),
    (error: TokenlessServiceError) => error.code === "invalid_notification_read",
  );
});

test("alert-preference and inbox routes require a session and stay no-store", async () => {
  const setup = await fixture("routes");
  const preferencesContext = { params: Promise.resolve({ workspaceId: setup.workspaceId }) };
  const request = (path: string, init?: RequestInit, token: string | null = setup.session.token) =>
    new NextRequest(`${APP_ORIGIN}${path}`, {
      ...init,
      headers: {
        ...(init?.headers as Record<string, string> | undefined),
        ...(token ? { cookie: `${AUTH_SESSION_COOKIE}=${token}` } : {}),
      },
    } as ConstructorParameters<typeof NextRequest>[1]);

  const unauthenticated = await getAlertPreferences(
    request(`/api/account/workspaces/${setup.workspaceId}/oversight/alert-preferences`, undefined, null),
    preferencesContext,
  );
  assert.equal(unauthenticated.status, 401);

  const loaded = await getAlertPreferences(
    request(`/api/account/workspaces/${setup.workspaceId}/oversight/alert-preferences`),
    preferencesContext,
  );
  assert.equal(loaded.status, 200);
  assert.equal(loaded.headers.get("cache-control"), "private, no-store");
  const loadedBody = (await loaded.json()) as { preferences: { gateBlocked: boolean } };
  assert.equal(loadedBody.preferences.gateBlocked, true);

  const updated = await putAlertPreferences(
    request(`/api/account/workspaces/${setup.workspaceId}/oversight/alert-preferences`, {
      method: "PUT",
      headers: { "content-type": "application/json", origin: APP_ORIGIN },
      body: JSON.stringify({ preferences: { ...DEFAULT_WORKSPACE_ALERT_PREFERENCES, browserEnabled: true } }),
    }),
    preferencesContext,
  );
  assert.equal(updated.status, 200);
  const updatedBody = (await updated.json()) as { preferences: { browserEnabled: boolean } };
  assert.equal(updatedBody.preferences.browserEnabled, true);

  const inboxResponse = await getInbox(request("/api/notifications/inbox"));
  assert.equal(inboxResponse.status, 200);
  assert.equal(inboxResponse.headers.get("cache-control"), "private, no-store");
  const inboxBody = (await inboxResponse.json()) as { unreadCount: number; notifications: unknown[] };
  assert.equal(inboxBody.unreadCount, 0);

  const markResponse = await postInbox(
    request("/api/notifications/inbox", {
      method: "POST",
      headers: { "content-type": "application/json", origin: APP_ORIGIN },
      body: JSON.stringify({}),
    }),
  );
  assert.equal(markResponse.status, 200);
  assert.equal((await getInbox(request("/api/notifications/inbox", undefined, null))).status, 401);
});

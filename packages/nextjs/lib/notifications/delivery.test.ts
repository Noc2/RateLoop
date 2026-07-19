import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  __notificationDeliveryTestUtils,
  deliverPendingTokenlessNotificationEmails,
  enqueueTokenlessNotificationEmails,
  materializeTokenlessLifecycleNotifications,
} from "~~/lib/notifications/delivery";
import { unsubscribeTokenlessEmailNotificationToken } from "~~/lib/notifications/tokenless";

const NOW = new Date("2026-07-14T16:00:00.000Z");
const PRINCIPAL = "0x1111111111111111111111111111111111111111";
const SECOND_PRINCIPAL = "0x2222222222222222222222222222222222222222";
const MEMBER_PRINCIPAL = "0x3333333333333333333333333333333333333333";
const SECRET = "notification-unsubscribe-test-secret-0001";
const UNSUBSCRIBE_HASH = createHash("sha256").update("unsubscribe-seed").digest("hex");

beforeEach(async () => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  await dbClient.execute({
    sql: `INSERT INTO tokenless_browser_identities
          (principal_address, auth_provider, email_verified, created_at, updated_at, last_login_at)
          VALUES (?, 'email', true, ?, ?, ?)`,
    args: [PRINCIPAL, NOW, NOW, NOW],
  });
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
});

async function seedVerifiedSubscription() {
  await dbClient.execute({
    sql: `INSERT INTO tokenless_notification_email_subscriptions
          (principal_address, email, verified_at, unsubscribe_token_hash,
           assignment_available, assignment_completed, payment_updates, ask_results, account_security,
           created_at, updated_at)
          VALUES (?, 'reviewer@example.test', ?, ?, true, true, true, true, true, ?, ?)`,
    args: [PRINCIPAL, new Date(NOW.getTime() - 60_000), UNSUBSCRIBE_HASH, NOW, NOW],
  });
}

async function insertGenericLifecycleNotification(sourceKey = "assignment-1") {
  return __notificationDeliveryTestUtils.insertLifecycleCandidates(
    [
      {
        body: "A human-assurance assignment is ready for review.",
        href: "/human?tab=discover",
        preferenceKey: "assignmentAvailable",
        principalAddress: PRINCIPAL,
        sourceKey,
        sourceType: "assignment.available",
        title: "Assignment available",
      },
    ],
    NOW,
  );
}

async function seedBrowserIdentity(principal: string) {
  await dbClient.execute({
    sql: `INSERT INTO tokenless_browser_identities
          (principal_address, auth_provider, email_verified, created_at, updated_at, last_login_at)
          VALUES (?, 'email', true, ?, ?, ?)`,
    args: [principal, NOW, NOW, NOW],
  });
}

async function seedPrivateAssignment() {
  const policyHash = `sha256:${"a".repeat(64)}`;
  const manifestHash = `sha256:${"b".repeat(64)}`;
  const groupPolicyHash = `sha256:${"c".repeat(64)}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspaces (workspace_id, name, created_at, updated_at)
          VALUES ('workspace-private-assignment', 'Private assignment', ?, ?)`,
    args: [NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_projects
          (project_id, workspace_id, name, data_classification, retention_days, created_by, created_at, updated_at)
          VALUES ('project-private-assignment', 'workspace-private-assignment', 'Private project',
                  'confidential', 30, ?, ?, ?)`,
    args: [PRINCIPAL, NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_rubrics
          (rubric_id, project_id, version, prompt, failure_tags_json, rationale_json, pass_rule_json, rubric_json, created_at)
          VALUES ('rubric-private-assignment', 'project-private-assignment', 1, 'Choose', '[]', '{}', '{}', '{}', ?)`,
    args: [NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_suites
          (suite_id, project_id, name, version, status, rubric_id, rubric_version,
           manifest_hash, manifest_json, frozen_at, created_at, updated_at)
          VALUES ('suite-private-assignment', 'project-private-assignment', 'Suite', 1, 'frozen',
                  'rubric-private-assignment', 1, ?, '{}', ?, ?, ?)`,
    args: [manifestHash, NOW, NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_audience_policies
          (policy_id, project_id, version, reviewer_source, compensation, cohorts_json, selection,
           fallbacks_json, required_qualifications_json, assurance_json, buyer_privacy_json,
           legal_eligibility_required, policy_hash, policy_json, created_at)
          VALUES ('policy-private-assignment', 'project-private-assignment', 1, 'customer_invited', 'unpaid',
                  '[]', 'customer_named', '{}', '[]', '{}', '{}', false, ?, '{}', ?)`,
    args: [policyHash, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_runs
          (run_id, project_id, suite_id, suite_version, audience_policy_id, audience_policy_version,
           status, policy_hash, manifest_hash, manifest_json, created_by, created_at, updated_at, frozen_at)
          VALUES ('run-private-assignment', 'project-private-assignment', 'suite-private-assignment', 1,
                  'policy-private-assignment', 1, 'recruiting', ?, ?, '{}', ?, ?, ?, ?)`,
    args: [policyHash, manifestHash, PRINCIPAL, NOW, NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_private_groups
          (group_id, workspace_id, name, purpose, status, current_policy_version, created_by, created_at, updated_at)
          VALUES ('group-private-assignment', 'workspace-private-assignment', 'Employees', 'Internal review',
                  'active', 1, ?, ?, ?)`,
    args: [PRINCIPAL, NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_private_group_policy_versions
          (group_id, version, default_compensation, policy_hash, policy_json, created_by, created_at)
          VALUES ('group-private-assignment', 1, 'unpaid', ?, '{}', ?, ?)`,
    args: [groupPolicyHash, PRINCIPAL, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_cohorts
          (cohort_id, project_id, name, source, selection, capacity, qualification_rules_json,
           status, created_by, created_at, updated_at, private_group_id)
          VALUES ('cohort-private-assignment', 'project-private-assignment', 'Employees', 'customer_invited',
                  'customer_named', 1, '[]', 'active', ?, ?, ?, 'group-private-assignment')`,
    args: [PRINCIPAL, NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_cohort_reviewers
          (project_id, cohort_id, reviewer_account_address, qualification_provenance_json,
           maximum_active_assignments, active_reservations, status, created_by, created_at, updated_at)
          VALUES ('project-private-assignment', 'cohort-private-assignment', ?, '[]', 1, 1, 'active', ?, ?, ?)`,
    args: [PRINCIPAL, PRINCIPAL, NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_run_subpanels
          (subpanel_id, workspace_id, project_id, run_id, cohort_id, source, selection, target_count,
           active_reservations, policy_id, policy_version, policy_hash, run_manifest_hash, created_at,
           private_group_id, private_group_policy_version, private_group_policy_hash)
          VALUES ('subpanel-private-assignment', 'workspace-private-assignment', 'project-private-assignment',
                  'run-private-assignment', 'cohort-private-assignment', 'customer_invited', 'customer_named',
                  1, 1, 'policy-private-assignment', 1, ?, ?, ?, 'group-private-assignment', 1, ?)`,
    args: [policyHash, manifestHash, NOW, groupPolicyHash],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_private_group_memberships
          (group_id, principal_address, role, status, joined_at, membership_expires_at, created_by, updated_at)
          VALUES ('group-private-assignment', ?, 'reviewer', 'active', ?, ?, ?, ?)`,
    args: [PRINCIPAL, NOW, new Date(NOW.getTime() - 60_000), PRINCIPAL, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_assignments
          (assignment_id, workspace_id, project_id, run_id, subpanel_id, cohort_id, reviewer_account_address,
           source, selection, status, confidentiality_terms_hash, qualification_provenance_json, blinding_json,
           assurance_snapshot_json, assurance_snapshot_hash, paid_assignment, reservation_expires_at,
           lease_issuer_account_address, lease_state, recovery_count,
           created_at, updated_at, private_group_id, private_group_policy_version, private_group_policy_hash,
           private_group_membership_joined_at)
          VALUES ('assignment-private', 'workspace-private-assignment', 'project-private-assignment',
                  'run-private-assignment', 'subpanel-private-assignment', 'cohort-private-assignment', ?,
                  'customer_invited', 'customer_named', 'reserved', ?, '[]', '{}', '{}', ?, false, ?, ?, 'pending', 0,
                  ?, ?, 'group-private-assignment', 1, ?, ?)`,
    args: [
      PRINCIPAL,
      `sha256:${"d".repeat(64)}`,
      `sha256:${"e".repeat(64)}`,
      new Date(NOW.getTime() + 60_000),
      PRINCIPAL,
      NOW,
      NOW,
      groupPolicyHash,
      new Date(NOW.getTime() - 120_000),
    ],
  });
}

test("settled lifecycle evidence creates one privacy-minimal in-app notification", async () => {
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspaces (workspace_id, name, created_at, updated_at)
          VALUES ('workspace-private-name', 'Highly Sensitive Customer', ?, ?)`,
    args: [NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_members (workspace_id, account_address, role, created_at)
          VALUES ('workspace-private-name', ?, 'owner', ?)`,
    args: [PRINCIPAL, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_prepaid_ledger_entries
          (entry_id, workspace_id, delta_atomic, settlement_status, source, created_at, settled_at)
          VALUES ('ledger-sensitive-source', 'workspace-private-name', 999999999, 'settled', 'private-bank-reference', ?, ?)`,
    args: [NOW, NOW],
  });

  assert.deepEqual(await materializeTokenlessLifecycleNotifications({ now: NOW }), { candidates: 1, inserted: 1 });
  assert.deepEqual(await materializeTokenlessLifecycleNotifications({ now: NOW }), { candidates: 0, inserted: 0 });
  const stored = await dbClient.execute(
    "SELECT kind, title, body, href, source_type, source_key FROM tokenless_notifications",
  );
  assert.deepEqual(stored.rows[0], {
    kind: "paymentUpdates",
    title: "Workspace funds updated",
    body: "A workspace balance update was settled.",
    href: "/agents?tab=overview",
    source_type: "payment.settled",
    source_key: "ledger-sensitive-source",
  });
  assert.doesNotMatch(JSON.stringify(stored.rows), /999999999|Highly Sensitive Customer|private-bank-reference/u);
});

test("private assignment notices require the exact current active group-membership snapshot", async () => {
  await seedPrivateAssignment();
  assert.deepEqual(await materializeTokenlessLifecycleNotifications({ now: NOW }), { candidates: 0, inserted: 0 });
  await dbClient.execute({
    sql: `UPDATE tokenless_assurance_assignments SET private_group_membership_joined_at = ?
          WHERE assignment_id = 'assignment-private'`,
    args: [NOW],
  });
  assert.deepEqual(await materializeTokenlessLifecycleNotifications({ now: NOW }), { candidates: 0, inserted: 0 });
  await dbClient.execute({
    sql: `UPDATE tokenless_private_group_memberships SET membership_expires_at = ?, updated_at = ?
          WHERE group_id = 'group-private-assignment' AND principal_address = ?`,
    args: [new Date(NOW.getTime() + 60_000), NOW, PRINCIPAL],
  });
  assert.deepEqual(await materializeTokenlessLifecycleNotifications({ now: NOW }), { candidates: 1, inserted: 1 });
});

test("API-key ask results fan out only to active workspace owners and admins", async () => {
  await seedBrowserIdentity(SECOND_PRINCIPAL);
  await seedBrowserIdentity(MEMBER_PRINCIPAL);
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspaces (workspace_id, name, status, created_at, updated_at)
          VALUES ('workspace-api-result', 'API workspace', 'active', ?, ?)`,
    args: [NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_members (workspace_id, account_address, role, created_at)
          VALUES ('workspace-api-result', ?, 'owner', ?),
                 ('workspace-api-result', ?, 'admin', ?),
                 ('workspace-api-result', ?, 'member', ?)`,
    args: [PRINCIPAL, NOW, SECOND_PRINCIPAL, NOW, MEMBER_PRINCIPAL, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_quotes
          (quote_id, request_hash, request_json, response_json, expires_at, created_at)
          VALUES ('quote-api-result', 'hash-api-result', '{"visibility":"public"}', '{}', ?, ?)`,
    args: [new Date(NOW.getTime() + 60_000), NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_asks
          (operation_key, idempotency_key, request_hash, quote_id, request_json, economics_json,
           status, created_at, updated_at)
          VALUES ('operation-api-result', 'api-result-idempotency', 'ask-hash', 'quote-api-result',
                  '{}', '{}', 'complete', ?, ?)`,
    args: [NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_content_records
          (content_id, workspace_id, content_hash, content_json, moderation_status, created_at, updated_at)
          VALUES ('content-api-result', 'workspace-api-result', 'content-hash', '{}', 'approved', ?, ?)`,
    args: [NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_question_records
          (question_id, workspace_id, content_id, quote_id, terms_hash, terms_json,
           moderation_status, created_at, updated_at)
          VALUES ('question-api-result', 'workspace-api-result', 'content-api-result', 'quote-api-result',
                  'terms-hash', '{}', 'approved', ?, ?)`,
    args: [NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_ask_ownership
          (operation_key, workspace_id, owner_account_address, question_id, payment_mode, payment_state,
           payment_reference, idempotency_key, created_at, updated_at)
          VALUES ('operation-api-result', 'workspace-api-result', NULL, 'question-api-result', 'prepaid',
                  'settled', 'payment-api-result', 'api-result-idempotency', ?, ?)`,
    args: [NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_result_publications
          (publication_id, operation_key, publication_version, verdict_status, evidence_root, result_json, published_at)
          VALUES ('publication-api-result', 'operation-api-result', 1, 'approved', 'evidence-root', '{}', ?)`,
    args: [NOW],
  });

  assert.deepEqual(await materializeTokenlessLifecycleNotifications({ now: NOW }), { candidates: 2, inserted: 2 });
  const recipients = await dbClient.execute(
    "SELECT principal_address FROM tokenless_notifications WHERE source_type = 'ask.result' ORDER BY principal_address",
  );
  assert.deepEqual(
    recipients.rows.map(row => row.principal_address),
    [PRINCIPAL, SECOND_PRINCIPAL],
  );
  assert.deepEqual(await materializeTokenlessLifecycleNotifications({ now: NOW }), { candidates: 0, inserted: 0 });
});

test("verified preferences enqueue once and delivery uses a signed unsubscribe link", async () => {
  await seedVerifiedSubscription();
  assert.equal(await insertGenericLifecycleNotification(), 1);
  assert.deepEqual(await enqueueTokenlessNotificationEmails({ now: NOW }), { candidates: 1, inserted: 1 });
  assert.deepEqual(await enqueueTokenlessNotificationEmails({ now: NOW }), { candidates: 0, inserted: 0 });

  let sent:
    | {
        actionUrl: string;
        body: string;
        email: string;
        idempotencyKey: string;
        title: string;
        unsubscribeUrl: string;
      }
    | undefined;
  const outcomes = await deliverPendingTokenlessNotificationEmails({
    appOrigin: "https://tokenless.example.test",
    now: NOW,
    unsubscribeSecret: SECRET,
    async send(params) {
      sent = params;
      return { id: "resend-message-1" };
    },
  });
  assert.equal(outcomes[0]?.state, "delivered");
  assert.equal(sent?.actionUrl, "https://tokenless.example.test/human?tab=discover");
  assert.equal(sent?.email, "reviewer@example.test");
  assert.doesNotMatch(JSON.stringify(sent), /assignment-1|0x1111/u);
  const unsubscribeUrl = new URL(sent!.unsubscribeUrl);
  assert.equal(unsubscribeUrl.origin, "https://tokenless.example.test");
  assert.equal(unsubscribeUrl.pathname, "/api/notifications/email/unsubscribe");
  const token = unsubscribeUrl.searchParams.get("token")!;
  assert.match(token, /^v1\./u);
  assert.deepEqual(await unsubscribeTokenlessEmailNotificationToken(`${token}tampered`, SECRET), { ok: false });
  assert.deepEqual(await unsubscribeTokenlessEmailNotificationToken(token, SECRET), { ok: true });
  assert.deepEqual(await unsubscribeTokenlessEmailNotificationToken(token, SECRET), { ok: true });
  const subscription = await dbClient.execute(
    "SELECT principal_address FROM tokenless_notification_email_subscriptions",
  );
  assert.equal(subscription.rows.length, 0);
});

test("delivery rechecks preferences and suppresses mail disabled after enqueue", async () => {
  await seedVerifiedSubscription();
  await insertGenericLifecycleNotification();
  await enqueueTokenlessNotificationEmails({ now: NOW });
  await dbClient.execute({
    sql: `UPDATE tokenless_notification_email_subscriptions
          SET assignment_available = false, updated_at = ? WHERE principal_address = ?`,
    args: [NOW, PRINCIPAL],
  });
  let sends = 0;
  const outcomes = await deliverPendingTokenlessNotificationEmails({
    appOrigin: "https://tokenless.example.test",
    now: NOW,
    unsubscribeSecret: SECRET,
    async send() {
      sends += 1;
      return { id: "must-not-send" };
    },
  });
  assert.deepEqual(
    outcomes.map(value => value.state),
    ["suppressed"],
  );
  assert.equal(sends, 0);
  const delivery = await dbClient.execute(
    "SELECT state, attempt_count, suppressed_at FROM tokenless_notification_email_deliveries",
  );
  assert.equal(delivery.rows[0]?.state, "suppressed");
  assert.equal(Number(delivery.rows[0]?.attempt_count), 0);
  assert.ok(delivery.rows[0]?.suppressed_at);
});

test("bounded delivery retries end in a visible dead letter", async () => {
  await seedVerifiedSubscription();
  await insertGenericLifecycleNotification();
  await enqueueTokenlessNotificationEmails({ now: NOW });
  await dbClient.execute("UPDATE tokenless_notification_email_deliveries SET attempt_count = 7");
  const outcomes = await deliverPendingTokenlessNotificationEmails({
    appOrigin: "https://tokenless.example.test",
    now: NOW,
    unsubscribeSecret: SECRET,
    async send() {
      throw new Error("provider unavailable");
    },
  });
  assert.deepEqual(
    outcomes.map(value => value.state),
    ["dead"],
  );
  const delivery = await dbClient.execute(
    "SELECT state, attempt_count, last_error, dead_at FROM tokenless_notification_email_deliveries",
  );
  assert.equal(delivery.rows[0]?.state, "dead");
  assert.equal(Number(delivery.rows[0]?.attempt_count), 8);
  assert.equal(delivery.rows[0]?.last_error, "provider unavailable");
  assert.ok(delivery.rows[0]?.dead_at);
});

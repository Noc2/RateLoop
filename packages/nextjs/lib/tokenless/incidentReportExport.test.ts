import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, test } from "node:test";
import { GET as getConfiguration } from "~~/app/api/account/workspaces/[workspaceId]/oversight/configuration/route";
import { resolveBetterAuthPrincipal } from "~~/lib/auth/principal";
import { AUTH_SESSION_COOKIE, createAuthSession } from "~~/lib/auth/session";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { enqueueAssuranceEvent } from "~~/lib/tokenless/assuranceEventStreaming";
import { recordAssuranceOverrideDecision } from "~~/lib/tokenless/evidencePackets";
import { buildIncidentReportExport, exportOversightConfiguration } from "~~/lib/tokenless/incidentReportExport";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import { engageWorkspaceStop } from "~~/lib/tokenless/workspaceStopControl";

const APP_ORIGIN = "https://tokenless.example.test";
const MEMBER = "0x3333333333333333333333333333333333333333";
const NOW = new Date("2026-07-17T12:00:00.000Z");
const FROM = new Date("2026-07-01T00:00:00.000Z");
const TO = new Date("2026-07-18T00:00:00.000Z");
const HASH = (character: string) => `sha256:${character.repeat(64)}`;
const CHAIN = {
  schemaVersion: "rateloop.audit-chain-reference.v1" as const,
  eventHash: HASH("2"),
  previousHash: null,
  sequence: 0,
};

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

async function fixture(label: string) {
  const identity = await resolveBetterAuthPrincipal({
    betterAuthUserId: `better_incident_export_${label}`,
    method: "passkey",
  });
  const session = await createAuthSession(identity);
  const { workspaceId } = await createWorkspace({ name: `Incident ${label}`, ownerAddress: identity.principalId });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_members (workspace_id, account_address, role, created_at)
          VALUES (?, ?, 'member', ?)`,
    args: [workspaceId, MEMBER, NOW],
  });

  // Minimal completed run with an evidence packet for override + packet refs.
  const projectId = `project_incident_${label}`;
  const rubricId = `rubric_incident_${label}`;
  const suiteId = `suite_incident_${label}`;
  const audiencePolicyId = `policy_incident_${label}`;
  const runId = `run_incident_${label}`;
  const packetId = `haep_incident_${label}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_projects
          (project_id, workspace_id, name, data_classification, status, retention_days, created_by, created_at, updated_at)
          VALUES (?, ?, 'Incident evidence', 'confidential', 'active', 30, ?, ?, ?)`,
    args: [projectId, workspaceId, identity.principalId, NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_rubrics
          (rubric_id, project_id, version, prompt, failure_tags_json, rationale_json, pass_rule_json, rubric_json, created_at)
          VALUES (?, ?, 1, 'Review', '[]', '{}', '{}', '{}', ?)`,
    args: [rubricId, projectId, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_suites
          (suite_id, project_id, name, version, status, rubric_id, rubric_version, manifest_hash, manifest_json,
           frozen_at, created_at, updated_at)
          VALUES (?, ?, 'Incident suite', 1, 'frozen', ?, 1, ?, '{}', ?, ?, ?)`,
    args: [suiteId, projectId, rubricId, HASH("b"), NOW, NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_audience_policies
          (policy_id, project_id, version, reviewer_source, compensation, cohorts_json, selection,
           fallbacks_json, required_qualifications_json, assurance_json, buyer_privacy_json,
           legal_eligibility_required, policy_hash, policy_json, created_at)
          VALUES (?, ?, 1, 'customer_invited', 'unpaid', '[]', 'customer_named', '{}', '[]', '{}', '{}', false, ?, '{}', ?)`,
    args: [audiencePolicyId, projectId, HASH("d"), NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_runs
          (run_id, project_id, suite_id, suite_version, audience_policy_id, audience_policy_version,
           status, policy_hash, manifest_hash, manifest_json, created_by, created_at, updated_at, completed_at)
          VALUES (?, ?, ?, 1, ?, 1, 'completed', ?, ?, '{}', ?, ?, ?, ?)`,
    args: [runId, projectId, suiteId, audiencePolicyId, HASH("d"), HASH("b"), identity.principalId, NOW, NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_evidence_packets
          (packet_id, run_id, manifest_hash, case_root, response_root, aggregation_version, result_json,
           limitations_json, chain_references_json, signature, generated_at, packet_digest, packet_json,
           signature_algorithm, signing_key_id, signing_public_key)
          VALUES (?, ?, ?, 'case-root', 'response-root', 'v1', '{}', '[]', '{}', 'signature', ?, ?, '{}',
                  'Ed25519', 'key-test', 'public-key')`,
    args: [packetId, runId, HASH("e"), NOW, HASH("f")],
  });
  return { identity, session, workspaceId, runId, packetId };
}

test("incident export maps the draft template: narrative, timeline, overrides, stop actions, and references", async () => {
  const setup = await fixture("mapping");
  await enqueueAssuranceEvent({
    workspaceId: setup.workspaceId,
    sourceEventId: "gate:blocked:incident",
    eventType: "ai.rateloop.gate.blocked",
    evidenceReference: {
      schemaVersion: "rateloop.assurance-event-reference.v1",
      kind: "gate_transition",
      digest: HASH("3"),
    },
    evidenceChain: CHAIN,
    occurredAt: NOW,
    now: NOW,
  });
  await enqueueAssuranceEvent({
    workspaceId: setup.workspaceId,
    sourceEventId: "review:failed:incident",
    eventType: "ai.rateloop.review.failed",
    evidenceReference: {
      schemaVersion: "rateloop.assurance-event-reference.v1",
      kind: "gate_transition",
      digest: HASH("4"),
    },
    evidenceChain: CHAIN,
    occurredAt: NOW,
    now: NOW,
  });
  await engageWorkspaceStop({
    accountAddress: setup.identity.principalId,
    workspaceId: setup.workspaceId,
    reason: "Contained the incident pending investigation.",
    now: NOW,
  });
  await recordAssuranceOverrideDecision({
    accountAddress: setup.identity.principalId,
    workspaceId: setup.workspaceId,
    runId: setup.runId,
    outcome: "reversed",
    reasons: "The delivered output was withdrawn after the incident review.",
    now: NOW,
  });

  const exported = await buildIncidentReportExport({
    accountAddress: setup.identity.principalId,
    workspaceId: setup.workspaceId,
    description: "An agent output reached a customer with incorrect refund guidance.",
    from: FROM,
    to: TO,
    now: NOW,
  });
  assert.equal(exported.schemaVersion, "rateloop.incident-report-draft.v1");
  assert.equal(exported.incident.narrative, "An agent output reached a customer with incorrect refund guidance.");
  assert.deepEqual(exported.eventTimeline.map(event => event.eventType).sort(), [
    "ai.rateloop.gate.blocked",
    "ai.rateloop.review.failed",
  ]);
  assert.equal(exported.overrideDecisions.length, 1);
  assert.equal(exported.overrideDecisions[0]?.outcome, "reversed");
  assert.match(exported.overrideDecisions[0]?.recordDigest ?? "", /^sha256:/);
  assert.equal(exported.workspaceStop.currentStatus, "engaged");
  assert.deepEqual(
    exported.workspaceStop.actions.map(action => action.action),
    ["workspace.stop_engaged"],
  );
  assert.deepEqual(exported.decisionPacketReferences, [
    { packetId: setup.packetId, runId: setup.runId, packetDigest: HASH("f"), generatedAt: NOW.toISOString() },
  ]);
  assert.ok(exported.retention);
  assert.equal(exported.counts.timelineEvents, 2);
  // Reasons, deciders, and stop reasons stay in the workspace: only digests
  // and outcomes enter the export.
  const serialized = JSON.stringify(exported);
  assert.doesNotMatch(serialized, /withdrawn after the incident review/);
  assert.doesNotMatch(serialized, /Contained the incident pending investigation/);
  assert.doesNotMatch(serialized, new RegExp(setup.identity.principalId, "u"));
  const audit = await dbClient.execute({
    sql: `SELECT action FROM tokenless_audit_events
          WHERE workspace_id = ? AND action = 'oversight.incident_report_export'`,
    args: [setup.workspaceId],
  });
  assert.equal(audit.rows.length, 1);
});

test("labeling: draft-template caveat and responsibility line present, compliance claims absent", async () => {
  const setup = await fixture("labeling");
  const exported = await buildIncidentReportExport({
    accountAddress: setup.identity.principalId,
    workspaceId: setup.workspaceId,
    description: "Narrative for labeling checks.",
    from: FROM,
    to: TO,
    now: NOW,
  });
  assert.match(exported.templateAlignment.label, /DRAFT serious-incident reporting template \(2025 consultation\)/);
  assert.match(exported.templateAlignment.label, /verify against the\s+final template before regulatory use/);
  const configuration = await exportOversightConfiguration({
    accountAddress: setup.identity.principalId,
    workspaceId: setup.workspaceId,
    now: NOW,
  });
  assert.equal(configuration.schemaVersion, "rateloop.oversight-configuration.v1");
  assert.match(configuration.purpose, /fundamental-rights impact assessment/);
  assert.match(configuration.outputGate.safeState, /held undelivered by default/);
  assert.equal(configuration.stopControl.status, "never_engaged");
  assert.equal(configuration.alertPreferences.disagreementSpikeBps, 2_500);
  assert.equal(
    configuration.decisionControls.overrideRecording,
    "append_only_per_output_records_with_mandatory_reasons",
  );
  for (const serialized of [JSON.stringify(exported), JSON.stringify(configuration)]) {
    assert.doesNotMatch(serialized, /makes you compliant|satisfies article|presumption of conformity/iu);
    assert.match(serialized, /depends on your system, context, and organization/);
  }
});

test("authz: owners and admins only, mutation route stays same-origin with an exact allowlist", async () => {
  const setup = await fixture("authz");
  await assert.rejects(
    buildIncidentReportExport({
      accountAddress: MEMBER,
      workspaceId: setup.workspaceId,
      description: "Member attempt.",
      now: NOW,
    }),
    (error: TokenlessServiceError) => error.code === "workspace_not_found",
  );
  await assert.rejects(
    exportOversightConfiguration({ accountAddress: MEMBER, workspaceId: setup.workspaceId }),
    (error: TokenlessServiceError) => error.code === "workspace_not_found",
  );
  await assert.rejects(
    buildIncidentReportExport({
      accountAddress: setup.identity.principalId,
      workspaceId: setup.workspaceId,
      description: "   ",
      now: NOW,
    }),
    (error: TokenlessServiceError) => error.code === "invalid_incident_report",
  );

  const context = { params: Promise.resolve({ workspaceId: setup.workspaceId }) };
  const request = (token: string | null = setup.session.token) =>
    new NextRequest(`${APP_ORIGIN}/api/account/workspaces/${setup.workspaceId}/oversight/configuration`, {
      headers: token ? { cookie: `${AUTH_SESSION_COOKIE}=${token}` } : {},
    });
  assert.equal((await getConfiguration(request(null), context)).status, 401);
  const response = await getConfiguration(request(), context);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");

  const incidentRoute = readFileSync(
    new URL("../../app/api/account/workspaces/[workspaceId]/oversight/incident-report/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(incidentRoute, /requireBrowserSession\(request, \{ mutation: true \}\)/u);
  assert.match(incidentRoute, /\["description", "from", "to"\]/u);
  assert.match(incidentRoute, /buildIncidentReportExport/u);
  assert.doesNotMatch(incidentRoute, /export async function (GET|PUT|DELETE)/u);
});

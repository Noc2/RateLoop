import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, test } from "node:test";
import { GET } from "~~/app/api/account/workspaces/[workspaceId]/stop/route";
import { resolveBetterAuthPrincipal } from "~~/lib/auth/principal";
import { AUTH_SESSION_COOKIE, createAuthSession } from "~~/lib/auth/session";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  __adaptiveReviewServiceTestUtils,
  authenticateAdaptiveReviewPrincipal,
  evaluateAdaptiveReviewRequirement,
} from "~~/lib/tokenless/adaptiveReviewService";
import { createWorkspaceAgent } from "~~/lib/tokenless/agentRegistry";
import { createAgentPublishingPolicy, createWorkspace, createWorkspaceApiKey } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import { seedReadyHumanReviewBinding } from "~~/lib/tokenless/testing/humanReviewBindingFixture";
import {
  engageWorkspaceStop,
  getWorkspaceStopState,
  isWorkspaceStopEngaged,
  releaseWorkspaceStop,
} from "~~/lib/tokenless/workspaceStopControl";

const APP_ORIGIN = "https://tokenless.example.test";
const MEMBER = "0x3333333333333333333333333333333333333333";
const NOW = new Date("2026-07-17T12:00:00.000Z");
const originalSamplerKey = process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY;
const originalSamplerVersion = process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION;

beforeEach(() => {
  process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY = "77".repeat(32);
  process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION = "sampler-test-v1";
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
  if (originalSamplerKey === undefined) delete process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY;
  else process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY = originalSamplerKey;
  if (originalSamplerVersion === undefined) delete process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION;
  else process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION = originalSamplerVersion;
});

async function fixture(label: string) {
  const identity = await resolveBetterAuthPrincipal({
    betterAuthUserId: `better_workspace_stop_${label}`,
    method: "passkey",
  });
  const session = await createAuthSession(identity);
  const { workspaceId } = await createWorkspace({ name: `Stop ${label}`, ownerAddress: identity.principalId });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_members (workspace_id,account_address,role,created_at)
          VALUES (?,?,'member',?)`,
    args: [workspaceId, MEMBER, NOW],
  });
  const agent = await createWorkspaceAgent({
    accountAddress: identity.principalId,
    workspaceId,
    externalId: `stop-agent-${label}`,
    version: {
      displayName: "Stop Agent",
      provider: "OpenAI",
      model: "gpt-test",
      modelVersion: "2026-07-14",
      environment: "production",
    },
  });
  const audiencePolicy = { reviewerSource: "public_network" };
  const audiencePolicyHash = __adaptiveReviewServiceTestUtils.sha256(audiencePolicy);
  const policyId = `arp_stop_${label}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_review_policies
          (policy_id, version, workspace_id, agent_id, agent_version_id, mode, enabled,
           agreement_threshold_bps, production_floor_bps, maximum_unreviewed_gap, rules_json,
           audience_policy_json, created_by, approved_by, created_at)
          VALUES (?, 1, ?, ?, ?, 'adaptive', true, 7000, 1000, 20, ?, ?, ?, ?, ?)`,
    args: [
      policyId,
      workspaceId,
      agent.agentId,
      agent.currentVersion.versionId,
      JSON.stringify({ criticalRiskTiers: ["critical"], requiredRiskTiers: ["high"] }),
      JSON.stringify(audiencePolicy),
      identity.principalId,
      identity.principalId,
      NOW,
    ],
  });
  await seedReadyHumanReviewBinding({
    workspaceId,
    agentId: agent.agentId,
    agentVersionId: agent.currentVersion.versionId,
    policyId,
    actor: identity.principalId,
  });
  const publishingPolicy = await createAgentPublishingPolicy({
    accountAddress: identity.principalId,
    workspaceId,
    policy: {
      name: "Automatic grant",
      allowedPaymentModes: ["prepaid"],
      maxPanelAtomic: "50000000",
      maxDailyAtomic: "40000000",
      maxMonthlyAtomic: "100000000",
      maxPanelSize: 20,
      maxBountyAtomic: "30000000",
      maxFeeBps: 1000,
      maxAttemptReserveAtomic: "10000000",
      allowedReviewerSources: ["customer_invited"],
      allowedAdmissionPolicyHashes: [`0x${"ab".repeat(32)}`],
    },
  });
  const key = await createWorkspaceApiKey({
    workspaceId,
    name: "Adaptive evaluator",
    scopes: ["evaluation:read", "review:decide"],
  });
  const principal = await authenticateAdaptiveReviewPrincipal(`Bearer ${key.token}`, "review:decide");
  return { identity, session, workspaceId, agent, audiencePolicyHash, policyId, publishingPolicy, principal };
}

function opportunity(input: Awaited<ReturnType<typeof fixture>>, externalOpportunityId: string) {
  return {
    externalOpportunityId,
    agentId: input.agent.agentId,
    agentVersionId: input.agent.currentVersion.versionId,
    policyId: input.policyId,
    policyVersion: 1,
    workflowKey: "support-reply",
    riskTier: "low",
    audiencePolicyHash: input.audiencePolicyHash,
    suggestionCommitment: __adaptiveReviewServiceTestUtils.sha256({ option: externalOpportunityId }),
    sourceEvidence: {
      reference: `case/${externalOpportunityId}/revision-1`,
      hash: __adaptiveReviewServiceTestUtils.sha256({ caseId: externalOpportunityId }),
    },
    declaredConfidenceBps: 8700,
    criticalRisk: false,
    metadataComplete: true,
    execution: {
      externalExecutionId: `execution-${externalOpportunityId}`,
      status: "completed" as const,
      primarySpanId: "generation-primary",
      generationSpans: [
        {
          spanId: "generation-primary",
          role: "primary" as const,
          provider: "OpenAI",
          requestedModel: "gpt-5.6-sol",
          resolvedModel: "gpt-5.6-sol-2026-07-01",
          reasoningEffort: "medium",
          serviceTier: "standard",
        },
      ],
    },
  };
}

test("engage blocks new evaluations with workspace_stopped, revokes automatic grants, and stays idempotent", async () => {
  const setup = await fixture("engage");
  const before = await evaluateAdaptiveReviewRequirement({
    principal: setup.principal,
    request: opportunity(setup, "ticket-before-stop"),
  });
  assert.equal(before.lifecycle.reasonCodes.includes("workspace_stopped"), false);

  const engaged = await engageWorkspaceStop({
    accountAddress: setup.identity.principalId,
    workspaceId: setup.workspaceId,
    reason: "Model regression under investigation.",
    now: NOW,
  });
  assert.equal(engaged.replayed, false);
  assert.equal(engaged.state.status, "engaged");
  assert.equal(engaged.state.reason, "Model regression under investigation.");
  assert.equal(await isWorkspaceStopEngaged(setup.workspaceId), true);

  const replay = await engageWorkspaceStop({
    accountAddress: setup.identity.principalId,
    workspaceId: setup.workspaceId,
    reason: "Second attempt.",
    now: new Date(NOW.getTime() + 1_000),
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.state.reason, "Model regression under investigation.");

  const grants = await dbClient.execute({
    sql: "SELECT enabled, revoked_at FROM tokenless_agent_publishing_policies WHERE workspace_id = ?",
    args: [setup.workspaceId],
  });
  assert.equal(grants.rowCount, 1);
  assert.ok(grants.rows.every(row => row.enabled === false && row.revoked_at !== null));

  const blocked = await evaluateAdaptiveReviewRequirement({
    principal: setup.principal,
    request: opportunity(setup, "ticket-during-stop"),
  });
  assert.equal(blocked.lifecycle.state, "blocked");
  assert.equal(blocked.lifecycle.reasonCodes.includes("workspace_stopped"), true);

  // Pre-stop opportunities keep their immutable recorded lifecycle on replay.
  const replayedBefore = await evaluateAdaptiveReviewRequirement({
    principal: setup.principal,
    request: opportunity(setup, "ticket-before-stop"),
  });
  assert.deepEqual(replayedBefore.lifecycle, before.lifecycle);

  const released = await releaseWorkspaceStop({
    accountAddress: setup.identity.principalId,
    workspaceId: setup.workspaceId,
    now: new Date(NOW.getTime() + 2_000),
  });
  assert.equal(released.replayed, false);
  assert.equal(released.state?.status, "released");
  const releaseReplay = await releaseWorkspaceStop({
    accountAddress: setup.identity.principalId,
    workspaceId: setup.workspaceId,
    now: new Date(NOW.getTime() + 3_000),
  });
  assert.equal(releaseReplay.replayed, true);

  const after = await evaluateAdaptiveReviewRequirement({
    principal: setup.principal,
    request: opportunity(setup, "ticket-after-release"),
  });
  assert.equal(after.lifecycle.reasonCodes.includes("workspace_stopped"), false);

  // Release re-enables nothing: the automatic grant stays revoked.
  const grantsAfter = await dbClient.execute({
    sql: "SELECT enabled, revoked_at FROM tokenless_agent_publishing_policies WHERE workspace_id = ?",
    args: [setup.workspaceId],
  });
  assert.ok(grantsAfter.rows.every(row => row.enabled === false && row.revoked_at !== null));

  const audit = await dbClient.execute({
    sql: `SELECT action, reason, metadata_json FROM tokenless_audit_events
          WHERE workspace_id = ? AND action LIKE 'workspace.stop_%' ORDER BY sequence ASC`,
    args: [setup.workspaceId],
  });
  assert.deepEqual(
    audit.rows.map(row => row.action),
    ["workspace.stop_engaged", "workspace.stop_released"],
  );
  const engagedMetadata = JSON.parse(String(audit.rows[0]?.metadata_json)) as Record<string, unknown>;
  assert.equal(engagedMetadata.stopReason, "Model regression under investigation.");
  assert.equal(engagedMetadata.revokedAutomaticGrantCount, 1);
  assert.equal(engagedMetadata.revokedContinuationCount, 0);
});

test("only owners and admins control the stop and a reason is mandatory", async () => {
  const setup = await fixture("authz");
  await assert.rejects(
    engageWorkspaceStop({ accountAddress: MEMBER, workspaceId: setup.workspaceId, reason: "halt" }),
    (error: TokenlessServiceError) => error.code === "workspace_not_found",
  );
  await assert.rejects(
    engageWorkspaceStop({ accountAddress: setup.identity.principalId, workspaceId: setup.workspaceId, reason: "  " }),
    (error: TokenlessServiceError) => error.code === "invalid_workspace_stop",
  );
  await assert.rejects(
    releaseWorkspaceStop({ accountAddress: MEMBER, workspaceId: setup.workspaceId }),
    (error: TokenlessServiceError) => error.code === "workspace_not_found",
  );
  // Members can read the state so the banner renders for everyone.
  assert.equal(await getWorkspaceStopState({ accountAddress: MEMBER, workspaceId: setup.workspaceId }), null);
});

test("the stop route reports state to sessions and keeps mutations same-origin", async () => {
  const setup = await fixture("route");
  const context = { params: Promise.resolve({ workspaceId: setup.workspaceId }) };
  const request = (token: string | null = setup.session.token) =>
    new NextRequest(`${APP_ORIGIN}/api/account/workspaces/${setup.workspaceId}/stop`, {
      headers: token ? { cookie: `${AUTH_SESSION_COOKIE}=${token}` } : {},
    });

  const empty = await GET(request(), context);
  assert.equal(empty.status, 200);
  assert.equal(empty.headers.get("cache-control"), "private, no-store");
  assert.equal(((await empty.json()) as { stop: unknown }).stop, null);

  await engageWorkspaceStop({
    accountAddress: setup.identity.principalId,
    workspaceId: setup.workspaceId,
    reason: "Halted for review.",
    now: NOW,
  });
  const engaged = await GET(request(), context);
  const body = (await engaged.json()) as { stop: { status: string; reason: string } };
  assert.equal(body.stop.status, "engaged");
  assert.equal(body.stop.reason, "Halted for review.");

  assert.equal((await GET(request(null), context)).status, 401);

  const source = readFileSync(
    new URL("../../app/api/account/workspaces/[workspaceId]/stop/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /export async function POST/u);
  assert.match(source, /export async function DELETE/u);
  const mutationGuards = source.match(/requireBrowserSession\(request, \{ mutation: true \}\)/gu);
  assert.equal(mutationGuards?.length, 2);
  assert.match(source, /Object\.keys\(body\)\.some\(key => key !== "reason"\)/u);
});

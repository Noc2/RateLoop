import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { GET, PUT } from "~~/app/api/account/workspaces/[workspaceId]/agents/[agentId]/human-review/route";
import { resolveBetterAuthPrincipal } from "~~/lib/auth/principal";
import { AUTH_SESSION_COOKIE, createAuthSession } from "~~/lib/auth/session";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { createWorkspaceAgent } from "~~/lib/tokenless/agentRegistry";
import { createPrivateGroup } from "~~/lib/tokenless/privateGroups";
import { createWorkspace } from "~~/lib/tokenless/productCore";

const APP_ORIGIN = "https://tokenless.example.test";
const NO_STORE = "private, no-store, max-age=0";
const previousAppUrl = process.env.APP_URL;

beforeEach(() => {
  process.env.APP_URL = APP_ORIGIN;
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
  if (previousAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = previousAppUrl;
});

async function fixture(label: string) {
  const identity = await resolveBetterAuthPrincipal({
    betterAuthUserId: `better_human_review_owner_${label}`,
    method: "passkey",
  });
  const session = await createAuthSession(identity);
  const { workspaceId } = await createWorkspace({ name: `Human review ${label}`, ownerAddress: identity.principalId });
  const agent = await createWorkspaceAgent({
    accountAddress: identity.principalId,
    workspaceId,
    externalId: `human-review-${label}`,
    version: {
      displayName: `Human review ${label}`,
      provider: "OpenAI",
      model: "gpt-5",
      environment: "production",
    },
  });
  const group = await createPrivateGroup({
    accountAddress: identity.principalId,
    workspaceId,
    name: `Reviewers ${label}`,
    purpose: "Review private agent suggestions.",
    policy: { defaultCompensation: "unpaid", dataClassifications: ["internal", "confidential"] },
  });
  return { agent, group, session, workspaceId };
}

function request(path: string, token: string, options?: { body?: unknown; method?: "GET" | "PUT"; origin?: string }) {
  const body = options?.body === undefined ? undefined : JSON.stringify(options.body);
  return new NextRequest(`${APP_ORIGIN}${path}`, {
    method: options?.method ?? "GET",
    body,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      cookie: `${AUTH_SESSION_COOKIE}=${token}`,
      ...(options?.origin ? { origin: options.origin } : {}),
    },
  });
}

function ownerBody(groupId: string, expectedBindingVersion: number | null, authority = "check_only") {
  return {
    expectedBindingVersion,
    selection: {
      mode: "adaptive",
      enforcementMode: "advisory",
      agreementThresholdBps: 8_000,
      productionFloorBps: 1_000,
      fixedRateBps: null,
      maximumUnreviewedGap: 20,
      requiredRiskTiers: ["high"],
      criticalRiskTiers: ["critical"],
      minimumConfidenceBps: 7_000,
      maximumLatencyMs: 120_000,
    },
    requestProfile: {
      questionAuthority: "owner_fixed",
      criterion: "Is this response safe and correct?",
      positiveLabel: "Approve",
      negativeLabel: "Reject",
      rationaleMode: "required",
      audience: "private_invited",
      contentBoundary: "private_workspace",
      privateSensitivity: "confidential",
      privateGroupId: groupId,
      responseWindowSeconds: 3_600,
      panelSize: 2,
      compensationMode: "unpaid",
      bountyPerSeatAtomic: null,
    },
    authority,
  };
}

test("owner GET/PUT exposes one exact no-store configuration and resolves the active private-group tuple", async () => {
  const setup = await fixture("resource");
  const path = `/api/account/workspaces/${setup.workspaceId}/agents/${setup.agent.agentId}/human-review`;
  const context = { params: Promise.resolve({ workspaceId: setup.workspaceId, agentId: setup.agent.agentId }) };

  const empty = await GET(request(path, setup.session.token), context);
  assert.equal(empty.status, 200);
  assert.equal(empty.headers.get("cache-control"), NO_STORE);
  assert.equal((await empty.json()).configuration, null);

  const saved = await PUT(
    request(path, setup.session.token, {
      method: "PUT",
      origin: APP_ORIGIN,
      body: ownerBody(setup.group.groupId, null),
    }),
    context,
  );
  assert.equal(saved.status, 200);
  assert.equal(saved.headers.get("cache-control"), NO_STORE);
  const view = await saved.json();
  assert.equal(view.bindingRevision, 1);
  assert.equal(view.configuration.authority, "check_only");
  assert.equal(view.configuration.selection.value.audience, "private_invited");
  assert.equal(view.configuration.requestProfile.value.privateGroupId, setup.group.groupId);
  assert.equal(view.configuration.requestProfile.value.privateGroupPolicyVersion, 1);
  assert.equal(view.configuration.requestProfile.value.privateGroupPolicyHash, setup.group.policyHash);
  assert.equal(view.connection, null);
  assert.equal(view.capability.available, false);
  assert.equal(view.blockingReason.code, "evaluation_unavailable");

  const stored = await dbClient.execute({
    sql: `SELECT private_group_policy_version, private_group_policy_hash
          FROM tokenless_agent_review_request_profiles WHERE workspace_id = ? AND superseded_at IS NULL`,
    args: [setup.workspaceId],
  });
  assert.equal(Number(stored.rows[0]?.private_group_policy_version), 1);
  assert.equal(stored.rows[0]?.private_group_policy_hash, setup.group.policyHash);
});

test("authority-only updates do not version unchanged selection or request objects", async () => {
  const setup = await fixture("versions");
  const path = `/api/account/workspaces/${setup.workspaceId}/agents/${setup.agent.agentId}/human-review`;
  const context = { params: Promise.resolve({ workspaceId: setup.workspaceId, agentId: setup.agent.agentId }) };
  const put = (body: unknown) =>
    PUT(request(path, setup.session.token, { method: "PUT", origin: APP_ORIGIN, body }), context);

  assert.equal((await put(ownerBody(setup.group.groupId, null))).status, 200);
  const authorityOnly = await put(ownerBody(setup.group.groupId, 1, "prepare_for_approval"));
  assert.equal(authorityOnly.status, 200);
  assert.equal((await authorityOnly.json()).bindingRevision, 2);
  const repeated = await put(ownerBody(setup.group.groupId, 2, "prepare_for_approval"));
  assert.equal(repeated.status, 200);
  assert.equal((await repeated.json()).bindingRevision, 2);

  const counts = await Promise.all([
    dbClient.execute({
      sql: "SELECT COUNT(*) AS count FROM tokenless_agent_review_policies WHERE workspace_id = ?",
      args: [setup.workspaceId],
    }),
    dbClient.execute({
      sql: "SELECT COUNT(*) AS count FROM tokenless_agent_review_request_profiles WHERE workspace_id = ?",
      args: [setup.workspaceId],
    }),
    dbClient.execute({
      sql: "SELECT COUNT(*) AS count FROM tokenless_agent_human_review_bindings WHERE workspace_id = ?",
      args: [setup.workspaceId],
    }),
  ]);
  assert.deepEqual(
    counts.map(result => Number(result.rows[0]?.count)),
    [1, 1, 2],
  );
});

test("strict owner input and stale revisions fail without leaving partial object versions", async () => {
  const setup = await fixture("conflict");
  const path = `/api/account/workspaces/${setup.workspaceId}/agents/${setup.agent.agentId}/human-review`;
  const context = { params: Promise.resolve({ workspaceId: setup.workspaceId, agentId: setup.agent.agentId }) };
  const put = (body: unknown, origin = APP_ORIGIN) =>
    PUT(request(path, setup.session.token, { method: "PUT", origin, body }), context);

  const unsupported = ownerBody(setup.group.groupId, null) as ReturnType<typeof ownerBody> & {
    readiness?: unknown;
  };
  unsupported.readiness = { autonomousPublishing: true };
  const rejected = await put(unsupported);
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).code, "invalid_human_review_owner_request");

  const injectedHash = ownerBody(setup.group.groupId, null);
  (injectedHash.requestProfile as Record<string, unknown>).privateGroupPolicyHash = `sha256:${"a".repeat(64)}`;
  const hashRejected = await put(injectedHash);
  assert.equal(hashRejected.status, 400);
  assert.equal((await hashRejected.json()).code, "invalid_human_review_owner_request");

  const unconfiguredGrant = ownerBody(setup.group.groupId, null) as ReturnType<typeof ownerBody> & {
    publishingGrant?: unknown;
    authority: string;
  };
  unconfiguredGrant.authority = "ask_automatically";
  unconfiguredGrant.publishingGrant = {
    integrationId: "agi_not_configured",
    publishingPolicyId: "agpol_not_configured",
    publishingPolicyVersion: 1,
    allowedWorkflowKeys: ["general-assistance"],
  };
  const grantRejected = await put(unconfiguredGrant);
  assert.equal(grantRejected.status, 409);
  assert.equal((await grantRejected.json()).code, "human_review_publishing_grant_mismatch");

  const crossOrigin = await put(ownerBody(setup.group.groupId, null), "https://attacker.example");
  assert.equal(crossOrigin.status, 403);
  assert.equal((await crossOrigin.json()).code, "invalid_origin");

  assert.equal((await put(ownerBody(setup.group.groupId, null))).status, 200);
  const stale = ownerBody(setup.group.groupId, 2);
  stale.selection.maximumUnreviewedGap = 10;
  stale.requestProfile.criterion = "Did the changed response remain safe?";
  const conflict = await put(stale);
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).code, "human_review_configuration_conflict");

  const counts = await Promise.all([
    dbClient.execute({
      sql: "SELECT COUNT(*) AS count FROM tokenless_agent_review_policies WHERE workspace_id = ?",
      args: [setup.workspaceId],
    }),
    dbClient.execute({
      sql: "SELECT COUNT(*) AS count FROM tokenless_agent_review_request_profiles WHERE workspace_id = ?",
      args: [setup.workspaceId],
    }),
    dbClient.execute({
      sql: "SELECT COUNT(*) AS count FROM tokenless_agent_human_review_bindings WHERE workspace_id = ?",
      args: [setup.workspaceId],
    }),
  ]);
  assert.deepEqual(
    counts.map(result => Number(result.rows[0]?.count)),
    [1, 1, 1],
  );
});

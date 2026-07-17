import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  SAFE_AGENT_CONNECTION_SCOPES,
  claimAgentConnectionIntent,
  verifyAgentConnection,
} from "~~/lib/tokenless/agentConnectionIntents";
import { OWNER_APPROVED_AGENT_SCOPES } from "~~/lib/tokenless/agentIntegrations";
import {
  getHumanReviewConfigurationForOwner,
  putHumanReviewConfigurationForOwner,
} from "~~/lib/tokenless/humanReviewConfiguration";
import { loadWorkspaceOnboardingFunnel } from "~~/lib/tokenless/onboardingObservability";
import { createPrivateGroup } from "~~/lib/tokenless/privateGroups";
import { createAgentPublishingPolicy, createWorkspace } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import {
  agentSetupUrl,
  clampAgentSetupStep,
  completeWorkspaceAgentSetup,
  configureWorkspaceSetupPeople,
  configureWorkspaceSetupReviews,
  confirmWorkspaceSetupAgent,
  createWorkspaceAgentSetupConnection,
  getWorkspaceAgentSetup,
  updateWorkspaceSetupName,
} from "~~/lib/tokenless/workspaceAgentSetup";

const OWNER = `rlp_${"b".repeat(24)}`;
const CLIENT_ID = "rloc_setup_client";
const RESOURCE = "https://rateloop-tokenless.example/api/agent/v1/mcp";

beforeEach(async () => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  const now = new Date();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_principals (principal_id,status,created_at,updated_at)
          VALUES (?, 'active', ?, ?)`,
    args: [OWNER, now, now],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_oauth_clients
          (client_id,client_name,redirect_uris_json,redirect_uris_digest,token_endpoint_auth_method,
           grant_types_json,response_types_json,allowed_scopes_json,registration_source,status,created_at,updated_at)
          VALUES (?, 'Setup client', '["http://127.0.0.1/callback"]', 'setup-redirects', 'none',
                  '["authorization_code","refresh_token"]', '["code"]', ?, 'dynamic', 'active', ?, ?)`,
    args: [CLIENT_ID, JSON.stringify(SAFE_AGENT_CONNECTION_SCOPES), now, now],
  });
});

afterEach(() => __setDatabaseResourcesForTests(null));

async function connectedSetup() {
  const { workspaceId } = await createWorkspace({ name: "Setup workspace", ownerAddress: OWNER });
  const issued = await createWorkspaceAgentSetupConnection({
    accountAddress: OWNER,
    workspaceId,
    origin: "https://rateloop-tokenless.example",
    revision: 1,
  });
  assert.equal(typeof issued.connectionUrl, "string", JSON.stringify(issued));
  const now = new Date();
  const tokenFamilyId = "rlotf_setup_family";
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_oauth_token_families
          (token_family_id,client_id,subject_principal_id,audience,resource,granted_scopes_json,status,
           created_at,absolute_expires_at)
          VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    args: [
      tokenFamilyId,
      CLIENT_ID,
      OWNER,
      RESOURCE,
      RESOURCE,
      JSON.stringify(SAFE_AGENT_CONNECTION_SCOPES),
      now,
      new Date(now.getTime() + 86_400_000),
    ],
  });
  const principal = {
    tokenFamilyId,
    clientId: CLIENT_ID,
    clientName: "Setup client",
    subjectPrincipalId: OWNER,
    resource: RESOURCE,
    scopes: [...SAFE_AGENT_CONNECTION_SCOPES],
  };
  const claimed = await claimAgentConnectionIntent({
    connectionUrl: issued.connectionUrl,
    origin: "https://rateloop-tokenless.example",
    principal,
  });
  await verifyAgentConnection({ principal, integrationId: claimed.connection.integrationId });
  return { workspaceId, integrationId: claimed.connection.integrationId };
}

async function saveSetupReviewConfiguration(input: {
  workspaceId: string;
  agentId: string;
  groupId?: string | null;
  mode?: "adaptive" | "always";
  audience?: "private_invited" | "public_network";
  authority?: "check_only" | "prepare_for_approval";
  questionAuthority?: "owner_fixed" | "agent_per_request" | "omit";
}) {
  const audience = input.audience ?? "private_invited";
  const questionAuthority = input.questionAuthority ?? "owner_fixed";
  return putHumanReviewConfigurationForOwner({
    accountAddress: OWNER,
    workspaceId: input.workspaceId,
    agentId: input.agentId,
    body: {
      expectedBindingVersion: null,
      selection: {
        mode: input.mode ?? "adaptive",
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
        ...(questionAuthority === "omit" ? {} : { questionAuthority }),
        ...(questionAuthority === "agent_per_request"
          ? {}
          : {
              criterion: "Is this response safe and correct?",
              positiveLabel: "Approve",
              negativeLabel: "Reject",
            }),
        rationaleMode: "required",
        audience,
        contentBoundary: audience === "public_network" ? "public_or_test" : "private_workspace",
        privateSensitivity: audience === "public_network" ? null : "confidential",
        privateGroupId: audience === "public_network" ? null : input.groupId,
        responseWindowSeconds: 3_600,
        panelSize: audience === "public_network" ? 3 : 2,
        compensationMode: audience === "public_network" ? "usdc" : "unpaid",
        bountyPerSeatAtomic: audience === "public_network" ? "1000000" : null,
      },
      authority: input.authority ?? "check_only",
    },
  });
}

test("setup binds one verified connection and completes without publishing or spending authority", async () => {
  const { workspaceId, integrationId } = await connectedSetup();
  const connected = await getWorkspaceAgentSetup({ accountAddress: OWNER, workspaceId });
  assert.equal(connected.resumeStep, "agent");
  assert.equal(connected.revision, 2);
  assert.equal(connected.connection.integrationId, integrationId);
  assert.equal(connected.capabilities.autonomousAccess, false);

  const confirmed = await confirmWorkspaceSetupAgent({
    accountAddress: OWNER,
    workspaceId,
    revision: connected.revision,
    agent: {
      displayName: connected.agent!.displayName,
      description: connected.agent!.description,
      provider: connected.agent!.provider,
      model: connected.agent!.model,
      modelVersion: connected.agent!.modelVersion,
      environment: "production",
    },
  });
  assert.equal(confirmed.revision, 3);

  const group = await createPrivateGroup({
    accountAddress: OWNER,
    workspaceId,
    name: "Reviewers",
    purpose: "People invited to review this workspace's private material.",
    policy: { defaultCompensation: "unpaid", dataClassifications: ["internal", "confidential"] },
  });
  const savedReview = await saveSetupReviewConfiguration({
    workspaceId,
    agentId: connected.agent!.agentId,
    groupId: group.groupId,
  });

  const reviews = await configureWorkspaceSetupReviews({
    accountAddress: OWNER,
    workspaceId,
    revision: confirmed.revision,
    bindingRevision: savedReview.configuration.version,
  });
  assert.equal(reviews.revision, 4);
  assert.equal(reviews.review.schemaVersion, "rateloop.workspace-agent-setup-review.v2");
  assert.equal(reviews.review.bindingRevision, savedReview.configuration.version);

  const people = await configureWorkspaceSetupPeople({
    accountAddress: OWNER,
    workspaceId,
    revision: reviews.revision,
    decision: "later",
  });
  assert.equal(people.revision, 5);
  assert.ok(people.groupId);
  assert.match(people.groupId, /^pgrp_/);
  const policyVersionsBeforeCompletion = await dbClient.execute({
    sql: `SELECT COUNT(*) AS count FROM tokenless_agent_review_policies
          WHERE workspace_id=? AND policy_id=?`,
    args: [workspaceId, savedReview.configuration.selectionPolicy.id],
  });

  const completed = await completeWorkspaceAgentSetup({
    accountAddress: OWNER,
    workspaceId,
    revision: people.revision,
  });
  assert.equal(completed.revision, 6);
  const finalState = await getWorkspaceAgentSetup({ accountAddress: OWNER, workspaceId });
  assert.equal(finalState.complete, true);
  assert.equal(finalState.status, "completed");

  const integration = await dbClient.execute({
    sql: `SELECT activation_mode,granted_scopes_json,publishing_policy_id,review_policy_id,review_policy_version
          FROM tokenless_agent_integrations WHERE integration_id=?`,
    args: [integrationId],
  });
  assert.equal(String(integration.rows[0]?.activation_mode), "preauthorized_safe");
  assert.equal(integration.rows[0]?.publishing_policy_id, null);
  assert.deepEqual(JSON.parse(String(integration.rows[0]?.granted_scopes_json)), SAFE_AGENT_CONNECTION_SCOPES);
  const audience = await dbClient.execute({
    sql: `SELECT audience_policy_json FROM tokenless_agent_review_policies
          WHERE policy_id=? AND version=?`,
    args: [integration.rows[0]?.review_policy_id, integration.rows[0]?.review_policy_version],
  });
  const audiencePolicy = JSON.parse(String(audience.rows[0]?.audience_policy_json));
  assert.equal(audiencePolicy.reviewerSource, "private_invited");
  const profile = await dbClient.execute({
    sql: `SELECT private_group_id FROM tokenless_agent_review_request_profiles
          WHERE profile_id=? AND version=?`,
    args: [savedReview.configuration.requestProfile.id, savedReview.configuration.requestProfile.version],
  });
  assert.equal(profile.rows[0]?.private_group_id, people.groupId);
  const policyVersions = await dbClient.execute({
    sql: `SELECT COUNT(*) AS count FROM tokenless_agent_review_policies
          WHERE workspace_id=? AND policy_id=?`,
    args: [workspaceId, savedReview.configuration.selectionPolicy.id],
  });
  assert.equal(
    Number(policyVersions.rows[0]?.count),
    Number(policyVersionsBeforeCompletion.rows[0]?.count),
    "completion must not create a parallel selection policy",
  );
  const funnel = await loadWorkspaceOnboardingFunnel(workspaceId);
  assert.deepEqual(
    funnel.events
      .map(event => event.event)
      .filter(event => !["workspace_created", "connection_claimed", "connected"].includes(event)),
    ["agent_details_confirmed", "review_behavior_confirmed", "reviewers_deferred", "workspace_setup_completed"],
  );
  assert.doesNotMatch(JSON.stringify(funnel), /Setup workspace|Setup client|pgrp_|confidential/u);
});

test("prepare-for-approval setup skips private people and preserves a safe null publishing grant", async () => {
  const { workspaceId } = await connectedSetup();
  const connected = await getWorkspaceAgentSetup({ accountAddress: OWNER, workspaceId });
  const confirmed = await confirmWorkspaceSetupAgent({
    accountAddress: OWNER,
    workspaceId,
    revision: connected.revision,
    agent: {
      displayName: connected.agent!.displayName,
      description: connected.agent!.description,
      provider: connected.agent!.provider,
      model: connected.agent!.model,
      modelVersion: connected.agent!.modelVersion,
      environment: "production",
    },
  });
  const savedReview = await saveSetupReviewConfiguration({
    workspaceId,
    agentId: connected.agent!.agentId,
    audience: "public_network",
    authority: "prepare_for_approval",
  });
  const reviews = await configureWorkspaceSetupReviews({
    accountAddress: OWNER,
    workspaceId,
    revision: confirmed.revision,
    bindingRevision: savedReview.configuration.version,
  });
  assert.equal(reviews.review.requestProfile.privateGroupId, null);
  await assert.rejects(
    configureWorkspaceSetupPeople({
      accountAddress: OWNER,
      workspaceId,
      revision: reviews.revision,
      decision: "later",
    }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_agent_setup_people",
  );
  const people = await configureWorkspaceSetupPeople({
    accountAddress: OWNER,
    workspaceId,
    revision: reviews.revision,
    decision: "not_required",
  });
  assert.equal(people.groupId, null);
  const completed = await completeWorkspaceAgentSetup({
    accountAddress: OWNER,
    workspaceId,
    revision: people.revision,
  });
  assert.equal(completed.revision, people.revision + 1);
  const stored = await dbClient.execute({
    sql: "SELECT people_decision,private_group_id,status FROM tokenless_workspace_agent_setups WHERE workspace_id=?",
    args: [workspaceId],
  });
  assert.deepEqual(stored.rows[0], {
    people_decision: "not_required",
    private_group_id: null,
    status: "completed",
  });
  const integration = await dbClient.execute({
    sql: `SELECT activation_mode,granted_scopes_json,publishing_policy_id,allowed_workflow_keys_json
          FROM tokenless_agent_integrations WHERE workspace_id=?`,
    args: [workspaceId],
  });
  assert.equal(integration.rows[0]?.activation_mode, "preauthorized_safe");
  assert.equal(integration.rows[0]?.publishing_policy_id, null);
  assert.deepEqual(JSON.parse(String(integration.rows[0]?.granted_scopes_json)), SAFE_AGENT_CONNECTION_SCOPES);
  assert.deepEqual(JSON.parse(String(integration.rows[0]?.allowed_workflow_keys_json)), ["general-assistance"]);
});

test("automatic setup atomically binds the exact owner-approved workflows and spending policy", async () => {
  const { workspaceId, integrationId } = await connectedSetup();
  const connected = await getWorkspaceAgentSetup({ accountAddress: OWNER, workspaceId });
  const confirmed = await confirmWorkspaceSetupAgent({
    accountAddress: OWNER,
    workspaceId,
    revision: connected.revision,
    agent: {
      displayName: connected.agent!.displayName,
      description: connected.agent!.description,
      provider: connected.agent!.provider,
      model: connected.agent!.model,
      modelVersion: connected.agent!.modelVersion,
      environment: "production",
    },
  });
  const publishing = await createAgentPublishingPolicy({
    accountAddress: OWNER,
    workspaceId,
    policy: {
      name: "Automatic human review",
      allowedPaymentModes: ["prepaid"],
      maxPanelAtomic: "6000000",
      maxDailyAtomic: "60000000",
      maxMonthlyAtomic: "600000000",
      maxPanelSize: 3,
      maxBountyAtomic: "3000000",
      maxFeeBps: 2_000,
      maxAttemptReserveAtomic: "3000000",
      allowedReviewerSources: ["rateloop_network"],
      allowedAdmissionPolicyHashes: [`0x${"a".repeat(64)}`],
      allowedDataClassifications: ["public", "synthetic", "redacted"],
      onPolicyMiss: "deny",
    },
  });
  const automaticBody = {
    expectedBindingVersion: null as number | null,
    selection: {
      mode: "always",
      enforcementMode: "advisory",
      agreementThresholdBps: 8_000,
      productionFloorBps: 0,
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
      audience: "public_network",
      contentBoundary: "public_or_test",
      privateSensitivity: null,
      privateGroupId: null,
      responseWindowSeconds: 3_600,
      panelSize: 3,
      compensationMode: "usdc",
      bountyPerSeatAtomic: "1000000",
    },
    authority: "ask_automatically",
    publishingGrant: {
      integrationId,
      publishingPolicyId: publishing.policyId,
      publishingPolicyVersion: publishing.version ?? 1,
      allowedWorkflowKeys: ["general-assistance"],
    },
  };
  const saved = await putHumanReviewConfigurationForOwner({
    accountAddress: OWNER,
    workspaceId,
    agentId: connected.agent!.agentId,
    body: automaticBody,
  });
  const ownerView = await getHumanReviewConfigurationForOwner({
    accountAddress: OWNER,
    workspaceId,
    agentId: connected.agent!.agentId,
  });
  assert.deepEqual(ownerView.configuration?.delegation?.allowedWorkflowKeys, ["general-assistance"]);
  const reviews = await configureWorkspaceSetupReviews({
    accountAddress: OWNER,
    workspaceId,
    revision: confirmed.revision,
    bindingRevision: saved.configuration.version,
  });
  const people = await configureWorkspaceSetupPeople({
    accountAddress: OWNER,
    workspaceId,
    revision: reviews.revision,
    decision: "not_required",
  });
  await completeWorkspaceAgentSetup({ accountAddress: OWNER, workspaceId, revision: people.revision });

  const integration = await dbClient.execute({
    sql: `SELECT activation_mode,publishing_policy_id,publishing_policy_version,allowed_workflow_keys_json,
                 granted_scopes_json
          FROM tokenless_agent_integrations WHERE integration_id=?`,
    args: [integrationId],
  });
  assert.equal(integration.rows[0]?.activation_mode, "owner_approved");
  assert.equal(integration.rows[0]?.publishing_policy_id, publishing.policyId);
  assert.equal(Number(integration.rows[0]?.publishing_policy_version), publishing.version ?? 1);
  assert.deepEqual(JSON.parse(String(integration.rows[0]?.allowed_workflow_keys_json)), ["general-assistance"]);
  assert.deepEqual(JSON.parse(String(integration.rows[0]?.granted_scopes_json)), OWNER_APPROVED_AGENT_SCOPES);
  const events = await dbClient.execute({
    sql: `SELECT event_type,details_json FROM tokenless_agent_integration_events
          WHERE integration_id=? AND event_type='scope_upgraded'`,
    args: [integrationId],
  });
  assert.equal(events.rowCount, 1);
  assert.match(String(events.rows[0]?.details_json), /"explicitBrowserConsent":true/u);
  assert.doesNotMatch(String(events.rows[0]?.details_json), /criterion|positiveLabel|negativeLabel/u);

  const downgraded = await putHumanReviewConfigurationForOwner({
    accountAddress: OWNER,
    workspaceId,
    agentId: connected.agent!.agentId,
    body: {
      ...automaticBody,
      expectedBindingVersion: saved.configuration.version,
      authority: "prepare_for_approval",
      publishingGrant: null,
    },
  });
  assert.equal(downgraded.configuration.authority, "prepare_for_approval");
  const safe = await dbClient.execute({
    sql: `SELECT activation_mode,publishing_policy_id,granted_scopes_json
          FROM tokenless_agent_integrations WHERE integration_id=?`,
    args: [integrationId],
  });
  assert.equal(safe.rows[0]?.activation_mode, "preauthorized_safe");
  assert.equal(safe.rows[0]?.publishing_policy_id, null);
  assert.deepEqual(JSON.parse(String(safe.rows[0]?.granted_scopes_json)), SAFE_AGENT_CONNECTION_SCOPES);
  const downgradeEvent = await dbClient.execute({
    sql: `SELECT details_json FROM tokenless_agent_integration_events
          WHERE integration_id=? AND event_type='scope_downgraded'`,
    args: [integrationId],
  });
  assert.equal(downgradeEvent.rowCount, 1);
});

test("setup rejects future steps, stale revisions, and unsaved review configuration", async () => {
  assert.equal(clampAgentSetupStep("people", "agent"), "agent");
  assert.equal(clampAgentSetupStep("connect", "agent"), "connect");
  assert.equal(agentSetupUrl("ws a", "reviews"), "/agents?workspace=ws%20a&step=reviews");

  const { workspaceId } = await connectedSetup();
  await assert.rejects(
    configureWorkspaceSetupReviews({
      accountAddress: OWNER,
      workspaceId,
      revision: 2,
      bindingRevision: null,
    }),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.code === "agent_setup_review_configuration_required",
  );
  await assert.rejects(
    createWorkspaceAgentSetupConnection({
      accountAddress: OWNER,
      workspaceId,
      origin: "https://rateloop-tokenless.example",
      revision: 1,
    }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "agent_setup_conflict",
  );
});

test("setup requires explicit question authority and isolates agent-written feedback configuration", async () => {
  const { workspaceId } = await connectedSetup();
  const connected = await getWorkspaceAgentSetup({ accountAddress: OWNER, workspaceId });
  const agentId = connected.agent!.agentId;

  await assert.rejects(
    saveSetupReviewConfiguration({ workspaceId, agentId, audience: "public_network", mode: "always", questionAuthority: "omit" }),
    /questionAuthority is required/u,
  );
  await assert.rejects(
    saveSetupReviewConfiguration({
      workspaceId,
      agentId,
      audience: "private_invited",
      mode: "always",
      questionAuthority: "agent_per_request",
    }),
    /public reviewer network and public or test material/u,
  );
  await assert.rejects(
    saveSetupReviewConfiguration({
      workspaceId,
      agentId,
      audience: "public_network",
      mode: "adaptive",
      questionAuthority: "agent_per_request",
    }),
    /Adaptive review requires one owner-fixed question/u,
  );

  await saveSetupReviewConfiguration({
    workspaceId,
    agentId,
    audience: "public_network",
    mode: "always",
    questionAuthority: "agent_per_request",
  });
  const view = await getHumanReviewConfigurationForOwner({ accountAddress: OWNER, workspaceId, agentId });
  const profile = view.configuration!.requestProfile.value;
  assert.equal(profile.questionAuthority, "agent_per_request");
  assert.equal(profile.resultSemantics, "feedback");
  assert.equal(profile.criterion, null);
  assert.equal(profile.positiveLabel, null);
  assert.equal(profile.negativeLabel, null);
  assert.equal(profile.rationaleMode, "required");
});

test("setup resumes a legacy v1 review choice as one unsaved v2 draft", async () => {
  const { workspaceId } = await connectedSetup();
  const connected = await getWorkspaceAgentSetup({ accountAddress: OWNER, workspaceId });
  const confirmed = await confirmWorkspaceSetupAgent({
    accountAddress: OWNER,
    workspaceId,
    revision: connected.revision,
    agent: {
      displayName: connected.agent!.displayName,
      description: connected.agent!.description,
      provider: connected.agent!.provider,
      model: connected.agent!.model,
      modelVersion: connected.agent!.modelVersion,
      environment: "production",
    },
  });
  const group = await createPrivateGroup({
    accountAddress: OWNER,
    workspaceId,
    name: "Reviewers",
    purpose: "People invited to review this workspace's private material.",
    policy: { defaultCompensation: "unpaid", dataClassifications: ["internal", "confidential"] },
  });
  const now = new Date();
  await dbClient.execute({
    sql: `UPDATE tokenless_workspace_agent_setups
          SET review_draft_json=?,reviews_confirmed_at=?,reviews_confirmed_by=?,
              people_decision='later',private_group_id=?,people_decided_at=?,people_decided_by=?,current_step='people'
          WHERE workspace_id=?`,
    args: [
      JSON.stringify({
        schemaVersion: "rateloop.workspace-agent-setup-review.v1",
        mode: "always",
        reviewerAudience: "private_invited",
        contentBoundary: "private_workspace",
        autonomousAccess: false,
      }),
      now,
      OWNER,
      group.groupId,
      now,
      OWNER,
      workspaceId,
    ],
  });

  const resumed = await getWorkspaceAgentSetup({ accountAddress: OWNER, workspaceId });
  assert.equal(resumed.resumeStep, "reviews");
  assert.ok(resumed.reviewDraft);
  assert.equal(resumed.reviewDraft!.schemaVersion, "rateloop.workspace-agent-setup-review.v2");
  assert.equal(resumed.reviewDraft!.selection.mode, "always");
  assert.equal(resumed.reviewDraft!.requestProfile.questionAuthority, "owner_fixed");
  assert.equal(resumed.reviewDraft!.requestProfile.resultSemantics, "assurance");
  assert.equal(resumed.reviewDraft!.bindingRevision, null);
  assert.equal(resumed.reviewDraft!.requestProfile.privateGroupId, null);
  const bindings = await dbClient.execute({
    sql: "SELECT COUNT(*) AS count FROM tokenless_agent_human_review_bindings WHERE workspace_id=?",
    args: [workspaceId],
  });
  assert.equal(Number(bindings.rows[0]?.count), 0);

  const savedReview = await saveSetupReviewConfiguration({
    workspaceId,
    agentId: connected.agent!.agentId,
    groupId: group.groupId,
    mode: "always",
  });
  await configureWorkspaceSetupReviews({
    accountAddress: OWNER,
    workspaceId,
    revision: confirmed.revision,
    bindingRevision: savedReview.configuration.version,
  });
  const migrated = await getWorkspaceAgentSetup({ accountAddress: OWNER, workspaceId });
  assert.equal(migrated.resumeStep, "people");
  assert.equal(migrated.reviewDraft?.selection.mode, "always");
  assert.equal(migrated.peopleDecision, "later");
  assert.equal(migrated.privateGroupId, group.groupId);

  await dbClient.execute({
    sql: `UPDATE tokenless_agent_review_request_profiles
          SET configuration_status='action_required',response_window_seconds=NULL,panel_size=NULL
          WHERE workspace_id=? AND profile_id=? AND version=?`,
    args: [workspaceId, savedReview.configuration.requestProfile.id, savedReview.configuration.requestProfile.version],
  });
  const incomplete = await getWorkspaceAgentSetup({ accountAddress: OWNER, workspaceId });
  assert.equal(incomplete.resumeStep, "reviews");
  assert.equal(incomplete.reviewDraft?.requestProfile.configurationStatus, "action_required");
  assert.equal(incomplete.reviewDraft?.requestProfile.responseWindowSeconds, null);
  assert.equal(incomplete.reviewDraft?.requestProfile.panelSize, null);
});

test("workspace setup can rename the workspace without losing progress", async () => {
  const { workspaceId } = await createWorkspace({ name: "Original workspace", ownerAddress: OWNER });
  const initial = await getWorkspaceAgentSetup({ accountAddress: OWNER, workspaceId, requestedStep: "workspace" });
  assert.equal(initial.workspaceName, "Original workspace");
  assert.equal(initial.revision, 1);

  const renamed = await updateWorkspaceSetupName({
    accountAddress: OWNER,
    workspaceId,
    revision: initial.revision,
    name: "  Renamed workspace  ",
  });
  assert.deepEqual(renamed, { workspaceName: "Renamed workspace", revision: 2 });

  const current = await getWorkspaceAgentSetup({ accountAddress: OWNER, workspaceId, requestedStep: "workspace" });
  assert.equal(current.workspaceName, "Renamed workspace");
  assert.equal(current.revision, 2);
  assert.equal(current.currentStep, "workspace");
  assert.equal(current.resumeStep, "connect");

  await assert.rejects(
    updateWorkspaceSetupName({ accountAddress: OWNER, workspaceId, revision: 1, name: "Stale rename" }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "agent_setup_conflict",
  );
});

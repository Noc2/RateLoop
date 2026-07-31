import { isActiveAgentConnectionIntent, isPendingAgentPairing } from "./AgentConnectionPanel";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./AgentConnectionPanel.tsx", import.meta.url), "utf8");
const messages = readFileSync(new URL("../../../messages/en/agents.json", import.meta.url), "utf8");

test("default connection UI creates and copies one safe connection intent", () => {
  assert.match(source, /t\("copyMessage"\)/);
  assert.match(messages, /"copyMessage": "Copy connection message"/);
  assert.match(source, /\/agent-connections`, \{/);
  assert.match(source, /method: "POST"/);
  assert.match(source, /buildAgentConnectionMessage\(\{ connectionUrl \}\)/);
  assert.match(source, /navigator\.clipboard\.writeText\(message\)/);
  assert.match(source, /agent-connections\/onboarding-events/);
  assert.match(source, /JSON\.stringify\(\{ event: "connection_message_copied" \}\)/);
  assert.doesNotMatch(source, /JSON\.stringify\(\{[^}]*connectionUrl/);
  assert.match(messages, /Connect your agent/);
  assert.match(messages, /Connect another agent/);
  assert.match(source, /canStartAgentConnection/);
  assert.match(messages, /Copy one message into the agent chat you want to connect/);
  assert.match(messages, /cannot spend, publish, read private workspace content, or change/);
  assert.doesNotMatch(source, /No connection is currently in progress/);
  assert.doesNotMatch(source, /No approved agent integration exists yet/);
  assert.doesNotMatch(source, /expiresInSeconds: 600/);
  assert.doesNotMatch(source, /onClick=\{\(\) => void generatePairing/);
});

test("host chips are optional disclosure below the unchanged universal copy path", () => {
  assert.match(
    source,
    /<AgentConnectionHostPicker selectedHostId=\{selectedHostId\} onSelectHost=\{selectConnectionHost\} \/>/,
  );
  // The universal message stays the zero-friction default; a chip only tunes it.
  assert.match(source, /buildAgentConnectionMessage\(\{ connectionUrl \}\)/);
  assert.match(source, /buildAgentConnectionMessageForHost\(\{ connectionUrl, hostId \}\)/);
  assert.match(source, /connectionMessageForHost\(connectionUrl, selectedHostId\)/);
  // A selection made while the message is visible re-tunes it in place.
  assert.match(source, /connectionMessageForHost\(manualConnectionUrl, hostId\)/);
  // The choice is remembered per workspace and restored on load.
  assert.match(source, /setSelectedHostId\(loadAgentConnectionHostChoice\(workspaceId\)\)/);
  assert.match(source, /saveAgentConnectionHostChoice\(workspaceId, hostId\)/);
  const copyAction = source.indexOf('t("copyMessage")');
  const picker = source.indexOf("<AgentConnectionHostPicker");
  assert.ok(copyAction >= 0 && copyAction < picker, "the disclosure renders below the primary copy action");
});

test("the complete connection message stays visible with accessible copy recovery", () => {
  const exposeMessage = source.indexOf("setManualConnectionMessage(message)");
  const automaticCopy = source.indexOf("navigator.clipboard.writeText(message)");
  assert.ok(exposeMessage >= 0 && exposeMessage < automaticCopy);
  assert.match(source, /manualMessageRef\.current\?\.focus\(\)/);
  assert.match(source, /manualMessageRef\.current\?\.select\(\)/);
  assert.match(source, /aria-describedby="manual-agent-message-help"/);
  assert.match(source, /readOnly/);
  assert.match(source, /t\("copyMessage"\)/);
  assert.match(source, /copyVisibleConnectionMessage/);
  assert.match(source, /errors\("clipboardSelected"\)/);
  assert.match(source, /setStatus\(statusCopy\("connectionCopied"\)\)/);
  assert.doesNotMatch(source, /useRateLoopNotifications|notifications\.(success|error)/);
  assert.match(source, /<AgentConnectionTroubleshooting \/>/);
});

test("connection status polling pauses completely while the page is hidden", () => {
  assert.match(source, /document\.visibilityState !== "visible"\) return/);
  assert.match(source, /document\.visibilityState === "visible"\) schedule\(PAIRING_POLL_INTERVAL_MS\)/);
  assert.match(source, /PAIRING_POLL_INTERVAL_MS = 5_000/);
  assert.match(source, /PAIRING_HIDDEN_POLL_INTERVAL_MS = 10_000/);
  assert.doesNotMatch(source, /Listening for agent/);
});

test("intent deadlines end pending state client-side", () => {
  const now = Date.parse("2026-07-15T10:00:00.000Z");
  assert.equal(
    isActiveAgentConnectionIntent({ status: "issued", hardExpiresAt: "2026-07-15T10:01:00.000Z" }, now),
    true,
  );
  assert.equal(
    isActiveAgentConnectionIntent({ status: "testing", hardExpiresAt: "2026-07-15T09:59:00.000Z" }, now),
    false,
  );
  assert.equal(
    isActiveAgentConnectionIntent({ status: "connected", hardExpiresAt: "2026-07-15T10:01:00.000Z" }, now),
    false,
  );
});

test("workspace conflicts present the saved recovery action as the primary next step", () => {
  assert.match(source, /const recoveryAction = intent\.recoveryAction/);
  assert.match(source, /t\("resolve"\)/);
  assert.match(source, /role="alert"/);
  assert.match(source, /t\("recoveryAction"\)/);
  assert.match(source, /recoveryAction \? \([\s\S]*?\) : !move \? \([\s\S]*?t\("closePage"\)/);
});

test("legacy pairings remain manageable but cannot be issued from the default path", () => {
  assert.match(messages, /Legacy connection needs attention/);
  assert.match(messages, /action needed/);
  assert.match(messages, /retired bearer-pairing flow/);
  assert.match(source, /PairingApprovalCard/);
  assert.match(messages, /Review legacy approval/);
  assert.match(messages, /Cancel review/);
  assert.match(messages, /Cancel legacy request/);
  assert.match(source, /expandedLegacyPairingId === pairing\.pairingId/);
  assert.match(source, /\/agent-pairings\//);
  assert.match(source, /\/approve/);
  assert.match(source, /\/reject/);
  assert.doesNotMatch(source, /Deployment name/i);
  assert.doesNotMatch(
    source,
    /fetch\(`\/api\/account\/workspaces\/\$\{encodeURIComponent\(workspaceId\)\}\/agent-pairings`, \{[\s\S]{0,120}method: "POST"/,
  );
});

test("all five consequential connection actions use the shared confirmation dialog", () => {
  assert.doesNotMatch(source, /window\.confirm/);
  assert.match(source, /import \{ ConfirmDialog \}/);
  assert.equal(source.match(/<ConfirmDialog/g)?.length, 1);
  assert.match(source, /kind: "cancel-intent"/);
  assert.match(source, /kind: "approve-workspace-move"/);
  assert.match(source, /kind: "reject-pairing"/);
  assert.match(source, /kind: "rotate-integration"/);
  assert.match(source, /kind: "revoke-integration"/);
  for (const key of [
    "cancelDescription",
    "reconnectDescription",
    "rejectDescription",
    "rotateDescription",
    "disconnectDescription",
  ]) {
    assert.match(source, new RegExp(`t\\("${key}"\\)`));
  }
  assert.match(messages, /Its original message will stop working\./);
  assert.match(messages, /Its current RateLoop workspace connection will stop/);
  assert.match(messages, /The pairing secret cannot be reused\./);
  assert.match(messages, /The previous credential will no longer be valid/);
  assert.match(messages, /Its current RateLoop access will stop\./);
  assert.match(source, /busy=\{Boolean\(busyAction\)\}/);
  assert.match(source, /onCancel=\{\(\) => setPendingConfirmation\(null\)\}/);
  assert.match(source, /focusFeedbackAfterConfirmationRef\.current = true/);
  assert.match(source, /actionFeedbackRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
});

test("safe OAuth integrations show no bearer rotation or publishing permission", () => {
  assert.match(source, /const legacyCredential = Boolean\(integration\.apiKeyId\)/);
  assert.match(source, /allActiveIntegrationsUseSafeAccess = activeIntegrations\.every/);
  assert.match(source, /\{allActiveIntegrationsUseSafeAccess \? \(/);
  assert.match(source, /legacyCredential \? \(/);
  assert.match(messages, /OAuth-managed safe access/);
  assert.match(messages, /No publishing access/);
  assert.match(messages, /Connected with safe access/);
  assert.match(messages, /Rotate legacy credential/);
});

test("replay-revoked OAuth integrations expose the owner recovery action", () => {
  assert.match(source, /oauthRecoveryAvailable/);
  assert.match(source, /recover-oauth/);
  assert.match(messages, /Restore connection/);
  assert.match(messages, /revokes its current access tokens and restores the existing safe OAuth credential/);
});

test("connection approval keeps adaptive policy detail beside the controls that govern it", () => {
  const editorSource = readFileSync(new URL("./AgentHumanReviewEditor.tsx", import.meta.url), "utf8");
  assert.match(source, /policyCopy\.limits\.adaptiveSummary/);
  assert.match(source, /<InfoPopover label=\{t\("adaptivePreset"\)\}>/);
  assert.match(source, /policyCopy\.limits\.adaptiveConnectionHelp/);
  assert.doesNotMatch(source, /Generic MCP is advisory/);
  assert.match(editorSource, /draft\.mode === "adaptive"/);
  assert.match(editorSource, /policyCopy\.limits\.adaptiveDetail/);
  assert.match(editorSource, /<InfoPopover label=\{ui\("aboutAdaptiveCoverage"\)\}>/);
});

test("connected agent management opens from a direct action while technical state stays optional", () => {
  assert.match(source, /t\("manage"\)/);
  assert.match(source, /aria-controls="connected-agent-management"/);
  assert.match(source, /aria-expanded=\{showConnectionManagement\}/);
  assert.match(source, /showConnectionManagement \? \(/);
  assert.match(source, /showConnectionManagement \? t\("done"\) : t\("manage"\)/);
  assert.match(messages, /Connection details/);
  assert.doesNotMatch(source, /Connection history/);
  assert.match(source, /onConnectionHistoryChange\?\.\(connectionHistory\)/);
  assert.match(source, /t\("disconnect"\)/);
  assert.match(source, /setStatus\(statusCopy\("agentDisconnected"\)\)/);
});

test("a connected OAuth agent has a direct targeted reconnect path", () => {
  assert.match(source, /t\("reconnect"\)/);
  assert.match(source, /copyConnectionMessage\(activeIntegrations\[0\]\.integrationId\)/);
  assert.match(source, /copyConnectionMessage\(integration\.integrationId\)/);
  assert.match(source, /JSON\.stringify\(reconnectIntegrationId \? \{ reconnectIntegrationId \} : \{\}\)/);
  assert.match(source, /t\("reconnectCopied"\)/);
  assert.match(source, /activeConnectionIntents\.length > 0/);
});

test("a saved agent with only an unusable OAuth integration can reconnect without being duplicated", () => {
  assert.match(source, /oauthClientId: stringField\(row, "oauthClientId"\)/);
  assert.match(
    source,
    /const reconnectableIntegrations = selectReconnectableOAuthConnections\(integrations, connectionClock\)/,
  );
  assert.match(messages, /Reconnect your agent/);
  assert.match(messages, /Reconnect a saved agent without changing its review settings\./);
  assert.match(source, /copyConnectionMessage\(integration\.integrationId\)/);
  assert.match(source, /t\("reconnectNamed", \{ name: integration\.agentDisplayName \|\| t\("agentFallback"\) \}\)/);
});

test("a workspace owner explicitly approves a source-confirmed reconnect on the website", () => {
  assert.match(source, /source_confirmation_required/);
  assert.match(messages, /Confirm the reconnect in your agent/);
  assert.match(source, /owner_approval_required/);
  assert.match(messages, /Approve reconnecting this agent/);
  assert.match(messages, /Approve reconnect/);
  assert.match(source, /agent-connection-moves\/\$\{encodeURIComponent\(move\.transferId\)\}\/approve/);
  assert.match(source, /JSON\.stringify\(\{ decision: "approve" \}\)/);
  assert.match(messages, /This disconnects that Codex credential from its current RateLoop workspace/);
  assert.match(messages, /review and publishing settings stay/);
  assert.match(messages, /Reconnect approved\. Return to the same agent task; it can now finish automatically\./);
});

test("elapsed legacy attempts are never kept pending client-side", () => {
  const now = Date.parse("2026-07-15T10:00:00.000Z");
  assert.equal(isPendingAgentPairing({ status: "open", expiresAt: "2026-07-15T10:01:00.000Z" }, now), true);
  assert.equal(isPendingAgentPairing({ status: "claimed", expiresAt: "2026-07-15T09:59:00.000Z" }, now), false);
  assert.equal(isPendingAgentPairing({ status: "expired", expiresAt: "2026-07-15T10:01:00.000Z" }, now), false);
});

test("legacy approval still refreshes dependent agent panels", () => {
  assert.match(source, /onAgentApproved\?\.\(\)/);
  assert.match(source, /publishingRevision/);
  assert.match(source, /policies\.some\(policy => policy\.policyId === selectedPublishingPolicyId\)/);
});

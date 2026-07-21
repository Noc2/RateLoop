import { isActiveAgentConnectionIntent, isPendingAgentPairing } from "./AgentConnectionPanel";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./AgentConnectionPanel.tsx", import.meta.url), "utf8");

test("default connection UI creates and copies one safe connection intent", () => {
  assert.match(source, /"Copy connection message"/);
  assert.match(source, /\/agent-connections`, \{/);
  assert.match(source, /method: "POST"/);
  assert.match(source, /buildAgentConnectionMessage\(\{ connectionUrl \}\)/);
  assert.match(source, /navigator\.clipboard\.writeText\(message\)/);
  assert.match(source, /agent-connections\/onboarding-events/);
  assert.match(source, /JSON\.stringify\(\{ event: "connection_message_copied" \}\)/);
  assert.doesNotMatch(source, /JSON\.stringify\(\{[^}]*connectionUrl/);
  assert.match(source, /Connect your agent/);
  assert.match(source, /Copy one message into the agent chat you want to connect/);
  assert.match(source, /cannot spend, publish, read private workspace content, or change/);
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
  const copyAction = source.indexOf('"Copy connection message"');
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
  assert.match(source, /Copy message/);
  assert.match(source, /copyVisibleConnectionMessage/);
  assert.match(source, /complete message is selected below for one manual copy/);
  assert.match(source, /notifications\.success\("Connection message copied to clipboard\."\)/);
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
  assert.match(source, /Resolve this connection/);
  assert.match(source, /role="alert"/);
  assert.match(source, /\{recoveryAction\}/);
  assert.match(source, /recoveryAction \? \([\s\S]*?\) : !move \? \([\s\S]*?You can close this page\./);
});

test("legacy pairings remain manageable but cannot be issued from the default path", () => {
  assert.match(source, /Legacy connection needs attention/);
  assert.match(source, /action needed/);
  assert.match(source, /retired bearer-pairing flow/);
  assert.match(source, /PairingApprovalCard/);
  assert.match(source, /Review legacy approval/);
  assert.match(source, /Cancel review/);
  assert.match(source, /Cancel legacy request/);
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

test("safe OAuth integrations show no bearer rotation or publishing permission", () => {
  assert.match(source, /const legacyCredential = Boolean\(integration\.apiKeyId\)/);
  assert.match(source, /legacyCredential \? \(/);
  assert.match(source, /OAuth-managed safe access/);
  assert.match(source, /No publishing access/);
  assert.match(source, /Connected with safe access/);
  assert.match(source, /Rotate legacy credential/);
});

test("replay-revoked OAuth integrations expose the owner recovery action", () => {
  assert.match(source, /oauthRecoveryAvailable/);
  assert.match(source, /recover-oauth/);
  assert.match(source, /Restore connection/);
  assert.match(source, /revokes its current access tokens and restores the existing safe OAuth credential/);
});

test("the default adaptive policy explains its reachable calibration evidence", () => {
  assert.match(source, /two stable\s+15-case windows/);
  assert.match(source, /at least 14 agent-human agreements each/);
  assert.match(source, /Coverage starts at 100%, then may move to 50%,\s+25%, and a 10% monitoring floor/);
  assert.match(source, /10% monitoring floor/);
});

test("connected agent management opens from a direct action while technical state stays optional", () => {
  assert.match(source, /Manage connected agents/);
  assert.match(source, /aria-controls="connected-agent-management"/);
  assert.match(source, /aria-expanded=\{showConnectionManagement\}/);
  assert.match(source, /showConnectionManagement \? \(/);
  assert.match(source, /\? "Done" : "Manage connected agents"/);
  assert.match(source, /Connection details/);
  assert.doesNotMatch(source, /Connection history/);
  assert.match(source, /onConnectionHistoryChange\?\.\(connectionHistory\)/);
  assert.match(source, />\s*Disconnect\s*</);
  assert.match(source, /setStatus\("Agent disconnected\."\)/);
});

test("a connected OAuth agent has a direct targeted reconnect path", () => {
  assert.match(source, />\s*Reconnect\s*</);
  assert.match(source, /copyConnectionMessage\(activeIntegrations\[0\]\.integrationId\)/);
  assert.match(source, /copyConnectionMessage\(integration\.integrationId\)/);
  assert.match(source, /JSON\.stringify\(reconnectIntegrationId \? \{ reconnectIntegrationId \} : \{\}\)/);
  assert.match(source, /Reconnect message copied\. Paste it once into the same agent task\./);
  assert.match(source, /activeConnectionIntents\.length > 0/);
});

test("a saved agent with only a revoked OAuth integration can reconnect without being duplicated", () => {
  assert.match(source, /oauthClientId: stringField\(row, "oauthClientId"\)/);
  assert.match(source, /const reconnectableIntegrations = integrations\.filter/);
  assert.match(source, /integration\.status === "revoked"/);
  assert.match(source, /Boolean\(integration\.oauthClientId\)/);
  assert.match(source, /candidate\.agentId === integration\.agentId/);
  assert.match(source, /Reconnect your agent/);
  assert.match(source, /Reconnect a saved agent without changing its review settings\./);
  assert.match(source, /copyConnectionMessage\(integration\.integrationId\)/);
  assert.match(source, /`Reconnect \$\{integration\.agentDisplayName \|\| "agent"\}`/);
});

test("a workspace owner explicitly approves a source-confirmed reconnect on the website", () => {
  assert.match(source, /source_confirmation_required/);
  assert.match(source, /Confirm the reconnect in your agent/);
  assert.match(source, /owner_approval_required/);
  assert.match(source, /Approve reconnecting this agent/);
  assert.match(source, /Approve reconnect/);
  assert.match(source, /agent-connection-moves\/\$\{encodeURIComponent\(move\.transferId\)\}\/approve/);
  assert.match(source, /JSON\.stringify\(\{ decision: "approve" \}\)/);
  assert.match(source, /This disconnects that Codex credential from its current RateLoop workspace/);
  assert.match(source, /review and publishing settings stay/);
  assert.match(source, /Reconnect approved\. Return to the same agent task; it can now finish automatically\./);
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

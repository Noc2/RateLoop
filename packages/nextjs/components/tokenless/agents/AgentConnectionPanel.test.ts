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

test("legacy pairings remain manageable but cannot be issued from the default path", () => {
  assert.match(source, /Legacy pairing requests/);
  assert.match(source, /retired bearer-pairing flow/);
  assert.match(source, /PairingApprovalCard/);
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

test("the default adaptive policy explains its reachable calibration evidence", () => {
  assert.match(source, /two stable\s+15-case windows/);
  assert.match(source, /at least 14 agent-human agreements each/);
  assert.match(source, /Coverage starts at 100%, then may move to 50%,\s+25%, and a 10% monitoring floor/);
  assert.match(source, /10% monitoring floor/);
});

test("connected agent management keeps disconnect and technical state behind Manage", () => {
  assert.match(source, />Manage</);
  assert.match(source, /Connection details/);
  assert.match(source, /Connection history/);
  assert.match(source, />\s*Disconnect\s*</);
  assert.match(source, /setStatus\("Agent disconnected\."\)/);
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

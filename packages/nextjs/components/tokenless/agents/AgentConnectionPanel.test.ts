import { isPendingAgentPairing } from "./AgentConnectionPanel";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./AgentConnectionPanel.tsx", import.meta.url), "utf8");

test("agent connection UI uses a bounded pairing and owner-approval flow", () => {
  assert.match(source, /: "Connect an agent"/);
  assert.doesNotMatch(source, /Generate 10-minute connection/);
  assert.doesNotMatch(source, /The secret is random, single-use, hash-only at rest, and shown once/);
  assert.match(source, /expiresInSeconds: 600/);
  assert.match(source, /Possessing the pairing secret does not grant workspace/);
  assert.match(source, /workspace[\s\S]{0,40}access/);
  assert.match(source, /\/agent-pairings/);
  assert.match(source, /\/approve/);
  assert.match(source, /\/reject/);
  assert.match(source, /PAIRING_POLL_INTERVAL_MS = 5_000/);
  assert.match(source, /Agent is waiting for approval/);
});

test("elapsed connection attempts are never kept pending client-side", () => {
  const now = Date.parse("2026-07-15T10:00:00.000Z");
  assert.equal(isPendingAgentPairing({ status: "open", expiresAt: "2026-07-15T10:01:00.000Z" }, now), true);
  assert.equal(isPendingAgentPairing({ status: "claimed", expiresAt: "2026-07-15T09:59:00.000Z" }, now), false);
  assert.equal(isPendingAgentPairing({ status: "expired", expiresAt: "2026-07-15T10:01:00.000Z" }, now), false);
});

test("pending connection UX is actionable without an indefinite listener", () => {
  assert.doesNotMatch(source, /Listening for agent/);
  assert.match(source, /Waiting for the agent to open your connection/);
  assert.match(source, /Cancel attempt/);
  assert.match(source, /Connection history/);
  assert.match(source, /document\.visibilityState/);
  assert.match(source, /close it without stopping the connection/);
});

test("generic MCP activation stays advisory and binds publishing plus adaptive defaults", () => {
  assert.match(source, /publishingPolicyId/);
  assert.match(source, /allowedWorkflowKeys/);
  assert.match(source, /provider: declaredProvider/);
  assert.match(source, /Generic MCP is advisory/);
  assert.match(source, /Safe adaptive preset/);
  assert.match(source, /90%/);
  assert.match(source, /minimum declared confidence/);
  assert.match(source, /at most 20 outputs without/);
  assert.match(source, /Coverage starts at 100%/);
  assert.match(source, /50%, 25%, and a 10% monitoring floor/);
});

test("connection credentials are shown once and managed integrations can rotate or revoke", () => {
  assert.match(source, /Copy setup message/);
  assert.match(source, /agent chat you intend to connect/);
  assert.match(source, /configure MCP,[\s\S]{0,80}register itself,[\s\S]{0,80}wait for your approval automatically/);
  assert.match(source, /one exact host-specific step/);
  assert.match(source, /never put it in a repository, log, or unrelated chat/);
  assert.match(source, /\/agent-integrations/);
  assert.match(source, /\/rotate/);
  assert.match(source, /method: "DELETE"/);
  assert.match(source, /Last seen/);
  assert.match(source, /Rotate credential/);
});

test("connection approval refreshes agents and newly available publishing policies", () => {
  assert.match(source, /onAgentApproved\?\.\(\)/);
  assert.match(source, /publishingRevision/);
  assert.match(source, /policies\.some\(policy => policy\.policyId === selectedPublishingPolicyId\)/);
});

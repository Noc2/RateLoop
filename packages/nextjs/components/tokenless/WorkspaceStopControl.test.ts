import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const controlSource = readFileSync(new URL("./WorkspaceStopControl.tsx", import.meta.url), "utf8");
const dangerSource = readFileSync(new URL("./WorkspaceDangerZone.tsx", import.meta.url), "utf8");
const panelsSource = readFileSync(new URL("./agents/AgentWorkspacePanels.tsx", import.meta.url), "utf8");
const settingsSource = readFileSync(new URL("./WorkspaceSettingsClient.tsx", import.meta.url), "utf8");

test("the danger-zone stop action requires a reason and never resumes agents implicitly", () => {
  assert.match(controlSource, /Stop all agent activity/);
  assert.match(dangerSource, /border-red-400\/30/);
  // Two-step confirm: the destructive action is behind an explicit confirmation
  // with a required reason that lands in the audit chain.
  assert.match(controlSource, /Confirm: stop all agent activity/);
  assert.match(controlSource, /recorded in the audit chain/);
  assert.match(controlSource, /required/);
  assert.match(controlSource, /disabled=\{busy \|\| !reason\.trim\(\)\}/);
  assert.match(controlSource, /method: "POST"/);
  assert.match(controlSource, /method: "DELETE"/);
  // Release and safe-state semantics match docs/tokenless-oversight-stop-semantics.md.
  assert.match(controlSource, /holds gated work undelivered/);
  assert.match(controlSource, /Release stop \(agents stay halted until re-granted\)/);
  assert.match(controlSource, /Agents do not restart/);
  assert.doesNotMatch(controlSource, /EU AI Act compliant|makes you compliant|satisfies Article/i);
});

test("the engaged banner persists across agents pages and the panel mounts in the manager workspace card", () => {
  assert.match(controlSource, /export function WorkspaceStopBanner/);
  assert.match(controlSource, /All agent activity is stopped for this workspace\./);
  assert.match(controlSource, /each agent needs a fresh\s+publishing grant/);
  assert.match(panelsSource, /<WorkspaceStopBanner workspaceId=\{workspaceId\} \/>/);
  assert.doesNotMatch(panelsSource, /<WorkspaceDangerZone/);
  assert.match(settingsSource, /selected && canManageWorkspace \? \(\s*<WorkspaceDangerZone/);
  assert.match(dangerSource, /<WorkspaceStopPanel workspaceId=\{workspaceId\} \/>/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const controlSource = readFileSync(new URL("./WorkspaceStopControl.tsx", import.meta.url), "utf8");
const panelsSource = readFileSync(new URL("./agents/AgentWorkspacePanels.tsx", import.meta.url), "utf8");

test("the stop control is a red-bordered confirm-with-reason card that never resumes agents implicitly", () => {
  assert.match(controlSource, /Stop all agent activity/);
  assert.match(controlSource, /border-red-400\/40/);
  // Two-step confirm: the destructive action is behind an explicit confirmation
  // with a required reason that lands in the audit chain.
  assert.match(controlSource, /Confirm: stop all agent activity/);
  assert.match(controlSource, /recorded in the audit chain/);
  assert.match(controlSource, /required/);
  assert.match(controlSource, /disabled=\{busy \|\| !reason\.trim\(\)\}/);
  assert.match(controlSource, /method: "POST"/);
  assert.match(controlSource, /method: "DELETE"/);
  // Release and safe-state semantics match docs/tokenless-oversight-stop-semantics.md.
  assert.match(controlSource, /held undelivered/);
  assert.match(controlSource, /workspace_stopped/);
  assert.match(controlSource, /Release stop \(agents stay halted until re-granted\)/);
  assert.match(controlSource, /resumes nothing automatically/);
  assert.doesNotMatch(controlSource, /EU AI Act compliant|makes you compliant|satisfies Article/i);
});

test("the engaged banner persists across agents pages and the panel mounts on the manager overview", () => {
  assert.match(controlSource, /export function WorkspaceStopBanner/);
  assert.match(controlSource, /All agent activity is stopped for this workspace\./);
  assert.match(controlSource, /each agent needs a fresh\s+publishing grant/);
  assert.match(panelsSource, /<WorkspaceStopBanner workspaceId=\{workspaceId\} \/>/);
  assert.match(
    panelsSource,
    /resolvedTab === "overview" && canManage \? \(\s*<WorkspaceStopPanel workspaceId=\{workspaceId\} \/>/,
  );
});

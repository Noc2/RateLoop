import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./WorkspaceDeletionPanel.tsx", import.meta.url), "utf8");
const dangerSource = readFileSync(new URL("./WorkspaceDangerZone.tsx", import.meta.url), "utf8");
const panelsSource = readFileSync(new URL("./agents/AgentWorkspacePanels.tsx", import.meta.url), "utf8");
const settingsSource = readFileSync(new URL("./WorkspaceSettingsClient.tsx", import.meta.url), "utf8");

test("the visible workspace deletion action loads a preview before accepting the shared DELETE confirmation", () => {
  assert.match(source, /onClick=\{\(\) => void loadPreview\(\)\}/);
  assert.doesNotMatch(source, /<details|onToggle=/);
  assert.match(source, /\/api\/account\/workspaces\/\$\{encodeURIComponent\(workspaceId\)\}\/deletion/);
  assert.match(source, /cache: "no-store"/);
  assert.match(source, /JSON\.stringify\(\{ confirmation \}\)/);
  assert.match(source, /confirmation !== "DELETE"/);
  assert.match(source, /label="Type DELETE to confirm"/);
  assert.match(source, /requiresFundResolution\(preview\)/);
  assert.match(source, /Request verified refund/);
  assert.match(source, /resolutionQueued/);
  assert.match(source, /window\.location\.assign\("\/agents\/overview"\)/);
});

test("workspace deletion reveals only relevant impact, warnings, and blockers", () => {
  assert.match(source, /impactRows\(preview\)/);
  assert.match(source, /\.filter\(\(value\): value is string => Boolean\(value\)\)/);
  assert.match(source, /preview\.warnings\.length > 0/);
  assert.match(source, /preview\.blockers\.length > 0/);
  assert.match(source, /This workspace has no work or funds\. Deletion is immediate\./);
  assert.match(source, /private object will be deleted/);
  assert.match(source, /public record will remain/);
  assert.match(source, /legal hold delays deletion/);
});

test("workspace deletion stays out of agent setup and appears only for owners in workspace settings", () => {
  assert.match(panelsSource, /setupIncomplete && initialSetup \? <AgentSetupFlow/);
  assert.match(panelsSource, /<WorkspaceSettingsClient initialWorkspaceId=\{workspaceId\}/);
  assert.doesNotMatch(panelsSource, /<WorkspaceDangerZone/);
  assert.match(settingsSource, /selected && canManageWorkspace/);
  assert.match(settingsSource, /canDelete=\{selected\.role === "owner"\}/);
  assert.match(dangerSource, /canDelete \? <WorkspaceDeletionPanel/);
  assert.equal(dangerSource.match(/<WorkspaceDeletionPanel/g)?.length, 1);
});

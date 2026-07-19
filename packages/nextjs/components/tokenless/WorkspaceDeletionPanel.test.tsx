import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./WorkspaceDeletionPanel.tsx", import.meta.url), "utf8");
const dangerSource = readFileSync(new URL("./WorkspaceDangerZone.tsx", import.meta.url), "utf8");
const panelsSource = readFileSync(new URL("./agents/AgentWorkspacePanels.tsx", import.meta.url), "utf8");

test("the visible workspace deletion action loads a preview before accepting an exact-name confirmation", () => {
  assert.match(source, /onClick=\{\(\) => void loadPreview\(\)\}/);
  assert.doesNotMatch(source, /<details|onToggle=/);
  assert.match(source, /\/api\/account\/workspaces\/\$\{encodeURIComponent\(workspaceId\)\}\/deletion/);
  assert.match(source, /cache: "no-store"/);
  assert.match(source, /JSON\.stringify\(\{ confirmationName \}\)/);
  assert.match(source, /confirmationName !== preview\.workspace\.name/);
  assert.match(source, /preview\.blockers\.length === 0/);
  assert.match(source, /disabled=\{submitting \|\| !confirmed\}/);
  assert.match(source, /window\.location\.assign\("\/agents"\)/);
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

test("workspace deletion stays out of setup and appears only for owners in the connected danger zone", () => {
  const setupStart = panelsSource.indexOf("if (initialSetup && !initialSetup.complete)");
  const setupEnd = panelsSource.indexOf("\n  }\n\n  return (", setupStart);
  const setupBranch = panelsSource.slice(setupStart, setupEnd);
  assert.ok(setupStart >= 0 && setupEnd > setupStart);
  assert.doesNotMatch(setupBranch, /WorkspaceDangerZone/);
  assert.match(
    panelsSource,
    /resolvedTab === "overview" && canManage[\s\S]*?<WorkspaceDangerZone[\s\S]*?canDelete=\{workspace\.role === "owner"\}/,
  );
  assert.match(dangerSource, /canDelete \? <WorkspaceDeletionPanel/);
  assert.equal(dangerSource.match(/<WorkspaceDeletionPanel/g)?.length, 1);
});

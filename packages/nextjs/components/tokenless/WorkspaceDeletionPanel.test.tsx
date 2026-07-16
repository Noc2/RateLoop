import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./WorkspaceDeletionPanel.tsx", import.meta.url), "utf8");
const panelsSource = readFileSync(new URL("./agents/AgentWorkspacePanels.tsx", import.meta.url), "utf8");

test("workspace deletion loads a server preview before accepting an exact-name confirmation", () => {
  assert.match(source, /onToggle=/);
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

test("only owners see deletion after incomplete setup and connected Overview", () => {
  assert.match(
    panelsSource,
    /<AgentSetupFlow initialSetup=\{initialSetup\} \/>[\s\S]*?workspace\.role === "owner"[\s\S]*?<WorkspaceDeletionPanel/,
  );
  assert.match(
    panelsSource,
    /resolvedTab === "overview" && workspace\.role === "owner"[\s\S]*?<WorkspaceDeletionPanel/,
  );
  assert.equal(panelsSource.match(/<WorkspaceDeletionPanel/g)?.length, 2);
});

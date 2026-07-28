import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./AgentOverviewMonitor.tsx", import.meta.url), "utf8");
const workspaceSource = readFileSync(new URL("./AgentWorkspacePanels.tsx", import.meta.url), "utf8");

test("the connected-agent overview mounts the fixed monitor", () => {
  assert.match(workspaceSource, /<AgentOverviewMonitor workspaceId=\{workspaceId\} \/>/);
  assert.match(source, /Completed decisions/);
  assert.match(source, /Reviewer endorsement/);
  assert.match(source, /Median time to decision/);
  assert.match(source, /Cost per decision/);
  assert.match(source, /overview\.window\.label/);
  assert.match(source, /Review outcome trend/);
  assert.match(source, /Decision-time trend/);
  assert.match(source, /overview\.attention\.periodLabel/);
  assert.match(source, /Low confidence/);
  assert.match(source, /Insufficient evidence/);
});

test("agent-version parents disclose bounded scope evidence without reviewer axes or a scope average", () => {
  assert.match(source, /Parent rows show scope composition and the lowest observed scope\s*bound,\s*never an average/);
  assert.match(source, /overview\.agentVersions\.parents\.map/);
  assert.match(source, /parent\.lowestEndorsement\.lower95Bps/);
  assert.match(source, /parent\.scopes\.map/);
  assert.doesNotMatch(source, /reviewer(Id|Key|Email|Account)|reviewerPseudonym/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("agent registry UI labels model identity as declared and versions as immutable", () => {
  const source = readFileSync(new URL("./AgentRegistryPanel.tsx", import.meta.url), "utf8");
  const form = readFileSync(new URL("./AgentVersionForm.tsx", import.meta.url), "utf8");
  assert.match(source, /Durable identities and declared model versions/);
  assert.match(source, /Every version is append-only/);
  assert.match(source, /Version history/);
  assert.match(source, /read-only access/);
  assert.match(source, /agentRevision = 0/);
  assert.match(source, /onAgentsChanged\?\.\(\)/);
  assert.match(form, /Declared provider/);
  assert.match(form, /Saving creates an immutable version/);
  assert.match(source, /Use Connect an agent above/);
  assert.match(source, /const \[showArchived, setShowArchived\] = useState\(false\)/);
  assert.match(source, /showArchived \? agents : agents\.filter\(agent => agent\.status === "active"\)/);
  assert.match(source, /Show archived agents \(\$\{archivedAgentCount\}\)/);
  assert.match(source, /Hide archived agents/);
  assert.match(source, /aria-pressed=\{showArchived\}/);
  assert.match(source, /Archived identities remain available for audit/);
  assert.match(source, /visibleAgents\.map/);
  assert.doesNotMatch(source, /Register agent|Register a durable agent|createAgent/);
  assert.doesNotMatch(source, /method: "POST"[\s\S]{0,200}\/agents/);
  assert.doesNotMatch(source, /verified model|model accuracy|truth score/i);
});

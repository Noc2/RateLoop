import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("agent details render in the connection-focused registry", () => {
  const source = readFileSync(new URL("./AgentRegistryPanel.tsx", import.meta.url), "utf8");
  const form = readFileSync(new URL("./AgentVersionForm.tsx", import.meta.url), "utf8");
  assert.match(source, /<AgentText id="translated095"/);
  assert.doesNotMatch(source, /Edit reviews|Review configuration|onReviewAgentChange|activeReviewAgentId/);
  assert.doesNotMatch(source, />Review behavior</);
  assert.doesNotMatch(source, />Autonomous requests</);
  assert.match(source, /<AgentText id="translated097"/);
  assert.match(source, /<AgentText id="translated098"/);
  assert.match(source, /agentRevision = 0/);
  assert.match(source, /onAgentsChanged\?\.\(\)/);
  assert.match(form, /t\("workflowName"\)/);
  assert.match(form, /provider: "unknown"/);
  assert.match(form, /model: "unknown"/);
  assert.doesNotMatch(form, /Saving creates an immutable workflow version/);
  assert.doesNotMatch(form, />\s*Declared provider/);
  assert.doesNotMatch(form, />\s*Declared model/);
  assert.doesNotMatch(form, />\s*Model version/);
  assert.doesNotMatch(form, /Deployment name/i);
  assert.doesNotMatch(source, /declaredDeploymentName|>Deployment</i);
  assert.match(source, /const \[showArchived, setShowArchived\] = useState\(false\)/);
  assert.match(
    source,
    /showArchived\s*\?\s*agents\s*:\s*agents\.filter\(agent => agent\.status === "active" \|\| agent\.agentId === selectedAgentId\)/,
  );
  assert.match(source, /ui\("showArchived", \{ count: archivedAgentCount \}\)/);
  assert.match(source, /ui\("hideArchived"\)/);
  assert.match(source, /aria-pressed=\{showArchived\}/);
  assert.match(source, /visibleAgents\.map/);
  assert.doesNotMatch(source, /Workflow v\{agent\.currentVersion\.versionNumber\}/);
  assert.doesNotMatch(source, /\{agent\.currentVersion\.declaredModel\}/);
  assert.doesNotMatch(source, />Declared provider</);
  assert.doesNotMatch(source, /Human assurance|No eligible output has reached RateLoop yet|global score/i);
  assert.doesNotMatch(source, /trust score|accuracy score/i);
  assert.doesNotMatch(source, /Agent registry/);
  assert.doesNotMatch(source, /Durable identities and declared model versions/);
  assert.doesNotMatch(source, /No approved agents are registered/);
  assert.doesNotMatch(source, /No active agents are registered/);
  assert.doesNotMatch(source, /Register agent|Register a durable agent|createAgent/);
  assert.doesNotMatch(source, /method: "POST"[\s\S]{0,200}\/agents/);
  assert.doesNotMatch(source, /verified model|model accuracy|truth score/i);
  assert.match(source, /<ConfirmDialog/);
  assert.doesNotMatch(source, /window\.confirm/);
});

test("agent management actions stay visible while technical records remain optional", () => {
  const source = readFileSync(new URL("./AgentRegistryPanel.tsx", import.meta.url), "utf8");
  assert.match(source, /<AgentText id="translated095"/);
  assert.match(source, /<AgentText id="translated096"/);
  assert.doesNotMatch(source, /<summary[^>]*>Manage<\/summary>/);
  assert.match(source, /<summary[^>]*>[\s\S]*?<AgentText id="translated097"/);
  assert.match(source, /<AgentText id="translated098" \/>/);
  assert.match(source, /mergeAgentAuditHistory\(visibleAgents, connectionHistory\)/);
  assert.match(source, /entry\.kind === "connection"/);
});

test("the connection view omits model and evaluation evidence", () => {
  const source = readFileSync(new URL("./AgentRegistryPanel.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Model and evidence/);
  assert.doesNotMatch(source, /Declared model/);
  assert.doesNotMatch(source, /Coverage stage/);
  assert.doesNotMatch(source, /Observed workflows/);
  assert.doesNotMatch(source, /Observed risk tiers/);
  assert.doesNotMatch(source, /Evaluation profile/);
  assert.doesNotMatch(source, /reported by the connected host, not independently verified/);
});

test("the agent card header omits connection implementation details", () => {
  const source = readFileSync(new URL("./AgentRegistryPanel.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Connected via RateLoop plugin · host-reported/);
  assert.doesNotMatch(source, /Advisory MCP connection — plugin hooks not reported/);
  assert.doesNotMatch(source, /Device-flow connection — plugin hooks not reported/);
  assert.doesNotMatch(source, /reportedConnectionLane/);
  assert.doesNotMatch(source, /verified plugin|plugin verified/i);
});

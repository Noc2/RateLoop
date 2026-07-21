import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("agent details render in the connection-focused registry", () => {
  const source = readFileSync(new URL("./AgentRegistryPanel.tsx", import.meta.url), "utf8");
  const form = readFileSync(new URL("./AgentVersionForm.tsx", import.meta.url), "utf8");
  assert.match(source, /Change workflow version/);
  assert.doesNotMatch(source, /Edit reviews|Review configuration|onReviewAgentChange|activeReviewAgentId/);
  assert.doesNotMatch(source, />Review behavior</);
  assert.doesNotMatch(source, />Autonomous requests</);
  assert.match(source, /Technical details/);
  assert.match(source, /Audit history/);
  assert.match(source, /agentRevision = 0/);
  assert.match(source, /onAgentsChanged\?\.\(\)/);
  assert.match(form, /Workflow name/);
  assert.match(form, /provider: "unknown"/);
  assert.match(form, /model: "unknown"/);
  assert.doesNotMatch(form, /Saving creates an immutable workflow version/);
  assert.doesNotMatch(form, />\s*Declared provider/);
  assert.doesNotMatch(form, />\s*Declared model/);
  assert.doesNotMatch(form, />\s*Model version/);
  assert.doesNotMatch(form, /Deployment name/i);
  assert.doesNotMatch(source, /declaredDeploymentName|>Deployment</i);
  assert.match(source, /const \[showArchived, setShowArchived\] = useState\(false\)/);
  assert.match(source, /showArchived \? agents : agents\.filter\(agent => agent\.status === "active"\)/);
  assert.match(source, /Show archived \(\$\{archivedAgentCount\}\)/);
  assert.match(source, /Hide archived/);
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
});

test("agent management actions stay visible while technical records remain optional", () => {
  const source = readFileSync(new URL("./AgentRegistryPanel.tsx", import.meta.url), "utf8");
  assert.match(source, />\s*Change workflow version\s*</);
  assert.match(source, />\s*Deactivate\s*</);
  assert.doesNotMatch(source, /<summary[^>]*>Manage<\/summary>/);
  assert.match(source, /<summary[^>]*>\s*Technical details/);
  assert.match(source, /Audit history \(\{auditEntries\.length\}\)/);
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

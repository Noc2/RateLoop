import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("review policy UI explains adaptive coverage, immutable edits, and honest host enforcement", () => {
  const source = readFileSync(new URL("./AgentReviewPolicyPanel.tsx", import.meta.url), "utf8");
  const page = readFileSync(new URL("../../../app/(app)/agents/page.tsx", import.meta.url), "utf8");

  assert.match(source, /100% calibrating/);
  assert.match(source, /50% high coverage/);
  assert.match(source, /25% medium coverage/);
  assert.match(source, /10% monitoring floor/);
  assert.match(source, /Critical-risk or incomplete opportunities require review/);
  assert.match(source, /Editing creates a new version/);
  assert.match(source, /MCP transport alone does not provide that guarantee/);
  assert.match(source, /Edit as new version/);
  assert.match(source, /Human review policy by agent version/);
  assert.match(source, /one immutable version of one agent, not every agent in this workspace/);
  assert.match(
    source,
    /Create policy for \$\{selectedTarget\.agentDisplayName\} · v\$\{selectedTarget\.versionNumber\}/,
  );
  assert.match(source, /Every active agent version already has a review policy/);
  assert.match(source, /existing policies remain visible for audit/);
  assert.match(source, /disabled=\{Boolean\(editingPolicyId\)\}/);
  assert.match(source, /if \(loading && !registry\) return null/);
  assert.match(source, /reviewPolicySectionIsVisible\(registry\)/);
  assert.match(source, />\s*Retry\s*</);
  assert.doesNotMatch(source, /disabled=\{loading \|\| !registry/);
  assert.match(page, /<AgentWorkspacePanels\s*\/>/);
});

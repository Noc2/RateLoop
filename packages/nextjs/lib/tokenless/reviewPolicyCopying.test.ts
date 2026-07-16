import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(name: string) {
  return readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
}

test("every agent policy insert preserves or explicitly initializes the fixed review rate", () => {
  const setup = source("workspaceAgentSetup.ts");
  const integrations = source("agentIntegrations.ts");
  const intents = source("agentConnectionIntents.ts");

  assert.equal((setup.match(/INSERT INTO tokenless_agent_review_policies/gu) ?? []).length, 1);
  assert.equal((setup.match(/production_floor_bps,fixed_rate_bps/gu) ?? []).length, 1);
  assert.match(setup, /rowOptionalNumber\(policy, "fixed_rate_bps"\)/u);

  assert.equal((integrations.match(/INSERT INTO tokenless_agent_review_policies/gu) ?? []).length, 2);
  assert.equal((integrations.match(/production_floor_bps, ?fixed_rate_bps/gu) ?? []).length, 2);
  assert.match(integrations, /1000,NULL,20/u);
  assert.match(integrations, /optionalInteger\(review, "fixed_rate_bps"\)/u);

  assert.equal((intents.match(/INSERT INTO tokenless_agent_review_policies/gu) ?? []).length, 1);
  assert.equal((intents.match(/production_floor_bps,fixed_rate_bps/gu) ?? []).length, 1);
  assert.match(intents, /1000,NULL,20/u);
});

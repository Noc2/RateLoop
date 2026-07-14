import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("Human Discover keeps the compact legacy feed and action-rail composition", () => {
  const page = source("./answer/AnswerPageClient.tsx");
  const card = source("./answer/PublicQuestionCard.tsx");
  const tabs = source("./human/HumanTabs.tsx");

  assert.match(page, /AppPageShell/);
  assert.match(page, /tab-control/);
  assert.doesNotMatch(page, /display-section|answer-query|Answer safely/);
  assert.match(card, /17\.25rem/);
  assert.match(card, /surface-card/);
  assert.match(tabs, /Discover/);
  assert.match(tabs, /Profile/);
  assert.match(tabs, /Settings/);
});

test("Agents uses URL-backed workspace tabs", () => {
  const tabs = source("./agents/AgentTabs.tsx");
  const integration = source("./agents/AgentIntegrationPanel.tsx");

  assert.match(tabs, /tab-control/);
  assert.match(tabs, /pill-active/);
  assert.match(tabs, /Overview/);
  assert.match(tabs, /Integrate/);
  assert.match(tabs, /Evaluations/);
  assert.match(integration, /quote → ask → payment → wait → result/);
  assert.match(integration, /\/handoff/);
});

test("Human profile keeps established surface cards without a dashboard hero", () => {
  const profile = source("./account/ProfileClient.tsx");

  assert.match(profile, /surface-card rounded-2xl/);
  assert.doesNotMatch(profile, /lg:grid-cols-\[minmax\(0,1fr\)_340px\]/);
});

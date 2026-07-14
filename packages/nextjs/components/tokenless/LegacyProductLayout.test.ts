import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("Answer keeps the compact legacy feed and action-rail composition", () => {
  const page = source("./answer/AnswerPageClient.tsx");
  const card = source("./answer/PublicQuestionCard.tsx");

  assert.match(page, /AppPageShell/);
  assert.match(page, /tab-control/);
  assert.doesNotMatch(page, /display-section|answer-query|Answer safely/);
  assert.match(card, /17\.25rem/);
  assert.match(card, /surface-card/);
});

test("Ask keeps the legacy compact tabs and stacked submission cards", () => {
  const page = source("./ask/AskPageClient.tsx");
  const tabs = source("./ask/AskPageTabs.tsx");
  const publicQuestion = source("./ask/PublicQuestionClient.tsx");

  assert.match(page, /AppPageShell/);
  assert.doesNotMatch(page, /display-section|Put a question in front of humans/);
  assert.match(tabs, /tab-control/);
  assert.match(tabs, /pill-active/);
  assert.match(publicQuestion, /surface-card rounded-2xl/);
});

test("Account keeps the legacy settings tabs without a dashboard hero", () => {
  const layout = source("../../app/(app)/settings/layout.tsx");
  const tabs = source("./account/AccountTabs.tsx");
  const profile = source("./account/ProfileClient.tsx");

  assert.match(layout, /AppPageShell/);
  assert.doesNotMatch(layout, /display-section|Your RateLoop account/);
  assert.match(tabs, /tab-control/);
  assert.match(profile, /surface-card rounded-2xl/);
  assert.doesNotMatch(profile, /lg:grid-cols-\[minmax\(0,1fr\)_340px\]/);
});

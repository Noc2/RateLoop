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
  const page = source("../../app/(app)/agents/page.tsx");
  const legacyAsk = source("../../app/(app)/ask/page.tsx");

  assert.match(tabs, /tab-control/);
  assert.match(tabs, /pill-active/);
  assert.match(tabs, /Overview/);
  assert.doesNotMatch(tabs, /Integrate/);
  assert.match(tabs, /Evaluations/);
  assert.doesNotMatch(page, /integrate/);
  assert.match(legacyAsk, /redirect\("\/agents\?tab=overview"\)/);
});

test("Human profile keeps established surface cards without a dashboard hero", () => {
  const profile = source("./account/ProfileClient.tsx");

  assert.match(profile, /surface-card rounded-2xl/);
  assert.doesNotMatch(profile, /NotificationSettingsPanel/);
  assert.doesNotMatch(profile, /lg:grid-cols-\[minmax\(0,1fr\)_340px\]/);
});

test("Human Discover keeps sign-in requirements concise", () => {
  const page = source("./answer/AnswerPageClient.tsx");
  assert.match(page, /Sign in to discover review work/);
  assert.match(page, /eligible, signed-in RateLoop humans/);
  assert.match(page, /ThirdwebSessionButton/);
});

test("Human Discover discloses source filters only when both queues have work", () => {
  const page = source("./answer/AnswerPageClient.tsx");

  assert.match(page, /tasks\.length > 0 && assignments\.length > 0/);
  assert.match(page, /\["all", "public", "private"\]/);
  assert.doesNotMatch(page, /\["all", "public", "private", "submitted"\]/);
  assert.ok(page.indexOf("assignments.map") < page.indexOf("tasks.map"));
  assert.match(page, /No review work is available right now/);
  assert.match(page, /Check again/);
});

test("Human profile and settings disclose one task at a time", () => {
  const page = source("../../app/(app)/human/page.tsx");
  const profile = source("./account/ProfileClient.tsx");
  const invitations = source("./account/InvitationRouterPanel.tsx");

  assert.match(page, /ProfileOverview/);
  assert.match(page, /InvitationRouterPanel/);
  assert.match(page, /section === "proof-of-human"/);
  assert.match(page, /section === "paid-work"/);
  assert.match(page, /SettingsOverview/);
  assert.match(page, /Account and security notifications are always required/);
  assert.match(page, /section === "notifications"/);
  assert.doesNotMatch(profile, /InvitationRedemption|reviewer memberships/);
  assert.match(invitations, /startsWith\("rli_"\)/);
  assert.match(invitations, /startsWith\("rlgi_"\)/);
});

test("answer search is rendered only by Human Discover", () => {
  const page = source("../../app/(app)/human/page.tsx");

  assert.match(page, /if \(tab === "discover"\)[\s\S]*<AnswerSearch \/>/);
  assert.equal(page.match(/<AnswerSearch \/>/g)?.length, 1);
});

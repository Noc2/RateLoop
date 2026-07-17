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
  assert.match(card, /import \{ Card \}/);
  assert.match(card, /<Card/);
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
  assert.match(page, /<SignedOutGate/);
  assert.match(page, /headingLevel=\{2\}/);
  assert.match(page, /layout="embedded"/);
  assert.match(page, /preview=\{<HumanReviewExample \/>\}/);
  assert.doesNotMatch(page, /ThirdwebSessionButton/);
});

test("Human Discover discloses source filters only when both queues have work", () => {
  const page = source("./answer/AnswerPageClient.tsx");
  const card = source("./answer/PublicQuestionCard.tsx");

  assert.match(page, /tasks\.length > 0 && assignments\.length > 0/);
  assert.match(page, /\["all", "public", "private"\]/);
  assert.doesNotMatch(page, /\["all", "public", "private", "submitted"\]/);
  assert.ok(page.indexOf("assignments.map") < page.indexOf("tasks.map"));
  assert.match(page, /No review work is available right now/);
  assert.match(page, /Check again/);
  assert.match(card, /Public reviews can be browsed now/);
  assert.match(card, /\/settings\/wallets/);
});

test("Human profile and settings render their controls directly", () => {
  const page = source("../../app/(app)/human/page.tsx");
  const signInPrompt = source("./human/HumanAccountSignInPrompt.tsx");
  const profileContent = source("./human/HumanProfileContent.tsx");
  const profile = source("./account/ProfileClient.tsx");
  const invitations = source("./account/InvitationRouterPanel.tsx");
  const paidEligibility = source("./PaidEligibilityClient.tsx");

  assert.match(page, /<HumanProfileContent worldIdEnabled=\{isWorldIdAssuranceEnabled\(\)\} \/>/);
  assert.match(page, /<NotificationSettingsPanel \/>/);
  assert.match(page, /<HumanAccountSignInPrompt tab=\{tab\} \/>/);
  assert.match(page, /if \(!session\) return <HumanAccountSignInPrompt tab=\{tab\} \/>/);
  assert.ok(
    page.indexOf("if (!session) return <HumanAccountSignInPrompt tab={tab} />") <
      page.lastIndexOf("<HumanTabs active={tab} />"),
  );
  assert.match(signInPrompt, /<SignedOutGate/);
  assert.match(page, /findAuthSession/);
  assert.match(profileContent, /InvitationRouterPanel/);
  assert.match(profileContent, /PrivateGroupMembershipsPanel/);
  assert.match(profileContent, /worldIdEnabled \? <WorldIdProfilePanel \/>/);
  assert.match(profileContent, /<PaidEligibilityClient \/>/);
  assert.ok(profileContent.indexOf("<ProfileClient />") < profileContent.indexOf("<InvitationRouterPanel"));
  assert.ok(profileContent.indexOf("<InvitationRouterPanel") < profileContent.indexOf("<PrivateGroupMembershipsPanel"));
  assert.doesNotMatch(page, /ProfileOverview|SettingsOverview|Customize|SectionBackLink/);
  assert.doesNotMatch(page, /section ===/);
  assert.doesNotMatch(profile, /<details|<summary/);
  assert.doesNotMatch(profile, /Sign-in details|Provider|Not provided|Account ID|\/api\/auth\/session/);
  assert.doesNotMatch(profile, /InvitationRedemption|reviewer memberships/);
  assert.match(invitations, /startsWith\("rli_"\)/);
  assert.match(invitations, /startsWith\("rlgi_"\)/);
  assert.match(paidEligibility, /Add payout wallet/);
  assert.doesNotMatch(paidEligibility, /Sign in to RateLoop first/);
});

test("Human Discover relies on the shell-level site search", () => {
  const page = source("../../app/(app)/human/page.tsx");
  const shell = source("./TokenlessShell.tsx");

  assert.doesNotMatch(page, /AnswerSearch|SiteSearch/);
  assert.match(shell, /<SiteSearch mobile \/>/);
  assert.match(shell, /<SiteSearch \/>/);
});

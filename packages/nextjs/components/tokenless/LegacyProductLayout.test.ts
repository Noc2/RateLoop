import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath: string) {
  const catalogs = ["account", "agents", "human", "review", "shared"].map(name =>
    readFileSync(new URL(`../../messages/en/${name}.json`, import.meta.url), "utf8"),
  );
  return [readFileSync(new URL(relativePath, import.meta.url), "utf8"), ...catalogs].join("\n");
}

function rawSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("assigned review work keeps the compact feed and action-rail composition", () => {
  const page = source("./answer/AnswerPageClient.tsx");
  const card = source("./answer/PublicQuestionCard.tsx");
  const tabs = source("./human/HumanTabs.tsx");

  assert.match(page, /AppPageShell/);
  assert.match(tabs, /tab-control/);
  assert.doesNotMatch(page, /display-section|answer-query|Answer safely/);
  assert.match(card, /17\.25rem/);
  assert.match(card, /import \{ Card \}/);
  assert.match(card, /<Card/);
  assert.match(tabs, /To review/);
  assert.match(tabs, /History/);
  assert.match(tabs, /Profile/);
  assert.match(tabs, /Settings/);
  assert.doesNotMatch(page, /aria-label="Review status"/);
});

test("Agents uses URL-backed workspace tabs", () => {
  const tabs = source("./agents/AgentTabs.tsx");
  const page = source("../../app/[locale]/(app)/agents/AgentsSectionPage.tsx");
  const legacyAsk = source("../../app/[locale]/(app)/ask/page.tsx");

  assert.match(tabs, /tab-control/);
  assert.match(tabs, /pill-active/);
  assert.match(tabs, /Overview/);
  assert.doesNotMatch(tabs, /Integrate/);
  assert.match(tabs, /Connections/);
  assert.match(tabs, /Approvals/);
  assert.match(tabs, /Review setup/);
  assert.match(tabs, /Results/);
  assert.doesNotMatch(page, /integrate/);
  assert.match(legacyAsk, /redirect\(\{ href: "\/agents\/overview", locale \}\)/);
});

test("Human profile keeps established surface cards without a dashboard hero", () => {
  const profile = source("./account/ProfileClient.tsx");

  assert.match(profile, /<Card as="section" className="rounded-2xl/);
  assert.match(profile, /<h2 id="profile-display-name-heading"[\s\S]*\{t\("title"\)\}[\s\S]*<\/h2>/);
  assert.match(profile, /<Field[\s\S]*id="profile-display-name"[\s\S]*label=\{t\("label"\)\}/);
  const rawProfile = rawSource("./account/ProfileClient.tsx");
  assert.doesNotMatch(rawProfile, /How RateLoop addresses you/);
  assert.doesNotMatch(rawProfile, /NotificationSettingsPanel/);
  assert.doesNotMatch(rawProfile, /lg:grid-cols-\[minmax\(0,1fr\)_340px\]/);
});

test("assigned review work keeps sign-in requirements concise", () => {
  const page = source("./answer/AnswerPageClient.tsx");
  assert.match(page, /Sign in to view assigned work/);
  assert.match(page, /only review work assigned to your account/);
  assert.match(page, /<SignedOutGate/);
  assert.match(page, /headingLevel=\{2\}/);
  assert.match(page, /layout="embedded"/);
  assert.doesNotMatch(page, /HumanReviewExample|Example review|preview=/);
  assert.doesNotMatch(page, /ThirdwebSessionButton/);
});

test("assigned review work omits discovery filters and keeps actionable empty states", () => {
  const page = source("./answer/AnswerPageClient.tsx");
  const card = source("./answer/PublicQuestionCard.tsx");

  assert.doesNotMatch(page, /sourceOptions|setScope|setQuery|searchParams\.get\("q"\)|searchParams\.get\("scope"\)/);
  assert.ok(page.indexOf("assignments.map") < page.indexOf("tasks.map"));
  assert.match(page, /No review work is assigned to you right now/);
  assert.match(page, /No review history yet/);
  assert.match(page, /Use an invitation/);
  assert.doesNotMatch(rawSource("./answer/AnswerPageClient.tsx"), /Check again/);
  assert.match(card, /assigned paid work/);
  assert.match(card, /\/settings\/wallets/);
});

test("Human profile and settings render their controls directly", () => {
  const page = source("../../app/[locale]/(app)/human/HumanSectionPage.tsx");
  const signInPrompt = source("./human/HumanAccountSignInPrompt.tsx");
  const profileContent = source("./human/HumanProfileContent.tsx");
  const profileSectionFocus = source("./human/ProfileSectionFocus.tsx");
  const invitations = source("./account/InvitationRouterPanel.tsx");

  assert.match(page, /<HumanProfileContent worldIdEnabled=\{isWorldIdAssuranceEnabled\(\)\} \/>/);
  assert.match(page, /<ProfileSectionFocus section=\{section\} \/>/);
  assert.match(page, /<NotificationSettingsPanel \/>/);
  assert.match(page, /<ReviewerNotificationInbox \/>/);
  assert.match(page, /tab === "inbox"/);
  assert.match(page, /<HumanAccountSignInPrompt/);
  assert.match(page, /returnTo=\{humanAccountReturnTo/);
  assert.ok(page.indexOf("if (!session)") < page.lastIndexOf("<HumanTabs active={tab} />"));
  assert.match(signInPrompt, /<SignedOutGate/);
  assert.match(signInPrompt, /returnTo=\{returnTo\}/);
  assert.match(profileSectionFocus, /scrollIntoView/);
  assert.match(page, /findAuthSession/);
  assert.match(profileContent, /ReviewerAccessPanel/);
  assert.match(profileContent, /worldIdEnabled \? <WorldIdProfilePanel \/>/);
  assert.ok(profileContent.indexOf("<ProfileClient />") < profileContent.indexOf("<ReviewerAccessPanel"));
  assert.doesNotMatch(profileContent, /InvitationRouterPanel/);
  assert.match(profileContent, /configuredHumanReviewLanes/);
  assert.match(profileContent, /paidReviewAvailable \? \(/);
  for (const surface of [
    "PaidEligibilityClient",
    "ReviewerEarningsClient",
    "ForecastIntegrityClient",
    "RaterSettlementRecoveryClient",
    "FeedbackBonusClaimsClient",
  ]) {
    assert.match(profileContent, new RegExp(surface));
  }
  assert.doesNotMatch(
    rawSource("../../app/[locale]/(app)/human/HumanSectionPage.tsx"),
    /ProfileOverview|SettingsOverview|Customize|SectionBackLink/,
  );
  assert.doesNotMatch(rawSource("./account/ProfileClient.tsx"), /<details|<summary/);
  assert.doesNotMatch(
    rawSource("./account/ProfileClient.tsx"),
    /Sign-in details|Provider|Not provided|Account ID|\/api\/auth\/session/,
  );
  assert.doesNotMatch(rawSource("./account/ProfileClient.tsx"), /InvitationRedemption|reviewer memberships/);
  assert.match(invitations, /startsWith\("rli_"\)/);
  assert.match(invitations, /startsWith\("rlri_"\)/);
  assert.doesNotMatch(rawSource("./account/InvitationRouterPanel.tsx"), /rlgi_|private-groups/);
  assert.match(invitations, /label=\{t\("code"\)\}/);
  assert.doesNotMatch(invitations, /<label/);
});

test("Human Discover relies on the shell-level site search", () => {
  const page = source("../../app/[locale]/(app)/human/HumanSectionPage.tsx");
  const shell = source("./TokenlessShell.tsx");

  assert.doesNotMatch(page, /AnswerSearch|SiteSearch/);
  assert.match(shell, /<SiteSearch mobile \/>/);
  assert.match(shell, /<SiteSearch \/>/);
});

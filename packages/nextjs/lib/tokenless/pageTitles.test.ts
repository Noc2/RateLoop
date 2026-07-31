import { agentPageTitle, humanPageTitle } from "./pageTitles";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("agent titles describe the selected workspace destination", () => {
  assert.equal(agentPageTitle(undefined), "Overview");
  assert.equal(agentPageTitle("billing"), "Billing & settings");
  assert.equal(agentPageTitle("agents"), "Connections");
  assert.equal(agentPageTitle("connect"), "Connections");
  assert.equal(agentPageTitle("inbox"), "Approvals");
  assert.equal(agentPageTitle("groups"), "Review setup");
  assert.equal(agentPageTitle("registry"), "Review setup");
  assert.equal(agentPageTitle("evaluations"), "Results");
  assert.equal(agentPageTitle("results"), "Results");
  assert.equal(agentPageTitle("approvals"), "Approvals");
  assert.equal(agentPageTitle("review-setup"), "Review setup");
  assert.equal(agentPageTitle("evidence"), "Results");
  assert.equal(agentPageTitle("unknown"), "Overview");
});

test("reviewer titles prioritize the active task over a generic account label", () => {
  assert.equal(humanPageTitle({}), "To review");
  assert.equal(humanPageTitle({ view: "history" }), "Review history");
  assert.equal(humanPageTitle({ tab: "inbox" }), "Reviewer notifications");
  assert.equal(humanPageTitle({ tab: "profile" }), "Reviewer profile");
  assert.equal(humanPageTitle({ tab: "settings" }), "Account settings");
  assert.equal(humanPageTitle({ invite: "1", tab: "discover" }), "Reviewer invitation");
  assert.equal(humanPageTitle({ assignment: "assignment_1", tab: "settings" }), "Complete review");
  assert.equal(humanPageTitle({ routeSection: "history" }), "Review history");
  assert.equal(humanPageTitle({ routeSection: "profile" }), "Reviewer profile");
});

test("reviewed documentation and legal routes define descriptive metadata", () => {
  const routeTitles = new Map([
    ["../../app/[locale]/(public)/docs/page.tsx", "Documentation"],
    ["../../app/[locale]/(public)/docs/ai/page.tsx", "Agent integration guide"],
    ["../../app/[locale]/(public)/docs/ai/errors/page.tsx", "Agent error reference"],
    ["../../app/[locale]/(public)/docs/evidence/page.tsx", "Evidence reference"],
    ["../../app/[locale]/(public)/docs/how-it-works/page.tsx", "How RateLoop works"],
    ["../../app/[locale]/(public)/docs/human-oversight/page.tsx", "Human oversight"],
    ["../../app/[locale]/(public)/docs/sdk/page.tsx", "SDK guide"],
    ["../../app/[locale]/(public)/docs/smart-contracts/page.tsx", "Smart contracts"],
    ["../../app/[locale]/(public)/legal/page.tsx", "Legal"],
    ["../../app/[locale]/(public)/legal/cookies/page.tsx", "Cookies and browser storage"],
    ["../../app/[locale]/(public)/legal/dpa/page.tsx", "Data processing addendum"],
    ["../../app/[locale]/(public)/legal/imprint/page.tsx", "Imprint"],
    ["../../app/[locale]/(public)/legal/privacy/page.tsx", "Privacy notice"],
    ["../../app/[locale]/(public)/legal/subprocessors/page.tsx", "Subprocessors"],
    ["../../app/[locale]/(public)/legal/terms/page.tsx", "Terms"],
  ]);

  for (const [path, title] of routeTitles) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(source, /getLocalizedPublicMetadata/, path);
    assert.match(source, new RegExp(`title: "${title}"`), path);
  }
});

test("signed-in routes derive metadata from the current tab and the root app applies the RateLoop title template", () => {
  const agents = readFileSync(new URL("../../app/[locale]/(app)/agents/page.tsx", import.meta.url), "utf8");
  const human = readFileSync(new URL("../../app/[locale]/(app)/human/page.tsx", import.meta.url), "utf8");
  const agentSection = readFileSync(
    new URL("../../app/[locale]/(app)/agents/[section]/page.tsx", import.meta.url),
    "utf8",
  );
  const agentContent = readFileSync(
    new URL("../../app/[locale]/(app)/agents/AgentsSectionPage.tsx", import.meta.url),
    "utf8",
  );
  const humanSection = readFileSync(
    new URL("../../app/[locale]/(app)/human/[section]/page.tsx", import.meta.url),
    "utf8",
  );
  const humanContent = readFileSync(
    new URL("../../app/[locale]/(app)/human/HumanSectionPage.tsx", import.meta.url),
    "utf8",
  );
  const metadata = readFileSync(new URL("../../utils/scaffold-eth/getMetadata.ts", import.meta.url), "utf8");

  assert.match(agents, /generateMetadata[\s\S]*getTranslations\(\{ locale, namespace: "agents\.metadata" \}\)/);
  assert.match(human, /generateMetadata[\s\S]*getTranslations\(\{ locale, namespace: "human\.metadata" \}\)/);
  assert.match(agentSection, /generateMetadata[\s\S]*return \{ title: t\(tab\) \}/);
  assert.match(humanSection, /generateMetadata[\s\S]*return \{ title: t\(key\) \}/);
  assert.doesNotMatch(agentContent, /PageHeading|agentPageTitle/);
  assert.doesNotMatch(humanContent, /PageHeading/);
  assert.doesNotMatch(agentContent, /<h1 className="sr-only">Agent workspace/);
  assert.doesNotMatch(humanContent, /<h1 className="sr-only">/);
  assert.match(metadata, /const titleTemplate = "%s \| RateLoop"/);
});

import { agentPageTitle, humanPageTitle } from "./pageTitles";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("agent titles describe the selected workspace destination", () => {
  assert.equal(agentPageTitle(undefined), "Overview");
  assert.equal(agentPageTitle("agents"), "Connections");
  assert.equal(agentPageTitle("connect"), "Connections");
  assert.equal(agentPageTitle("inbox"), "Approvals");
  assert.equal(agentPageTitle("groups"), "Review setup");
  assert.equal(agentPageTitle("registry"), "Review setup");
  assert.equal(agentPageTitle("evaluations"), "Results");
  assert.equal(agentPageTitle("evidence"), "Evidence");
  assert.equal(agentPageTitle("unknown"), "Overview");
});

test("reviewer titles prioritize the active task over a generic account label", () => {
  assert.equal(humanPageTitle({}), "To review");
  assert.equal(humanPageTitle({ view: "history" }), "Review history");
  assert.equal(humanPageTitle({ tab: "profile" }), "Reviewer profile");
  assert.equal(humanPageTitle({ tab: "settings" }), "Account settings");
  assert.equal(humanPageTitle({ invite: "1", tab: "discover" }), "Reviewer invitation");
  assert.equal(humanPageTitle({ assignment: "assignment_1", tab: "settings" }), "Complete review");
});

test("reviewed documentation and legal routes define descriptive metadata", () => {
  const routeTitles = new Map([
    ["../../app/(public)/docs/page.tsx", "Documentation"],
    ["../../app/(public)/docs/ai/page.tsx", "Agent integration guide"],
    ["../../app/(public)/docs/ai/errors/page.tsx", "Agent error reference"],
    ["../../app/(public)/docs/evidence/page.tsx", "Evidence reference"],
    ["../../app/(public)/docs/how-it-works/page.tsx", "How RateLoop works"],
    ["../../app/(public)/docs/human-oversight/page.tsx", "Human oversight"],
    ["../../app/(public)/docs/sdk/page.tsx", "SDK guide"],
    ["../../app/(public)/docs/smart-contracts/page.tsx", "Smart contracts"],
    ["../../app/(public)/legal/page.tsx", "Legal"],
    ["../../app/(public)/legal/cookies/page.tsx", "Cookies and browser storage"],
    ["../../app/(public)/legal/dpa/page.tsx", "Data processing addendum"],
    ["../../app/(public)/legal/imprint/page.tsx", "Imprint"],
    ["../../app/(public)/legal/privacy/page.tsx", "Privacy notice"],
    ["../../app/(public)/legal/subprocessors/page.tsx", "Subprocessors"],
    ["../../app/(public)/legal/terms/page.tsx", "Terms"],
  ]);

  for (const [path, title] of routeTitles) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(source, new RegExp(`metadata: Metadata = \\{ title: "${title}" \\}`), path);
  }
});

test("signed-in routes derive metadata from the current tab and the root app applies the RateLoop title template", () => {
  const agents = readFileSync(new URL("../../app/(app)/agents/page.tsx", import.meta.url), "utf8");
  const human = readFileSync(new URL("../../app/(app)/human/page.tsx", import.meta.url), "utf8");
  const metadata = readFileSync(new URL("../../utils/scaffold-eth/getMetadata.ts", import.meta.url), "utf8");

  assert.match(agents, /generateMetadata[\s\S]*agentPageTitle\(\(await searchParams\)\.tab\)/);
  assert.match(human, /generateMetadata[\s\S]*humanPageTitle\(await searchParams\)/);
  assert.match(metadata, /const titleTemplate = "%s \| RateLoop"/);
});

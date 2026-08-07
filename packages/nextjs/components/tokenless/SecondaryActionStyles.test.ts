import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(new URL("../../styles/globals.css", import.meta.url), "utf8");
const landingPage = readFileSync(new URL("../../app/[locale]/(public)/page.tsx", import.meta.url), "utf8");
const workspacePlanOverview = readFileSync(new URL("../pricing/WorkspacePlanOverview.tsx", import.meta.url), "utf8");
const setupFlow = readFileSync(new URL("./agents/setup/AgentSetupFlow.tsx", import.meta.url), "utf8");

test("secondary app actions reuse the legacy solid treatment", () => {
  assert.match(styles, /--rateloop-secondary-button-bg: rgb\(245 245 245 \/ 0\.18\)/);
  assert.match(styles, /--rateloop-secondary-button-bg-hover: rgb\(245 245 245 \/ 0\.24\)/);
  assert.match(styles, /\.btn\.rateloop-secondary-action,/);
  assert.match(styles, /\.btn\.btn-outline,/);
  assert.match(styles, /\.btn\.btn-secondary:not\(\.btn-circle\):not\(\.btn-square\)/);
});

const secondaryActionConsumers = Object.fromEntries(
  [
    "human/ForecastIntegrityClient.tsx",
    "human/ReviewerEarningsClient.tsx",
    "human/RaterSettlementRecoveryClient.tsx",
    "human/FeedbackBonusClaimsClient.tsx",
    "agents/setup/AgentSetupFlow.tsx",
  ].map(relative => [relative, readFileSync(new URL(`./${relative}`, import.meta.url), "utf8")]),
);

test("back actions use the solid secondary button with a decorative left chevron", () => {
  assert.match(styles, /\.rateloop-back-action::before/);
  // The secondary treatment comes from variant="secondary"; restating the class in
  // className was redundant, so assert the two things that actually matter.
  assert.match(setupFlow, /rateloop-back-action/);
  assert.match(setupFlow, /variant="secondary"/);
});

test("only the Button component decides what the secondary treatment looks like", () => {
  // `.btn.rateloop-secondary-action` is a compound selector, so an element carrying
  // only the second class renders with no background, no hover and no disabled state.
  // Five human-surface controls did exactly that. Non-button surfaces use
  // `.rateloop-secondary-surface` instead.
  assert.match(styles, /\.rateloop-secondary-surface \{/);
  for (const [name, source] of Object.entries(secondaryActionConsumers)) {
    for (const match of source.matchAll(/className="([^"]*rateloop-secondary-action[^"]*)"/gu)) {
      assert.match(match[1] ?? "", /\bbtn\b/, `${name} applies the secondary class without btn`);
    }
    assert.doesNotMatch(
      source,
      /containerClassName="[^"]*rateloop-secondary-action/u,
      `${name} applies a button class to a non-button container`,
    );
  }
});

test("landing page calls to action keep their dedicated styling", () => {
  const heroActions = landingPage.slice(
    landingPage.indexOf('href="/human/review"'),
    landingPage.indexOf("<SupportedAgentsSection"),
  );
  assert.doesNotMatch(heroActions, /rateloop-secondary-action/);
  assert.match(workspacePlanOverview, /href="\/pricing" className="btn rateloop-secondary-action/);
});

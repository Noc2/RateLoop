import React from "react";
import { WorkspacePlanCards } from "./WorkspacePlanCards";
import { WorkspacePlanOverview } from "./WorkspacePlanOverview";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { WorkspaceSettingsClient } from "~~/components/tokenless/WorkspaceSettingsClient";
import { TOKENLESS_BILLING_PLANS, TOKENLESS_HOSTED_REVIEW_COPY, formatUsdPrice } from "~~/lib/billing/plans";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("workspace plan overview binds public prices and enforced resource limits to the canonical plans", () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const html = renderToStaticMarkup(<WorkspacePlanOverview />).replace(/\s+/g, " ");

  assert.equal(html.match(/<article/g)?.length, 3);
  assert.match(html, new RegExp(formatUsdPrice(TOKENLESS_BILLING_PLANS.free.monthlyPriceCents).replace("$", "\\$")));
  assert.match(html, new RegExp(`${TOKENLESS_BILLING_PLANS.free.activeAgents} active agent`));
  assert.match(html, new RegExp(`${TOKENLESS_BILLING_PLANS.free.activePrivateGroups} invited reviewer group`));
  assert.match(
    html,
    new RegExp(formatUsdPrice(TOKENLESS_BILLING_PLANS.early_access.monthlyPriceCents).replace("$", "\\$")),
  );
  assert.match(html, new RegExp(`${TOKENLESS_BILLING_PLANS.early_access.activeAgents} active agents`));
  assert.match(html, new RegExp(`${TOKENLESS_BILLING_PLANS.early_access.activePrivateGroups} invited reviewer groups`));
  assert.doesNotMatch(html, /completed review decisions|decision allowance/iu);
  assert.match(html, /First 12 months/);
  assert.match(html, /Enterprise/);
  assert.match(html, /Custom volumes and terms/);
  assert.equal(html.match(/href="\/pricing"/g)?.length, 1);
  assert.match(html, /Compare plans/);
  assert.doesNotMatch(html, /\$99|20% off|Choose Early Access|Book demo|Custom integrations/);
});

test("workspace plan overview keeps its concise pricing path localized in German", () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const html = renderToStaticMarkup(<WorkspacePlanOverview locale="de" />).replace(/\s+/g, " ");

  assert.match(html, /Erste 12 Monate/);
  assert.match(html, /pro Workspace\/Monat/);
  assert.match(html, /Individuelle Volumen und Bedingungen/);
  assert.match(html, /Tarife vergleichen/);
  assert.equal(html.match(/href="\/de\/pricing"/g)?.length, 1);
});

test("all workspace plan consumers share the hosted invited-unpaid availability rule", () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const overview = renderToStaticMarkup(<WorkspacePlanOverview />).replace(/\s+/g, " ");
  const cards = renderToStaticMarkup(<WorkspacePlanCards subscriptionsEnabled={false} />).replace(/\s+/g, " ");
  const settingsSource = readFileSync(new URL("../tokenless/WorkspaceSettingsClient.tsx", import.meta.url), "utf8");

  assert.equal(typeof WorkspaceSettingsClient, "function");
  assert.match(overview, new RegExp(TOKENLESS_HOSTED_REVIEW_COPY.planSummary));
  assert.match(cards, new RegExp(TOKENLESS_HOSTED_REVIEW_COPY.planBenefit));
  assert.equal(settingsSource.match(/TOKENLESS_HOSTED_REVIEW_COPY\.planBenefit/g)?.length, 2);
  assert.doesNotMatch(`${overview}\n${cards}\n${settingsSource}`, /decisionsPerPeriod|Workspace review decision usage/);
  assert.match(settingsSource, /activeAgentLimitLabel\(billing\.limits\.activeAgents\)/);
  assert.match(settingsSource, /privateGroupLimitLabel\(billing\.limits\.activePrivateGroups\)/);
  assert.doesNotMatch(settingsSource, /Paid (?:reviewer )?panels? available/);
});

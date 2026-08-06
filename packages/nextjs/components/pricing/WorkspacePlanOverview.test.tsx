import React from "react";
import { WorkspacePlanCards } from "./WorkspacePlanCards";
import { WorkspacePlanOverview } from "./WorkspacePlanOverview";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { WorkspaceSettingsClient } from "~~/components/tokenless/WorkspaceSettingsClient";
import { TOKENLESS_BILLING_PLANS, TOKENLESS_HOSTED_REVIEW_COPY } from "~~/lib/billing/plans";
import { FOUNDING_PILOT, SANDBOX_PRICE_CENTS, formatEurPrice } from "~~/lib/marketing/foundingPilot";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("workspace plan overview binds public prices and enforced resource limits to the canonical plans", () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const html = renderToStaticMarkup(<WorkspacePlanOverview />).replace(/\s+/g, " ");

  assert.equal(html.match(/<article/g)?.length, 2);
  assert.ok(html.includes(formatEurPrice(SANDBOX_PRICE_CENTS).replace(/\s+/gu, " ")));
  assert.match(html, new RegExp(`${TOKENLESS_BILLING_PLANS.free.activeAgents} active agent`));
  assert.match(html, new RegExp(`${TOKENLESS_BILLING_PLANS.free.activePrivateGroups} invited reviewer group`));
  assert.ok(html.includes(formatEurPrice(FOUNDING_PILOT.priceCents).replace(/\s+/gu, " ")));
  assert.match(html, /Sandbox/);
  assert.match(html, /Founding Pilot/);
  assert.match(html, /6-week structured pilot/);
  assert.match(html, /All prices net of 19% VAT\./);
  assert.doesNotMatch(html, /completed review decisions|decision allowance/iu);
  assert.equal(html.match(/href="\/pricing"/g)?.length, 1);
  assert.match(html, /Compare plans/);
  // The public surface must never carry the retired dollar anchor or the discount promise again.
  assert.doesNotMatch(html, /\$0|\$29|\$99|20% off|Choose Early Access|Book demo|Custom integrations|First 12 months/);
});

test("workspace plan overview keeps its concise pricing path localized in German", () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const html = renderToStaticMarkup(<WorkspacePlanOverview locale="de" />).replace(/\s+/g, " ");

  assert.match(html, /Gründungsangebot/);
  assert.match(html, /einmalig, netto/);
  assert.match(html, /Alle Preise netto zzgl\. 19 % USt\./);
  assert.ok(html.includes(formatEurPrice(FOUNDING_PILOT.priceCents, "de").replace(/\s+/gu, " ")));
  assert.match(html, /Tarife vergleichen/);
  assert.equal(html.match(/href="\/de\/pricing"/g)?.length, 1);
});

test("all workspace plan consumers share the hosted invited-unpaid availability rule", () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const overview = renderToStaticMarkup(<WorkspacePlanOverview />).replace(/\s+/g, " ");
  const cards = renderToStaticMarkup(<WorkspacePlanCards />).replace(/\s+/g, " ");
  const settingsSource = readFileSync(new URL("../tokenless/WorkspaceSettingsClient.tsx", import.meta.url), "utf8");

  assert.equal(typeof WorkspaceSettingsClient, "function");
  assert.match(overview, new RegExp(TOKENLESS_HOSTED_REVIEW_COPY.planSummary));
  assert.match(cards, new RegExp(TOKENLESS_HOSTED_REVIEW_COPY.planBenefit));
  assert.equal(settingsSource.match(/TOKENLESS_HOSTED_REVIEW_COPY\.planBenefit/g)?.length, 2);
  assert.doesNotMatch(`${overview}\n${cards}\n${settingsSource}`, /decisionsPerPeriod|Workspace review decision usage/);
  assert.match(settingsSource, /activeAgentLimitLabel\(billing\.limits\.activeAgents, locale\)/);
  assert.match(settingsSource, /privateGroupLimitLabel\(billing\.limits\.activePrivateGroups, locale\)/);
  assert.doesNotMatch(settingsSource, /Plan and usage/);
  assert.doesNotMatch(settingsSource, /Paid (?:reviewer )?panels? available/);
});

test("disabled subscriptions route pilot interest through the configured scheduler", () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const html = renderToStaticMarkup(
    <WorkspacePlanCards demoBookingUrl="https://calendar.app.google/rateloopDemo" />,
  ).replace(/\s+/g, " ");

  assert.match(
    html,
    /href="https:\/\/calendar\.app\.google\/rateloopDemo" target="_blank" rel="noopener noreferrer"[^>]*>Request pilot<\/a>/,
  );
  assert.equal(html.match(/href="https:\/\/calendar\.app\.google\/rateloopDemo"/g)?.length, 1);
  assert.doesNotMatch(html, /mailto:/);
});

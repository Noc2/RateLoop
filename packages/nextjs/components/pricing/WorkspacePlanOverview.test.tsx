import React from "react";
import { WorkspacePlanOverview } from "./WorkspacePlanOverview";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { TOKENLESS_BILLING_PLANS, formatUsdPrice } from "~~/lib/billing/plans";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("workspace plan overview binds every public price and allowance to the canonical plans", () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const html = renderToStaticMarkup(<WorkspacePlanOverview />).replace(/\s+/g, " ");

  assert.equal(html.match(/<article/g)?.length, 3);
  assert.match(html, new RegExp(formatUsdPrice(TOKENLESS_BILLING_PLANS.free.monthlyPriceCents).replace("$", "\\$")));
  assert.match(html, new RegExp(`${TOKENLESS_BILLING_PLANS.free.decisionsPerPeriod} completed review decisions`));
  assert.match(html, new RegExp(`${TOKENLESS_BILLING_PLANS.free.activeAgents} active agent`));
  assert.match(
    html,
    new RegExp(formatUsdPrice(TOKENLESS_BILLING_PLANS.early_access.monthlyPriceCents).replace("$", "\\$")),
  );
  assert.match(
    html,
    new RegExp(`${TOKENLESS_BILLING_PLANS.early_access.decisionsPerPeriod} completed review decisions`),
  );
  assert.match(html, new RegExp(`${TOKENLESS_BILLING_PLANS.early_access.activeAgents} active agents`));
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

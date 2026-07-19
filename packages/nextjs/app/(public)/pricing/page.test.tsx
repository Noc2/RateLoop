import React from "react";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("pricing page keeps two plans and discloses costs progressively", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  process.env.TOKENLESS_SUBSCRIPTIONS_ENABLED = "true";
  const { default: PricingPage } = await import("./page");
  const html = renderToStaticMarkup(<PricingPage />).replace(/\s+/g, " ");

  assert.match(html, /Start free/);
  assert.match(html, /Free/);
  assert.match(html, /\$29/);
  assert.match(html, /25 completed review decisions/);
  assert.match(html, /250 completed review decisions/);
  assert.match(html, /href="\/agents\?tab=overview"/);
  assert.match(html, /href="\/agents\?tab=overview&amp;billing=upgrade"/);
  assert.match(html, /href="mailto:hawigxyz@proton\.me\?subject=RateLoop%20Demo"[^>]*>Book Demo<\/a>/);
  assert.match(html, /Paid panels/);
  assert.match(html, /Explain paid panel costs/);
  assert.match(html, /not included in the \$29 subscription/);
  assert.match(html, /no automatic overage charge/i);
  assert.match(html, /for the first 12 months/i);
  assert.match(html, /at least 60 days/);
  assert.match(html, /20% off/);
  assert.ok(html.indexOf("Early Access terms:") < html.indexOf("Choose Early Access"));
  assert.doesNotMatch(html, /<details/);
  assert.doesNotMatch(html, /Pricing questions|design-partner arrangement/);
});

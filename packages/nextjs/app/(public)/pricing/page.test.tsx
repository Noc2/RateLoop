import React from "react";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("pricing page keeps subscriptions and public panel costs separate", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  process.env.TOKENLESS_SUBSCRIPTIONS_ENABLED = "true";
  const { default: PricingPage } = await import("./page");
  const html = renderToStaticMarkup(<PricingPage />).replace(/\s+/g, " ");

  assert.match(html, /Start with your own reviewers/);
  assert.match(html, /Free/);
  assert.match(html, /\$99/);
  assert.match(html, /25 completed review decisions/);
  assert.match(html, /250 completed review decisions/);
  assert.match(html, /href="\/agents\?tab=overview"/);
  assert.match(html, /href="\/agents\?tab=overview&amp;billing=upgrade"/);
  assert.match(html, /7\.5% execution fee/);
  assert.match(html, /not included in the \$99 subscription/);
  assert.match(html, /no automatic overage charge/i);
  assert.match(html, /first 12 months/i);
  assert.match(html, /at least 60 days/);
  assert.match(html, /20% off/);
  assert.equal(html.match(/<details/g)?.length, 6);
});

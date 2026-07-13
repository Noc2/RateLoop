import React from "react";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("landing page leads with buyer-facing human assurance and a secondary rater journey", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { default: HomePage } = await import("./page");
  const html = renderToStaticMarkup(<HomePage />).replace(/\s+/g, " ");

  assert.match(html, /Human Assurance/i);
  assert.match(html, /for AI Workflows/i);
  assert.match(html, /Validate a Workflow/);
  assert.match(html, /Earn by Evaluating AI/);
  assert.ok(
    html.indexOf("Validate a Workflow") < html.indexOf("Earn by Evaluating AI"),
    "the buyer CTA should appear before the rater CTA",
  );
  assert.match(html, /Set the Quality Bar/);
  assert.match(html, /Humans Evaluate Blind/);
  assert.match(html, /Decide With Evidence/);
  assert.match(html, /AI consulting delivery/);
  assert.match(html, /What Is Human Assurance\?/);
  assert.match(html, /human-owned rollout decision/i);
  assert.match(html, /not suitable for secrets or regulated personal data/i);
  assert.match(html, /How It/);
  assert.match(html, /Why It/);
  assert.match(html, /Common/);
  assert.doesNotMatch(
    html,
    /Level Up Your Agent|Human and AI raters|AI raters|agent raters|Reputation|signed access terms|gated context|favorite AI agent|rateloop-promo\.mp4/i,
  );
  assert.doesNotMatch(html, /LREP|tokenless|protocol token|governance|leaderboard|manual claim/i);
});

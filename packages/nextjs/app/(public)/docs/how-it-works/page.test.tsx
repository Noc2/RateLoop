import React from "react";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("how-it-works follows the production agent, reviewer, and settlement paths", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { default: HowItWorksPage } = await import("./page");
  const html = renderToStaticMarkup(<HowItWorksPage />).replace(/\s+/g, " ");

  assert.match(html, /How It.*rateloop-text-gradient.*Works/i);
  assert.match(html, /quote.*ask.*payment.*wait.*result/i);
  assert.match(html, /eligibility policy.*blinded case.*sealed commit/i);
  assert.match(html, /zero-commit round refunds/i);
  assert.match(html, /quorum or the reveal beacon fails.*accepted work is compensated/i);
  assert.match(html, /cannot be cancelled after its first accepted commit/i);
  assert.match(html, /Correlation analytics.*never reduce pay for accepted work/i);
  assert.match(html, /id="agent-flow"/i);
  assert.match(html, /id="reviewer-flow"/i);
  assert.match(html, /id="settlement-paths"/i);
  assert.match(html, /id="decision-evidence"/i);
  assert.match(html, /id="adaptive-review"/i);
  assert.doesNotMatch(html, /LREP|staking|governance|truth oracle/i);
});

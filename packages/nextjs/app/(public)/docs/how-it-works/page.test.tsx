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
  assert.match(
    html,
    /<h3 id="human-assurance-loop-title"[^>]*>\s*<span>Human<\/span>\s*<span>Assurance<\/span>\s*<span class="inline-block text-white">Loop<\/span>\s*<\/h3>/i,
  );
  assert.match(html, /agent version, review-policy version, workflow, risk tier, and reviewer audience/i);
  assert.match(html, /two independent 15-case windows.*at least 14 comparable/i);
  assert.match(html, /50%.*25%.*10% monitoring floor/i);
  assert.match(html, /below the agreement threshold restores 100% calibration/i);
  assert.match(html, /Critical risk, missing required context, and the maximum unreviewed gap/i);
  assert.match(html, /quote.*ask.*payment.*wait.*result/i);
  assert.match(html, /eligibility policy.*blinded case.*sealed commit/i);
  assert.match(html, /paid commit publishes timelock ciphertext.*vote, prediction.*payout address, and salt/i);
  assert.match(html, /configured drand beacon after the commit deadline/i);
  assert.match(html, /whether or not the reviewer or keeper submits a reveal or claim/i);
  assert.match(html, /there is no post-commit abort/i);
  assert.match(html, /zero-commit round refunds/i);
  assert.match(html, /quorum or the reveal beacon fails.*accepted work is compensated/i);
  assert.match(html, /cannot be cancelled after its first accepted commit/i);
  assert.match(html, /Correlation analytics.*never reduce pay for accepted work/i);
  assert.match(html, /id="agent-flow"/i);
  assert.match(html, /id="reviewer-flow"/i);
  assert.match(html, /id="settlement-paths"/i);
  assert.match(html, /id="decision-evidence"/i);
  assert.match(html, /href="\/docs\/evidence".*Evidence &amp; Compliance Mapping/i);
  assert.match(html, /id="adaptive-review"/i);
  assert.doesNotMatch(html, /LREP|staking|governance|truth oracle/i);
});

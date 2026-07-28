import React from "react";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

const LANDING_TECH_ANCHORS = [
  "mcp-adapter",
  "x402-usdc",
  "proof-of-human",
  "audience-policies",
  "commit-reveal",
  "drand-tlock",
  "robust-bayesian-truth-serum",
  "surprisingly-popular",
  "base-usdc",
] as const;

test("tech-stack docs separate architecture reference from the hosted path", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { default: TechStackPage } = await import("./page");
  const html = renderToStaticMarkup(<TechStackPage />).replace(/\s+/g, " ");

  assert.match(html, /Tech.*rateloop-text-gradient.*Stack/i);
  assert.match(html, /current hosted path uses invited, unpaid workspace reviewers/i);
  assert.match(html, /does not activate the fund-backed settlement mechanisms/i);
  for (const anchor of LANDING_TECH_ANCHORS) {
    assert.match(html, new RegExp('id="' + anchor + '"', "i"));
  }
  assert.match(html, /Model Context Protocol.*Streamable HTTP/i);
  assert.match(html, /EIP-3009.*X402PanelSubmitter.*Base/i);
  assert.match(html, /provider-scoped uniqueness signal.*does not establish expertise, independence, residence/i);
  assert.match(html, /signed correlation epochs/i);
  assert.match(html, /fixedBasePay.*maximumBonus.*score/i);
  assert.match(html, /at least ten reports.*500 basis points.*2,500 basis points/i);
  assert.match(html, /12\.5%.*guaranteedBase/i);
  assert.match(html, /only fund-holding core/i);
  assert.doesNotMatch(html, /LREP|staking|governance|truth oracle/i);
});

test("every indexed technical mechanism has a rendered docs anchor", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { default: TechStackPage } = await import("./page");
  const html = renderToStaticMarkup(<TechStackPage />);

  for (const fragment of LANDING_TECH_ANCHORS) assert.match(html, new RegExp('id="' + fragment + '"'));
});

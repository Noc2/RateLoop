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

test("tech-stack docs explain the production mechanisms behind the landing page", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { default: TechStackPage } = await import("./page");
  const html = renderToStaticMarkup(<TechStackPage />).replace(/\s+/g, " ");

  assert.match(html, /Tech.*rateloop-text-gradient.*Stack/i);
  for (const anchor of LANDING_TECH_ANCHORS) {
    assert.match(html, new RegExp('id="' + anchor + '"', "i"));
  }
  assert.match(html, /Model Context Protocol.*Streamable HTTP/i);
  assert.match(html, /EIP-3009.*X402PanelSubmitter.*Base/i);
  assert.match(html, /World ID 4.*unique_human/i);
  assert.match(html, /signed correlation epochs/i);
  assert.match(html, /fixedBasePay.*maximumBonus.*score/i);
  assert.match(html, /at least ten reports.*500 basis points.*2,500 basis points/i);
  assert.match(html, /12\.5%.*guaranteedBase/i);
  assert.match(html, /only fund-holding core/i);
  assert.doesNotMatch(html, /LREP|staking|governance|truth oracle/i);
});

test("every technical landing-page link resolves to a rendered docs anchor", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const [{ default: HomePage }, { default: TechStackPage }, { default: SmartContractsPage }] = await Promise.all([
    import("../../page"),
    import("./page"),
    import("../smart-contracts/page"),
  ]);
  const landingHtml = renderToStaticMarkup(await HomePage());
  const targetHtml = {
    "/docs/tech-stack": renderToStaticMarkup(<TechStackPage />),
    "/docs/smart-contracts": renderToStaticMarkup(<SmartContractsPage />),
  };
  const links = [...landingHtml.matchAll(/href="(\/docs\/(?:tech-stack|smart-contracts))#([^"]+)"/g)];

  assert.ok(links.length > 0);
  for (const [, pathname, fragment] of links) {
    assert.match(targetHtml[pathname as keyof typeof targetHtml], new RegExp('id="' + fragment + '"'));
  }
});

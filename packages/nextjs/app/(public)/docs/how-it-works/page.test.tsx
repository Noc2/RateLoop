import React from "react";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("how-it-works explains the production integrity stack and its limits", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { default: HowItWorksPage } = await import("./page");
  const html = renderToStaticMarkup(<HowItWorksPage />).replace(/\s+/g, " ");

  assert.match(html, /World ID 4 Proof of Human/);
  assert.match(html, /Robust Bayesian Truth Serum bonus/);
  assert.match(html, /Surprisingly Popular calculation/);
  assert.match(html, /platform-funded surprise-bounty maximum/i);
  assert.match(html, /same reviewer-selected address/);
  assert.match(html, /prospective integrity epochs/);
  assert.match(html, /cannot reduce accepted-work payment/i);
  assert.match(html, /None of these controls proves.*objective truth/i);
  assert.match(html, /TOKENLESS_SANDBOX_MODE=true/i);
  assert.match(html, /Better Auth.*opaque RateLoop principal/i);
  assert.match(html, /purpose-scoped binding never grants workspace access/i);
  assert.match(html, /explicit project assignment.*short reviewer leases/i);
  assert.match(html, /not an immutable or WORM log/i);
  assert.match(html, /do not prove that the current sandbox is EU-hosted/i);
  assert.doesNotMatch(html, /Base Sepolia/i);
});
